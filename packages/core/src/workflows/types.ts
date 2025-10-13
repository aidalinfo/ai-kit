import type { WorkflowStep } from "./steps/step.js";

export type SchemaLike<T> = {
  parse?: (data: unknown) => T;
  safeParse?: (data: unknown) => { success: true; data: T } | { success: false; error: unknown };
};

export type WorkflowStepLike<
  Meta extends Record<string, unknown>,
  RootInput,
> = WorkflowStep<any, any, Meta, RootInput> | WorkflowStep<any, any, Meta, any>;

export type WorkflowStepInput<T extends WorkflowStep<any, any, any, any>> =
  T extends WorkflowStep<infer Input, any, any, any> ? Input : never;

export type WorkflowStepOutput<T extends WorkflowStep<any, any, any, any>> =
  T extends WorkflowStep<any, infer Output, any, any> ? Output : never;

export type WorkflowStepMeta<T extends WorkflowStep<any, any, any, any>> =
  T extends WorkflowStep<any, any, infer Meta, any> ? Meta : never;

export type WorkflowStepRootInput<T extends WorkflowStep<any, any, any, any>> =
  T extends WorkflowStep<any, any, any, infer RootInput> ? RootInput : never;

export type AnyWorkflowStep<
  Meta extends Record<string, unknown>,
  RootInput,
> = WorkflowStep<any, any, Meta, RootInput> | WorkflowStep<any, any, Meta, any>;

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
}

export type WorkflowWatcher<Meta extends Record<string, unknown> = Record<string, unknown>> = (
  event: WorkflowEvent<Meta>,
) => void;

export interface StepCustomEvent<Meta extends Record<string, unknown> = Record<string, unknown>> {
  type: string;
  data?: unknown;
  metadata?: Meta;
}

export interface WorkflowStepContext<
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> {
  readonly workflowId: string;
  readonly runId: string;
  readonly initialInput: RootInput;
  readonly store: Map<string, unknown>;
  getMetadata(): Meta;
  updateMetadata(updater: (current: Meta) => Meta): void;
  emit(event: StepCustomEvent<Meta>): void;
}

export interface StepHandlerArgs<
  Input,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> {
  input: Input;
  context: WorkflowStepContext<Meta, RootInput>;
  signal: AbortSignal;
}

export type StepHandler<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> = (args: StepHandlerArgs<Input, Meta, RootInput>) => Promise<Output> | Output;

export interface WorkflowStepConfig<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<Output>;
  handler: StepHandler<Input, Output, Meta, RootInput>;
  next?: string | NextResolver<Input, Output, Meta, RootInput>;
  branchResolver?: BranchResolver<Input, Output, Meta, RootInput>;
}

export interface WorkflowConfig<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<Output>;
  metadata?: Meta;
  finalize?: (value: unknown) => Output;
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
}

export type WorkflowRunStatus = "success" | "failed" | "cancelled" | "waiting_human";

export interface WorkflowRunResult<
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> {
  status: WorkflowRunStatus;
  result?: Output;
  error?: unknown;
  steps: Record<string, WorkflowStepSnapshot[]>;
  metadata: Meta;
  startedAt: Date;
  finishedAt: Date;
  pendingHuman?: PendingHumanTask;
}

export interface WorkflowRunOptions<
  Input,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> {
  inputData: Input;
  metadata?: Meta;
  signal?: AbortSignal;
}

export type MaybePromise<T> = T | Promise<T>;

export type BranchId = string | number;

export interface StepTransitionContext<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> {
  input: Input;
  output: Output;
  context: WorkflowStepContext<Meta, RootInput>;
}

export type NextResolver<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> = (args: StepTransitionContext<Input, Output, Meta, RootInput>) => MaybePromise<string | undefined>;

export type BranchResolver<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> = (args: StepTransitionContext<Input, Output, Meta, RootInput>) => MaybePromise<BranchId | undefined>;

export interface BranchDeclaration<
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> {
  id: BranchId;
  step: WorkflowStep<unknown, unknown, Meta, RootInput>;
}

export interface ConditionalSequence<
  Input,
  Current,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> {
  condition: WorkflowStep<Input, Current, Meta, RootInput>;
  branches: BranchDeclaration<Meta, RootInput>[];
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
> {
  current: Input;
  steps: Record<string, { input: unknown; output?: unknown }>;
  context: WorkflowStepContext<Meta, RootInput>;
}

export type HumanOutputResolver<
  Input,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> = (args: HumanOutputResolverArgs<Input, Meta, RootInput>) => MaybePromise<unknown>;

export type HumanInputBuilder<
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> = (args: { ask: HumanAskBuilders; context: WorkflowStepContext<Meta, RootInput> }) => HumanFormDefinition;

export interface HumanStepConfig<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> extends Omit<WorkflowStepConfig<Input, Output, Meta, RootInput>, "handler" | "branchResolver"> {
  output: HumanOutputResolver<Input, Meta, RootInput>;
  input: HumanInputBuilder<Meta, RootInput>;
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
  kind: "sequence" | "branch";
  branchId?: BranchId;
}

export interface WorkflowGraphInspection {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  entryId: string | null;
}
