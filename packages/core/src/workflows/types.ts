import type { WorkflowStep } from "./steps/step.js";

export type SchemaLike<T> = {
  parse?: (data: unknown) => T;
  safeParse?: (data: unknown) => { success: true; data: T } | { success: false; error: unknown };
};

export type WorkflowStepLike<
  Meta extends Record<string, unknown>,
  RootInput,
  Ctx extends Record<string, unknown> | undefined,
> =
  | WorkflowStep<any, any, Meta, RootInput, Ctx>
  | WorkflowStep<any, any, Meta, any, Ctx>;

export type WorkflowStepInput<T extends WorkflowStep<any, any, any, any, any>> =
  T extends WorkflowStep<infer Input, any, any, any, any> ? Input : never;

export type WorkflowStepOutput<T extends WorkflowStep<any, any, any, any, any>> =
  T extends WorkflowStep<any, infer Output, any, any, any> ? Output : never;

export type WorkflowStepMeta<T extends WorkflowStep<any, any, any, any, any>> =
  T extends WorkflowStep<any, any, infer Meta, any, any> ? Meta : never;

export type WorkflowStepRootInput<T extends WorkflowStep<any, any, any, any, any>> =
  T extends WorkflowStep<any, any, any, infer RootInput, any> ? RootInput : never;

export type WorkflowCtxValue<Ctx> = Ctx extends undefined ? undefined : Readonly<Ctx>;

export type WorkflowCtxUpdater<Ctx> = Ctx extends undefined ? never : (current: Ctx) => Ctx;

export type WorkflowCtxInit<Ctx> = Ctx extends undefined ? undefined : Ctx;

export type WorkflowCtxRunInput<Ctx> = Ctx extends undefined ? undefined : Partial<Ctx> | Ctx;

export type WorkflowCtxInternal<Ctx> = Ctx extends undefined ? Record<string, unknown> : Ctx;

export interface WorkflowTelemetryOverrides {
  traceName?: string;
  metadata?: Record<string, unknown>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
  userId?: string;
}

export type WorkflowTelemetryOption =
  | boolean
  | WorkflowTelemetryOverrides;

export type AnyWorkflowStep<
  Meta extends Record<string, unknown>,
  RootInput,
  Ctx extends Record<string, unknown> | undefined,
> = WorkflowStep<any, any, Meta, RootInput, Ctx> | WorkflowStep<any, any, Meta, any, Ctx>;

export type WorkflowEventType =
  | "workflow:start"
  | "workflow:success"
  | "workflow:error"
  | "workflow:cancelled"
  | "step:start"
  | "step:success"
  | "step:error"
  | "step:event"
  | "step:branch"
  | "step:human:requested"
  | "step:human:completed";

export interface WorkflowEvent<Meta extends Record<string, unknown> = Record<string, unknown>> {
  type: WorkflowEventType;
  workflowId: string;
  runId: string;
  stepId?: string;
  timestamp: number;
  metadata: Meta;
  data?: unknown;
  parallelGroupId?: string;
  parallelBranchId?: string;
}

export type WorkflowWatcher<Meta extends Record<string, unknown> = Record<string, unknown>> = (
  event: WorkflowEvent<Meta>,
) => void;

export interface StepCustomEvent<Meta extends Record<string, unknown> = Record<string, unknown>> {
  type: string;
  data?: unknown;
  metadata?: Meta;
}

export interface WorkflowStepRuntimeContext<
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  readonly workflowId: string;
  readonly runId: string;
  readonly initialInput: RootInput;
  readonly store: Map<string, unknown>;
  getMetadata(): Meta;
  updateMetadata(updater: (current: Meta) => Meta): void;
  emit(event: StepCustomEvent<Meta>): void;
  getCtx(): WorkflowCtxValue<Ctx>;
  updateCtx(updater: WorkflowCtxUpdater<Ctx>): void;
}

/** @deprecated Use WorkflowStepRuntimeContext instead. */
export type WorkflowStepContext<
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> = WorkflowStepRuntimeContext<Meta, RootInput, Ctx>;

export interface StepHandlerArgs<
  Input,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  input: Input;
  ctx: WorkflowCtxValue<Ctx>;
  stepRuntime: WorkflowStepRuntimeContext<Meta, RootInput, Ctx>;
  /** @deprecated Use stepRuntime instead. */
  context: WorkflowStepRuntimeContext<Meta, RootInput, Ctx>;
  signal: AbortSignal;
}

export type StepHandler<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> = (args: StepHandlerArgs<Input, Meta, RootInput, Ctx>) => Promise<Output> | Output;

export interface WorkflowStepConfig<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<Output>;
  handler: StepHandler<Input, Output, Meta, RootInput, Ctx>;
  next?: string | NextResolver<Input, Output, Meta, RootInput, Ctx>;
  branchResolver?: BranchResolver<Input, Output, Meta, RootInput, Ctx>;
}

export interface WorkflowConfig<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<Output>;
  metadata?: Meta;
  finalize?: (value: unknown) => Output;
  telemetry?: WorkflowTelemetryOption;
  ctx?: WorkflowCtxInit<Ctx>;
}

export interface WorkflowStepSnapshot {
  status: "success" | "failed" | "waiting_human";
  input: unknown;
  output?: unknown;
  error?: unknown;
  startedAt: Date;
  finishedAt: Date;
  occurrence: number;
  branchId?: BranchId;
  nextStepId?: string;
  parallelGroupId?: string;
  parallelBranchId?: string;
}

export type WorkflowRunStatus = "success" | "failed" | "cancelled" | "waiting_human";

