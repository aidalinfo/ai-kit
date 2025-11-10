# @ai_kit/client-kit

Client léger pour interagir avec un serveur AI Kit. Il standardise les appels HTTP et vous évite de manipuler manuellement les URLs ou les en-têtes.

## Installation

```bash
npm install @ai_kit/client-kit
```

## Utilisation

```ts
import { ClientKit } from "@ai_kit/client-kit";

const client = new ClientKit({
  baseUrl: "https://agents.internal.aidalinfo.fr",
  headers: { Authorization: `Bearer ${process.env.SERVER_TOKEN}` },
});

const agent = await client.getAgent("support");
const answer = await client.generateAgent("support", {
  prompt: "Donne-moi le résumé de la dernière release.",
  runtime: {
    metadata: { tenant: "aidalinfo" },
    ctx: { locale: "fr-FR" },
  },
});

const run = await client.runWorkflow("enrich-contact", {
  inputData: { contactId: "123" },
  runtime: {
    metadata: { requestId: "run_abc" },
    ctx: { locale: "fr-CA" },
  },
});

if (run.status === "waiting_human" && run.pendingHuman) {
  await client.resumeWorkflow("enrich-contact", run.runId, {
    stepId: run.pendingHuman.stepId,
    data: { approved: true },
  });
}
```

## API

- `listAgents()` / `getAgent(id)`
- `generateAgent(id, payload)`
- `listWorkflows()` / `getWorkflow(id)`
- `runWorkflow(id, payload)`
- `resumeWorkflow(id, runId, payload)`

Les métadonnées et le contexte (`ctx`) définis dans `runtime` sont fusionnés automatiquement avec ceux fournis directement dans la charge utile (`metadata`/`ctx`).
Vous pouvez transmettre ces surcharges pour chaque appel via la clé `runtime` (ou son alias `runtimeContext`).
