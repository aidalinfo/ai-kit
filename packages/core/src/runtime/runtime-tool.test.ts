import { describe, expect, it } from "vitest";

import { createRuntime, RuntimeStore } from "./store.js";
import {
  attachRuntimeToContext,
  createRuntimeTool,
} from "./tools.js";

describe("createRuntimeTool", () => {
  it("exposes runtime state seeded outside the tool", async () => {
    const runtime = createRuntime<{ value: string }>();

    let runtimeFromContext: RuntimeStore<{ value: string }> | undefined;
    let runtimeFromCurrent: RuntimeStore<{ value: string }> | undefined;

    const tool = createRuntimeTool<
      { inputValue: string },
      { storedValue: string },
      { value: string }
    >({
      description: "Persists a value inside the runtime store",
      // Schema is irrelevant for this runtime-focused test.
      inputSchema: {} as any,
      execute: async (_input, context) => {
        runtimeFromContext = context.runtime;
        runtimeFromCurrent = RuntimeStore.current<{ value: string }>();

        return { storedValue: context.runtime.require("value") };
      },
    });

    const execute = tool.execute!;

    const result = await runtime.run(async () => {
      runtime.set("value", "seeded-outside");

      return execute({ inputValue: "ignored" }, {
        toolCallId: "call-1",
        messages: [],
      });
    });

    expect(result).toEqual({ storedValue: "seeded-outside" });
    expect(runtimeFromContext).toBe(runtime);
    expect(runtimeFromCurrent).toBe(runtime);
    expect(runtime.require("value")).toBe("seeded-outside");
  });

  it("falls back to experimental context when runtime is not bound", async () => {
    const runtime = createRuntime<{ counter: number }>();

    let runtimeFromContext: RuntimeStore<{ counter: number }> | undefined;
    let runtimeFromCurrent: RuntimeStore<{ counter: number }> | undefined;

    const tool = createRuntimeTool<
      { delta: number },
      { counter: number },
      { counter: number }
    >({
      description: "Increment a counter stored in runtime",
      // Schema is irrelevant for this runtime-focused test.
      inputSchema: {} as any,
      execute: async (input, context) => {
        runtimeFromContext = context.runtime;
        runtimeFromCurrent = RuntimeStore.current<{ counter: number }>();

        const current = context.runtime.get("counter") ?? 0;
        const next = current + input.delta;
        context.runtime.set("counter", next);
        return { counter: next };
      },
    });

    const execute = tool.execute!;

    const result = await execute(
      { delta: 3 },
      {
        toolCallId: "call-2",
        messages: [],
        experimental_context: attachRuntimeToContext({}, runtime),
      },
    );

    expect(result).toEqual({ counter: 3 });
    expect(runtimeFromContext).toBe(runtime);
    expect(runtimeFromCurrent).toBeUndefined();
    expect(runtime.require("counter")).toBe(3);
    expect(runtime.isDisposed()).toBe(false);
  });
});
