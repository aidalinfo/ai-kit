/*
 * Lightweight workflow orchestration inspired by Mastra workflows.
 */

export type SchemaLike<T> = {
  parse?: (data: unknown) => T;
  safeParse?: (data: unknown) => { success: true; data: T } | { success: false; error: unknown };
};

const hasFunction = <T extends object, K extends keyof T>(value: T | undefined, key: K): value is T & Record<K, (...args: unknown[]) => unknown> => {
  return Boolean(value && typeof value[key] === "function");
};

const parseWithSchema = <T>(schema: SchemaLike<T> | undefined, value: unknown, context: string): T => {
  if (!schema) {
    return value as T;
  }

  if (hasFunction(schema, "safeParse")) {
    const result = schema.safeParse(value);
    if (result.success) {
      return result.data;
    }

    throw new WorkflowSchemaError(`Schema validation failed for ${context}`, result.error);
  }

  if (hasFunction(schema, "parse")) {
    return schema.parse(value);
  }

  throw new WorkflowSchemaError(
    `Schema validation failed for ${context}`,
    new Error("Schema must expose parse or safeParse"),
  );
};

export class WorkflowSchemaError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WorkflowSchemaError";
  }
}

export class WorkflowAbortError extends Error {
  constructor(message = "Workflow run aborted") {
    super(message);
    this.name = "WorkflowAbortError";
  }
}

export class WorkflowExecutionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WorkflowExecutionError";
  }
}

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

export class WorkflowStep<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> {
  readonly id: string;
  readonly description?: string;
  private readonly inputSchema?: SchemaLike<Input>;
  private readonly outputSchema?: SchemaLike<Output>;
  private readonly handler: StepHandler<Input, Output, Meta, RootInput>;

  constructor({ id, description, inputSchema, outputSchema, handler }: WorkflowStepConfig<Input, Output, Meta, RootInput>) {
    this.id = id;
    this.description = description;
    this.inputSchema = inputSchema;
    this.outputSchema = outputSchema;
    this.handler = handler;
  }

  async execute(
    args: StepHandlerArgs<unknown, Meta, RootInput>,
  ): Promise<{ input: Input; output: Output }> {
    const validatedInput = parseWithSchema(this.inputSchema, args.input, `step ${this.id} input`);
    const result = await this.handler({
      ...args,
      input: validatedInput,
    });
    const validatedOutput = parseWithSchema(this.outputSchema, result, `step ${this.id} output`);

    return {
      input: validatedInput,
      output: validatedOutput,
    };
  }

  clone(
    overrides: Partial<WorkflowStepConfig<Input, Output, Meta, RootInput>>,
  ) {
    return new WorkflowStep<Input, Output, Meta, RootInput>({
      id: overrides.id ?? this.id,
      description: overrides.description ?? this.description,
      inputSchema: overrides.inputSchema ?? this.inputSchema,
      outputSchema: overrides.outputSchema ?? this.outputSchema,
      handler: overrides.handler ?? this.handler,
    });
  }
}

export const createStep = <
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
>(config: WorkflowStepConfig<Input, Output, Meta, RootInput>) => new WorkflowStep(config);

export const cloneStep = <
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
>(
  step: WorkflowStep<Input, Output, Meta, RootInput>,
  overrides: Partial<WorkflowStepConfig<Input, Output, Meta, RootInput>>,
) => step.clone(overrides);

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
  private readonly inputSchema?: SchemaLike<Input>;
  private readonly outputSchema?: SchemaLike<Output>;
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

interface WorkflowRunInit<
  Input,
  Output,
  Meta extends Record<string, unknown>,
> {
  workflow: Workflow<Input, Output, Meta>;
  runId: string;
  steps: WorkflowStep<unknown, unknown, Meta, Input>[];
}

class WorkflowEventStream<Meta extends Record<string, unknown>> {
  private queue: WorkflowEvent<Meta>[] = [];
  private waiting: Array<(value: IteratorResult<WorkflowEvent<Meta>>) => void> = [];
  private done = false;

