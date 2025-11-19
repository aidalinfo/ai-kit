import type { MemoryConfig, HistoryStoreConfig } from "mem0ai/oss";

export interface MemoryOptions {
    thread?: string;
    metadata?: Record<string, unknown>;
}

export interface PgVectorConfig {
    collectionName?: string;
    embeddingModelDims?: number;
    user?: string;
    password?: string;
    host?: string;
    port?: number;
    dbname?: string;
    diskann?: boolean;
    hnsw?: boolean;
}

export interface SimplifiedMemoryConfig {
    path?: string;
    vectorStore?: {
        provider: "pgvector";
        config: PgVectorConfig;
    };
    embedder?: MemoryConfig["embedder"];
    history?: HistoryStoreConfig;
    llm?: MemoryConfig["llm"];
}

export type AiKitMemoryConfig = Partial<MemoryConfig> | SimplifiedMemoryConfig;
