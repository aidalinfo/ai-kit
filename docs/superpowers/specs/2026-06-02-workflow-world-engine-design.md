# Design — Moteur de workflow "world" (SDK Vercel) pour ai-kit

- **Date** : 2026-06-02
- **Statut** : design validé (sections 1–3), en attente de relecture finale
- **Auteur** : Killian + Claude
- **Scope** : ajouter un second moteur d'exécution de workflows ("world", basé sur le Vercel Workflow SDK) à côté du moteur legacy en mémoire, via une façade ai-kit unifiée. Par défaut : legacy.

---

## 1. Contexte & décisions

### Deux moteurs distincts

- **`legacy`** (défaut) : le moteur maison actuel dans `packages/core/src/workflows/` (`createWorkflow` → `WorkflowBuilder` → `Workflow.run()` / `WorkflowRun`). 100 % en mémoire, aucune persistance.
- **`world`** : le **Vercel Workflow SDK** (package `workflow`) avec un backend "world" durable : **Postgres** (`@workflow/world-postgres`, officiel) ou **MongoDB** (`@workflow-worlds/mongodb`, communautaire — **expérimental**).

### Décisions actées (brainstorming)

| Décision | Choix | Raison |
|---|---|---|
| Qui exécute le moteur world | Embarquer le **vrai SDK Vercel** | Durabilité production gratuite (runs/events/steps persistés, file de jobs, replay) |
| Bases supportées en v1 | **Postgres + MongoDB** | Couvre self-hosted SQL et NoSQL ; Mongo marqué expérimental |
| Où vivent les deps lourdes | **Nouveau package optionnel** `@ai_kit/workflow-world` | `@ai_kit/core` reste léger ; aucun user legacy ne tire les deps Vercel |
| Portée de la façade | **Façade fine unifiée** (config + `start/stop` + `run` qui délègue) | Faible couplage ; l'écriture des workflows reste native par moteur |
| Moteur par défaut | **`legacy`** | Aucune rupture pour l'existant |
| Écriture des steps world | **Helper typé fin** `defineWorldStep` / `defineWorldWorkflow` (option A) | Shape proche de `createStep` + typage, **sans** posséder de compilateur. La directive `"use step"` reste obligatoire dans le corps (cf. §7.1) |

### Contrainte dure à connaître

Le SDK Vercel **exige une étape de build** (Nitro + rollup, module `workflow/nitro`) pour compiler les fonctions `"use workflow"` / `"use step"`, **et** un **worker long-vivant** qui poll la base (incompatible serverless pur). ai-kit peut **lisser la configuration runtime** (sélection du world, démarrage du worker, délégation du `start`), mais **ne peut pas masquer l'étape de build Nitro** : l'app hôte qui veut le moteur world doit l'adopter. Voir §5.

---

## 2. Architecture & dépendances

```
packages/
  core/                                  @ai_kit/core — inchangé pour les users legacy
    src/workflows/                       moteur legacy (en mémoire) — INTACT
    src/workflows/kit/
      WorkflowKit.ts                     NOUVEAU : la façade
      types.ts                           NOUVEAU : WorkflowKitOptions, WorldConfig, WorldEngineAdapter, WorldRunHandle
      index.ts                           NOUVEAU : ré-exports
  workflow-world/                        @ai_kit/workflow-world — NOUVEAU package optionnel
    src/
      adapter.ts                         createWorldAdapter(cfg) : implémente WorldEngineAdapter
      worlds.ts                          mapping type → package/env (postgres | mongodb)
      authoring.ts                       NOUVEAU : defineWorldStep / defineWorldWorkflow (helpers typés, cf. §7.1)
      index.ts
```

### Sens des dépendances (aucun cycle runtime)

