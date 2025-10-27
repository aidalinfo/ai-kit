import { WorkflowExecutionError } from "../errors.js";
import type { SchemaLike, StepHandlerArgs, WorkflowStepLike } from "../types.js";
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
