import { WorkflowAbortError, WorkflowExecutionError } from "../errors.js";
import type {
  MaybePromise,
  SchemaLike,
  StepHandlerArgs,
  WorkflowStepInput,
  WorkflowStepMeta,
  WorkflowStepOutput,
  WorkflowStepRootInput,
} from "../types.js";
import { createStep, WorkflowStep } from "./step.js";

export type ForEachCollectFn<ItemOutput, CollectOutput = unknown> = (
  results: Array<ItemOutput>,
) => MaybePromise<CollectOutput>;

export type ForEachStepOutput<
  ItemOutput,
  Collect extends ForEachCollectFn<ItemOutput, any> | undefined,
> = Collect extends ForEachCollectFn<ItemOutput, any>
  ? Awaited<ReturnType<Collect>>
  : Array<ItemOutput>;

export interface ForEachStepConfig<
  Input,
  ItemStep extends WorkflowStep<any, any, any, any, Ctx>,
  Collect extends ForEachCollectFn<WorkflowStepOutput<ItemStep>, any> | undefined = undefined,
  Ctx extends Record<string, unknown> | undefined = undefined,
> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<ForEachStepOutput<WorkflowStepOutput<ItemStep>, Collect>>;
  items: (
    args: StepHandlerArgs<
      Input,
      WorkflowStepMeta<ItemStep>,
      WorkflowStepRootInput<ItemStep>,
      Ctx
    >,
  ) => MaybePromise<Iterable<WorkflowStepInput<ItemStep>>>;
  itemStep: ItemStep;
  collect?: Collect;
  concurrency?: number;
}

export const createForEachStep = <
  Input,
  ItemStep extends WorkflowStep<any, any, any, any, Ctx>,
  Collect extends ForEachCollectFn<WorkflowStepOutput<ItemStep>, any> | undefined = undefined,
  Ctx extends Record<string, unknown> | undefined = undefined,
>(
  config: ForEachStepConfig<Input, ItemStep, Collect, Ctx>,
) =>
  createStep<
    Input,
    ForEachStepOutput<WorkflowStepOutput<ItemStep>, Collect>,
    WorkflowStepMeta<ItemStep>,
    WorkflowStepRootInput<ItemStep>,
    Ctx
  >({
    id: config.id,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    handler: async (
      args: StepHandlerArgs<
        Input,
        WorkflowStepMeta<ItemStep>,
        WorkflowStepRootInput<ItemStep>,
        Ctx
      >,
    ) => {
      const itemsIterable = await config.items(args);
      const items = Array.isArray(itemsIterable) ? itemsIterable : Array.from(itemsIterable);
      const total = items.length;
      const rawConcurrency = config.concurrency ?? 1;
      const concurrency = Number.isFinite(rawConcurrency)
        ? Math.max(1, Math.floor(rawConcurrency))
        : 1;
      const results: Array<WorkflowStepOutput<ItemStep>> = new Array(total);

      let currentIndex = 0;

      const worker = async () => {
        while (true) {
          if (args.signal.aborted) {
            throw args.signal.reason ?? new WorkflowAbortError();
          }

          const index = currentIndex;
          currentIndex += 1;

          if (index >= total) {
            break;
          }

          const item = items[index] as WorkflowStepInput<ItemStep>;

          try {
            const { output } = await config.itemStep.execute({
              ...args,
              input: item,
            });
            results[index] = output as WorkflowStepOutput<ItemStep>;
          } catch (error) {
            throw new WorkflowExecutionError(
              `ForEach step ${config.id} failed while processing item at index ${index}`,
              error,
            );
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());

      await Promise.all(workers);

      if (config.collect) {
        return (await config.collect(results)) as ForEachStepOutput<WorkflowStepOutput<ItemStep>, Collect>;
      }

      return results as ForEachStepOutput<WorkflowStepOutput<ItemStep>, Collect>;
    },
  });