```
@ai_kit/core
  └─ optionalDependencies + peerDependencies → @ai_kit/workflow-world   (chargé par import() dynamique uniquement si engine:'world')

@ai_kit/workflow-world
  ├─ dependencies        → workflow, @workflow/world-postgres, @workflow-worlds/mongodb
  ├─ peerDependencies    → nitro, rollup        (build : fournis par l'app hôte)
  └─ peerDependencies    → @ai_kit/core         (import type uniquement → effacé au build)
```

- Un user legacy `pnpm add @ai_kit/core` → **zéro** dépendance Vercel installée.
- Un user world ajoute `pnpm add @ai_kit/workflow-world`.
- La façade référence le contrat d'adapter par `import type` (effacé au build) et charge l'implémentation par `await import('@ai_kit/workflow-world')` à l'exécution → pas de cycle, pas de coût pour legacy.

---

## 3. La façade `WorkflowKit` (classe ai-kit générale)

Vit dans `@ai_kit/core`, exportée depuis l'index public. Nom calqué sur la convention `XxxKit` (`ServerKit`, `client-kit`).

### Types

```ts
export type WorkflowEngine = 'legacy' | 'world';

export interface WorldConfig {
  type: 'postgres' | 'mongodb';
  url: string;                  // connection string
  jobPrefix?: string;           // postgres : namespacing des jobs si DB partagée
  workerConcurrency?: number;   // postgres : workers concurrents (défaut SDK : 50)
  maxPoolSize?: number;         // postgres : taille du pool (défaut SDK : 10)
}

export interface WorkflowKitOptions {
  engine?: WorkflowEngine;      // défaut : 'legacy'
  world?: WorldConfig;          // requis si engine === 'world'
}

// handle opaque renvoyé par le moteur world (pass-through du SDK Vercel)
export interface WorldRunHandle { /* shape du SDK, typée au plus près à l'implémentation */ }

// contrat implémenté par @ai_kit/workflow-world
export interface WorldEngineAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  run(workflow: (...args: any[]) => unknown, args: unknown[]): Promise<WorldRunHandle>;
}
```

### API

```ts
import { WorkflowKit } from '@ai_kit/core';

const kit = new WorkflowKit({
  engine: 'legacy',                          // défaut — peut être omis
  world: { type: 'postgres', url: process.env.WORKFLOW_DB_URL! },
});

await kit.start();   // legacy : no-op | world : set env → getWorld() → world.start() (démarre le worker)

// --- engine 'legacy' : wf = Workflow ai-kit (createWorkflow().commit()) ---
const result = await kit.run(myLegacyWorkflow, { inputData });   // → Workflow.run(options)

// --- engine 'world' : wf = fonction "use workflow", input = tableau d'args ---
const handle = await kit.run(myWorldWorkflow, [orderId]);        // → start(fn, args) de workflow/api

await kit.stop();    // legacy : no-op | world : arrêt propre du worker
```

### Comportement

- **Dispatch par overloads typés** sur le moteur configuré. Override possible par appel : `kit.run(wf, input, { engine: 'world' })`.
  - `legacy` → `Workflow.run(options)` existant ; renvoie `WorkflowRunResult`.
  - `world` → charge `@ai_kit/workflow-world` en lazy, appelle `createWorldAdapter(world).run(fn, args)` qui délègue à `start()` de `workflow/api` ; renvoie le `WorldRunHandle` (pass-through léger).
- **Lifecycle unifié** : `start()` / `stop()` sont des no-op en legacy → même code des deux côtés. En world, ils pilotent le worker long-vivant.
- **Validation de config** (constructeur) :
  - `engine: 'world'` sans `world` → throw explicite.
  - `world.type` inconnu → throw.
  - `engine: 'legacy'` avec un `world` fourni → autorisé (permet de basculer par env sans réécrire la config).

### Gotcha d'ordre des variables d'environnement

Le runtime Vercel résout le world depuis les env (`WORKFLOW_TARGET_WORLD`, `WORKFLOW_POSTGRES_URL`, …) **au premier import** de `workflow/runtime`. Conséquence :

