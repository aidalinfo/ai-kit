import { WorkflowSchemaError } from "./errors.js";
import type {
  BranchId,
  HumanStepConfig,
  WorkflowConfig,
  WorkflowStepMeta,
  WorkflowStepInput,
  WorkflowStepOutput,
  WorkflowStepRootInput,
  ParallelErrorStrategy,
  ParallelAggregateFn,
  WorkflowParallelGroupGraph,
  WorkflowParallelBranchGraph,
  WorkflowParallelLookupEntry,
  SchemaLike,
} from "./types.js";
import { WorkflowStep } from "./steps/step.js";
import { ParallelWorkflowStep } from "./steps/parallelStep.js";
import { createHumanStep, HumanWorkflowStep } from "./steps/humanStep.js";
import {
  createWhileStep,
  type WhileStepCollectFn,
  type WhileStepConfig,
  type WhileStepOutput,
} from "./steps/whileStep.js";
import { Workflow } from "./workflow.js";

interface WorkflowBuilderOptions {
  allowParallel: boolean;
}

interface WorkflowBuilderStore<Meta extends Record<string, unknown>, Input, Ctx extends Record<string, unknown> | undefined> {
  steps: Map<string, WorkflowStep<any, any, Meta, any, Ctx>>;
  sequence: string[];
  branchLookup: Map<string, Map<BranchId, string>>;
  conditionSteps: Set<string>;
  entryId: string | null;
  parallelGroups: Map<string, WorkflowParallelGroupGraph<Meta, Input, Ctx>>;
  parallelLookup: Map<string, WorkflowParallelLookupEntry>;
}

interface ParallelGroupBuildResult<
  StepInput,
  Meta extends Record<string, unknown>,
  RootInput,
  Ctx extends Record<string, unknown> | undefined,
  Aggregate,
> {
  branches: Map<string, WorkflowParallelBranchGraph<Meta, RootInput, Ctx>>;
  aggregate?: ParallelAggregateFn<
    StepInput,
    Record<string, unknown>,
    Aggregate,
    Meta,
    RootInput,
    Ctx
  >;
  errorStrategy: ParallelErrorStrategy;
}

interface BranchParallelOptions<Input, Output> {
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<Output>;
}

const createEmptyStore = <Meta extends Record<string, unknown>, Input, Ctx extends Record<string, unknown> | undefined>(): WorkflowBuilderStore<Meta, Input, Ctx> => ({
  steps: new Map(),
  sequence: [],
  branchLookup: new Map(),
  conditionSteps: new Set(),
  entryId: null,
  parallelGroups: new Map(),
  parallelLookup: new Map(),
});

const ensureBranchLookup = <Meta extends Record<string, unknown>, Input, Ctx extends Record<string, unknown> | undefined>(
  store: WorkflowBuilderStore<Meta, Input, Ctx>,
  conditionId: string,
) => {
  if (store.branchLookup.has(conditionId)) {
    throw new WorkflowSchemaError(`Condition step ${conditionId} already has branches registered`);
  }
};

