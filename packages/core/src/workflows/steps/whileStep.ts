import {
  WorkflowAbortError,
  WorkflowExecutionError,
  WorkflowSchemaError,
} from "../errors.js";
import { Agent } from "../../agents/index.js";
import {
  CONFIDENCE_STRUCTURED_OUTPUT,
  type ConfidenceAgentRunResult,
  type ConfidenceStructuredOutput,
} from "../utils/confidenceAgent.js";
import { RuntimeStore, type RuntimeState } from "../../runtime/store.js";
import type {
  MaybePromise,
  SchemaLike,
  StepHandlerArgs,
  WorkflowStepContext,
  WorkflowStepInput,
  WorkflowStepMeta,
  WorkflowStepOutput,
  WorkflowStepRootInput,
} from "../types.js";
import { createStep, WorkflowStep } from "./step.js";

export interface WhileIterationContext<
  Input,
  LoopOutput,
  Meta extends Record<string, unknown>,
  RootInput,
> {
  input: Input;
  lastOutput: LoopOutput | undefined;
  iteration: number;
  context: WorkflowStepContext<Meta, RootInput>;
  signal: AbortSignal;
}

export type WhileConditionFn<
  Input,
  LoopOutput,
  Meta extends Record<string, unknown>,
  RootInput,
> = (
  args: WhileIterationContext<Input, LoopOutput, Meta, RootInput>,
) => MaybePromise<boolean>;

export type WhileStepCollectFn<
  Input,
  LoopOutput,
  CollectOutput,
  Meta extends Record<string, unknown>,
  RootInput,
> = (args: {
  input: Input;
  results: Array<LoopOutput>;
  lastResult: LoopOutput | undefined;
  iterations: number;
  context: WorkflowStepContext<Meta, RootInput>;
}) => MaybePromise<CollectOutput>;

export type WhileStepOutput<
  LoopOutput,
  Collect extends WhileStepCollectFn<any, LoopOutput, any, any, any> | undefined,
> = Collect extends WhileStepCollectFn<any, LoopOutput, infer CollectOutput, any, any>
  ? Awaited<CollectOutput>
  : {
      lastResult?: LoopOutput;
      allResults: Array<LoopOutput>;
    };

export interface ConfidenceIterationResult<Result> {
  result: Result;
  confidence: number;
  raw: ConfidenceAgentRunResult;
}

export interface ConfidenceWhileOutput<Result = string> {
  result: Result;
  confidence: number;
  iterations: number;
  history: Array<ConfidenceIterationResult<Result>>;
}

export interface ConfidencePromptArgs<
  Input,
  Result,
  Meta extends Record<string, unknown>,
  RootInput,
> {
  input: Input;
  iteration: number;
  lastOutput: ConfidenceIterationResult<Result> | undefined;
  context: WorkflowStepContext<Meta, RootInput>;
}

export interface WhileConfidenceConfig<
  Input,
  Result,
  Meta extends Record<string, unknown>,
  RootInput,
> {
  agent: Agent;
  prompt:
    | string
    | ((args: ConfidencePromptArgs<Input, Result, Meta, RootInput>) => MaybePromise<string>);
  minConfidence: number;
  runtimeContext?:
    | unknown
    | ((args: ConfidencePromptArgs<Input, Result, Meta, RootInput>) => MaybePromise<unknown>);
  runtime?:
    | RuntimeStore<RuntimeState>
    | ((
        args: ConfidencePromptArgs<Input, Result, Meta, RootInput>,
      ) => MaybePromise<RuntimeStore<RuntimeState> | undefined>);
}

interface SharedWhileStepConfig<Input, Output> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<Output>;
}

export interface StandardWhileStepConfig<
  Input extends WorkflowStepInput<LoopStep>,
  LoopStep extends WorkflowStep<any, any, any, any>,
  Collect extends WhileStepCollectFn<
    Input,
    WorkflowStepOutput<LoopStep>,
    any,
    WorkflowStepMeta<LoopStep>,
    WorkflowStepRootInput<LoopStep>
  > | undefined = undefined,
> extends SharedWhileStepConfig<
    Input,
    WhileStepOutput<WorkflowStepOutput<LoopStep>, Collect>
  > {
  loopStep: LoopStep;
  condition: WhileConditionFn<
    Input,
    WorkflowStepOutput<LoopStep>,
    WorkflowStepMeta<LoopStep>,
    WorkflowStepRootInput<LoopStep>
  >;
  maxIterations: number;
  prepareNextInput?: (
    args: WhileIterationContext<
      Input,
      WorkflowStepOutput<LoopStep>,
      WorkflowStepMeta<LoopStep>,
      WorkflowStepRootInput<LoopStep>
    >,
  ) => MaybePromise<WorkflowStepInput<LoopStep>>;
  collect?: Collect;
}

