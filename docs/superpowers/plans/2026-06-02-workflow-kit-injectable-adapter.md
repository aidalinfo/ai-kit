# WorkflowKit — adapter/world injectables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'app hôte d'injecter un `WorldEngineAdapter` pré-construit (et le loader du world SDK) dans `WorkflowKit`, pour que les imports de la chaîne `world` soient des littéraux tracés par le bundler → `@ai_kit/workflow-world` et `@workflow/world-postgres` entrent dans `.output` sans `traceInclude`.

**Architecture :** Deux changements rétrocompatibles. (1) `@ai_kit/workflow-world` : `createWorldAdapter(config)` accepte `config.module` (loader du world). (2) `@ai_kit/core` : `WorkflowKitOptions.adapter` court-circuite l'import dynamique de `@ai_kit/workflow-world`. Puis bump de version + merge `dev→main` (publish CI) + câblage LeRedacteurV2.

**Tech Stack :** TypeScript (ESM), Vitest, pnpm workspace, Nitro/Nuxt (app hôte), Vercel Workflow SDK (`workflow`, `@workflow/world-postgres`).

**Spec :** `docs/superpowers/specs/2026-06-02-workflow-kit-injectable-adapter-design.md`

**Branche :** `feat/workflow-kit-injectable-adapter` (basée sur `origin/dev`). Le spec y est déjà commité.

---

## File Structure

- `packages/workflow-world/src/contract.ts` — ajoute `WorldConfig.module?` (loader optionnel du world).
- `packages/workflow-world/src/adapter.ts` — `loadWorldModule` priorise `config.module` sur le loader dynamique interne.
- `packages/workflow-world/src/adapter.test.ts` — test du chemin `module`.
- `packages/core/src/workflows/kit/types.ts` — ajoute `WorkflowKitOptions.adapter?`.
- `packages/core/src/workflows/kit/WorkflowKit.ts` — init `#adapter` depuis options + validation.
- `packages/core/src/workflows/kit/WorkflowKit.test.ts` — test du chemin adapter injecté.
- `packages/workflow-world/README.md` — recette déploiement (pattern injecté).
- `packages/{core,workflow-world}/package.json` — bumps de version.

---

## Phase 1 — `@ai_kit/workflow-world` : loader `module` injectable

### Task 1 : `WorldConfig.module?` + `loadWorldModule(config)`

**Files:**
- Modify: `packages/workflow-world/src/contract.ts`
- Modify: `packages/workflow-world/src/adapter.ts`
- Test: `packages/workflow-world/src/adapter.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter ce test dans le `describe("createWorldAdapter (postgres)", …)` de `packages/workflow-world/src/adapter.test.ts` :

```ts
it("module injecté : utilise config.module et NON le loader dynamique du type", async () => {
  // loader dynamique interne : doit ne JAMAIS être appelé
  const dynPostgres = vi.fn(async () => ({ createWorld: vi.fn() }));
  const setWorld = vi.fn();
  __setWorldModuleLoaders({
    postgres: dynPostgres,
    runtime: async () => ({ setWorld }),
    api: async () => ({ start: vi.fn() }),
  });

  // loader fourni par l'app hôte (littéral chez le consommateur)
  const world = { start: vi.fn().mockResolvedValue(undefined) };
  const moduleCreateWorld = vi.fn(() => world);
  const moduleLoader = vi.fn(async () => ({ createWorld: moduleCreateWorld }));

  const adapter = createWorldAdapter({
    type: "postgres",
    url: "postgres://u:p@h:5432/db",
    module: moduleLoader,
  });
  await adapter.start();

  expect(moduleLoader).toHaveBeenCalledTimes(1);
  expect(moduleCreateWorld).toHaveBeenCalledWith({ connectionString: "postgres://u:p@h:5432/db" });
  expect(setWorld).toHaveBeenCalledWith(world);
  expect(dynPostgres).not.toHaveBeenCalled();
});
```

- [ ] **Step 2 : Lancer le test → échec attendu**

Run: `cd packages/workflow-world && pnpm vitest run src/adapter.test.ts -t "module injecté"`
Expected: FAIL — TS : `module` n'existe pas sur le type du paramètre (ou test rouge).

- [ ] **Step 3 : Ajouter `module?` au contrat**

Dans `packages/workflow-world/src/contract.ts`, ajouter le champ à l'interface `WorldConfig` (après `maxPoolSize?`) :

```ts
  /** Postgres : taille du pool de connexions. */
  maxPoolSize?: number;
  /**
   * Loader du module world fourni par l'app hôte, sous forme de littéral
   * (`() => import('@workflow/world-postgres')`). Quand présent, il remplace
   * l'import dynamique interne : le littéral vit dans le code tracé de l'app,
   * donc le bundler (nft) inclut le package dans `.output`. Doit exposer `createWorld`.
   */
  module?: () => Promise<{ createWorld: (opts: Record<string, unknown>) => unknown }>;
