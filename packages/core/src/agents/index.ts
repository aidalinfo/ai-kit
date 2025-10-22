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
  type AgentStreamOptions,
  type AgentTools,
  type GenerateTextParams,
  type StreamTextParams,
  type StructuredOutput,
  type WithMessages,
  type WithPrompt,
} from "./types.js";
import { applyDefaultStopWhen } from "./toolDefaults.js";

export { Output } from "ai";
export type { AgentGenerateOptions, AgentStreamOptions } from "./types.js";

export interface AgentConfig {
  name: string;
  instructions?: string;
  model: LanguageModel;
  tools?: AgentTools;
}

export class Agent {
  readonly name: string;
  readonly instructions?: string;
  readonly model: LanguageModel;
  readonly tools?: AgentTools;

  constructor({ name, instructions, model, tools }: AgentConfig) {
    this.name = name;
    this.instructions = instructions;
    this.model = model;
    this.tools = tools;
  }

  withModel(model: LanguageModel) {
    return new Agent({
      name: this.name,
      instructions: this.instructions,
      model,
      tools: this.tools,
    });
  }

  async generate<
    OUTPUT = never,
    PARTIAL_OUTPUT = never,
    STATE extends RuntimeState = RuntimeState,
  >(
    options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>,
  ) {
    const system = options.system ?? this.instructions;
    const structuredOutput = options.structuredOutput;
    const runtime = options.runtime;

    const callGenerate = async (runtimeForCall?: RuntimeStore<STATE>) => {
      const toolSet = toToolSet(this.tools);
      if (
        structuredOutput &&
        shouldUseStructuredPipeline(this.model, this.tools, structuredOutput)
      ) {
        const preparedOptions = prepareOptionsForRuntime(options, runtimeForCall);
        return generateWithStructuredPipeline({
          model: this.model,
          tools: this.tools,
          system,
          structuredOutput,
          options: preparedOptions,
        });
      }

      if ("prompt" in options && options.prompt !== undefined) {
        const {
          system: _system,
          structuredOutput: _structured,
          runtime: _runtime,
          ...rest
        } = options;
        const { experimental_context, ...restWithoutContext } = rest;
        const payload: WithPrompt<GenerateTextParams> & {
          experimental_output?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
          experimental_context?: unknown;
        } = {
          ...restWithoutContext,
          system,
          model: this.model,
          ...(toolSet ? { tools: toolSet } : {}),
          ...(structuredOutput
            ? { experimental_output: structuredOutput }
            : {}),
        };

        applyDefaultStopWhen(payload, this.tools);

        const mergedContext = RuntimeStore.mergeExperimentalContext(
          experimental_context,
          runtimeForCall,
        );

        if (mergedContext !== undefined) {
          payload.experimental_context = mergedContext;
        }

        return generateText(payload);
      }

      if ("messages" in options && options.messages !== undefined) {
        const {
          system: _system,
          structuredOutput: _structured,
          runtime: _runtime,
          ...rest
        } = options;
        const { experimental_context, ...restWithoutContext } = rest;
        const payload: WithMessages<GenerateTextParams> & {
          experimental_output?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
          experimental_context?: unknown;
        } = {
          ...restWithoutContext,
          system,
          model: this.model,
          ...(toolSet ? { tools: toolSet } : {}),
          ...(structuredOutput
            ? { experimental_output: structuredOutput }
            : {}),
        };

        applyDefaultStopWhen(payload, this.tools);

        const mergedContext = RuntimeStore.mergeExperimentalContext(
          experimental_context,
          runtimeForCall,
        );

        if (mergedContext !== undefined) {
          payload.experimental_context = mergedContext;
        }

        return generateText(payload);
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
  ) {
    const system = options.system ?? this.instructions;
    const structuredOutput = options.structuredOutput;
    const runtime = options.runtime;

    const callStream = async (runtimeForCall?: RuntimeStore<STATE>) => {
      const toolSet = toToolSet(this.tools);
      if (
        structuredOutput &&
        shouldUseStructuredPipeline(this.model, this.tools, structuredOutput)
      ) {
        const preparedOptions = prepareOptionsForRuntime(options, runtimeForCall);
        const streamResult = await streamWithStructuredPipeline({
          model: this.model,
          tools: this.tools,
          system,
          structuredOutput,
          options: preparedOptions,
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
        const { experimental_context, ...restWithoutContext } = rest;
        const payload: WithPrompt<StreamTextParams> & {
          experimental_output?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
          experimental_context?: unknown;
        } = {
          ...restWithoutContext,
          system,
          model: this.model,
          ...(toolSet ? { tools: toolSet } : {}),
          ...(structuredOutput
            ? { experimental_output: structuredOutput }
            : {}),
        };

        applyDefaultStopWhen(payload, this.tools);

        const mergedContext = RuntimeStore.mergeExperimentalContext(
          experimental_context,
          runtimeForCall,
        );

        if (mergedContext !== undefined) {
          payload.experimental_context = mergedContext;
        }

        const streamResult = await streamText(payload);
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
        const { experimental_context, ...restWithoutContext } = rest;
        const payload: WithMessages<StreamTextParams> & {
          experimental_output?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
          experimental_context?: unknown;
        } = {
          ...restWithoutContext,
          system,
          model: this.model,
          ...(toolSet ? { tools: toolSet } : {}),
          ...(structuredOutput
            ? { experimental_output: structuredOutput }
            : {}),
        };

        applyDefaultStopWhen(payload, this.tools);

        const mergedContext = RuntimeStore.mergeExperimentalContext(
          experimental_context,
          runtimeForCall,
        );

        if (mergedContext !== undefined) {
          payload.experimental_context = mergedContext;
        }

        const streamResult = await streamText(payload);
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
