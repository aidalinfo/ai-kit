# Vercel Workflow SDK — Confirmed Signatures

Spike project: `/tmp/world-spike`
Date: 2026-06-02
Branch: `feat/workflow-world-engine`

---

## Versions

| Package | Installed version |
|---|---|
| `workflow` | 4.3.1 |
| `@workflow/world-postgres` | 4.1.4 |
| `@workflow-worlds/mongodb` | 0.2.1 |
| `nitro` | 3.0.260522-beta |
| `rollup` | 4.61.0 |

Transitive packages confirmed relevant:
- `@workflow/core` 4.3.1 (re-exported by `workflow`)
- `@workflow/world` 4.1.0-beta.2 (base `World` interface)

---

## Q1 — Import path and exact signature of `start`

**Confirmed.**

```typescript
import { start } from 'workflow/api';
```

The `start` function is exported from `workflow/api`, which re-exports from
`@workflow/core/runtime`. Four overloads are declared
(`node_modules/.pnpm/@workflow+core@4.3.1/node_modules/@workflow/core/dist/runtime/start.d.ts`):

```typescript
// Overload 1: with args + deploymentId
declare function start<TArgs extends unknown[], TResult>(
  workflow: WorkflowFunction<TArgs, TResult> | WorkflowMetadata,
  args: unknown[],
  options: StartOptionsWithDeploymentId
): Promise<Run<unknown>>;

// Overload 2: no args + deploymentId
declare function start<TResult>(
  workflow: WorkflowFunction<[], TResult> | WorkflowMetadata,
  options: StartOptionsWithDeploymentId
): Promise<Run<unknown>>;

// Overload 3: with args, no deploymentId (primary non-Vercel overload)
declare function start<TArgs extends unknown[], TResult>(
  workflow: WorkflowFunction<TArgs, TResult> | WorkflowMetadata,
  args: TArgs,
  options?: StartOptionsWithoutDeploymentId
): Promise<Run<TResult>>;

// Overload 4: no args, no deploymentId
declare function start<TResult>(
  workflow: WorkflowFunction<[], TResult> | WorkflowMetadata,
  options?: StartOptionsWithoutDeploymentId
): Promise<Run<TResult>>;
```

Supporting types:

```typescript
interface StartOptionsBase {
  world?: World;        // inject a specific world instance; if omitted, inferred from env
  specVersion?: number;
}
interface StartOptionsWithDeploymentId extends StartOptionsBase {
  deploymentId: 'latest' | (string & {});
}
interface StartOptionsWithoutDeploymentId extends StartOptionsBase {
  deploymentId?: undefined;
}
type StartOptions = StartOptionsWithDeploymentId | StartOptionsWithoutDeploymentId;

type WorkflowFunction<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>;
type WorkflowMetadata = { workflowId: string };
```

---

## Q2 — Exact type returned by `start` (the "run handle")

**Confirmed.**

`start` returns `Promise<Run<TResult>>`. `Run<TResult>` is a class defined in
`@workflow/core/dist/runtime/run.d.ts`:

```typescript
class Run<TResult> {
  runId: string;                             // ← confirmed: property is 'runId'

  // Lifecycle
  wakeUp(options?: StopSleepOptions): Promise<StopSleepResult>;
  cancel(): Promise<void>;

  // Getters (lazy-resolved promises)
  get exists(): Promise<boolean>;
  get status(): Promise<WorkflowRunStatus>;
  get returnValue(): Promise<TResult>;
  get workflowName(): Promise<string>;
  get createdAt(): Promise<Date>;
  get startedAt(): Promise<Date | undefined>;
  get completedAt(): Promise<Date | undefined>;
  get readable(): WorkflowReadableStream;

  // Explicit streaming
  getReadable<R = any>(options?: WorkflowReadableStreamOptions): WorkflowReadableStream<R>;
}
```

`WorkflowRunStatus` is `'pending' | 'running' | 'completed' | 'failed' | 'cancelled'`.

Key notes:
- The handle property is `runId` (string), not `id` or `run_id`.
- `Run` is also exported from `workflow/api` (re-exported from `@workflow/core/runtime`).
- `getRun<TResult>(runId: string): Run<TResult>` is available in both `workflow/api`
  and `workflow/runtime` to reconstitute a handle from a stored ID.

---

