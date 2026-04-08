# System Patterns - AI Kit

## Architecture Style

- Capability-partitioned monorepo with explicit package ownership and minimal cross-cutting coupling.
- Core orchestration and shared contracts are implemented in `@ai_kit/core`; `@ai_kit/server` provides transport and API wiring; `@ai_kit/client-kit` provides remote callers to those APIs.
- Documentation and protocol extensions (`@ai_kit/mcp-docs`) are treated as consumable but secondary surfaces, while `@ai_kit/create-ai-kit` owns local project scaffolding.
- A few entries in workspace/workflow files are legacy-only (`packages/mcp`, `packages/docs`) and are intentionally excluded from active package boundaries.

## Package Boundaries

- `@ai_kit/core`: agents, workflow DSL/state, runtime stores/resources, telemetry interfaces, and exported public types.
- `@ai_kit/server`: Hono app adapter, agent/workflow route registration, middleware chain, SSE streaming, resume/waiting-human behavior, and swagger wiring.
- `@ai_kit/client-kit`: typed SDK for `/api/agents` and `/api/workflows` with merge behavior for `runtime`, `runtimeContext`, `metadata`, and `ctx` payload fields.
- `@ai_kit/rag`: connectors and orchestration for chunking, embedding, ingestion, retrieval, and answer generation.
- `@ai_kit/mcp-docs`: MCP documentation server implementation located in `packages/mcp-docs-server`, package name `@ai_kit/mcp-docs`.
- `@ai_kit/create-ai-kit`: CLI entrypoint and project templates for package bootstrapping.
- `@ai_kit/types`: typed utilities that are incomplete and not part of the active publish/runtime flow.
- `packages/mcp/dist`: built artifact retained for backward compatibility with historical package usage, but no active source package.

## Core Execution Patterns

- Request lifecycle is standardized in `ServerKit`:
  - `GET /api/agents` and `GET /api/workflows` for discoverability.
  - `POST /api/agents/:id/generate` and `POST /api/agents/:id/stream` for one-shot and streaming agent runs.
  - `POST /api/workflows/:id/run`, `POST /api/workflows/:id/stream`, and `POST /api/workflows/:id/runs/:runId/resume` for workflow runs and human-in-the-loop resumption.
- Route payloads are validated early (`parseJsonBody`, workflow payload shape checks) and normalized into `WorkflowRunOptions` where supported fields are `inputData`, optional `metadata`, and optional `ctx`.
- Streaming is SSE-first in server transport:
  - stream handlers push workflow events (`step:start`, `step:success`, `step:error`, `step:branch`, etc.) and final `result` / `error` frames.
  - streaming and synchronous completion share the same `WorkflowRunResult` shape (including final `ctx` when enabled).
- Serialization/validation is schema-first at package boundaries (zod and domain adapters), with protocol-agnostic core types exported from package roots.

## API and Evolution Rules

- Preserve compatibility by default: prefer additive API changes and keep deprecations explicit for migration (`context` / `WorkflowStepContext`, etc.).
- Keep refactors local to package ownership: transport changes stay in `server`, orchestration internals stay in `core`, and client adapters never import transport internals.
- Document new package assumptions in the nearest package README and update `memory-bank/*` with architectural implications immediately.
- Keep feature flags and defaults conservative: behavior changes should remain opt-in when they can alter request/response shape.
- Add/adjust tests around API behavior before changing execution internals in core workflows or server routing.

## Detailed References

- `memory-bank/techContext.md`
- `memory-bank/activeContext.md`
- `memory-bank/progress.md`
- `package.json` scripts in `packages/*/package.json`
- `packages/server/src/ServerKit.ts`
- `packages/server/src/serverKit/*`
