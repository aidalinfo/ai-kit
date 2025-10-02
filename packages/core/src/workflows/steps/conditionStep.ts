import type {
  BranchResolver,
  StepHandler,
  WorkflowStepConfig,
} from "../types.js";
import { createStep } from "./step.js";

export interface ConditionStepConfig<
  Input,
  Output = Input,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> extends Omit<WorkflowStepConfig<Input, Output, Meta, RootInput>, "handler" | "branchResolver"> {
  handler?: StepHandler<Input, Output, Meta, RootInput>;
  resolveBranch: BranchResolver<Input, Output, Meta, RootInput>;
}

export const createConditionStep = <
  Input,
  Output = Input,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
>({ handler, resolveBranch, ...config }: ConditionStepConfig<Input, Output, Meta, RootInput>) =>
  createStep<Input, Output, Meta, RootInput>({
    ...config,
    handler: handler ?? (async ({ input }) => input as Output),
    branchResolver: resolveBranch,
  });