## Q3 — Postgres world: `createWorld` signature and lifecycle methods

**Confirmed.**

```typescript
import { createWorld } from '@workflow/world-postgres';
```

Source: `@workflow/world-postgres/dist/index.d.ts` and `config.d.ts`.

```typescript
function createWorld(config?: PostgresWorldConfig): World & {
  start(): Promise<void>;
};

type PostgresWorldConfig =
  | {
      connectionString: string;   // reads WORKFLOW_POSTGRES_URL if omitted; default 'postgres://world:world@localhost:5432/world'
      maxPoolSize?: number;        // reads WORKFLOW_POSTGRES_MAX_POOL_SIZE; default 10
      pool?: undefined;
    }
  | {
      pool: Pool;                  // pass an existing pg.Pool; close() will NOT end it
      connectionString?: undefined;
      maxPoolSize?: undefined;
    }
  & {
      jobPrefix?: string;          // reads WORKFLOW_POSTGRES_JOB_PREFIX
      queueConcurrency?: number;   // default 10; reads WORKFLOW_POSTGRES_WORKER_CONCURRENCY
      streamFlushIntervalMs?: number; // default 10ms; set to 0 for immediate flushing
    };
```

**Lifecycle methods on the returned object:**

- `start(): Promise<void>` — CONFIRMED (on the return type of `createWorld`; starts the graphile-worker queue).
- `close(): Promise<void>` — CONFIRMED as optional on the `World` interface (per `building-a-world.mdx` doc and `queue.d.ts`). NOT on the top-level `createWorld` return type declaration, but the internal `PostgresQueue` type (used by the queue sub-object) does expose `close()`.
- `stop()` — NOT PRESENT. No `stop` method exists anywhere in the postgres world types.
- `shutdown()` — NOT PRESENT. No `shutdown` method exists anywhere in the postgres world types.

Summary of lifecycle: call `world.start()` once at server startup. To gracefully shut down, call `world.close?.()` (optional, not on the public declared return type but present at runtime via the base `World` interface optional method).

**Design assumption correction:** The assumed shape `{ connectionString, jobPrefix, queueConcurrency, maxPoolSize }` is correct but incomplete — `pool` (mutually exclusive with `connectionString`) and `streamFlushIntervalMs` also exist.

---

## Q4 — MongoDB world: package name, `createWorld` signature, environment variables

**Confirmed.**

Package name: `@workflow-worlds/mongodb` (note: scope is `@workflow-worlds`, not `@workflow`).

```typescript
import { createWorld } from '@workflow-worlds/mongodb';
// or
import createWorld from '@workflow-worlds/mongodb'; // default export also available
```

Signature:

```typescript
function createWorld(config?: MongoDBWorldConfig): World;

interface MongoDBWorldConfig {
  mongoUrl?: string;       // env: WORKFLOW_MONGODB_URI; default 'mongodb://localhost:27017'
  databaseName?: string;   // env: WORKFLOW_MONGODB_DATABASE_NAME; default 'workflow'
  baseUrl?: string;        // env: WORKFLOW_SERVICE_URL; base URL for HTTP callbacks (queue)
  concurrency?: number;    // env: WORKFLOW_CONCURRENCY; max concurrent processing; default 20
  useChangeStreams?: boolean; // env: WORKFLOW_MONGODB_CHANGE_STREAMS ('true'/'false'); default true
  // MongoClient can also be injected directly (confirmed in streamer.d.ts: `client?: MongoClient`)
}
```

**CORRECTION vs design assumption:** The design provisionally uses `WORKFLOW_MONGO_URL` but the actual env var name is `WORKFLOW_MONGODB_URI`. This must be updated in the adapter env mapping.

Full list of confirmed MongoDB environment variables:

| Env var | Purpose | Default |
|---|---|---|
| `WORKFLOW_MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017` |
| `WORKFLOW_MONGODB_DATABASE_NAME` | Database name | `workflow` |
| `WORKFLOW_MONGODB_CHANGE_STREAMS` | Enable change streams (`'true'`/`'false'`) | `'true'` |
| `WORKFLOW_SERVICE_URL` | Base URL for HTTP callbacks | `http://localhost:{PORT}` |
| `WORKFLOW_CONCURRENCY` | Max concurrent message processing | `20` |

