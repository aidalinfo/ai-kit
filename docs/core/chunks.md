# Gestion des chunks avec `@ai-kit/core`

Ce module expose des utilitaires pour découper du texte ou des contenus JSON en morceaux cohérents, inspirés du comportement de Mastra.

## Importation

```ts
import {
  splitTextRecursively,
  splitJsonRecursively,
  TChunkDocument,
} from "@ai-kit/core";
```

## Découper du texte brut

```ts
const chunks = splitTextRecursively("Votre texte…", {
  chunkSize: 500,
  chunkOverlap: 50,
});

// Chaque chunk expose index, start, end, content, type = "text" et metadata éventuelle.
```

*`chunkOverlap`* définit le nombre de caractères partagés entre deux chunks afin de préserver le contexte.

### Réutiliser les chunks produits

```ts
const chunks = splitTextRecursively(longArticle, {
  chunkSize: 400,
  chunkOverlap: 40,
});

// Exemple 1 : préparer des embeddings
const values = chunks.map((chunk) => chunk.content);
await vectorStore.embed(values);

// Exemple 2 : reconstruire une synthèse
const summary = chunks
  .map((chunk) => chunk.content.split("\n")[0])
  .join("\n");

// Exemple 3 : attacher un identifiant à chaque passage
const passages = chunks.map((chunk) => ({
  id: `article-${chunk.index}`,
  text: chunk.content,
  start: chunk.start,
  end: chunk.end,
}));
```

## Découper du JSON

```ts
const data = { foo: "bar", nested: { value: 42 } };

const chunks = splitJsonRecursively(data, {
  chunkSize: 300,
  format: "pretty",
  metadata: { source: "exemple" },
});

// Les chunks ont type = "json" et héritent de la metadata fournie.
```

`format` peut être `auto`, `preserve` (respecter la chaîne d’origine) ou `pretty` (formatage lisible avant découpage).

## Utiliser `TChunkDocument`

```ts
const doc = TChunkDocument.fromJSON(myJson, { dataset: "clients" });
const chunks = doc.chunk({
  chunkSize: 256,
  chunkOverlap: 32,
  metadata: { stage: "training" },
});

// toString permet de récupérer le contenu formaté (utile pour logs ou stockage)
const normalized = doc.toString("pretty");
```

`TChunkDocument` simplifie la gestion du type de contenu (texte ou JSON) et fusionne la metadata du document avec celle passée lors du chunking.

## Conseils rapides

- Ajustez `chunkSize` selon la limite de votre modèle ou moteur de recherche.
- Utilisez un `chunkOverlap` léger (10–50) pour des tâches nécessitant le contexte adjoint.
- Associez des `metadata` pour tracer l’origine de chaque chunk et enrichir vos recherches ultérieures.