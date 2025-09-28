import {
  generateText,
  streamText,
  type LanguageModel,
  type ToolSet,
  Output,
} from "ai";

export { Output } from "ai";

type FirstArg<T> = T extends (arg: infer A, ...rest: any[]) => any ? A : never;

type GenerateTextParams = FirstArg<typeof generateText>;
type StreamTextParams = FirstArg<typeof streamText>;

type WithPrompt<T> = Extract<T, { prompt: unknown }>;
type WithMessages<T> = Extract<T, { messages: unknown }>;

type StructuredOutput<OUTPUT, PARTIAL_OUTPUT> = Output.Output<
  OUTPUT,
  PARTIAL_OUTPUT
>;

type BaseAgentOptions<T, OUTPUT = never, PARTIAL_OUTPUT = never> =
  Omit<T, "model" | "system" | "experimental_output"> & {
    system?: string;
    structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
  };

export type AgentGenerateOptions<OUTPUT = never, PARTIAL_OUTPUT = never> =
  | BaseAgentOptions<WithPrompt<GenerateTextParams>, OUTPUT, PARTIAL_OUTPUT>
  | BaseAgentOptions<WithMessages<GenerateTextParams>, OUTPUT, PARTIAL_OUTPUT>;

export type AgentStreamOptions<OUTPUT = never, PARTIAL_OUTPUT = never> =
  | BaseAgentOptions<WithPrompt<StreamTextParams>, OUTPUT, PARTIAL_OUTPUT>
  | BaseAgentOptions<WithMessages<StreamTextParams>, OUTPUT, PARTIAL_OUTPUT>;

export interface AgentConfig {
  name: string;
  instructions?: string;
  model: LanguageModel;
  tools?: ToolSet;
}

export class Agent {
  readonly name: string;
  readonly instructions?: string;
  readonly model: LanguageModel;
  readonly tools?: ToolSet;

  constructor({ name, instructions, model, tools }: AgentConfig) {
    this.name = name;
    this.instructions = instructions;
    this.model = model;
    this.tools = tools;
  }

  async generate<OUTPUT = never, PARTIAL_OUTPUT = never>(
    options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT>,
  ) {
    const system = options.system ?? this.instructions;

    if ("prompt" in options && options.prompt !== undefined) {
      const { system: _system, structuredOutput, ...rest } = options;
      const payload = {
        ...rest,
        system,
        model: this.model,
        ...(this.tools ? { tools: this.tools } : {}),
        ...(structuredOutput
          ? { experimental_output: structuredOutput }
          : {}),
      } satisfies WithPrompt<GenerateTextParams> & {
        experimental_output?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
      };

      return generateText(payload);
    }

    if ("messages" in options && options.messages !== undefined) {
      const { system: _system, structuredOutput, ...rest } = options;
      const payload = {
        ...rest,
        system,
        model: this.model,
        ...(this.tools ? { tools: this.tools } : {}),
        ...(structuredOutput
          ? { experimental_output: structuredOutput }
          : {}),
      } satisfies WithMessages<GenerateTextParams> & {
        experimental_output?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
      };

      return generateText(payload);
    }

    throw new Error("Agent.generate requires a prompt or messages option");
  }

  stream<OUTPUT = never, PARTIAL_OUTPUT = never>(
    options: AgentStreamOptions<OUTPUT, PARTIAL_OUTPUT>,
  ) {
    const system = options.system ?? this.instructions;

    if ("prompt" in options && options.prompt !== undefined) {
      const { system: _system, structuredOutput, ...rest } = options;
      const payload = {
        ...rest,
        system,
        model: this.model,
        ...(this.tools ? { tools: this.tools } : {}),
        ...(structuredOutput
          ? { experimental_output: structuredOutput }
          : {}),
      } satisfies WithPrompt<StreamTextParams> & {
        experimental_output?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
      };

      return streamText(payload);
    }

    if ("messages" in options && options.messages !== undefined) {
      const { system: _system, structuredOutput, ...rest } = options;
      const payload = {
        ...rest,
        system,
        model: this.model,
        ...(this.tools ? { tools: this.tools } : {}),
        ...(structuredOutput
          ? { experimental_output: structuredOutput }
          : {}),
      } satisfies WithMessages<StreamTextParams> & {
        experimental_output?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
      };

      return streamText(payload);
    }

    throw new Error("Agent.stream requires a prompt or messages option");
  }
}