Unlike the postgres world, the MongoDB `createWorld` returns a plain `World` (not `World & { start() }`). No explicit `start()` on the declared return type — the world connects lazily on first use.

---

## Q5 — World selection: env-var-only vs explicit instance injection

**Confirmed.**

### Env-var-only approach (works, documented as primary path)

Setting `WORKFLOW_TARGET_WORLD` to the package name is sufficient for `start()` and
`getWorld()` to use the correct world. The runtime's `createWorld()` (no-arg, from
`workflow/runtime`) reads `WORKFLOW_TARGET_WORLD` and auto-imports the package.

For Postgres:
```bash
WORKFLOW_TARGET_WORLD="@workflow/world-postgres"
WORKFLOW_POSTGRES_URL="postgres://user:pass@host:5432/db"
```

For MongoDB:
```bash
WORKFLOW_TARGET_WORLD="@workflow-worlds/mongodb"
WORKFLOW_MONGODB_URI="mongodb://localhost:27017"
```

### Programmatic instance injection (also supported)

You may also create a world instance yourself and inject it via `setWorld()`:

```typescript
import { setWorld } from 'workflow/runtime';
import { createWorld } from '@workflow/world-postgres';

const world = createWorld({ connectionString: process.env.WORKFLOW_POSTGRES_URL });
setWorld(world);
```

Alternatively, pass `world` as an option directly to `start()`:

```typescript
import { start } from 'workflow/api';
const run = await start(myWorkflow, [arg1], { world });
```

### `getWorld()` — CONFIRMED

```typescript
import { getWorld } from 'workflow/runtime';
// signature: () => World
const world = getWorld();
```

No parameters; returns the singleton `World` (auto-created from env if not yet set).
Also re-exported from `@workflow/core/runtime`.

`setWorld(world: World | undefined): void` resets the cached singleton (useful when env vars change).

`getWorldHandlers()` also exists on `workflow/runtime` — returns only `Pick<World, 'createQueueHandler' | 'specVersion'>` for build-time use without env bindings.

---

## Spike Directive-in-Arrow (Task 1.1)

**VERDICT 2 — Named-only (more precisely: "top-level binding only").**

An arrow function passed as an **argument to a call expression** (the `defineWorldStep('id', async () => { "use step" })`
"candidate" form) is **NOT** detected or transformed by the `workflow` compiler. The directive is silently left in the
function body and no durable primitive is emitted — meaning the step/workflow would run as **plain non-durable code**.

We therefore **cannot** ship `defineWorldStep` / `defineWorldWorkflow` as runtime identity wrappers.
Ship **type-only ergonomics** instead (a `WorldStep<I,O>` / `WorldWorkflow<I,O>` type) and require users to write a
**top-level binding** with the directive inside the body, e.g.:

```ts
// OK — top-level named function (canonical, all docs use this)
export async function charge(order: Order) {
  "use step";
  return chargePayment(order);
}

// ALSO OK — arrow/fn-expression bound DIRECTLY to a const (no wrapping call)
export const charge: WorldStep<Order, Receipt> = async (order) => {
  "use step";
  return chargePayment(order);
};
```

### Where the transform actually lives

- File-selection gate (`@workflow/builders/dist/transform-utils.js`) is a **pure source-text regex** on the directive
  string (`useWorkflowPattern = /^\s*(['"])use workflow\1;?\s*$/m`) and is form-agnostic — so the file *is* picked up
  for transformation regardless of function form. That gate is **not** what decides durability.
- The real AST transform is a compiled-Rust SWC plugin: `@workflow/swc-plugin/swc_plugin_workflow.wasm` (v4.1.1),
  invoked by `@workflow/builders/dist/apply-swc-transform.js` via `@swc/core`'s `transform` with
  `jsc.experimental.plugins = [[swcPluginPath, { mode, moduleSpecifier }]]` where `mode` is `'workflow'` or `'step'`.
  This wasm decides what gets a durable boundary.

### Method used: empirical run of the **real production transform**

I invoked `applySwcTransform()` (the exact function the Nitro/rollup builders call) on control vs candidate forms and
inspected the emitted code + `workflowManifest`. A transformed step gets: the `"use step"` directive **stripped**, an
injected `import { registerStepFunction } from "workflow/internal/private"`, a `/**__internal_workflows{...}*/` manifest
comment, and a trailing `registerStepFunction("step//…", fn)` registration. A transformed workflow gets a
`fn.workflowId = "workflow//…"` assignment + `globalThis.__private_workflows.set(...)`. Untransformed code keeps the raw
directive and produces an empty `{}` manifest.

