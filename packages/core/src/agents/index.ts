import {
  generateText,
  streamText,
  type LanguageModel,
  type ToolSet,
  Output,
} from "ai";

import {
  generateWithStructuredPipeline,
  shouldUseStructuredPipeline,
  streamWithStructuredPipeline,
} from "./structurePipeline";
import {
  type AgentGenerateOptions,
  type AgentStreamOptions,
  type GenerateTextParams,
  type StreamTextParams,
  type StructuredOutput,
  type WithMessages,
  type WithPrompt,
} from "./types";

export { Output } from "ai";
export type { AgentGenerateOptions, AgentStreamOptions } from "./types";

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
    const structuredOutput = options.structuredOutput;

    if (
      structuredOutput &&
      shouldUseStructuredPipeline(this.model, this.tools, structuredOutput)
    ) {
      return generateWithStructuredPipeline({
        model: this.model,
        tools: this.tools,
        system,
        structuredOutput,
        options,
      });
    }

    if ("prompt" in options && options.prompt !== undefined) {
      const { system: _system, structuredOutput: _structuredOutput, ...rest } =
        options;
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
      const { system: _system, structuredOutput: _structuredOutput, ...rest } =
        options;
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
    const structuredOutput = options.structuredOutput;

    if (
      structuredOutput &&
      shouldUseStructuredPipeline(this.model, this.tools, structuredOutput)
    ) {
      return streamWithStructuredPipeline({
        model: this.model,
        tools: this.tools,
        system,
        structuredOutput,
        options,
      });
    }

    if ("prompt" in options && options.prompt !== undefined) {
      const { system: _system, structuredOutput: _structuredOutput, ...rest } =
        options;
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
      const { system: _system, structuredOutput: _structuredOutput, ...rest } =
        options;
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
