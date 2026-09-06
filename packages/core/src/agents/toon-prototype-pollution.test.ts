import { decode } from "@toon-format/toon";
import type { GenerateTextResult, ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseToonStructuredOutput } from "./toon.js";
import type { StructuredOutput } from "./types.js";

// Payload « hostile » tel qu'un LLM pourrait le produire sous injection de prompt.
const POISONED_TOON = [
  "```toon",
  "__proto__:",
  "  polluted: true",
  "constructor:",
  "  prototype:",
  "    polluted: true",
  "name: safe",
  "```",
].join("\n");

const NAME_ONLY_JSON_SCHEMA = {
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
} as const;

function fakeResult(text: string) {
  return {
    text,
    response: {},
    usage: {},
    finishReason: "stop",
  } as unknown as GenerateTextResult<ToolSet, unknown> & {
    experimental_output?: Record<string, unknown>;
  };
}

describe("TOON prototype pollution (CVE-2026-82404)", () => {
  it("decode() keeps a __proto__ key as an own property instead of rewiring the prototype", () => {
    const decoded = decode("__proto__:\n  polluted: true\nname: safe") as Record<
      string,
      unknown
    >;

    expect(decoded.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("parseToonStructuredOutput never exposes prototype keys, even without parseOutput", async () => {
    // Sans `parseOutput`, l'objet coercé par le schéma est exposé tel quel :
    // c'est le chemin où une recopie naïve de `__proto__` empoisonnerait le résultat.
    const structured: StructuredOutput<unknown, unknown> = {
      type: "object",
      responseFormat: { schema: NAME_ONLY_JSON_SCHEMA },
    };
    const result = fakeResult(POISONED_TOON);

    await parseToonStructuredOutput(result, structured);

    const output = result.experimental_output as Record<string, unknown>;
    expect(output.name).toBe("safe");
    expect(output.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(output, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(output, "constructor")).toBe(false);
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("parseToonStructuredOutput with a zod parser drops prototype keys as well", async () => {
    const { Output } = await import("ai");
    const structured = Output.object({ schema: z.object({ name: z.string() }) });
    const result = fakeResult(POISONED_TOON);

    await parseToonStructuredOutput(result, structured);

    const output = result.experimental_output as Record<string, unknown>;
    expect(output).toEqual({ name: "safe" });
    expect(output.polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });
});
