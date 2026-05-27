# Transcription Support — @ai_kit/core

**Date:** 2026-05-27  
**Status:** Approved  
**Branch:** dev

---

## Context

AI Kit expose des agents et workflows IA. Il n'existe aucun support audio/transcription. L'objectif est d'ajouter une brique de transcription audio model-agnostic, compatible avec tout endpoint OpenAI-compatible (Scaleway Whisper large v3, OpenAI whisper-1, etc.), et intégrable dans les agents existants via un `tool()`.

---

## Ce qui est ajouté

Trois primitives publiques dans `@ai_kit/core` :

| Export | Rôle |
|---|---|
| `createTranscriptionModel(config)` | Crée un modèle de transcription `TranscriptionModelV3` compatible AI SDK v6 |
| `transcribe(options)` | Wrapper standalone : charge l'audio (path / URL / buffer), appelle le modèle, retourne le transcript |
| `createTranscriptionTool(model, options?)` | Retourne un `tool()` AI SDK branchable directement sur un `Agent` |

---

## Architecture

```
packages/core/src/transcription/
├── model.ts        # createTranscriptionModel()
├── transcribe.ts   # transcribe()
├── tool.ts         # createTranscriptionTool()
└── index.ts        # re-exports des 3 primitives
```

`packages/core/src/index.ts` exporte les 3 symboles.

Aucun nouveau package — tout reste dans `@ai_kit/core`.

---

## 1. `createTranscriptionModel(config)`

### Signature

```typescript
interface TranscriptionModelConfig {
  modelId: string;           // ex: 'whisper-large-v3'
  apiKey: string;
  baseURL: string;           // ex: 'https://api.scaleway.ai/v1'
  providerName?: string;     // pour les logs, défaut: 'openai-compatible'
}

function createTranscriptionModel(config: TranscriptionModelConfig): TranscriptionModelV3
```

### Implémentation

Implémente l'interface `TranscriptionModelV3` de `@ai-sdk/provider` (version courante en ai-kit : `@ai-sdk/provider@3.0.8`) :

```typescript
{
  specificationVersion: 'v3',
  provider: config.providerName ?? 'openai-compatible',
  modelId: config.modelId,
  doGenerate(options: TranscriptionModelV3CallOptions): Promise<...>
}
```

`doGenerate` :
1. Convertit `options.audio` (`Uint8Array | string base64`) en `Blob`
2. Construit un `FormData` avec : `file` (Blob), `model` (modelId), `response_format=verbose_json`
3. `POST ${baseURL}/audio/transcriptions` avec `Authorization: Bearer ${apiKey}` et les headers éventuels
4. Mappe la réponse Scaleway/OpenAI → format `TranscriptionModelV3` :
   - `segment.start` / `segment.end` → `startSecond` / `endSecond`
   - Gère les erreurs HTTP avec un message clair

### Mapping réponse

La réponse de l'API OpenAI-compatible (`response_format=verbose_json`) :
```json
{
  "text": "...",
  "language": "fr",
  "segments": [{ "text": "...", "start": 0.0, "end": 2.0 }]
}
```
est mappée vers :
```typescript
{
  text: string,
  language: string | undefined,
  durationInSeconds: number | undefined,  // si présent dans la réponse
  segments: Array<{ text: string, startSecond: number, endSecond: number }>,
  warnings: [],
  response: { timestamp: Date, modelId: string, headers: {} }
}
```

---

## 2. `transcribe(options)`

### Signature

```typescript
type AudioInput = Buffer | Uint8Array | string;
type AudioInputType = 'buffer' | 'path' | 'url';

interface TranscribeOptions {
  model: TranscriptionModelV3;
  audio: AudioInput;
  inputType?: AudioInputType;   // auto-détecté si absent
  mediaType?: string;           // ex: 'audio/wav' — optionnel, le provider détecte
  language?: string;            // ISO-639-1, passé en providerOptions
  providerOptions?: Record<string, Record<string, unknown>>;
  abortSignal?: AbortSignal;
}

interface TranscribeResult {
  text: string;
  segments: Array<{ text: string; startSecond: number; endSecond: number }>;
  language: string | undefined;
  durationInSeconds: number | undefined;
}

function transcribe(options: TranscribeOptions): Promise<TranscribeResult>
```

