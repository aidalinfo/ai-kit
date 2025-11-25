import { describe, it, expectTypeOf } from "vitest";
import { Output } from "./index.js";
import { z } from "zod";

import type {
  AgentStructuredOutput,
  StructuredOutput,
} from "./types.js";
import type { PartialObject } from "ai";

describe("AgentStructuredOutput", () => {
  it("infers the output type when receiving a schema", () => {
    const schema = z.object({
      filenameSuggestion: z.string(),
      imageType: z.enum(["meuble", "neutre"]),
    });

    const structured = Output.object({
      schema,
    });

    expectTypeOf(structured).toMatchTypeOf<AgentStructuredOutput<typeof schema>>();
  });

  it("remains backward compatible with plain output types", () => {
    type LegacyOutput = AgentStructuredOutput<{ foo: string }>;

    expectTypeOf<LegacyOutput>().toEqualTypeOf<
      StructuredOutput<{ foo: string }, PartialObject<{ foo: string }>>
    >();
  });
});
