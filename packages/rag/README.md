# @ai_kit/rag

Couche RAG DX-first pour AI Kit : document helpers, chunking récursif, embeddings via AI SDK et connecteurs de vector store (mémoire et pgvector). Permet d’ingérer, requêter et générer une réponse en quelques lignes.

```ts
import { createRag, RagDocument, MemoryVectorStore } from "@ai_kit/rag";
import { openai } from "@ai-sdk/openai";

const rag = createRag({
  embedder: openai.embedding("text-embedding-3-small"),
  store: new MemoryVectorStore(),
  chunker: { size: 512, overlap: 50 },
});

const doc = RagDocument.fromText("Your document text here...");
await rag.ingest({ namespace: "kb", documents: [doc] });

const results = await rag.search({ namespace: "kb", query: "What is inside?" });
const answer = await rag.answer({
  namespace: "kb",
  query: "What is inside?",
  model: openai("gpt-4o-mini"),
});
```

### Principales briques
- `RagDocument.fromText/fromJSON/fromFile` : normalise un document avec id stable + métadonnées.
- Chunking récursif via `splitTextRecursively` de `@ai_kit/core` (options `size`, `overlap`, `separators`).
- Embedder générique (fonction ou `EmbeddingModel` du SDK `ai`).
- Vector stores : `MemoryVectorStore` (tests/démos) et `PgVectorStore` (pgvector, imports dynamiques).
- `ingest` (chunk → embed → upsert), `search` (embed query → vector store), `answer` (search → prompt RAG avec placeholders `{query}`/`{context}` + streaming via `answer.stream`).

Voir `package-rag.md` pour le design détaillé et la roadmap.

## Utiliser Postgres + pgvector

Pré-requis :
- Extensions installées sur votre base : `CREATE EXTENSION IF NOT EXISTS vector;`
- Dépendances côté projet : `pnpm add pg pgvector @ai_kit/rag @ai-sdk/openai`
- Variable d’environnement : `POSTGRES_CONNECTION_STRING=postgres://user:password@host:5432/db`

Exemple :

```ts
import { createRag, RagDocument, PgVectorStore } from "@ai_kit/rag";
import { openai } from "@ai-sdk/openai";

const rag = createRag({
  embedder: openai.embedding("text-embedding-3-small"),
  store: new PgVectorStore({
    connectionString: process.env.POSTGRES_CONNECTION_STRING!,
    // options: tableName, schema, indexName, dimensions, pool
  }),
  chunker: { size: 512, overlap: 50 },
});

await rag.ingest({
  namespace: "kb",
  documents: [RagDocument.fromText("Paris est la capitale de la France")],
});

// Requête RAG : recherche seule
const results = await rag.search({
  namespace: "kb",
  query: "Quelle est la capitale de la France ?",
  topK: 3,
});

console.log(results.map((r) => ({ score: r.score, text: r.chunk.text })));

// Ou génération complète
const answer = await rag.answer({
  namespace: "kb",
  query: "Quelle est la capitale de la France ?",
  model: openai("gpt-4o-mini"),
});

console.log(answer.text);
```

Notes :
- Le store crée le schéma/table/index IVFFLAT au démarrage si besoin (`rag_vectors` par défaut). Pensez à `ANALYZE` si vous venez de peupler la table pour de meilleures perfs.
- `upsertMode: "replace"` dans `ingest` supprime le namespace avant réinsertion (si votre Postgres autorise `DELETE`).
- Le connecteur utilise cosine distance (`vector_cosine_ops`). Ajustez `dimensions` si votre modèle ne correspond pas à la taille par défaut détectée par pgvector.