export interface WorkflowRunResult<
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  status: WorkflowRunStatus;
  result?: Output;
  error?: unknown;
  steps: Record<string, WorkflowStepSnapshot[]>;
  metadata: Meta;
  ctx: WorkflowCtxValue<Ctx>;
  startedAt: Date;
  finishedAt: Date;
  pendingHuman?: PendingHumanTask;
}

export interface WorkflowRunOptions<
  Input,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  inputData: Input;
  metadata?: Meta;
  ctx?: WorkflowCtxRunInput<Ctx>;
  signal?: AbortSignal;
  telemetry?: WorkflowTelemetryOption;
}

export type MaybePromise<T> = T | Promise<T>;

export type BranchId = string | number;

export type ParallelErrorStrategy = "fail-fast" | "wait-all";

export type ParallelAggregateFn<
  Input,
  BranchResults extends Record<string, unknown>,
  Aggregate,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> = (args: {
  input: Input;
  results: BranchResults;
  ctx: WorkflowCtxValue<Ctx>;
  stepRuntime: WorkflowStepRuntimeContext<Meta, RootInput, Ctx>;
  signal: AbortSignal;
}) => MaybePromise<Aggregate>;

export interface WorkflowParallelBranchGraph<
  Meta extends Record<string, unknown>,
  RootInput,
  Ctx extends Record<string, unknown> | undefined,
> {
  steps: Map<string, WorkflowStep<unknown, unknown, Meta, RootInput, Ctx>>;
  sequence: string[];
  branchLookup: Map<string, Map<BranchId, string>>;
  conditionSteps: Set<string>;
  entryId: string;
}

export interface WorkflowParallelGroupGraph<
  Meta extends Record<string, unknown>,
  RootInput,
  Ctx extends Record<string, unknown> | undefined,
> {
  id: string;
  branches: Map<string, WorkflowParallelBranchGraph<Meta, RootInput, Ctx>>;
  aggregate?: ParallelAggregateFn<
    unknown,
    Record<string, unknown>,
    unknown,
    Meta,
    RootInput,
    Ctx
  >;
  errorStrategy: ParallelErrorStrategy;
}

export interface WorkflowParallelLookupEntry {
  groupId: string;
  branchId: string;
}

export interface StepTransitionContext<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  input: Input;
  output: Output;
  context: WorkflowStepRuntimeContext<Meta, RootInput, Ctx>;
  ctx: WorkflowCtxValue<Ctx>;
}

export type NextResolver<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> = (
  args: StepTransitionContext<Input, Output, Meta, RootInput, Ctx>,
) => MaybePromise<string | undefined>;

export type BranchResolver<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> = (
  args: StepTransitionContext<Input, Output, Meta, RootInput, Ctx>,
) => MaybePromise<BranchId | undefined>;

export interface BranchDeclaration<
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  id: BranchId;
  step: WorkflowStep<unknown, unknown, Meta, RootInput, Ctx>;
}

export interface ConditionalSequence<
  Input,
  Current,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  condition: WorkflowStep<Input, Current, Meta, RootInput, Ctx>;
  branches: BranchDeclaration<Meta, RootInput, Ctx>[];
}

export type HumanFormField =
  | {
      id: string;
      label: string;
      type: "text";
      required?: boolean;
      placeholder?: string;
    }
  | {
      id: string;
      label: string;
      type: "select";
      options: string[];
      required?: boolean;
    };

export interface HumanFormDefinition {
  title?: string;
  description?: string;
  fields: HumanFormField[];
}

export interface HumanAskBuilders {
  text(field: {
    id: string;
    label: string;
    required?: boolean;
    placeholder?: string;
  }): Extract<HumanFormField, { type: "text" }>;
  select(field: {
    id: string;
    label: string;
    options: string[];
    required?: boolean;
  }): Extract<HumanFormField, { type: "select" }>;
  form(definition: HumanFormDefinition): HumanFormDefinition;
}

export interface HumanOutputResolverArgs<
  Input,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  current: Input;
  steps: Record<string, { input: unknown; output?: unknown }>;
  context: WorkflowStepRuntimeContext<Meta, RootInput, Ctx>;
  ctx: WorkflowCtxValue<Ctx>;
}

export type HumanOutputResolver<
  Input,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> = (args: HumanOutputResolverArgs<Input, Meta, RootInput, Ctx>) => MaybePromise<unknown>;

export type HumanInputBuilder<
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> = (args: {
  ask: HumanAskBuilders;
  context: WorkflowStepRuntimeContext<Meta, RootInput, Ctx>;
  ctx: WorkflowCtxValue<Ctx>;
}) => HumanFormDefinition;

export interface HumanStepConfig<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> extends Omit<
    WorkflowStepConfig<Input, Output, Meta, RootInput, Ctx>,
    "handler" | "branchResolver"
  > {
  output: HumanOutputResolver<Input, Meta, RootInput, Ctx>;
  input: HumanInputBuilder<Meta, RootInput, Ctx>;
  responseSchema?: SchemaLike<unknown>;
}

export interface PendingHumanTask {
  runId: string;
  stepId: string;
  workflowId: string;
  output: unknown;
  form: HumanFormDefinition;
  requestedAt: Date;
}

export interface WorkflowGraphNode {
  id: string;
  type: "step" | "condition";
  description?: string;
}

export interface WorkflowGraphEdge {
  from: string;
  to: string;
  kind: "sequence" | "branch" | "parallel";
  branchId?: BranchId;
}

export interface WorkflowGraphInspection {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  entryId: string | null;
}
