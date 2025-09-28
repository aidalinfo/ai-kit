type NonEmptyArray<T> = [T, ...T[]];

export type ChunkContentType = "text" | "json";

export type JsonLike =
  | string
  | number
  | boolean
  | null
  | JsonLike[]
  | { [key: string]: JsonLike };

interface ChunkSourceBase<TType extends ChunkContentType, TContent> {
  type: TType;
  content: TContent;
  metadata?: Record<string, unknown>;
}

export type TextChunkSource = ChunkSourceBase<"text", string>;
export type JsonChunkSource = ChunkSourceBase<"json", string | JsonLike>;
export type ChunkSource = TextChunkSource | JsonChunkSource;

export type JsonFormatMode = "auto" | "preserve" | "pretty";

export interface Chunk {
  /**
   * Zero-based position of the chunk in the final result.
   */
  index: number;
  /**
   * Character index (inclusive) of the first character in the original text.
   */
  start: number;
  /**
   * Character index (exclusive) of the last character in the original text.
   */
  end: number;
  /**
   * Text contained by the chunk.
   */
  content: string;
  /**
   * Type of content represented by the chunk.
   */
  type?: ChunkContentType;
  /**
   * Optional metadata associated with the chunk.
   */
  metadata?: Record<string, unknown>;
}

export interface RecursiveChunkOptions {
  /**
   * Maximum number of characters a chunk can contain before it is split.
   */
  chunkSize: number;
  /**
   * Number of characters to overlap between two consecutive chunks.
   */
  chunkOverlap?: number;
  /**
   * Ordered list of separators to try while recursively splitting the text.
   */
  separators?: NonEmptyArray<string>;
  /**
   * Trim the leading/trailing whitespace in each chunk.
   */
  trimChunks?: boolean;
}

export interface JsonRecursiveChunkOptions extends RecursiveChunkOptions {
  /**
   * Metadata attached to each generated chunk.
   */
  metadata?: Record<string, unknown>;
  /**
   * Controls how the JSON input is formatted prior to chunking.
   */
  format?: JsonFormatMode;
}

export const DEFAULT_SEPARATORS: NonEmptyArray<string> = ["\n\n", "\n", " ", ""];

const DEFAULT_JSON_SEPARATORS: NonEmptyArray<string> = ["\n  ", "\n", ", ", " ", ""];

const DEFAULT_CHUNK_OVERLAP = 0;

/**
 * Split a text into chunks similarly to LangChain's RecursiveCharacterTextSplitter.
 * The implementation preserves the original ordering of the text and produces
 * deterministic chunk boundaries for the same input/options pair.
 */
export function splitTextRecursively(
  text: string,
  options: RecursiveChunkOptions,
): Chunk[] {
  return annotateChunks(
    splitTextRecursivelyInternal(text, options),
    "text",
  );
}

/**
 * Split JSON content into chunks by first normalizing the JSON representation
 * and then applying the recursive splitter.
 */
export function splitJsonRecursively(
  json: string | JsonLike,
  options: JsonRecursiveChunkOptions,
): Chunk[] {
  const { metadata, format = "auto" } = options;
  const separators = options.separators ?? DEFAULT_JSON_SEPARATORS;

  const chunkOptions: RecursiveChunkOptions = {
    chunkSize: options.chunkSize,
    chunkOverlap: options.chunkOverlap,
    separators: separators as NonEmptyArray<string>,
    trimChunks: options.trimChunks,
  };

  const formatted = formatJsonInput(json, format);

  return annotateChunks(
    splitTextRecursivelyInternal(formatted, chunkOptions),
    "json",
    metadata,
  );
}

/**
 * Convenience helper returning plain strings instead of structured chunks.
 */
export function splitTextRecursivelyToStrings(
  text: string,
  options: RecursiveChunkOptions,
): string[] {
  return splitTextRecursivelyInternal(text, options).map((chunk) => chunk.content);
}

export class TChunkDocument {
  private readonly source: ChunkSource;

  private constructor(source: ChunkSource) {
    this.source = source;
  }

  static fromText(text: string, metadata?: Record<string, unknown>): TChunkDocument {
    return new TChunkDocument({ type: "text", content: text, metadata });
  }

  static fromJSON(json: string | JsonLike, metadata?: Record<string, unknown>): TChunkDocument {
    return new TChunkDocument({ type: "json", content: json, metadata });
  }

  chunk(options: RecursiveChunkOptions): Chunk[];
  chunk(options: JsonRecursiveChunkOptions): Chunk[];
  chunk(options: RecursiveChunkOptions | JsonRecursiveChunkOptions): Chunk[] {
    if (this.source.type === "json") {
      const jsonOptions = options as JsonRecursiveChunkOptions;
      return splitJsonRecursively(this.source.content, {
        ...jsonOptions,
        metadata: mergeMetadata(jsonOptions.metadata, this.source.metadata),
      });
    }

    return annotateChunks(
      splitTextRecursivelyInternal(this.source.content as string, options as RecursiveChunkOptions),
      "text",
      this.source.metadata,
    );
  }

  toString(format: JsonFormatMode = "auto"): string {
    if (this.source.type === "json") {
      return formatJsonInput(this.source.content, format);
    }

    return this.source.content as string;
  }
}

