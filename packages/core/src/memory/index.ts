import { Memory as Mem0Memory, type MemoryConfig } from "mem0ai/oss";
import { PgVectorStore } from "./vector-stores/pg-vector.js";
import type { AiKitMemoryConfig, SimplifiedMemoryConfig } from "./types.js";

export class Memory extends Mem0Memory {
    private customVectorStore?: PgVectorStore;

    constructor(config: AiKitMemoryConfig = {}) {
        const { mem0Config, customStore } = Memory.resolveConfig(config);
        super(mem0Config);

        if (customStore) {
            this.customVectorStore = customStore;
            // @ts-ignore - Accessing private property to inject custom store
            this.vectorStore = this.customVectorStore;
        }
    }

    private static resolveConfig(config: AiKitMemoryConfig): {
        mem0Config: Partial<MemoryConfig>;
        customStore?: PgVectorStore;
    } {
        if (Memory.isSimplifiedConfig(config)) {
            const { vectorStore, history, path, ...rest } = config;

            let customStore: PgVectorStore | undefined;
            let mem0VectorStoreConfig: MemoryConfig["vectorStore"] | undefined;

            if (vectorStore?.provider === "pgvector") {
                customStore = new PgVectorStore(vectorStore.config);
            } else if (vectorStore) {
                mem0VectorStoreConfig = vectorStore as any;
            }

            return {
                mem0Config: {
                    ...rest,
                    vectorStore: mem0VectorStoreConfig,
                    historyStore: history,
                    historyDbPath: path,
                },
                customStore,
            };
        }

        return { mem0Config: config };
    }

    private static isSimplifiedConfig(
        config: AiKitMemoryConfig
    ): config is SimplifiedMemoryConfig {
        return (
            (config as SimplifiedMemoryConfig).vectorStore !== undefined ||
            (config as SimplifiedMemoryConfig).embedder !== undefined ||
            (config as SimplifiedMemoryConfig).llm !== undefined ||
            (config as SimplifiedMemoryConfig).history !== undefined ||
            (config as SimplifiedMemoryConfig).path !== undefined
        );
    }

    // We might need to ensure initialization of our custom store
    // Since Memory doesn't have an async initialize, we might need to do it lazily or 
    // override methods that use it. 
    // However, mem0's VectorStore interface has `initialize()`. 
    // The Memory class likely calls it.
    // If we swapped it in constructor, Memory might call `this.vectorStore.initialize()` if it does so.

    // If Memory calls initialize() on the store, our PgVectorStore.initialize() will be called.
    // Let's ensure we handle that.
}

export * from "./types.js";
