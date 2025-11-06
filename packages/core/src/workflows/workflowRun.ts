import {
  WorkflowAbortError,
  WorkflowBranchResolutionError,
  WorkflowExecutionError,
  WorkflowResumeError,
} from "./errors.js";
import type {
  StepCustomEvent,
  StepHandlerArgs,
  StepTransitionContext,
  BranchId,
  WorkflowEvent,
  WorkflowRunOptions,
  WorkflowRunResult,
  WorkflowStepRuntimeContext,
  WorkflowStepSnapshot,
  WorkflowWatcher,
  PendingHumanTask,
  HumanFormDefinition,
  WorkflowTelemetryOption,
  WorkflowTelemetryOverrides,
  WorkflowCtxInit,
  WorkflowCtxRunInput,
  WorkflowCtxValue,
  WorkflowCtxUpdater,
  WorkflowParallelGroupGraph,
  WorkflowParallelLookupEntry,
  ParallelAggregateFn,
  WorkflowParallelBranchGraph,
} from "./types.js";
import { cloneMetadata, mergeSignals } from "./utils/runtime.js";
import type { Workflow } from "./workflow.js";
import { HumanWorkflowStep, HUMAN_HISTORY_STORE_KEY } from "./steps/humanStep.js";
import {
  WorkflowRunTelemetry,
  resolveWorkflowTelemetryConfig,
  type StepTelemetryHandle,
} from "./telemetry.js";
import { ParallelWorkflowStep } from "./steps/parallelStep.js";
import { WorkflowStep } from "./steps/step.js";

interface WorkflowRunInit<
  Input,
  Output,
  Meta extends Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined,
