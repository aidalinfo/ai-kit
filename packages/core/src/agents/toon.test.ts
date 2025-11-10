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

  it("coerces numeric fields to strings when schema expects a single string", async () => {
    const structured = Output.object({
      schema: z.object({
        siret: z.string(),
      }),
    });

    const result = {
      text: ["```toon", "siret: 38347481400100", "```"].join("\n"),
      response: {},
      usage: {},
      finishReason: "stop",
    } as unknown as GenerateTextResult<ToolSet, { siret: string }>;

    await parseToonStructuredOutput(result, structured);

    expect(
      (result as typeof result & { experimental_output: { siret: string } })
        .experimental_output,
    ).toEqual({
      siret: "38347481400100",
    });
  });

  it("coerces numeric fields inside arrays when schema expects strings", async () => {
    const structured = Output.object({
      schema: z.object({
        sirets: z.array(
          z.object({
            siret: z.string(),
          }),
        ),
      }),
    });

    const result = {
      text: ["```toon", "sirets[1]{siret}:", "  38347481400100", "```"].join(
        "\n",
      ),
      response: {},
      usage: {},
      finishReason: "stop",
    } as unknown as GenerateTextResult<
      ToolSet,
      { sirets: Array<{ siret: string }> }
    >;

    await parseToonStructuredOutput(result, structured);

    expect(
      (result as typeof result & {
        experimental_output: { sirets: Array<{ siret: string }> };
      }).experimental_output,
    ).toEqual({
      sirets: [{ siret: "38347481400100" }],
    });
  });

  describe("complex nested structures", () => {
    it("handles nested objects with multiple levels", async () => {
      const structured = Output.object({
        schema: z.object({
          user: z.object({
            profile: z.object({
              name: z.string(),
              age: z.number(),
            }),
            settings: z.object({
              theme: z.string(),
              notifications: z.boolean(),
            }),
          }),
        }),
      });

      const result = {
        text: [
          "```toon",
          "user:",
          "  profile:",
          "    name: Alice",
          "    age: 30",
          "  settings:",
          "    theme: dark",
          "    notifications: true",
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await parseToonStructuredOutput(result, structured);

      expect((result as any).experimental_output).toEqual({
        user: {
          profile: { name: "Alice", age: 30 },
          settings: { theme: "dark", notifications: true },
        },
      });
    });

    it("handles array of objects with nested objects", async () => {
      const structured = Output.object({
        schema: z.object({
          orders: z.array(
            z.object({
              id: z.number(),
              customer: z.object({
                name: z.string(),
                email: z.string(),
              }),
              total: z.number(),
            }),
          ),
        }),
      });

      const result = {
        text: [
          "```toon",
          "orders[2]:",
          "  - id: 1",
          "    customer:",
          "      name: Alice",
          "      email: alice@example.com",
          "    total: 150",
          "  - id: 2",
          "    customer:",
          "      name: Bob",
          "      email: bob@example.com",
          "    total: 200",
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await parseToonStructuredOutput(result, structured);

      expect((result as any).experimental_output).toEqual({
        orders: [
          {
            id: 1,
            customer: { name: "Alice", email: "alice@example.com" },
            total: 150,
          },
          {
            id: 2,
            customer: { name: "Bob", email: "bob@example.com" },
            total: 200,
          },
        ],
      });
    });
  });

  describe("inline arrays with special characters", () => {
    it("handles inline string arrays with commas (quoted)", async () => {
      const structured = Output.object({
        schema: z.object({
          notes: z.array(z.string()),
        }),
      });

      const result = {
        text: [
          "```toon",
          'notes[2]: "First note, with comma","Second note, also with comma"',
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await parseToonStructuredOutput(result, structured);

      expect((result as any).experimental_output).toEqual({
        notes: ["First note, with comma", "Second note, also with comma"],
      });
    });

    it("handles inline string arrays with colons (quoted)", async () => {
      const structured = Output.object({
        schema: z.object({
          items: z.array(z.string()),
        }),
      });

      const result = {
        text: [
          "```toon",
          'items[3]: "Item 1: description","Item 2: another desc","Item 3: final"',
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await parseToonStructuredOutput(result, structured);

      expect((result as any).experimental_output).toEqual({
        items: [
          "Item 1: description",
          "Item 2: another desc",
          "Item 3: final",
        ],
      });
    });

    it("handles long strings with special characters (quoted)", async () => {
      const structured = Output.object({
        schema: z.object({
          notes: z.array(z.string()),
        }),
      });

      const result = {
        text: [
          "```toon",
          'notes[3]: "La couverture des colonnes varie de 2% à 100%, certaines données sont incomplètes.","Les colonnes principales ont une bonne qualité, malgré quelques lacunes.","Le découpage temporel est complet : toutes les dates sont présentes."',
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await parseToonStructuredOutput(result, structured);

      expect((result as any).experimental_output).toEqual({
        notes: [
          "La couverture des colonnes varie de 2% à 100%, certaines données sont incomplètes.",
          "Les colonnes principales ont une bonne qualité, malgré quelques lacunes.",
          "Le découpage temporel est complet : toutes les dates sont présentes.",
        ],
      });
    });

    it("handles mixed quoted and unquoted inline arrays", async () => {
      const structured = Output.object({
        schema: z.object({
          tags: z.array(z.string()),
          categories: z.array(z.string()),
        }),
      });

      const result = {
        text: [
          "```toon",
          "tags[3]: javascript,typescript,python",
          'categories[2]: "Web Development, Frontend","Backend, APIs"',
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await parseToonStructuredOutput(result, structured);

      expect((result as any).experimental_output).toEqual({
        tags: ["javascript", "typescript", "python"],
        categories: ["Web Development, Frontend", "Backend, APIs"],
      });
    });
  });

  describe("real-world schema: sheet analysis", () => {
    it("handles complete sheet metadata with columns and notes", async () => {
      const structured = Output.object({
        schema: z.object({
          sheetName: z.string(),
          displayName: z.string(),
          description: z.string(),
          columns: z.array(
            z.object({
              column: z.string(),
              range: z.object({
                start: z.string(),
                end: z.string(),
              }),
            }),
          ),
          notes: z.array(z.string()),
          usableForDashboard: z.boolean(),
        }),
      });

      const result = {
        text: [
          "```toon",
          'sheetName: "Sheet 1 - COVID-19 Data"',
          'displayName: "Données COVID-19 : Analyses et Statistiques"',
          'description: "Ce tableau présente les données épidémiologiques détaillées du COVID-19 en France, incluant les cas confirmés, décès hospitaliers, et indicateurs clés."',
          "columns[3]:",
          "  - column: Date",
          "    range:",
          "      start: A2",
          "      end: A100",
          "  - column: Cas confirmés",
          "    range:",
          "      start: B2",
          "      end: B100",
          "  - column: Décès",
          "    range:",
          "      start: C2",
          "      end: C100",
          'notes[3]: "La couverture des colonnes varie de 2% à 100%, certaines données sont incomplètes.","Les colonnes principales ont une bonne couverture et qualité.","Le découpage temporel est complet sur toute la période."',
          "usableForDashboard: true",
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await parseToonStructuredOutput(result, structured);

      expect((result as any).experimental_output).toEqual({
        sheetName: "Sheet 1 - COVID-19 Data",
        displayName: "Données COVID-19 : Analyses et Statistiques",
        description:
          "Ce tableau présente les données épidémiologiques détaillées du COVID-19 en France, incluant les cas confirmés, décès hospitaliers, et indicateurs clés.",
        columns: [
          { column: "Date", range: { start: "A2", end: "A100" } },
          { column: "Cas confirmés", range: { start: "B2", end: "B100" } },
          { column: "Décès", range: { start: "C2", end: "C100" } },
        ],
        notes: [
          "La couverture des colonnes varie de 2% à 100%, certaines données sont incomplètes.",
          "Les colonnes principales ont une bonne couverture et qualité.",
          "Le découpage temporel est complet sur toute la période.",
        ],
        usableForDashboard: true,
      });
    });
  });

  describe("array normalization", () => {
    it("repairs mismatched counts for object and inline arrays", async () => {
      const structured = Output.object({
        schema: z.object({
          sheetName: z.string(),
          columns: z.array(
            z.object({
              column: z.string(),
              range: z.object({
                start: z.string(),
                end: z.string(),
              }),
            }),
          ),
          notes: z.array(z.string()),
        }),
      });

      const result = {
        text: [
          "```toon",
          "sheetName: Sheet1",
          "columns[6]:",
          "  - column: \"1\"",
          "    range:",
          "      start: A2",
          "      end: A100",
          "  - column: Dulce",
          "    range:",
          "      start: B2",
          "      end: B100",
          "  - column: Abril",
          "    range:",
          "      start: C2",
          "      end: C100",
          "  - column: Female",
          "    range:",
          "      start: D2",
          "      end: D100",
          "  - column: \"United States\"",
          "    range:",
          "      start: E2",
          "      end: E100",
          "  - column: \"32\"",
          "    range:",
          "      start: F2",
          "      end: F100",
          "  - column: \"1562\"",
          "    range:",
          "      start: H2",
          "      end: H100",
          'notes[1]: "Mesures numériques","Dimensions catégorielles"',
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<
        ToolSet,
        {
          sheetName: string;
          columns: Array<{ column: string; range: { start: string; end: string } }>;
          notes: string[];
        }
      >;

      await parseToonStructuredOutput(result, structured);

      const parsed = (result as typeof result & {
        experimental_output: {
          sheetName: string;
          columns: Array<{ column: string; range: { start: string; end: string } }>;
          notes: string[];
        };
      }).experimental_output;

      expect(parsed.columns).toHaveLength(7);
      expect(parsed.columns[0].column).toBe("1");
      expect(parsed.notes).toEqual([
        "Mesures numériques",
        "Dimensions catégorielles",
      ]);
    });

    it("repairs mismatched counts for tabular arrays", async () => {
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
          "users[1]{id,name}:",
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
        }).experimental_output.users,
      ).toHaveLength(2);
    });
  });

  describe("type coercion in complex structures", () => {
    it("coerces numeric IDs to strings in nested objects", async () => {
      const structured = Output.object({
        schema: z.object({
          company: z.object({
            siret: z.string(),
            name: z.string(),
            employees: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
              }),
            ),
          }),
        }),
      });

      const result = {
        text: [
          "```toon",
          "company:",
          "  siret: 38347481400100",
          "  name: Acme Corp",
          "  employees[2]{id,name}:",
          "    001,Alice",
          "    002,Bob",
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await parseToonStructuredOutput(result, structured);

      expect((result as any).experimental_output).toEqual({
        company: {
          siret: "38347481400100",
          name: "Acme Corp",
          employees: [
            { id: "001", name: "Alice" },
            { id: "002", name: "Bob" },
          ],
        },
      });
    });

    it("preserves numbers when schema expects numbers", async () => {
      const structured = Output.object({
        schema: z.object({
          stats: z.object({
            count: z.number(),
            percentage: z.number(),
          }),
          scores: z.array(z.number()),
        }),
      });

      const result = {
        text: [
          "```toon",
          "stats:",
          "  count: 42",
          "  percentage: 87.5",
          "scores[4]: 85,90,78,92",
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await parseToonStructuredOutput(result, structured);

      expect((result as any).experimental_output).toEqual({
        stats: { count: 42, percentage: 87.5 },
        scores: [85, 90, 78, 92],
      });
    });
  });

  describe("edge cases", () => {
    it("handles empty arrays", async () => {
      const structured = Output.object({
        schema: z.object({
          items: z.array(z.string()).default([]),
        }),
      });

      const result = {
        text: ["```toon", "items[0]:", "```"].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await parseToonStructuredOutput(result, structured);

      expect((result as any).experimental_output).toEqual({
        items: [],
      });
    });

    it("handles boolean values correctly", async () => {
      const structured = Output.object({
        schema: z.object({
          active: z.boolean(),
          verified: z.boolean(),
          premium: z.boolean(),
        }),
      });

      const result = {
        text: [
          "```toon",
          "active: true",
          "verified: false",
          "premium: true",
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await parseToonStructuredOutput(result, structured);

      expect((result as any).experimental_output).toEqual({
        active: true,
        verified: false,
        premium: true,
      });
    });

    it("throws descriptive error on malformed TOON", async () => {
      const structured = Output.object({
        schema: z.object({
          name: z.string(),
        }),
      });

      // Invalid TOON: missing colon separator
      const result = {
        text: ["```toon", "name", "value", "```"].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await expect(
        parseToonStructuredOutput(result, structured),
      ).rejects.toThrow("Failed to decode TOON output");
    });

    it("throws helpful error on array length mismatch", async () => {
      const structured = Output.object({
        schema: z.object({
          columns: z.array(
            z.object({
              name: z.string(),
              range: z.object({
                start: z.string(),
                end: z.string(),
              }),
            }),
          ),
        }),
      });

      // Invalid TOON: declares 3 items but provides none
      const result = {
        text: [
          "```toon",
          "columns[3]:",
          "  # Missing items",
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      try {
        await parseToonStructuredOutput(result, structured);
        throw new Error("Should have thrown");
      } catch (error: any) {
        expect(error.message).toContain("Array length mismatch");
        expect(error.message).toContain("Expected 3 items but got 0");
        expect(error.message).toContain(
          "LLM declared an array size but didn't provide all items",
        );
      }
    });
  });

  describe("prompt generation", () => {
    it("includes inline array quoting instructions", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          notes: {
            type: "array",
            items: { type: "string" },
          },
        },
      };

      const prompt = buildToonSystemPrompt("Base system", schema);

      expect(prompt).toContain("CRITICAL RULES:");
      expect(prompt).toContain("Array syntax MUST be complete");
      expect(prompt).toContain("CORRECT: columns[5]: or users[3]{name,age}:");
      expect(prompt).toContain("WRONG: columns[ or columns[] or columns:");
      expect(prompt).toContain("Array lengths MUST match");
      expect(prompt).toContain("comma (,), colon (:)");
      expect(prompt).toContain("wrap it in double quotes");
      expect(prompt).toContain("Never use list format (- item) for string arrays");
    });

    it("generates example with inline format for string arrays", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
      };

      const prompt = buildToonSystemPrompt(undefined, schema);

      expect(prompt).toContain("```toon");
      expect(prompt).toMatch(/tags\[\d+\]/);
    });
  });

  describe("array syntax validation", () => {
    it("detects incomplete array syntax (missing count)", async () => {
      const structured = Output.object({
        schema: z.object({
          columns: z.array(
            z.object({
              name: z.string(),
            }),
          ),
        }),
      });

      // Invalid TOON: columns[ without the count
      const result = {
        text: [
          "```toon",
          "columns[",
          "  - name: Column A",
          "  - name: Column B",
          "```",
        ].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      try {
        await parseToonStructuredOutput(result, structured);
        throw new Error("Should have thrown");
      } catch (error: any) {
        expect(error.message).toContain("Invalid TOON array syntax");
        expect(error.message).toContain('"columns[" is incomplete');
        expect(error.message).toContain("CORRECT: columns[5]:");
        expect(error.message).toContain("WRONG: columns[");
      }
    });

    it("detects empty bracket array syntax", async () => {
      const structured = Output.object({
        schema: z.object({
          items: z.array(z.string()),
        }),
      });

      // Invalid TOON: items[]: without count
      const result = {
        text: ["```toon", "items[]: value1,value2", "```"].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      try {
        await parseToonStructuredOutput(result, structured);
        throw new Error("Should have thrown");
      } catch (error: any) {
        expect(error.message).toContain("Invalid TOON array syntax");
        expect(error.message).toContain('"items[]:" has empty brackets');
        expect(error.message).toContain("items[5]:");
      }
    });

    it("allows valid array syntax with count", async () => {
      const structured = Output.object({
        schema: z.object({
          items: z.array(z.string()),
        }),
      });

      // Valid TOON
      const result = {
        text: ["```toon", "items[2]: value1,value2", "```"].join("\n"),
        response: {},
        usage: {},
        finishReason: "stop",
      } as unknown as GenerateTextResult<ToolSet, any>;

      await parseToonStructuredOutput(result, structured);

      expect((result as any).experimental_output).toEqual({
        items: ["value1", "value2"],
      });
    });
  });
});
