import { WorkflowAbortError, WorkflowExecutionError } from "../errors.js";
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

export interface WhileStepConfig<
  Input extends WorkflowStepInput<LoopStep>,
  LoopStep extends WorkflowStep<any, any, any, any>,
  Collect extends WhileStepCollectFn<
    Input,
    WorkflowStepOutput<LoopStep>,
    any,
    WorkflowStepMeta<LoopStep>,
    WorkflowStepRootInput<LoopStep>
  > | undefined = undefined,
> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<WhileStepOutput<WorkflowStepOutput<LoopStep>, Collect>>;
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

export const createWhileStep = <
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
  config: WhileStepConfig<Input, LoopStep, Collect>,
) =>
  createStep<
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
    ) => {
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
    },
  });