function splitTextRecursivelyInternal(
  text: string,
  options: RecursiveChunkOptions,
): Chunk[] {
  const {
    chunkSize,
    chunkOverlap = DEFAULT_CHUNK_OVERLAP,
    separators = DEFAULT_SEPARATORS,
    trimChunks = true,
  } = options;

  if (chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }

  if (chunkOverlap < 0) {
    throw new Error("chunkOverlap must be greater than or equal to 0");
  }

  if (chunkOverlap >= chunkSize) {
    throw new Error("chunkOverlap must be smaller than chunkSize");
  }

  if (text.length === 0) {
    return [];
  }

  const splits = recursiveSplit(text, separators, chunkSize);
  const merged = mergeSplits(splits, chunkSize, chunkOverlap);
  return buildChunks(text, merged, trimChunks);
}

function annotateChunks(
  chunks: Chunk[],
  type: ChunkContentType,
  metadata?: Record<string, unknown>,
): Chunk[] {
  return chunks.map((chunk) => {
    const mergedMetadata = chunk.metadata
      ? metadata
        ? { ...chunk.metadata, ...metadata }
        : chunk.metadata
      : metadata;

    return {
      ...chunk,
      type,
      ...(mergedMetadata ? { metadata: mergedMetadata } : {}),
    };
  });
}

function mergeMetadata(
  primary?: Record<string, unknown>,
  secondary?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!primary && !secondary) {
    return undefined;
  }

  if (!primary) {
    return secondary;
  }

  if (!secondary) {
    return primary;
  }

  return { ...secondary, ...primary };
}

function formatJsonInput(input: string | JsonLike, mode: JsonFormatMode): string {
  if (typeof input === "string") {
    if (mode === "preserve") {
      return input;
    }

    if (mode === "pretty" || mode === "auto") {
      try {
        const parsed = JSON.parse(input);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return input;
      }
    }

    return input;
  }

  const spacing = mode === "preserve" ? undefined : 2;

  try {
    return JSON.stringify(input, null, spacing);
  } catch {
    throw new Error("Unable to serialize JSON input");
  }
}

function recursiveSplit(
  text: string,
  separators: NonEmptyArray<string>,
  chunkSize: number,
): string[] {
  const separatorIndex = findFirstUsableSeparator(text, separators);
  const separator = separators[separatorIndex] ?? "";
  const splits = splitWithSeparator(text, separator);
  const nextSeparators = separators.slice(separatorIndex + 1) as string[];
  const results: string[] = [];

  for (const piece of splits) {
    if (!piece) {
      continue;
    }

    if (piece.length > chunkSize && nextSeparators.length > 0) {
      results.push(
        ...recursiveSplit(piece, nextSeparators as NonEmptyArray<string>, chunkSize),
      );
    } else if (piece.length > chunkSize) {
      results.push(...forceSplit(piece, chunkSize));
    } else {
      results.push(piece);
    }
  }

  return results;
}

function findFirstUsableSeparator(
  text: string,
  separators: NonEmptyArray<string>,
): number {
  for (let index = 0; index < separators.length; index += 1) {
    const separator = separators[index];
    if (separator === "" || text.includes(separator)) {
      return index;
    }
  }

  return separators.length - 1;
}

function splitWithSeparator(text: string, separator: string): string[] {
  if (separator === "") {
    return Array.from(text);
  }

  const pieces = text.split(separator);

  return pieces.map((piece, index) =>
    index < pieces.length - 1 ? `${piece}${separator}` : piece,
  );
}

function forceSplit(text: string, chunkSize: number): string[] {
  const forced: string[] = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    forced.push(text.slice(index, index + chunkSize));
  }
  return forced;
}

function mergeSplits(
  splits: string[],
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  const chunks: string[] = [];
  const current: string[] = [];
  let currentLength = 0;

  for (const split of splits) {
    const splitLength = split.length;
    if (splitLength === 0) {
      continue;
    }

    if (splitLength > chunkSize) {
      if (currentLength > 0) {
        chunks.push(current.join(""));
        current.length = 0;
        currentLength = 0;
      }
      chunks.push(...forceSplit(split, chunkSize));
      continue;
    }

    if (currentLength + splitLength > chunkSize) {
      if (currentLength > 0) {
        chunks.push(current.join(""));
      }

      while (currentLength > chunkOverlap && current.length > 0) {
        const removed = current.shift();
        if (typeof removed === "string") {
          currentLength -= removed.length;
        }
      }
    }

    current.push(split);
    currentLength += splitLength;
  }

  if (currentLength > 0) {
    chunks.push(current.join(""));
  }

  return chunks;
}

function buildChunks(text: string, rawChunks: string[], trimChunks: boolean): Chunk[] {
  const result: Chunk[] = [];
  let cursor = 0;

  rawChunks.forEach((rawChunk) => {
    const rawLength = rawChunk.length;
    const rawStart = cursor;
    const rawEnd = cursor + rawLength;
    cursor = rawEnd;

    if (rawLength === 0) {
      return;
    }

    if (!trimChunks) {
      result.push({
        index: result.length,
        start: rawStart,
        end: rawEnd,
        content: rawChunk,
      });
      return;
    }

    const trimmedStart = rawChunk.trimStart();
    const trimmedEnd = rawChunk.trimEnd();
    const leadingWhitespace = rawLength - trimmedStart.length;
    const trailingWhitespace = rawLength - trimmedEnd.length;
    const start = rawStart + leadingWhitespace;
    const end = rawEnd - trailingWhitespace;
    const content = rawChunk.trim();

    if (content.length === 0) {
      return;
    }

    result.push({
      index: result.length,
      start,
      end,
      content,
    });
  });

  return result;
}

