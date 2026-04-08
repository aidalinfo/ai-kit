# Active Context - AI Kit

## Current Focus

- Finish the architecture pass for `memory-bank/*` so package boundaries, stream contracts, and operational debt are documented consistently before any major core refactor.
- Keep package contracts explicit around workflow context, streaming payloads, and server-route behavior (`generate`, `stream`, `run`, `stream`, `resume`).
- Preserve the repository’s documentation-first posture: source-of-truth updates in memory-bank first, then implementation changes.

## In-Progress Items

- Package-boundary alignment and technical debt capture (`memory-bank/systemPatterns.md`, `memory-bank/techContext.md`).
- `context.md` (typed runtime `ctx` support and `StepHandlerArgs` migration) and `branchParallel.md` (parallel branch execution model) as active roadmap topics.
- `mem.md` (optional memory integration) and `toon.md` (prompt payload compression) retained as future technical work streams with current notes only.
- `refactor.md` (ServerKit module split) remains pending execution planning with no new core behavior assumptions.
- `packages/mcp` and `packages/docs` being tracked as workspace drift items; verify whether they are kept as placeholders or removed/renamed in a cleanup step.

## Recent Decisions

- Keep package boundaries explicit and transport responsibilities in `server` only; avoid adding Hono/HTTP concerns to `core`.
- Treat `@ai_kit/mcp-docs` as `packages/mcp-docs-server` at source, and keep legacy `packages/mcp/dist` as non-authoritative for development decisions.
- Keep optional capabilities explicit (`telemetry`, `docs`, `memory`) and gated by defaults that preserve backward compatibility.
- Preserve compatibility through explicit deprecation rather than silent behavioral breakage, especially for workflow context helpers.

## Next Actions

1. Complete `systemPatterns` updates with route/stream semantics and evolution rules (in progress).  
2. Sync `activeContext.md`, `progress.md`, and optionally `memory-bank/README.md` after docs changes are finalized.
3. Continue implementation planning for `context.md` and `branchParallel.md` without code changes until API expectations are fully aligned.
4. Track workspace drift and incomplete packages in `progress.md` so release and contributor workflows can plan cleanup.

## Detailed References

- `memory-bank/progress.md`
- `memory-bank/systemPatterns.md`
- `branchParallel.md`
- `context.md`
- `mem.md`
- `toon.md`
- `refactor.md`
