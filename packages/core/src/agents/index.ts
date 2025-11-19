import type { FlexibleSchema } from "@ai-sdk/provider-utils";
import {
  generateText,
  streamText,
  type LanguageModel,
  type ToolSet,
  Output as BaseOutput,
  type StreamTextResult,
} from "ai";

import { RuntimeStore, type RuntimeState } from "../runtime/store.js";

import {
  generateWithDirectStructuredObject,
  generateWithStructuredPipeline,
  shouldUseStructuredPipeline,
  streamWithStructuredPipeline,
} from "./structurePipeline.js";
import { Memory } from "../memory/index.js";
import type { AiKitMemoryConfig } from "../memory/types.js";
import {
  toToolSet,
  type AgentGenerateOptions,
  type AgentGenerateResult,
  type AgentStreamOptions,
  type AgentStreamResult,
  type AgentStructuredOutput,
  type AgentTools,
  type GenerateTextParams,
  type StreamTextParams,
  type StructuredOutput,
  type WithMessages,
  type WithPrompt,
} from "./types.js";
import { applyDefaultStopWhen } from "./toolDefaults.js";
import { mergeTelemetryConfig } from "./telemetry.js";
import {
  createToolLoopSettings,
  DEFAULT_MAX_STEP_TOOLS,
  runAgentWithToolLoop,
} from "./toolLoop.js";
import { buildToonSystemPrompt, parseToonStructuredOutput } from "./toon.js";
import { getJsonSchemaFromStructuredOutput } from "./structuredOutputSchema.js";

const Output = BaseOutput as typeof BaseOutput & {
  object: <SCHEMA extends FlexibleSchema<unknown>>(options: {
    schema: SCHEMA;
  }) => AgentStructuredOutput<SCHEMA>;
};

export { Output };
export type {
  AgentGenerateOptions,
  AgentGenerateResult,
  AgentStreamOptions,
  AgentStreamResult,
  AgentTelemetryOverrides,
  AgentStructuredOutput,
} from "./types.js";
export { DEFAULT_MAX_STEP_TOOLS } from "./toolLoop.js";

export interface AgentConfig {
  name: string;
  instructions?: string;
  model: LanguageModel;
  tools?: AgentTools;
  telemetry?: boolean;
  loopTools?: boolean;
  maxStepTools?: number;
  toon?: boolean;
  memory?: AiKitMemoryConfig;
}

export class Agent {
  readonly name: string;
  readonly instructions?: string;
  readonly model: LanguageModel;
  readonly tools?: AgentTools;
  private telemetryEnabled: boolean;
  private loopToolsEnabled: boolean;
  private maxStepTools: number;
  private toonEnabled: boolean;
  readonly memory?: Memory;

  constructor({
    name,
    instructions,
    model,
    tools,
    telemetry,
    loopTools,
    maxStepTools,
    toon,
    memory,
  }: AgentConfig) {
    this.name = name;
    this.instructions = instructions;
    this.model = model;
    this.tools = tools;
    this.telemetryEnabled = telemetry ?? false;
    this.loopToolsEnabled = loopTools ?? false;
    this.maxStepTools = maxStepTools ?? DEFAULT_MAX_STEP_TOOLS;
    this.toonEnabled = toon ?? false;
    if (memory) {
      this.memory = new Memory(memory);
    }
  }

  withTelemetry(enabled: boolean = true) {
    this.telemetryEnabled = enabled;
    return this;
  }

  private async retrieveMemories(
    query: string,
    options?: { thread?: string; metadata?: Record<string, unknown> }
  ): Promise<string> {
    if (!this.memory) return "";

    const searchResult = await this.memory.search(query, {
      userId: options?.metadata?.["user-id"] as string | undefined,
      agentId: this.name,
      runId: options?.thread,
      limit: 5,
    });

    if (!searchResult || !searchResult.results || searchResult.results.length === 0) return "";

    const memories = searchResult.results.map((m) => m.memory).join("\n");
    return `\nContext from memory:\n${memories}\n`;
  }

  private async saveMemory(
    input: string,
    output: string,
    options?: { thread?: string; metadata?: Record<string, unknown> }
  ) {
    if (!this.memory) return;

    // Run in background to not block response
    this.memory.add([
      { role: "user", content: input },
      { role: "assistant", content: output },
    ], {
      userId: options?.metadata?.["user-id"] as string | undefined,
      agentId: this.name,
      runId: options?.thread,
      metadata: options?.metadata,
    }).catch((err) => {
      console.error("Failed to save memory:", err);
    });
  }

