import { Memory as Mem0Memory, type MemoryConfig } from "mem0ai/oss";
import type { AiKitMemoryConfig, SimplifiedMemoryConfig } from "./types.js";

export class Memory extends Mem0Memory {
    constructor(config: AiKitMemoryConfig = {}) {
        const { mem0Config } = Memory.resolveConfig(config);
        super(mem0Config);
    }

    private static resolveConfig(config: AiKitMemoryConfig): {
        mem0Config: Partial<MemoryConfig>;
    } {
        if (Memory.isSimplifiedConfig(config)) {
            const { vectorStore, history, path, ...rest } = config;

            return {
                mem0Config: {
                    ...rest,
                    vectorStore,
                    historyStore: history,
                    historyDbPath: path,
                },
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

}

export * from "./types.js";
