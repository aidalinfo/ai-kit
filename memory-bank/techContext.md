# Tech Context - AI Kit

## Stack Baseline

- Workspace: pnpm monorepo described in `pnpm-workspace.yaml`.
- Language: TypeScript (`strict`-style configs) and Node.js runtime.
- Package responsibilities:
  - `@ai_kit/core`: orchestration primitives and shared runtime helpers.
  - `@ai_kit/server`: Hono-based transport facade.
  - `@ai_kit/client-kit`: typed HTTP client for server endpoints.
  - `@ai_kit/rag`: retrieval, chunking, and embedding helpers.
  - `@ai_kit/mcp-docs`: MCP documentation server (source dir is `packages/mcp-docs-server`).
  - `@ai_kit/create-ai-kit`: scaffold CLI.
  - `mcp` directory: repo includes `packages/mcp/dist` but no source package definition; it behaves like a built artifact.
- Libraries in use: `hono`, AI SDK (`ai`, `@ai-sdk/*`), `zod`, optional Langfuse/OTel via telemetry hooks, and optional `pg`/`pgvector` in RAG.
- Documentation sources: root `README.md`, package READMEs, code comments, and generated docs from `docs/` and package READMEs consumed by MCP docs tooling.

## Repository-Level Contracts

- Public package API is exported from `dist/index.js` / `dist/index.d.ts` for package-style modules.
- Package tooling is scoped by package name (local scripts and package `test`/`build`).
- CI uses package-specific release jobs watching package manifests.
- `pnpm-workspace.yaml` includes legacy entries (`packages/docs`, `packages/mcp`) that do not currently map to full package sources; this is tracked as technical debt.
- `packages/types` and `packages/mcp` are not active runtime packages in the current implementation flow.

## Relevant Entrypoints

- Core orchestration: `packages/core/src/*` (`agents`, `workflows`, `runtime`, `telemetry`).
- Server transport and routing: `packages/server/src/ServerKit.ts`, plus helper modules under `packages/server/src/serverKit/*`.
- Client runtime: `packages/client-kit/src/ClientKit.ts`.
- RAG layer: `packages/rag/src/index.ts` plus connector implementations in the same package.
- MCP documentation server: `packages/mcp-docs-server/src/index.ts`, `src/docsTool.ts`, and `src/cli.ts`.
- Scaffold CLI: `packages/create-ai-kit/src/index.ts` and `templates/*`.

## Operational Commands

- Install dependencies: `pnpm install`.
- Run package tests: `pnpm --filter @ai_kit/server test`, `pnpm --filter @ai_kit/client-kit test`, etc.
- Run package builds: `pnpm --filter @ai_kit/core build`, `pnpm --filter @ai_kit/server build`.
- Run local dev paths:
  - `pnpm --filter @ai_kit/server dev`
  - `pnpm --filter @ai_kit/create-ai-kit dev`
- Start local MCP docs server from release package:
  - `npx -y @ai_kit/mcp-docs`
  - Equivalent when working in-repo: `pnpm --filter @ai_kit/mcp-docs build && pnpm --filter @ai_kit/mcp-docs start`.

## Release Automation

- Per-package workflows are trigger-driven on `push` to `main`:
  - `core`: `.github/workflows/realease-core.yml` (note typo in filename).
  - `server`: `.github/workflows/release-server.yml`.
  - `client-kit`: `.github/workflows/release-client-kit.yml`.
  - `rag`: `.github/workflows/release-rag.yml`.
  - `mcp-docs`: `.github/workflows/release-mcp-docs.yml`.
  - `create-ai-kit`: `.github/workflows/publish-create-ai-kit.yml`.
- Tagging pattern in CI: package names map to plain `v<version>` or suffixed tags (`-server`, `-rag`, `-mcp-docs`, `-create`) where configured.
- PR validation currently runs server and client tests on `dev` via `pr-dev-tests.yml`.

## Source-of-Truth Precedence

1. Instructions from the user request.
2. Relevant `memory-bank/*` files for the question.
3. Package-specific README and code comments.
4. Specialized docs in `packages/*` and release/deploy workflows.

## Detailed References

- `memory-bank/projectbrief.md` (mission + scope)
- `memory-bank/techContext.md` (runtime/dependency facts)
- `memory-bank/systemPatterns.md` (architecture boundaries)
- package READMEs (`packages/core/README.md`, `packages/server/README.md`, `packages/client-kit/README.md`, `packages/rag/README.md`, etc.)