- La sélection du world (`WORKFLOW_TARGET_WORLD`) doit idéalement venir du **`.env` / env du process** posé au démarrage, **avant** tout import de `workflow`.
- `WorkflowKit.start()` pose aussi ces variables **défensivement** depuis la config avant d'importer le runtime, mais l'app hôte importe `sleep`/`start` depuis `workflow` dans ses fichiers de workflow (chargés tôt). Recommandation : **env file canonique pour la sélection du world**, façade pour le tuning programmatique. Documenté dans le guide d'usage.

---

## 4. Le contrat d'adapter

`@ai_kit/core` définit l'interface `WorldEngineAdapter` (types) ; `@ai_kit/workflow-world` l'implémente. C'est la couture qui garde core découplé du SDK Vercel.

```ts
// @ai_kit/workflow-world
import type { WorldConfig, WorldEngineAdapter } from '@ai_kit/core';

export function createWorldAdapter(cfg: WorldConfig): WorldEngineAdapter {
  return {
    async start() {
      applyWorldEnv(cfg);                       // pose WORKFLOW_TARGET_WORLD + URL/tuning
      const { getWorld } = await import('workflow/runtime');
      const world = await getWorld();
      await world.start?.();
    },
    async stop() { /* world.stop?.() si dispo */ },
    async run(fn, args) {
      const { start } = await import('workflow/api');
      return start(fn, args);
    },
  };
}
```

### Mapping `type` → package / env (table interne `worlds.ts`)

| `type` | Package | `WORKFLOW_TARGET_WORLD` | Connexion | Maturité |
|---|---|---|---|---|
| `postgres` | `@workflow/world-postgres` | `@workflow/world-postgres` | `WORKFLOW_POSTGRES_URL` (+ `WORKFLOW_POSTGRES_JOB_PREFIX`, `WORKFLOW_POSTGRES_WORKER_CONCURRENCY`, `WORKFLOW_POSTGRES_MAX_POOL_SIZE`) | ✅ officiel |
| `mongodb` | `@workflow-worlds/mongodb` | `@workflow-worlds/mongodb` | env Mongo (driver natif) | ⚠️ communautaire / expérimental |

> ⚠️ Les chemins d'import exacts (`workflow/runtime`, `workflow/api`, `getWorld`, signature de `start`, API `world.start/stop`) et les env Mongo doivent être **confirmés contre la doc embarquée de la version installée** (`node_modules/workflow/docs/` via la commande `/workflow`) au moment de l'implémentation. Ce design fige l'architecture, pas les signatures exactes.

---

## 5. Responsabilités & frontières (ai-kit vs app hôte)

| Responsabilité | Qui |
|---|---|
| Choisir le moteur (`legacy`/`world`), tenir la config | `WorkflowKit` (ai-kit) |
| Sélectionner + démarrer/arrêter le world (worker) | `WorkflowKit.start/stop` + adapter (ai-kit) |
| Déléguer le lancement d'un run | `WorkflowKit.run` (ai-kit) |
| **Étape de build Nitro/rollup** (compiler `"use workflow"`) | **App hôte** (ai-kit ne peut pas la masquer) |
| Définir les fonctions `"use workflow"` / `"use step"` | App hôte (écriture native) |
| Exposer les routes/handlers qui appellent `kit.run` | App hôte |
| Faire tourner un process long-vivant | App hôte (infra) |

ai-kit fournit en plus : **doc + snippets** de la config Nitro à coller dans l'app hôte (cf. guide getting-started Vercel par framework).

---

## 6. Façons d'utiliser (exemples de code complets)

Tous les exemples sont end-to-end (fichiers réels, imports inclus). Les imports `workflow` / `workflow/api` sont conformes à la doc Vercel vérifiée ; les signatures exactes restent à confirmer (§12).

### A. Legacy seul (défaut, zéro nouvelle dépendance)

