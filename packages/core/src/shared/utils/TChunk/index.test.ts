import { describe, expect, it } from "vitest";

import {
  splitTextRecursively,
  splitJsonRecursively,
  TChunkDocument,
  type JsonRecursiveChunkOptions,
} from "./index";

describe("splitTextRecursively", () => {
  it("annotates chunks with the text type", () => {
    const chunks = splitTextRecursively("Hello world", {
      chunkSize: 5,
      chunkOverlap: 1,
    });

    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach((chunk) => {
      console.log(chunk);
      expect(chunk.type).toBe("text");
    });
  });
});

describe("splitJsonRecursively", () => {
  it("formats and splits JSON objects", () => {
    const options: JsonRecursiveChunkOptions = {
      chunkSize: 32,
      metadata: { source: "object" },
    };

    const chunks = splitJsonRecursively(
      { foo: "bar", nested: { value: 1 } },
      options,
    );

    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach((chunk) => {
      expect(chunk.type).toBe("json");
      expect(chunk.metadata).toMatchObject({ source: "object" });
    });
  });

  it("respects the preserve format option for JSON strings", () => {
    const jsonString = '{"foo":"bar"}';
    const chunks = splitJsonRecursively(jsonString, {
      chunkSize: 32,
      format: "preserve",
    });

    expect(chunks.length).toBe(1);
    expect(chunks[0]?.content).toBe(jsonString);
  });
});

describe("TChunkDocument", () => {
  it("merges metadata when chunking JSON sources", () => {
    const doc = TChunkDocument.fromJSON(
      { foo: "bar" },
      { base: "doc", override: "doc" },
    );

    const chunks = doc.chunk({
      chunkSize: 32,
      metadata: { override: "option" },
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.metadata).toEqual({ base: "doc", override: "option" });
  });

  it("applies text metadata to text chunks", () => {
    const doc = TChunkDocument.fromText(
      "Once upon a time in a far away land",
      { origin: "story" },
    );

    const chunks = doc.chunk({ chunkSize: 12, chunkOverlap: 2 });

    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach((chunk) => {
      expect(chunk.type).toBe("text");
      expect(chunk.metadata).toMatchObject({ origin: "story" });
    });
  });

  it("renders JSON sources according to the requested format", () => {
    const doc = TChunkDocument.fromJSON({ foo: "bar" });

    expect(doc.toString("pretty")).toContain('\n  "foo": "bar"');
  });
});
