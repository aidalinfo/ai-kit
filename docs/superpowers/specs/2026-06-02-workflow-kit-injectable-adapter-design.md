# WorkflowKit — adapter/world injectables (fix tracing Nitro + moins de câblage)

**Date :** 2026-06-02
**Statut :** design validé, en attente de relecture avant plan d'implémentation
**Packages touchés :** `@ai_kit/core` (`WorkflowKit`), `@ai_kit/workflow-world` (`createWorldAdapter`)

## 1. Problème

Une app hôte (Nuxt/Nitro, preset `node-server`) qui utilise le moteur `world` se déploie
via Docker en ne copiant que `.output`. Or deux dépendances n'arrivent **pas** dans
`.output` parce qu'elles sont atteintes par des `import()` **à argument variable**, que
le traceur de Nitro (`@vercel/nft`) ne sait pas suivre :

| Hop | Site d'import | Argument | Tracé par nft ? |
|-----|---------------|----------|-----------------|
| 1 | `@ai_kit/core` → `WorkflowKit.ts:22` : `import(WORLD_PACKAGE)` | variable (`const WORLD_PACKAGE: string`) | ❌ |
| 2 | `@ai_kit/workflow-world` → `adapter.ts:25-26` : `import(WORLD_TARGETS[type])` | variable | ❌ |

En local/monorepo tout résout via `node_modules` (pnpm), donc le problème est invisible.
En Docker (`.output` seul), `@ai_kit/workflow-world` et `@workflow/world-postgres` sont
absents → l'app casse au runtime.

Le contournement `traceInclude: ['@workflow/world-postgres']` **échoue** : l'option Nitro
attend des **chemins de fichiers**, pas des specifiers de package (le nom est interprété
comme chemin relatif → build cassé).

### Variables à variable = volontaires

Ces imports sont à argument variable **exprès** : `@ai_kit/workflow-world` et les worlds
SDK (`@workflow/world-postgres`, `@workflow-worlds/mongodb`) sont des dépendances
**optionnelles**. Un littéral forcerait `tsc`/Node à les résoudre même pour un utilisateur
`legacy` qui ne les installe pas. On ne peut donc pas se contenter de « mettre un
littéral » dans la lib : il faut déplacer le littéral dans le **code tracé du
consommateur**.

### Théorie « duplication de module » : écartée

Le wiring actuel de l'app hôte met `workflow`, `@workflow/core`, `@workflow/world-postgres`,
`@ai_kit/workflow-world` en `nitro.externals.external` pour « forcer une instance unique »
et éviter que `setWorld` (adapter) et `getWorld` (entrypoint) divergent. Vérification faite
dans `@workflow/core@4.3.1` : l'état runtime n'est **pas** stocké en variable de module mais
sur `globalThis`, via le registre **global** de symboles :

- world courant : `globalThis[Symbol.for('@workflow/world//cache')]` (`runtime/world.js`)
- registre des steps : `globalThis[Symbol.for('@workflow/core//registeredSteps')]` avec
  `??=` qui fait converger toutes les copies sur la 1ʳᵉ Map créée (`private.js:5-8`)

Donc une duplication de bundle est **inoffensive** : toutes les copies lisent/écrivent le
même slot. Le hack `externals.external` n'est pas requis pour la correction ; sa
suppression est une vérification côté app hôte (hors périmètre de ce spec, voir §8).

## 2. Objectif

Permettre à l'app hôte d'amener `@ai_kit/workflow-world` **et** le world SDK dans `.output`
**sans** `traceInclude` ni hack, en faisant vivre tous les imports de la chaîne `world`
sous forme **statique/littérale dans le code tracé du consommateur**. Bénéfice secondaire :
moins de câblage fragile (plus d'env « magique », plus de `traceInclude`).

### Critères d'acceptation

1. **Build Docker** (`nitro preset node-server`) : après `nuxt build`, `.output` contient
   `@ai_kit/workflow-world` ET `@workflow/world-postgres` (+ leurs deps statiques) **sans**
   `traceInclude` ni entrée dans `externals.external` pour ces deux packages.
2. **Rétrocompatibilité** : le code existant `new WorkflowKit({ engine: 'world', world: {…} })`
   continue de fonctionner à l'identique (chemin d'import dynamique conservé).
3. **Dépendances optionnelles préservées** : un utilisateur `legacy` qui n'installe ni
   `@ai_kit/workflow-world` ni un world n'a aucune résolution forcée de ces packages.