`workflows/order.legacy.ts` — définition + lancement, comme aujourd'hui mais via la façade :

```ts
import { WorkflowKit, createWorkflow, createStep } from '@ai_kit/core';

const fetchOrder = createStep({
  id: 'fetchOrder',
  handler: async ({ inputData }) => ({ id: inputData.id, total: 4200 }),
});
const charge = createStep({
  id: 'charge',
  handler: async ({ inputData }) => ({ ...inputData, chargeId: 'ch_1' }),
});

export const orderWorkflow = createWorkflow({ id: 'order' })
  .then(fetchOrder)
  .then(charge)
  .commit();

// --- lancement ---
const kit = new WorkflowKit();                 // engine: 'legacy' (défaut)
const result = await kit.run(orderWorkflow, { inputData: { id: 'o_123' } });
console.log(result.status, result.result);     // 'success' { id, total, chargeId }
```

> En legacy, `kit.start()` / `kit.stop()` sont des no-op : on peut les appeler pour garder le même code que le mode world, ou les omettre.

### B. World Postgres (self-hosted) — exemple end-to-end

**1. Installation** (dans l'app hôte) :

```bash
pnpm add @ai_kit/core @ai_kit/workflow-world workflow @workflow/world-postgres
pnpm add -D nitro rollup
```

**2. `.env`** — sélection du world (canonique, posée avant tout import `workflow`) :

```bash
WORKFLOW_ENGINE=world
WORKFLOW_TARGET_WORLD=@workflow/world-postgres
WORKFLOW_POSTGRES_URL=postgres://world:world@localhost:5432/world
WORKFLOW_POSTGRES_WORKER_CONCURRENCY=50
```

**3. `nitro.config.ts`** — l'étape de build qui compile les `"use workflow"` (à la charge de l'app hôte, cf. §5) :

```ts
import { defineNitroConfig } from 'nitro/config';

export default defineNitroConfig({
  modules: ['workflow/nitro'],
  routes: { '/**': { handler: './src/index.ts', format: 'node' } },
});
```

**4. `src/workflows/signup.ts`** — workflow + steps en style Vercel :

```ts
import { sleep, FatalError } from 'workflow';

export async function handleUserSignup(email: string) {
  "use workflow";                               // corps déterministe
  const user = await createUser(email);         // chaque await = point durable
  await sendWelcomeEmail(user);
  await sleep('5s');
  return { userId: user.id };
}

async function createUser(email: string) {
  "use step";                                   // runtime Node complet, retry auto
  if (!email.includes('@')) throw new FatalError('email invalide');
  return { id: crypto.randomUUID(), email };
}

async function sendWelcomeEmail(user: { id: string; email: string }) {
  "use step";
  // appel SMTP/API réel ici
  return { sent: true };
}
```

**5. `src/index.ts`** — démarrage du world + serveur Hono (stack ai-kit) + arrêt propre :

```ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WorkflowKit } from '@ai_kit/core';
import { handleUserSignup } from './workflows/signup.js';

const kit = new WorkflowKit({
  engine: 'world',
  world: { type: 'postgres', url: process.env.WORKFLOW_POSTGRES_URL!, workerConcurrency: 50 },
});

await kit.start();                              // démarre le worker graphile (poll Postgres)

const app = new Hono();
app.post('/api/signup', async (c) => {
  const { email } = await c.req.json();
  const handle = await kit.run(handleUserSignup, [email]);   // → start(fn, args)
  return c.json({ message: 'signup workflow started', runId: handle.runId });
});

const server = serve({ fetch: app.fetch, port: 3000 });
process.on('SIGTERM', async () => { await kit.stop(); server.close(); });   // arrêt propre du worker
```

**6. Lancer & vérifier** :

```bash
nitro dev
curl -X POST --json '{"email":"hello@example.com"}' http://localhost:3000/api/signup
npx workflow web         # dashboard d'observabilité des runs
```

