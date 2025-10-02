import { WorkflowAbortError, WorkflowExecutionError } from "./errors.js";
import type {
  StepCustomEvent,
  WorkflowEvent,
  WorkflowRunOptions,
  WorkflowRunResult,
  WorkflowStepContext,
  WorkflowStepSnapshot,
  WorkflowWatcher,
} from "./types.js";
import { cloneMetadata, mergeSignals } from "./utils/runtime.js";
import { WorkflowStep } from "./steps/step.js";
import type { Workflow } from "./workflow.js";

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
