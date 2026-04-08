# Project Brief - AI Kit

## Mission

AI Kit is an internal TypeScript platform for orchestrating AI capabilities in production with predictable ownership of behavior across model and transport changes. It provides a minimal but cohesive set of packages for agent orchestration, workflow execution, retrieval-augmented generation, HTTP server exposure, and project bootstrap.

## Repository Scope

- In scope: `@ai_kit/*` packages, shared docs, release/validation workflows, and architecture/decision notes in `memory-bank/*`.
- In scope details:
  - `core`: agents, workflows, runtime primitives, memory hooks, telemetry integration.
  - `server`: Hono-based HTTP transport and API conventions.
  - `client-kit`: typed HTTP consumer for server endpoints.
  - `rag`: ingestion/search/answer abstractions.
  - `mcp-docs-server`: MCP server exposing repository docs.
  - `create-ai-kit`: CLI scaffold for starter projects.
  - `mcp` (dist-only in repo): MCP DSL wrapper surfaced through bundled artifacts.
- Out of scope: end-user product UIs, tenant-specific policy engines, and custom business code built on top of AI Kit.

## Core Users

- Platform engineers building reusable AI building blocks.
- Product teams deploying agents and workflows through the HTTP server package.
- Consumers installing AI Kit as versioned npm packages.

## Current Objectives

- Keep package-level API compatibility predictable when evolving internals.
- Keep runtime boundaries strict: core primitives remain transport-agnostic.
- Keep onboarding clear with documented examples and typed entrypoints.
- Capture release and operational constraints explicitly in memory and docs.

## Success Criteria

- Public package APIs remain stable within each semver contract.
- Release automation triggers only on package-level version changes and remains resilient.
- Core/server/client/rag call paths stay typed, tested, and documented.
- Workspace changes can be reconstructed from one source-of-truth layer (`memory-bank` + package READMEs).

## Technical / Delivery Constraints

- Monorepo managed with `pnpm` + `pnpm-workspace.yaml`.
- Node package versions are mostly independent per package; releases are published per-package.
- `package` names under `@ai_kit/*`; release flows rely on root CI workflows watching package `package.json` files.
- TypeScript-first codebase with local package tests and explicit runtime exports from `dist/*`.

## Detailed References

- `memory-bank/techContext.md`
- `memory-bank/systemPatterns.md`
- `memory-bank/activeContext.md`
- `memory-bank/progress.md`
- `README.md`
