# Plan d'implémentation — Moteur de workflow "world" (SDK Vercel) pour ai-kit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un second moteur d'exécution de workflows ("world", basé sur le Vercel Workflow SDK, persisté en Postgres/MongoDB) à côté du moteur legacy en mémoire, exposé via une façade ai-kit unifiée `WorkflowKit` (défaut : legacy).

**Architecture:** Un nouveau package optionnel `@ai_kit/workflow-world` isole les dépendances lourdes du SDK Vercel (`workflow`, `@workflow/world-postgres`, `@workflow-worlds/mongodb`). `@ai_kit/core` reçoit une façade `WorkflowKit` qui détient la config (moteur + world), expose `start/stop/run`, et charge le package world en `import()` **dynamique** uniquement si `engine: 'world'`. Aucune dépendance Vercel n'est tirée par un utilisateur legacy. La couture est un contrat `WorldEngineAdapter` défini dans core et implémenté par le package world.

**Tech Stack:** TypeScript (NodeNext, ESM), pnpm workspaces, vitest, `tsc -p tsconfig.build.json`. SDK Vercel `workflow` + worlds. Spec de référence : `docs/superpowers/specs/2026-06-02-workflow-world-engine-design.md`.

---

## Notes transverses (à lire avant de commencer)

- **Branche** : travailler sur une branche dédiée `feat/workflow-world-engine` (on est sur `dev`). Ne pas commit sur `dev` directement.
- **Commits** : terminer chaque message de commit par la ligne :
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Commandes par package** :
  - build : `pnpm --filter <pkg> build`
  - test : `pnpm --filter <pkg> test`
