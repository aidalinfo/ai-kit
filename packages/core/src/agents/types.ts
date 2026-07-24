import type { FlexibleSchema, InferSchema } from "@ai-sdk/provider-utils";
import {
  generateText,
  streamText,
  type GenerateTextResult,
  type StreamTextResult,
  type ToolSet,
  type DeepPartial,
} from "ai";

import type { RuntimeState, RuntimeStore } from "../runtime/store.js";
import type { StructuredOutputResilienceOptions } from "./structuredOutputResilience.js";

export interface AgentTelemetryOverrides {
  functionId?: string;
  metadata?: Record<string, unknown>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
}

/**
 * Per-agent telemetry configuration. Use the object form to set a custom trace
 * name (`functionId`) or to attach metadata shared by every call of the agent
 * (e.g. `{ metadata: { workflow: "form-builder" } }` to group a pipeline).
 */
export interface AgentTelemetryConfig {
  enabled?: boolean;
  functionId?: string;
  metadata?: Record<string, unknown>;
}

type FirstArg<T> = T extends (arg: infer A, ...rest: any[]) => any ? A : never;

export type GenerateTextParams = FirstArg<typeof generateText>;
export type StreamTextParams = FirstArg<typeof streamText>;

export type WithPrompt<T> = Extract<T, { prompt: unknown }>;
export type WithMessages<T> = Extract<T, { messages: unknown }>;

export type StructuredOutput<OUTPUT, PARTIAL_OUTPUT> = {
  type?: string;
  name?: string;
  // Accept the AI SDK `Output` shape: `responseFormat` is a `PromiseLike`
  // (not a full `Promise`) that may resolve to a variant without `schema`
  // (e.g. `{ type: "text" }`) or to `undefined`. Keeping this loose lets a
  // concrete `Output<T>` stay assignable under strict TypeScript.
  responseFormat?:
    | { schema?: unknown }
    | PromiseLike<unknown>;
  parseOutput?: (...args: any[]) => Promise<OUTPUT> | OUTPUT;
};

export type AgentStructuredOutput<SchemaOrOutput> =
  SchemaOrOutput extends FlexibleSchema<unknown>
  ? StructuredOutput<InferSchema<SchemaOrOutput>, DeepPartial<InferSchema<SchemaOrOutput>>>
  : StructuredOutput<SchemaOrOutput, DeepPartial<SchemaOrOutput>>;

import type { MemoryOptions } from "../memory/types.js";

export type BaseAgentOptions<
  T,
  OUTPUT = never,
  PARTIAL_OUTPUT = never,
  STATE extends RuntimeState = RuntimeState,
> = Omit<T, "model" | "system" | "experimental_output" | "tools"> & {
  system?: string;
  structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
  toon?: boolean;
  runtime?: RuntimeStore<STATE>;
  telemetry?: AgentTelemetryOverrides;
  loopTools?: boolean;
  maxStepTools?: number;
  memory?: MemoryOptions;
} & StructuredOutputResilienceOptions;

export type AgentGenerateOptions<
  OUTPUT = never,
  PARTIAL_OUTPUT = never,
  STATE extends RuntimeState = RuntimeState,
> =
  | BaseAgentOptions<
    WithPrompt<GenerateTextParams>,
    OUTPUT,
    PARTIAL_OUTPUT,
    STATE
  >
  | BaseAgentOptions<
    WithMessages<GenerateTextParams>,
    OUTPUT,
    PARTIAL_OUTPUT,
    STATE
  >;

export type AgentStreamOptions<
  OUTPUT = never,
  PARTIAL_OUTPUT = never,
  STATE extends RuntimeState = RuntimeState,
> =
  | BaseAgentOptions<
    WithPrompt<StreamTextParams>,
    OUTPUT,
    PARTIAL_OUTPUT,
    STATE
  >
  | BaseAgentOptions<
    WithMessages<StreamTextParams>,
    OUTPUT,
    PARTIAL_OUTPUT,
    STATE
  >;

// Version-agnostic tool record. `Tool` is version- and copy-specific: a tool
// built by a consumer's own `ai` install (or a different major, e.g. v7) has a
// structurally distinct `inputSchema: FlexibleSchema<...>`, so binding to
// ai-kit's bundled `Tool<any, any>` rejects it (TS then reports against the
// `Tool<never, never>` arm of `ToolSet` → the misleading `FlexibleSchema<never>`
// error). Accepting any object-valued record keeps provider-defined and
// cross-version tools assignable; the AI SDK still validates tool shape at
// runtime (tools are cast to `ToolSet` in `toToolSet`). `ToolSet` is kept as
// the first union member so inline `tool()` authoring keeps full autocomplete.
type ProviderToolSet = Record<string, object>;

export type AgentTools = ToolSet | ProviderToolSet | undefined;

export function toToolSet(tools: AgentTools): ToolSet | undefined {
  if (!tools) {
    return undefined;
  }

  return tools as ToolSet;
}

export interface AgentLoopMetadata {
  loopTool?: boolean;
}

export type AgentGenerateResult<OUTPUT> = GenerateTextResult<
  ToolSet,
  any
> &
  AgentLoopMetadata;

export type AgentStreamResult<PARTIAL_OUTPUT> = StreamTextResult<
  ToolSet,
  any
> &
  AgentLoopMetadata;
