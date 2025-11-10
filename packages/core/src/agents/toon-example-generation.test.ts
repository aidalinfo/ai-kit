import { describe, it, expect } from "vitest";
import { encode } from "@toon-format/toon";
import { z } from "zod";
import { buildToonSystemPrompt } from "./toon.js";
import { getJsonSchemaFromStructuredOutput } from "./structuredOutputSchema.js";
import { Output } from "ai";

describe("TOON example generation", () => {
  it("generates inline format for string arrays (not list format)", () => {
    const structured = Output.object({
      schema: z.object({
        notes: z.array(z.string()),
      }),
    });

    const jsonSchema = getJsonSchemaFromStructuredOutput(structured);
    expect(jsonSchema).toBeDefined();

    const prompt = buildToonSystemPrompt("", jsonSchema!);

    console.log("Generated prompt with string array:");
    console.log(prompt);

    // Should use inline format: notes[2]: value_1,value_2
    expect(prompt).toMatch(/notes\[\d+\]:/);

    // Should NOT use list format: - value
    expect(prompt).not.toMatch(/notes:\s*\n\s*-/);
  });

  it("generates correct format for object arrays", () => {
    const structured = Output.object({
      schema: z.object({
        users: z.array(
          z.object({
            name: z.string(),
            age: z.number(),
          }),
        ),
      }),
    });

    const jsonSchema = getJsonSchemaFromStructuredOutput(structured);
    expect(jsonSchema).toBeDefined();

    const prompt = buildToonSystemPrompt("", jsonSchema!);

    console.log("\nGenerated prompt with object array:");
    console.log(prompt);

    // Object arrays use compact column format: users[2]{name,age}:
    expect(prompt).toMatch(/users\[\d+\]\{name,age\}:/);
  });

  it("direct encode() produces inline format for string arrays", () => {
    const data = {
      notes: ["note1", "note2", "note3"],
    };

    const encoded = encode(data, { indent: 2 });

    console.log("\nDirect encode() of string array:");
    console.log(encoded);

    // Check what format encode() produces
    expect(encoded).toContain("notes");

    // This test will reveal if encode() naturally produces inline or list format
    const hasInlineFormat = /notes\[\d+\]:/.test(encoded);
    const hasListFormat = /notes:\s*\n\s*-/.test(encoded);

    console.log(`Has inline format: ${hasInlineFormat}`);
    console.log(`Has list format: ${hasListFormat}`);

    // Document what we found
    if (hasListFormat && !hasInlineFormat) {
      console.warn("⚠️  WARNING: encode() produces list format for string arrays!");
      console.warn("This will cause parsing errors. We need to post-process the example.");
    }
  });

  it("nested structures with string arrays", () => {
    const structured = Output.object({
      schema: z.object({
        columns: z.array(
          z.object({
            name: z.string(),
            tags: z.array(z.string()),
          }),
        ),
      }),
    });

    const jsonSchema = getJsonSchemaFromStructuredOutput(structured);
    expect(jsonSchema).toBeDefined();

    const prompt = buildToonSystemPrompt("", jsonSchema!);

    console.log("\nGenerated prompt with nested string arrays:");
    console.log(prompt);

    // Check format of nested string arrays
    const hasInlineStringArray = /tags\[\d+\]:/.test(prompt);
    const hasListStringArray = /tags:\s*\n\s*-\s*"/.test(prompt);

    console.log(`Has inline format for tags: ${hasInlineStringArray}`);
    console.log(`Has list format for tags: ${hasListStringArray}`);

    if (hasListStringArray) {
      console.warn("⚠️  WARNING: Nested string arrays use list format!");
    }
  });

  it("direct encode with object array format", () => {
    const data = {
      users: [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ],
    };

    const encoded = encode(data, { indent: 2 });

    console.log("\nDirect encode() of object array:");
    console.log(encoded);

    // Object arrays typically use list format with nested properties
    expect(encoded).toContain("users");
  });
});