export interface ConfidenceWhileStepConfig<
  Input,
  Result = string,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> extends SharedWhileStepConfig<Input, ConfidenceWhileOutput<Result>> {
  maxIterations: number;
  confidence: WhileConfidenceConfig<Input, Result, Meta, RootInput>;
  loopStep?: never;
  condition?: never;
  prepareNextInput?: never;
  collect?: never;
}

export type WhileStepConfig<
  Input extends WorkflowStepInput<LoopStep>,
  LoopStep extends WorkflowStep<any, any, any, any>,
  Collect extends WhileStepCollectFn<
    Input,
    WorkflowStepOutput<LoopStep>,
    any,
    WorkflowStepMeta<LoopStep>,
    WorkflowStepRootInput<LoopStep>
  > | undefined = undefined,
  Result = string,
  Meta extends Record<string, unknown> = WorkflowStepMeta<LoopStep>,
  RootInput = WorkflowStepRootInput<LoopStep>,
> =
  | StandardWhileStepConfig<Input, LoopStep, Collect>
  | ConfidenceWhileStepConfig<Input, Result, Meta, RootInput>;

export function createWhileStep<
  Input extends WorkflowStepInput<LoopStep>,
  LoopStep extends WorkflowStep<any, any, any, any>,
  Collect extends WhileStepCollectFn<
    Input,
    WorkflowStepOutput<LoopStep>,
    any,
    WorkflowStepMeta<LoopStep>,
    WorkflowStepRootInput<LoopStep>
  > | undefined = undefined,
>(
  config: StandardWhileStepConfig<Input, LoopStep, Collect>,
): WorkflowStep<
  Input,
  WhileStepOutput<WorkflowStepOutput<LoopStep>, Collect>,
  WorkflowStepMeta<LoopStep>,
  WorkflowStepRootInput<LoopStep>
>;
export function createWhileStep<
  Input,
  Result = string,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
>(
  config: ConfidenceWhileStepConfig<Input, Result, Meta, RootInput>,
): WorkflowStep<Input, ConfidenceWhileOutput<Result>, Meta, RootInput>;
export function createWhileStep(
  config:
    | StandardWhileStepConfig<
        WorkflowStepInput<WorkflowStep<any, any, any, any>>,
        WorkflowStep<any, any, any, any>,
        WhileStepCollectFn<
          WorkflowStepInput<WorkflowStep<any, any, any, any>>,
          WorkflowStepOutput<WorkflowStep<any, any, any, any>>,
          any,
          WorkflowStepMeta<WorkflowStep<any, any, any, any>>,
          WorkflowStepRootInput<WorkflowStep<any, any, any, any>>
        > | undefined
      >
    | ConfidenceWhileStepConfig<any, any, Record<string, unknown>, unknown>,
): WorkflowStep<any, any, any, any> {
  if (isConfidenceStepConfig(config)) {
    return createConfidenceWhileStep(config);
  }

  return createLoopWhileStep(config);
}

function isConfidenceStepConfig(
  config: unknown,
): config is ConfidenceWhileStepConfig<any, any, Record<string, unknown>, unknown> {
  return Boolean(
    config &&
    typeof config === "object" &&
    "confidence" in config &&
    (config as { confidence?: unknown }).confidence !== undefined,
  );
}

function createLoopWhileStep<
  Input extends WorkflowStepInput<LoopStep>,
  LoopStep extends WorkflowStep<any, any, any, any>,
  Collect extends WhileStepCollectFn<
    Input,
    WorkflowStepOutput<LoopStep>,
    any,
    WorkflowStepMeta<LoopStep>,
    WorkflowStepRootInput<LoopStep>
  > | undefined,
>(
  config: StandardWhileStepConfig<Input, LoopStep, Collect>,
) {
  return createStep<
    Input,
    WhileStepOutput<WorkflowStepOutput<LoopStep>, Collect>,
    WorkflowStepMeta<LoopStep>,
    WorkflowStepRootInput<LoopStep>
  >({
    id: config.id,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    handler: async (
      args: StepHandlerArgs<Input, WorkflowStepMeta<LoopStep>, WorkflowStepRootInput<LoopStep>>,
    ) => runLoopWhileIteration(config, args),
  });
}