  async generate<
    OUTPUT = never,
    PARTIAL_OUTPUT = never,
    STATE extends RuntimeState = RuntimeState,
  >(
    options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>,
  ): Promise<AgentGenerateResult<OUTPUT>> {
    const memoryContext = await this.retrieveMemories(
      typeof options.prompt === "string" ? options.prompt : "", // Simple check, ideally extract text from messages too
      options.memory
    );
    const providedSystem = (options.system ?? this.instructions ?? "") + memoryContext;
    const structuredOutput = options.structuredOutput;
    const useToon = options.toon ?? this.toonEnabled;
    if (useToon && !structuredOutput) {
      throw new Error("The toon option requires a structuredOutput schema.");
    }

    const system =
      useToon && structuredOutput
        ? buildToonSystemPrompt(
          providedSystem,
          getJsonSchemaFromStructuredOutput(structuredOutput),
        )
        : providedSystem;
    const runtime = options.runtime;
    const loopToolsOption = options.loopTools;
    const maxStepToolsOption = options.maxStepTools;
    const hasRegisteredTools = hasAgentTools(this.tools);
    const loopSettings = createToolLoopSettings({
      loopToolsEnabled: loopToolsOption ?? this.loopToolsEnabled,
      tools: this.tools,
      maxStepTools: maxStepToolsOption ?? this.maxStepTools,
    });
    const finalizeResult = async (
      resultPromise: Promise<AgentGenerateResult<OUTPUT>>,
    ) => {
      const resolved = await resultPromise;
      if (useToon && structuredOutput) {
        await parseToonStructuredOutput(resolved, structuredOutput);
      }

      // Save memory if applicable
      if (this.memory && "prompt" in options && typeof options.prompt === "string") {
        // For structured output, we might want to save the JSON or a summary. 
        // For now, saving the raw text result if available, or just skipping if complex.
        // AgentGenerateResult has 'text' property usually? 
        // GenerateTextResult has 'text'.
        if (resolved.text) {
          this.saveMemory(options.prompt, resolved.text, options.memory);
        }
      }

      return resolved;
    };

    const callGenerate = async (runtimeForCall?: RuntimeStore<STATE>) => {
      const toolSet = toToolSet(this.tools);
      const structuredPipelineEnabled =
        !!structuredOutput &&
        shouldUseStructuredPipeline(this.model, this.tools, structuredOutput, {
          toon: useToon,
        });

      if (structuredOutput && structuredPipelineEnabled && !hasRegisteredTools) {
        const preparedOptions = prepareOptionsForRuntime(options, runtimeForCall);
        return finalizeResult(
          generateWithDirectStructuredObject({
            model: this.model,
            system,
            structuredOutput,
            options: preparedOptions,
            telemetryEnabled: this.telemetryEnabled,
          }),
        );
      }

      if (structuredOutput && structuredPipelineEnabled) {
        const preparedOptions = prepareOptionsForRuntime(options, runtimeForCall);
        return finalizeResult(
          runAgentWithToolLoop({
            settings: loopSettings,
            existingStopWhen: (preparedOptions as { stopWhen?: GenerateTextParams["stopWhen"] })
              .stopWhen,
            execute: async (stopWhenOverride) => {
              const optionsWithStopWhen =
                stopWhenOverride !== undefined
                  ? { ...preparedOptions, stopWhen: stopWhenOverride }
                  : preparedOptions;

              const result = await generateWithStructuredPipeline({
                model: this.model,
                tools: this.tools,
                system,
                structuredOutput,
                options: optionsWithStopWhen,
                telemetryEnabled: this.telemetryEnabled,
                loopToolsEnabled: loopSettings.enabled,
              });

              return result;
            },
          })
        );
      }

      if ("prompt" in options && options.prompt !== undefined) {
        const {
          system: _system,
          structuredOutput: _structured,
          runtime: _runtime,
          toon: _toon,
          ...rest
        } = options;
        const {
          experimental_context,
          telemetry: telemetryOverrides,
          experimental_telemetry,
          stopWhen: existingStopWhen,
          loopTools: _loopTools,
          maxStepTools: _maxStepTools,
          ...restWithoutContext
        } = rest;

        type PromptPayload = WithPrompt<GenerateTextParams> & {
          experimental_output?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
          experimental_context?: unknown;
          experimental_telemetry?: GenerateTextParams["experimental_telemetry"];
        };

        const basePayload: PromptPayload = {
          ...restWithoutContext,
          ...(existingStopWhen !== undefined
            ? { stopWhen: existingStopWhen }
            : {}),
          system,
          model: this.model,
          ...(toolSet ? { tools: toolSet } : {}),
          ...(structuredOutput && !useToon
            ? { experimental_output: structuredOutput }
            : {}),
        };

        return finalizeResult(
          runAgentWithToolLoop({
            settings: loopSettings,
            existingStopWhen,
            execute: async (stopWhenOverride) => {
              const payload: PromptPayload =
                stopWhenOverride !== undefined
                  ? { ...basePayload, stopWhen: stopWhenOverride }
                  : basePayload;

              if (loopSettings.enabled) {
                applyDefaultStopWhen(payload, this.tools);
              }

              const mergedContext = RuntimeStore.mergeExperimentalContext(
                experimental_context,
                runtimeForCall,
              );

              if (mergedContext !== undefined) {
                payload.experimental_context = mergedContext;
              }

              const mergedTelemetry = mergeTelemetryConfig({
                agentTelemetryEnabled: this.telemetryEnabled,
                overrides: telemetryOverrides,
                existing: experimental_telemetry,
              });

              if (mergedTelemetry !== undefined) {
                payload.experimental_telemetry = mergedTelemetry;
              }

              return generateText(payload);
            },
          })
        );
      }

      if ("messages" in options && options.messages !== undefined) {
        const {
          system: _system,
          structuredOutput: _structured,
          runtime: _runtime,
          toon: _toon,
          ...rest
        } = options;
        const {
          experimental_context,
          telemetry: telemetryOverrides,
          experimental_telemetry,
          stopWhen: existingStopWhen,
          loopTools: _loopTools,
          maxStepTools: _maxStepTools,
          ...restWithoutContext
        } = rest;

        type MessagesPayload = WithMessages<GenerateTextParams> & {
          experimental_output?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
          experimental_context?: unknown;
          experimental_telemetry?: GenerateTextParams["experimental_telemetry"];
        };

        const basePayload: MessagesPayload = {
          ...restWithoutContext,
          ...(existingStopWhen !== undefined
            ? { stopWhen: existingStopWhen }
            : {}),
          system,
          model: this.model,
          ...(toolSet ? { tools: toolSet } : {}),
          ...(structuredOutput && !useToon
            ? { experimental_output: structuredOutput }
            : {}),
        };

        return finalizeResult(
          runAgentWithToolLoop({
            settings: loopSettings,
            existingStopWhen,
            execute: async (stopWhenOverride) => {
              const payload: MessagesPayload =
                stopWhenOverride !== undefined
                  ? { ...basePayload, stopWhen: stopWhenOverride }
                  : basePayload;

              if (loopSettings.enabled) {
                applyDefaultStopWhen(payload, this.tools);
              }

              const mergedContext = RuntimeStore.mergeExperimentalContext(
                experimental_context,
                runtimeForCall,
              );

              if (mergedContext !== undefined) {
                payload.experimental_context = mergedContext;
              }

              const mergedTelemetry = mergeTelemetryConfig({
                agentTelemetryEnabled: this.telemetryEnabled,
                overrides: telemetryOverrides,
                existing: experimental_telemetry,
              });

              if (mergedTelemetry !== undefined) {
                payload.experimental_telemetry = mergedTelemetry;
              }

              return generateText(payload);
            },
          })
        );
      }

      throw new Error("Agent.generate requires a prompt or messages option");
    };

    if (!runtime) {
      return callGenerate();
    }

    const scopedRuntime = runtime.snapshot();
    return scopedRuntime.run(async () => {
      try {
        return await callGenerate(scopedRuntime);
      } finally {
        await scopedRuntime.dispose();
      }
    });
  }

