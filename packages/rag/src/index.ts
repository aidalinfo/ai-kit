import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import {
  splitTextRecursively,
  type Chunk,
  type RecursiveChunkOptions,
} from "@ai_kit/core";
import {
  embedMany as sdkEmbedMany,
  generateText,
  streamText,
  type EmbeddingModel,
  type LanguageModel,
} from "ai";
import { z } from "zod";

export type RagNamespace = string;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type LegacyEmbeddingModel = { specificationVersion?: "v1"; [key: string]: unknown };
type AnyEmbeddingModel = EmbeddingModel | LegacyEmbeddingModel;

export interface RagDocumentInput {
  id?: string;
  text: string;
  metadata?: Record<string, unknown>;
  source?: string;
  mime?: string;
}

export class RagDocument {
  readonly id: string;
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
  readonly source?: string;
  readonly mime?: string;

  constructor(input: RagDocumentInput) {
    this.id = input.id ?? randomUUID();
    this.text = input.text;
    this.metadata = input.metadata;
    this.source = input.source;
    this.mime = input.mime;
  }

  static fromText(text: string, metadata?: Record<string, unknown>, source?: string): RagDocument {
    return new RagDocument({ text, metadata, source });
  }

  static fromJSON(
    json: JsonValue,
    metadata?: Record<string, unknown>,
    source?: string,
  ): RagDocument {
    const serialized = typeof json === "string" ? json : JSON.stringify(json);
    return new RagDocument({
      text: serialized,
      metadata,
      source,
      mime: "application/json",
    });
  }

  static async fromFile(
    path: string,
    metadata?: Record<string, unknown>,
  ): Promise<RagDocument> {
    const content = await readFile(path, "utf8");
    return new RagDocument({
      text: content,
      metadata,
      source: path,
      mime: inferMimeFromPath(path),
    });
  }
}

export interface ChunkerConfig {
  strategy?: "recursive";
  size?: number;
  overlap?: number;
  separators?: string[];
  trim?: boolean;
}

export interface ChunkedDocument {
  id: string;
  documentId: string;
  text: string;
  index: number;
  metadata?: Record<string, unknown>;
  source?: string;
  start?: number;
  end?: number;
}

export type Embedder = (values: string[]) => Promise<number[][]>;

export interface VectorRecord {
  id: string;
  vector: number[];
  text: string;
  namespace: RagNamespace;
  documentId?: string;
  chunkIndex?: number;
  metadata?: Record<string, unknown>;
  source?: string;
  start?: number;
  end?: number;
}

export interface VectorSearchResult {
  chunk: ChunkedDocument;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface VectorQuery {
  namespace: RagNamespace;
  queryVector: number[];
  topK?: number;
  filter?: Record<string, unknown>;
}

export interface VectorStore {
  upsert(input: { namespace: RagNamespace; vectors: VectorRecord[] }): Promise<void>;
  query(input: VectorQuery): Promise<VectorSearchResult[]>;
  deleteNamespace?(namespace: RagNamespace): Promise<void>;
  health?(): Promise<void>;
}

export interface RagHooks {
  onIngest?(payload: {
    namespace: RagNamespace;
    documents: RagDocument[];
    vectors: VectorRecord[];
  }): void | Promise<void>;
  onQuery?(payload: {
    namespace: RagNamespace;
    query: string;
    topK: number;
    results: VectorSearchResult[];
  }): void | Promise<void>;
  onError?(payload: { stage: "ingest" | "search" | "answer"; error: unknown }): void | Promise<void>;
}

export interface RagConfig {
  embedder: Embedder | AnyEmbeddingModel;
  store: VectorStore;
  chunker?: ChunkerConfig;
  telemetry?: boolean;
  hooks?: RagHooks;
  answer?: {
    template?: PromptTemplate;
    formatContext?: RagContextFormatter;
  };
}

export interface IngestParams {
  namespace: RagNamespace;
  documents: Array<RagDocument | RagDocumentInput>;
  upsertMode?: "replace" | "merge";
}

export interface SearchParams {
  namespace: RagNamespace;
  query: string;
  topK?: number;
  filter?: Record<string, unknown>;
}

export interface AnswerParams extends SearchParams {
  model: LanguageModel;
  template?: PromptTemplate;
  formatContext?: RagContextFormatter;
  telemetry?: boolean;
}

export type RagGenerateTextResult = Awaited<ReturnType<typeof generateText>>;
export type RagStreamTextResult = Awaited<ReturnType<typeof streamText>>;

export interface RagAnswerFunction {
  (params: AnswerParams): Promise<RagGenerateTextResult>;
  stream(params: AnswerParams): Promise<RagStreamTextResult>;
}

export interface RagEngine {
  ingest(params: IngestParams): Promise<void>;
  search(params: SearchParams): Promise<VectorSearchResult[]>;
  answer: RagAnswerFunction;
}

export type PromptTemplate =
  | string
  | ((payload: { query: string; namespace: RagNamespace; context: string }) => string);
export type RagContextFormatter = (results: VectorSearchResult[]) => string;

export type RagErrorCode =
  | "RAG_CONFIG_ERROR"
  | "RAG_NAMESPACE_REQUIRED"
  | "RAG_EMBED_ERROR"
  | "RAG_STORE_ERROR"
  | "RAG_PROMPT_ERROR";

export class RagError extends Error {
  readonly code: RagErrorCode;

