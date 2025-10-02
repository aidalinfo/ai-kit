import type { WorkflowConfig } from "./types.js";
import { WorkflowStep } from "./steps/step.js";
import { Workflow } from "./workflow.js";

export class WorkflowBuilder<
  Input,
  Current,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> {
  private readonly config: WorkflowConfig<Input, Output, Meta>;
  private readonly steps: WorkflowStep<unknown, unknown, Meta, Input>[];
  private readonly finalize?: (value: unknown) => Output;

  constructor(
    config: WorkflowConfig<Input, Output, Meta>,
    steps: WorkflowStep<unknown, unknown, Meta, Input>[],
    finalize?: (value: unknown) => Output,
  ) {
    this.config = config;
    this.steps = steps;
    this.finalize = finalize ?? config.finalize;
  }

  then<Next>(step: WorkflowStep<Current, Next, Meta, Input>) {
    return new WorkflowBuilder<Input, Next, Output, Meta>(
      { ...this.config, finalize: undefined },
      [...this.steps, step as WorkflowStep<unknown, unknown, Meta, Input>],
      this.finalize,
    );
  }

  commit(): Workflow<Input, Output, Meta> {
    const finalize = this.finalize ?? (value => value as Output);
    return new Workflow<Input, Output, Meta>(
      { ...this.config, finalize },
      this.steps,
    );
  }
}

export const createWorkflow = <
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
>(config: WorkflowConfig<Input, Output, Meta>) =>
  new WorkflowBuilder<Input, Input, Output, Meta>(config, []);
