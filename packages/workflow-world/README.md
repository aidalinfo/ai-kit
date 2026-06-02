# @ai_kit/workflow-world

Moteur de workflow **"world"** pour AI Kit : adapte le [Vercel Workflow SDK](https://workflow-sdk.dev)
(persistance durable Postgres/MongoDB) derrière la façade `WorkflowKit` de `@ai_kit/core`.

Package **optionnel** : il n'est requis que si tu utilises `engine: 'world'`. Le moteur
legacy (en mémoire) de `@ai_kit/core` ne dépend pas de ce package.

## Installation

```bash
pnpm add @ai_kit/core @ai_kit/workflow-world workflow
# + le world voulu (optionnel, à installer toi-même) :
pnpm add @workflow/world-postgres            # Postgres (officiel)
# ou
pnpm add @workflow-worlds/mongodb            # MongoDB (communautaire, expérimental)
# build de l'app hôte :
pnpm add -D nitro rollup
```

## Contrainte (à connaître)

Le SDK Vercel **exige une étape de build** (Nitro + rollup, module `workflow/nitro`) pour
compiler les fonctions `"use workflow"` / `"use step"`, **et** un **worker long-vivant**
(incompatible serverless pur). ai-kit lisse la configuration runtime mais ne peut pas
masquer cette étape de build : l'app hôte doit l'adopter. Voir le design complet et les
exemples end-to-end : `docs/superpowers/specs/2026-06-02-workflow-world-engine-design.md`.

## Usage

```ts
import { WorkflowKit } from '@ai_kit/core';

const kit = new WorkflowKit({
  engine: 'world',
  world: { type: 'postgres', url: process.env.WORKFLOW_POSTGRES_URL! },
});

await kit.start();                 // démarre le worker (graphile pour Postgres)
const handle = await kit.run(myWorldWorkflow, [arg]);  // → start() du SDK
await kit.stop();                  // arrêt propre
```

## Écriture des workflows/steps (important)

Il n'existe **pas** de helper runtime `defineWorldStep` : le compilateur `workflow/nitro`
ne détecte les directives `"use step"` / `"use workflow"` que sur des **liaisons top-level**
(fonction nommée, ou arrow/fonction liée directement à un `const`). Passer la fonction à un
wrapper casserait la détection (non-durabilité silencieuse).

Écris donc une liaison top-level avec la directive en première instruction. Tu peux annoter
avec les types `WorldStep` / `WorldWorkflow` exportés par ce package :

```ts
import type { WorldStep } from '@ai_kit/workflow-world';
import { chargePayment } from '../domain/payment.js';

export const charge: WorldStep<[Order], Receipt> = async (order) => {
  "use step";                      // obligatoire, en première instruction
  return chargePayment(order);
};

export async function paymentWorkflow(order: Order) {
  "use workflow";
  return await charge(order);
}
```

## Tests

- **Unitaires** (sans DB, mockés) : `pnpm test`
- **Intégration** (opt-in, DB réelle via Docker) :
  ```bash
  pnpm run db:up && pnpm run test:integration && pnpm run db:down
  ```
  (lance Postgres + MongoDB via `docker-compose.test.yml` ; les tests se skippent
  automatiquement si les URLs d'env ne sont pas posées).

## API publique

- `createWorldAdapter(config)` — implémente le contrat `WorldEngineAdapter` consommé par `WorkflowKit` (chargé dynamiquement par core).
- `WORLD_TARGETS` — mapping `type` → nom de package SDK.
- types `WorldStep<Args, Out>`, `WorldWorkflow<Args, Out>`.