  push(event: WorkflowEvent<Meta>) {
    if (this.done) {
      return;
    }

    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      resolve?.({ value: event, done: false });
      return;
    }

    this.queue.push(event);
  }

  end() {
    if (this.done) {
      return;
    }

    this.done = true;

    while (this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      resolve?.({ value: undefined as never, done: true });
    }
  }

  iterator(): AsyncIterableIterator<WorkflowEvent<Meta>> {
    const self = this;

    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next(): Promise<IteratorResult<WorkflowEvent<Meta>>> {
        if (self.queue.length > 0) {
          const value = self.queue.shift()!;
          return Promise.resolve({ value, done: false });
        }

        if (self.done) {
          return Promise.resolve({ value: undefined as never, done: true });
        }

        return new Promise((resolve) => {
          self.waiting.push(resolve);
        });
      },
      return(): Promise<IteratorResult<WorkflowEvent<Meta>>> {
        self.end();
        return Promise.resolve({ value: undefined as never, done: true });
      },
    };
  }
}

export class WorkflowRun<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly workflowId: string;
  readonly runId: string;
  private readonly workflow: Workflow<Input, Output, Meta>;
  private readonly steps: WorkflowStep<unknown, unknown, Meta, Input>[];
  private readonly watchers = new Set<WorkflowWatcher<Meta>>();
  private readonly store = new Map<string, unknown>();
  private readonly controller = new AbortController();
  private executed = false;

  constructor({ workflow, runId, steps }: WorkflowRunInit<Input, Output, Meta>) {
    this.workflow = workflow;
    this.workflowId = workflow.id;
    this.runId = runId;
    this.steps = steps;
  }

  watch(watcher: WorkflowWatcher<Meta>) {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  cancel(reason?: unknown) {
    this.controller.abort(reason ?? new WorkflowAbortError());
  }

  async start(options: WorkflowRunOptions<Input, Meta>): Promise<WorkflowRunResult<Output, Meta>> {
    return this.execute(options, undefined);
  }

  async stream(options: WorkflowRunOptions<Input, Meta>) {
    const stream = new WorkflowEventStream<Meta>();
    const final = this.execute(options, event => stream.push(event)).finally(() => stream.end());

    return {
      stream: stream.iterator(),
      final,
      result: final,
    };
  }

  private async execute(
    { inputData, metadata, signal }: WorkflowRunOptions<Input, Meta>,
    emitStream: ((event: WorkflowEvent<Meta>) => void) | undefined,
  ): Promise<WorkflowRunResult<Output, Meta>> {
    if (this.executed) {
      throw new WorkflowExecutionError("Workflow run can only be executed once");
    }

    this.executed = true;

    if (signal?.aborted || this.controller.signal.aborted) {
      throw new WorkflowAbortError();
    }

    const composedSignal = mergeSignals(
      [this.controller.signal, ...(signal ? [signal] : [])],
    );

    const runtimeMetadata = cloneMetadata(metadata ?? this.workflow.getInitialMetadata());
    const stepsSnapshot: Record<string, WorkflowStepSnapshot> = {};
    const startedAt = new Date();

    const emit = (
      event: Omit<WorkflowEvent<Meta>, "timestamp" | "workflowId" | "runId" | "metadata"> & { metadata?: Meta },
    ) => {
      const payload: WorkflowEvent<Meta> = {
        type: event.type,
        data: event.data,
        stepId: event.stepId,
        workflowId: this.workflowId,
        runId: this.runId,
        timestamp: Date.now(),
        metadata: event.metadata ?? runtimeMetadata,
      };

      this.watchers.forEach(listener => listener(payload));
      emitStream?.(payload);
    };

    emit({ type: "workflow:start" });

    let current: unknown;

    try {
      current = this.workflow.validateInput(inputData);
    } catch (error) {
      const finishedAt = new Date();
      emit({ type: "workflow:error", data: error });
      return {
        status: "failed",
        error,
        steps: stepsSnapshot,
        metadata: runtimeMetadata,
        startedAt,
        finishedAt,
      };
    }

    const initialInput = current;

    for (const step of this.steps) {
      if (composedSignal.aborted) {
        const error = new WorkflowAbortError();
        const finishedAt = new Date();
        emit({ type: "workflow:cancelled", data: error });
        return {
          status: "cancelled",
          error,
          steps: stepsSnapshot,
          metadata: runtimeMetadata,
          startedAt,
          finishedAt,
        };
      }

      const started = new Date();
      emit({ type: "step:start", stepId: step.id });

      const context: WorkflowStepContext<Meta, Input> = {
        workflowId: this.workflowId,
        runId: this.runId,
        initialInput: initialInput as Input,
        store: this.store,
        getMetadata: () => runtimeMetadata,
        updateMetadata: (updater: (currentMeta: Meta) => Meta) => {
          const next = updater(runtimeMetadata);
          Object.assign(runtimeMetadata, next);
        },
        emit: (event: StepCustomEvent<Meta>) => {
          emit({
            type: "step:event",
            stepId: step.id,
            data: {
              name: event.type,
              payload: event.data,
            },
            metadata: event.metadata ?? runtimeMetadata,
          });
        },
      };

      try {
        const { input, output } = await step.execute({
          input: current,
          context,
          signal: composedSignal,
        });

        const finished = new Date();
        stepsSnapshot[step.id] = {
          status: "success",
          input,
          output,
          startedAt: started,
          finishedAt: finished,
        };

        emit({ type: "step:success", stepId: step.id, data: output });
        current = output;
      } catch (error) {
        const finished = new Date();
        stepsSnapshot[step.id] = {
          status: "failed",
          input: current,
          error,
          startedAt: started,
          finishedAt: finished,
        };

        emit({ type: "step:error", stepId: step.id, data: error });
        emit({ type: "workflow:error", data: error });
        return {
          status: "failed",
          error,
          steps: stepsSnapshot,
          metadata: runtimeMetadata,
          startedAt,
          finishedAt: finished,
        };
      }
    }

    if (composedSignal.aborted) {
      const error = new WorkflowAbortError();
      const finishedAt = new Date();
      emit({ type: "workflow:cancelled", data: error });
      return {
        status: "cancelled",
        error,
        steps: stepsSnapshot,
        metadata: runtimeMetadata,
        startedAt,
        finishedAt,
      };
    }

    try {
      const output = this.workflow.validateOutput(current);
      const finishedAt = new Date();
      emit({ type: "workflow:success", data: output });
      return {
        status: "success",
        result: output,
        steps: stepsSnapshot,
        metadata: runtimeMetadata,
        startedAt,
        finishedAt,
      };
    } catch (error) {
      const finishedAt = new Date();
      emit({ type: "workflow:error", data: error });
      return {
        status: "failed",
        error,
        steps: stepsSnapshot,
        metadata: runtimeMetadata,
        startedAt,
        finishedAt,
      };
    }
  }
}

const createRunId = () => `run_${Math.random().toString(36).slice(2, 10)}`;

const cloneMetadata = <Meta extends Record<string, unknown>>(metadata?: Meta): Meta => {
  if (metadata === undefined) {
    return {} as Meta;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(metadata);
  }

  return JSON.parse(JSON.stringify(metadata));
};

const mergeSignals = (signals: AbortSignal[]): AbortSignal => {
  if (signals.length === 0) {
    return new AbortController().signal;
  }

  if (signals.length === 1) {
    return signals[0];
  }

  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; handler: () => void }> = [];

  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  const cleanup = () => {
    for (const { signal, handler } of listeners) {
      signal.removeEventListener("abort", handler);
    }
    listeners.length = 0;
  };

  for (const signal of signals) {
    if (signal.aborted) {
      abort(signal.reason ?? new WorkflowAbortError());
      cleanup();
      break;
    }

    const handler = () => {
      abort(signal.reason ?? new WorkflowAbortError());
      cleanup();
    };

    signal.addEventListener("abort", handler, { once: true });
    listeners.push({ signal, handler });
  }

  controller.signal.addEventListener("abort", cleanup, { once: true });

  return controller.signal;
};

