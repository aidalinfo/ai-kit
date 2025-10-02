import { WorkflowSchemaError } from "./errors.js";
import type { BranchDeclaration, BranchId, WorkflowConfig } from "./types.js";
import { WorkflowStep } from "./steps/step.js";
import { Workflow } from "./workflow.js";

type AnyWorkflowStep<Meta extends Record<string, unknown>, Input> = WorkflowStep<unknown, unknown, Meta, Input>;

interface WorkflowBuilderStore<Meta extends Record<string, unknown>, Input> {
  steps: Map<string, AnyWorkflowStep<Meta, Input>>;
  sequence: string[];
  branchLookup: Map<string, Map<BranchId, string>>;
  conditionSteps: Set<string>;
  entryId: string | null;
}

const createEmptyStore = <Meta extends Record<string, unknown>, Input>(): WorkflowBuilderStore<Meta, Input> => ({
  steps: new Map(),
  sequence: [],
  branchLookup: new Map(),
  conditionSteps: new Set(),
  entryId: null,
});

const ensureBranchLookup = <Meta extends Record<string, unknown>, Input>(
  store: WorkflowBuilderStore<Meta, Input>,
  conditionId: string,
) => {
  if (store.branchLookup.has(conditionId)) {
    throw new WorkflowSchemaError(`Condition step ${conditionId} already has branches registered`);
  }
};

const buildAdjacency = <Meta extends Record<string, unknown>, Input>(
  store: WorkflowBuilderStore<Meta, Input>,
) => {
  const adjacency = new Map<string, Set<string>>();

  for (const stepId of store.steps.keys()) {
    adjacency.set(stepId, new Set());
  }

  for (let index = 0; index < store.sequence.length - 1; index += 1) {
    const current = store.sequence[index];
    const next = store.sequence[index + 1];
    adjacency.get(current)?.add(next);
  }

  for (const [conditionId, branches] of store.branchLookup.entries()) {
    const targets = adjacency.get(conditionId);
    if (!targets) {
      continue;
    }

    for (const target of branches.values()) {
      targets.add(target);
    }
  }

  for (const [stepId, step] of store.steps.entries()) {
    const staticNext = step.getStaticNext();
    if (!staticNext) {
      continue;
    }

    if (!store.steps.has(staticNext)) {
      throw new WorkflowSchemaError(`Step ${stepId} references unknown next step ${staticNext}`);
    }

    adjacency.get(stepId)?.add(staticNext);
  }

  return adjacency;
};

const detectCycles = (adjacency: Map<string, Set<string>>) => {
  const visited = new Set<string>();
  const stack = new Set<string>();

  const visit = (node: string) => {
    if (stack.has(node)) {
      throw new WorkflowSchemaError(`Cycle detected involving step ${node}`);
    }

    if (visited.has(node)) {
      return;
    }

    stack.add(node);
    const neighbors = adjacency.get(node);
    if (neighbors) {
      for (const next of neighbors) {
        visit(next);
      }
    }
    stack.delete(node);
    visited.add(node);
  };

  for (const node of adjacency.keys()) {
    visit(node);
  }
};

class ConditionalWorkflowBuilder<
  Input,
  Output,
  Meta extends Record<string, unknown>,
> {
  constructor(
    private readonly parent: WorkflowBuilder<Input, unknown, Output, Meta>,
    private readonly conditionId: string,
  ) {}

  then(
    ...branches: [
      WorkflowStep<unknown, unknown, Meta, Input> | Record<string, WorkflowStep<unknown, unknown, Meta, Input>>,
      ...WorkflowStep<unknown, unknown, Meta, Input>[]
    ]
  ): WorkflowBuilder<Input, unknown, Output, Meta> {
    if (branches.length === 0) {
      throw new WorkflowSchemaError("Conditional builder requires at least one branch step");
    }

    const [first, ...rest] = branches;

    if (first instanceof WorkflowStep) {
      const steps = [first, ...rest];
      if (steps.length === 0) {
        throw new WorkflowSchemaError("Conditional builder requires at least one branch step");
      }

      const declarations = steps.map((step, index) => ({ id: index as BranchId, step }));
      return this.parent.registerBranches(this.conditionId, declarations);
    }

    if (rest.length > 0) {
      throw new WorkflowSchemaError("Object-based branch declaration accepts a single argument");
    }

    const entries = Object.entries(first);
    if (entries.length === 0) {
      throw new WorkflowSchemaError("Conditional builder requires at least one branch step");
    }

    const declarations = entries.map(([id, step]) => ({ id, step }));
    return this.parent.registerBranches(this.conditionId, declarations);
  }
}