- **Incertitudes SDK** : certaines signatures exactes du SDK Vercel ne sont confirmées que par lecture de la doc embarquée (`node_modules/workflow/docs/` via la commande `/workflow`). Les tâches concernées contiennent une **étape de vérification** explicite. Le code fourni reflète le meilleur état connu (confirmé en partie par d'anciens tests, cf. spec §4).
- **Gate bloquant** : la **Phase 1 (spike)** conditionne l'API d'écriture de la Phase 5. Ne pas figer les helpers d'écriture avant le verdict du spike.

---

## File Structure

**Nouveau package `@ai_kit/workflow-world`** (`packages/workflow-world/`)
- `package.json` — métadonnées, deps SDK Vercel, peer deps build, peer type-only sur core.
- `tsconfig.json`, `tsconfig.build.json` — calqués sur `packages/rag/`.
- `src/worlds.ts` — table `type → { target, applyEnv, load }` ; résolution + validation de config + application des env.
- `src/adapter.ts` — `createWorldAdapter(cfg)` : implémente `WorldEngineAdapter` (start/stop/run) ; loaders de modules injectables pour les tests.
- `src/authoring.ts` — `defineWorldStep` / `defineWorldWorkflow` + types `WorldStep` (forme finale décidée par le spike Phase 1).
- `src/index.ts` — ré-exports publics.
- `src/worlds.test.ts`, `src/adapter.test.ts`, `src/authoring.test.ts` — tests unitaires (mockés, sans DB).
- `src/integration.postgres.test.ts`, `src/integration.mongo.test.ts` — tests d'intégration (opt-in, DB réelle).
- `docker-compose.test.yml` — Postgres + MongoDB pour les tests d'intégration.

**Modifications `@ai_kit/core`** (`packages/core/`)
- `src/workflows/kit/types.ts` — `WorkflowEngine`, `WorldConfig`, `WorkflowKitOptions`, `WorldRunHandle`, `WorldEngineAdapter` (contrat).
- `src/workflows/kit/WorkflowKit.ts` — la façade.
- `src/workflows/kit/index.ts` — ré-exports.
- `src/workflows/index.ts` — `export * from "./kit/index.js";` (MODIF).
- `src/workflows/kit/WorkflowKit.test.ts` — tests unitaires de la façade.
- `package.json` — ajoute `@ai_kit/workflow-world` en `peerDependencies` (optionnel) + `devDependencies` (`workspace:*`) (MODIF).

**Racine**
- `pnpm-workspace.yaml` — ajoute `packages/workflow-world` (MODIF).
- `packages/core/tests/workflows/vercelWorld.test.ts`, `vercelAutoRegister.test.ts` — **SUPPRESSION** (tests orphelins, module jamais implémenté).

**Spike (jetable)** : `scratch/world-spike/` (hors workspace, supprimé en fin de Phase 1).

---

## Phase 0 — Préparation

### Task 0.1: Branche de travail

**Files:** aucun (git)

- [ ] **Step 1: Créer la branche**

Run:
```bash
cd /home/killian/Documents/dev/ai-kit
git checkout -b feat/workflow-world-engine
```
Expected: `Switched to a new branch 'feat/workflow-world-engine'`

### Task 0.2: Confirmer les signatures du SDK Vercel (lève §12.1, §12.3, §12.4 du spec)

**Files:**
- Create: `docs/superpowers/notes/2026-06-02-vercel-sdk-signatures.md`

- [ ] **Step 1: Installer le SDK dans un scratch isolé**

Run:
```bash
mkdir -p /home/killian/Documents/dev/ai-kit/scratch/world-spike
cd /home/killian/Documents/dev/ai-kit/scratch/world-spike
pnpm init
pnpm add workflow @workflow/world-postgres @workflow-worlds/mongodb nitro rollup
```
Expected: installation OK, `node_modules/workflow/docs/` présent.

- [ ] **Step 2: Lire la doc embarquée et noter les signatures exactes**

Lire (Read tool) :
- `scratch/world-spike/node_modules/workflow/docs/` (index + pages api-reference)
- README de `node_modules/@workflow/world-postgres` et `node_modules/@workflow-worlds/mongodb`

Consigner dans `docs/superpowers/notes/2026-06-02-vercel-sdk-signatures.md` les réponses confirmées à :
1. Import + signature exacte de `start` (déclenchement d'un run) — `workflow/api` ou autre ?
2. Type retourné par `start` (forme du `WorldRunHandle` : `runId` ? autre ?).
3. Postgres : signature de `createWorld(...)` (confirmer `{ connectionString, jobPrefix, queueConcurrency, maxPoolSize }`) et méthodes du world retourné (`start/stop/close/shutdown`).
4. MongoDB : nom du package, signature de son `createWorld`/équivalent, et **noms exacts des variables d'env** (le spec utilise `WORKFLOW_MONGO_URL` à titre provisoire).
5. Sélection du world : `WORKFLOW_TARGET_WORLD` (env) suffit-il, ou faut-il passer l'instance `createWorld(...)` au runtime ? `getWorld()` existe-t-il dans `workflow/runtime` ?

- [ ] **Step 3: Commit des notes**

```bash
cd /home/killian/Documents/dev/ai-kit
git add docs/superpowers/notes/2026-06-02-vercel-sdk-signatures.md
git commit -m "docs(workflow-world): confirm Vercel SDK signatures from bundled docs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Si une signature diffère du code de ce plan** : adapter le code des tâches suivantes en conséquence, en gardant la même structure. Les notes font foi sur les signatures.

---

## Phase 1 — SPIKE BLOQUANT : détection de directive dans une arrow (spec §12.0)

> Verdict requis avant la Phase 5. Détermine la forme finale de `defineWorldStep`/`defineWorldWorkflow`.

### Task 1.1: Monter un mini-workflow et tester la détection

**Files:**
- Create (jetable) : `scratch/world-spike/nitro.config.ts`, `scratch/world-spike/src/workflows.ts`, `scratch/world-spike/src/index.ts`

- [ ] **Step 1: Config Nitro**

`scratch/world-spike/nitro.config.ts` :
```ts
import { defineNitroConfig } from 'nitro/config';

export default defineNitroConfig({
  modules: ['workflow/nitro'],
  routes: { '/**': { handler: './src/index.ts', format: 'node' } },
});
```

- [ ] **Step 2: Deux écritures à comparer**

`scratch/world-spike/src/workflows.ts` :
```ts
// CONTRÔLE : fonction nommée (forme officielle documentée)
export async function controlWorkflow(x: number) {
  "use workflow";
  return await controlStep(x);
}
async function controlStep(x: number) {
  "use step";
  return x + 1;
}

// CANDIDAT : arrow passée à un wrapper identité (forme défaite à valider)
const identity = <T>(_id: string, fn: T): T => fn;

export const candidateWorkflow = identity('cand-wf', async (x: number) => {
  "use workflow";
  return await candidateStep(x);
});
const candidateStep = identity('cand-step', async (x: number) => {
  "use step";
  return x + 1;
});
```

- [ ] **Step 3: Route de déclenchement**

`scratch/world-spike/src/index.ts` :
```ts
import { start } from 'workflow/api';
import { controlWorkflow, candidateWorkflow } from './workflows.js';

export default async function handler() {
  const a = await start(controlWorkflow, [1]);
  const b = await start(candidateWorkflow, [1]);
  return new Response(JSON.stringify({ control: a, candidate: b }));
}
```
> Adapter les imports si la Task 0.2 a révélé d'autres chemins.

- [ ] **Step 4: Builder et déclencher**

Run:
```bash
cd /home/killian/Documents/dev/ai-kit/scratch/world-spike
# .env local (postgres jetable via docker, ou world-local si dispo)
npx nitro dev &
sleep 4
curl -s http://localhost:3000/
npx workflow inspect runs || npx workflow web
```
Expected (à observer) : pour CHAQUE workflow, les **steps apparaissent comme steps durables** dans l'inspecteur, et le build n'émet pas d'erreur de directive ignorée sur le candidat.

- [ ] **Step 5: Verdict (decision gate)**

Consigner dans `docs/superpowers/notes/2026-06-02-vercel-sdk-signatures.md` (section "Spike directive-in-arrow") l'un de :
- **A — OK** : le candidat est compilé comme le contrôle → Phase 5 livre `defineWorldStep`/`defineWorldWorkflow` en wrappers identité (forme du spec §7.1).
- **2 — Fonctions nommées seulement** : le candidat n'est PAS durable → Phase 5 livre des **types** (`WorldStep<I,O>`) + doc imposant `export async function name() { "use step" }` (pas de wrapper runtime).
- **3 — Échec** : fallback option B (directives brutes, pas de helper). La Task 5.x "authoring" devient une simple page de doc.

- [ ] **Step 6: Nettoyer le scratch et commit du verdict**

```bash
cd /home/killian/Documents/dev/ai-kit
rm -rf scratch/world-spike
git add docs/superpowers/notes/2026-06-02-vercel-sdk-signatures.md
git commit -m "spike(workflow-world): record directive-in-arrow detection verdict

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Scaffold du package `@ai_kit/workflow-world`

### Task 2.1: Créer le squelette du package

**Files:**
- Create: `packages/workflow-world/package.json`
- Create: `packages/workflow-world/tsconfig.json`
- Create: `packages/workflow-world/tsconfig.build.json`
- Create: `packages/workflow-world/src/index.ts`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: `package.json`**

`packages/workflow-world/package.json` :
```json
{
  "name": "@ai_kit/workflow-world",
  "version": "0.1.0",
  "description": "Vercel Workflow SDK world engine adapter for AI Kit (self-hosted Postgres/MongoDB).",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "clean": "rm -rf dist tsconfig.build.tsbuildinfo",
    "build": "pnpm run clean && tsc -p tsconfig.build.json",
    "prepare": "pnpm run build",
    "test": "vitest run"
  },
  "keywords": ["ai", "workflow", "vercel", "world", "postgres", "mongodb"],
  "license": "MIT",
  "packageManager": "pnpm@10.15.0",
  "publishConfig": { "access": "public" },
  "dependencies": {
    "workflow": "latest",
    "@workflow/world-postgres": "latest",
    "@workflow-worlds/mongodb": "latest"
  },
  "peerDependencies": {
    "@ai_kit/core": ">=1.3.0 <2"
  },
  "devDependencies": {
    "@ai_kit/core": "workspace:*",
    "typescript": "^5.9.2",
    "vitest": "^4.1.8"
  }
}
```
> Remplacer `"latest"` par les versions exactes installées au spike (Task 0.1) — lire `scratch`/le lockfile avant suppression, ou refaire `pnpm view <pkg> version`.

- [ ] **Step 2: `tsconfig.json`** (calqué sur `packages/rag/tsconfig.json`)

`packages/workflow-world/tsconfig.json` :
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "es2022",
    "types": ["node", "vitest/globals"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `tsconfig.build.json`** (calqué sur `packages/rag/tsconfig.build.json`)

`packages/workflow-world/tsconfig.build.json` :
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "stripInternal": true
  },
  "include": ["src"],
  "exclude": ["tests", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 4: `src/index.ts` (vide pour l'instant)**

`packages/workflow-world/src/index.ts` :
```ts
export {};
```

- [ ] **Step 5: Enregistrer dans le workspace**

Modifier `pnpm-workspace.yaml` : ajouter `  - packages/workflow-world` dans la liste `packages:` (après `  - packages/core`).

- [ ] **Step 6: Installer + build à blanc**

Run:
```bash
cd /home/killian/Documents/dev/ai-kit
pnpm install
pnpm --filter @ai_kit/workflow-world build
```
Expected: build OK (dist/index.js généré, vide).

- [ ] **Step 7: Commit**

```bash
git add packages/workflow-world pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(workflow-world): scaffold optional package

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Contrat d'adapter dans `@ai_kit/core`

### Task 3.1: Définir les types du kit (sans logique)

**Files:**
- Create: `packages/core/src/workflows/kit/types.ts`

- [ ] **Step 1: Écrire les types**

`packages/core/src/workflows/kit/types.ts` :
```ts
import type { Workflow } from "../workflow.js";
import type { WorkflowRunOptions, WorkflowRunResult } from "../types.js";

export type WorkflowEngine = "legacy" | "world";

export interface WorldConfig {
  type: "postgres" | "mongodb";
  /** Connection string (postgres:// ou mongodb://). */
  url: string;
  /** Postgres : namespacing des jobs si DB partagée. */
  jobPrefix?: string;
  /** Postgres : nombre de workers concurrents. */
  workerConcurrency?: number;
  /** Postgres : taille du pool de connexions. */
  maxPoolSize?: number;
}

export interface WorkflowKitOptions {
  /** Moteur par défaut. Défaut : "legacy". */
  engine?: WorkflowEngine;
  /** Config du world. Requis si engine === "world". */
  world?: WorldConfig;
}

/** Handle opaque renvoyé par le moteur world (pass-through du SDK Vercel). */
export interface WorldRunHandle {
  runId?: string;
  [key: string]: unknown;
}

/** Contrat implémenté par @ai_kit/workflow-world. Défini ici pour découpler core du SDK. */
export interface WorldEngineAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  run(workflow: (...args: any[]) => unknown, args: unknown[]): Promise<WorldRunHandle>;
}

/** Forme du module @ai_kit/workflow-world chargé dynamiquement. */
export interface WorkflowWorldModule {
  createWorldAdapter(config: WorldConfig): WorldEngineAdapter;
}

/** Options par appel de WorkflowKit.run. */
export interface WorkflowRunDispatchOptions {
  engine?: WorkflowEngine;
}

// Ré-export pratique pour les overloads de run()
export type { Workflow, WorkflowRunOptions, WorkflowRunResult };
```
> `Workflow`, `WorkflowRunOptions`, `WorkflowRunResult` proviennent de l'existant (`workflow.ts`, `types.ts`). Vérifier les chemins/types exacts à l'écriture (cf. spec §3 et l'exploration).

- [ ] **Step 2: Compiler les types**

Run:
```bash
cd /home/killian/Documents/dev/ai-kit
pnpm --filter @ai_kit/core exec tsc -p tsconfig.build.json --noEmit
```
Expected: pas d'erreur de type.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/workflows/kit/types.ts
git commit -m "feat(core): add WorkflowKit contract types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 3.2: Exporter les types depuis l'API publique de core (AVANT Phase 4)

> Indispensable : `@ai_kit/workflow-world` (Phase 4) fait `import type { WorldConfig } from "@ai_kit/core"`, qui résout vers le `dist/index.d.ts` de core. Les types doivent donc être exportés **et core rebuildé** avant la Phase 4. La classe `WorkflowKit` viendra plus tard (Phase 5).

**Files:**
- Create: `packages/core/src/workflows/kit/index.ts`
- Modify: `packages/core/src/workflows/index.ts`

- [ ] **Step 1: `kit/index.ts` — types uniquement (pas encore la classe)**

`packages/core/src/workflows/kit/index.ts` :
```ts
export type {
  WorkflowEngine,
  WorldConfig,
  WorkflowKitOptions,
  WorldRunHandle,
  WorldEngineAdapter,
  WorkflowWorldModule,
  WorkflowRunDispatchOptions,
} from "./types.js";
```

- [ ] **Step 2: Ré-exporter depuis `workflows/index.ts`**

Ajouter en fin de `packages/core/src/workflows/index.ts` :
```ts
export * from "./kit/index.js";
```

- [ ] **Step 3: Build de core (publie les types dans dist)**

Run: `pnpm --filter @ai_kit/core build`
Expected: build OK ; `dist/index.d.ts` exporte `WorldConfig`, `WorldEngineAdapter`, etc.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/workflows/kit/index.ts packages/core/src/workflows/index.ts
git commit -m "feat(core): export WorkflowKit contract types from public API

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Package world : `worlds.ts` puis `adapter.ts` (TDD)

> Pré-requis : Task 3.2 terminée (types exportés + core buildé), sinon les `import type ... from "@ai_kit/core"` ne résolvent pas.

### Task 4.1: `worlds.ts` — résolution + env (TDD)

**Files:**
- Create: `packages/workflow-world/src/worlds.ts`
- Test: `packages/workflow-world/src/worlds.test.ts`

- [ ] **Step 1: Test qui échoue**

`packages/workflow-world/src/worlds.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { resolveWorld, WORLD_TARGETS } from "./worlds.js";

describe("resolveWorld", () => {
  it("mappe postgres vers le bon target et applique les env", () => {
    const env: Record<string, string> = {};
    const w = resolveWorld(
      { type: "postgres", url: "postgres://u:p@h:5432/db", jobPrefix: "wf__", workerConcurrency: 5 },
      env,
    );
    expect(w.target).toBe(WORLD_TARGETS.postgres);
    expect(env.WORKFLOW_TARGET_WORLD).toBe(WORLD_TARGETS.postgres);
    expect(env.WORKFLOW_POSTGRES_URL).toBe("postgres://u:p@h:5432/db");
    expect(env.WORKFLOW_POSTGRES_JOB_PREFIX).toBe("wf__");
    expect(env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY).toBe("5");
  });

  it("mappe mongodb vers le bon target", () => {
    const env: Record<string, string> = {};
    const w = resolveWorld({ type: "mongodb", url: "mongodb://h:27017/db" }, env);
    expect(w.target).toBe(WORLD_TARGETS.mongodb);
    expect(env.WORKFLOW_TARGET_WORLD).toBe(WORLD_TARGETS.mongodb);
  });

  it("rejette une url manquante", () => {
    expect(() => resolveWorld({ type: "postgres", url: "" }, {})).toThrow(/url/i);
  });

  it("rejette un type inconnu", () => {
    // @ts-expect-error test runtime
    expect(() => resolveWorld({ type: "redis", url: "x" }, {})).toThrow(/unsupported|inconnu/i);
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `pnpm --filter @ai_kit/workflow-world test`
Expected: FAIL (`Cannot find module './worlds.js'`).

- [ ] **Step 3: Implémenter `worlds.ts`**

`packages/workflow-world/src/worlds.ts` :
```ts
import type { WorldConfig } from "@ai_kit/core";

export const WORLD_TARGETS = {
  postgres: "@workflow/world-postgres",
  mongodb: "@workflow-worlds/mongodb",
} as const;

export interface ResolvedWorld {
  target: string;
  type: WorldConfig["type"];
}

/** Valide la config, pose les variables d'env dans `env`, et renvoie le target résolu. */
export function resolveWorld(
  config: WorldConfig,
  env: Record<string, string | undefined> = process.env,
): ResolvedWorld {
  if (!config.url) {
    throw new Error("workflow-world: 'url' is required in WorldConfig");
  }
  const target = WORLD_TARGETS[config.type];
  if (!target) {
    throw new Error(`workflow-world: unsupported world type '${config.type}'`);
  }

  env.WORKFLOW_TARGET_WORLD = target;

  if (config.type === "postgres") {
    env.WORKFLOW_POSTGRES_URL = config.url;
    if (config.jobPrefix) env.WORKFLOW_POSTGRES_JOB_PREFIX = config.jobPrefix;
    if (config.workerConcurrency != null)
      env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY = String(config.workerConcurrency);
    if (config.maxPoolSize != null)
      env.WORKFLOW_POSTGRES_MAX_POOL_SIZE = String(config.maxPoolSize);
  } else {
    // mongodb — confirmer les noms d'env via les notes Task 0.2
    env.WORKFLOW_MONGO_URL = config.url;
  }

  return { target, type: config.type };
}
```

- [ ] **Step 4: Lancer → succès**

Run: `pnpm --filter @ai_kit/workflow-world test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-world/src/worlds.ts packages/workflow-world/src/worlds.test.ts
git commit -m "feat(workflow-world): world type resolution and env mapping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 4.2: `adapter.ts` — createWorldAdapter (TDD avec loaders injectables)

**Files:**
- Create: `packages/workflow-world/src/adapter.ts`
- Test: `packages/workflow-world/src/adapter.test.ts`

- [ ] **Step 1: Test qui échoue**

`packages/workflow-world/src/adapter.test.ts` :
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorldAdapter, __setWorldModuleLoaders } from "./adapter.js";

afterEach(() => __setWorldModuleLoaders());

function mockPostgres() {
  const start = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const shutdown = vi.fn().mockResolvedValue(undefined);
  const createWorld = vi.fn(() => ({ start, stop, close, shutdown }));
  const startRun = vi.fn().mockResolvedValue({ runId: "r_1" });
  __setWorldModuleLoaders({
    postgres: async () => ({ createWorld }),
    api: async () => ({ start: startRun }),
  });
  return { createWorld, start, stop, close, shutdown, startRun };
}

describe("createWorldAdapter (postgres)", () => {
  it("démarre le world avec la config mappée", async () => {
    const m = mockPostgres();
    const env: Record<string, string> = {};
    const adapter = createWorldAdapter(
      { type: "postgres", url: "postgres://u:p@h:5432/db", jobPrefix: "wf__", workerConcurrency: 5 },
      env,
    );
    await adapter.start();
    expect(m.createWorld).toHaveBeenCalledWith({
      connectionString: "postgres://u:p@h:5432/db",
      jobPrefix: "wf__",
      queueConcurrency: 5,
    });
    expect(m.start).toHaveBeenCalledTimes(1);
    expect(env.WORKFLOW_TARGET_WORLD).toBe("@workflow/world-postgres");
  });

  it("run délègue à start() du SDK", async () => {
    const m = mockPostgres();
    const adapter = createWorldAdapter({ type: "postgres", url: "postgres://x" }, {});
    const fn = async () => 1;
    const handle = await adapter.run(fn, ["a"]);
    expect(m.startRun).toHaveBeenCalledWith(fn, ["a"]);
    expect(handle).toEqual({ runId: "r_1" });
  });

  it("stop appelle stop/close/shutdown du world", async () => {
    const m = mockPostgres();
    const adapter = createWorldAdapter({ type: "postgres", url: "postgres://x" }, {});
    await adapter.start();
    await adapter.stop();
    expect(m.stop).toHaveBeenCalledTimes(1);
    expect(m.close).toHaveBeenCalledTimes(1);
    expect(m.shutdown).toHaveBeenCalledTimes(1);
  });

  it("erreur claire si le package world manque", async () => {
    __setWorldModuleLoaders({
      postgres: async () => {
        const e = new Error("not found") as Error & { code?: string };
        e.code = "ERR_MODULE_NOT_FOUND";
        throw e;
      },
    });
    const adapter = createWorldAdapter({ type: "postgres", url: "postgres://x" }, {});
    await expect(adapter.start()).rejects.toThrow("@workflow/world-postgres");
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `pnpm --filter @ai_kit/workflow-world test`
Expected: FAIL (`Cannot find module './adapter.js'`).

- [ ] **Step 3: Implémenter `adapter.ts`**

`packages/workflow-world/src/adapter.ts` :
```ts
import type { WorldConfig, WorldEngineAdapter, WorldRunHandle } from "@ai_kit/core";
import { resolveWorld, WORLD_TARGETS } from "./worlds.js";

interface PostgresWorld {
  start?(): Promise<void>;
  stop?(): Promise<void>;
  close?(): Promise<void>;
  shutdown?(): Promise<void>;
}
interface WorldModuleLoaders {
  postgres: () => Promise<{ createWorld: (opts: Record<string, unknown>) => PostgresWorld }>;
  mongodb: () => Promise<{ createWorld: (opts: Record<string, unknown>) => PostgresWorld }>;
  api: () => Promise<{ start: (fn: (...a: any[]) => unknown, args: unknown[]) => Promise<WorldRunHandle> }>;
}

function defaultLoaders(): WorldModuleLoaders {
  return {
    postgres: () => import(WORLD_TARGETS.postgres) as Promise<any>,
    mongodb: () => import(WORLD_TARGETS.mongodb) as Promise<any>,
    api: () => import("workflow/api") as Promise<any>,
  };
}

let loaders: WorldModuleLoaders = defaultLoaders();
/** @internal — test seam. Sans argument : reset. */
export function __setWorldModuleLoaders(custom?: Partial<WorldModuleLoaders>): void {
  loaders = { ...defaultLoaders(), ...custom };
}

async function loadWorldModule(type: WorldConfig["type"]) {
  try {
    return type === "postgres" ? await loaders.postgres() : await loaders.mongodb();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        `workflow-world: the optional dependency '${WORLD_TARGETS[type]}' is not installed. ` +
          `Install it: pnpm add ${WORLD_TARGETS[type]}`,
      );
    }
    throw err;
  }
}

export function createWorldAdapter(
  config: WorldConfig,
  env: Record<string, string | undefined> = process.env,
): WorldEngineAdapter {
  let world: PostgresWorld | undefined;

  return {
    async start() {
      resolveWorld(config, env);
      const mod = await loadWorldModule(config.type);
      world = mod.createWorld(buildWorldOptions(config));
      await world.start?.();
    },
    async stop() {
      if (!world) return;
      await world.stop?.();
      await world.close?.();
      await world.shutdown?.();
      world = undefined;
    },
    async run(fn, args) {
      const { start } = await loaders.api();
      return start(fn, args);
    },
  };
}

function buildWorldOptions(config: WorldConfig): Record<string, unknown> {
  if (config.type === "postgres") {
    const opts: Record<string, unknown> = { connectionString: config.url };
    if (config.jobPrefix) opts.jobPrefix = config.jobPrefix;
    if (config.workerConcurrency != null) opts.queueConcurrency = config.workerConcurrency;
    if (config.maxPoolSize != null) opts.maxPoolSize = config.maxPoolSize;
    return opts;
  }
  // mongodb — confirmer la forme via les notes Task 0.2
  return { connectionString: config.url };
}
```

- [ ] **Step 4: Lancer → succès**

Run: `pnpm --filter @ai_kit/workflow-world test`
Expected: PASS (toute la suite, dont les 4 nouveaux tests adapter).

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-world/src/adapter.ts packages/workflow-world/src/adapter.test.ts
git commit -m "feat(workflow-world): createWorldAdapter with injectable loaders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 4.3: `authoring.ts` — helpers d'écriture (forme = verdict Phase 1)

**Files:**
- Create: `packages/workflow-world/src/authoring.ts`
- Test: `packages/workflow-world/src/authoring.test.ts`

> **Branche selon le verdict du spike (Task 1.1 Step 5).**

- [ ] **Step 1 (verdict A) : test qui échoue**

`packages/workflow-world/src/authoring.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { defineWorldStep, defineWorldWorkflow } from "./authoring.js";

describe("authoring helpers (identity wrappers)", () => {
  it("defineWorldStep renvoie la même fonction (identité)", () => {
    const fn = async (x: number) => x + 1;
    const step = defineWorldStep("inc", fn);
    expect(step).toBe(fn);
  });
  it("defineWorldWorkflow renvoie la même fonction (identité)", () => {
    const fn = async (x: number) => x;
    const wf = defineWorldWorkflow("id", fn);
    expect(wf).toBe(fn);
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `pnpm --filter @ai_kit/workflow-world test`
Expected: FAIL (`Cannot find module './authoring.js'`).

- [ ] **Step 3 (verdict A) : implémenter en wrappers identité**

`packages/workflow-world/src/authoring.ts` :
```ts
/**
 * Helper d'écriture pour un step world. NB : la directive "use step" DOIT
 * rester la première instruction du corps de `fn` — le helper ne peut pas
 * l'injecter (détection au build par le compilo). Voir spec §7.1.
 */
export function defineWorldStep<Fn extends (...args: any[]) => unknown>(
  _id: string,
  fn: Fn,
): Fn {
  return fn;
}

/** Idem pour un workflow world. La directive "use workflow" reste obligatoire dans `fn`. */
export function defineWorldWorkflow<Fn extends (...args: any[]) => unknown>(
  _id: string,
  fn: Fn,
): Fn {
  return fn;
}

export type WorldStep<Args extends unknown[], Out> = (...args: Args) => Promise<Out>;
```

> **Si verdict = 2 (fonctions nommées seulement)** : ne pas exporter `defineWorldStep/defineWorldWorkflow` runtime ; n'exporter que les **types** (`WorldStep`) et documenter la forme `export async function name() { "use step" }`. Adapter le test pour ne valider que les types (`expectTypeOf`).
> **Si verdict = 3 (échec)** : ne pas créer `authoring.ts` ; sauter à la Task 4.4, et la doc (Phase 7) montrera uniquement les directives brutes.

- [ ] **Step 4: Lancer → succès**

Run: `pnpm --filter @ai_kit/workflow-world test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-world/src/authoring.ts packages/workflow-world/src/authoring.test.ts
git commit -m "feat(workflow-world): defineWorldStep/defineWorldWorkflow authoring helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 4.4: Exports publics du package

**Files:**
- Modify: `packages/workflow-world/src/index.ts`

- [ ] **Step 1: Écrire les ré-exports**

`packages/workflow-world/src/index.ts` (verdict A) :
```ts
export { createWorldAdapter } from "./adapter.js";
export { resolveWorld, WORLD_TARGETS } from "./worlds.js";
export { defineWorldStep, defineWorldWorkflow } from "./authoring.js";
export type { WorldStep } from "./authoring.js";
```
> Verdict 2 : retirer la ligne `createWorldAdapter`? Non — `createWorldAdapter` reste (c'est le runtime). Retirer seulement les helpers runtime absents. Verdict 3 : retirer la ligne `authoring`.

- [ ] **Step 2: Build du package**

Run: `pnpm --filter @ai_kit/workflow-world build`
Expected: build OK, `dist/index.d.ts` exporte `createWorldAdapter`.

- [ ] **Step 3: Commit**

```bash
git add packages/workflow-world/src/index.ts
git commit -m "feat(workflow-world): public exports

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Façade `WorkflowKit` dans `@ai_kit/core` (TDD)

### Task 5.1: Dépendance optionnelle vers le package world

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Ajouter peer optionnelle + devDep workspace**

Dans `packages/core/package.json` :
- Sous `peerDependencies`, ajouter : `"@ai_kit/workflow-world": ">=0.1.0 <1"`
- Sous `peerDependenciesMeta`, ajouter : `"@ai_kit/workflow-world": { "optional": true }`
- Sous `devDependencies`, ajouter : `"@ai_kit/workflow-world": "workspace:*"`

- [ ] **Step 2: Installer**

Run:
```bash
cd /home/killian/Documents/dev/ai-kit
pnpm install
```
Expected: lien workspace OK.

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml
git commit -m "chore(core): add @ai_kit/workflow-world as optional peer dependency

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5.2: `WorkflowKit` — validation de config (TDD)

**Files:**
- Create: `packages/core/src/workflows/kit/WorkflowKit.ts`
- Test: `packages/core/src/workflows/kit/WorkflowKit.test.ts`

- [ ] **Step 1: Test qui échoue**

`packages/core/src/workflows/kit/WorkflowKit.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { WorkflowKit } from "./WorkflowKit.js";

describe("WorkflowKit — config", () => {
  it("défaut = engine legacy", () => {
    expect(new WorkflowKit().engine).toBe("legacy");
  });

  it("engine 'world' sans config world → throw", () => {
    expect(() => new WorkflowKit({ engine: "world" })).toThrow(/world/i);
  });

  it("type de world inconnu → throw", () => {
    // @ts-expect-error test runtime
    expect(() => new WorkflowKit({ engine: "world", world: { type: "redis", url: "x" } })).toThrow();
  });

  it("start/stop sont no-op en legacy", async () => {
    const kit = new WorkflowKit();
    await expect(kit.start()).resolves.toBeUndefined();
    await expect(kit.stop()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `pnpm --filter @ai_kit/core test WorkflowKit`
Expected: FAIL (`Cannot find module './WorkflowKit.js'`).

- [ ] **Step 3: Implémenter `WorkflowKit.ts` (config + lifecycle)**

`packages/core/src/workflows/kit/WorkflowKit.ts` :
```ts
import type { Workflow } from "../workflow.js";
import type { WorkflowRunOptions, WorkflowRunResult } from "../types.js";
import type {
  WorkflowEngine,
  WorkflowKitOptions,
  WorldConfig,
  WorldEngineAdapter,
  WorkflowWorldModule,
  WorldRunHandle,
  WorkflowRunDispatchOptions,
} from "./types.js";

const VALID_WORLD_TYPES = ["postgres", "mongodb"] as const;

export class WorkflowKit {
  readonly engine: WorkflowEngine;
  readonly world?: WorldConfig;
  #adapter?: WorldEngineAdapter;

  constructor(options: WorkflowKitOptions = {}) {
    this.engine = options.engine ?? "legacy";
    this.world = options.world;

    if (this.engine === "world" && !this.world) {
      throw new Error("WorkflowKit: engine 'world' requires a 'world' config");
    }
    if (this.world && !VALID_WORLD_TYPES.includes(this.world.type)) {
      throw new Error(`WorkflowKit: unsupported world type '${this.world.type}'`);
    }
  }

  async start(): Promise<void> {
    if (this.engine !== "world") return;
    const adapter = await this.#ensureAdapter();
    await adapter.start();
  }

  async stop(): Promise<void> {
    if (this.engine !== "world" || !this.#adapter) return;
    await this.#adapter.stop();
  }

  // Overload legacy
  run<Output>(
    workflow: Workflow<any, Output, any, any>,
    options: WorkflowRunOptions<any, any, any>,
    dispatch?: WorkflowRunDispatchOptions,
  ): Promise<WorkflowRunResult<Output, any, any>>;
  // Overload world
  run(
    workflow: (...args: any[]) => unknown,
    args: unknown[],
    dispatch?: WorkflowRunDispatchOptions,
  ): Promise<WorldRunHandle>;
  // Implémentation
  async run(
    workflow: any,
    input: any,
    dispatch?: WorkflowRunDispatchOptions,
  ): Promise<unknown> {
    const engine = dispatch?.engine ?? this.engine;
    if (engine === "legacy") {
      return (workflow as Workflow<any, any, any, any>).run(input);
    }
    const adapter = await this.#ensureAdapter();
    return adapter.run(workflow, input as unknown[]);
  }

  async #ensureAdapter(): Promise<WorldEngineAdapter> {
    if (this.#adapter) return this.#adapter;
    if (!this.world) {
      throw new Error("WorkflowKit: engine 'world' requires a 'world' config");
    }
    let mod: WorkflowWorldModule;
    try {
      mod = (await import("@ai_kit/workflow-world")) as unknown as WorkflowWorldModule;
    } catch {
      throw new Error(
        "WorkflowKit: engine 'world' requires the '@ai_kit/workflow-world' package. " +
          "Install it: pnpm add @ai_kit/workflow-world",
      );
    }
    this.#adapter = mod.createWorldAdapter(this.world);
    return this.#adapter;
  }
}
```
> Vérifier la signature exacte de `Workflow.run(options)` dans `workflow.ts` (spec §2 indique `run(options: WorkflowRunOptions)` → `WorkflowRunResult`). Ajuster les génériques si nécessaire.

- [ ] **Step 4: Lancer → succès**

Run: `pnpm --filter @ai_kit/core test WorkflowKit`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workflows/kit/WorkflowKit.ts packages/core/src/workflows/kit/WorkflowKit.test.ts
git commit -m "feat(core): WorkflowKit facade with config validation and lifecycle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5.3: Dispatch `run` — délégation legacy & world (TDD)

**Files:**
- Modify: `packages/core/src/workflows/kit/WorkflowKit.test.ts`

- [ ] **Step 1: Ajouter les tests de dispatch (échec)**

Ajouter à `WorkflowKit.test.ts` :
```ts
import { vi } from "vitest";

describe("WorkflowKit — dispatch run", () => {
  it("legacy : délègue à Workflow.run", async () => {
    const fakeWorkflow = { run: vi.fn().mockResolvedValue({ status: "success" }) };
    const kit = new WorkflowKit(); // legacy
    const res = await kit.run(fakeWorkflow as any, { inputData: { id: 1 } });
    expect(fakeWorkflow.run).toHaveBeenCalledWith({ inputData: { id: 1 } });
    expect(res).toEqual({ status: "success" });
  });

  it("world : délègue à adapter.run via @ai_kit/workflow-world", async () => {
    const adapterRun = vi.fn().mockResolvedValue({ runId: "r_9" });
    vi.doMock("@ai_kit/workflow-world", () => ({
      createWorldAdapter: () => ({
        start: vi.fn(), stop: vi.fn(), run: adapterRun,
      }),
    }));
    const { WorkflowKit: Kit } = await import("./WorkflowKit.js");
    const kit = new Kit({ engine: "world", world: { type: "postgres", url: "postgres://x" } });
    const fn = async () => 1;
    const handle = await kit.run(fn, ["a"]);
    expect(adapterRun).toHaveBeenCalledWith(fn, ["a"]);
    expect(handle).toEqual({ runId: "r_9" });
    vi.doUnmock("@ai_kit/workflow-world");
  });
});
```
> `vi.doMock` doit précéder l'`import()` dynamique du module testé (déjà le cas ici). Ajouter `vi.resetModules()` en `beforeEach` du nouveau describe si nécessaire.

- [ ] **Step 2: Lancer → succès** (l'implémentation de 5.2 couvre déjà ces cas)

Run: `pnpm --filter @ai_kit/core test WorkflowKit`
Expected: PASS (tous les tests, dont les 2 nouveaux). Si le mock world échoue, ajuster `vi.resetModules()`/ordre des imports — ne PAS modifier la logique de `WorkflowKit`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/workflows/kit/WorkflowKit.test.ts
git commit -m "test(core): WorkflowKit run dispatch (legacy + world)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5.4: Exporter la classe `WorkflowKit` depuis core

> Les **types** sont déjà exportés (Task 3.2). Ici on ajoute uniquement la **classe**.

**Files:**
- Modify: `packages/core/src/workflows/kit/index.ts`

- [ ] **Step 1: Ajouter l'export de la classe**

Ajouter en tête de `packages/core/src/workflows/kit/index.ts` (au-dessus de l'`export type` existant) :
```ts
export { WorkflowKit } from "./WorkflowKit.js";
```

- [ ] **Step 2: Build de core**

Run: `pnpm --filter @ai_kit/core build`
Expected: build OK ; `dist/index.d.ts` exporte `WorkflowKit`.

- [ ] **Step 3: Vérifier l'import public**

Run:
```bash
cd /home/killian/Documents/dev/ai-kit
node -e "import('@ai_kit/core').then(m => console.log(typeof m.WorkflowKit))"
```
Expected: `function`

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/workflows/kit/index.ts
git commit -m "feat(core): export WorkflowKit class from public API

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Nettoyage des tests obsolètes

### Task 6.1: Supprimer les tests vercel orphelins

**Files:**
- Delete: `packages/core/tests/workflows/vercelWorld.test.ts`
- Delete: `packages/core/tests/workflows/vercelAutoRegister.test.ts`

- [ ] **Step 1: Confirmer qu'ils ciblent un module non créé**

Run:
```bash
cd /home/killian/Documents/dev/ai-kit
ls packages/core/src/workflows/vercel/ 2>&1   # doit être vide
```
Expected: dossier vide → ces tests ne peuvent pas passer (module absent), et on a décidé de mettre le world dans `@ai_kit/workflow-world`, pas dans core.

- [ ] **Step 2: Supprimer**

Run:
```bash
git rm packages/core/tests/workflows/vercelWorld.test.ts packages/core/tests/workflows/vercelAutoRegister.test.ts
rmdir packages/core/src/workflows/vercel 2>/dev/null || true
```

- [ ] **Step 3: Lancer la suite core**

Run: `pnpm --filter @ai_kit/core test`
Expected: la suite tourne ; les échecs liés à `vercelWorld`/`vercelAutoRegister` ont disparu. (Les autres échecs pré-existants connus ne sont pas du ressort de ce plan.)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(core): remove orphaned vercel world test stubs

Module src/workflows/vercel was never implemented; the world engine now
lives in the optional @ai_kit/workflow-world package.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7 — Tests d'intégration (opt-in) & documentation

> **Stratégie tests à deux niveaux :**
> - **Unitaire (toujours, sans DB)** : Phases 4–5. Les modules SDK/world sont **mockés** via les loaders injectables (`__setWorldModuleLoaders`) et `vi.doMock`. Aucune base requise → tournent partout, y compris CI.
> - **Intégration (opt-in, DB réelle)** : tâches ci-dessous. Postgres + MongoDB réels lancés via **`docker-compose.test.yml`**. Skip automatique si les URLs d'env ne sont pas posées → jamais bloquant en CI.

### Task 7.1: `docker-compose.test.yml` (postgres + mongo)

**Files:**
- Create: `packages/workflow-world/docker-compose.test.yml`
- Modify: `packages/workflow-world/package.json` (scripts)

- [ ] **Step 1: Écrire le compose**

`packages/workflow-world/docker-compose.test.yml` :
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: world
      POSTGRES_PASSWORD: world
      POSTGRES_DB: world
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U world -d world"]
      interval: 2s
      timeout: 3s
      retries: 30
  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"]
      interval: 2s
      timeout: 3s
      retries: 30
```

- [ ] **Step 2: Scripts package.json**

Ajouter dans `scripts` de `packages/workflow-world/package.json` :
```json
    "db:up": "docker compose -f docker-compose.test.yml up -d --wait",
    "db:down": "docker compose -f docker-compose.test.yml down -v",
    "test:integration": "WORKFLOW_WORLD_PG_URL=postgres://world:world@localhost:5432/world WORKFLOW_WORLD_MONGO_URL=mongodb://localhost:27017/world vitest run integration"
```
> `--wait` (Compose v2) bloque jusqu'à ce que les healthchecks passent → les DB sont prêtes avant les tests.

- [ ] **Step 3: Vérifier que le compose démarre**

Run:
```bash
cd /home/killian/Documents/dev/ai-kit/packages/workflow-world
pnpm run db:up
docker compose -f docker-compose.test.yml ps
pnpm run db:down
```
Expected: les 2 services passent `healthy` puis sont supprimés proprement.

- [ ] **Step 4: Commit**

```bash
cd /home/killian/Documents/dev/ai-kit
git add packages/workflow-world/docker-compose.test.yml packages/workflow-world/package.json
git commit -m "test(workflow-world): docker-compose for postgres+mongo integration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 7.2: Test d'intégration Postgres (opt-in)

**Files:**
- Create: `packages/workflow-world/src/integration.postgres.test.ts`

- [ ] **Step 1: Test gardé par variable d'env**

`packages/workflow-world/src/integration.postgres.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { createWorldAdapter } from "./adapter.js";

const RUN_IT = process.env.WORKFLOW_WORLD_PG_URL ? describe : describe.skip;

RUN_IT("integration: postgres world", () => {
  it("démarre et arrête un world Postgres réel", async () => {
    const adapter = createWorldAdapter({
      type: "postgres",
      url: process.env.WORKFLOW_WORLD_PG_URL!,
    });
    await adapter.start();
    await adapter.stop();
    expect(true).toBe(true);
  }, 60_000);
});
```

- [ ] **Step 2: Vérifier le skip par défaut**

Run: `pnpm --filter @ai_kit/workflow-world test`
Expected: le bloc integration est **skipped** (pas de `WORKFLOW_WORLD_PG_URL`).

- [ ] **Step 3 (optionnel local) : lancer les DB et exécuter l'intégration**

Run:
```bash
cd /home/killian/Documents/dev/ai-kit/packages/workflow-world
pnpm run db:up
pnpm run test:integration
pnpm run db:down
```
Expected: test Postgres PASS (ou consigner l'échec/ajustement de signature dans les notes Task 0.2).

- [ ] **Step 4: Commit**

```bash
cd /home/killian/Documents/dev/ai-kit
git add packages/workflow-world/src/integration.postgres.test.ts
git commit -m "test(workflow-world): opt-in postgres integration test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 7.3: Test d'intégration MongoDB (opt-in)

**Files:**
- Create: `packages/workflow-world/src/integration.mongo.test.ts`

- [ ] **Step 1: Test gardé par variable d'env**

`packages/workflow-world/src/integration.mongo.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { createWorldAdapter } from "./adapter.js";

const RUN_IT = process.env.WORKFLOW_WORLD_MONGO_URL ? describe : describe.skip;

RUN_IT("integration: mongodb world (expérimental)", () => {
  it("démarre et arrête un world MongoDB réel", async () => {
    const adapter = createWorldAdapter({
      type: "mongodb",
      url: process.env.WORKFLOW_WORLD_MONGO_URL!,
    });
    await adapter.start();
    await adapter.stop();
    expect(true).toBe(true);
  }, 60_000);
});
```
> World Mongo = communautaire/expérimental (cf. spec §1, §7.2). Si la signature/les env diffèrent (notes Task 0.2), ajuster ce test et `buildWorldOptions`/`resolveWorld` en conséquence. Si le world ne démarre pas du tout dans la version installée, marquer le test `describe.skip` avec un commentaire « expérimental — non supporté en l'état » plutôt que de le laisser rouge.

- [ ] **Step 2: Vérifier le skip par défaut**

Run: `pnpm --filter @ai_kit/workflow-world test`
Expected: le bloc Mongo est **skipped** (pas de `WORKFLOW_WORLD_MONGO_URL`).

- [ ] **Step 3 (optionnel local) : exécuter contre le compose**

Run:
```bash
cd /home/killian/Documents/dev/ai-kit/packages/workflow-world
pnpm run db:up
pnpm run test:integration        # exécute postgres + mongo
pnpm run db:down
```
Expected: test Mongo PASS, ou skip documenté si expérimental non supporté.

- [ ] **Step 4: Commit**

```bash
cd /home/killian/Documents/dev/ai-kit
git add packages/workflow-world/src/integration.mongo.test.ts
git commit -m "test(workflow-world): opt-in mongodb integration test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 7.4: README du package + lien vers le spec

**Files:**
- Create: `packages/workflow-world/README.md`

- [ ] **Step 1: Écrire le README**

`packages/workflow-world/README.md` — contenu :
```markdown
# @ai_kit/workflow-world

Moteur de workflow "world" pour AI Kit : adapte le Vercel Workflow SDK
(persistance durable Postgres/MongoDB) derrière la façade `WorkflowKit` de
`@ai_kit/core`. Optionnel : non requis pour le moteur legacy.

## Installation

\`\`\`bash
pnpm add @ai_kit/core @ai_kit/workflow-world workflow @workflow/world-postgres
pnpm add -D nitro rollup
\`\`\`

## Contrainte

Le SDK Vercel exige une étape de build (Nitro) et un worker long-vivant.
Voir le guide complet et les exemples end-to-end :
`docs/superpowers/specs/2026-06-02-workflow-world-engine-design.md` (§5, §6).

## Usage

\`\`\`ts
import { WorkflowKit } from '@ai_kit/core';
import { defineWorldWorkflow, defineWorldStep } from '@ai_kit/workflow-world';

const kit = new WorkflowKit({
  engine: 'world',
  world: { type: 'postgres', url: process.env.WORKFLOW_POSTGRES_URL! },
});
await kit.start();
\`\`\`

> La directive `"use step"` / `"use workflow"` reste obligatoire dans le corps
> des fonctions, même avec `defineWorldStep` (détection au build). Voir spec §7.1.

## Tests

- Unitaires (sans DB, mockés) : `pnpm test`
- Intégration (opt-in, DB réelle) :
  `pnpm run db:up && pnpm run test:integration && pnpm run db:down`
  (lance Postgres + MongoDB via `docker-compose.test.yml`).
```
> Si le verdict du spike est 2 ou 3, retirer la mention `defineWorldStep`/`defineWorldWorkflow` et montrer la forme retenue.

- [ ] **Step 2: Commit**

```bash
git add packages/workflow-world/README.md
git commit -m "docs(workflow-world): package README

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 7.5: Vérification finale globale

**Files:** aucun

- [ ] **Step 1: Build des deux packages**

Run:
```bash
cd /home/killian/Documents/dev/ai-kit
pnpm --filter @ai_kit/workflow-world build && pnpm --filter @ai_kit/core build
```
Expected: les deux builds OK.

- [ ] **Step 2: Tests des deux packages**

Run:
```bash
pnpm --filter @ai_kit/workflow-world test && pnpm --filter @ai_kit/core test
```
Expected: workflow-world 100% vert ; core sans nouvel échec (les échecs pré-existants connus mis à part — cf. mémoire projet ; la CI ne gate que server + client-kit).

- [ ] **Step 3: Vérifier la non-régression server**

Run: `pnpm --filter @ai_kit/server build && pnpm --filter @ai_kit/server test`
Expected: server OK (il dépend de core).

- [ ] **Step 4: Commit final si des artefacts de lock ont changé**

```bash
git add -A && git commit -m "chore(workflow-world): final build/lock sync

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" || echo "rien à committer"
```

---

## Récap de couverture (spec → tâches)

| Section du spec | Tâche(s) |
|---|---|
| §2 Architecture / packaging | Phase 2 (scaffold) + Task 5.1 (peer dep) |
| §3 Façade WorkflowKit (config, lifecycle, run, env) | Phase 3 (types) + Phase 5 (impl) |
| §4 Contrat d'adapter + mapping world | Task 3.1 + Task 4.1 + Task 4.2 |
| §5 Frontières app hôte (Nitro) | README 7.2 + doc spec (référencée) |
| §6 Exemples d'usage | README 7.2 (renvoi au spec §6) |
| §7.1 Helpers d'écriture (option A) | Phase 1 (spike) + Task 4.3 |
| §7.2 Couverture fonctionnelle | héritée du SDK (rien à coder) |
| §9 Erreurs/retries (dep manquante) | Task 4.2 (erreur claire) + Task 5.2 (#ensureAdapter) |
| §10 Tests (unit + intégration opt-in) | Phases 4–5 (unit, mockés, sans DB) + Task 7.1 (docker-compose PG+Mongo) + Tasks 7.2/7.3 (intégration PG/Mongo) |
| §12.0 Spike bloquant | Phase 1 |
| §12.1/.3/.4 signatures SDK | Task 0.2 |
| §12.2 env Mongo | Task 0.2 (Step 2.4) |
| Nettoyage tests obsolètes | Phase 6 |
