import { WorkflowAbortError, WorkflowExecutionError } from "../errors.js";
import type { MaybePromise, SchemaLike, StepHandlerArgs } from "../types.js";
import { createStep, type WorkflowStep } from "./step.js";

export interface WhileLoopState<Input, BodyOutput> {
  initialInput: Input;
  iteration: number;
  lastOutput?: BodyOutput;
}

export type WhileCollectFn<BodyOutput> = (
  outputs: BodyOutput[],
) => MaybePromise<unknown>;

export type WhileStepOutput<
  BodyOutput,
  Collect extends WhileCollectFn<BodyOutput> | undefined,
> = Collect extends WhileCollectFn<BodyOutput>
  ? Awaited<ReturnType<Collect>>
  : BodyOutput | undefined;

export interface WhileStepConfig<
  Input,
  BodyOutput,
  ConditionStep extends WorkflowStep<
    WhileLoopState<Input, BodyOutput>,
    boolean,
    Meta,
    RootInput
  >,
  BodyStep extends WorkflowStep<
    WhileLoopState<Input, BodyOutput>,
    BodyOutput,
    Meta,
    RootInput
  >,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Collect extends WhileCollectFn<BodyOutput> | undefined = undefined,
> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<WhileStepOutput<BodyOutput, Collect>>;
  condition: ConditionStep;
  body: BodyStep;
  collect?: Collect;
  maxIterations?: number;
}

const normalizeMaxIterations = (value: number | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(value);

  if (normalized <= 0) {
    throw new WorkflowExecutionError(
      "While step maxIterations must be a positive finite number",
    );
  }

  return normalized;
};

export const createWhileStep = <
  Input,
  BodyOutput,
  ConditionStep extends WorkflowStep<
    WhileLoopState<Input, BodyOutput>,
    boolean,
    Meta,
    RootInput
  >,
  BodyStep extends WorkflowStep<
    WhileLoopState<Input, BodyOutput>,
    BodyOutput,
    Meta,
    RootInput
  >,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Collect extends WhileCollectFn<BodyOutput> | undefined = undefined,
>(
  config: WhileStepConfig<
    Input,
    BodyOutput,
    ConditionStep,
    BodyStep,
    Meta,
    RootInput,
    Collect
  >,
) =>
  createStep<Input, WhileStepOutput<BodyOutput, Collect>, Meta, RootInput>({
    id: config.id,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    handler: async (args: StepHandlerArgs<Input, Meta, RootInput>) => {
      const maxIterations = normalizeMaxIterations(config.maxIterations);

      const outputs: BodyOutput[] = [];
      let lastOutput: BodyOutput | undefined;
      let iteration = 0;

      while (true) {
        if (args.signal.aborted) {
          throw args.signal.reason ?? new WorkflowAbortError();
        }

        const loopState: WhileLoopState<Input, BodyOutput> = {
          initialInput: args.input,
          iteration,
          lastOutput,
        };

        const conditionArgs: StepHandlerArgs<
          WhileLoopState<Input, BodyOutput>,
          Meta,
          RootInput
        > = {
          context: args.context,
          signal: args.signal,
          input: loopState,
        };

        let shouldContinue: boolean;

        try {
          const { output } = await config.condition.execute(conditionArgs);
          shouldContinue = output;
        } catch (error) {
          throw new WorkflowExecutionError(
            `While step ${config.id} failed while evaluating condition at iteration ${iteration}`,
            error,
          );
        }

        if (typeof shouldContinue !== "boolean") {
          throw new WorkflowExecutionError(
            `While step ${config.id} condition must return a boolean at iteration ${iteration}`,
          );
        }

        if (!shouldContinue) {
          break;
        }

        if (maxIterations !== undefined && iteration >= maxIterations) {
          throw new WorkflowExecutionError(
            `While step ${config.id} exceeded maximum iterations of ${maxIterations}`,
          );
        }

        if (args.signal.aborted) {
          throw args.signal.reason ?? new WorkflowAbortError();
        }

        const bodyArgs: StepHandlerArgs<
          WhileLoopState<Input, BodyOutput>,
          Meta,
          RootInput
        > = {
          context: args.context,
          signal: args.signal,
          input: loopState,
        };

        try {
          const { output } = await config.body.execute(bodyArgs);
          lastOutput = output;
          outputs.push(output);
        } catch (error) {
          throw new WorkflowExecutionError(
            `While step ${config.id} failed while executing body at iteration ${iteration}`,
            error,
          );
        }

        iteration += 1;
      }

      if (config.collect) {
        return (await config.collect(outputs)) as WhileStepOutput<
          BodyOutput,
          Collect
        >;
      }

      return lastOutput as WhileStepOutput<BodyOutput, Collect>;
    },
  });
