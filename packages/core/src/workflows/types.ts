export type SchemaLike<T> = {
  parse?: (data: unknown) => T;
  safeParse?: (data: unknown) => { success: true; data: T } | { success: false; error: unknown };
};

export type WorkflowEventType =
  | "workflow:start"
  | "workflow:success"
  | "workflow:error"
  | "workflow:cancelled"
  | "step:start"
  | "step:success"
  | "step:error"
  | "step:event";

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
  status: "success" | "failed";
  input: unknown;
  output?: unknown;
  error?: unknown;
  startedAt: Date;
  finishedAt: Date;
}

export type WorkflowRunStatus = "success" | "failed" | "cancelled";

export interface WorkflowRunResult<
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> {
  status: WorkflowRunStatus;
  result?: Output;
  error?: unknown;
  steps: Record<string, WorkflowStepSnapshot>;
  metadata: Meta;
  startedAt: Date;
  finishedAt: Date;
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
