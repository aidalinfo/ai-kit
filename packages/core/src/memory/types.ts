import type { MemoryConfig, HistoryStoreConfig } from "mem0ai/oss";

export interface MemoryOptions {
    thread?: string;
    metadata?: Record<string, unknown>;
}

export interface SimplifiedMemoryConfig {
    path?: string;
    vectorStore?: MemoryConfig["vectorStore"];
    embedder?: MemoryConfig["embedder"];
    history?: HistoryStoreConfig;
    llm?: MemoryConfig["llm"];
}

export type AiKitMemoryConfig = Partial<MemoryConfig> | SimplifiedMemoryConfig;