> {
  workflow: Workflow<Input, Output, Meta, Ctx>;
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
  Ctx extends Record<string, unknown> | undefined,
> {
  step: HumanWorkflowStep<Input, Output, Meta, RootInput, Ctx>;
  stepId: string;
  requestedAt: Date;
  form: HumanFormDefinition;
  payload: unknown;
  context: WorkflowStepRuntimeContext<Meta, RootInput, Ctx>;
  input: Input;
  snapshotIndex: number;
  occurrence: number;
  telemetry?: StepTelemetryHandle;
}

export class WorkflowRun<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  readonly workflowId: string;
  readonly runId: string;
  private readonly workflow: Workflow<Input, Output, Meta, Ctx>;
  private readonly graph: ReturnType<Workflow<Input, Output, Meta, Ctx>["getGraph"]>;
  private readonly defaultNext = new Map<string, string | undefined>();
  private readonly branchMembers = new Map<string, Set<string>>();
  private readonly sequenceIndex = new Map<string, number>();
  private readonly branchOwners = new Map<string, string>();
  private readonly parallelGroups = new Map<string, WorkflowParallelGroupGraph<Meta, Input, Ctx>>();
  private readonly parallelLookup = new Map<string, WorkflowParallelLookupEntry>();
  private readonly parallelBranchNavigation = new Map<
    string,
    {
      defaultNext: Map<string, string | undefined>;
      branchMembers: Map<string, Set<string>>;
      sequenceIndex: Map<string, number>;
      branchOwners: Map<string, string>;
      sequence: string[];
    }
  >();
  private readonly watchers = new Set<WorkflowWatcher<Meta>>();
  private readonly store = new Map<string, unknown>();
  private readonly history = new Map<string, { input: unknown; output?: unknown }>();
  private readonly controller = new AbortController();
  private executed = false;
  private emitStream?: (event: WorkflowEvent<Meta>) => void;
  private eventStream?: WorkflowEventStream<Meta>;
  private runtimeMetadata!: Meta;
  private runtimeCtx!: Ctx;
  private frozenCtx!: WorkflowCtxValue<Ctx>;
  private stepsSnapshot!: Record<string, WorkflowStepSnapshot[]>;
  private stepOccurrences!: Map<string, number>;
  private startedAt!: Date;
  private initialInput!: Input;
  private current: unknown;
  private currentStepId?: string;
  private composedSignal!: AbortSignal;
  private pendingHuman?: PendingHumanState<any, any, Meta, Input, Ctx>;
  private finishedAt?: Date;
  private telemetry?: WorkflowRunTelemetry<Meta>;
  private telemetryOverrides?: WorkflowTelemetryOverrides;
  private activeStepTelemetry?: StepTelemetryHandle;

  constructor({ workflow, runId }: WorkflowRunInit<Input, Output, Meta, Ctx>) {
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

    for (const [groupId, group] of this.graph.parallelGroups.entries()) {
      this.parallelGroups.set(groupId, group);

      for (const [branchId, branch] of group.branches.entries()) {
        const key = this.buildParallelBranchKey(groupId, branchId);
        this.parallelBranchNavigation.set(
          key,
          this.createParallelBranchNavigation(groupId, branchId, branch),
        );
      }
    }

    for (const [stepId, lookup] of this.graph.parallelLookup.entries()) {
      this.parallelLookup.set(stepId, lookup);
    }
  }

  private configureTelemetry(option?: WorkflowTelemetryOption) {
    const resolved = resolveWorkflowTelemetryConfig({
      workflowId: this.workflowId,
      baseOption: this.workflow.getTelemetryConfig(),
      overrideOption: option,
    });

    if (!resolved) {
      this.telemetry = undefined;
      this.telemetryOverrides = undefined;
      return;
    }

    this.telemetry = new WorkflowRunTelemetry<Meta>({
      workflowId: this.workflowId,
      runId: this.runId,
      description: this.workflow.description,
      config: resolved,
    });

    this.telemetryOverrides = this.telemetry.getResolvedOverrides();
  }

  private refreshFrozenCtx() {
    if (this.runtimeCtx === undefined) {
      this.frozenCtx = undefined as WorkflowCtxValue<Ctx>;
      return;
    }

    const clone = { ...(this.runtimeCtx as Record<string, unknown>) } as Ctx;
    this.runtimeCtx = clone;
    this.frozenCtx = Object.freeze(clone) as WorkflowCtxValue<Ctx>;
  }

  private initializeCtx(baseCtx: WorkflowCtxInit<Ctx>, override?: WorkflowCtxRunInput<Ctx>) {
    if (baseCtx === undefined && override === undefined) {
      this.runtimeCtx = undefined as Ctx;
      this.frozenCtx = undefined as WorkflowCtxValue<Ctx>;
      return;
    }

    const merged = {
      ...(baseCtx ?? {}) as Record<string, unknown>,
      ...(override ?? {}) as Record<string, unknown>,
    } as Ctx;

    this.runtimeCtx = merged;
    this.refreshFrozenCtx();
  }

  private applyCtxUpdate(updater: WorkflowCtxUpdater<Ctx>) {
    if (typeof updater !== "function") {
      return;
    }

    const normalized = updater as unknown as (current: Ctx) => Ctx;
    const current = this.runtimeCtx === undefined
      ? ({} as Ctx)
      : this.runtimeCtx;

    this.runtimeCtx = normalized(current);
    this.refreshFrozenCtx();
  }

  private getCtxSnapshot(): WorkflowCtxValue<Ctx> {
    return this.frozenCtx;
  }

  private cloneCtx(): WorkflowCtxValue<Ctx> {
    if (this.runtimeCtx === undefined) {
      return undefined as WorkflowCtxValue<Ctx>;
    }

    const clone = { ...(this.runtimeCtx as Record<string, unknown>) };
    return Object.freeze(clone) as WorkflowCtxValue<Ctx>;
  }

  getTelemetrySelection(): WorkflowTelemetryOption | undefined {
    return this.telemetryOverrides;
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
      parallelGroupId: event.parallelGroupId,
      parallelBranchId: event.parallelBranchId,
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

  private buildParallelBranchKey(groupId: string, branchId: string) {
    return `${groupId}:${branchId}`;
  }

  private createParallelBranchNavigation(
    _groupId: string,
    _branchId: string,
    branch: WorkflowParallelBranchGraph<Meta, Input, Ctx>,
  ) {
    const defaultNext = new Map<string, string | undefined>();
    const sequenceIndex = new Map<string, number>();

    for (let index = 0; index < branch.sequence.length; index += 1) {
      const current = branch.sequence[index];
      sequenceIndex.set(current, index);

      if (index < branch.sequence.length - 1) {
        defaultNext.set(current, branch.sequence[index + 1]);
      }
    }

    const branchMembers = new Map<string, Set<string>>();
    const branchOwners = new Map<string, string>();

    for (const [conditionId, branches] of branch.branchLookup.entries()) {
      const members = new Set<string>();
      for (const target of branches.values()) {
        members.add(target);
        branchOwners.set(target, conditionId);
      }
      branchMembers.set(conditionId, members);
    }

    return {
      defaultNext,
      branchMembers,
      sequenceIndex,
      branchOwners,
      sequence: [...branch.sequence],
    };
  }

  private findParallelPostConditionalNext(
    navigation: {
      branchMembers: Map<string, Set<string>>;
      sequenceIndex: Map<string, number>;
      sequence: string[];
    },
    stepId: string,
  ): string | undefined {
    const index = navigation.sequenceIndex.get(stepId);
    if (index === undefined) {
      return undefined;
    }

    const members = navigation.branchMembers.get(stepId);
    if (!members) {
      return index < navigation.sequence.length - 1
        ? navigation.sequence[index + 1]
        : undefined;
    }

    for (let cursor = index + 1; cursor < navigation.sequence.length; cursor += 1) {
      const candidate = navigation.sequence[cursor];
      if (!members.has(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private resolveParallelDefaultNext(
    parallelId: string,
    branchId: string,
    stepId: string,
    branchResolved: boolean,
  ): string | undefined {
    const navigation = this.parallelBranchNavigation.get(
      this.buildParallelBranchKey(parallelId, branchId),
    );
    if (!navigation) {
      return undefined;
    }

    if (!branchResolved && navigation.branchMembers.has(stepId)) {
      return this.findParallelPostConditionalNext(navigation, stepId);
    }

    const owner = navigation.branchOwners.get(stepId);
    if (owner) {
      return this.findParallelPostConditionalNext(navigation, owner);
    }

    return navigation.defaultNext.get(stepId);
  }

  private async runParallelBranch({
    parallelId,
    branchId,
    branch,
    input,
    stepRuntime,
    signal,
  }: {
    parallelId: string;
    branchId: string;
    branch: WorkflowParallelBranchGraph<Meta, Input, Ctx>;
    input: unknown;
    stepRuntime: WorkflowStepRuntimeContext<Meta, Input, Ctx>;
    signal: AbortSignal;
  }): Promise<unknown> {
    const navigation = this.parallelBranchNavigation.get(
      this.buildParallelBranchKey(parallelId, branchId),
    );
    if (!navigation) {
      throw new WorkflowExecutionError(
        `Missing navigation metadata for parallel branch ${branchId} in ${parallelId}`,
      );
    }

    if (signal.aborted) {
      throw signal.reason ?? new WorkflowAbortError();
    }

    let current = input;
    let currentStepId: string | undefined = branch.entryId;

    while (currentStepId) {
      if (signal.aborted || this.composedSignal.aborted) {
        throw signal.reason ?? this.composedSignal.reason ?? new WorkflowAbortError();
      }

      const step = branch.steps.get(currentStepId);
      if (!step) {
        throw new WorkflowExecutionError(
          `Parallel branch ${branchId} in ${parallelId} references unknown step ${currentStepId}`,
        );
      }

      if (step instanceof HumanWorkflowStep) {
        throw new WorkflowExecutionError(
          `Parallel branch ${branchId} in ${parallelId} cannot contain human steps`,
        );
      }

      const started = new Date();
      const occurrence = (this.stepOccurrences.get(step.id) ?? 0) + 1;
      const stepHandle = this.telemetry?.startStep({
        step,
        stepId: step.id,
        occurrence,
        startedAt: started,
        parallel: {
          groupId: parallelId,
          branchId,
        },
      });
      this.activeStepTelemetry = stepHandle;

      this.emit({
        type: "step:start",
        stepId: step.id,
        parallelGroupId: parallelId,
        parallelBranchId: branchId,
      });

      const branchStepRuntime: WorkflowStepRuntimeContext<Meta, Input, Ctx> = {
        ...stepRuntime,
        getCtx: () => this.getCtxSnapshot(),
        updateCtx: () => {
          throw new WorkflowExecutionError(
            `Parallel branch ${branchId} in ${parallelId} cannot update workflow context`,
          );
        },
      };

      const ctxSnapshot = this.getCtxSnapshot();

      const executeStep = () =>
        step.execute({
          input: current,
          ctx: ctxSnapshot,
          stepRuntime: branchStepRuntime,
          context: branchStepRuntime,
          signal,
        });

      try {
        const { input: validatedInput, output } = await (
          this.telemetry
            ? this.telemetry.runWithStepContext(stepHandle, executeStep)
            : executeStep()
        );

        const finished = new Date();
        this.stepOccurrences.set(step.id, occurrence);

        const transitionContext = {
          input: validatedInput,
          output,
          context: branchStepRuntime,
          ctx: this.getCtxSnapshot(),
        };

        const resolveBranch = () => step.resolveBranch(transitionContext);
        const resolvedBranchId = await (
          this.telemetry
            ? this.telemetry.runWithStepContext(stepHandle, resolveBranch)
            : resolveBranch()
        );
        let branchNext: string | undefined;

        if (resolvedBranchId !== undefined) {
          const branchMap = branch.branchLookup.get(step.id);
          if (!branchMap) {
            throw new WorkflowBranchResolutionError(
              `Parallel branch ${branchId} in ${parallelId} has no branches configured for step ${step.id}`,
            );
          }

          branchNext = branchMap.get(resolvedBranchId);
          if (!branchNext) {
            throw new WorkflowBranchResolutionError(
              `Parallel branch ${branchId} in ${parallelId} referenced unknown branch ${String(resolvedBranchId)} on step ${step.id}`,
            );
          }

          this.emit({
            type: "step:branch",
            stepId: step.id,
            data: {
              branchId: resolvedBranchId,
              nextStepId: branchNext,
              conditionStepId: step.id,
            },
            parallelGroupId: parallelId,
            parallelBranchId: branchId,
          });
        }

        const resolveNext = () => step.resolveNext(transitionContext);
        const resolvedNext = await (
          this.telemetry
            ? this.telemetry.runWithStepContext(stepHandle, resolveNext)
            : resolveNext()
        );

        if (resolvedNext && !branch.steps.has(resolvedNext)) {
          throw new WorkflowExecutionError(
            `Parallel branch ${branchId} in ${parallelId} resolved next to unknown step ${resolvedNext}`,
          );
        }

        const nextStepId = branchNext
          ?? resolvedNext
          ?? this.resolveParallelDefaultNext(
            parallelId,
            branchId,
            step.id,
            resolvedBranchId !== undefined,
          );

        this.stepsSnapshot[step.id] ??= [];
        this.stepsSnapshot[step.id].push({
          status: "success",
          input: validatedInput,
          output,
          startedAt: started,
          finishedAt: finished,
          occurrence,
          branchId: resolvedBranchId,
          nextStepId,
          parallelGroupId: parallelId,
          parallelBranchId: branchId,
        });

        this.history.set(step.id, { input: validatedInput, output });

        this.telemetry?.recordStepSuccess(stepHandle, {
          finishedAt: finished,
          input: validatedInput,
          output,
          branchId: resolvedBranchId,
          nextStepId,
        });

        this.emit({
          type: "step:success",
          stepId: step.id,
          data: output,
          parallelGroupId: parallelId,
          parallelBranchId: branchId,
        });

        current = output;
        currentStepId = nextStepId;
        this.activeStepTelemetry = undefined;
      } catch (error) {
        const finished = new Date();
        this.stepOccurrences.set(step.id, occurrence);

        this.stepsSnapshot[step.id] ??= [];
        this.stepsSnapshot[step.id].push({
          status: "failed",
          input: current,
          error,
          startedAt: started,
          finishedAt: finished,
          occurrence,
          nextStepId: undefined,
          parallelGroupId: parallelId,
          parallelBranchId: branchId,
        });

        this.telemetry?.recordStepError(stepHandle, {
          finishedAt: finished,
          input: current,
          error,
        });

        this.emit({
          type: "step:error",
          stepId: step.id,
          data: error,
          parallelGroupId: parallelId,
          parallelBranchId: branchId,
        });
        this.activeStepTelemetry = undefined;
        throw error;
      }
    }

    return current;
  }

  private async executeParallelStep(
    step: ParallelWorkflowStep<any, any, Meta, Input, Ctx>,
    stepRuntime: WorkflowStepRuntimeContext<Meta, Input, Ctx>,
    signal: AbortSignal,
    stepHandle: StepTelemetryHandle | undefined,
  ): Promise<{ input: unknown; output: unknown; results: Record<string, unknown> }> {
    const strategy = step.getErrorStrategy();
    const input = step.validateInput(this.current);
    const branches = Array.from(step.getParallelBranches().entries());

    if (branches.length === 0) {
      throw new WorkflowExecutionError(`Parallel step ${step.id} requires at least one branch`);
    }

    const controllers = new Map<string, AbortController>();

    const branchPromises = branches.map(([branchId, branch]) => {
      const controller = new AbortController();
      controllers.set(branchId, controller);
      const branchSignal = mergeSignals([signal, controller.signal]);

      return this.runParallelBranch({
        parallelId: step.id,
        branchId,
        branch,
        input,
        stepRuntime,
        signal: branchSignal,
      })
        .then(output => ({
          branchId,
          output,
        }))
        .catch(error => {
          if (strategy === "fail-fast") {
            for (const [otherId, otherController] of controllers.entries()) {
              if (otherId !== branchId && !otherController.signal.aborted) {
                otherController.abort(error);
              }
            }
          }
          throw {
            branchId,
            error,
          };
        });
    });

    const settled = await Promise.allSettled(branchPromises);
    const results: Record<string, unknown> = {};
    const errors: Array<{ branchId: string; error: unknown }> = [];

    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        results[outcome.value.branchId] = outcome.value.output;
      } else {
        const reason = outcome.reason as { branchId: string; error: unknown };
        errors.push(reason);
      }
    }

    if (errors.length > 0) {
      if (strategy === "fail-fast") {
        throw errors[0].error;
      }

      const aggregatedError = new WorkflowExecutionError(
        `Parallel step ${step.id} encountered errors in branches: ${errors.map(entry => entry.branchId).join(", ")}`,
        errors[0].error,
      );
      (aggregatedError as WorkflowExecutionError & { parallelErrors: Array<{ branchId: string; error: unknown }> }).parallelErrors = errors;
      throw aggregatedError;
    }

    const aggregatedOutput = await (
      this.telemetry
        ? this.telemetry.runWithStepContext(stepHandle, () =>
            step.aggregateResults({
              input,
              results,
              ctx: this.getCtxSnapshot(),
              stepRuntime,
              signal,
            }),
          )
        : step.aggregateResults({
            input,
            results,
            ctx: this.getCtxSnapshot(),
            stepRuntime,
            signal,
          })
    );

    const output = step.validateOutput(aggregatedOutput);

    return {
      input,
      output,
      results,
    };
  }

  watch(watcher: WorkflowWatcher<Meta>) {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  cancel(reason?: unknown) {
    this.controller.abort(reason ?? new WorkflowAbortError());
  }

  async start(
    options: WorkflowRunOptions<Input, Meta, Ctx>,
  ): Promise<WorkflowRunResult<Output, Meta, Ctx>> {
    return this.execute(options, undefined);
  }

  async stream(options: WorkflowRunOptions<Input, Meta, Ctx>) {
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
    { inputData, metadata, ctx, signal, telemetry }: WorkflowRunOptions<Input, Meta, Ctx>,
    emitStream: ((event: WorkflowEvent<Meta>) => void) | undefined,
  ): Promise<WorkflowRunResult<Output, Meta, Ctx>> {
    if (this.executed) {
      throw new WorkflowExecutionError("Workflow run can only be executed once");
    }

    this.executed = true;
    this.emitStream = emitStream;
    this.configureTelemetry(telemetry);

    if (signal?.aborted || this.controller.signal.aborted) {
      throw new WorkflowAbortError();
    }

    this.composedSignal = mergeSignals(
      [this.controller.signal, ...(signal ? [signal] : [])],
    );

    this.runtimeMetadata = cloneMetadata(metadata ?? this.workflow.getInitialMetadata());
    this.initializeCtx(this.workflow.getBaseContext(), ctx);
    this.stepsSnapshot = {};
    this.stepOccurrences = new Map();
    this.startedAt = new Date();
    this.finishedAt = undefined;
    this.pendingHuman = undefined;
    this.history.clear();
    this.store.set(HUMAN_HISTORY_STORE_KEY, this.history);
    this.telemetry?.startWorkflow({
      startedAt: this.startedAt,
      input: inputData,
    });

    try {
      this.current = this.workflow.validateInput(inputData);
    } catch (error) {
      this.emit({ type: "workflow:error", data: error });
      const finishedAt = new Date();
      this.telemetry?.finishWorkflow({
        status: "error",
        finishedAt,
        error,
      });
      return {
        status: "failed",
        error,
        steps: this.stepsSnapshot,
        metadata: this.runtimeMetadata,
        ctx: this.cloneCtx(),
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
    step: HumanWorkflowStep<any, any, Meta, Input, Ctx>,
    context: WorkflowStepRuntimeContext<Meta, Input, Ctx>,
    started: Date,
    stepHandle: StepTelemetryHandle | undefined,
    occurrence: number,
  ): Promise<WorkflowRunResult<Output, Meta, Ctx>> {
    if (!this.stepsSnapshot) {
      throw new WorkflowExecutionError("Workflow run is not initialized");
    }

    const args: StepHandlerArgs<unknown, Meta, Input, Ctx> = {
      input: this.current,
      ctx: this.getCtxSnapshot(),
      stepRuntime: context,
      context,
      signal: this.composedSignal,
    };

    const buildHumanRequest = () => step.buildHumanRequest(args);
    const { input, form, payload } = await (
      this.telemetry
        ? this.telemetry.runWithStepContext(stepHandle, buildHumanRequest)
        : buildHumanRequest()
    );

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
      telemetry: stepHandle,
    };

    this.telemetry?.attachStepInput(stepHandle, input);
    this.telemetry?.recordHumanRequest(stepHandle, {
      requestedAt: started,
      form,
      payload,
    });
    this.telemetry?.markWaitingForHuman(step.id, occurrence, started);

    this.emit({
      type: "step:human:requested",
      stepId: step.id,
      data: pending,
    });

    this.finishedAt = new Date();
    this.activeStepTelemetry = undefined;

    return {
      status: "waiting_human",
      steps: this.stepsSnapshot,
      metadata: this.runtimeMetadata,
      ctx: this.cloneCtx(),
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      pendingHuman: pending,
    };
  }

  private async runLoop(): Promise<WorkflowRunResult<Output, Meta, Ctx>> {
    while (this.currentStepId) {
      const stepId = this.currentStepId;
      const step = this.graph.steps.get(stepId);
      if (!step) {
        const error = new WorkflowExecutionError(`Unknown step ${stepId}`);
        this.emit({ type: "workflow:error", data: error });
        const finishedAt = new Date();
        this.telemetry?.finishWorkflow({
          status: "error",
          finishedAt,
          error,
        });
        return {
          status: "failed",
          error,
          steps: this.stepsSnapshot,
          metadata: this.runtimeMetadata,
          ctx: this.cloneCtx(),
          startedAt: this.startedAt,
          finishedAt,
        };
      }

      if (this.composedSignal.aborted) {
        const error = new WorkflowAbortError();
        const finishedAt = new Date();
        this.emit({ type: "workflow:cancelled", data: error });
        this.telemetry?.finishWorkflow({
          status: "cancelled",
          finishedAt,
          error,
        });
        return {
          status: "cancelled",
          error,
          steps: this.stepsSnapshot,
          metadata: this.runtimeMetadata,
          ctx: this.cloneCtx(),
          startedAt: this.startedAt,
          finishedAt,
        };
      }

      const started = new Date();
      const occurrence = (this.stepOccurrences.get(step.id) ?? 0) + 1;
      const stepHandle = this.telemetry?.startStep({
        step,
        stepId,
        occurrence,
        startedAt: started,
      });
      this.activeStepTelemetry = stepHandle;

      this.emit({ type: "step:start", stepId });

      const stepRuntime: WorkflowStepRuntimeContext<Meta, Input, Ctx> = {
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
        getCtx: () => this.getCtxSnapshot(),
        updateCtx: (updater: WorkflowCtxUpdater<Ctx>) => {
          this.applyCtxUpdate(updater);
        },
      };

      if (step instanceof HumanWorkflowStep) {
        return this.handleHumanStep(step, stepRuntime, started, stepHandle, occurrence);
      }

      try {
        let executionInput: unknown;
        let executionOutput: unknown;

        if (step instanceof ParallelWorkflowStep) {
          const result = await this.executeParallelStep(
            step,
            stepRuntime,
            this.composedSignal,
            stepHandle,
          );
          executionInput = result.input;
          executionOutput = result.output;
        } else {
          const executeStep = () =>
            step.execute({
              input: this.current,
              ctx: this.getCtxSnapshot(),
              stepRuntime,
              context: stepRuntime,
              signal: this.composedSignal,
            });

          const result = await (
            this.telemetry
              ? this.telemetry.runWithStepContext(stepHandle, executeStep)
              : executeStep()
          );
          executionInput = result.input;
          executionOutput = result.output;
        }

        const finished = new Date();
        this.stepOccurrences.set(step.id, occurrence);

        const ctxSnapshot = this.getCtxSnapshot();
        const transitionContext: StepTransitionContext<unknown, unknown, Meta, Input, Ctx> = {
          input: executionInput,
          output: executionOutput,
          context: stepRuntime,
          ctx: ctxSnapshot,
        };
        const typedStep = step as WorkflowStep<unknown, unknown, Meta, Input, Ctx>;

        const resolveBranch = () => typedStep.resolveBranch(transitionContext);
        const resolvedBranchId = await (
          this.telemetry
            ? this.telemetry.runWithStepContext(stepHandle, resolveBranch)
            : resolveBranch()
        );
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

        const resolveNext = () => typedStep.resolveNext(transitionContext);
        const resolvedNext = await (
          this.telemetry
            ? this.telemetry.runWithStepContext(stepHandle, resolveNext)
            : resolveNext()
        );
        if (resolvedNext && !this.graph.steps.has(resolvedNext)) {
          throw new WorkflowExecutionError(
            `Step ${step.id} resolved next to unknown step ${resolvedNext}`,
          );
        }

        const nextStepId =
          branchNext ?? resolvedNext ?? this.resolveDefaultNext(step.id, branchId !== undefined);

        this.stepsSnapshot[step.id] ??= [];
        this.stepsSnapshot[step.id].push({
          status: "success",
          input: executionInput,
          output: executionOutput,
          startedAt: started,
          finishedAt: finished,
          occurrence,
          branchId,
          nextStepId,
        });

        this.history.set(step.id, { input: executionInput, output: executionOutput });

        this.telemetry?.recordStepSuccess(stepHandle, {
          finishedAt: finished,
          input: executionInput,
          output: executionOutput,
          branchId,
          nextStepId,
        });

        this.emit({ type: "step:success", stepId: step.id, data: executionOutput });
        this.current = executionOutput;
        this.currentStepId = nextStepId;
        this.activeStepTelemetry = undefined;
      } catch (error) {
        const finished = new Date();
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

        this.telemetry?.recordStepError(stepHandle, {
          finishedAt: finished,
          input: this.current,
          error,
        });

        this.emit({ type: "step:error", stepId: step.id, data: error });
        this.emit({ type: "workflow:error", data: error });
        this.telemetry?.finishWorkflow({
          status: "error",
          finishedAt: finished,
          error,
        });
        this.activeStepTelemetry = undefined;
        return {
          status: "failed",
          error,
          steps: this.stepsSnapshot,
          metadata: this.runtimeMetadata,
          ctx: this.cloneCtx(),
          startedAt: this.startedAt,
          finishedAt: finished,
        };
      }
    }

    this.activeStepTelemetry = undefined;

    if (this.composedSignal.aborted) {
      const error = new WorkflowAbortError();
      const finishedAt = new Date();
      this.emit({ type: "workflow:cancelled", data: error });
      this.telemetry?.finishWorkflow({
        status: "cancelled",
        finishedAt,
        error,
      });
      return {
        status: "cancelled",
        error,
        steps: this.stepsSnapshot,
        metadata: this.runtimeMetadata,
        ctx: this.cloneCtx(),
        startedAt: this.startedAt,
        finishedAt,
      };
    }

    try {
      const output = this.workflow.validateOutput(this.current);
      const finishedAt = new Date();
      this.emit({ type: "workflow:success", data: output });
      this.finishedAt = finishedAt;
      this.telemetry?.finishWorkflow({
        status: "success",
        finishedAt,
        output,
      });
      return {
        status: "success",
        result: output,
        steps: this.stepsSnapshot,
        metadata: this.runtimeMetadata,
        ctx: this.cloneCtx(),
        startedAt: this.startedAt,
        finishedAt,
      };
    } catch (error) {
      const finishedAt = new Date();
      this.emit({ type: "workflow:error", data: error });
      this.finishedAt = finishedAt;
      this.telemetry?.finishWorkflow({
        status: "error",
        finishedAt,
        error,
      });
      return {
        status: "failed",
        error,
        steps: this.stepsSnapshot,
        metadata: this.runtimeMetadata,
        ctx: this.cloneCtx(),
        startedAt: this.startedAt,
        finishedAt,
      };
    }
  }

  async resumeWithHumanInput(args: { runId?: string; stepId: string; data: unknown }): Promise<WorkflowRunResult<Output, Meta, Ctx>> {
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

    const { step, input, context, snapshotIndex, occurrence, telemetry: stepHandle } = this.pendingHuman;
    const parseResponse = () => step.parseResponse(args.data);
    const response = await Promise.resolve(
      this.telemetry
        ? this.telemetry.runWithStepContext(stepHandle, parseResponse)
        : parseResponse(),
    );

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

    const transitionContext = {
      input,
      output: response,
      context,
      ctx: this.getCtxSnapshot(),
    };

    const resolveNext = () => step.resolveNext(transitionContext);
    const resolvedNext = await (
      this.telemetry
        ? this.telemetry.runWithStepContext(stepHandle, resolveNext)
        : resolveNext()
    );
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

    this.telemetry?.recordHumanCompletion(stepHandle, {
      finishedAt: finished,
      input,
      output: response,
      nextStepId,
    });
    this.telemetry?.recordStepSuccess(stepHandle, {
      finishedAt: finished,
      input,
      output: response,
      nextStepId,
    });

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
