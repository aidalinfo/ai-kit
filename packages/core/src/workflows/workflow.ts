import { parseWithSchema } from "./utils/validation.js";
import { createRunId } from "./utils/runtime.js";
import type {
  BranchId,
  WorkflowConfig,
  WorkflowGraphInspection,
  WorkflowRunOptions,
  WorkflowRunResult,
} from "./types.js";
import { WorkflowStep } from "./steps/step.js";
import { WorkflowRun } from "./workflowRun.js";

interface WorkflowRuntime<
  Input,
  Output,
  Meta extends Record<string, unknown>,
> extends WorkflowConfig<Input, Output, Meta> {
  finalize: (value: unknown) => Output;
}

interface WorkflowGraph<
  Input,
  Meta extends Record<string, unknown>,
> {
  steps: Map<string, WorkflowStep<unknown, unknown, Meta, Input>>;
  sequence: string[];
  branchLookup: Map<string, Map<BranchId, string>>;
  conditionSteps: Set<string>;
  entryId: string;
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
  private readonly graph: WorkflowGraph<Input, Meta>;

  constructor(
    config: WorkflowRuntime<Input, Output, Meta>,
    graph: WorkflowGraph<Input, Meta>,
  ) {
    this.id = config.id;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
    this.outputSchema = config.outputSchema;
    this.metadata = config.metadata;
    this.finalize = config.finalize;
    this.graph = graph;
  }

  createRun(runId: string = createRunId()): WorkflowRun<Input, Output, Meta> {
    return new WorkflowRun<Input, Output, Meta>({
      workflow: this,
      runId,
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

  getGraph(): WorkflowGraph<Input, Meta> {
    return this.graph;
  }
}
