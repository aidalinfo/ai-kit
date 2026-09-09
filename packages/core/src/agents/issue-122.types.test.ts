// Regression tests for issue #122 — strict-mode type assignability.
// A concrete `Output<T>` / `Tool<I, O>` produced by the public API (or the raw
// `ai` SDK) must stay assignable to the exported `StructuredOutput` / tool
// signatures under `strict: true`. These are compile-time only assertions.
import { describe, it, expectTypeOf } from "vitest";
import { z } from "zod";
import { Output as SdkOutput, type Tool } from "ai";

import { Agent, Output } from "./index.js";
import type { AgentTools, StructuredOutput } from "./types.js";

describe("issue #122 — strict type assignability", () => {
  const agent = new Agent({ name: "t", model: {} as any });

  it("infers OUTPUT from Output.object() without explicit generics", () => {
    const structured = Output.object({
      schema: z.object({ cells: z.array(z.object({ v: z.string() })) }),
    });

    // No generic arguments — OUTPUT must be inferred, not collapse to `never`.
    const call = () =>
      agent.generate({ prompt: "x", structuredOutput: structured });
    expectTypeOf(call).returns.resolves.toHaveProperty("text");
  });

  it("accepts a raw ai-SDK Output where StructuredOutput is expected", () => {
    const raw = SdkOutput.object({
      schema: z.object({ notes: z.array(z.string()) }),
    });
    expectTypeOf(raw).toMatchTypeOf<StructuredOutput<unknown, unknown>>();
  });

  it("accepts a Tool<{}, any> in the public tools type", () => {
    expectTypeOf<Record<string, Tool<{}, any>>>().toMatchTypeOf<AgentTools>();
  });

  // Regression for the follow-up gap: a provider-defined tool built by the
  // consumer's own `ai` install (or a different major, e.g. v7) has a
  // structurally distinct `inputSchema` and must not be constrained to `never`.
  it("accepts a cross-version / foreign provider tool record", () => {
    type ForeignFlexibleSchema<T> = { readonly _brand: "v7"; readonly __t?: T };
    type ForeignTool<INPUT = any, OUTPUT = any> = {
      description?: string;
      inputSchema: ForeignFlexibleSchema<INPUT>;
      execute?: (input: INPUT) => Promise<OUTPUT>;
    };
    expectTypeOf<{ google_search: ForeignTool<{}, any> }>().toMatchTypeOf<AgentTools>();
  });
});
