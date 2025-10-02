import { WorkflowAbortError, WorkflowExecutionError } from "../errors.js";
import type { MaybePromise, SchemaLike, StepHandlerArgs } from "../types.js";
import { createStep, WorkflowStep, WorkflowStepOutput } from "./step.js";

export type ForEachCollectFn<ItemStep extends WorkflowStep<any, any, any, any>> = (
  results: Array<WorkflowStepOutput<ItemStep>>,
) => MaybePromise<unknown>;

export type ForEachStepOutput<
  ItemStep extends WorkflowStep<any, any, any, any>,
  Collect extends ForEachCollectFn<ItemStep> | undefined,
> = Collect extends ForEachCollectFn<ItemStep>
  ? Awaited<ReturnType<Collect>>
  : Array<WorkflowStepOutput<ItemStep>>;

export interface ForEachStepConfig<
  Input,
  Item,
  ItemStep extends WorkflowStep<Item, unknown, Meta, RootInput>,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Collect extends ForEachCollectFn<ItemStep> | undefined = undefined,
> {
  id: string;
  description?: string;
  inputSchema?: SchemaLike<Input>;
  outputSchema?: SchemaLike<ForEachStepOutput<ItemStep, Collect>>;
  items: (args: StepHandlerArgs<Input, Meta, RootInput>) => MaybePromise<Iterable<Item>>;
  itemStep: ItemStep;
  collect?: Collect;
  concurrency?: number;
}

export const createForEachStep = <
  Input,
  Item,
  ItemStep extends WorkflowStep<Item, unknown, Meta, RootInput>,
  Meta extends Record<string, unknown> = Record<string, unknown>,
  RootInput = unknown,
  Collect extends ForEachCollectFn<ItemStep> | undefined = undefined,
>(
  config: ForEachStepConfig<Input, Item, ItemStep, Meta, RootInput, Collect>,
) =>
  createStep<Input, ForEachStepOutput<ItemStep, Collect>, Meta, RootInput>({
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

          const item = items[index];

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
        return (await config.collect(results)) as ForEachStepOutput<ItemStep, Collect>;
      }

      return results as ForEachStepOutput<ItemStep, Collect>;
    },
  });
