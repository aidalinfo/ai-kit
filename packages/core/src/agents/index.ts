import { generateText, streamText, type LanguageModel } from "ai";

type FirstArg<T> = T extends (arg: infer A, ...rest: any[]) => any ? A : never;

type GenerateTextParams = FirstArg<typeof generateText>;
type StreamTextParams = FirstArg<typeof streamText>;

type WithPrompt<T> = Extract<T, { prompt: unknown }>;
type WithMessages<T> = Extract<T, { messages: unknown }>;

type BaseAgentOptions<T> = Omit<T, "model" | "system"> & { system?: string };

export type AgentGenerateOptions =
  | BaseAgentOptions<WithPrompt<GenerateTextParams>>
  | BaseAgentOptions<WithMessages<GenerateTextParams>>;

export type AgentStreamOptions =
  | BaseAgentOptions<WithPrompt<StreamTextParams>>
  | BaseAgentOptions<WithMessages<StreamTextParams>>;

export interface AgentConfig {
  name: string;
  instructions?: string;
  model: LanguageModel;
}

export class Agent {
  readonly name: string;
  readonly instructions?: string;
  readonly model: LanguageModel;

  constructor({ name, instructions, model }: AgentConfig) {
    this.name = name;
    this.instructions = instructions;
    this.model = model;
  }

  async generate(options: AgentGenerateOptions) {
    const system = options.system ?? this.instructions;

    if ("prompt" in options && options.prompt !== undefined) {
      const { system: _system, ...rest } = options;
      const payload: WithPrompt<GenerateTextParams> = {
        ...rest,
        system,
        model: this.model,
      };

      return generateText(payload);
    }

    if ("messages" in options && options.messages !== undefined) {
      const { system: _system, ...rest } = options;
      const payload: WithMessages<GenerateTextParams> = {
        ...rest,
        system,
        model: this.model,
      };

      return generateText(payload);
    }

    throw new Error("Agent.generate requires a prompt or messages option");
  }

  stream(options: AgentStreamOptions) {
    const system = options.system ?? this.instructions;

    if ("prompt" in options && options.prompt !== undefined) {
      const { system: _system, ...rest } = options;
      const payload: WithPrompt<StreamTextParams> = {
        ...rest,
        system,
        model: this.model,
      };

      return streamText(payload);
    }

    if ("messages" in options && options.messages !== undefined) {
      const { system: _system, ...rest } = options;
      const payload: WithMessages<StreamTextParams> = {
        ...rest,
        system,
        model: this.model,
      };

      return streamText(payload);
    }

    throw new Error("Agent.stream requires a prompt or messages option");
  }
}
