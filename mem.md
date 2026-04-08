# Mem0 Integration Plan

## Objectives
- Introduce long-term memory for AI Kit agents via a reusable `Memory` object.
- Back Mem0 with a pluggable storage layer (pgvector, MongoDB Atlas Vector Search, etc.), aligning with infrastructure described in `packages/core/src/runtime/store.ts` and the agent pipeline in `packages/core/src/agents/index.ts`.
- Keep the addition optional, so existing callers operate without memory unless explicitly configured.

## Architecture Touchpoints
- `packages/core/src/agents/index.ts`: Centralizes `Agent.generate` / `Agent.stream`. This is where memories are recalled before the LLM call and persisted afterward.
- `packages/core/src/runtime/store.ts` & `packages/core/src/runtime/resources.ts`: Provide scoped runtime state and a registry for lazily loaded resources; ideal place to inject a Mem0 client instance and cleanup hooks.
- `packages/core/src/runtime/tools.ts`: Runtime-aware tools can access the same Mem0 instance through the store, enabling tool-based recall/write operations if needed.
- `pnpm-workspace` packages: expose the core API; any new memory utilities should live in `packages/core` and be re-exported through `packages/core/src/index.ts`.

## Implementation Steps

1. **Dependencies & Environment**
- Add `mem0ai` to the workspace (`pnpm add mem0ai -w`).
- Capture configuration via env vars (`MEM0__PROVIDER`, `MEM0__PG_URI`, `MEM0__MONGO_URI`, `MEM0__OPENAI_KEY`, optional `MEM0__COLLECTION`, `MEM0__DIMENSION`, etc.) and document them in `.env.example`.
- Provide provider-specific bootstrap docs:
  - **pgvector**: ensure the database has the `vector` extension (`CREATE EXTENSION IF NOT EXISTS vector;`).
  - **MongoDB** (or other supported Mem0 adapters): outline required indexes and Atlas vector search configuration.
- Migration scripts and infra steps live alongside other ops docs.

2. **Runtime Resource for Mem0**
- Create `packages/core/src/memory/mem0.ts` exporting `registerMem0RuntimeResource` and `createMem0Memory`.
- Use `registerRuntimeResource("mem0", …)` to lazily instantiate the `Memory` client with the selected provider config (pgvector connection info, MongoDB connection string + database/collection, etc.). Accept a generic `Mem0Config` that maps cleanly to `mem0ai`’s `Memory` constructor.
- Implement `packages/core/src/memory/Memory.ts` so all instantiation flows through a thin wrapper class that proxies to `mem0ai` but enforces AI Kit defaults (e.g., `provider: "mem0"`).
- Hook into `RuntimeStore.onCleanup` to close database pools if Mem0 exposes a `close`/`destroy` method; otherwise ensure idempotency.
- Define a `Mem0RuntimeState` interface to type the runtime key (`mem0Memory`) storing the hydrated client.

3. **Agent-Level Memory Plumbing**
- Extend `AgentConfig` with an optional `memory` block and enforce an explicit `threadId`:
     ```ts
     export interface AgentMemoryConfig<State extends RuntimeState> {
       enable: boolean;
       resolveUser: (runtime: RuntimeStore<State>, options: AgentCallContext) => Promise<string | undefined>;
       resolveThreadId: (runtime: RuntimeStore<State>, options: AgentCallContext) => Promise<string | undefined>;
       client?: Memory; // optional pre-configured wrapper exported by @ai-kit/core
       providerConfig?: Mem0ProviderConfig; // fallback when client is not provided
       recallLimit?: number;
     }
     ```
- Thread the memory config through `Agent.generate` / `Agent.stream`. When enabled:
     1. Resolve the runtime (`RuntimeStore.mergeExperimentalContext` already wires it in).
     2. Assert that `resolveThreadId` returns a non-empty value from the runtime or call options; if missing, skip memory work (and optionally warn).
     3. Load or create the Mem0 client via `runtime.load("mem0", providerConfig)`, skipping instantiation when a `Memory` wrapper instance (`client`) is already supplied.
     4. Build the Mem0 `add` payload from the full conversation history and thread metadata (`threadId`, `userId`, optional tags).
     5. Automatically call `memory.search(threadId, { userId, limit, includeMetadata: true })` before the LLM call. Inject high-relevance memories by prepending a synthetic system message or augmenting `experimental_context`.
     6. After receiving the model response, call `memory.add(messages, { userId, metadata: { threadId } })` so write-through occurs automatically.