  constructor(code: RagErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "RagError";
    this.code = code;
    this.cause = cause;
  }
}

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 50;
const DEFAULT_TOP_K = 5;

const namespaceSchema = z.string().min(1, "namespace is required");

const defaultTemplate = `You are a retrieval-augmented assistant. Use the provided context to answer the user question. If the context is not sufficient, say you don't know instead of inventing information.

Question:
{query}

Context:
{context}

Answer:`;

export function createRag(config: RagConfig): RagEngine {
  if (!config.embedder) {
    throw new RagError("RAG_CONFIG_ERROR", "RagConfig.embedder is required");
  }

  if (!config.store) {
    throw new RagError("RAG_CONFIG_ERROR", "RagConfig.store is required");
  }

  const embed = resolveEmbedder(config.embedder);
  const chunkOptions = toChunkOptions(config.chunker);
  const hooks = config.hooks ?? {};

  const ingest = async (params: IngestParams): Promise<void> =>
    withErrorHandling(hooks, "ingest", async () => {
      const namespace = validateNamespace(params.namespace);
      const documents = params.documents.map(normalizeDocument);

      const chunked = documents.flatMap((doc) => chunkDocument(doc, chunkOptions));
      if (chunked.length === 0) {
        return;
      }

      const embeddings = await embed(chunked.map((chunk) => chunk.text));
      if (embeddings.length !== chunked.length) {
        throw new RagError(
          "RAG_EMBED_ERROR",
          `Embedder returned ${embeddings.length} embeddings for ${chunked.length} chunks`,
        );
      }

      const vectors: VectorRecord[] = chunked.map((chunk, index) => ({
        id: chunk.id,
        vector: embeddings[index],
        text: chunk.text,
        namespace,
        documentId: chunk.documentId,
        chunkIndex: chunk.index,
        metadata: chunk.metadata,
        source: chunk.source,
        start: chunk.start,
        end: chunk.end,
      }));

      if (params.upsertMode === "replace" && config.store.deleteNamespace) {
        await config.store.deleteNamespace(namespace);
      }

      await config.store.upsert({ namespace, vectors });
      await hooks.onIngest?.({ namespace, documents, vectors });
    });

  const search = async (params: SearchParams): Promise<VectorSearchResult[]> =>
    withErrorHandling(hooks, "search", async () => {
      const namespace = validateNamespace(params.namespace);
      if (!params.query || params.query.trim().length === 0) {
        throw new RagError("RAG_CONFIG_ERROR", "Query text is required");
      }

      const [queryVector] = await embed([params.query]);
      if (!queryVector) {
        throw new RagError("RAG_EMBED_ERROR", "Embedder returned no vector for query");
      }

      const topK = params.topK ?? DEFAULT_TOP_K;
      const results = await config.store.query({
        namespace,
        queryVector,
        topK,
        filter: params.filter,
      });

      await hooks.onQuery?.({ namespace, query: params.query, topK, results });
      return results;
    });

  const answerOnce = async (params: AnswerParams): Promise<RagGenerateTextResult> =>
    withErrorHandling(hooks, "answer", async () => {
      const results = await search(params);
      const prompt = buildPrompt(params, config, results);
      return generateText({
        model: params.model,
        prompt,
        experimental_telemetry: params.telemetry ?? config.telemetry ? { isEnabled: true } : undefined,
      });
    });

  const answerStream = async (params: AnswerParams): Promise<RagStreamTextResult> =>
    withErrorHandling(hooks, "answer", async () => {
      const results = await search(params);
      const prompt = buildPrompt(params, config, results);
      return streamText({
        model: params.model,
        prompt,
        experimental_telemetry: params.telemetry ?? config.telemetry ? { isEnabled: true } : undefined,
      });
    });

  const answer = Object.assign(answerOnce, { stream: answerStream });

  return { ingest, search, answer };
}

function withErrorHandling<T>(
  hooks: RagHooks,
  stage: "ingest" | "search" | "answer",
  fn: () => Promise<T>,
): Promise<T> {
  return fn().catch((error) => {
    void Promise.resolve(hooks.onError?.({ stage, error })).catch(() => undefined);
    throw error instanceof RagError ? error : new RagError("RAG_STORE_ERROR", String(error), error);
  });
}

function validateNamespace(namespace: RagNamespace): RagNamespace {
  const parsed = namespaceSchema.safeParse(namespace);
  if (!parsed.success) {
    throw new RagError(
      "RAG_NAMESPACE_REQUIRED",
      parsed.error.issues[0]?.message ?? "Invalid namespace",
    );
  }
  return parsed.data;
}

function normalizeDocument(doc: RagDocument | RagDocumentInput): RagDocument {
  if (doc instanceof RagDocument) {
    return doc;
  }
  return new RagDocument(doc);
}

function toChunkOptions(config?: ChunkerConfig): RecursiveChunkOptions {
  const separators = config?.separators;
  return {
    chunkSize: config?.size ?? DEFAULT_CHUNK_SIZE,
    chunkOverlap: config?.overlap ?? DEFAULT_CHUNK_OVERLAP,
    separators: separators && separators.length > 0 ? (separators as [string, ...string[]]) : undefined,
    trimChunks: config?.trim ?? true,
  };
}

function chunkDocument(document: RagDocument, options: RecursiveChunkOptions): ChunkedDocument[] {
  const chunks = splitTextRecursively(document.text, options as RecursiveChunkOptions);
  return chunks.map((chunk) => toChunkedDocument(document, chunk));
}

function toChunkedDocument(document: RagDocument, chunk: Chunk): ChunkedDocument {
  return {
    id: `${document.id}::${chunk.index}`,
    documentId: document.id,
    text: chunk.content,
    index: chunk.index,
    metadata: document.metadata,
    source: document.source,
    start: chunk.start,
    end: chunk.end,
  };
}

function resolveEmbedder(embedder: Embedder | AnyEmbeddingModel): Embedder {
  if (typeof embedder === "function") {
    return embedder;
  }

  return async (values: string[]) => {
    try {
      const result = await sdkEmbedMany({
        model: embedder as any,
        values,
      });

      return result.embeddings.map((embedding: unknown) => {
        if (Array.isArray(embedding)) return embedding;

        if (
          embedding &&
          typeof embedding === "object" &&
          "values" in embedding &&
          Array.isArray((embedding as { values?: unknown }).values)
        ) {
          return (embedding as { values: number[] }).values;
        }

        if (
          embedding &&
          typeof embedding === "object" &&
          "embedding" in embedding &&
          Array.isArray((embedding as { embedding?: unknown }).embedding)
        ) {
          return (embedding as { embedding: number[] }).embedding;
        }

        throw new RagError("RAG_EMBED_ERROR", "Embedding model returned an unsupported format");
      });
    } catch (error) {
      throw new RagError("RAG_EMBED_ERROR", "Failed to embed values", error);
    }
  };
}

function buildPrompt(
  params: AnswerParams,
  config: RagConfig,
  results: VectorSearchResult[],
): string {
  const formatter = params.formatContext ?? config.answer?.formatContext ?? defaultContextFormatter;
  const template = params.template ?? config.answer?.template ?? defaultTemplate;

  const context = formatter(results);
  if (typeof template === "function") {
    return template({ query: params.query, namespace: params.namespace, context });
  }

  if (!template.includes("{query}") || !template.includes("{context}")) {
    throw new RagError(
      "RAG_PROMPT_ERROR",
      "Template must contain {query} and {context} placeholders when using string templates",
    );
  }

  return template.replace("{query}", params.query).replace("{context}", context);
}

const defaultContextFormatter: RagContextFormatter = (results) =>
  results
    .map(
      (result, index) =>
        `Chunk ${index + 1} (score ${result.score.toFixed(3)}):\n${result.chunk.text}`,
    )
    .join("\n\n");

function inferMimeFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const extension = extname(path).toLowerCase();
  if (extension === ".json") return "application/json";
  if (extension === ".md" || extension === ".markdown") return "text/markdown";
  if (extension === ".txt") return "text/plain";
  return undefined;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new RagError("RAG_EMBED_ERROR", "Embedding dimensions do not match");
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function matchesFilter(metadata: Record<string, unknown> | undefined, filter?: Record<string, unknown>) {
  if (!filter) return true;
  if (!metadata) return false;
  return Object.entries(filter).every(([key, value]) => {
    return metadata[key] === value;
  });
}

export class MemoryVectorStore implements VectorStore {
  private readonly data = new Map<RagNamespace, VectorRecord[]>();