async function runLoopWhileIteration<
  Input extends WorkflowStepInput<LoopStep>,
  LoopStep extends WorkflowStep<any, any, any, any>,
  Collect extends WhileStepCollectFn<
    Input,
    WorkflowStepOutput<LoopStep>,
    any,
    WorkflowStepMeta<LoopStep>,
    WorkflowStepRootInput<LoopStep>
  > | undefined,
>(
  config: StandardWhileStepConfig<Input, LoopStep, Collect>,
  args: StepHandlerArgs<Input, WorkflowStepMeta<LoopStep>, WorkflowStepRootInput<LoopStep>>,
) {
  const { context, signal } = args;

  if (!Number.isFinite(config.maxIterations) || config.maxIterations <= 0) {
    throw new WorkflowExecutionError(
      `While step ${config.id} requires a positive finite maxIterations value`,
    );
  }

  const results: Array<WorkflowStepOutput<LoopStep>> = [];
  let lastOutput: WorkflowStepOutput<LoopStep> | undefined;
  let iterations = 0;

  while (true) {
    if (signal.aborted) {
      throw signal.reason ?? new WorkflowAbortError();
    }

    const shouldContinue = await config.condition({
      input: args.input,
      lastOutput,
      iteration: iterations,
      context,
      signal,
    });

    if (!shouldContinue) {
      break;
    }

    if (iterations >= config.maxIterations) {
      throw new WorkflowExecutionError(
        `While step ${config.id} exceeded maxIterations (${config.maxIterations})`,
      );
    }

    if (signal.aborted) {
      throw signal.reason ?? new WorkflowAbortError();
    }

    let nextInput: WorkflowStepInput<LoopStep>;
    if (config.prepareNextInput) {
      nextInput = await config.prepareNextInput({
        input: args.input,
        lastOutput,
        iteration: iterations,
        context,
        signal,
      });
    } else if (iterations === 0) {
      nextInput = args.input as WorkflowStepInput<LoopStep>;
    } else {
      nextInput = lastOutput as WorkflowStepInput<LoopStep>;
    }

    try {
      const { output } = await config.loopStep.execute({
        input: nextInput,
        context,
        signal,
      });

      const loopOutput = output as WorkflowStepOutput<LoopStep>;
      lastOutput = loopOutput;
      results.push(loopOutput);
    } catch (error) {
      throw new WorkflowExecutionError(
        `While step ${config.id} failed at iteration ${iterations}`,
        error,
      );
    }

    iterations += 1;
  }

  if (config.collect) {
    return (await config.collect({
      input: args.input,
      results,
      lastResult: lastOutput,
      iterations,
      context,
    })) as WhileStepOutput<WorkflowStepOutput<LoopStep>, Collect>;
  }

  return {
    lastResult: lastOutput,
    allResults: results,
  } as WhileStepOutput<WorkflowStepOutput<LoopStep>, Collect>;
}

function createConfidenceWhileStep<
  Input,
  Result,
  Meta extends Record<string, unknown>,
  RootInput,