4. **Tests** : unitaires verts sur les deux chemins (injecté + dynamique) ; un test prouve
   que l'adapter injecté est utilisé sans toucher au loader dynamique.

## 3. Design

### 3.1 `@ai_kit/core` — `WorkflowKit` accepte un adapter injecté

`WorkflowKitOptions` gagne un champ optionnel `adapter`. Quand il est fourni, `WorkflowKit`
l'utilise tel quel et **ne fait plus** `import('@ai_kit/workflow-world')` (hop 1 supprimé).

```ts
// packages/core/src/workflows/kit/types.ts
export interface WorkflowKitOptions {
  /** Moteur par défaut. Défaut : "legacy". */
  engine?: WorkflowEngine;
  /** Config du world. Requis si engine === "world" ET adapter absent. */
  world?: WorldConfig;
  /**
   * Adapter world pré-construit (via `createWorldAdapter` de @ai_kit/workflow-world,
   * importé statiquement par l'app hôte). Quand fourni, court-circuite l'import
   * dynamique de @ai_kit/workflow-world — ce qui rend les deux packages traçables
   * par le bundler depuis le code de l'app. Prioritaire sur `world`.
   */
  adapter?: WorldEngineAdapter;
}
```

Comportement (`WorkflowKit.ts`) :

- Constructeur : si `options.adapter` présent → `this.#adapter = options.adapter`.
  Validation `engine === 'world'` : exiger `world` **ou** `adapter` (sinon throw inchangé).
  La validation du `world.type` ne s'applique que si `world` est fourni.
- `#ensureAdapter()` : si `this.#adapter` déjà défini (cas injecté), le retourner
  immédiatement — pas de `worldModuleLoader()`. Sinon, chemin dynamique actuel inchangé.
- `start()` / `stop()` / `run()` / `runAndWait()` : inchangés (passent par `#ensureAdapter()`).

### 3.2 `@ai_kit/workflow-world` — `createWorldAdapter` accepte un loader de world

La config de `createWorldAdapter` gagne `module?` : un loader fourni par le consommateur
qui remplace le loader dynamique interne (`loaders[type]`) pour le world. C'est la
promotion publique, **par config**, de la couture interne `__setWorldModuleLoaders` (qui
reste réservée aux tests).

```ts
// packages/workflow-world/src/contract.ts
export interface WorldConfig {
  type: WorldType;
  url: string;
  jobPrefix?: string;
  workerConcurrency?: number;
  maxPoolSize?: number;
  /**
   * Loader du module world, fourni par l'app hôte sous forme de littéral
   * (`() => import('@workflow/world-postgres')`). Quand fourni, il remplace
   * l'import dynamique interne : le littéral vit dans le code tracé de l'app,
   * donc nft inclut le package dans `.output`. Doit exposer `createWorld`.
   */
  module?: () => Promise<{ createWorld: (opts: Record<string, unknown>) => unknown }>;
}
```

Dans `adapter.ts`, `loadWorldModule` utilise `config.module` en priorité :

```ts
async function loadWorldModule(config: WorldConfig) {
  const loader = config.module ?? loaders[config.type];
  try {
    return await loader();
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        `workflow-world: le module world '${WORLD_TARGETS[config.type]}' est introuvable. ` +
          `Installe-le (pnpm add ${WORLD_TARGETS[config.type]}) ou fournis 'module'.`,
      );
    }
    throw err;
  }
}
```

(Les loaders `api`/`runtime` restent des littéraux `import("workflow/api")` /
`import("workflow/runtime")` dans `adapter.ts` → déjà traçables, inchangés.)

`@ai_kit/workflow-world` exporte déjà `createWorldAdapter` (`index.ts`) — rien à ajouter
côté exports.

### 3.3 Data flow (chemin injecté, cible)

```
app/server/utils/workflow-kit.ts        ← tout en imports statiques/littéraux
  ├─ import { WorkflowKit } from '@ai_kit/core'                    (statique)
  ├─ import { createWorldAdapter } from '@ai_kit/workflow-world'   (statique → hop 1 tracé)
  └─ createWorldAdapter({ type, url, module: () => import('@workflow/world-postgres') })
                                                                    (littéral → hop 2 tracé)
        → new WorkflowKit({ engine: 'world', adapter })
        → kit.start() → adapter.start() → loadWorldModule(config) → config.module()
                                       → setWorld(world) (globalThis) → world.start()
        → kit.run()/runAndWait() → adapter.run() → workflow/api start(fn,args,{world})
```

