import {
  context as otelContext,
  trace,
  SpanStatusCode,
  type Context,
  type Span,
} from "@opentelemetry/api";

import { HumanWorkflowStep } from "./steps/humanStep.js";
import type { WorkflowStep } from "./steps/step.js";
import type {
  WorkflowTelemetryOption,
  WorkflowTelemetryOverrides,
} from "./types.js";

const TRACER_NAME = "@ai-kit/workflow";

export interface WorkflowTelemetryResolvedConfig {
  traceName: string;
  metadata?: Record<string, unknown>;
  recordInputs: boolean;
  recordOutputs: boolean;
  userId?: string;
}

interface ResolveTelemetryOptionsParams {
  workflowId: string;
  baseOption?: WorkflowTelemetryOption;
  overrideOption?: WorkflowTelemetryOption;
}

interface WorkflowRunTelemetryParams {
  workflowId: string;
  runId: string;
  description?: string;
  config: WorkflowTelemetryResolvedConfig;
}

interface StartWorkflowArgs {
  startedAt: Date;
  input: unknown;
}

interface FinishWorkflowArgs {
  finishedAt: Date;
  output?: unknown;
  error?: unknown;
  status: "success" | "error" | "cancelled";
}

interface StartStepArgs<Meta extends Record<string, unknown>> {
  step: WorkflowStep<any, any, Meta, any, any>;
  stepId: string;
  occurrence: number;
  startedAt: Date;
  parallel?: {
    groupId: string;
    branchId: string;
  };
}

interface StepSuccessArgs {
  finishedAt: Date;
  input: unknown;
  output: unknown;
  branchId?: string | number;
  nextStepId?: string;
}

interface StepErrorArgs {
  finishedAt: Date;
  input: unknown;
  error: unknown;
}

interface StepHumanRequestedArgs {
  requestedAt: Date;
  form?: unknown;
  payload?: unknown;
}

interface StepHumanCompletedArgs {
  finishedAt: Date;
  input: unknown;
  output: unknown;
  nextStepId?: string;
}