Results (mode in parens):

| Form | Transformed? | Evidence |
|---|---|---|
| `export async function f(){ "use step" }` (CONTROL) | **YES** | directive stripped, `registerStepFunction("step//./test//chargeControl", chargeControl)` emitted, manifest `{"steps":{...}}` |
| `export const f = async () => { "use step" }` (arrow bound directly to const) | **YES** | manifest `{"steps":{...}}`, `registerStepFunction("step//./test//chargeVar", chargeVar)` emitted |
| `const f = async () => { "use step" }; export { f }` (local then re-export) | **YES** | manifest populated, registration emitted |
| `obj = { async charge(){ "use step" } }` (object method) | **YES** | hoisted to `obj$charge`, `registerStepFunction("step//./t//obj/charge", obj$charge)` |
| **`export const f = defineWorldStep('id', async () => { "use step" })`** (CANDIDATE — arrow in wrapper call) | **NO** | directive left intact in body, **no** `registerStepFunction`, manifest `{}` |
| `export const a = wrap(async () => { "use step" })` (wrapper, single arg) | **NO** | directive intact, manifest `{}` |
| `register(async () => { "use step" })` (bare inline call arg) | **NO** | directive intact, manifest `{}` |
| `export const wf = defineWorldWorkflow('wf', async () => { "use workflow" })` (CANDIDATE workflow) | **NO** | no `.workflowId`, no `__private_workflows.set`, manifest `{}` |
| `export async function wf(){ "use workflow" }` (CONTROL workflow) | **YES** | `wf.workflowId = "workflow//…"`, `globalThis.__private_workflows.set(...)`, manifest populated |

Verbatim CONTROL output (transformed):
```js
import { registerStepFunction } from "workflow/internal/private";
/**__internal_workflows{"steps":{"test.ts":{"chargeControl":{"stepId":"step//./test//chargeControl"}}}}*/;
export async function chargeControl(order) { return order.amount; }
registerStepFunction("step//./test//chargeControl", chargeControl);
```

Verbatim CANDIDATE output (NOT transformed — directive survives, undurable):
```js
const defineWorldStep = (_id, fn)=>fn;
export const chargeCandidate = defineWorldStep('charge', async (order)=>{
    "use step";              // ← left in place, never stripped, never registered
    return order.amount;
});
// workflowManifest: {}
```

### Corroborating source/string evidence

`strings` on `swc_plugin_workflow.wasm` shows the transform validates the **container form** of a directive and
enumerates the supported containers — none of which is "arrow inside a call argument":

- `Class instance methods cannot be marked with "use workflow". Only static methods, functions, and object methods are supported.`
- `Functions marked with "use step" must be async functions`
- `<directive> must be at the top of the <…>` / `"…" is not a supported directive`
- registration symbols: `registerStepFunction`, `workflow/internal/private`, `WORKFLOW_USE_STEP`, `__private_workflows`.

(Note: `@workflow/builders/dist/workflows-extractor.js` *does* walk `ArrowFunctionExpression` in `buildFunctionMap`, but
that is only the **inspector graph** extractor — not the durability transform — so it is not evidence of durability.)

### Why this is the safe verdict

A runtime identity wrapper would compile cleanly, pass types, and *look* correct, but the step/workflow body would
execute as ordinary code with **zero durability / no replay boundary** — a silent correctness failure for users. The
deciding factor is purely syntactic: the directive-bearing function must be the initializer of a **top-level
declaration** (named `function`, or arrow/fn-expr bound directly to a `const`/`let`), an object method, or a static
method. Putting it inside a **call expression** (a wrapper) breaks detection.

**Ship plan:** type-only ergonomics — export `WorldStep<I,O>` / `WorldWorkflow<I,O>` function types so users get
inference + a documented requirement to write the directive inside a top-level binding. No `defineWorldStep` runtime
wrapper.

(Scratch project `/tmp/world-spike` used `workflow` 4.3.1 → `@workflow/swc-plugin` 4.1.1 / `@workflow/builders` 4.0.9,
`@swc/core` 1.15.3; cleaned up after the spike.)