```

- [ ] **Step 4 : `loadWorldModule` priorise `config.module`**

Dans `packages/workflow-world/src/adapter.ts`, remplacer la fonction `loadWorldModule` :

```ts
async function loadWorldModule(config: WorldConfig) {
  const loader = config.module ?? loaders[config.type];
  try {
    return await loader();
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        `workflow-world: the world module '${WORLD_TARGETS[config.type]}' could not be loaded. ` +
          `Install it (pnpm add ${WORLD_TARGETS[config.type]}) or pass 'module' in the world config.`,
      );
    }
    throw err;
  }
}
```

Puis, dans `createWorldAdapter`, mettre à jour l'appel et caster le world (le loader injecté renvoie `unknown`) :

```ts
    async start() {
      const mod = await loadWorldModule(config);
      world = mod.createWorld(buildWorldOptions(config)) as SdkWorld;
      const { setWorld } = await loaders.runtime();
      setWorld(world);
      await world.start?.();
    },
```

- [ ] **Step 5 : Lancer le test ciblé → succès**

Run: `cd packages/workflow-world && pnpm vitest run src/adapter.test.ts -t "module injecté"`
Expected: PASS

- [ ] **Step 6 : Suite complète + build du package**

Run: `cd packages/workflow-world && pnpm vitest run && pnpm build`
Expected: tous les tests PASS (les tests existants — chemin dynamique sans `module` — restent verts), build OK (génère `dist/`).

- [ ] **Step 7 : Commit**

```bash
git add packages/workflow-world/src/contract.ts packages/workflow-world/src/adapter.ts packages/workflow-world/src/adapter.test.ts
git commit -m "feat(workflow-world): WorldConfig.module — loader de world injectable (tracing-friendly)

Permet à l'app hôte de fournir () => import('@workflow/world-postgres'),
littéral tracé par le bundler, à la place de l'import dynamique interne.
Rétrocompatible : sans 'module', comportement inchangé.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — `@ai_kit/core` : `WorkflowKit` accepte un adapter injecté

### Task 2 : `WorkflowKitOptions.adapter?` + court-circuit

**Files:**
- Modify: `packages/core/src/workflows/kit/types.ts`
- Modify: `packages/core/src/workflows/kit/WorkflowKit.ts`
- Test: `packages/core/src/workflows/kit/WorkflowKit.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter ce `describe` à la fin de `packages/core/src/workflows/kit/WorkflowKit.test.ts` :

```ts
describe("WorkflowKit — adapter injecté", () => {
  it("world : start/run/stop délèguent à l'adapter SANS charger @ai_kit/workflow-world", async () => {
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue({ runId: "r_inj" }),
    };
    const loader = vi.fn(); // le seam ne doit JAMAIS être invoqué
    __setWorkflowWorldLoader(loader);

    const kit = new WorkflowKit({ engine: "world", adapter });
    await kit.start();
    const fn = async () => 1;
    const handle = await kit.run(fn, ["a"]);
    await kit.stop();

    expect(adapter.start).toHaveBeenCalledTimes(1);
    expect(adapter.run).toHaveBeenCalledWith(fn, ["a"]);
    expect(handle).toEqual({ runId: "r_inj" });
    expect(adapter.stop).toHaveBeenCalledTimes(1);
    expect(loader).not.toHaveBeenCalled();
  });

  it("world : adapter injecté sans config 'world' → ne throw pas", () => {
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue({ runId: "r" }),
    };
    expect(() => new WorkflowKit({ engine: "world", adapter })).not.toThrow();
  });
});
```

- [ ] **Step 2 : Lancer → échec attendu**

Run: `cd packages/core && pnpm vitest run src/workflows/kit/WorkflowKit.test.ts -t "adapter injecté"`
Expected: FAIL — TS : `adapter` n'existe pas sur `WorkflowKitOptions` ; et `new WorkflowKit({ engine:'world', adapter })` throw encore (validation actuelle).

- [ ] **Step 3 : Ajouter `adapter?` aux options**

Dans `packages/core/src/workflows/kit/types.ts`, étendre `WorkflowKitOptions` :

```ts
export interface WorkflowKitOptions {
  /** Moteur par défaut. Défaut : "legacy". */
  engine?: WorkflowEngine;
  /** Config du world. Requis si engine === "world" ET adapter absent. */
  world?: WorldConfig;
  /**
   * Adapter world pré-construit (via `createWorldAdapter` de @ai_kit/workflow-world,
   * importé statiquement par l'app hôte). Quand fourni, court-circuite l'import
   * dynamique de @ai_kit/workflow-world — ce qui rend les packages traçables par
   * le bundler depuis le code de l'app. Prioritaire sur `world`.
   */
  adapter?: WorldEngineAdapter;
}
```

- [ ] **Step 4 : Init `#adapter` + validation dans `WorkflowKit`**