### C. World MongoDB (expérimental) — seule la config change

Aucune autre ligne de code applicatif ne bouge par rapport à B :

```bash
# .env
WORKFLOW_TARGET_WORLD=@workflow-worlds/mongodb
WORKFLOW_MONGO_URL=mongodb://localhost:27017/world
```

```ts
const kit = new WorkflowKit({
  engine: 'world',
  world: { type: 'mongodb', url: process.env.WORKFLOW_MONGO_URL! },
});
await kit.start();
```

### D. Basculer de moteur par configuration (un seul code)

```ts
import { WorkflowKit } from '@ai_kit/core';

export const kit = new WorkflowKit({
  engine: (process.env.WORKFLOW_ENGINE as 'legacy' | 'world') ?? 'legacy',
  world: { type: 'postgres', url: process.env.WORKFLOW_POSTGRES_URL ?? '' },
});
await kit.start();   // no-op en legacy, démarre le worker en world
```

→ dev local en `legacy` (rapide, sans infra), prod en `world` (durable) en changeant **une seule** variable d'env.

### E. Même logique métier, deux moteurs (factorisation)

Le SDK Vercel ne sait pas exécuter un `Workflow` ai-kit : on garde deux écritures, mais on **factorise la logique métier** dans des fonctions pures réutilisées des deux côtés. La façade unifie le **lancement**, pas l'écriture.

`domain/payment.ts` — logique pure, sans dépendance moteur :

```ts
export async function chargePayment(order: { id: string; total: number }) {
  // appel Stripe réel, déterminé par les args — réutilisable partout
  return { chargeId: `ch_${order.id}`, amount: order.total };
}
```

Côté **world**, via les helpers `defineWorldWorkflow` / `defineWorldStep` (option A — shape proche de `createStep`, la directive reste dans le corps) :

```ts
import { defineWorldWorkflow, defineWorldStep } from '@ai_kit/workflow-world';
import { chargePayment } from '../domain/payment.js';
import type { Order } from '../domain/payment.js';

const chargeStep = defineWorldStep('charge', async (order: Order) => {
  "use step";                                  // <- incompressible (compilo build-time)
  return chargePayment(order);                 // <- même logique que le legacy
});

export const paymentWorkflow = defineWorldWorkflow('payment', async (order: Order) => {
  "use workflow";
  return await chargeStep(order);
});
```

Côté **legacy** (`handler` qui enrobe la même logique pure) :

```ts
import { createStep } from '@ai_kit/core';
import { chargePayment } from '../domain/payment.js';

export const chargeStepLegacy = createStep({
  id: 'charge',
  handler: async ({ inputData }) => chargePayment(inputData),   // <- même logique
});
```

---

## 7. Primitives de contrôle de flux : aucun "décorateur" à préparer

Le moteur legacy expose le contrôle de flux via des **méthodes de builder** (DAG déclaratif). Le SDK Vercel n'a **aucun décorateur** : un workflow est une **fonction async** et le contrôle de flux est du **JavaScript natif** (vérifié dans le cookbook).

| Besoin | Legacy (builder) | Vercel SDK (dans `"use workflow"`) | Prêt ? |
|---|---|---|---|
| Séquentiel | `.then(step)` | `await stepA(); await stepB();` | ✅ natif |
| Boucle | `.while({ condition })` | `while (cond) { ... }` / `for (...)` | ✅ natif |
| Itérer une collection | step `forEach` | `for (const x of list) { await step(x) }` | ✅ natif |
| Parallèle / fan-out | `.branchParallel()` | `await Promise.all(list.map(step))` | ✅ natif |
| Batch + isolation d'échec | (manuel) | `for(...) { await Promise.allSettled(batch.map(step)) }` | ✅ natif |
| Race / timeout | — | `await Promise.race([hook, sleep('24h')])` | ✅ natif |
| Condition / branche | `.conditions().then(branches)` | `if (...) {} else {}` / `switch` | ✅ natif |
| Human-in-the-loop | `.human()` + `resumeWithHumanInput` | `createWebhook()` **ou** `defineHook()` + `hook.create()` / `hook.resume()` | ✅ natif |
| Délai durable | — | `await sleep('30d')` | ✅ natif |
| Retry | (manuel dans le handler) | **auto** (max 3 essais par défaut) + `FatalError` (stop) / `RetryableError` (transitoire) | ✅ natif |

