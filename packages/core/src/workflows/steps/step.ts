import { parseWithSchema } from "../utils/validation.js";
import type {
  BranchId,
  StepHandlerArgs,
  StepTransitionContext,
  WorkflowStepConfig,
  MaybePromise,
  BranchResolver,
  NextResolver,
} from "../types.js";

export class WorkflowStep<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
> {
  readonly id: string;
  readonly description?: string;
  private readonly inputSchema?: WorkflowStepConfig<Input, Output, Meta, RootInput>["inputSchema"];
  private readonly outputSchema?: WorkflowStepConfig<Input, Output, Meta, RootInput>["outputSchema"];
  private readonly handler: WorkflowStepConfig<Input, Output, Meta, RootInput>["handler"];
  private readonly next?: string | NextResolver<Input, Output, Meta, RootInput>;
  private readonly branchResolver?: BranchResolver<Input, Output, Meta, RootInput>;

  constructor({
    id,
    description,
    inputSchema,
    outputSchema,
    handler,
    next,
    branchResolver,
  }: WorkflowStepConfig<Input, Output, Meta, RootInput>) {
    this.id = id;
    this.description = description;
    this.inputSchema = inputSchema;
    this.outputSchema = outputSchema;
    this.handler = handler;
    this.next = next;
    this.branchResolver = branchResolver;
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
      next: overrides.next ?? this.next,
      branchResolver: overrides.branchResolver ?? this.branchResolver,
    });
  }

  async resolveNext(
    args: StepTransitionContext<Input, Output, Meta, RootInput>,
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
    args: StepTransitionContext<Input, Output, Meta, RootInput>,
  ): MaybePromise<BranchId | undefined> {
    return this.branchResolver?.(args);
  }

  getStaticNext(): string | undefined {
    return typeof this.next === "string" ? this.next : undefined;
  }
}

export type WorkflowStepOutput<T extends WorkflowStep<any, any, any, any>> =
  T extends WorkflowStep<any, infer Output, any, any> ? Output : never;

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

export const createMapStep = createStep;
