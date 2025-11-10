import { describe, expect, it } from "vitest";
import { Output, type GenerateTextResult, type ToolSet } from "ai";
import { z } from "zod";

import { buildToonSystemPrompt, parseToonStructuredOutput } from "./toon.js";
import type { JSONSchema7 } from "ai";

describe("toon helpers", () => {
  it("embeds the schema example inside the system prompt", () => {
    const schema: JSONSchema7 = {
      type: "object",
      properties: {
        users: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "integer" },
              name: { type: "string" },
            },
            required: ["id", "name"],
          },
        },
      },
      required: ["users"],
    };

    const prompt = buildToonSystemPrompt("Base instructions", schema);
    expect(prompt).toContain("Base instructions");
    expect(prompt).toContain("```toon");
    expect(prompt).toMatch(/users\[\d+\]\{id,name\}/);
  });

  it("parses a TOON payload and attaches experimental_output", async () => {
    const structured = Output.object({
      schema: z.object({
        users: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
          }),
        ),
      }),
    });

    const result = {
      text: [
        "```toon",
        "users[2]{id,name}:",
        "  1,Alice",
        "  2,Bob",
        "```",
      ].join("\n"),
      response: {},
      usage: {},
      finishReason: "stop",
    } as unknown as GenerateTextResult<
      ToolSet,
      { users: Array<{ id: number; name: string }> }
    >;

    await parseToonStructuredOutput(result, structured);

    expect(
      (result as typeof result & {
        experimental_output: { users: Array<{ id: number; name: string }> };
      }).experimental_output,
    ).toEqual({
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
    });
  });
});