  async stream<
    OUTPUT = never,
    PARTIAL_OUTPUT = never,
    STATE extends RuntimeState = RuntimeState,
  >(
    options: AgentStreamOptions<OUTPUT, PARTIAL_OUTPUT, STATE>,
  ): Promise<AgentStreamResult<PARTIAL_OUTPUT>> {
    const memoryContext = await this.retrieveMemories(
      "prompt" in options && typeof options.prompt === "string" ? options.prompt : "",
      options.memory
    );
    const system = (options.system ?? this.instructions ?? "") + memoryContext;
    const structuredOutput = options.structuredOutput;
    const useToon = options.toon ?? this.toonEnabled;
    if (useToon) {
      throw new Error("The toon option is not supported with agent.stream yet.");
    }
    const runtime = options.runtime;
    const loopToolsOption = options.loopTools;
    const maxStepToolsOption = options.maxStepTools;
    const loopSettings = createToolLoopSettings({
      loopToolsEnabled: loopToolsOption ?? this.loopToolsEnabled,
      tools: this.tools,
      maxStepTools: maxStepToolsOption ?? this.maxStepTools,
    });

    const callStream = async (runtimeForCall?: RuntimeStore<STATE>) => {
      const toolSet = toToolSet(this.tools);
      if (
        structuredOutput &&
        shouldUseStructuredPipeline(this.model, this.tools, structuredOutput, {
          toon: useToon,
        })
      ) {
        const preparedOptions = prepareOptionsForRuntime(options, runtimeForCall);
        const streamResult = await runAgentWithToolLoop({
          settings: loopSettings,
          existingStopWhen: (preparedOptions as { stopWhen?: StreamTextParams["stopWhen"] })
            .stopWhen,
          execute: async (stopWhenOverride) => {
            const optionsWithStopWhen =
              stopWhenOverride !== undefined
                ? { ...preparedOptions, stopWhen: stopWhenOverride }
                : preparedOptions;

            return streamWithStructuredPipeline({
              model: this.model,
              tools: this.tools,
              system,
              structuredOutput,
              options: optionsWithStopWhen,
              telemetryEnabled: this.telemetryEnabled,
              loopToolsEnabled: loopSettings.enabled,
            });
          },
        });

        attachRuntimeToStream(streamResult, runtimeForCall);
        return streamResult;
      }

      if ("prompt" in options && options.prompt !== undefined) {
        const {
          system: _system,
          structuredOutput: _structured,
          runtime: _runtime,
          toon: _toon,
          ...rest
        } = options;
        const {
          experimental_context,
          telemetry: telemetryOverrides,
          experimental_telemetry,
          stopWhen: existingStopWhen,
          loopTools: _loopTools,
          maxStepTools: _maxStepTools,
          ...restWithoutContext
        } = rest;

        type PromptStreamPayload = WithPrompt<StreamTextParams> & {
          experimental_output?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
          experimental_context?: unknown;
          experimental_telemetry?: StreamTextParams["experimental_telemetry"];
        };

        const basePayload: PromptStreamPayload = {
          ...restWithoutContext,
          ...(existingStopWhen !== undefined
            ? { stopWhen: existingStopWhen }
            : {}),
          system,
          model: this.model,
          ...(toolSet ? { tools: toolSet } : {}),
          ...(structuredOutput && !useToon
            ? { experimental_output: structuredOutput }
            : {}),
        };

        const streamResult = await runAgentWithToolLoop({
          settings: loopSettings,
          existingStopWhen,
          execute: async (stopWhenOverride) => {
            const payload: PromptStreamPayload =
              stopWhenOverride !== undefined
                ? { ...basePayload, stopWhen: stopWhenOverride }
                : basePayload;

            if (loopSettings.enabled) {
              applyDefaultStopWhen(payload, this.tools);
            }

            const mergedContext = RuntimeStore.mergeExperimentalContext(
              experimental_context,
              runtimeForCall,
            );

            if (mergedContext !== undefined) {
              payload.experimental_context = mergedContext;
            }

            const mergedTelemetry = mergeTelemetryConfig({
              agentTelemetryEnabled: this.telemetryEnabled,
              overrides: telemetryOverrides,
              existing: experimental_telemetry,
            });

            if (mergedTelemetry !== undefined) {
              payload.experimental_telemetry = mergedTelemetry;
            }

            return streamText({
              ...payload,
              onFinish: (event) => {
                if (this.memory && "prompt" in options && typeof options.prompt === "string") {
                  this.saveMemory(options.prompt, event.text, options.memory);
                }
                if (payload.onFinish) {
                  payload.onFinish(event);
                }
              },
            });
          },
        });
        attachRuntimeToStream(streamResult, runtimeForCall);
        return streamResult;
      }

      if ("messages" in options && options.messages !== undefined) {
        const {
          system: _system,
          structuredOutput: _structured,
          runtime: _runtime,
          toon: _toon,
          ...rest
        } = options;
        const {
          experimental_context,
          telemetry: telemetryOverrides,
          experimental_telemetry,
          stopWhen: existingStopWhen,
          loopTools: _loopTools,
          maxStepTools: _maxStepTools,
          ...restWithoutContext
        } = rest;

        type MessagesStreamPayload = WithMessages<StreamTextParams> & {
          experimental_output?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
          experimental_context?: unknown;
          experimental_telemetry?: StreamTextParams["experimental_telemetry"];
        };

        const basePayload: MessagesStreamPayload = {
          ...restWithoutContext,
          ...(existingStopWhen !== undefined
            ? { stopWhen: existingStopWhen }
            : {}),
          system,
          model: this.model,
          ...(toolSet ? { tools: toolSet } : {}),
          ...(structuredOutput && !useToon
            ? { experimental_output: structuredOutput }
            : {}),
        };

        const streamResult = await runAgentWithToolLoop({
          settings: loopSettings,
          existingStopWhen,
          execute: async (stopWhenOverride) => {
            const payload: MessagesStreamPayload =
              stopWhenOverride !== undefined
                ? { ...basePayload, stopWhen: stopWhenOverride }
                : basePayload;

            if (loopSettings.enabled) {
              applyDefaultStopWhen(payload, this.tools);
            }

            const mergedContext = RuntimeStore.mergeExperimentalContext(
              experimental_context,
              runtimeForCall,
            );

            if (mergedContext !== undefined) {
              payload.experimental_context = mergedContext;
            }

            const mergedTelemetry = mergeTelemetryConfig({
              agentTelemetryEnabled: this.telemetryEnabled,
              overrides: telemetryOverrides,
              existing: experimental_telemetry,
            });

            if (mergedTelemetry !== undefined) {
              payload.experimental_telemetry = mergedTelemetry;
            }

            return streamText({
              ...payload,
              onFinish: (event) => {
                if (this.memory) {
                  const lastMessage = options.messages[options.messages.length - 1];
                  if (lastMessage.role === 'user' && typeof lastMessage.content === 'string') {
                    this.saveMemory(lastMessage.content, event.text, options.memory);
                  }
                }
                if (payload.onFinish) {
                  payload.onFinish(event);
                }
              },
            });
          },
        });
        attachRuntimeToStream(streamResult, runtimeForCall);
        return streamResult;
      }

      throw new Error("Agent.stream requires a prompt or messages option");
    };

    if (!runtime) {
      return callStream();
    }

    const scopedRuntime = runtime.snapshot();

    return scopedRuntime.run(async () => {
      try {
        return await callStream(scopedRuntime);
      } catch (error) {
        await scopedRuntime.dispose();
        throw error;
      }
    });
  }
}