**Conséquence** : ai-kit n'a **pas** à fournir/porter des décorateurs de boucle/parallèle pour le moteur world. La boucle, c'est `for`/`while`. Le travail réel est : (1) la façade + adapter, (2) la **documentation de migration** (déclaratif → impératif).

### Règles de déterminisme (à respecter à l'écriture world)

- Le **corps `"use workflow"` doit être déterministe** : pas de `Date.now()`, `Math.random()`, `fetch`, I/O directs → ces effets vont dans des fonctions `"use step"`. (Le compilo *seede* `Date`/`Math.random`/`crypto` dans ce contexte.)
- Les **steps** ont le runtime Node complet, sont retried, et leurs résultats sont persistés pour le replay. Args **passés par valeur**.

### 7.1 Helpers d'écriture `defineWorldStep` / `defineWorldWorkflow` (décision : option A)

**Pourquoi pas un décorateur.** Les directives `"use step"` / `"use workflow"` sont traitées **au build** par le compilateur `workflow/nitro` (rollup), qui **scanne statiquement** le source pour le littéral en première instruction du corps, puis transforme la fonction (seed des globals, bornes durables de replay, persistance). Un **décorateur est runtime** : il enrobe la fonction dans une closure et s'exécute trop tard → le compilo ne le voit pas et **ne transforme pas** la fonction (= pas de durabilité). Le package `workflow` n'expose d'ailleurs **aucune** API programmatique de step (`defineStep`/`@step` n'existent pas) — les directives sont l'unique mécanisme. La compatibilité d'écriture « méthode » totale exigerait un **codegen** (le traducteur écarté, cf. §11).

**Ce que fournit le helper.** `defineWorldStep(id, fn)` et `defineWorldWorkflow(id, fn)` sont des **wrappers quasi-identité** : ils renvoient la fonction (pour que le compilo la voie telle quelle) et ajoutent du **typage I/O** + des **métadonnées ai-kit** (id pour logs/observabilité). La directive `"use step"` **reste une ligne du corps** — c'est incompressible.

```ts
export const charge = defineWorldStep('charge', async (order: Order): Promise<Charged> => {
  "use step";                       // obligatoire — le helper ne peut pas l'injecter
  return chargePayment(order);
});
```

**⚠️ Spike bloquant (cf. §12).** Tout repose sur le fait que le compilo Vercel **détecte la directive dans une arrow passée en argument** au helper. Les exemples officiels n'utilisent que des `export async function name()`. Trois issues possibles à valider **avant** de figer l'API :
1. **OK** → on livre `defineWorldStep`/`defineWorldWorkflow` comme ci-dessus.
2. **Le compilo n'accepte que les fonctions nommées top-level** → dégradation en **ergonomie type-only** : l'utilisateur écrit `export async function charge(...) { "use step"; ... }` et annote avec les **types** ai-kit (`WorldStep<I,O>`), sans wrapper runtime.
3. **Échec total des helpers** → fallback **option B** (directives brutes + factorisation de la logique métier), déjà documenté.

### 7.2 Couverture fonctionnelle (parité avec le SDK Vercel)

Parce qu'on **embarque le vrai SDK** (option 1), le moteur `world` hérite de **100 % des fonctionnalités Vercel** — on ne réimplémente ni ne masque rien.