### Logique d'auto-détection du `inputType`

Quand `inputType` est absent :
- `Buffer` ou `Uint8Array` → `'buffer'`
- `string` commençant par `http://` ou `https://` → `'url'`
- Tout autre `string` → `'path'`

### Chargement selon `inputType`

| inputType | Action |
|---|---|
| `'buffer'` | Passé directement à `experimental_transcribe` |
| `'path'` | `readFile(audio)` → `Uint8Array` |
| `'url'` | `fetch(audio)` → `arrayBuffer()` → `Uint8Array` |

Le `mediaType` est passé à `experimental_transcribe` en `mediaType`. Si absent, l'API le détecte depuis le contenu du fichier.

Le `language` est passé dans `providerOptions` sous la clé du `provider` du modèle.

---

## 3. `createTranscriptionTool(model, options?)`

### Signature

```typescript
interface TranscriptionToolOptions {
  description?: string;   // description du tool pour le LLM
  toolName?: string;      // nom du tool, défaut: 'transcribeAudio'
}

function createTranscriptionTool(
  model: TranscriptionModelV3,
  options?: TranscriptionToolOptions
): Tool
```

### Schema du tool (Zod)

```typescript
z.object({
  audio: z.string().describe('Chemin de fichier, URL http(s), ou contenu base64 de l\'audio'),
  inputType: z.enum(['path', 'url', 'base64']).describe('Type de l\'input audio'),
  mediaType: z.string().optional().describe('Type MIME, ex: audio/wav, audio/mp3'),
  language: z.string().optional().describe('Code langue ISO-639-1, ex: fr, en'),
})
```

### Execute

Appelle `transcribe()` avec les paramètres. Pour `inputType: 'base64'`, convertit en `Uint8Array` avant de passer à `transcribe()` avec `inputType: 'buffer'`.

Retourne `{ text, language, durationInSeconds, segmentCount }` — le texte est ce que le LLM exploite ensuite.

### Usage type

```typescript
const whisperModel = createTranscriptionModel({
  modelId: 'whisper-large-v3',
  apiKey: process.env.SCALEWAY_API_KEY!,
  baseURL: 'https://api.scaleway.ai/v1',
  providerName: 'scaleway',
})

const agent = new Agent({
  name: 'medical-assistant',
  model: scaleway('gpt-oss-120b'),
  tools: {
    transcribeAudio: createTranscriptionTool(whisperModel, {
      description: 'Transcrit un enregistrement audio médical en texte',
    }),
  },
  loopTools: true,
})
```

---

## Dépendances

- `experimental_transcribe` depuis `ai` (déjà en dépendance : `ai@6.0.149`) ✅
- `TranscriptionModelV3` depuis `@ai-sdk/provider` (déjà en dépendance : `@ai-sdk/provider@3.0.8`) ✅
- `readFile` depuis `node:fs/promises` (Node built-in) ✅
- `zod` (déjà en dépendance) ✅
- `tool` depuis `ai` (déjà en dépendance) ✅

Aucune nouvelle dépendance.

---

## Formats audio supportés

Scaleway Whisper large v3 supporte (identique à OpenAI Whisper) :
`flac`, `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `ogg`, `wav`, `webm`

---

## Ce qui n'est PAS dans ce scope

- Streaming de la transcription (l'API Whisper est synchrone)
- Support de `speech()` (text-to-speech) — feature séparée
- Shortcut `scaleway.transcription()` sur le provider Scaleway — peut être ajouté plus tard
- Gestion des fichiers > 25 Mo (limite OpenAI/Scaleway) — erreur propagée telle quelle par le provider

---

## Tests à écrire

Un script de test manuel dans `packages/core/src/transcription/` (non committé, juste pour validation locale) qui :
1. Génère un WAV de 2s avec `ffmpeg`
2. Appelle `transcribe()` avec `inputType: 'path'`
3. Appelle `transcribe()` avec `inputType: 'buffer'`
4. Crée un agent avec `createTranscriptionTool()` et lui envoie un path audio
