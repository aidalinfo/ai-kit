import type { Agent, Workflow } from "@ai_kit/core";
import type { MiddlewareHandler } from "hono";
import type { ServerTelemetryOptions } from "../instrument.js";
import { SUPPORTED_HTTP_METHODS } from "./constants.js";

export type AnyWorkflow = Workflow<
  any,
  any,
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
  agents?: Record<string, Agent>;
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
