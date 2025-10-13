import { WorkflowAbortError, WorkflowExecutionError } from "../errors.js";
import type { MaybePromise, SchemaLike, StepHandlerArgs } from "../types.js";
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
  Item,
  ItemOutput = unknown,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  ItemStep extends WorkflowStep<Item, ItemOutput, Meta, RootInput> = WorkflowStep<
    Item,
    ItemOutput,
    Meta,
    RootInput
  >,
  Collect extends ForEachCollectFn<ItemOutput, any> | undefined = undefined,
> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<ForEachStepOutput<ItemOutput, Collect>>;
  items: (args: StepHandlerArgs<Input, Meta, RootInput>) => MaybePromise<Iterable<Item>>;
  itemStep: ItemStep;
  collect?: Collect;
  concurrency?: number;
}

export const createForEachStep = <
  Input,
  Item,
  ItemOutput = unknown,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  ItemStep extends WorkflowStep<Item, ItemOutput, Meta, RootInput> = WorkflowStep<
    Item,
    ItemOutput,
    Meta,
    RootInput
  >,
  Collect extends ForEachCollectFn<ItemOutput, any> | undefined = undefined,
>(
  config: ForEachStepConfig<Input, Item, ItemOutput, Meta, RootInput, ItemStep, Collect>,
) =>
  createStep<Input, ForEachStepOutput<ItemOutput, Collect>, Meta, RootInput>({
    id: config.id,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    handler: async (args: StepHandlerArgs<Input, Meta, RootInput>) => {
      const itemsIterable = await config.items(args);
      const items = Array.isArray(itemsIterable) ? itemsIterable : Array.from(itemsIterable);
      const total = items.length;
      const rawConcurrency = config.concurrency ?? 1;
      const concurrency = Number.isFinite(rawConcurrency)
        ? Math.max(1, Math.floor(rawConcurrency))
        : 1;
      const results: Array<ItemOutput> = new Array(total);

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

          const item = items[index];

          try {
            const { output } = await config.itemStep.execute({
              ...args,
              input: item,
            });
            results[index] = output as ItemOutput;
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
        return (await config.collect(results)) as ForEachStepOutput<ItemOutput, Collect>;
      }

      return results as ForEachStepOutput<ItemOutput, Collect>;
    },
  });