| Domaine | Fonctionnalités | World |
|---|---|---|
| Exécution durable | replay après crash, persistance runs/steps/events | ✅ |
| Suspension | `sleep('30d')`, délais durables, timeouts | ✅ |
| Human-in-the-loop | `createWebhook`, `defineHook` + `resume`, hooks | ✅ |
| Parallèle / boucles | JS natif (`Promise.all/allSettled/race`, `for`) | ✅ |
| Erreurs / retries | retry auto, `FatalError`, `RetryableError` | ✅ |
| Streaming | `getWritable`, resumable streams, updates depuis tools | ✅ |
| AI / agents | `DurableAgent`, chat transport, message queueing, tools | ✅ |
| Observabilité | dashboard `npx workflow web`, `workflow inspect runs` | ✅ |

**Nuances (à connaître) :**
1. **Façade fine ≠ moins de features.** Les API avancées (observer/streamer un run, reprendre un hook) ne transitent **pas** par `WorkflowKit` : on les utilise **directement** via `import { ... } from 'workflow'`. Décision « façade fine » — la pleine puissance est à un import près, pas masquée.
2. **La parité dépend du world.** Vrai sur **Postgres** (référence officielle). Sur **MongoDB** (communautaire, « no E2E test data »), certaines capacités (ex. streaming temps réel via NOTIFY/LISTEN) peuvent être moins complètes → **expérimental**.
3. **`legacy` ne gagne pas ces features** : la parité n'existe que sous `engine: 'world'`.
4. **Contraintes intrinsèques Vercel** persistent : build Nitro, worker long-vivant, déterminisme. Ce sont celles du SDK, pas d'ai-kit.

---

## 8. Guide de migration : legacy → world

La migration est une **réécriture déclaratif → impératif**, pas un remplacement de décorateurs.

### Avant — moteur legacy (builder)

```ts
import { createWorkflow, createStep } from '@ai_kit/core';

const fetchOrder   = createStep({ id: 'fetchOrder',   handler: async ({ inputData }) => getOrder(inputData.id) });
const charge       = createStep({ id: 'charge',       handler: async ({ inputData }) => chargePayment(inputData) });
const notify       = createStep({ id: 'notify',       handler: async ({ inputData }) => sendEmail(inputData) });

export const orderWorkflow = createWorkflow({ id: 'order' })
  .then(fetchOrder)
  .then(charge)
  .then(notify)
  .commit();

// lancement
await orderWorkflow.run({ inputData: { id: 'o_123' } });
```

### Après — moteur world (fonction + directives)

```ts
import { FatalError } from 'workflow';

export async function orderWorkflow(orderId: string) {
  "use workflow";                               // corps déterministe
  const order = await fetchOrder(orderId);      // chaque await = point durable
  const charged = await charge(order);
  await notify(charged);
  return { orderId, status: 'completed' };
}

async function fetchOrder(id: string) { "use step"; return getOrder(id); }
async function charge(order: Order)   { "use step"; return chargePayment(order); }
async function notify(o: Charged)     { "use step"; return sendEmail(o); }

// lancement (via la façade, inchangé côté appelant)
await kit.run(orderWorkflow, ['o_123']);
```

### Table de correspondance des cas réels

| Cas legacy | Réécriture world |
|---|---|
| `.while({ condition, step })` | `while (await condition()) { await step() }` |
| `forEach` (séquentiel) | `for (const x of items) { await step(x) }` |
| `forEach` (parallèle) | `await Promise.all(items.map(x => step(x)))` |
| `.branchParallel(id, cfg)` | `const [a, b] = await Promise.all([stepA(), stepB()])` |
| `.conditions(...).then({ a, b })` | `if (cond) return await branchA(); else return await branchB();` |
| `.human({ id, schema })` + `resumeWithHumanInput` | `const hook = approvalHook.create({ token }); const r = await Promise.race([hook, sleep('24h')])` + route `approvalHook.resume(token, payload)` |
| `handler({ inputData, ctx, store })` | step `"use step"` (args par valeur) + état via valeurs de retour / closures du workflow |
| retry maison | retry auto (max 3) ; `throw new FatalError()` pour stopper |

