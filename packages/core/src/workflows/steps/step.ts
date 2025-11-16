import { parseWithSchema } from "../utils/validation.js";
import type {
  BranchId,
  StepHandlerArgs,
  StepTransitionContext,
  WorkflowStepConfig,
  MaybePromise,
  BranchResolver,
  NextResolver,
  SchemaLike,
  InferSchemaType,
} from "../types.js";

export class WorkflowStep<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  readonly id: string;
  readonly description?: string;
  protected readonly inputSchema?: WorkflowStepConfig<Input, Output, Meta, RootInput, Ctx>["inputSchema"];
  protected readonly outputSchema?: WorkflowStepConfig<Input, Output, Meta, RootInput, Ctx>["outputSchema"];
  protected readonly handler: WorkflowStepConfig<Input, Output, Meta, RootInput, Ctx>["handler"];
  protected readonly next?: string | NextResolver<Input, Output, Meta, RootInput, Ctx>;
  protected readonly branchResolver?: BranchResolver<Input, Output, Meta, RootInput, Ctx>;

  constructor({
    id,
    description,
    inputSchema,
    outputSchema,
    handler,
    next,
    branchResolver,
  }: WorkflowStepConfig<Input, Output, Meta, RootInput, Ctx>) {
    this.id = id;
    this.description = description;
    this.inputSchema = inputSchema;
    this.outputSchema = outputSchema;
    this.handler = handler;
    this.next = next;
    this.branchResolver = branchResolver;
  }

  async execute(
    args: StepHandlerArgs<unknown, Meta, RootInput, Ctx>,
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
    overrides: Partial<WorkflowStepConfig<Input, Output, Meta, RootInput, Ctx>>,
  ) {
    return new WorkflowStep<Input, Output, Meta, RootInput, Ctx>({
      id: overrides.id ?? this.id,
      description: overrides.description ?? this.description,
      inputSchema: overrides.inputSchema ?? this.inputSchema,
      outputSchema: overrides.outputSchema ?? this.outputSchema,
      handler: overrides.handler ?? this.handler,
      next: overrides.next ?? this.next,
      branchResolver: overrides.branchResolver ?? this.branchResolver,
    });
  }

  async resolveNext(
    args: StepTransitionContext<Input, Output, Meta, RootInput, Ctx>,
  ): Promise<string | undefined> {
    if (!this.next) {
      return undefined;
    }

    if (typeof this.next === "string") {
      return this.next;
    }

    return this.next(args);
  }

  resolveBranch(
    args: StepTransitionContext<Input, Output, Meta, RootInput, Ctx>,
  ): MaybePromise<BranchId | undefined> {
    return this.branchResolver?.(args);
  }

  getStaticNext(): string | undefined {
    return typeof this.next === "string" ? this.next : undefined;
  }
}

export type WorkflowStepOutput<T extends WorkflowStep<any, any, any, any, any>> =
  T extends WorkflowStep<any, infer Output, any, any, any> ? Output : never;

export function createStep<
  InputSchema extends SchemaLike<any>,
  OutputSchema extends SchemaLike<any>,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
>(
  config: WorkflowStepConfig<
    InferSchemaType<InputSchema>,
    InferSchemaType<OutputSchema>,
    Meta,
    RootInput,
    Ctx
  > & {
    inputSchema: InputSchema;
    outputSchema: OutputSchema;
  },
): WorkflowStep<InferSchemaType<InputSchema>, InferSchemaType<OutputSchema>, Meta, RootInput, Ctx>;

export function createStep<
  InputSchema extends SchemaLike<any>,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
>(
  config: WorkflowStepConfig<
    InferSchemaType<InputSchema>,
    Output,
    Meta,
    RootInput,
    Ctx
  > & {
    inputSchema: InputSchema;
    outputSchema?: undefined;
  },
): WorkflowStep<InferSchemaType<InputSchema>, Output, Meta, RootInput, Ctx>;

export function createStep<
  Input,
  OutputSchema extends SchemaLike<any>,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
>(
  config: WorkflowStepConfig<
    Input,
    InferSchemaType<OutputSchema>,
    Meta,
    RootInput,
    Ctx
  > & {
    inputSchema?: undefined;
    outputSchema: OutputSchema;
  },
): WorkflowStep<Input, InferSchemaType<OutputSchema>, Meta, RootInput, Ctx>;

export function createStep<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
>(
  config: WorkflowStepConfig<Input, Output, Meta, RootInput, Ctx>,
): WorkflowStep<Input, Output, Meta, RootInput, Ctx>;

export function createStep(
  config: WorkflowStepConfig<any, any, Record<string, unknown>, unknown, Record<string, unknown> | undefined>,
) {
  return new WorkflowStep(config);
}

export const cloneStep = <
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
>(
  step: WorkflowStep<Input, Output, Meta, RootInput, Ctx>,
  overrides: Partial<WorkflowStepConfig<Input, Output, Meta, RootInput, Ctx>>,
) => step.clone(overrides);

export const createMapStep = createStep;
