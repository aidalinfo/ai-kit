# AI Kit

AI Kit est le micro-framework agentique interne d’Aidalinfo. Son objectif est d’offrir une couche d’abstraction stable au-dessus de l’AI SDK et des providers LLM, afin d’éviter la volatilité que nous avons constatée avec Mastra ou VoltAgent. La base de code est volontairement compacte, lisible et orientée vers les cas d’usage que nous maîtrisons en production.

## Pourquoi AI Kit ?

- **Stabilité** : nous gardons la main sur les évolutions critiques sans subir les breaking changes des frameworks externes.
- **Clarté** : la structure du code privilégie des concepts simples (agents, chunking, workflows) et documentés.
- **Interopérabilité** : AI Kit reste compatible avec les providers de l’écosystème AI SDK tout en ajoutant notre logique métier.

## Getting Started

Installez directement le package `@ai_kit/core` depuis ce dépôt :

```bash
npm i @ai_kit/core
```

Configurez vos clés API (ex. Scaleway) dans l’environnement :

```bash
export SCALEWAY_API_KEY="skw-..."
```

## Serveur

Besoin d’une API prête à l’emploi pour héberger vos agents et workflows ? Le package [`@ai_kit/server`](https://www.npmjs.com/package/@ai_kit/server) fournit un serveur HTTP minimal déjà câblé avec AI Kit (routing JSON, gestion des secrets, hooks de télémétrie).

```bash
npm i @ai_kit/server
```

Consultez la page npm pour les exemples de configuration détaillés et les options d’exécution.

## Utilisation rapide

### Créer un agent

```ts
import { Agent, scaleway } from "@ai_kit/core";

const assistant = new Agent({
  name: "assistant-internal",
  instructions: "Tu aides les équipes Aidalinfo.",
  model: scaleway("gpt-oss-120b"),
});

const result = await assistant.generate({
  prompt: "Donne trois conseils pour intégrer AI Kit." ,
});

console.log(result.text);
```

👉 Guides détaillés : [Agents](https://ai.aidalinfo.fr/fr/agents)

### Activer la télémétrie Langfuse

```ts
import { ensureLangfuseTelemetry, Agent, createWorkflow, createStep } from "@ai_kit/core";
import { openai } from "@ai-sdk/openai";

await ensureLangfuseTelemetry(); // enregistre le LangfuseSpanProcessor

const agent = new Agent({
  name: "support",
  model: openai("gpt-4.1-mini"),
  telemetry: true,
});

const workflow = createWorkflow({ id: "demo", telemetry: true })
  .then(createStep({ id: "noop", handler: ({ input }) => input }))
  .commit();

await workflow.run({
  inputData: { foo: "bar" },
  telemetry: { metadata: { requestId: "run_123" } },
});
```

👉 Configuration complète : [Télémétrie Langfuse](https://ai.aidalinfo.fr/fr/telemetrie/langfuse)

### Découper du contenu

```ts
import { splitTextRecursively } from "@ai_kit/core";

const chunks = splitTextRecursively(longRapport, {
  chunkSize: 400,
  chunkOverlap: 40,
});

// Exemple : créer un index de recherche
const passages = chunks.map((chunk) => ({
  id: `rapport-${chunk.index}`,
  text: chunk.content,
  start: chunk.start,
  end: chunk.end,
}));
```

👉 Plus d’exemples : [Chunks](https://ai.aidalinfo.fr/fr/utils/chunking)

### Orchestrer un workflow

```ts
import { createStep, createWorkflow } from "@ai_kit/core";

const enrichData = createStep({
  id: "enrich-data",
  handler: async ({ input }) => ({ ...input, enriched: true }),
});

const pipeline = createWorkflow({ id: "sample" })
  .then(enrichData)
  .commit();

const outcome = await pipeline.run({ inputData: { id: "123" } });
console.log(outcome.result);
```

👉 Documentation complète : [Workflows](https://ai.aidalinfo.fr/fr/workflows)

## Structure du dépôt

- `packages/core` : cœur du framework (agents, chunking, workflows, providers).
- `docs/core` : documentation interne (agents, chunks, workflows, bonnes pratiques).
- `packages/mcp-docs-server` : serveur MCP exposant la documentation AI Kit.

## Serveur MCP Docs

Le package `@ai_kit/mcp-docs` fournit un serveur MCP qui diffuse toute la documentation (répertoire `docs/`, `README.md` racine, et les README de packages si présents). Deux outils sont exposés :

- `ai_kit-docs` : navigation dans l’arborescence, lecture des fichiers et survol des mots-clés.
- `ai_kit-docs-search` : recherche plein texte avec extraits contextualisés.

### Utilisation rapide

```bash
npx -y @ai_kit/mcp-docs
```

Le serveur écoute en STDIO. Tu peux le brancher directement dans n’importe quel client MCP (Claude Desktop, Cursor, etc.).

### Exemple de configuration Claude Desktop

```json
{
  "mcpServers": {
    "ai_kit-docs": {
      "command": "npx",
      "args": ["-y", "@ai_kit/mcp-docs"],
    }
  },
}
```

### Inclure d’autres README

Le script de build copie automatiquement :

- `docs/**` → `dist/docs/**` ;
- `README.md` (racine) → `dist/docs/README.md` ;
- `packages/<nom>/README.md` → `dist/docs/<nom>/README.md` (si le fichier existe).

Pour exposer le README du package `@ai_kit/core`, il suffit donc de créer `packages/core/README.md`. Le prochain `pnpm --filter @ai_kit/mcp-docs build` répliquera ce fichier et il deviendra accessible via l’outil MCP.

## SDK MCP

Le package `@ai_kit/mcp` fournit un mini DSL inspiré de Mastra pour déclarer des serveurs MCP sans recourir directement au SDK brut. Il gère l’enregistrement des outils, ressources et prompts, et convertit automatiquement les retours simples (`string`, tableaux de textes, buffers) au format attendu par le protocole.

### Exemple rapide

```ts
import { defineMcpServer, defineTool } from "@ai_kit/mcp";
import { z } from "zod";

const server = defineMcpServer({
  name: "ai-kit-lab",
  version: "0.1.0",
  tools: {
    ping: defineTool({
      description: "Renvoie un ping lisible par un humain.",
      inputSchema: z.object({ message: z.string() }),
      handler: async ({ message }) => `pong: ${message}`
    })
  }
});

await server.startStdioServer({
  onReady: () => {
    console.error("Serveur MCP ai-kit-lab prêt sur stdio");
  }
});
```

Le DSL accepte également des ressources (fichiers statiques ou dynamiques via templates) et des prompts. Les fonctions `defineTool`, `defineResource` et `definePrompt` sont optionnelles : un simple objet JavaScript suffit, elles servent surtout à la complétion TypeScript.

## Contribuer

- Respectez la structure existante et les patterns introduits (ex. `TChunkDocument`, `createWorkflow`).
- Ajoutez des tests Vitest lorsque vous livrez une fonctionnalité critique.
- Documentez vos ajouts dans `docs/core` si vous introduisez un nouveau concept ou un flux important.

## Ressources

- [Documentation Agents](https://ai.aidalinfo.fr/fr/agents)
- [Documentation Chunks](https://ai.aidalinfo.fr/fr/utils/chunking)
- [Documentation Workflows](https://ai.aidalinfo.fr/fr/workflows)
- [Documentation MCP](https://ai.aidalinfo.fr/fr/mcp/usage)

L’objectif est de renforcer notre autonomie technique autour des assistants et pipelines AI : n’hésitez pas à compléter ces ressources et à proposer des améliorations.