export class WorkflowBuilder<
  Input,
  Current,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> {
  private readonly config: WorkflowConfig<Input, Output, Meta>;
  private readonly store: WorkflowBuilderStore<Meta, Input>;
  private readonly finalize?: (value: unknown) => Output;

  constructor(
    config: WorkflowConfig<Input, Output, Meta>,
    store: WorkflowBuilderStore<Meta, Input> = createEmptyStore(),
    finalize?: (value: unknown) => Output,
  ) {
    this.config = config;
    this.store = store;
    this.finalize = finalize ?? config.finalize;
  }

  private transition<Next>(): WorkflowBuilder<Input, Next, Output, Meta> {
    return new WorkflowBuilder<Input, Next, Output, Meta>(
      { ...this.config, finalize: undefined },
      this.store,
      this.finalize,
    );
  }

  private appendStep(step: WorkflowStep<unknown, unknown, Meta, Input>, options?: { condition?: boolean }) {
    if (this.store.steps.has(step.id)) {
      throw new WorkflowSchemaError(`Duplicate workflow step id ${step.id}`);
    }

    this.store.steps.set(step.id, step);
    this.store.sequence.push(step.id);

    if (!this.store.entryId) {
      this.store.entryId = step.id;
    }

    if (options?.condition) {
      this.store.conditionSteps.add(step.id);
    }
  }

  registerBranches(
    conditionId: string,
    declarations: BranchDeclaration<Meta, Input>[],
  ): WorkflowBuilder<Input, unknown, Output, Meta> {
    ensureBranchLookup(this.store, conditionId);

    const branchMap = new Map<BranchId, string>();
    for (const { id, step } of declarations) {
      if (branchMap.has(id)) {
        throw new WorkflowSchemaError(`Duplicate branch identifier ${String(id)} for condition ${conditionId}`);
      }

      this.appendStep(step);
      branchMap.set(id, step.id);
    }

    this.store.branchLookup.set(conditionId, branchMap);
    return this.transition<unknown>();
  }

  then<Next>(step: WorkflowStep<Current, Next, Meta, Input>) {
    this.appendStep(step as WorkflowStep<unknown, unknown, Meta, Input>);
    return this.transition<Next>();
  }

  conditions(step: WorkflowStep<Current, unknown, Meta, Input>) {
    this.appendStep(step as WorkflowStep<unknown, unknown, Meta, Input>, { condition: true });
    return new ConditionalWorkflowBuilder<Input, Output, Meta>(
      this as unknown as WorkflowBuilder<Input, unknown, Output, Meta>,
      step.id,
    );
  }

  commit(): Workflow<Input, Output, Meta> {
    if (!this.store.entryId) {
      throw new WorkflowSchemaError("Cannot commit a workflow without steps");
    }

    for (const conditionId of this.store.conditionSteps) {
      const branches = this.store.branchLookup.get(conditionId);
      if (!branches || branches.size === 0) {
        throw new WorkflowSchemaError(`Condition step ${conditionId} is missing branch declarations`);
      }
    }

    const adjacency = buildAdjacency(this.store);
    detectCycles(adjacency);

    const finalize = this.finalize ?? (value => value as Output);
    return new Workflow<Input, Output, Meta>(
      { ...this.config, finalize },
      {
        steps: this.store.steps,
        sequence: this.store.sequence,
        branchLookup: this.store.branchLookup,
        conditionSteps: this.store.conditionSteps,
        entryId: this.store.entryId,
      },
    );
  }
}

export const createWorkflow = <
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
>(config: WorkflowConfig<Input, Output, Meta>) =>
  new WorkflowBuilder<Input, Input, Output, Meta>(config);
