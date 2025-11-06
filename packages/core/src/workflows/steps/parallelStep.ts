import { WorkflowExecutionError, WorkflowSchemaError } from "../errors.js";
import { parseWithSchema } from "../utils/validation.js";
import type {
  SchemaLike,
  StepHandlerArgs,
  WorkflowStepLike,
  ParallelErrorStrategy,
  ParallelAggregateFn,
  WorkflowParallelBranchGraph,
  WorkflowCtxValue,
  WorkflowStepRuntimeContext,
} from "../types.js";
import { createStep, WorkflowStep, WorkflowStepOutput } from "./step.js";

export type ParallelStepOutputs<
  Steps extends Record<string, WorkflowStep<any, any, any, any, any>>,
> = {
  [Key in keyof Steps]: WorkflowStepOutput<Steps[Key]>;
};

export interface ParallelStepConfig<
  Input,
  Steps extends Record<string, WorkflowStepLike<Meta, RootInput, Ctx>>,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<ParallelStepOutputs<Steps>>;
  steps: Steps;
}

export const createParallelStep = <
  Input,
  Steps extends Record<string, WorkflowStepLike<Meta, RootInput, Ctx>>,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
>({
  id,
  description,
  inputSchema,
  outputSchema,
  steps,
}: ParallelStepConfig<Input, Steps, Meta, RootInput, Ctx>) =>
  createStep<Input, ParallelStepOutputs<Steps>, Meta, RootInput, Ctx>({
    id,
    description,
    inputSchema,
    outputSchema,
    handler: async ({
      input,
      ctx,
      stepRuntime,
      signal,
    }: StepHandlerArgs<Input, Meta, RootInput, Ctx>) => {
      const entries = Object.entries(steps).map(async ([key, step]) => {
        try {
          const { output } = await step.execute({
            input,
            ctx,
            stepRuntime,
            context: stepRuntime,
            signal,
          });
          return [key, output] as const;
        } catch (error) {
          throw new WorkflowExecutionError(`Parallel step ${id} failed during child step ${key}`, error);
        }
      });

      const results = await Promise.all(entries);
      return Object.fromEntries(results) as ParallelStepOutputs<Steps>;
    },
  });

export interface ParallelWorkflowStepConfig<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<Output>;
  branches: Map<string, WorkflowParallelBranchGraph<Meta, RootInput, Ctx>>;
  aggregate?: ParallelAggregateFn<
    Input,
    Record<string, unknown>,
    Output,
    Meta,
    RootInput,
    Ctx
  >;
  errorStrategy: ParallelErrorStrategy;
}

export class ParallelWorkflowStep<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> extends WorkflowStep<Input, Output, Meta, RootInput, Ctx> {
  private readonly branches: Map<string, WorkflowParallelBranchGraph<Meta, RootInput, Ctx>>;
  private readonly aggregateFn?: ParallelAggregateFn<
    Input,
    Record<string, unknown>,
    Output,
    Meta,
    RootInput,
    Ctx
  >;
  private readonly strategy: ParallelErrorStrategy;

  constructor(config: ParallelWorkflowStepConfig<Input, Output, Meta, RootInput, Ctx>) {
    super({
      id: config.id,
      description: config.description,
      inputSchema: config.inputSchema,
      outputSchema: config.outputSchema,
      handler: async () => {
        throw new WorkflowExecutionError(
          `Parallel workflow step ${config.id} requires runtime support for execution`,
        );
      },
    });

    if (config.branches.size === 0) {
      throw new WorkflowSchemaError(`Parallel workflow step ${config.id} requires at least one branch`);
    }

    this.branches = config.branches;
    this.aggregateFn = config.aggregate;
    this.strategy = config.errorStrategy;
  }

  getParallelBranches() {
    return this.branches;
  }

  getAggregate() {
    return this.aggregateFn;
  }

  getErrorStrategy(): ParallelErrorStrategy {
    return this.strategy;
  }

  async aggregateResults({
    input,
    results,
    ctx,
    stepRuntime,
    signal,
  }: {
    input: Input;
    results: Record<string, unknown>;
    ctx: WorkflowCtxValue<Ctx>;
    stepRuntime: WorkflowStepRuntimeContext<Meta, RootInput, Ctx>;
    signal: AbortSignal;
  }): Promise<Output> {
    if (!this.aggregateFn) {
      return results as Output;
    }

    return this.aggregateFn({
      input,
      results,
      ctx,
      stepRuntime,
      signal,
    });
  }

  validateInput(value: unknown): Input {
    return parseWithSchema(this.inputSchema, value, `step ${this.id} input`);
  }

  validateOutput(value: unknown): Output {
    return parseWithSchema(this.outputSchema, value, `step ${this.id} output`);
  }
}