### Checklist de migration (par workflow)

1. Identifier les effets non déterministes → les isoler dans des `"use step"`.
2. Transformer le DAG builder en flux impératif (table ci-dessus).
3. Remplacer les steps human par `createWebhook` / `defineHook` + route de reprise.
4. Ajouter la config Nitro (§5) à l'app hôte.
5. Pointer `kit` sur `engine: 'world'` ; lancer via `kit.run`.
6. Vérifier replay/durabilité (kill du worker à mi-run → reprise).

---

## 9. Gestion d'erreurs & retries

- **World** : steps retried automatiquement (max 3 par défaut). `FatalError` → arrêt immédiat sans retry ; `RetryableError` → backoff sur erreurs transitoires (429, etc.). Réf : `/docs/foundations/errors-and-retries`.
- **Façade** : si `engine: 'world'` et `@ai_kit/workflow-world` non installé → erreur claire (« installez `@ai_kit/workflow-world` ») au `import()` dynamique.
- **Config** : erreurs de validation au constructeur (cf. §3).
- **Legacy** : comportement actuel inchangé.

---

## 10. Stratégie de tests

| Niveau | Quoi | Infra |
|---|---|---|
| Unit (core) | Validation de config `WorkflowKit`, dispatch d'overloads, no-op start/stop en legacy, lazy-import déclenché en world (mock de l'adapter) | aucune |
| Unit (workflow-world) | `worlds.ts` : mapping `type` → package/env correct | aucune |
| Intégration (workflow-world) | smoke d'un run réel : Postgres via Docker/testcontainers ; Mongo idem | Docker (opt-in via flag/env) |
| Non-régression | la suite legacy existante reste verte | aucune |

- Les tests d'intégration world sont **opt-in** (skip si Docker absent) → pas de dépendance infra dans la CI standard.
- **CI** : la CI ne gate que `server` + `client-kit` (cf. mémoire projet). Garder les changements de `core` non régressifs ; le nouveau package n'entre pas dans le gate tant que ses tests d'intégration sont opt-in.

---

## 11. Hors-scope / YAGNI

- ❌ Façade riche (handles/events unifiés, human-in-the-loop normalisé entre moteurs) — explicitement écarté en brainstorming.
- ❌ Traducteur builder ai-kit → SDK Vercel — écarté (complexe, lossy).
- ❌ Masquer/automatiser le build Nitro de l'app hôte — impossible.
- ❌ World managé Vercel (`@workflow/world-vercel`) — hors besoin self-hosted (ajout trivial plus tard via le mapping).
- ❌ Mongo en "stable" — livré expérimental.

## 12. Questions ouvertes (à confirmer à l'implémentation)

0. **🔴 SPIKE BLOQUANT (à faire en tout premier)** : le compilo `workflow/nitro` détecte-t-il la directive `"use step"` / `"use workflow"` dans une **arrow function passée en argument** à `defineWorldStep`/`defineWorldWorkflow` ? Si non → dégrader en ergonomie type-only ou fallback option B (cf. §7.1). **Aucune autre tâche d'écriture world ne se fige avant ce verdict.**
1. Chemins/signatures exacts : `workflow/runtime#getWorld`, `workflow/api#start`, API `world.start/stop` (confirmer via `node_modules/workflow/docs/` / `/workflow`).
2. Variables d'env du world Mongo (`@workflow-worlds/mongodb`) — lire le README GitHub du projet.
3. Type précis du `WorldRunHandle` renvoyé par `start()` (pour typer le pass-through).
4. Le runtime accepte-t-il une **injection programmatique** d'instance world (`createWorld(...)`) en plus de la sélection par env ? Si oui, préférable à la manip d'env (§3 gotcha).
