import type {
  HumanAskBuilders,
  HumanFormDefinition,
  HumanOutputResolver,
  HumanStepConfig,
  SchemaLike,
  WorkflowStepConfig,
} from "../types.js";
import { parseWithSchema } from "../utils/validation.js";
import type { StepHandlerArgs } from "../types.js";
import { WorkflowStep } from "./step.js";

const HISTORY_STORE_KEY = "@ai_kit/workflows/step-history";

const createAskBuilders = (): HumanAskBuilders => ({
  text: ({ id, label, required, placeholder }) => ({
    id,
    label,
    type: "text",
    required,
    placeholder,
  }),
  select: ({ id, label, options, required }) => ({
    id,
    label,
    type: "select",
    options,
    required,
  }),
  form: definition => definition,
});

const buildHistorySnapshot = (contextStore: Map<string, unknown>) => {
  const history = contextStore.get(HISTORY_STORE_KEY) as Map<string, { input: unknown; output?: unknown }> | undefined;
  if (!history) {
    return {} as Record<string, { input: unknown; output?: unknown }>;
  }

  return Object.fromEntries(history.entries());
};

export class HumanWorkflowStep<
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
> extends WorkflowStep<Input, Output, Meta, RootInput, Ctx> {
  readonly kind = "human" as const;
  private readonly outputResolver: HumanOutputResolver<Input, Meta, RootInput, Ctx>;
  private readonly inputBuilder: HumanStepConfig<Input, Output, Meta, RootInput, Ctx>["input"];
  private readonly responseSchema?: SchemaLike<unknown>;

  constructor(config: HumanStepConfig<Input, Output, Meta, RootInput, Ctx>) {
    const handler: WorkflowStepConfig<
      Input,
      Output,
      Meta,
      RootInput,
      Ctx
    >["handler"] = async ({ input }) =>
      input as unknown as Output;

    super({
      ...config,
      handler,
    });

    this.outputResolver = config.output;
    this.inputBuilder = config.input;
    this.responseSchema = config.responseSchema;
  }

  async buildHumanRequest(
    args: StepHandlerArgs<unknown, Meta, RootInput, Ctx>,
  ): Promise<{
    input: Input;
    form: HumanFormDefinition;
    payload: unknown;
  }> {
    const validatedInput = parseWithSchema<Input>(this.inputSchema, args.input, `step ${this.id} input`);
    const runtime = args.stepRuntime;
    const stepsHistory = buildHistorySnapshot(runtime.store);

    const form = this.inputBuilder({
      ask: createAskBuilders(),
      context: runtime,
      ctx: args.ctx,
    });

    const payload = await this.outputResolver({
      current: validatedInput,
      steps: stepsHistory,
      context: runtime,
      ctx: args.ctx,
    });

    return {
      input: validatedInput,
      form,
      payload,
    };
  }

  parseResponse(data: unknown): Output {
    const parsed = parseWithSchema(this.responseSchema, data, `human step ${this.id} response`);
    const validatedOutput = parseWithSchema<Output>(
      this.outputSchema,
      parsed,
      `step ${this.id} output`,
    );
    return validatedOutput;
  }
}

export const createHumanStep = <
  Input,
  Output,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Ctx extends Record<string, unknown> | undefined = undefined,
>(config: HumanStepConfig<Input, Output, Meta, RootInput, Ctx>) => new HumanWorkflowStep(config);

export const createHuman = createHumanStep;

export { HISTORY_STORE_KEY as HUMAN_HISTORY_STORE_KEY };
