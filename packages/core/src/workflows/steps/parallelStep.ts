import { WorkflowExecutionError } from "../errors.js";
import type { SchemaLike, StepHandlerArgs, WorkflowStepLike } from "../types.js";
import { createStep, WorkflowStep, WorkflowStepOutput } from "./step.js";

export type ParallelStepOutputs<
  Steps extends Record<string, WorkflowStep<any, any, any, any>>,
> = {
  [Key in keyof Steps]: WorkflowStepOutput<Steps[Key]>;
};

export interface ParallelStepConfig<
  Input,
  Steps extends Record<string, WorkflowStepLike<Meta, RootInput>>,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<ParallelStepOutputs<Steps>>;
  steps: Steps;
}

export const createParallelStep = <
  Input,
  Steps extends Record<string, WorkflowStepLike<Meta, RootInput>>,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
>({ id, description, inputSchema, outputSchema, steps }: ParallelStepConfig<Input, Steps, Meta, RootInput>) =>
  createStep<Input, ParallelStepOutputs<Steps>, Meta, RootInput>({
    id,
    description,
    inputSchema,
    outputSchema,
    handler: async ({ input, context, signal }: StepHandlerArgs<Input, Meta, RootInput>) => {
      const entries = Object.entries(steps).map(async ([key, step]) => {
        try {
          const { output } = await step.execute({ input, context, signal });
          return [key, output] as const;
        } catch (error) {
          throw new WorkflowExecutionError(`Parallel step ${id} failed during child step ${key}`, error);
        }
      });

      const results = await Promise.all(entries);
      return Object.fromEntries(results) as ParallelStepOutputs<Steps>;
    },
  });
