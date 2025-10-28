import {
  generateText,
  streamText,
  type LanguageModel,
  type ToolSet,
  Output,
  type StreamTextResult,
} from "ai";

import { RuntimeStore, type RuntimeState } from "../runtime/store.js";

import {
  generateWithStructuredPipeline,
  shouldUseStructuredPipeline,
  streamWithStructuredPipeline,
} from "./structurePipeline.js";
import {
  toToolSet,
  type AgentGenerateOptions,
  type AgentGenerateResult,
  type AgentStreamOptions,
  type AgentStreamResult,
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

export { Output } from "ai";
export type {
  AgentGenerateOptions,
  AgentGenerateResult,
  AgentStreamOptions,
  AgentStreamResult,
  AgentTelemetryOverrides,
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

  constructor({
    name,
    instructions,
    model,
    tools,
    telemetry,
    loopTools,
    maxStepTools,
    toon,
  }: AgentConfig) {
    this.name = name;
    this.instructions = instructions;
    this.model = model;
    this.tools = tools;
    this.telemetryEnabled = telemetry ?? false;
    this.loopToolsEnabled = loopTools ?? false;
    this.maxStepTools = maxStepTools ?? DEFAULT_MAX_STEP_TOOLS;
    this.toonEnabled = toon ?? false;
  }

  withTelemetry(enabled: boolean = true) {
    this.telemetryEnabled = enabled;
    return this;
  }

  async generate<
    OUTPUT = never,
    PARTIAL_OUTPUT = never,
    STATE extends RuntimeState = RuntimeState,
  >(
    options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>,
  ): Promise<AgentGenerateResult<OUTPUT>> {
    const system = options.system ?? this.instructions;
    const structuredOutput = options.structuredOutput;
    const runtime = options.runtime;
    const loopToolsOption = options.loopTools;
    const maxStepToolsOption = options.maxStepTools;
    const toonEnabled = options.toon ?? this.toonEnabled;
    const loopSettings = createToolLoopSettings({
      loopToolsEnabled: loopToolsOption ?? this.loopToolsEnabled,
      tools: this.tools,
      maxStepTools: maxStepToolsOption ?? this.maxStepTools,
    });

    const callGenerate = async (runtimeForCall?: RuntimeStore<STATE>) => {
      const toolSet = toToolSet(this.tools);
      if (
        structuredOutput &&
        shouldUseStructuredPipeline(this.model, this.tools, structuredOutput)
      ) {
        const preparedOptions = prepareOptionsForRuntime(options, runtimeForCall);
        const optionsWithToon = {
          ...preparedOptions,
          toon: toonEnabled,
        } as typeof preparedOptions;
        return runAgentWithToolLoop({
          settings: loopSettings,
          existingStopWhen: (optionsWithToon as {
            stopWhen?: GenerateTextParams["stopWhen"];
          }).stopWhen,
          execute: async (stopWhenOverride) => {
            const optionsWithStopWhen =
              stopWhenOverride !== undefined
                ? { ...optionsWithToon, stopWhen: stopWhenOverride }
                : optionsWithToon;

            const result = await generateWithStructuredPipeline({
              model: this.model,
              tools: this.tools,
              system,
              structuredOutput,
              options: optionsWithStopWhen,
              telemetryEnabled: this.telemetryEnabled,
              loopToolsEnabled: loopSettings.enabled,
              toon: toonEnabled,
            });

            return result;
          },
        });
      }

      if ("prompt" in options && options.prompt !== undefined) {
        const {
          system: _system,
          structuredOutput: _structured,
          runtime: _runtime,
          ...rest
        } = options;
        const {
          experimental_context,
          telemetry: telemetryOverrides,
          experimental_telemetry,
          stopWhen: existingStopWhen,
          loopTools: _loopTools,
          maxStepTools: _maxStepTools,
          toon: _toon,
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
          ...(structuredOutput
            ? { experimental_output: structuredOutput }
            : {}),
        };

        return runAgentWithToolLoop({
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
        });
      }

      if ("messages" in options && options.messages !== undefined) {
        const {
          system: _system,
          structuredOutput: _structured,
          runtime: _runtime,
          ...rest
        } = options;
        const {
          experimental_context,
          telemetry: telemetryOverrides,
          experimental_telemetry,
          stopWhen: existingStopWhen,
          loopTools: _loopTools,
          maxStepTools: _maxStepTools,
          toon: _toon,
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
          ...(structuredOutput
            ? { experimental_output: structuredOutput }
            : {}),
        };

        return runAgentWithToolLoop({
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
        });
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
    const system = options.system ?? this.instructions;
    const structuredOutput = options.structuredOutput;
    const runtime = options.runtime;
    const loopToolsOption = options.loopTools;
    const maxStepToolsOption = options.maxStepTools;
    const toonEnabled = options.toon ?? this.toonEnabled;
    const loopSettings = createToolLoopSettings({
      loopToolsEnabled: loopToolsOption ?? this.loopToolsEnabled,
      tools: this.tools,
      maxStepTools: maxStepToolsOption ?? this.maxStepTools,
    });

    const callStream = async (runtimeForCall?: RuntimeStore<STATE>) => {
      const toolSet = toToolSet(this.tools);
      if (
        structuredOutput &&
        shouldUseStructuredPipeline(this.model, this.tools, structuredOutput)
      ) {
        const preparedOptions = prepareOptionsForRuntime(options, runtimeForCall);
        const optionsWithToon = {
          ...preparedOptions,
          toon: toonEnabled,
        } as typeof preparedOptions;
        const streamResult = await runAgentWithToolLoop({
          settings: loopSettings,
          existingStopWhen: (optionsWithToon as {
            stopWhen?: StreamTextParams["stopWhen"];
          }).stopWhen,
          execute: async (stopWhenOverride) => {
            const optionsWithStopWhen =
              stopWhenOverride !== undefined
                ? { ...optionsWithToon, stopWhen: stopWhenOverride }
                : optionsWithToon;

            return streamWithStructuredPipeline({
              model: this.model,
              tools: this.tools,
              system,
              structuredOutput,
              options: optionsWithStopWhen,
              telemetryEnabled: this.telemetryEnabled,
              loopToolsEnabled: loopSettings.enabled,
              toon: toonEnabled,
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
          ...rest
        } = options;
        const {
          experimental_context,
          telemetry: telemetryOverrides,
          experimental_telemetry,
          stopWhen: existingStopWhen,
          loopTools: _loopTools,
          maxStepTools: _maxStepTools,
          toon: _toon,
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
          ...(structuredOutput
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

            return streamText(payload);
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
          ...rest
        } = options;
        const {
          experimental_context,
          telemetry: telemetryOverrides,
          experimental_telemetry,
          stopWhen: existingStopWhen,
          loopTools: _loopTools,
          maxStepTools: _maxStepTools,
          toon: _toon,
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
          ...(structuredOutput
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

            return streamText(payload);
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
