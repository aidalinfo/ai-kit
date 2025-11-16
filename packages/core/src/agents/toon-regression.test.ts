import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseToonStructuredOutput } from "./toon.js";
import { Output } from "ai";
import type { GenerateTextResult, ToolSet } from "ai";

describe("TOON regression tests", () => {
  it("catches the exact error from production: columns[ without count", async () => {
    // This is the exact schema from the production error
    const structured = Output.object({
      schema: z.object({
        name: z.string(),
        displayName: z.string(),
        description: z.string(),
        notes: z.array(z.string()),
        usableForDashboard: z.boolean(),
        columns: z.array(
          z.object({
            name: z.string(),
            detectedType: z.string(),
            completion: z.string(),
            potentialRole: z.string(),
            notes: z.string(),
          }),
        ),
      }),
    });

    // This is the exact TOON output that caused the error
    const result = {
      text: [
        "```toon",
        "name: Sheet1",
        "displayName: Analyse des données clients et transactions commerciales",
        'description: Cette feuille contient des données clients et de transactions commerciales couvrant des informations démographiques, géographiques et temporelles, ainsi que des indicateurs quantitatifs. Elle est utilisable pour la création de tableaux de bord permettant d\'analyser les volumes, les répartitions par catégories et les tendances dans le temps.',
        'notes[2]: "Données complètes sans valeurs manquantes (100% de couverture sur toutes les colonnes)","Date au format catégoriel à requalifier en type date pour analyses temporelles plus précises"',
        "usableForDashboard: true",
        "columns[", // ❌ MISSING COUNT!
        '  - name: "1"',
        "    detectedType: number",
        "    completion: 100%",
        "    potentialRole: identifier",
        '    notes: "Possiblement un ID unique ou code numérique à usage d\'identifiant"',
        "  - name: Dulce",
        "    detectedType: categorical",
        "    completion: 100%",
        "    potentialRole: dimension",
        '    notes: "Nom ou catégorie client, variable qualitative avec 50 modalités"',
        "```",
      ].join("\n"),
      response: {},
      usage: {},
      finishReason: "stop",
    } as unknown as GenerateTextResult<ToolSet, any>;

    try {
      await parseToonStructuredOutput(result, structured);
      throw new Error("Should have thrown an error!");
    } catch (error: any) {
      // Now we should get a much clearer error message BEFORE the TOON parser fails
      expect(error.message).toContain("Invalid TOON array syntax");
      expect(error.message).toContain('"columns[" is incomplete');
      expect(error.message).toContain("CORRECT: columns[5]:");
      expect(error.message).toContain(
        "LLM forgot to specify how many items are in the array",
      );

      // Should NOT be the cryptic "Missing colon after key" error
      expect(error.message).not.toContain("Missing colon after key");
    }
  });

  it("provides helpful message for the corrected version", async () => {
    const structured = Output.object({
      schema: z.object({
        name: z.string(),
        displayName: z.string(),
        columns: z.array(
          z.object({
            name: z.string(),
            detectedType: z.string(),
          }),
        ),
      }),
    });

    // Corrected version with proper count
    const result = {
      text: [
        "```toon",
        "name: Sheet1",
        "displayName: Analysis",
        "columns[2]:", // ✅ COUNT SPECIFIED
        "  - name: Column1",
        "    detectedType: number",
        "  - name: Column2",
        "    detectedType: string",
        "```",
      ].join("\n"),
      response: {},
      usage: {},
      finishReason: "stop",
    } as unknown as GenerateTextResult<ToolSet, any>;

    // This should work fine now
    await parseToonStructuredOutput(result, structured);

    expect((result as any).experimental_output).toEqual({
      name: "Sheet1",
      displayName: "Analysis",
      columns: [
        { name: "Column1", detectedType: "number" },
        { name: "Column2", detectedType: "string" },
      ],
    });
  });
});
