import {
  WorkflowAbortError,
  WorkflowBranchResolutionError,
  WorkflowExecutionError,
  WorkflowResumeError,
} from "./errors.js";
import type {
  StepCustomEvent,
  StepHandlerArgs,
  BranchId,
  WorkflowEvent,
  WorkflowRunOptions,
  WorkflowRunResult,
  WorkflowStepContext,
  WorkflowStepSnapshot,
  WorkflowWatcher,
  PendingHumanTask,
  HumanFormDefinition,
} from "./types.js";
import { cloneMetadata, mergeSignals } from "./utils/runtime.js";
import type { Workflow } from "./workflow.js";
import { HumanWorkflowStep, HUMAN_HISTORY_STORE_KEY } from "./steps/humanStep.js";

interface WorkflowRunInit<
  Input,
  Output,
  Meta extends Record<string, unknown>,
> {
  workflow: Workflow<Input, Output, Meta>;
  runId: string;
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

interface PendingHumanState<
  Input,
  Output,
  Meta extends Record<string, unknown>,
  RootInput,
> {
  step: HumanWorkflowStep<Input, Output, Meta, RootInput>;
  stepId: string;
  requestedAt: Date;
  form: HumanFormDefinition;
  payload: unknown;
  context: WorkflowStepContext<Meta, RootInput>;
  input: Input;
  snapshotIndex: number;
  occurrence: number;
}

export class WorkflowRun<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly workflowId: string;
  readonly runId: string;
  private readonly workflow: Workflow<Input, Output, Meta>;
  private readonly graph: ReturnType<Workflow<Input, Output, Meta>["getGraph"]>;
  private readonly defaultNext = new Map<string, string | undefined>();
  private readonly branchMembers = new Map<string, Set<string>>();
  private readonly sequenceIndex = new Map<string, number>();
  private readonly branchOwners = new Map<string, string>();
  private readonly watchers = new Set<WorkflowWatcher<Meta>>();
  private readonly store = new Map<string, unknown>();
  private readonly history = new Map<string, { input: unknown; output?: unknown }>();
  private readonly controller = new AbortController();
  private executed = false;
  private emitStream?: (event: WorkflowEvent<Meta>) => void;
  private eventStream?: WorkflowEventStream<Meta>;
  private runtimeMetadata!: Meta;
  private stepsSnapshot!: Record<string, WorkflowStepSnapshot[]>;
  private stepOccurrences!: Map<string, number>;
  private startedAt!: Date;
  private initialInput!: Input;
  private current: unknown;
  private currentStepId?: string;
  private composedSignal!: AbortSignal;
  private pendingHuman?: PendingHumanState<any, any, Meta, Input>;
  private finishedAt?: Date;

  constructor({ workflow, runId }: WorkflowRunInit<Input, Output, Meta>) {
    this.workflow = workflow;
    this.workflowId = workflow.id;
    this.runId = runId;
    this.graph = workflow.getGraph();

    for (let index = 0; index < this.graph.sequence.length; index += 1) {
      const current = this.graph.sequence[index];
      this.sequenceIndex.set(current, index);

      if (index < this.graph.sequence.length - 1) {
        const next = this.graph.sequence[index + 1];
        this.defaultNext.set(current, next);
      }
    }

    for (const [conditionId, branches] of this.graph.branchLookup.entries()) {
      const members = new Set<string>();
      for (const target of branches.values()) {
        members.add(target);
        this.branchOwners.set(target, conditionId);
      }
      this.branchMembers.set(conditionId, members);
    }
  }

  private emit(
    event: Omit<WorkflowEvent<Meta>, "timestamp" | "workflowId" | "runId" | "metadata"> & { metadata?: Meta },
  ) {
    const payload: WorkflowEvent<Meta> = {
      type: event.type,
      data: event.data,
      stepId: event.stepId,
      workflowId: this.workflowId,
      runId: this.runId,
      timestamp: Date.now(),
      metadata: event.metadata ?? this.runtimeMetadata,
    };

    this.watchers.forEach(listener => listener(payload));
    this.emitStream?.(payload);
  }

  private findPostConditionalNext(stepId: string): string | undefined {
    const members = this.branchMembers.get(stepId);
    if (!members) {
      return this.defaultNext.get(stepId);
    }

    const index = this.sequenceIndex.get(stepId);
    if (index === undefined) {
      return undefined;
    }

    for (let cursor = index + 1; cursor < this.graph.sequence.length; cursor += 1) {
      const candidate = this.graph.sequence[cursor];
      if (!members.has(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private resolveDefaultNext(stepId: string, branchResolved: boolean): string | undefined {
    if (!branchResolved && this.branchMembers.has(stepId)) {
      return this.findPostConditionalNext(stepId);
    }

    const owner = this.branchOwners.get(stepId);
    if (owner) {
      return this.findPostConditionalNext(owner);
    }

    return this.defaultNext.get(stepId);
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
    this.eventStream = stream;

    const final = this.execute(options, event => stream.push(event)).then(
      result => {
        if (result.status !== "waiting_human") {
          stream.end();
          this.eventStream = undefined;
        }
        return result;
      },
      error => {
        stream.end();
        this.eventStream = undefined;
        throw error;
      },
    );

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
    this.emitStream = emitStream;

    if (signal?.aborted || this.controller.signal.aborted) {
      throw new WorkflowAbortError();
    }

    this.composedSignal = mergeSignals(
      [this.controller.signal, ...(signal ? [signal] : [])],
    );

    this.runtimeMetadata = cloneMetadata(metadata ?? this.workflow.getInitialMetadata());
    this.stepsSnapshot = {};
    this.stepOccurrences = new Map();
    this.startedAt = new Date();
    this.finishedAt = undefined;
    this.pendingHuman = undefined;
    this.history.clear();
    this.store.set(HUMAN_HISTORY_STORE_KEY, this.history);

    try {
      this.current = this.workflow.validateInput(inputData);
    } catch (error) {
      this.emit({ type: "workflow:error", data: error });
      const finishedAt = new Date();
      return {
        status: "failed",
        error,
        steps: this.stepsSnapshot,
        metadata: this.runtimeMetadata,
        startedAt: this.startedAt,
        finishedAt,
      };
    }

    this.initialInput = this.current as Input;
    this.currentStepId = this.graph.entryId;

    this.emit({ type: "workflow:start" });

    return this.runLoop();
  }

  private async handleHumanStep(
    step: HumanWorkflowStep<any, any, Meta, Input>,
    context: WorkflowStepContext<Meta, Input>,
    started: Date,
  ): Promise<WorkflowRunResult<Output, Meta>> {
    if (!this.stepsSnapshot) {
      throw new WorkflowExecutionError("Workflow run is not initialized");
    }

    const args = {
      input: this.current,
      context,
      signal: this.composedSignal,
    } as StepHandlerArgs<unknown, Meta, Input>;

    const { input, form, payload } = await step.buildHumanRequest(args);

    const occurrence = (this.stepOccurrences.get(step.id) ?? 0) + 1;
    this.stepOccurrences.set(step.id, occurrence);

    this.stepsSnapshot[step.id] ??= [];
    const snapshotIndex = this.stepsSnapshot[step.id].push({
      status: "waiting_human",
      input,
      startedAt: started,
      finishedAt: started,
      occurrence,
      nextStepId: undefined,
    }) - 1;

    this.currentStepId = step.id;
    this.current = input;

    const pending: PendingHumanTask = {
      runId: this.runId,
      stepId: step.id,
      workflowId: this.workflowId,
      output: payload,
      form,
      requestedAt: started,
    };

    this.pendingHuman = {
      step,
      stepId: step.id,
      requestedAt: started,
      form,
      payload,
      context,
      input,
      snapshotIndex,
      occurrence,
    };

    this.emit({
      type: "step:human:requested",
      stepId: step.id,
      data: pending,
    });

    this.finishedAt = new Date();

    return {
      status: "waiting_human",
      steps: this.stepsSnapshot,
      metadata: this.runtimeMetadata,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      pendingHuman: pending,
    };
  }

  private async runLoop(): Promise<WorkflowRunResult<Output, Meta>> {
    while (this.currentStepId) {
      const stepId = this.currentStepId;
      const step = this.graph.steps.get(stepId);
      if (!step) {
        const error = new WorkflowExecutionError(`Unknown step ${stepId}`);
        this.emit({ type: "workflow:error", data: error });
        const finishedAt = new Date();
        return {
          status: "failed",
          error,
          steps: this.stepsSnapshot,
          metadata: this.runtimeMetadata,
          startedAt: this.startedAt,
          finishedAt,
        };
      }

      if (this.composedSignal.aborted) {
        const error = new WorkflowAbortError();
        const finishedAt = new Date();
        this.emit({ type: "workflow:cancelled", data: error });
        return {
          status: "cancelled",
          error,
          steps: this.stepsSnapshot,
          metadata: this.runtimeMetadata,
          startedAt: this.startedAt,
          finishedAt,
        };
      }

      const started = new Date();
      this.emit({ type: "step:start", stepId });

      const context: WorkflowStepContext<Meta, Input> = {
        workflowId: this.workflowId,
        runId: this.runId,
        initialInput: this.initialInput,
        store: this.store,
        getMetadata: () => this.runtimeMetadata,
        updateMetadata: (updater: (currentMeta: Meta) => Meta) => {
          const next = updater(this.runtimeMetadata);
          Object.assign(this.runtimeMetadata, next);
        },
        emit: (event: StepCustomEvent<Meta>) => {
          this.emit({
            type: "step:event",
            stepId,
            data: {
              name: event.type,
              payload: event.data,
            },
            metadata: event.metadata ?? this.runtimeMetadata,
          });
        },
      };

      if (step instanceof HumanWorkflowStep) {
        return this.handleHumanStep(step, context, started);
      }

      try {
        const { input, output } = await step.execute({
          input: this.current,
          context,
          signal: this.composedSignal,
        });

        const finished = new Date();
        const occurrence = (this.stepOccurrences.get(step.id) ?? 0) + 1;
        this.stepOccurrences.set(step.id, occurrence);

        const transitionContext = { input, output, context };

        const resolvedBranchId = await step.resolveBranch(transitionContext);
        let branchId: BranchId | undefined;
        let branchNext: string | undefined;

        if (resolvedBranchId !== undefined) {
          branchId = resolvedBranchId;
          const branches = this.graph.branchLookup.get(step.id);
          if (!branches) {
            throw new WorkflowBranchResolutionError(`No branches configured for step ${step.id}`);
          }

          branchNext = branches.get(branchId);
          if (!branchNext) {
            throw new WorkflowBranchResolutionError(
              `Unknown branch ${String(branchId)} for step ${step.id}`,
            );
          }

          this.emit({
            type: "step:branch",
            stepId: step.id,
            data: {
              branchId,
              nextStepId: branchNext,
              conditionStepId: step.id,
            },
          });
        }

        const resolvedNext = await step.resolveNext(transitionContext);
        if (resolvedNext && !this.graph.steps.has(resolvedNext)) {
          throw new WorkflowExecutionError(
            `Step ${step.id} resolved next to unknown step ${resolvedNext}`,
          );
        }

        const nextStepId = branchNext ?? resolvedNext ?? this.resolveDefaultNext(step.id, branchId !== undefined);

        this.stepsSnapshot[step.id] ??= [];
        this.stepsSnapshot[step.id].push({
          status: "success",
          input,
          output,
          startedAt: started,
          finishedAt: finished,
          occurrence,
          branchId,
          nextStepId,
        });

        this.history.set(step.id, { input, output });

        this.emit({ type: "step:success", stepId: step.id, data: output });
        this.current = output;
        this.currentStepId = nextStepId;
      } catch (error) {
        const finished = new Date();
        const occurrence = (this.stepOccurrences.get(step.id) ?? 0) + 1;
        this.stepOccurrences.set(step.id, occurrence);

        this.stepsSnapshot[step.id] ??= [];
        this.stepsSnapshot[step.id].push({
          status: "failed",
          input: this.current,
          error,
          startedAt: started,
          finishedAt: finished,
          occurrence,
          nextStepId: undefined,
        });

        this.emit({ type: "step:error", stepId: step.id, data: error });
        this.emit({ type: "workflow:error", data: error });
        return {
          status: "failed",
          error,
          steps: this.stepsSnapshot,
          metadata: this.runtimeMetadata,
          startedAt: this.startedAt,
          finishedAt: finished,
        };
      }
    }

    if (this.composedSignal.aborted) {
      const error = new WorkflowAbortError();
      const finishedAt = new Date();
      this.emit({ type: "workflow:cancelled", data: error });
      return {
        status: "cancelled",
        error,
        steps: this.stepsSnapshot,
        metadata: this.runtimeMetadata,
        startedAt: this.startedAt,
        finishedAt,
      };
    }

    try {
      const output = this.workflow.validateOutput(this.current);
      const finishedAt = new Date();
      this.emit({ type: "workflow:success", data: output });
      this.finishedAt = finishedAt;
      return {
        status: "success",
        result: output,
        steps: this.stepsSnapshot,
        metadata: this.runtimeMetadata,
        startedAt: this.startedAt,
        finishedAt,
      };
    } catch (error) {
      const finishedAt = new Date();
      this.emit({ type: "workflow:error", data: error });
      this.finishedAt = finishedAt;
      return {
        status: "failed",
        error,
        steps: this.stepsSnapshot,
        metadata: this.runtimeMetadata,
        startedAt: this.startedAt,
        finishedAt,
      };
    }
  }

  async resumeWithHumanInput(args: { runId?: string; stepId: string; data: unknown }): Promise<WorkflowRunResult<Output, Meta>> {
    if (!this.executed) {
      throw new WorkflowResumeError("Workflow run has not been started");
    }

    if (!this.pendingHuman) {
      throw new WorkflowResumeError("No human interaction is pending for this run");
    }

    if (args.runId && args.runId !== this.runId) {
      throw new WorkflowResumeError(`Cannot resume run ${args.runId} with id ${this.runId}`);
    }

    if (this.pendingHuman.stepId !== args.stepId) {
      throw new WorkflowResumeError(
        `Pending human interaction is for step ${this.pendingHuman.stepId}, received ${args.stepId}`,
      );
    }

    const { step, input, context, snapshotIndex, occurrence } = this.pendingHuman;
    const response = step.parseResponse(args.data);

    const finished = new Date();

    const snapshots = this.stepsSnapshot[step.id];
    if (snapshots && snapshots[snapshotIndex]) {
      snapshots[snapshotIndex] = {
        status: "success",
        input,
        output: response,
        startedAt: snapshots[snapshotIndex].startedAt,
        finishedAt: finished,
        occurrence,
        nextStepId: undefined,
      };
    }

    this.history.set(step.id, { input, output: response });

    const transitionContext = { input, output: response, context };

    const resolvedNext = await step.resolveNext(transitionContext);
    if (resolvedNext && !this.graph.steps.has(resolvedNext)) {
      throw new WorkflowExecutionError(`Step ${step.id} resolved next to unknown step ${resolvedNext}`);
    }

    const nextStepId = resolvedNext ?? this.resolveDefaultNext(step.id, false);

    if (snapshots && snapshots[snapshotIndex]) {
      snapshots[snapshotIndex] = {
        ...snapshots[snapshotIndex],
        nextStepId,
      };
    }

    this.emit({
      type: "step:human:completed",
      stepId: step.id,
      data: {
        response,
        nextStepId,
      },
    });

    this.emit({ type: "step:success", stepId: step.id, data: response });

    this.current = response;
    this.currentStepId = nextStepId;
    this.pendingHuman = undefined;

    const result = await this.runLoop();
    if (result.status !== "waiting_human") {
      this.eventStream?.end();
      this.eventStream = undefined;
    }

    return result;
  }
}
