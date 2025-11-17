import { serve } from "@hono/node-server";
import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type {
  WorkflowEvent,
  WorkflowRunOptions,
  WorkflowRunResult,
} from "@ai_kit/core";
import { buildOpenAPIDocument } from "./swagger.js";
import {
  instrumentServerTelemetry,
  type ServerTelemetryOptions,
} from "./instrument.js";
import {
  ensureAgentPayload,
  normalizeError,
} from "./serverKit/errors.js";
import {
  resolveSwaggerOptions,
  type NormalizedSwaggerOptions,
} from "./serverKit/swaggerOptions.js";
import { resolveTelemetryOptions } from "./serverKit/telemetry.js";
import {
  resolveAuthOptions,
  createAuthMiddleware,
} from "./serverKit/auth.js";
import {
  resolveMiddlewareEntries,
  normalizeMiddleware,
} from "./serverKit/middleware.js";
import {
  resolveApiRouteEntries,
} from "./serverKit/apiRoutes.js";
import {
  sendSseEvent,
  hasDataStreamResponse,
  hasReadableStream,
} from "./serverKit/streaming.js";
import type {
  AgentLike,
  AnyWorkflow,
  ApiRouteDefinition,
  ListenOptions,
  ServerKitConfig,
  ServerMiddleware,
  WorkflowRunLike,
} from "./serverKit/types.js";

type AnyWorkflowRun = WorkflowRunLike<
  any,
  any,
  Record<string, unknown>,
  Record<string, unknown> | undefined
>;

interface ResumePayload {
  stepId: string;
  data: unknown;
}

export class ServerKit {
  readonly app: Hono;
  private readonly agents: Map<string, AgentLike>;
  private readonly workflows: Map<string, AnyWorkflow>;
  private readonly runs: Map<string, Map<string, AnyWorkflowRun>>;
  private readonly swaggerOptions?: NormalizedSwaggerOptions;

  constructor(config: ServerKitConfig = {}) {
    this.agents = new Map(Object.entries(config.agents ?? {}));
    this.workflows = new Map(Object.entries(config.workflows ?? {}));
    this.runs = new Map();
    this.app = new Hono();
    const telemetryOptions = resolveTelemetryOptions(config.telemetry);
    const authOptions = resolveAuthOptions(config.server?.auth);

    if (telemetryOptions.enabled) {
      void instrumentServerTelemetry(telemetryOptions).catch(error => {
        console.error("Failed to initialize Langfuse telemetry", error);
      });
    }

    if (authOptions.enabled) {
      this.app.use(createAuthMiddleware(authOptions));
    }

    this.app.onError((err, c) => {
      const normalized = normalizeError(err);
      if (!(err instanceof HTTPException)) {
        console.error("Unhandled server error", err);
      }

      return c.json({ error: normalized.message }, normalized.status);
    });

    this.app.notFound(c => c.json({ error: "Not Found" }, 404));

    this.registerMiddleware(resolveMiddlewareEntries(config));
    this.registerRoutes();
    this.registerApiRoutes(resolveApiRouteEntries(config));

    const swaggerConfig = resolveSwaggerOptions(config.swagger);
    if (swaggerConfig.enabled) {
      this.swaggerOptions = swaggerConfig;
      this.registerSwaggerRoutes(swaggerConfig);
    }
  }

  listen({ port, hostname, signal }: ListenOptions = {}) {
    const resolvedPort = port ?? Number(process.env.PORT ?? 8787);
    const resolvedHostname = hostname ?? "0.0.0.0";

    const server = serve({
      fetch: this.app.fetch,
      port: resolvedPort,
      hostname: resolvedHostname,
    });

    if (this.swaggerOptions) {
      const baseUrl = new URL(`http://${resolvedHostname}:${resolvedPort}`);
      const uiUrl = new URL(this.swaggerOptions.uiPath, baseUrl);
      const jsonUrl = new URL(this.swaggerOptions.jsonPath, baseUrl);

      console.log(`Swagger UI available at ${uiUrl.href} (spec: ${jsonUrl.href})`);
    }

    if (signal) {
      const closeServer = () => {
        server.close();
      };

      if (signal.aborted) {
        closeServer();
      } else {
        signal.addEventListener("abort", closeServer, { once: true });
      }
    }

    return server;
  }

