import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Agent, Workflow, WorkflowRun } from "@ai_kit/core";
import type { WorkflowEvent, WorkflowRunOptions } from "@ai_kit/core";

type AnyWorkflow = Workflow<any, any, Record<string, unknown>>;
type AnyWorkflowRun = WorkflowRun<any, any, Record<string, unknown>>;

export interface ServerKitConfig {
  agents?: Record<string, Agent>;
  workflows?: Record<string, AnyWorkflow>;
}

export interface ListenOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
}

interface ResumePayload {
  stepId: string;
  data: unknown;
}

const invalidAgentPayload = new HTTPException(400, {
  message: "Agent request payload must include either prompt or messages",
});

function normalizeError(error: unknown) {
  if (error instanceof HTTPException) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : "Internal Server Error";

  return new HTTPException(500, { message });
}

function ensureAgentPayload(payload: Record<string, unknown>) {
  if (!("prompt" in payload) && !("messages" in payload)) {
    throw invalidAgentPayload;
  }
}

function sendSseEvent(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
  const encoder = new TextEncoder();
  const formatted = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(formatted));
}

export class ServerKit {
  readonly app: Hono;
  private readonly agents: Map<string, Agent>;
  private readonly workflows: Map<string, AnyWorkflow>;
  private readonly runs: Map<string, Map<string, AnyWorkflowRun>>;

  constructor(config: ServerKitConfig = {}) {
    this.agents = new Map(Object.entries(config.agents ?? {}));
    this.workflows = new Map(Object.entries(config.workflows ?? {}));
    this.runs = new Map();
    this.app = new Hono();

    this.app.onError((err, c) => {
      const normalized = normalizeError(err);
      if (!(err instanceof HTTPException)) {
        console.error("Unhandled server error", err);
      }

      return c.json({ error: normalized.message }, normalized.status);
    });

    this.app.notFound(c => c.json({ error: "Not Found" }, 404));

    this.registerRoutes();
  }

  listen({ port, hostname, signal }: ListenOptions = {}) {
    const resolvedPort = port ?? Number(process.env.PORT ?? 8787);
    const resolvedHostname = hostname ?? "0.0.0.0";

    return serve({
      fetch: this.app.fetch,
      port: resolvedPort,
      hostname: resolvedHostname,
      signal,
    });
  }

  private registerRoutes() {
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

      if (typeof streamResult.toDataStreamResponse === "function") {
        return streamResult.toDataStreamResponse();
      }

      if (typeof streamResult.toReadableStream === "function") {
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
              .then(async result => {
                sendSseEvent(controller, "result", { runId: run.runId, result });
                if (result.status !== "waiting_human") {
                  this.removeRun(workflow.id, run.runId);
                  await pump.catch(() => undefined);
                  close();
                }
              })
              .catch(error => {
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
    options: WorkflowRunOptions<unknown, Record<string, unknown>>;
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
    } satisfies WorkflowRunOptions<unknown, Record<string, unknown>>;

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

    return result.data;
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