nft, en analysant `workflow-kit.ts` (fichier serveur tracé), voit les deux imports
littéraux et copie `@ai_kit/workflow-world` + `@workflow/world-postgres` (+ deps statiques)
dans `.output`.

## 4. Migration de l'app hôte (LeRedacteurV2)

`app/lrd-nuxt/server/utils/workflow-kit.ts`, branche `world` :

```ts
import { WorkflowKit, type WorkflowEngine } from '@ai_kit/core'
import { createWorldAdapter } from '@ai_kit/workflow-world'

// …
return new WorkflowKit({
  engine: 'world',
  adapter: createWorldAdapter({
    type: 'postgres',
    url: WORKFLOW_POSTGRES_URL,
    module: () => import('@workflow/world-postgres'),
  }),
})
```

Puis : retirer `traceInclude` (jamais commité, déjà reverté) et tenter de retirer
`@workflow/world-postgres` + `@ai_kit/workflow-world` de `nitro.externals.external`
(§8 : à valider au build, indépendant de ce spec). Le plugin
`05.workflow-kit.server.ts` et `runners.ts` restent inchangés.

## 5. Gestion d'erreurs

- `module` fourni mais package absent → `loadWorldModule` relève le `ERR_MODULE_NOT_FOUND`
  en message explicite (cf. §3.2), comme aujourd'hui pour le chemin dynamique.
- `engine: 'world'` sans `world` ni `adapter` → throw au constructeur (message clair).
- `adapter` fourni avec `engine: 'legacy'` → autorisé mais inerte (l'adapter n'est utilisé
  que sur le chemin `world` de `run`/`runAndWait`/`start`/`stop`). Pas de throw (cohérent
  avec le pattern « config world attachée même en legacy » de l'app hôte).

## 6. Tests

`@ai_kit/core` (`WorkflowKit.test.ts`) :
- `new WorkflowKit({ engine: 'world', adapter: fakeAdapter })` : `start/run/stop`
  délèguent à `fakeAdapter` **sans** appeler `worldModuleLoader` (espionner le seam
  `__setWorkflowWorldLoader` pour prouver qu'il n'est jamais invoqué).
- Validation : `engine: 'world'` sans `world` ni `adapter` → throw.
- Rétrocompat : `new WorkflowKit({ engine: 'world', world })` → chemin dynamique intact.

`@ai_kit/workflow-world` (`adapter.test.ts`) :
- `createWorldAdapter({ type, url, module })` : `start()` appelle `config.module()` et
  **pas** `loaders[type]` (mock des deux, vérifier lequel est appelé).
- `module` qui rejette `ERR_MODULE_NOT_FOUND` → message explicite.
- Sans `module` : comportement actuel (loaders dynamiques) inchangé.

**Acceptation déploiement (manuel, hors CI)** : build Docker de LeRedacteurV2 ; vérifier
`ls .output/server/node_modules/@ai_kit/workflow-world` et `.../@workflow/world-postgres` ;
démarrer le conteneur, lancer un run `world`, confirmer l'exécution des steps (pas de
`StepNotRegistered`, pas de fallback world-local).

## 7. Fichiers touchés

- `packages/core/src/workflows/kit/types.ts` — `WorkflowKitOptions.adapter?`
- `packages/core/src/workflows/kit/WorkflowKit.ts` — init `#adapter` depuis options,
  `#ensureAdapter` court-circuit, validation constructeur
- `packages/core/src/workflows/kit/WorkflowKit.test.ts` — tests chemin injecté
- `packages/workflow-world/src/contract.ts` — `WorldConfig.module?`
- `packages/workflow-world/src/adapter.ts` — `loadWorldModule(config)` priorise `config.module`
- `packages/workflow-world/src/adapter.test.ts` — tests `module`
- `packages/workflow-world/README.md` + doc world-engine — recette déploiement Nitro/Docker
  (chemin injecté, ligne build `workflow/nitro`, plugin `start/stop`, plus de `traceInclude`)

## 8. Hors périmètre

- **Module Nuxt clé-en-main** (`@ai_kit/workflow-world/nuxt`) : explicitement écarté (surface
  de maintenance pour un seul consommateur).
- **Suppression du hack `externals.external`** côté app hôte : recommandée (la théorie
  duplication est écartée) mais à valider au build Docker ; ce n'est pas une modif de lib.
- **Auto-start paresseux** du worker : non retenu (le worker doit tourner dans le runtime de
  l'entrypoint ; un plugin serveur explicite reste le modèle le plus clair).
- **Injection des loaders `api`/`runtime`** : inutile (déjà littéraux, déjà tracés).