- Guard all steps when `userId` is missing or Mem0 raises retrieval errors, logging through existing telemetry (`mergeTelemetryConfig`) without aborting the agent call.

### Example: Agent Using Mem0

```ts
import { Agent, createRuntime, Memory } from "@ai-kit/core";

const supportMemory = new Memory({
  provider: "mem0", // default provider
  vectorStore: {
    provider: process.env.MEM0__PROVIDER ?? "pgvector",
    config: {
      collectionName: process.env.MEM0__COLLECTION ?? "support_memories",
      dimension: Number(process.env.MEM0__DIMENSION ?? 1536),
      host: process.env.MEM0__PG_HOST,
      port: Number(process.env.MEM0__PG_PORT ?? 5432),
      user: process.env.MEM0__PG_USER,
      password: process.env.MEM0__PG_PASSWORD,
    },
  },
  llm: {
    provider: "openai",
    config: {
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: process.env.MEM0__LLM_MODEL ?? "gpt-4o-mini",
    },
  },
  embedder: {
    provider: "openai",
    config: {
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: process.env.MEM0__EMBED_MODEL ?? "text-embedding-3-small",
    },
  },
});

const agent = new Agent({
  name: "support-specialist",
  instructions: "You are a helpful assistant that remembers previous tickets.",
  model: myLanguageModel,
  memory: {
    enable: true,
    client: supportMemory,
    recallLimit: 8,
    resolveUser: async (_runtime, { metadata }) => metadata?.userId,
    resolveThreadId: async (_runtime, { threadId, metadata }) =>
      threadId ?? metadata?.threadId,
  },
});

const runtime = createRuntime();

const result = await agent.generate({
  runtime,
  threadId: "ticket-1876",
  messages: [
    { role: "user", content: "I can't log into my dashboard again." },
  ],
  metadata: { userId: "customer-42" },
});
```

Users who prefer explicit provider-specific overrides can pass a different configuration when instantiating the Mem0 client, e.g. MongoDB:

```ts
const supportMemory = new Memory({
  provider: "mem0",
  vectorStore: {
    provider: "mongodb",
    config: {
      uri: process.env.MEM0__MONGO_URI!,
      database: "ai-kit",
      collectionName: "memories",
      indexName: "memories_vector_index",
    },
  },
});
```

Passing `threadId` (and optionally `metadata.threadId`) is required; the agent automatically recalls and persists memories tied to that thread.

4. **Helper Utilities**
   - Provide `packages/core/src/memory/utils.ts` with:
     - `buildMem0ConfigFromEnv()`
     - `formatConversationForMem0(messages: Array<Message>, threadId: string)`
     - `injectMemories(messages, memories, threadId)` returning an updated transcript that tags injected memories with the active thread.
   - Export the wrapper `Memory` class that hides provider-specific params, exposes `recall`/`store` helpers, and is re-exported through `packages/core/src/index.ts` for consumer DX.

5. **Tooling & Optional Tools**
   - Offer a runtime-aware tool (`packages/core/src/memory/tools.ts`) using `createRuntimeTool` to allow agents to explicitly fetch or update memories mid-conversation.
   - Register it conditionally when the agent is built with `memory.enable === true`, so existing tool loops operate unchanged otherwise.

6. **Testing Strategy**
   - Unit tests in `packages/core/tests/memory/mem0.test.ts` mocking the `mem0ai` client to verify:
     - Runtime resource caching & cleanup.
     - Recall injection logic (messages augmented once, correct ordering).
     - Persist-after-response flow.
   - Integration smoke test behind a CI flag that spins up a disposable Postgres container with pgvector (use `testcontainers` or docker-compose) to validate end-to-end recall/store.

7. **Operational Checklist**
   - Document required migrations (UUID primary keys, vector columns, indexes) in `/docs/operations/mem0-pgvector.md`.
   - Add telemetry hooks so Mem0 latency/errors feed existing pipelines (`packages/core/src/telemetry/langfuse.ts`).
   - Provide runbook snippets (rotation of API keys, verifying pgvector indexes) inside the ops doc referenced above.

## Rollout Notes
- Ship behind a feature flag (`MEM0_ENABLED`), defaulting to false while the feature bakes.
- Ensure backward compatibility: agents without `memory` config should not import or bundle `mem0ai`, keeping the package optional for downstream consumers.
- Coordinate with infra to provision staging Postgres with pgvector before enabling in production workflows.
- Provide cookbook snippets showing provider-specific configuration (pgvector vs MongoDB vs in-memory) so users can choose their storage layer.