export interface StepTelemetryHandle {
  readonly span: Span;
  readonly context: Context;
  readonly stepId: string;
  readonly occurrence: number;
  readonly isHuman: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toMetadataOverrides = (option?: WorkflowTelemetryOption): WorkflowTelemetryOverrides | undefined => {
  if (option === undefined || option === false) {
    return undefined;
  }

  if (option === true) {
    return {};
  }

  return option;
};

const optionIsEnabled = (option?: WorkflowTelemetryOption): boolean =>
  option === true || isObject(option);

export const resolveWorkflowTelemetryConfig = ({
  workflowId,
  baseOption,
  overrideOption,
}: ResolveTelemetryOptionsParams): WorkflowTelemetryResolvedConfig | undefined => {
  if (overrideOption === false) {
    return undefined;
  }

  const baseEnabled = optionIsEnabled(baseOption);
  const overrideEnabled = optionIsEnabled(overrideOption);

  if (!baseEnabled && !overrideEnabled) {
    return undefined;
  }

  const baseOverrides = toMetadataOverrides(baseOption);
  const overrideOverrides = toMetadataOverrides(overrideOption);

  const metadata: Record<string, unknown> = {
    ...(baseOverrides?.metadata ?? {}),
    ...(overrideOverrides?.metadata ?? {}),
  };

  const resolvedUserId = overrideOverrides?.userId ?? baseOverrides?.userId;

  const hasMetadata = Object.keys(metadata).length > 0;
  const resolvedTraceName = overrideOverrides?.traceName ?? baseOverrides?.traceName ?? workflowId;

  const resolvedRecordInputs =
    overrideOverrides?.recordInputs ?? baseOverrides?.recordInputs ?? true;
  const resolvedRecordOutputs =
    overrideOverrides?.recordOutputs ?? baseOverrides?.recordOutputs ?? true;

  return {
    traceName: resolvedTraceName,
    metadata: hasMetadata ? metadata : undefined,
    recordInputs: resolvedRecordInputs,
    recordOutputs: resolvedRecordOutputs,
    userId: resolvedUserId,
  };
};

const toAttributeValue = (value: unknown): string | number | boolean => {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const normalizeAttributeKey = (key: string) =>
  key
    .replace(/\s+/g, "_")
    .replace(/[^\w./-]/g, "_");

const assignMetadataAttributes = (
  span: Span,
  prefix: string,
  metadata: Record<string, unknown>,
) => {
  for (const [key, value] of Object.entries(metadata)) {
    span.setAttribute(`${prefix}${normalizeAttributeKey(key)}`, toAttributeValue(value));
  }
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const toException = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  return new Error(toErrorMessage(error));
};

export class WorkflowRunTelemetry<
  Meta extends Record<string, unknown> = Record<string, unknown>,
> {
  private readonly tracer = trace.getTracer(TRACER_NAME);
  private readonly workflowId: string;
  private readonly runId: string;
  private readonly description?: string;
  private readonly config: WorkflowTelemetryResolvedConfig;

  private rootSpan?: Span;
  private rootContext: Context = otelContext.active();

  constructor(params: WorkflowRunTelemetryParams) {
    this.workflowId = params.workflowId;
    this.runId = params.runId;
    this.description = params.description;
    this.config = params.config;
  }

  getResolvedOverrides(): WorkflowTelemetryOverrides | undefined {
    const overrides: WorkflowTelemetryOverrides = {};

    if (this.config.traceName && this.config.traceName !== this.workflowId) {
      overrides.traceName = this.config.traceName;
    }

    if (this.config.metadata) {
      overrides.metadata = { ...this.config.metadata };
    }

    if (this.config.recordInputs === false) {
      overrides.recordInputs = false;
    }

    if (this.config.recordOutputs === false) {
      overrides.recordOutputs = false;
    }

    if (this.config.userId) {
      overrides.userId = this.config.userId;
    }

    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }

  startWorkflow(args: StartWorkflowArgs) {
    this.rootSpan = this.tracer.startSpan(
      this.config.traceName,
      {
        startTime: args.startedAt,
        attributes: {
          "ai_kit.workflow.id": this.workflowId,
          "ai_kit.workflow.run_id": this.runId,
          "name": this.config.traceName,
        },
      },
    );

    if (this.description) {
      this.rootSpan.setAttribute("ai_kit.workflow.description", this.description);
    }

    if (this.config.metadata) {
      assignMetadataAttributes(this.rootSpan, "ai_kit.workflow.metadata.", this.config.metadata);
      this.rootSpan.setAttribute("metadata", JSON.stringify(this.config.metadata));
    }

    if (this.config.userId) {
      this.rootSpan.setAttribute("langfuse.user.id", this.config.userId);
      this.rootSpan.setAttribute("user.id", this.config.userId);
      this.rootSpan.setAttribute("ai_kit.workflow.user_id", this.config.userId);
    }

    if (this.config.recordInputs) {
      const serializedInput = toAttributeValue(args.input);
      this.rootSpan.setAttribute("ai_kit.workflow.input", serializedInput);
      this.rootSpan.setAttribute("input", serializedInput);
    }

    this.rootContext = trace.setSpan(otelContext.active(), this.rootSpan);
  }

  finishWorkflow(args: FinishWorkflowArgs) {
    if (!this.rootSpan) {
      return;
    }

    if (args.status === "success") {
      if (this.config.recordOutputs && args.output !== undefined) {
        const serializedOutput = toAttributeValue(args.output);
        this.rootSpan.setAttribute("ai_kit.workflow.output", serializedOutput);
        this.rootSpan.setAttribute("output", serializedOutput);
      }
      this.rootSpan.setStatus({ code: SpanStatusCode.OK });
    } else if (args.status === "error") {
      if (args.error !== undefined) {
        this.rootSpan.recordException(toException(args.error));
        this.rootSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: toErrorMessage(args.error),
        });
      } else {
        this.rootSpan.setStatus({ code: SpanStatusCode.ERROR });
      }
    } else {
      this.rootSpan.addEvent("workflow.cancelled");
      this.rootSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: "workflow.cancelled",
      });
    }

    this.rootSpan.end(args.finishedAt);
  }

  markWaitingForHuman(stepId: string, occurrence: number, requestedAt: Date) {
    if (!this.rootSpan) {
      return;
    }

    this.rootSpan.addEvent("workflow.waiting_human", {
      step_id: stepId,
      occurrence,
      requested_at: requestedAt.getTime(),
    });
  }

  startStep<MetaType extends Meta>(args: StartStepArgs<MetaType>): StepTelemetryHandle | undefined {
    if (!this.rootSpan) {
      return undefined;
    }

    const span = this.tracer.startSpan(
      `${this.config.traceName}.step.${args.stepId}`,
      {
        startTime: args.startedAt,
        attributes: {
          "ai_kit.workflow.id": this.workflowId,
          "ai_kit.workflow.run_id": this.runId,
          "ai_kit.workflow.step.id": args.stepId,
          "ai_kit.workflow.step.occurrence": args.occurrence,
          "ai_kit.workflow.step.kind": args.step instanceof HumanWorkflowStep ? "human" : "automatic",
        },
      },
      this.rootContext,
    );

    if (args.parallel) {
      span.setAttribute("ai_kit.workflow.step.parallel_group_id", args.parallel.groupId);
      span.setAttribute("ai_kit.workflow.step.parallel_branch_id", args.parallel.branchId);
      span.setAttribute("ai_kit.workflow.step.parallel", true);
    }

    if (args.step.description) {
      span.setAttribute("ai_kit.workflow.step.description", args.step.description);
    }

    const context = trace.setSpan(this.rootContext, span);

    return {
      span,
      context,
      stepId: args.stepId,
      occurrence: args.occurrence,
      isHuman: args.step instanceof HumanWorkflowStep,
    };
  }

  attachStepInput(handle: StepTelemetryHandle | undefined, input: unknown) {
    if (!handle || !this.config.recordInputs) {
      return;
    }

    handle.span.setAttribute("ai_kit.workflow.step.input", toAttributeValue(input));
  }

  attachStepOutput(handle: StepTelemetryHandle | undefined, output: unknown) {
    if (!handle || !this.config.recordOutputs) {
      return;
    }

    handle.span.setAttribute("ai_kit.workflow.step.output", toAttributeValue(output));
  }

  recordStepSuccess(handle: StepTelemetryHandle | undefined, args: StepSuccessArgs) {
    if (!handle) {
      return;
    }

    this.attachStepInput(handle, args.input);
    this.attachStepOutput(handle, args.output);

    if (args.branchId !== undefined) {
      handle.span.setAttribute("ai_kit.workflow.step.branch_id", String(args.branchId));
    }

    if (args.nextStepId) {
      handle.span.setAttribute("ai_kit.workflow.step.next_step_id", args.nextStepId);
    }

    handle.span.setStatus({ code: SpanStatusCode.OK });
    handle.span.end(args.finishedAt);
  }

  recordStepError(handle: StepTelemetryHandle | undefined, args: StepErrorArgs) {
    if (!handle) {
      return;
    }

    this.attachStepInput(handle, args.input);
    handle.span.recordException(toException(args.error));
    handle.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: toErrorMessage(args.error),
    });
    handle.span.end(args.finishedAt);
  }

  recordHumanRequest(handle: StepTelemetryHandle | undefined, args: StepHumanRequestedArgs) {
    if (!handle) {
      return;
    }

    handle.span.addEvent("human.requested", {
      form: args.form ? toAttributeValue(args.form) : undefined,
      payload: args.payload ? toAttributeValue(args.payload) : undefined,
    });
  }

  recordHumanCompletion(handle: StepTelemetryHandle | undefined, args: StepHumanCompletedArgs) {
    if (!handle) {
      return;
    }

    this.attachStepInput(handle, args.input);
    this.attachStepOutput(handle, args.output);

    if (args.nextStepId) {
      handle.span.setAttribute("ai_kit.workflow.step.next_step_id", args.nextStepId);
    }

    handle.span.addEvent("human.completed");
  }

  runWithStepContext<T>(handle: StepTelemetryHandle | undefined, fn: () => T): T {
    if (!handle) {
      return fn();
    }

    return otelContext.with(handle.context, fn);
  }
}