Dans `packages/core/src/workflows/kit/WorkflowKit.ts`, remplacer le constructeur :

```ts
  constructor(options: WorkflowKitOptions = {}) {
    this.engine = options.engine ?? "legacy";
    this.world = options.world;
    if (options.adapter) this.#adapter = options.adapter;

    if (this.engine === "world" && !this.world && !this.#adapter) {
      throw new Error(
        "WorkflowKit: engine 'world' requires a 'world' config or an 'adapter'",
      );
    }
    if (this.world && !VALID_WORLD_TYPES.includes(this.world.type)) {
      throw new Error(`WorkflowKit: unsupported world type '${this.world.type}'`);
    }
  }
```

(`#ensureAdapter()` retourne déjà `this.#adapter` en premier — aucun autre changement requis : l'adapter injecté est utilisé sans appeler `worldModuleLoader`.)

- [ ] **Step 5 : Lancer le test ciblé → succès**

Run: `cd packages/core && pnpm vitest run src/workflows/kit/WorkflowKit.test.ts`
Expected: PASS (les tests existants — chemin dynamique via seam, validation sans world ni adapter — restent verts).

- [ ] **Step 6 : Build du package**

Run: `cd packages/core && pnpm build`
Expected: build OK (tsc). NB (mémoire projet) : la suite globale `core` a des échecs pré-existants sans rapport ; ne lancer que le fichier `WorkflowKit.test.ts` ci-dessus pour cette tâche.

- [ ] **Step 7 : Commit**

```bash
git add packages/core/src/workflows/kit/types.ts packages/core/src/workflows/kit/WorkflowKit.ts packages/core/src/workflows/kit/WorkflowKit.test.ts
git commit -m "feat(workflow-kit): WorkflowKitOptions.adapter — injection d'un WorldEngineAdapter

Quand fourni, court-circuite l'import dynamique de @ai_kit/workflow-world :
l'app hôte importe createWorldAdapter statiquement → traçable par le bundler.
Rétrocompatible : sans 'adapter', le chemin d'import dynamique est inchangé.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Documentation

### Task 3 : Recette déploiement dans le README workflow-world

**Files:**
- Modify: `packages/workflow-world/README.md`

- [ ] **Step 1 : Ajouter une section « Déploiement bundlé (Nitro/Docker) »**

Insérer après la section `## Usage` de `packages/workflow-world/README.md` :

````markdown
## Déploiement bundlé (Nitro/Docker) — imports traçables

En build bundlé (Nitro `node-server`, déploiement qui ne copie que `.output`), les
imports dynamiques **à argument variable** ne sont pas tracés par nft, donc
`@ai_kit/workflow-world` et le world SDK manquent dans `.output`. Pour les rendre
traçables, **injecte l'adapter** depuis un fichier serveur (imports littéraux) :

```ts
// server/utils/workflow-kit.ts (app hôte)
import { WorkflowKit } from '@ai_kit/core'
import { createWorldAdapter } from '@ai_kit/workflow-world'   // statique → tracé

export const workflowKit = new WorkflowKit({
  engine: 'world',
  adapter: createWorldAdapter({
    type: 'postgres',
    url: process.env.WORKFLOW_POSTGRES_URL!,
    module: () => import('@workflow/world-postgres'),         // littéral → tracé
  }),
})
```

Avec ce pattern, **plus besoin** de `nitro.externals.traceInclude` ni de lister ces
packages dans `nitro.externals.external`. Le worker se démarre toujours via un plugin
serveur (`kit.start()` au boot, `kit.stop()` à la fermeture).
````

- [ ] **Step 2 : Commit**

```bash
git add packages/workflow-world/README.md
git commit -m "docs(workflow-world): recette déploiement Nitro/Docker via adapter injecté

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Bump de version

### Task 4 : Bumper `@ai_kit/core` et `@ai_kit/workflow-world`

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/workflow-world/package.json`

- [ ] **Step 1 : Vérifier que les versions cibles sont libres sur NPM**

Run:
```bash
npm view @ai_kit/core@1.6.0 version 2>/dev/null && echo "PRISE" || echo "LIBRE core 1.6.0"
npm view @ai_kit/workflow-world@0.2.0 version 2>/dev/null && echo "PRISE" || echo "LIBRE ww 0.2.0"
```
Expected: `LIBRE core 1.6.0` et `LIBRE ww 0.2.0`. (Si « PRISE », incrémenter au prochain patch/minor libre et reporter dans les steps suivants.)

- [ ] **Step 2 : Bumper core 1.5.0 → 1.6.0**

Dans `packages/core/package.json`, passer `"version": "1.5.0"` à `"version": "1.6.0"`.

- [ ] **Step 3 : Bumper workflow-world 0.1.1 → 0.2.0**

Dans `packages/workflow-world/package.json`, passer `"version": "0.1.1"` à `"version": "0.2.0"`.

- [ ] **Step 4 : Commit**

```bash
git add packages/core/package.json packages/workflow-world/package.json
git commit -m "chore(release): @ai_kit/core 1.6.0 + @ai_kit/workflow-world 0.2.0

feat: adapter/world injectables (fix tracing Nitro/Docker)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Merge `dev → main` et publication (⚠️ GATE de confirmation)

> ⚠️ **Action sortante / irréversible (publication NPM).** NE PAS exécuter sans
> confirmation explicite de l'utilisateur. La CI publie dès que `packages/*/package.json`
> change sur `main` ; un `npm publish` ne se défait pas.

### Task 5 : Intégrer la branche, merger sur dev puis main, vérifier la publication

- [ ] **Step 1 : Pousser la branche de feature**

```bash
git push -u origin feat/workflow-kit-injectable-adapter
```

- [ ] **Step 2 : Vérifier la CI PR-dev (si applicable)**

Ouvrir une PR `feat/workflow-kit-injectable-adapter → dev` (ou merge direct si c'est le flow habituel). Attendre `pr-dev-tests.yml` vert.
Run (option gh): `gh pr create --base dev --head feat/workflow-kit-injectable-adapter --fill && gh pr checks --watch`

- [ ] **Step 3 : Merger dans `dev`**

```bash
git checkout dev && git pull origin dev
git merge --no-ff feat/workflow-kit-injectable-adapter
git push origin dev
```

- [ ] **Step 4 : CONFIRMATION UTILISATEUR avant `main`**

Demander explicitement : « Je merge `dev → main` et ça publie `@ai_kit/core@1.6.0` + `@ai_kit/workflow-world@0.2.0` sur NPM. Je pousse ? » — attendre le feu vert.

- [ ] **Step 5 : Merger `dev → main` et pousser**

```bash
git checkout main && git pull origin main
git merge --no-ff dev
git push origin main
```

- [ ] **Step 6 : Vérifier la publication NPM**

Run (après la fin des workflows `realease-core.yml` et `release-workflow-world.yml`) :
```bash
gh run list --branch main --limit 5
npm view @ai_kit/core@1.6.0 version
npm view @ai_kit/workflow-world@0.2.0 version
```
Expected: les deux versions retournées par NPM.

---

## Phase 6 — Câbler LeRedacteurV2 sur la nouvelle version (après publication)

> Repo séparé : `/home/killian/Documents/dev/LeRedacteurV2` (app `app/lrd-nuxt`).
> Dépend de la Phase 5 (packages publiés).

### Task 6 : Migrer l'app hôte vers l'adapter injecté

**Files:**
- Modify: `LeRedacteurV2/app/lrd-nuxt/package.json` (versions de deps)
- Modify: `LeRedacteurV2/app/lrd-nuxt/server/utils/workflow-kit.ts`
- Modify: `LeRedacteurV2/app/lrd-nuxt/nuxt.config.ts` (retrait externals/traceInclude)

- [ ] **Step 1 : Bumper les deps ai-kit**

Dans `app/lrd-nuxt/package.json`, passer `@ai_kit/core` à `^1.6.0` et `@ai_kit/workflow-world` à `^0.2.0`, puis :
```bash
cd /home/killian/Documents/dev/LeRedacteurV2 && pnpm install
```

- [ ] **Step 2 : Utiliser l'adapter injecté**

Dans `app/lrd-nuxt/server/utils/workflow-kit.ts`, modifier la branche `world` de `buildKit()` :

```ts
import { WorkflowKit, type WorkflowEngine } from '@ai_kit/core'
import { createWorldAdapter } from '@ai_kit/workflow-world'

// … dans buildKit(), branche WORKFLOW_ENGINE === 'world' :
return new WorkflowKit({
  engine: 'world',
  adapter: createWorldAdapter({
    type: 'postgres',
    url: WORKFLOW_POSTGRES_URL,
    module: () => import('@workflow/world-postgres'),
  }),
})
```

- [ ] **Step 3 : Retirer les contournements de tracing**

Dans `app/lrd-nuxt/nuxt.config.ts`, retirer `@workflow/world-postgres` et `@ai_kit/workflow-world` de `nitro.externals.external` (garder `workflow`, `@workflow/core` pour l'instant), et supprimer tout `traceInclude` résiduel.

- [ ] **Step 4 : Build + vérifier que les packages sont dans `.output`**

Run:
```bash
cd /home/killian/Documents/dev/LeRedacteurV2/app/lrd-nuxt && pnpm build
ls .output/server/node_modules/@ai_kit/workflow-world >/dev/null && echo "OK workflow-world"
ls .output/server/node_modules/@workflow/world-postgres >/dev/null && echo "OK world-postgres"
```
Expected: `OK workflow-world` et `OK world-postgres`.
(Si l'un manque : vérifier que `workflow-kit.ts` est bien atteint statiquement par le graphe serveur, et que le littéral `import('@workflow/world-postgres')` y est présent.)

- [ ] **Step 5 : Vérifier au runtime (Docker)**

Construire l'image Docker (`Dockerfile.lrd-nuxt`), démarrer le conteneur avec `WORKFLOW_ENGINE=world` + `WORKFLOW_POSTGRES_URL`, lancer un run `world` (ex. `runWriteDoc`) et confirmer : pas de module manquant, pas de `StepNotRegistered`, steps exécutés en world Postgres (pas de fallback local).

- [ ] **Step 6 : Commit (dans LeRedacteurV2, branche dédiée)**

```bash
cd /home/killian/Documents/dev/LeRedacteurV2
git add app/lrd-nuxt/package.json app/lrd-nuxt/server/utils/workflow-kit.ts app/lrd-nuxt/nuxt.config.ts pnpm-lock.yaml
git commit -m "feat(workflow): adapter world injecté (@ai_kit 1.6.0/0.2.0) — fix tracing .output"
```

---

## Self-Review (auteur du plan)

- **Couverture spec :** §3.1 (core `adapter`) → Task 2 ; §3.2 (workflow-world `module`) → Task 1 ; §4 (migration LeRedacteur) → Task 6 ; §6 (tests) → Tasks 1 & 2 ; critère d'acceptation build Docker → Task 6 step 4-5 ; bump+publish (demande user) → Tasks 4-5. ✅
- **Placeholders :** aucun — code complet à chaque step. ✅
- **Cohérence des types :** `WorldConfig.module` (contract.ts) ↔ usage `config.module` (adapter.ts) ↔ `createWorldAdapter({…module})` (README, LeRedacteur) ; `WorkflowKitOptions.adapter: WorldEngineAdapter` ↔ `#adapter` ↔ `createWorldAdapter()` retourne `WorldEngineAdapter` (compat structurelle inter-packages). ✅
- **Rétrocompat :** chemins dynamiques préservés (tests existants inchangés dans Tasks 1 & 2). ✅