  async upsert(input: { namespace: RagNamespace; vectors: VectorRecord[] }): Promise<void> {
    const existing = this.data.get(input.namespace) ?? [];
    const withoutDuplicates = existing.filter(
      (item) => !input.vectors.some((vector) => vector.id === item.id),
    );
    this.data.set(input.namespace, [...withoutDuplicates, ...input.vectors]);
  }

  async deleteNamespace(namespace: RagNamespace): Promise<void> {
    this.data.delete(namespace);
  }

  async query(input: VectorQuery): Promise<VectorSearchResult[]> {
    const vectors = this.data.get(input.namespace) ?? [];
    const filtered = vectors.filter((vector) => matchesFilter(vector.metadata, input.filter));

    const scored = filtered
      .map((vector) => ({
        vector,
        score: cosineSimilarity(input.queryVector, vector.vector),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, input.topK ?? DEFAULT_TOP_K);

    return scored.map(({ vector, score }) => ({
      chunk: {
        id: vector.id,
        documentId: vector.documentId ?? "",
        text: vector.text,
        index: vector.chunkIndex ?? 0,
        metadata: vector.metadata,
        source: vector.source,
        start: vector.start,
        end: vector.end,
      },
      score,
      metadata: vector.metadata,
    }));
  }
}

type PgPool = import("pg").Pool;
type ToSql = (vector: number[]) => unknown;

export interface PgVectorStoreOptions {
  connectionString?: string;
  tableName?: string;
  schema?: string;
  indexName?: string;
  dimensions?: number;
  pool?: PgPool;
}

export class PgVectorStore implements VectorStore {
  private readonly options: Required<Omit<PgVectorStoreOptions, "dimensions" | "pool">> &
    Pick<PgVectorStoreOptions, "dimensions">;
  private pool?: PgPool;
  private ready: Promise<void>;
  private toSql?: ToSql;

  constructor(options: PgVectorStoreOptions) {
    this.options = {
      connectionString: options.connectionString ?? process.env.POSTGRES_CONNECTION_STRING ?? "",
      tableName: options.tableName ?? "rag_vectors",
      schema: options.schema ?? "public",
      indexName: options.indexName ?? "rag_vectors_vector_idx",
      dimensions: options.dimensions,
    };
    if (!this.options.connectionString && !options.pool) {
      throw new RagError(
        "RAG_CONFIG_ERROR",
        "PgVectorStore requires a connectionString or an existing pg Pool instance",
      );
    }
    this.pool = options.pool;
    this.ready = this.prepare();
  }

  async upsert(input: { namespace: RagNamespace; vectors: VectorRecord[] }): Promise<void> {
    await this.ready;
    const pool = this.pool!;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const table = this.qualifiedTable();
      const valueRows = input.vectors.map((vector) => [
        vector.id,
        input.namespace,
        vector.documentId ?? null,
        vector.chunkIndex ?? null,
        vector.text,
        vector.metadata ?? {},
        this.toSql!(vector.vector),
        vector.source ?? null,
        vector.start ?? null,
        vector.end ?? null,
      ]);

      for (const row of valueRows) {
        await client.query(
          `INSERT INTO ${table} (id, namespace, document_id, chunk_index, text, metadata, vector, source, start_pos, end_pos)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             namespace = EXCLUDED.namespace,
             document_id = EXCLUDED.document_id,
             chunk_index = EXCLUDED.chunk_index,
             text = EXCLUDED.text,
             metadata = EXCLUDED.metadata,
             vector = EXCLUDED.vector,
             source = EXCLUDED.source,
             start_pos = EXCLUDED.start_pos,
             end_pos = EXCLUDED.end_pos`,
          row,
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new RagError("RAG_STORE_ERROR", "Failed to upsert vectors into pgvector store", error);
    } finally {
      client.release();
    }
  }

  async deleteNamespace(namespace: RagNamespace): Promise<void> {
    await this.ready;
    const pool = this.pool!;
    await pool.query(`DELETE FROM ${this.qualifiedTable()} WHERE namespace = $1`, [namespace]);
  }

  async query(input: VectorQuery): Promise<VectorSearchResult[]> {
    await this.ready;
    const pool = this.pool!;
    const topK = input.topK ?? DEFAULT_TOP_K;
    const table = this.qualifiedTable();

    const params: unknown[] = [input.namespace, this.toSql!(input.queryVector), topK];
    const filterClause = input.filter ? "AND metadata @> $4::jsonb" : "";
    if (input.filter) {
      params.push(JSON.stringify(input.filter));
    }

    const result = await pool.query(
      `SELECT id, document_id, chunk_index, text, metadata, source, start_pos, end_pos, (vector <=> $2) AS distance
       FROM ${table}
       WHERE namespace = $1 ${filterClause}
       ORDER BY vector <-> $2
       LIMIT $3`,
      params,
    );

    return result.rows.map((row: any) => ({
      chunk: {
        id: row.id,
        documentId: row.document_id ?? "",
        text: row.text,
        index: row.chunk_index ?? 0,
        metadata: row.metadata ?? undefined,
        source: row.source ?? undefined,
        start: row.start_pos ?? undefined,
        end: row.end_pos ?? undefined,
      },
      score: typeof row.distance === "number" ? 1 - row.distance : 0,
      metadata: row.metadata ?? undefined,
    }));
  }

  async health(): Promise<void> {
    await this.ready;
    await this.pool!.query("SELECT 1");
  }

  private async prepare(): Promise<void> {
    try {
      const [{ Pool }, { registerType, toSql }] = await Promise.all([
        import("pg"),
        import("pgvector/pg"),
      ]);
      this.toSql = toSql;
      this.pool =
        this.pool ??
        new Pool({
          connectionString: this.options.connectionString,
        });

      await registerType(this.pool);
      const table = this.qualifiedTable();
      const dimensionClause = this.options.dimensions ? `(${this.options.dimensions})` : "";

      await this.pool.query(
        `CREATE SCHEMA IF NOT EXISTS ${this.quoteIdentifier(this.options.schema)}`,
      );
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS ${table} (
          id TEXT PRIMARY KEY,
          namespace TEXT NOT NULL,
          document_id TEXT,
          chunk_index INTEGER,
          text TEXT NOT NULL,
          metadata JSONB,
          vector vector${dimensionClause} NOT NULL,
          source TEXT,
          start_pos INTEGER,
          end_pos INTEGER
        )`,
      );
      await this.pool.query(
        `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(this.options.indexName)} ON ${table} USING ivfflat (vector vector_cosine_ops)`,
      );
      await this.pool.query(
        `CREATE INDEX IF NOT EXISTS ${this.quoteIdentifier(
          `${this.options.tableName}_namespace_idx`,
        )} ON ${table} (namespace)`,
      );
    } catch (error) {
      throw new RagError("RAG_STORE_ERROR", "Failed to initialize pgvector store", error);
    }
  }

  private qualifiedTable(): string {
    return `${this.quoteIdentifier(this.options.schema)}.${this.quoteIdentifier(this.options.tableName)}`;
  }

  private quoteIdentifier(value: string): string {
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      throw new RagError("RAG_STORE_ERROR", `Invalid identifier: ${value}`);
    }
    return `"${value}"`;
  }
}