const buildAdjacency = <Meta extends Record<string, unknown>, Input, Ctx extends Record<string, unknown> | undefined>(
  store: WorkflowBuilderStore<Meta, Input, Ctx>,
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

  for (const [parallelId, group] of store.parallelGroups.entries()) {
    const parallelTargets = adjacency.get(parallelId);
    for (const [branchId, branch] of group.branches.entries()) {
      if (!branch.entryId) {
        throw new WorkflowSchemaError(`Parallel branch ${branchId} in ${parallelId} is missing an entry step`);
      }

      if (!branch.steps.has(branch.entryId)) {
        throw new WorkflowSchemaError(
          `Parallel branch ${branchId} in ${parallelId} references unknown entry step ${branch.entryId}`,
        );
      }

      parallelTargets?.add(branch.entryId);

      for (let index = 0; index < branch.sequence.length - 1; index += 1) {
        const current = branch.sequence[index];
        const next = branch.sequence[index + 1];
        adjacency.get(current)?.add(next);
      }

      for (const [conditionId, branchTargets] of branch.branchLookup.entries()) {
        const targets = adjacency.get(conditionId);
        if (!targets) {
          throw new WorkflowSchemaError(
            `Parallel branch ${branchId} in ${parallelId} references unknown condition step ${conditionId}`,
          );
        }

        for (const target of branchTargets.values()) {
          if (!branch.steps.has(target)) {
            throw new WorkflowSchemaError(
              `Parallel branch ${branchId} in ${parallelId} references unknown branch target ${target}`,
            );
          }

          targets.add(target);
        }
      }
    }
  }

  for (const [stepId, step] of store.steps.entries()) {
    const staticNext = step.getStaticNext();
    if (!staticNext) {
      continue;
    }

    const parallelInfo = store.parallelLookup.get(stepId);
    if (parallelInfo) {
      const group = store.parallelGroups.get(parallelInfo.groupId);
      const branch = group?.branches.get(parallelInfo.branchId);
      if (!branch || !branch.steps.has(staticNext)) {
        throw new WorkflowSchemaError(
          `Parallel branch ${parallelInfo.branchId} in ${parallelInfo.groupId} step ${stepId} references unknown next step ${staticNext}`,
        );
      }
    } else if (!store.steps.has(staticNext)) {
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
  Ctx extends Record<string, unknown> | undefined,
> {
  constructor(
    private readonly parent: WorkflowBuilder<Input, unknown, Output, Meta, Ctx>,
    private readonly conditionId: string,
  ) {}

  private normalizeStep(step: WorkflowStep<any, any, Meta, any, Ctx>) {
    return step as WorkflowStep<any, any, Meta, Input, Ctx>;
  }

  then(
    ...branches: [
      | WorkflowStep<any, any, Meta, any, Ctx>
        | Record<string, WorkflowStep<any, any, Meta, any, Ctx>>,
      ...Array<WorkflowStep<any, any, Meta, any, Ctx>>
    ]
  ): WorkflowBuilder<Input, unknown, Output, Meta, Ctx> {
    if (branches.length === 0) {
      throw new WorkflowSchemaError("Conditional builder requires at least one branch step");
    }

    const [first, ...rest] = branches;

    if (first instanceof WorkflowStep) {
      const steps = [first, ...rest];
      if (steps.length === 0) {
        throw new WorkflowSchemaError("Conditional builder requires at least one branch step");
      }

      const declarations = steps.map((step, index) => ({
        id: index as BranchId,
        step: this.normalizeStep(step),
      }));
      return this.parent.registerBranches(this.conditionId, declarations);
    }

    if (rest.length > 0) {
      throw new WorkflowSchemaError("Object-based branch declaration accepts a single argument");
    }

    const entries = Object.entries(first);
    if (entries.length === 0) {
      throw new WorkflowSchemaError("Conditional builder requires at least one branch step");
    }

    const declarations = entries.map(([id, step]) => ({
      id,
      step: this.normalizeStep(step),
    }));
    return this.parent.registerBranches(this.conditionId, declarations);
  }
}

class ParallelWorkflowBuilder<
  StepInput,
  Meta extends Record<string, unknown>,
  RootInput,
  Ctx extends Record<string, unknown> | undefined,
  Aggregate = Record<string, unknown>,
> {
  private readonly branches = new Map<string, WorkflowParallelBranchGraph<Meta, RootInput, Ctx>>();
  private readonly existingStepIds: Set<string>;
  private aggregateFn?: ParallelAggregateFn<
    StepInput,
    Record<string, unknown>,
    Aggregate,
    Meta,
    RootInput,
    Ctx
  >;
  private errorStrategy: ParallelErrorStrategy = "fail-fast";

  constructor(
    private readonly parallelId: string,
    existingStepIds: Set<string>,
  ) {
    this.existingStepIds = existingStepIds;
  }

  private ensureBranch(branchId: string) {
    if (this.branches.has(branchId)) {
      throw new WorkflowSchemaError(
        `Parallel group ${this.parallelId} already has a branch named ${branchId}`,
      );
    }
  }

  private cloneBranchGraph(
    store: WorkflowBuilderStore<Meta, RootInput, Ctx>,
    branchId: string,
  ): WorkflowParallelBranchGraph<Meta, RootInput, Ctx> {
    if (!store.entryId) {
      throw new WorkflowSchemaError(
        `Parallel branch ${branchId} in ${this.parallelId} requires at least one step`,
      );
    }

    for (const conditionId of store.conditionSteps) {
      const branches = store.branchLookup.get(conditionId);
      if (!branches || branches.size === 0) {
        throw new WorkflowSchemaError(
          `Parallel branch ${branchId} in ${this.parallelId} has a condition ${conditionId} without branches`,
        );
      }
    }

    if (store.parallelGroups.size > 0) {
      throw new WorkflowSchemaError("Nested branchParallel blocks are not supported yet");
    }

    const clonedBranchLookup = new Map<string, Map<BranchId, string>>();
    for (const [key, value] of store.branchLookup.entries()) {
      clonedBranchLookup.set(key, new Map(value));
    }

    const clonedSteps = new Map<string, WorkflowStep<any, any, Meta, any, Ctx>>();
    for (const [stepId, step] of store.steps.entries()) {
      clonedSteps.set(stepId, step);
    }

    return {
      steps: clonedSteps,
      sequence: [...store.sequence],
      branchLookup: clonedBranchLookup,
      conditionSteps: new Set(store.conditionSteps),
      entryId: store.entryId,
    };
  }

  branch(
    branchId: string,
    configure: (
      builder: WorkflowBuilder<RootInput, StepInput, unknown, Meta, Ctx>,
    ) => void | WorkflowBuilder<RootInput, any, unknown, Meta, Ctx>,
  ): this {
    this.ensureBranch(branchId);

    const branchStore = createEmptyStore<Meta, RootInput, Ctx>();
    const branchBuilder = new WorkflowBuilder<RootInput, StepInput, unknown, Meta, Ctx>(
      { id: `${this.parallelId}:${branchId}` },
      branchStore,
      value => value as unknown,
      { allowParallel: false },
    );

    const result = configure(branchBuilder);
    if (result instanceof WorkflowBuilder && result !== branchBuilder) {
      // no-op: builder mutations already captured in branchStore reference
    }

    const graph = this.cloneBranchGraph(branchStore, branchId);

    for (const stepId of graph.steps.keys()) {
      if (this.existingStepIds.has(stepId)) {
        throw new WorkflowSchemaError(
          `Duplicate workflow step id ${stepId} detected in parallel branch ${branchId}`,
        );
      }
      this.existingStepIds.add(stepId);
    }

    this.branches.set(branchId, graph);
    return this;
  }

  aggregate<NextAggregate>(
    aggregator: ParallelAggregateFn<
      StepInput,
      Record<string, unknown>,
      NextAggregate,
      Meta,
      RootInput,
      Ctx
    >,
  ): ParallelWorkflowBuilder<StepInput, Meta, RootInput, Ctx, NextAggregate> {
    this.aggregateFn = aggregator as unknown as ParallelAggregateFn<
      StepInput,
      Record<string, unknown>,
      Aggregate,
      Meta,
      RootInput,
      Ctx
    >;
    return this as unknown as ParallelWorkflowBuilder<
      StepInput,
      Meta,
      RootInput,
      Ctx,
      NextAggregate
    >;
  }

  onError(strategy: ParallelErrorStrategy): this {
    this.errorStrategy = strategy;
    return this;
  }

  build(): ParallelGroupBuildResult<StepInput, Meta, RootInput, Ctx, Aggregate> {
    if (this.branches.size === 0) {
      throw new WorkflowSchemaError(
        `Parallel group ${this.parallelId} requires at least one branch`,
      );
    }

    return {
      branches: this.branches,
      aggregate: this.aggregateFn as ParallelAggregateFn<
        StepInput,
        Record<string, unknown>,
        Aggregate,
        Meta,
        RootInput,
        Ctx
      >,
      errorStrategy: this.errorStrategy,
    };
  }
}

type CompatibleStep<
  Current,
  Meta extends Record<string, unknown>,
  RootInput,
  Ctx extends Record<string, unknown> | undefined,
> = WorkflowStep<Current, any, Meta, RootInput, Ctx> | WorkflowStep<Current, any, Meta, any, Ctx>;

export class WorkflowBuilder<
  Input,
  Current,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  private readonly config: WorkflowConfig<Input, Output, Meta, Ctx>;
  private readonly store: WorkflowBuilderStore<Meta, Input, Ctx>;
  private readonly finalize?: (value: unknown) => Output;
  private readonly options: WorkflowBuilderOptions;

  constructor(
    config: WorkflowConfig<Input, Output, Meta, Ctx>,
    store: WorkflowBuilderStore<Meta, Input, Ctx> = createEmptyStore<Meta, Input, Ctx>(),
    finalize?: (value: unknown) => Output,
    options: WorkflowBuilderOptions = { allowParallel: true },
  ) {
    this.config = config;
    this.store = store;
    this.finalize = finalize ?? config.finalize;
    this.options = options;
  }

  private transition<Next>(): WorkflowBuilder<Input, Next, Output, Meta, Ctx> {
    return new WorkflowBuilder<Input, Next, Output, Meta, Ctx>(
      { ...this.config, finalize: undefined },
      this.store,
      this.finalize,
      this.options,
    );
  }

  private appendStep(step: WorkflowStep<any, any, Meta, any, Ctx>, options?: { condition?: boolean }) {
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
    declarations: Array<{ id: BranchId; step: WorkflowStep<any, any, Meta, any, Ctx> }>,
  ): WorkflowBuilder<Input, unknown, Output, Meta, Ctx> {
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

  then<StepInput extends Current, Next>(
    step: WorkflowStep<StepInput, Next, Meta, Input, Ctx> | WorkflowStep<StepInput, Next, Meta, any, Ctx>,
  ) {
    this.appendStep(step);
    return this.transition<Next>();
  }

  human<Next>(
    stepOrConfig:
      | HumanWorkflowStep<Current, Next, Meta, Input, Ctx>
      | HumanStepConfig<Current, Next, Meta, Input, Ctx>,
  ) {
    const step =
      stepOrConfig instanceof HumanWorkflowStep
        ? stepOrConfig
        : createHumanStep<Current, Next, Meta, Input, Ctx>(stepOrConfig);

    this.appendStep(step as WorkflowStep<any, any, Meta, any, Ctx>);
    return this.transition<Next>();
  }

  while<
    LoopStep extends WorkflowStep<any, any, Meta, any, Ctx>,
    StepInput extends Current & WorkflowStepInput<LoopStep>,
    Collect extends WhileStepCollectFn<
      StepInput,
      WorkflowStepOutput<LoopStep>,
      any,
      WorkflowStepMeta<LoopStep>,
      WorkflowStepRootInput<LoopStep>,
      Ctx
    > | undefined = undefined,
    StepOutput = WhileStepOutput<WorkflowStepOutput<LoopStep>, Collect>,
  >(
    stepOrConfig:
      | WorkflowStep<StepInput, StepOutput, Meta, Input, Ctx>
      | WhileStepConfig<StepInput, LoopStep, Collect, Ctx>,
  ) {
    const step =
      stepOrConfig instanceof WorkflowStep
        ? stepOrConfig
        : createWhileStep<StepInput, LoopStep, Collect, Ctx>(stepOrConfig);

    this.appendStep(step as WorkflowStep<any, any, Meta, any, Ctx>);
    return this.transition<StepOutput>();
  }

  conditions<StepInput extends Current, StepOutput>(
    step:
      | WorkflowStep<StepInput, StepOutput, Meta, Input, Ctx>
      | WorkflowStep<StepInput, StepOutput, Meta, any, Ctx>,
  ) {
    this.appendStep(step, { condition: true });
    return new ConditionalWorkflowBuilder<Input, Output, Meta, Ctx>(
      this as unknown as WorkflowBuilder<Input, unknown, Output, Meta, Ctx>,
      step.id,
    );
  }

  branchParallel<
    StepInput extends Current,
    AggregateOutput = Record<string, unknown>,
  >(
    id: string,
    configure: (
      builder: ParallelWorkflowBuilder<StepInput, Meta, Input, Ctx, Record<string, unknown>>,
    ) => ParallelWorkflowBuilder<StepInput, Meta, Input, Ctx, AggregateOutput> | void,
    options: BranchParallelOptions<StepInput, AggregateOutput> = {},
  ): WorkflowBuilder<Input, AggregateOutput, Output, Meta, Ctx> {
    if (!this.options.allowParallel) {
      throw new WorkflowSchemaError("branchParallel cannot be used inside a parallel branch");
    }

    if (this.store.steps.has(id) || this.store.parallelGroups.has(id)) {
      throw new WorkflowSchemaError(`Duplicate workflow step id ${id}`);
    }

    const existingStepIds = new Set<string>([
      ...this.store.steps.keys(),
      ...this.store.parallelLookup.keys(),
    ]);

    const baseBuilder = new ParallelWorkflowBuilder<StepInput, Meta, Input, Ctx, Record<string, unknown>>(
      id,
      existingStepIds,
    );

    const configuredBuilder = (configure(baseBuilder) ?? baseBuilder) as ParallelWorkflowBuilder<
      StepInput,
      Meta,
      Input,
      Ctx,
      AggregateOutput
    >;

    const { branches, aggregate, errorStrategy } = configuredBuilder.build();

    for (const [branchId, branch] of branches.entries()) {
      for (const [stepId, step] of branch.steps.entries()) {
        if (this.store.steps.has(stepId)) {
          throw new WorkflowSchemaError(`Duplicate workflow step id ${stepId}`);
        }

        this.store.steps.set(stepId, step as WorkflowStep<any, any, Meta, any, Ctx>);
        this.store.parallelLookup.set(stepId, { groupId: id, branchId });
      }
    }

    this.store.parallelGroups.set(id, {
      id,
      branches,
      aggregate: aggregate as ParallelAggregateFn<
        unknown,
        Record<string, unknown>,
        unknown,
        Meta,
        Input,
        Ctx
      >,
      errorStrategy,
    });

    const parallelStep = new ParallelWorkflowStep<StepInput, AggregateOutput, Meta, Input, Ctx>({
      id,
      description: options.description,
      inputSchema: options.inputSchema,
      outputSchema: options.outputSchema,
      branches,
      aggregate,
      errorStrategy,
    });

    this.appendStep(parallelStep as WorkflowStep<any, any, Meta, any, Ctx>);
    return this.transition<AggregateOutput>();
  }

  commit(): Workflow<Input, Output, Meta, Ctx> {
    if (!this.store.entryId) {
      throw new WorkflowSchemaError("Cannot commit a workflow without steps");
    }

    for (const conditionId of this.store.conditionSteps) {
      const branches = this.store.branchLookup.get(conditionId);
      if (!branches || branches.size === 0) {
        throw new WorkflowSchemaError(`Condition step ${conditionId} is missing branch declarations`);
      }
    }

    for (const [parallelId, group] of this.store.parallelGroups.entries()) {
      if (!this.store.steps.has(parallelId)) {
        throw new WorkflowSchemaError(`Parallel group ${parallelId} is missing its synthetic step`);
      }

      if (group.branches.size === 0) {
        throw new WorkflowSchemaError(`Parallel group ${parallelId} requires at least one branch`);
      }

      for (const [branchId, branch] of group.branches.entries()) {
        if (!branch.entryId) {
          throw new WorkflowSchemaError(
            `Parallel branch ${branchId} in ${parallelId} is missing an entry step`,
          );
        }

        if (!branch.steps.has(branch.entryId)) {
          throw new WorkflowSchemaError(
            `Parallel branch ${branchId} in ${parallelId} references unknown entry step ${branch.entryId}`,
          );
        }
      }
    }

    const adjacency = buildAdjacency(this.store);
    detectCycles(adjacency);

    const finalize = this.finalize ?? (value => value as Output);
    return new Workflow<Input, Output, Meta, Ctx>(
      { ...this.config, finalize },
      {
        steps: this.store.steps,
        sequence: this.store.sequence,
        branchLookup: this.store.branchLookup,
        conditionSteps: this.store.conditionSteps,
        entryId: this.store.entryId,
        parallelGroups: this.store.parallelGroups,
        parallelLookup: this.store.parallelLookup,
      },
    );
  }
}

export const createWorkflow = <
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined = undefined,
>(config: WorkflowConfig<Input, Output, Meta, Ctx>) =>
  new WorkflowBuilder<Input, Input, Output, Meta, Ctx>(config);
