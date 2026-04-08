# Progress - AI Kit

## What Works

- Core and transport packages remain separable and independently releasable by package workflows.
- Client/server contract is stable for current agent and workflow routes, including sync/stream run semantics and run resumption.
- Core workflow context evolution (`ctx`) and branch-parallel runtime changes are now explicitly tracked as planned implementation work.
- MCP docs server remains executable via its published package surface (`@ai_kit/mcp-docs`).
- The memory-bank architecture pass is the current active output, replacing earlier ambiguity around package boundaries.

## Current Delivery Fronts

- Documentation architecture consistency (`memory-bank/systemPatterns.md`, `memory-bank/activeContext.md`, `memory-bank/techContext.md`).
- Workflow runtime consistency (`context.md`) and parallel branching strategy (`branchParallel.md`).
- ServerKit extraction and refactoring planning (`refactor.md`) while preserving route and streaming behavior.
- Optional long-term memory work (`mem.md`) and structured payload compression experiments (`toon.md`) when roadmap allows.

## Milestone Snapshot

- Foundation: stabilized
- API hardening: in progress (alignment docs + planned workflow/context updates)
- Streaming/transport behavior: stable and documented
- Documentation governance: active and current

## Known Risks / Attention Points

- Workspace drift between `pnpm-workspace.yaml` and actual package set (`packages/docs`, `packages/mcp`) can mislead tooling if left uncorrected.
- Incomplete/legacy package surfaces (`packages/types`, dist-only `packages/mcp`) risk future release ambiguity.
- API and release changes across core/workflow/context and streaming behavior need coordinated docs-first migration.
- Version volatility in external AI SDK dependencies and optional runtime providers.
- Streaming behavior must stay stable across sync and async paths (`run` vs `stream` vs `resume`) while adding new workflow features.

## Update Protocol

- Update this file after major release-impacting architectural changes or when a front moves between planned/in-progress/done.
- Keep plan details in focused docs (`context.md`, `branchParallel.md`, `refactor.md`, `mem.md`, `toon.md`) and reflect their status in `activeContext.md`.
- When workspace/package boundaries change, update `systemPatterns.md` and `techContext.md` in the same pass.

## Detailed References

- `memory-bank/activeContext.md`
- `memory-bank/techContext.md`
- `context.md`
- `branchParallel.md`
- `refactor.md`
- `mem.md`
- `toon.md`
