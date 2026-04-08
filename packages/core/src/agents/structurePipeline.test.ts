import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateTextMock,
  streamTextMock,
  jsonSchemaMock,
  outputObjectMock,
} = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  streamTextMock: vi.fn(),
  jsonSchemaMock: vi.fn((schema: unknown) => schema),
  outputObjectMock: vi.fn(({ schema }: { schema: unknown }) => ({
    type: "object",
    schema,
  })),
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
  streamText: streamTextMock,
  jsonSchema: jsonSchemaMock,
  Output: {
    object: outputObjectMock,
  },
}));

vi.mock("./structuredOutputSchema.js", () => ({
  getJsonSchemaFromStructuredOutput: vi.fn(async () => ({
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
  })),
}));

import {
  generateWithStructuredPipeline,
  shouldUseStructuredPipeline,
  streamWithStructuredPipeline,
} from "./structurePipeline.js";

class MockStreamResult {
  text: Promise<string>;
  private value: unknown;

  constructor(text: string) {
    this.text = Promise.resolve(text);
  }

  get experimental_output() {
    return this.value;
  }

  setExperimentalOutput(output: unknown) {
    this.value = output;
  }
}

function asAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

describe("structurePipeline", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    streamTextMock.mockReset();
    jsonSchemaMock.mockClear();
    outputObjectMock.mockClear();
  });

  it("shouldUseStructuredPipeline respecte toon, type et provider", () => {
    const structuredOutput = { type: "object" } as any;

    expect(shouldUseStructuredPipeline({ provider: "anthropic" } as any, {}, structuredOutput)).toBe(
      true,
    );
    expect(shouldUseStructuredPipeline({ provider: "openai" } as any, {}, structuredOutput)).toBe(
      false,
    );
    expect(shouldUseStructuredPipeline({ provider: "anthropic" } as any, {}, undefined)).toBe(false);
    expect(
      shouldUseStructuredPipeline(
        { provider: "anthropic" } as any,
        {},
        { type: "text" } as any,
      ),
    ).toBe(false);
    expect(
      shouldUseStructuredPipeline({ provider: "anthropic" } as any, {}, structuredOutput, {
        toon: true,
      }),
    ).toBe(false);
  });

  it("génère un objet structuré et expose experimental_output", async () => {
    const textResult = { text: "Réponse libre" } as any;
    generateTextMock.mockResolvedValueOnce(textResult);
    generateTextMock.mockResolvedValueOnce({ output: { summary: "OK" } });

    const result = await generateWithStructuredPipeline({
      model: { provider: "anthropic" } as any,
      system: "system",
      structuredOutput: { type: "object" } as any,
      options: {
        prompt: "Fais un résumé",
        maxOutputTokens: 128,
        temperature: 0,
      } as any,
      telemetryEnabled: false,
      loopToolsEnabled: false,
    });

    expect(result).toBe(textResult);
    expect((result as any).experimental_output).toEqual({ summary: "OK" });
    expect(generateTextMock).toHaveBeenCalledTimes(2);

    const secondCallPayload = generateTextMock.mock.calls[1]?.[0];
    expect(secondCallPayload.messages).toEqual([
      { role: "user", content: "Fais un résumé" },
      { role: "assistant", content: "Réponse libre" },
    ]);
    expect(secondCallPayload.maxOutputTokens).toBe(128);
    expect(secondCallPayload.temperature).toBe(0);
  });

  it("préserve les messages existants quand aucun user n'est trouvé", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "Texte final" });
    generateTextMock.mockResolvedValueOnce({ output: { summary: "Done" } });

    await generateWithStructuredPipeline({
      model: { provider: "anthropic" } as any,
      structuredOutput: { type: "object" } as any,
      options: {
        messages: [{ role: "assistant", content: "Contexte assistant" }],
      } as any,
      telemetryEnabled: false,
      loopToolsEnabled: false,
    });

    const secondCallPayload = generateTextMock.mock.calls[1]?.[0];
    expect(secondCallPayload.messages).toEqual([
      { role: "assistant", content: "Contexte assistant" },
      { role: "assistant", content: "Texte final" },
    ]);
  });

  it("propage experimental_output et partialOutputStream en streaming", async () => {
    const baseStreamResult = new MockStreamResult("Texte stream") as any;
    const objectStream = {
      output: Promise.resolve({ summary: "stream-structured" }),
      partialOutputStream: asAsyncIterable([{ summary: "partiel" }]),
    };

    streamTextMock.mockReturnValueOnce(baseStreamResult);
    streamTextMock.mockResolvedValueOnce(objectStream);

    const result = await streamWithStructuredPipeline({
      model: { provider: "anthropic" } as any,
      structuredOutput: { type: "object" } as any,
      options: { prompt: "stream" } as any,
      telemetryEnabled: false,
      loopToolsEnabled: false,
    });

    const partials = await collect((result as any).experimental_partialOutputStream);
    expect(partials).toEqual([{ summary: "partiel" }]);

    await Promise.resolve();
    expect((result as any).experimental_output).toEqual({ summary: "stream-structured" });
  });

  it("remonte l'erreur d'object stream via partial stream et experimental_output", async () => {
    const baseStreamResult = new MockStreamResult("Texte stream") as any;
    const failure = new Error("structured stream failed");

    streamTextMock.mockReturnValueOnce(baseStreamResult);
    streamTextMock.mockResolvedValueOnce({
      output: Promise.reject(failure),
      partialOutputStream: asAsyncIterable([]),
    });

    const result = await streamWithStructuredPipeline({
      model: { provider: "anthropic" } as any,
      structuredOutput: { type: "object" } as any,
      options: { prompt: "stream" } as any,
      telemetryEnabled: false,
      loopToolsEnabled: false,
    });

    await expect(collect((result as any).experimental_partialOutputStream)).rejects.toThrow(
      "structured stream failed",
    );
    expect(() => (result as any).experimental_output).toThrow("structured stream failed");
  });
});
