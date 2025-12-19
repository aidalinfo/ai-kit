import { describe, expect, test, vi, afterEach } from "vitest";

import { createRag, MemoryVectorStore, RagDocument } from "./index.js";
import type { LanguageModel } from "ai";
import * as aiSdk from "ai";

const simpleEmbedder = async (values: string[]) =>
  values.map((value) => {
    const length = value.length || 1;
    const words = value.split(/\s+/).filter(Boolean).length || 1;
    return [length, words];
  });

const createEngine = () =>
  createRag({
    embedder: simpleEmbedder,
    store: new MemoryVectorStore(),
    chunker: { size: 1024, overlap: 0 },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RAG ingestion and search", () => {
  test("ingest and search returns ranked chunks", async () => {
    const rag = createEngine();
    const doc = RagDocument.fromText("Hello world from AI Kit", { topic: "greeting" }, "demo");

    await rag.ingest({ namespace: "kb", documents: [doc] });

    const results = await rag.search({ namespace: "kb", query: "Hello" });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.chunk.documentId).toBe(doc.id);
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  test("replace mode clears previous namespace content", async () => {
    const rag = createEngine();
    await rag.ingest({ namespace: "kb", documents: [RagDocument.fromText("First doc")] });
    await rag.ingest({
      namespace: "kb",
      documents: [RagDocument.fromText("Second doc")],
      upsertMode: "replace",
    });

    const results = await rag.search({ namespace: "kb", query: "First" });
    expect(results.length).toBe(0);

    const newResults = await rag.search({ namespace: "kb", query: "Second" });
    expect(newResults[0]?.chunk.text).toContain("Second");
  });
});

describe("RAG answer", () => {
  test("answer builds prompt and delegates to generateText", async () => {
    const generateSpy = vi
      .spyOn(aiSdk, "generateText")
      .mockResolvedValue({ text: "Mocked answer" } as Awaited<ReturnType<typeof aiSdk.generateText>>);
    const rag = createEngine();
    await rag.ingest({
      namespace: "kb",
      documents: [RagDocument.fromText("Paris is in France")],
    });

    const result = await rag.answer({
      namespace: "kb",
      query: "Where is Paris?",
      model: {} as LanguageModel,
    });

    expect(generateSpy).toHaveBeenCalledTimes(1);
    const call = generateSpy.mock.calls[0]?.[0] as { prompt: string };
    expect(call.prompt).toContain("Paris is in France");
    expect(call.prompt).toContain("Where is Paris?");
    expect(result.text).toBe("Mocked answer");
  });

  test("answer.stream uses streamText", async () => {
    const streamSpy = vi
      .spyOn(aiSdk, "streamText")
      .mockResolvedValue({
        toAIStreamResponse: () => "stream",
      } as unknown as Awaited<ReturnType<typeof aiSdk.streamText>>);
    const rag = createEngine();
    await rag.ingest({
      namespace: "kb",
      documents: [RagDocument.fromText("Node.js uses JavaScript")],
    });

    const stream = await rag.answer.stream({
      namespace: "kb",
      query: "What language powers Node.js?",
      model: {} as LanguageModel,
    });

    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(typeof stream.toAIStreamResponse).toBe("function");
  });
});
