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
