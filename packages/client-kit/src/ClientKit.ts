import type {
  AgentGenerateResult,
  WorkflowRunOptions,
  WorkflowRunResult,
} from "@ai_kit/core";

export interface ClientKitOptions {
  baseUrl?: string;
  headers?: HeadersInit;
  fetch?: typeof fetch;
  runtime?: DefaultRuntimeContext;
}

export interface DefaultRuntimeContext {
  metadata?: Record<string, unknown>;
  ctx?: Record<string, unknown>;
}

export interface RequestOptions {
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export interface AgentSummary {
  id: string;
  name: string;
  instructions?: string;
}

export interface WorkflowSummary {
  id: string;
  workflowId: string;
  description?: string;
}

export type AgentGeneratePayload =
  | ({ prompt: string; messages?: never } & Record<string, unknown>)
  | ({ messages: unknown; prompt?: never } & Record<string, unknown>)
  | ({ prompt: string; messages: unknown } & Record<string, unknown>);

export interface WorkflowRunPayload<
  Input,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  Ctx extends Record<string, unknown> = Record<string, unknown>,
> {
  inputData: Input;
  metadata?: Meta;
  ctx?: Ctx;
  runtime?: WorkflowRunRuntimeOverrides<Meta, Ctx>;
  runtimeContext?: WorkflowRunRuntimeOverrides<Meta, Ctx>;
  telemetry?: WorkflowRunOptions<Input, Meta, Ctx>["telemetry"];
}

export interface WorkflowRunRuntimeOverrides<
  Meta extends Record<string, unknown>,
  Ctx extends Record<string, unknown>,
> {
  metadata?: Meta;
  ctx?: Ctx;
}

export interface ResumeWorkflowPayload {
  stepId: string;
  data: unknown;
}

export type WorkflowRunResponse<
  Output,
  Meta extends Record<string, unknown>,
  Ctx extends Record<string, unknown>,
> = WorkflowRunResult<Output, Meta, Ctx> & { runId: string };

export class ClientKitError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ClientKitError";
    this.status = status;
    this.details = details;
  }
}

function mergeRecords<T extends Record<string, unknown> | undefined>(
  base: T,
  override: T,
): T {
  if (!base && !override) {
    return undefined as T;
  }

  if (!base) {
    return override;
  }

  if (!override) {
    return base;
  }

  return { ...base, ...override } as T;
}

function ensureAgentPayload(payload: AgentGeneratePayload) {
  if (!payload || typeof payload !== "object") {
    throw new ClientKitError("Agent payload must be an object", 400);
  }

  const hasPrompt = "prompt" in payload && payload.prompt !== undefined;
  const hasMessages = "messages" in payload && payload.messages !== undefined;

  if (!hasPrompt && !hasMessages) {
    throw new ClientKitError(
      "Agent payload must include a prompt or messages field",
      400,
    );
  }
}

export class ClientKit {
  private readonly baseUrl: URL;
  private readonly defaultHeaders: Headers;
  private readonly fetchImpl: typeof fetch;
  private readonly runtimeDefaults: DefaultRuntimeContext;

  constructor(options: ClientKitOptions = {}) {
    const baseUrl = options.baseUrl ?? "http://localhost:3000";
    this.baseUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    this.defaultHeaders = this.toHeaders(options.headers);
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof this.fetchImpl !== "function") {
      throw new Error("ClientKit requires a fetch implementation");
    }

