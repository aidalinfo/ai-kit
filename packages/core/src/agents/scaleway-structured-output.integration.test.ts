import { describe, it, expect } from "vitest";
import { Output, generateText } from "ai";
import { z } from "zod";
import { scaleway } from "../shared/utils/provider/scaleway.js";

const apiKey = process.env.SCALEWAY_API_KEY;

// Tests contre l'API Scaleway réelle — nécessite SCALEWAY_API_KEY
describe.skipIf(!apiKey)("Scaleway structured output (intégration)", () => {
  it(
    "retourne un objet JSON valide avec llama (non-thinking)",
    async () => {
      const schema = z.object({
        city: z.string(),
        country: z.string(),
      });

      const result = await generateText({
        model: scaleway("llama-3.3-70b-instruct"),
        prompt: "What is the capital of France? Return city and country.",
        output: Output.object({ schema }),
        maxOutputTokens: 100,
      });

      expect(result.output).toMatchObject({
        city: expect.any(String),
        country: expect.any(String),
      });
    },
    30_000,
  );

  it(
    "retourne un objet JSON valide avec qwen3 (thinking model)",
    async () => {
      const schema = z.object({
        city: z.string(),
        country: z.string(),
      });

      const result = await generateText({
        model: scaleway("qwen3-235b-a22b-instruct-2507"),
        prompt: "What is the capital of France? Return city and country.",
        output: Output.object({ schema }),
        maxOutputTokens: 512,
      });

      expect(result.output).toMatchObject({
        city: expect.any(String),
        country: expect.any(String),
      });
    },
    60_000,
  );
});
