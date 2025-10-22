import { Output, type GenerateTextResult, type LanguageModel, type ToolSet } from "ai";
import { z } from "zod";

import { Agent, type AgentConfig } from "../../agents/index.js";
import type { AgentGenerateOptions, AgentStreamOptions, AgentTools } from "../../agents/types.js";
import type { RuntimeState } from "../../runtime/store.js";

const confidenceSchema = z.object({
  confidence: z.number().min(0).max(1),
});

export type ConfidenceStructuredOutput = z.infer<typeof confidenceSchema>;

export const CONFIDENCE_STRUCTURED_OUTPUT = Output.object({
  schema: confidenceSchema,
});

export type ConfidenceAgentRunResult = GenerateTextResult<ToolSet, ConfidenceStructuredOutput>;

export const DEFAULT_CONFIDENCE_PROMPT = [
  "You are a meticulous assistant that produces refined answers.",
  "Provide the best possible answer for the current task in natural language.",
  "After responding, assess how confident you are (from 0 to 1, inclusive).",
  "Write only the answer in the text response. Deliver the numeric confidence using the structured output channel.",
].join("\n");

export interface ConfidenceAgentOptions {
  name?: string;
  instructions?: string;
  tools?: AgentTools;
}

export const createConfidenceAgent = (
  model: LanguageModel,
  options: ConfidenceAgentOptions = {},
) =>
  new Agent({
    name: options.name ?? "confidence-evaluator",
    instructions: options.instructions ?? DEFAULT_CONFIDENCE_PROMPT,
    model,
    tools: options.tools,
  });

class ConfidenceStructuredAgent extends Agent {
  constructor(config: AgentConfig) {
    super(config);
  }

  override async generate<
    OUTPUT = never,
    PARTIAL_OUTPUT = never,
    STATE extends RuntimeState = RuntimeState,
  >(options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>) {
    const { structuredOutput: _ignored, ...rest } = options as typeof options & {
      structuredOutput?: unknown;
    };

    return super.generate({
      ...rest,
      structuredOutput: CONFIDENCE_STRUCTURED_OUTPUT,
    });
  }

  override async stream<
    OUTPUT = never,
    PARTIAL_OUTPUT = never,
    STATE extends RuntimeState = RuntimeState,
  >(options: AgentStreamOptions<OUTPUT, PARTIAL_OUTPUT, STATE>) {
    const { structuredOutput: _ignored, ...rest } = options as typeof options & {
      structuredOutput?: unknown;
    };

    return super.stream({
      ...rest,
      structuredOutput: CONFIDENCE_STRUCTURED_OUTPUT,
    });
  }
}

export const attachConfidenceStructuredOutput = (agent: Agent) =>
  new ConfidenceStructuredAgent({
    name: agent.name,
    instructions: agent.instructions,
    model: agent.model,
    tools: agent.tools,
  });