  private registerRoutes() {
    this.app.get("/api/agents", c => {
      return c.json({ agents: this.listAgents() });
    });

    this.app.get("/api/workflows", c => {
      return c.json({ workflows: this.listWorkflows() });
    });

    this.app.post("/api/agents/:id/generate", async c => {
      const agent = this.getAgentOrThrow(c);
      const payload = await this.parseJsonBody(c);

      ensureAgentPayload(payload);

      const result = await agent.generate(payload as never);
      return c.json(result);
    });

    this.app.post("/api/agents/:id/stream", async c => {
      const agent = this.getAgentOrThrow(c);
      const payload = await this.parseJsonBody(c);

      ensureAgentPayload(payload);

      const streamResult = await agent.stream(payload as never);

      if (hasDataStreamResponse(streamResult)) {
        return streamResult.toDataStreamResponse();
      }

      if (hasReadableStream(streamResult)) {
        return new Response(streamResult.toReadableStream(), {
          headers: {
            "Content-Type": "text/event-stream",
          },
        });
      }

      throw new HTTPException(500, {
        message: "Agent stream result does not expose a supported streaming API",
      });
    });

    this.app.post("/api/workflows/:id/run", async c => {
      const workflow = this.getWorkflowOrThrow(c);
      const payload = await this.parseWorkflowBody(c);

      const run = workflow.createRun();
      this.storeRun(workflow.id, run);

      try {
        const result = await run.start(payload.options);
        if (result.status !== "waiting_human") {
          this.removeRun(workflow.id, run.runId);
        }

        return c.json({ runId: run.runId, ...result });
      } catch (error) {
        this.removeRun(workflow.id, run.runId);
        throw normalizeError(error);
      }
    });

    this.app.post("/api/workflows/:id/stream", async c => {
      const workflow = this.getWorkflowOrThrow(c);
      const payload = await this.parseWorkflowBody(c);

      const run = workflow.createRun();
      this.storeRun(workflow.id, run);

      try {
        const { stream, final } = await run.stream(payload.options);

        const readable = new ReadableStream<Uint8Array>({
          start: controller => {
            sendSseEvent(controller, "run", { runId: run.runId });

            let closed = false;
            const close = () => {
              if (closed) {
                return;
              }
              closed = true;
              controller.close();
            };

            const pump = (async () => {
              try {
                for await (const event of stream as AsyncIterable<WorkflowEvent<Record<string, unknown>>>) {
                  sendSseEvent(controller, event.type, event);
                }
              } catch (error) {
                sendSseEvent(controller, "error", {
                  message:
                    error instanceof Error
                      ? error.message
                      : "Unknown workflow stream error",
                });
                this.removeRun(workflow.id, run.runId);
                close();
                throw error;
              }
            })();

            final
              .then(async (
                result: WorkflowRunResult<
                  unknown,
                  Record<string, unknown>,
                  Record<string, unknown> | undefined
                >,
              ) => {
                sendSseEvent(controller, "result", { runId: run.runId, result });
                if (result.status !== "waiting_human") {
                  this.removeRun(workflow.id, run.runId);
                  await pump.catch(() => undefined);
                  close();
                }
              })
              .catch((error: unknown) => {
                const normalized = normalizeError(error);
                sendSseEvent(controller, "error", { message: normalized.message });
                this.removeRun(workflow.id, run.runId);
                close();
              });
          },
          cancel: () => {
            run.cancel();
            this.removeRun(workflow.id, run.runId);
          },
        });

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      } catch (error) {
        this.removeRun(workflow.id, run.runId);
        throw normalizeError(error);
      }
    });

    this.app.post("/api/workflows/:id/runs/:runId/resume", async c => {
      const workflow = this.getWorkflowOrThrow(c);
      const runId = c.req.param("runId");
      const run = this.getRun(workflow.id, runId);

      if (!run) {
        throw new HTTPException(404, {
          message: `Run ${runId} not found for workflow ${workflow.id}`,
        });
      }

      const body = await this.parseJsonBody(c);
      const resumePayload = this.parseResumePayload(body);

      try {
        const result = await run.resumeWithHumanInput({
          runId,
          stepId: resumePayload.stepId,
          data: resumePayload.data,
        });

        if (result.status !== "waiting_human") {
          this.removeRun(workflow.id, runId);
        }

        return c.json({ runId, ...result });
      } catch (error) {
        throw normalizeError(error);
      }
    });
  }

  private registerMiddleware(middleware?: ServerMiddleware[]) {
    if (!middleware?.length) {
      return;
    }

    for (const entry of middleware) {
      const normalized = normalizeMiddleware(entry);

      if (!normalized.handler) {
        throw new Error("Server middleware entries must define a handler function");
      }

      if (typeof normalized.path === "string" && normalized.path.length > 0) {
        this.app.use(normalized.path, normalized.handler);
      } else {
        this.app.use(normalized.handler);
      }
    }
  }

