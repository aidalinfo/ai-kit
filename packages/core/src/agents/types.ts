import {
  generateText,
  streamText,
  Output,
  type ToolSet,
} from "ai";

type FirstArg<T> = T extends (arg: infer A, ...rest: any[]) => any ? A : never;

export type GenerateTextParams = FirstArg<typeof generateText>;
export type StreamTextParams = FirstArg<typeof streamText>;

export type WithPrompt<T> = Extract<T, { prompt: unknown }>;
export type WithMessages<T> = Extract<T, { messages: unknown }>;

export type StructuredOutput<OUTPUT, PARTIAL_OUTPUT> = Output.Output<
  OUTPUT,
  PARTIAL_OUTPUT
>;

export type BaseAgentOptions<T, OUTPUT = never, PARTIAL_OUTPUT = never> =
  Omit<T, "model" | "system" | "experimental_output" | "tools"> & {
    system?: string;
    structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
  };

export type AgentGenerateOptions<OUTPUT = never, PARTIAL_OUTPUT = never> =
  | BaseAgentOptions<WithPrompt<GenerateTextParams>, OUTPUT, PARTIAL_OUTPUT>
  | BaseAgentOptions<WithMessages<GenerateTextParams>, OUTPUT, PARTIAL_OUTPUT>;

export type AgentStreamOptions<OUTPUT = never, PARTIAL_OUTPUT = never> =
  | BaseAgentOptions<WithPrompt<StreamTextParams>, OUTPUT, PARTIAL_OUTPUT>
  | BaseAgentOptions<WithMessages<StreamTextParams>, OUTPUT, PARTIAL_OUTPUT>;

export type AgentTools = ToolSet | undefined;
