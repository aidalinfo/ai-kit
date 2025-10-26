import {
  generateText,
  streamText,
  Output,
  type GenerateTextResult,
  type StreamTextResult,
  type Tool,
  type ToolSet,
} from "ai";

import type { RuntimeState, RuntimeStore } from "../runtime/store.js";

export interface AgentTelemetryOverrides {
  functionId?: string;
  metadata?: Record<string, unknown>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
}

type FirstArg<T> = T extends (arg: infer A, ...rest: any[]) => any ? A : never;

export type GenerateTextParams = FirstArg<typeof generateText>;
export type StreamTextParams = FirstArg<typeof streamText>;

export type WithPrompt<T> = Extract<T, { prompt: unknown }>;
export type WithMessages<T> = Extract<T, { messages: unknown }>;

export type StructuredOutput<OUTPUT, PARTIAL_OUTPUT> = Output.Output<
  OUTPUT,
  PARTIAL_OUTPUT
>;

export type BaseAgentOptions<
  T,
  OUTPUT = never,
  PARTIAL_OUTPUT = never,
  STATE extends RuntimeState = RuntimeState,
> = Omit<T, "model" | "system" | "experimental_output" | "tools"> & {
  system?: string;
  structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
  runtime?: RuntimeStore<STATE>;
  telemetry?: AgentTelemetryOverrides;
  loopTools?: boolean;
  maxStepTools?: number;
};

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

type ProviderToolSet = Record<string, Tool<unknown, unknown>>;

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
  OUTPUT
> &
  AgentLoopMetadata;

export type AgentStreamResult<PARTIAL_OUTPUT> = StreamTextResult<
  ToolSet,
  PARTIAL_OUTPUT
> &
  AgentLoopMetadata;
