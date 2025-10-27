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
  Ctx extends Record<string, unknown> | undefined = undefined,
> extends Omit<WorkflowStepConfig<Input, Output, Meta, RootInput, Ctx>, "handler" | "branchResolver"> {
  handler?: StepHandler<Input, Output, Meta, RootInput, Ctx>;
  resolveBranch: BranchResolver<Input, Output, Meta, RootInput, Ctx>;
}

export const createConditionStep = <
  Input,
  Output = Input,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
>({ handler, resolveBranch, ...config }: ConditionStepConfig<Input, Output, Meta, RootInput, Ctx>) =>
  createStep<Input, Output, Meta, RootInput, Ctx>({
    ...config,
    handler: handler ?? (async ({ input }) => input as unknown as Output),
    branchResolver: resolveBranch,
  });
