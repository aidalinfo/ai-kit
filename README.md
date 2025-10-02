# AI Kit

AI Kit est le micro-framework agentique interne d’Aidalinfo. Son objectif est d’offrir une couche d’abstraction stable au-dessus de l’AI SDK et des providers LLM, afin d’éviter la volatilité que nous avons constatée avec Mastra ou VoltAgent. La base de code est volontairement compacte, lisible et orientée vers les cas d’usage que nous maîtrisons en production.

## Pourquoi AI Kit ?

- **Stabilité** : nous gardons la main sur les évolutions critiques sans subir les breaking changes des frameworks externes.
- **Clarté** : la structure du code privilégie des concepts simples (agents, chunking, workflows) et documentés.
- **Interopérabilité** : AI Kit reste compatible avec les providers de l’écosystème AI SDK tout en ajoutant notre logique métier.

## Getting Started

Installez directement le package `@ai-kit/core` depuis ce dépôt :

```bash
pnpm add @ai-kit/core@github:aidalinfo/ai-kit#path:packages/core
```

Configurez vos clés API (ex. Scaleway) dans l’environnement :

```bash
export SCALEWAY_API_KEY="skw-..."
```

## Utilisation rapide

### Créer un agent

```ts
import { Agent, scaleway } from "@ai-kit/core";

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

👉 Guides détaillés : [Agents](./docs/core/agents.md)

### Découper du contenu

```ts
import { splitTextRecursively } from "@ai-kit/core";

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

👉 Plus d’exemples : [Chunks](./docs/core/chunks.md)

### Orchestrer un workflow

```ts
import { createStep, createWorkflow } from "@ai-kit/core";

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

👉 Documentation complète : [Workflows](./docs/core/workflows.md)

## Structure du dépôt

- `packages/core` : cœur du framework (agents, chunking, workflows, providers).
- `docs/core` : documentation interne (agents, chunks, workflows, bonnes pratiques).
- `packages/mcp-docs-server` : serveur MCP exposant la documentation AI Kit.

## Serveur MCP Docs

Le package `@ai_kit/mcp-docs` fournit un serveur MCP qui diffuse toute la documentation (répertoire `docs/`, `README.md` racine, et les README de packages si présents). Deux outils sont exposés :

- `ai-kit-docs` : navigation dans l’arborescence, lecture des fichiers et survol des mots-clés.
- `ai-kit-docs-search` : recherche plein texte avec extraits contextualisés.

### Utilisation rapide

```bash
npx -y @ai_kit/mcp-docs
```

Le serveur écoute en STDIO. Tu peux le brancher directement dans n’importe quel client MCP (Claude Desktop, Cursor, etc.).

### Exemple de configuration Claude Desktop

```json
{
  "mcpServers": {
    "ai-kit-docs": {
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

Pour exposer le README du package `@ai-kit/core`, il suffit donc de créer `packages/core/README.md`. Le prochain `pnpm --filter @ai_kit/mcp-docs build` répliquera ce fichier et il deviendra accessible via l’outil MCP.

## Contribuer

- Respectez la structure existante et les patterns introduits (ex. `TChunkDocument`, `createWorkflow`).
- Ajoutez des tests Vitest lorsque vous livrez une fonctionnalité critique.
- Documentez vos ajouts dans `docs/core` si vous introduisez un nouveau concept ou un flux important.

## Ressources

- [Documentation Agents](./docs/core/agents.md)
- [Documentation Chunks](./docs/core/chunks.md)
- [Documentation Workflows](./docs/core/workflows.md)
- [Documentation MCP](./docs/mcp/usage.md)

L’objectif est de renforcer notre autonomie technique autour des assistants et pipelines AI : n’hésitez pas à compléter ces ressources et à proposer des améliorations.
