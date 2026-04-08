# ServerKit Refactor Plan

## Goals
- Reduce the size and responsibility of `packages/server/src/ServerKit.ts`.
- Group related logic into focused modules so that each file has a single concern.
- Preserve the current public API (types + helpers re-exported by `packages/server/src/index.ts`).

## Proposed Module Layout
1. **types.ts** – houses `ServerKitConfig`, `SwaggerOptions`, middleware/api route types, and `ListenOptions`.
2. **constants.ts** – keeps `SUPPORTED_HTTP_METHODS`, Swagger defaults, and the derived `packageVersion`.
3. **errors.ts** – `normalizeError`, `invalidAgentPayload`, and `ensureAgentPayload` helpers.
4. **streaming.ts** – SSE helpers (`sendSseEvent`) and agent stream type-guards.
5. **swaggerOptions.ts** – resolve swagger config + route normalization helpers.
6. **telemetry.ts** – `resolveTelemetryOptions` helper for Langfuse instrumentation toggles.
7. **auth.ts** – server auth config normalization + middleware factory (`resolveAuthOptions`, `createAuthMiddleware`, `extractBearerToken`).
8. **middleware.ts** – normalization helpers plus `resolveMiddlewareEntries` for legacy + nested middleware.
9. **apiRoutes.ts** – `registerApiRoute`, `resolveApiRouteEntries`, `normalizeApiRoute`, and HTTP method normalization utilities.

All helper files live under `packages/server/src/serverKit/` to keep them scoped and easy to discover.

## Implementation Steps
1. Create `packages/server/src/serverKit/` and move supporting logic from `ServerKit.ts` into the new modules listed above.
2. Update `ServerKit.ts` so it focuses on orchestrating the Hono app lifecycle by importing helpers/types from the new modules.
3. Re-export the relevant types/helpers (`ServerKitConfig`, `registerApiRoute`, etc.) from `ServerKit.ts` (or via barrel) so consumers keep using `packages/server` the same way.
4. Run/ensure existing tests still pass (main logic untouched, structural change only).
5. Clean up any redundant imports/constants left behind after the extraction.