    this.runtimeDefaults = options.runtime ?? {};
  }

  async listAgents(options?: RequestOptions): Promise<AgentSummary[]> {
    const { agents } = await this.requestJson<{ agents: AgentSummary[] }>(
      "/api/agents",
      {
        method: "GET",
        headers: options?.headers,
        signal: options?.signal,
      },
    );

    return agents;
  }

  async getAgent(id: string, options?: RequestOptions): Promise<AgentSummary> {
    const agents = await this.listAgents(options);
    const agent = agents.find(entry => entry.id === id);

    if (!agent) {
      throw new ClientKitError(`Agent ${id} not found`, 404);
    }

    return agent;
  }

  async generateAgent<
    OUTPUT = unknown,
    PAYLOAD extends AgentGeneratePayload = AgentGeneratePayload,
  >(
    id: string,
    payload: PAYLOAD,
    options?: RequestOptions,
  ): Promise<AgentGenerateResult<OUTPUT>> {
    ensureAgentPayload(payload);

    return this.requestJson<AgentGenerateResult<OUTPUT>>(
      `/api/agents/${encodeURIComponent(id)}/generate`,
      {
        method: "POST",
        body: payload,
        headers: options?.headers,
        signal: options?.signal,
      },
    );
  }

  async listWorkflows(options?: RequestOptions): Promise<WorkflowSummary[]> {
    const { workflows } = await this.requestJson<{ workflows: WorkflowSummary[] }>(
      "/api/workflows",
      {
        method: "GET",
        headers: options?.headers,
        signal: options?.signal,
      },
    );

    return workflows;
  }

  async getWorkflow(
    id: string,
    options?: RequestOptions,
  ): Promise<WorkflowSummary> {
    const workflows = await this.listWorkflows(options);
    const workflow = workflows.find(entry => entry.id === id);

    if (!workflow) {
      throw new ClientKitError(`Workflow ${id} not found`, 404);
    }

    return workflow;
  }

  async runWorkflow<
    Input,
    Output = unknown,
    Meta extends Record<string, unknown> = Record<string, unknown>,
    Ctx extends Record<string, unknown> = Record<string, unknown>,
  >(
    id: string,
    payload: WorkflowRunPayload<Input, Meta, Ctx>,
    options?: RequestOptions,
  ): Promise<WorkflowRunResponse<Output, Meta, Ctx>> {
    if (!payload || typeof payload !== "object") {
      throw new ClientKitError("Workflow payload must be an object", 400);
    }

    if (!("inputData" in payload)) {
      throw new ClientKitError(
        "Workflow payload must include an inputData field",
        400,
      );
    }

    const body = this.buildWorkflowBody(payload);

    return this.requestJson<WorkflowRunResponse<Output, Meta, Ctx>>(
      `/api/workflows/${encodeURIComponent(id)}/run`,
      {
        method: "POST",
        body,
        headers: options?.headers,
        signal: options?.signal,
      },
    );
  }

  async resumeWorkflow<
    Output = unknown,
    Meta extends Record<string, unknown> = Record<string, unknown>,
    Ctx extends Record<string, unknown> = Record<string, unknown>,
  >(
    id: string,
    runId: string,
    payload: ResumeWorkflowPayload,
    options?: RequestOptions,
  ): Promise<WorkflowRunResponse<Output, Meta, Ctx>> {
    if (!payload || typeof payload !== "object") {
      throw new ClientKitError("Resume payload must be an object", 400);
    }

    if (typeof payload.stepId !== "string" || payload.stepId.length === 0) {
      throw new ClientKitError("Resume payload must include a stepId", 400);
    }

    return this.requestJson<WorkflowRunResponse<Output, Meta, Ctx>>(
      `/api/workflows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/resume`,
      {
        method: "POST",
        body: payload,
        headers: options?.headers,
        signal: options?.signal,
      },
    );
  }

  private buildWorkflowBody<
    Input,
    Meta extends Record<string, unknown>,
    Ctx extends Record<string, unknown>,
  >(payload: WorkflowRunPayload<Input, Meta, Ctx>) {
    const runtimeOverrides =
      payload.runtime ?? payload.runtimeContext ?? undefined;

    const metadata = mergeRecords(
      mergeRecords(
        this.runtimeDefaults.metadata as Meta | undefined,
        runtimeOverrides?.metadata,
      ),
      payload.metadata,
    );

    const ctx = mergeRecords(
      mergeRecords(
        this.runtimeDefaults.ctx as Ctx | undefined,
        runtimeOverrides?.ctx,
      ),
      payload.ctx,
    );

    const body: Record<string, unknown> = {
      inputData: payload.inputData,
    };

    if (metadata !== undefined) {
      body.metadata = metadata;
    }

    if (ctx !== undefined) {
      body.ctx = ctx;
    }

    if (payload.telemetry !== undefined) {
      body.telemetry = payload.telemetry;
    }

    return body;
  }

  private toHeaders(init?: HeadersInit): Headers {
    const headers = new Headers();
    if (init) {
      const normalized = new Headers(init);
      normalized.forEach((value, key) => {
        headers.set(key, value);
      });
    }
    return headers;
  }

  private mergeHeaders(...inits: (HeadersInit | undefined)[]): Headers {
    const headers = new Headers(this.defaultHeaders);
    for (const init of inits) {
      if (!init) {
        continue;
      }
      const normalized = new Headers(init);
      normalized.forEach((value, key) => {
        headers.set(key, value);
      });
    }
    return headers;
  }

  private resolveUrl(path: string): string {
    const relative = path.startsWith("/") ? path.slice(1) : path;
    return new URL(relative, this.baseUrl).toString();
  }

  private async requestJson<T>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      headers?: HeadersInit;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const headers = this.mergeHeaders(init.headers);

    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    if (!headers.has("accept")) {
      headers.set("accept", "application/json");
    }

    const response = await this.fetchImpl(this.resolveUrl(path), {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body:
        init.body === undefined
          ? undefined
          : JSON.stringify(init.body, (_key, value) =>
              value instanceof Map ? Object.fromEntries(value) : value,
            ),
      signal: init.signal,
    });

    if (!response.ok) {
      let details: unknown;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        try {
          details = await response.json();
        } catch {
          details = undefined;
        }
      } else {
        try {
          details = await response.text();
        } catch {
          details = undefined;
        }
      }

      throw new ClientKitError(
        `Request to ${path} failed with status ${response.status}`,
        response.status,
        details,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new ClientKitError(
        `Expected JSON response from ${path} but received ${contentType ?? "unknown content type"}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }
}

export default ClientKit;