function hasAgentTools(tools: AgentTools | undefined): boolean {
  if (!tools) {
    return false;
  }

  return Object.keys(tools).length > 0;
}

function prepareOptionsForRuntime<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState,
>(
  options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>,
  runtime: RuntimeStore<STATE> | undefined,
): AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>;
function prepareOptionsForRuntime<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState,
>(
  options: AgentStreamOptions<OUTPUT, PARTIAL_OUTPUT, STATE>,
  runtime: RuntimeStore<STATE> | undefined,
): AgentStreamOptions<OUTPUT, PARTIAL_OUTPUT, STATE>;
function prepareOptionsForRuntime<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState,
>(
  options:
    | AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>
    | AgentStreamOptions<OUTPUT, PARTIAL_OUTPUT, STATE>,
  runtime: RuntimeStore<STATE> | undefined,
) {
  if (!runtime) {
    return options;
  }

  const { runtime: _runtime, experimental_context, ...rest } =
    options as typeof options & { experimental_context?: unknown };

  const mergedContext = RuntimeStore.mergeExperimentalContext(
    experimental_context,
    runtime,
  );

  return {
    ...rest,
    runtime,
    ...(mergedContext !== undefined
      ? { experimental_context: mergedContext }
      : {}),
  } as typeof options;
}

function attachRuntimeToStream<STATE extends RuntimeState>(
  streamResult: StreamTextResult<ToolSet, unknown>,
  runtime: RuntimeStore<STATE> | undefined,
) {
  if (!runtime) {
    return;
  }

  let disposed = false;

  const disposeOnce = async () => {
    if (disposed) {
      return;
    }

    disposed = true;
    await runtime.dispose();
  };

  const runWithinRuntime = <Result>(
    callback: () => Result | Promise<Result>,
  ): Result | Promise<Result> => {
    if (disposed || runtime.isDisposed()) {
      return callback();
    }

    return runtime.run(callback);
  };

  const originalClose = (streamResult as unknown as { closeStream?: () => void })
    .closeStream;
  if (typeof originalClose === "function") {
    (streamResult as unknown as { closeStream: () => void }).closeStream = () => {
      return runWithinRuntime(() => {
        try {
          originalClose.call(streamResult);
        } finally {
          void disposeOnce();
        }
      });
    };
  }

  const originalConsume = streamResult.consumeStream.bind(streamResult);
  streamResult.consumeStream = async (...args) => {
    return runWithinRuntime(async () => {
      try {
        return await originalConsume(...args);
      } finally {
        await disposeOnce();
      }
    });
  };
}
