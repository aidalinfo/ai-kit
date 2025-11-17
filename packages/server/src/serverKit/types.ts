import type {
  AgentGenerateOptions,
  AgentGenerateResult,
  AgentStreamOptions,
  AgentStreamResult,
  RuntimeState,
  WorkflowEvent,
  WorkflowRunOptions,
  WorkflowRunResult,
} from "@ai_kit/core";
import type { MiddlewareHandler } from "hono";
import type { ServerTelemetryOptions } from "../instrument.js";
import { SUPPORTED_HTTP_METHODS } from "./constants.js";

export interface AgentLike<
  OUTPUT = never,
  PARTIAL_OUTPUT = never,
  STATE extends RuntimeState = RuntimeState,
> {
  name: string;
  instructions?: string;
  generate: (
    options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>,
  ) => Promise<AgentGenerateResult<OUTPUT>>;
  stream: (
    options: AgentStreamOptions<OUTPUT, PARTIAL_OUTPUT, STATE>,
  ) => Promise<AgentStreamResult<PARTIAL_OUTPUT>> | AgentStreamResult<PARTIAL_OUTPUT>;
}

export interface WorkflowStreamHandle<
  Output,
  Meta extends Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined,
> {
  stream: AsyncIterable<WorkflowEvent<Meta>>;
  final: Promise<WorkflowRunResult<Output, Meta, Ctx>>;
  result: Promise<WorkflowRunResult<Output, Meta, Ctx>>;
}

export interface WorkflowRunLike<
  Input,
  Output,
  Meta extends Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined,
> {
  runId: string;
  start(
    options: WorkflowRunOptions<Input, Meta, Ctx>,
  ): Promise<WorkflowRunResult<Output, Meta, Ctx>>;
  stream(
    options: WorkflowRunOptions<Input, Meta, Ctx>,
  ): Promise<WorkflowStreamHandle<Output, Meta, Ctx>>;
  resumeWithHumanInput(args: {
    runId?: string;
    stepId: string;
    data: unknown;
  }): Promise<WorkflowRunResult<Output, Meta, Ctx>>;
  cancel(reason?: unknown): void;
}

export interface WorkflowLike<
  Input,
  Output,
  Meta extends Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined,
> {
  id: string;
  description?: string;
  createRun(runId?: string): WorkflowRunLike<Input, Output, Meta, Ctx>;
}

export type AnyWorkflow = WorkflowLike<
  unknown,
  unknown,
  Record<string, unknown>,
  Record<string, unknown> | undefined
>;

export interface SwaggerOptions {
  enabled?: boolean;
  route?: string;
  title?: string;
  version?: string;
  description?: string;
}

export interface ServerRuntimeOptions {
  middleware?: ServerMiddleware[];
  apiRoutes?: ApiRouteDefinition[];
  auth?: ServerAuthConfig;
}

export interface ServerAuthConfig {
  enabled?: boolean;
  secret?: string;
}

export interface ServerKitConfig {
  agents?: Record<string, AgentLike>;
  workflows?: Record<string, AnyWorkflow>;
  server?: ServerRuntimeOptions;
  /**
   * @deprecated Use server.middleware instead.
   */
  middleware?: ServerMiddleware[];
  swagger?: SwaggerOptions | boolean;
  telemetry?: boolean | ServerTelemetryOptions;
}

export type ServerMiddleware = MiddlewareHandler | ServerMiddlewareConfig;

export interface ServerMiddlewareConfig {
  path?: string;
  handler: MiddlewareHandler;
}

export type ApiRouteMethod = (typeof SUPPORTED_HTTP_METHODS)[number];

export interface ApiRouteConfig {
  method?: ApiRouteMethod | Lowercase<ApiRouteMethod>;
  handler: MiddlewareHandler;
  middleware?: MiddlewareHandler[];
}

export interface ApiRouteDefinition {
  path: string;
  method: ApiRouteMethod;
  handler: MiddlewareHandler;
  middleware?: MiddlewareHandler[];
}

export interface ListenOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
}