  private registerApiRoutes(routes?: ApiRouteDefinition[]) {
    if (!routes?.length) {
      return;
    }

    for (const route of routes) {
      const handlers: MiddlewareHandler[] = [
        ...(route.middleware ?? []),
        route.handler,
      ];

      this.app.on(route.method, route.path, ...handlers);
    }
  }

  private registerSwaggerRoutes(options: NormalizedSwaggerOptions) {
    const document = buildOpenAPIDocument({
      title: options.title,
      version: options.version,
      description: options.description,
    });

    this.app.get(options.jsonPath, c => c.json(document));
    this.app.get(
      options.uiPath,
      swaggerUI({
        url: options.jsonPath,
        title: options.title,
      }),
    );

    console.log(
      `Swagger UI available at ${options.uiPath} (spec: ${options.jsonPath})`,
    );
  }

  private getAgentOrThrow(c: Context) {
    const id = c.req.param("id");
    const agent = this.agents.get(id);

    if (!agent) {
      throw new HTTPException(404, { message: `Agent ${id} not found` });
    }

    return agent;
  }

  private getWorkflowOrThrow(c: Context) {
    const id = c.req.param("id");
    const workflow = this.workflows.get(id);

    if (!workflow) {
      throw new HTTPException(404, { message: `Workflow ${id} not found` });
    }

    return workflow;
  }

  private async parseJsonBody(c: Context): Promise<Record<string, unknown>> {
    let json: unknown;

    try {
      json = await c.req.json();
    } catch (error) {
      throw new HTTPException(400, { message: "Invalid JSON payload" });
    }

    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new HTTPException(400, { message: "Request body must be an object" });
    }

    return json as Record<string, unknown>;
  }

  private async parseWorkflowBody(c: Context): Promise<{
    options: WorkflowRunOptions<
      unknown,
      Record<string, unknown>,
      Record<string, unknown> | undefined
    >;
  }> {
    const body = await this.parseJsonBody(c);

    if (!("inputData" in body)) {
      throw new HTTPException(400, {
        message: "Workflow payload must include inputData",
      });
    }

    const options = {
      inputData: body.inputData,
      metadata: (body.metadata ?? undefined) as
        | Record<string, unknown>
        | undefined,
      ctx: (body.ctx ?? undefined) as
        | Record<string, unknown>
        | undefined,
      telemetry: body.telemetry as
        | WorkflowRunOptions<
            unknown,
            Record<string, unknown>,
            Record<string, unknown> | undefined
          >["telemetry"]
        | undefined,
    } satisfies WorkflowRunOptions<
      unknown,
      Record<string, unknown>,
      Record<string, unknown> | undefined
    >;

    return { options };
  }

  private parseResumePayload(body: Record<string, unknown>): ResumePayload {
    const schema = z.object({
      stepId: z.string(),
      data: z.unknown(),
    });

    const result = schema.safeParse(body);
    if (!result.success) {
      throw new HTTPException(400, {
        message: "Resume payload must include stepId and data",
      });
    }

    return result.data as ResumePayload;
  }

  private listAgents() {
    return Array.from(this.agents.entries()).map(([id, agent]) => ({
      id,
      name: agent.name,
      instructions: agent.instructions,
    }));
  }

  private listWorkflows() {
    return Array.from(this.workflows.entries()).map(([id, workflow]) => ({
      id,
      workflowId: workflow.id,
      description: workflow.description,
    }));
  }

  private storeRun(workflowId: string, run: AnyWorkflowRun) {
    let runsForWorkflow = this.runs.get(workflowId);
    if (!runsForWorkflow) {
      runsForWorkflow = new Map();
      this.runs.set(workflowId, runsForWorkflow);
    }

    runsForWorkflow.set(run.runId, run);
  }

  private getRun(workflowId: string, runId: string) {
    return this.runs.get(workflowId)?.get(runId);
  }

  private removeRun(workflowId: string, runId: string) {
    const runsForWorkflow = this.runs.get(workflowId);
    if (!runsForWorkflow) {
      return;
    }

    runsForWorkflow.delete(runId);

    if (runsForWorkflow.size === 0) {
      this.runs.delete(workflowId);
    }
  }
}

export function createServerKit(config: ServerKitConfig = {}) {
  return new ServerKit(config);
}

export { registerApiRoute } from "./serverKit/apiRoutes.js";
export type {
  ApiRouteConfig,
  ApiRouteDefinition,
  ApiRouteMethod,
  ListenOptions,
  ServerAuthConfig,
  ServerKitConfig,
  ServerMiddleware,
  ServerMiddlewareConfig,
  ServerRuntimeOptions,
  SwaggerOptions,
} from "./serverKit/types.js";
