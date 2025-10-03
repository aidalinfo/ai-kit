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
> extends WorkflowStep<Input, Output, Meta, RootInput> {
  readonly kind = "human" as const;
  private readonly outputResolver: HumanOutputResolver<Input, Meta, RootInput>;
  private readonly inputBuilder: HumanStepConfig<Input, Output, Meta, RootInput>["input"];
  private readonly responseSchema?: SchemaLike<unknown>;

  constructor(config: HumanStepConfig<Input, Output, Meta, RootInput>) {
    const handler: WorkflowStepConfig<Input, Output, Meta, RootInput>["handler"] = async ({ input }) =>
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
    args: StepHandlerArgs<unknown, Meta, RootInput>,
  ): Promise<{
    input: Input;
    form: HumanFormDefinition;
    payload: unknown;
  }> {
    const validatedInput = parseWithSchema<Input>(this.inputSchema, args.input, `step ${this.id} input`);
    const stepsHistory = buildHistorySnapshot(args.context.store);

    const form = this.inputBuilder({
      ask: createAskBuilders(),
      context: args.context,
    });

    const payload = await this.outputResolver({
      current: validatedInput,
      steps: stepsHistory,
      context: args.context,
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
>(config: HumanStepConfig<Input, Output, Meta, RootInput>) => new HumanWorkflowStep(config);

export const createHuman = createHumanStep;

export { HISTORY_STORE_KEY as HUMAN_HISTORY_STORE_KEY };
