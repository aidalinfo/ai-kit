import { parseWithSchema } from "./utils/validation.js";
import { createRunId } from "./utils/runtime.js";
import type { WorkflowConfig, WorkflowRunOptions, WorkflowRunResult } from "./types.js";
import { WorkflowStep } from "./steps/step.js";
import { WorkflowRun } from "./workflowRun.js";

interface WorkflowRuntime<
  Input,
  Output,
  Meta extends Record<string, unknown>,
> extends WorkflowConfig<Input, Output, Meta> {
  finalize: (value: unknown) => Output;
}

export class Workflow<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly id: string;
  readonly description?: string;
  private readonly inputSchema?: WorkflowConfig<Input, Output, Meta>["inputSchema"];
  private readonly outputSchema?: WorkflowConfig<Input, Output, Meta>["outputSchema"];
  private readonly finalize: (value: unknown) => Output;
  private readonly metadata?: Meta;
  private readonly steps: WorkflowStep<unknown, unknown, Meta, Input>[];

  constructor(
    config: WorkflowRuntime<Input, Output, Meta>,
    steps: WorkflowStep<unknown, unknown, Meta, Input>[],
  ) {
    this.id = config.id;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
    this.outputSchema = config.outputSchema;
    this.metadata = config.metadata;
    this.finalize = config.finalize;
    this.steps = steps;
  }

  createRun(runId: string = createRunId()): WorkflowRun<Input, Output, Meta> {
    return new WorkflowRun<Input, Output, Meta>({
      workflow: this,
      runId,
      steps: this.steps,
    });
  }

  async run(options: WorkflowRunOptions<Input, Meta>): Promise<WorkflowRunResult<Output, Meta>> {
    return this.createRun().start(options);
  }

  validateInput(value: unknown): Input {
    return parseWithSchema(this.inputSchema, value, `workflow ${this.id} input`);
  }

  validateOutput(value: unknown): Output {
    const finalized = this.finalize(value);
    return parseWithSchema(this.outputSchema, finalized, `workflow ${this.id} output`);
  }

  getInitialMetadata(): Meta | undefined {
    return this.metadata;
  }
}
