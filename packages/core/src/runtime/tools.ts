import { tool as defineTool } from "ai";
import type { Tool, ToolCallOptions, ToolExecuteFunction } from "ai";

import { RuntimeStore, RUNTIME_CONTEXT_FIELD } from "./store.js";

export interface RuntimeToolExecuteContext<State extends Record<string, unknown>> {
  runtime: RuntimeStore<State>;
  options: ToolCallOptions;
}

export type RuntimeToolDefinition<
  Input,
  Output,
  State extends Record<string, unknown>,
> = Omit<Tool<Input, Output>, "execute"> & {
  execute: (
    input: Input,
    context: RuntimeToolExecuteContext<State>,
  ) => ReturnType<ToolExecuteFunction<Input, Output>>;
};

export function createRuntimeTool<
  Input,
  Output,
  State extends Record<string, unknown> = Record<string, unknown>,
>(definition: RuntimeToolDefinition<Input, Output, State>) {
  const { execute, ...rest } = definition;

  const toolDefinition = {
    ...(rest as Omit<Tool<Input, Output>, "execute">),
    execute: (input: Input, options: ToolCallOptions) => {
      const runtime = resolveRuntime<State>(options);
      return execute(input, { runtime, options });
    },
  } as Tool<Input, Output>;

  return defineTool<Input, Output>(toolDefinition);
}

export function resolveRuntime<State extends Record<string, unknown>>(
  options: ToolCallOptions,
) {
  const asyncRuntime = RuntimeStore.current<State>();
  if (asyncRuntime && !asyncRuntime.isDisposed()) {
    return asyncRuntime;
  }

  const fromContext = RuntimeStore.resolveFromExperimentalContext<State>(
    options.experimental_context,
  );

  if (fromContext && !fromContext.isDisposed()) {
    return fromContext;
  }

  throw new Error(
    "No runtime store available for this tool execution. Ensure the agent call provides a runtime instance.",
  );
}

export function getRuntimeFromOptions<State extends Record<string, unknown>>(
  options: ToolCallOptions,
) {
  return RuntimeStore.resolveFromExperimentalContext<State>(
    options.experimental_context,
  );
}

export function attachRuntimeToContext(
  context: unknown,
  runtime: RuntimeStore<any> | undefined,
) {
  return RuntimeStore.mergeExperimentalContext(context, runtime);
}

export function hasRuntime(context: unknown) {
  if (!context || typeof context !== "object") {
    return false;
  }

  return RUNTIME_CONTEXT_FIELD in (context as Record<string, unknown>);
}