>(
  config: ConfidenceWhileStepConfig<Input, Result, Meta, RootInput>,
) {
  const { minConfidence } = config.confidence;

  if (Number.isNaN(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new WorkflowSchemaError(
      `While step ${config.id} requires confidence.minConfidence to be between 0 and 1`,
    );
  }

  if (!Number.isFinite(config.maxIterations) || config.maxIterations <= 0) {
    throw new WorkflowExecutionError(
      `While step ${config.id} requires a positive finite maxIterations value`,
    );
  }

  if (config.confidence.agent instanceof Agent === false) {
    throw new WorkflowSchemaError(
      `While step ${config.id} requires confidence.agent to be an Agent instance`,
    );
  }

  return createStep<Input, ConfidenceWhileOutput<Result>, Meta, RootInput>({
    id: config.id,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    handler: async (args: StepHandlerArgs<Input, Meta, RootInput>) =>
      runConfidenceWhileIteration(config, args),
  });
}

async function runConfidenceWhileIteration<
  Input,
  Result,
  Meta extends Record<string, unknown>,
  RootInput,
>(
  config: ConfidenceWhileStepConfig<Input, Result, Meta, RootInput>,
  args: StepHandlerArgs<Input, Meta, RootInput>,
) {
  const { signal, context } = args;
  const history: Array<ConfidenceIterationResult<Result>> = [];

  for (let iteration = 0; iteration < config.maxIterations; iteration += 1) {
    if (signal.aborted) {
      throw signal.reason ?? new WorkflowAbortError();
    }

    const prompt = await resolveConfidencePrompt(config.confidence.prompt, {
      input: args.input,
      iteration,
      lastOutput: history.at(-1),
      context,
    });

    if (signal.aborted) {
      throw signal.reason ?? new WorkflowAbortError();
    }

    const runtimeContext = await resolveConfidenceRuntimeContext(config.confidence.runtimeContext, {
      input: args.input,
      iteration,
      lastOutput: history.at(-1),
      context,
    });

    if (signal.aborted) {
      throw signal.reason ?? new WorkflowAbortError();
    }

    const runtimeStore = await resolveConfidenceRuntime(config.confidence.runtime, {
      input: args.input,
      iteration,
      lastOutput: history.at(-1),
      context,
    });

    if (signal.aborted) {
      throw signal.reason ?? new WorkflowAbortError();
    }

    let run: ConfidenceAgentRunResult;
    try {
      run = (await config.confidence.agent.generate({
        prompt,
        abortSignal: signal,
        structuredOutput: CONFIDENCE_STRUCTURED_OUTPUT,
        ...(runtimeContext !== undefined ? { experimental_context: runtimeContext } : {}),
        ...(runtimeStore ? { runtime: runtimeStore } : {}),
      })) as ConfidenceAgentRunResult;
    } catch (error) {
      throw new WorkflowExecutionError(
        `While step ${config.id} failed during confidence iteration ${iteration}`,
        error,
      );
    }

    if (signal.aborted) {
      throw signal.reason ?? new WorkflowAbortError();
    }

    let structured: ConfidenceStructuredOutput;
    try {
      structured = run.experimental_output as ConfidenceStructuredOutput;
    } catch (error) {
      throw new WorkflowExecutionError(
        `While step ${config.id} failed to parse confidence at iteration ${iteration}`,
        error,
      );
    }

    const { confidence } = structured;
    if (typeof confidence !== "number" || Number.isNaN(confidence)) {
      throw new WorkflowExecutionError(
        `While step ${config.id} produced an invalid confidence value at iteration ${iteration}`,
      );
    }

    const iterationResult: ConfidenceIterationResult<Result> = {
      result: run.text as Result,
      confidence,
      raw: run,
    };

    history.push(iterationResult);

    context.emit({
      type: "confidence:iteration",
      data: {
        iteration,
        confidence,
      },
    });

    if (confidence >= config.confidence.minConfidence) {
      break;
    }
  }

  if (history.length === 0) {
    throw new WorkflowExecutionError(
      `While step ${config.id} exhausted without producing any iterations`,
    );
  }

  const finalIteration = history.at(-1) as ConfidenceIterationResult<Result>;

  return {
    result: finalIteration.result,
    confidence: finalIteration.confidence,
    iterations: history.length,
    history,
  } as ConfidenceWhileOutput<Result>;
}

async function resolveConfidencePrompt<
  Input,
  Result,
  Meta extends Record<string, unknown>,
  RootInput,
>(
  prompt:
    | string
    | ((args: ConfidencePromptArgs<Input, Result, Meta, RootInput>) => MaybePromise<string>),
  args: ConfidencePromptArgs<Input, Result, Meta, RootInput>,
): Promise<string> {
  if (typeof prompt === "string") {
    return prompt;
  }

  const resolved = await prompt(args);

  if (typeof resolved !== "string") {
    throw new WorkflowExecutionError("Confidence prompt factory must return a string");
  }

  return resolved;
}

async function resolveConfidenceRuntimeContext<
  Input,
  Result,
  Meta extends Record<string, unknown>,
  RootInput,
>(
  runtimeContext:
    | unknown
    | ((args: ConfidencePromptArgs<Input, Result, Meta, RootInput>) => MaybePromise<unknown>)
    | undefined,
  args: ConfidencePromptArgs<Input, Result, Meta, RootInput>,
) {
  if (runtimeContext === undefined) {
    return undefined;
  }

  if (typeof runtimeContext === "function") {
    return await runtimeContext(args);
  }

  return runtimeContext;
}

async function resolveConfidenceRuntime<
  Input,
  Result,
  Meta extends Record<string, unknown>,
  RootInput,
>(
  runtime:
    | RuntimeStore<RuntimeState>
    | ((
        args: ConfidencePromptArgs<Input, Result, Meta, RootInput>,
      ) => MaybePromise<RuntimeStore<RuntimeState> | undefined>)
    | undefined,
  args: ConfidencePromptArgs<Input, Result, Meta, RootInput>,
) {
  if (!runtime) {
    return undefined;
  }

  if (runtime instanceof RuntimeStore) {
    return runtime;
  }

  return await runtime(args);
}
