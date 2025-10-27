import { parseWithSchema } from "./utils/validation.js";
import { createRunId } from "./utils/runtime.js";
import type {
  BranchId,
  WorkflowConfig,
  WorkflowTelemetryOption,
  WorkflowGraphInspection,
  WorkflowRunOptions,
  WorkflowRunResult,
  WorkflowCtxInit,
} from "./types.js";
import { WorkflowStep } from "./steps/step.js";
import { WorkflowRun } from "./workflowRun.js";

interface WorkflowRuntime<
  Input,
  Output,
  Meta extends Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined,
> extends WorkflowConfig<Input, Output, Meta, Ctx> {
  finalize: (value: unknown) => Output;
}

interface WorkflowGraph<
  Input,
  Meta extends Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined,
> {
  steps: Map<string, WorkflowStep<unknown, unknown, Meta, Input, Ctx>>;
  sequence: string[];
  branchLookup: Map<string, Map<BranchId, string>>;
  conditionSteps: Set<string>;
  entryId: string;
}

export class Workflow<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  readonly id: string;
  readonly description?: string;
  private readonly inputSchema?: WorkflowConfig<Input, Output, Meta, Ctx>["inputSchema"];
  private readonly outputSchema?: WorkflowConfig<Input, Output, Meta, Ctx>["outputSchema"];
  private readonly finalize: (value: unknown) => Output;
  private readonly metadata?: Meta;
  private readonly baseContext: WorkflowCtxInit<Ctx>;
  private telemetry?: WorkflowTelemetryOption;
  private readonly graph: WorkflowGraph<Input, Meta, Ctx>;

  constructor(
    config: WorkflowRuntime<Input, Output, Meta, Ctx>,
    graph: WorkflowGraph<Input, Meta, Ctx>,
  ) {
    this.id = config.id;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
    this.outputSchema = config.outputSchema;
    this.metadata = config.metadata;
    this.baseContext = config.ctx === undefined
      ? undefined as WorkflowCtxInit<Ctx>
      : { ...(config.ctx as Record<string, unknown>) } as WorkflowCtxInit<Ctx>;
    this.finalize = config.finalize;
    this.telemetry = config.telemetry;
    this.graph = graph;
  }

  createRun(runId: string = createRunId()): WorkflowRun<Input, Output, Meta, Ctx> {
    return new WorkflowRun<Input, Output, Meta, Ctx>({
      workflow: this,
      runId,
    });
  }

  async run(
    options: WorkflowRunOptions<Input, Meta, Ctx>,
  ): Promise<WorkflowRunResult<Output, Meta, Ctx>> {
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

  getTelemetryConfig(): WorkflowTelemetryOption | undefined {
    return this.telemetry;
  }

  getBaseContext(): WorkflowCtxInit<Ctx> {
    if (this.baseContext === undefined) {
      return undefined as WorkflowCtxInit<Ctx>;
    }

    return { ...(this.baseContext as Record<string, unknown>) } as WorkflowCtxInit<Ctx>;
  }

  withTelemetry(option: WorkflowTelemetryOption = true) {
    if (option === true) {
      if (this.telemetry === undefined || this.telemetry === false) {
        this.telemetry = true;
      }
      return this;
    }

    this.telemetry = option;
    return this;
  }

  inspect(): WorkflowGraphInspection {
    const nodes = Array.from(this.graph.steps.values()).map(step => ({
      id: step.id,
      type: this.graph.conditionSteps.has(step.id) ? "condition" as const : "step" as const,
      description: step.description,
    }));

    const edges: WorkflowGraphInspection["edges"] = [];

    for (let index = 0; index < this.graph.sequence.length - 1; index += 1) {
      edges.push({
        from: this.graph.sequence[index],
        to: this.graph.sequence[index + 1],
        kind: "sequence",
      });
    }

    for (const [conditionId, branches] of this.graph.branchLookup.entries()) {
      for (const [branchId, targetId] of branches.entries()) {
        edges.push({
          from: conditionId,
          to: targetId,
          kind: "branch",
          branchId,
        });
      }
    }

    return {
      nodes,
      edges,
      entryId: this.graph.entryId ?? null,
    };
  }

  getGraph(): WorkflowGraph<Input, Meta, Ctx> {
    return this.graph;
  }
}

export function withTelemetry<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined = undefined,
>(
  workflow: Workflow<Input, Output, Meta, Ctx>,
  option: WorkflowTelemetryOption = true,
): Workflow<Input, Output, Meta, Ctx> {
  workflow.withTelemetry(option);
  return workflow;
}
