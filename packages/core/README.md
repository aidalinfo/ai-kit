# AI Kit – Core

👉 **Read the full docs:** [ai.aidalinfo.fr](https://ai.aidalinfo.fr)

`@ai_kit/core` bundles the foundational building blocks of AI Kit: typed workflows (`createStep`, `createMapStep`, `createWorkflow`), agents (`Agent`), and telemetry utilities. Everything else (server kit, templates, CLI) builds on this package.

## Installation

```bash
pnpm add @ai_kit/core zod
# or
npm install @ai_kit/core zod
```

`zod` is optional but enables automatic type inference via `inputSchema` / `outputSchema`.

## Quick start

```ts
import { createStep, createWorkflow } from "@ai_kit/core";
import { z } from "zod";

const fetchWeather = createStep({
  id: "fetch-weather",
  inputSchema: z.object({ city: z.string().min(1) }),
  outputSchema: z.object({ forecast: z.string() }),
  handler: async ({ input }) => {
    // Call your API here
    return { forecast: `Sunny in ${input.city}` };
  },
});

export const weatherWorkflow = createWorkflow({
  id: "weather-line",
  description: "Minimal weather pipeline",
})
  .then(fetchWeather)
  .commit();

const run = await weatherWorkflow.run({ inputData: { city: "Paris" } });
console.log(run.status, run.result);
```

### Agents & telemetry

`@ai_kit/core` also ships with:

- `Agent` – orchestrates model calls (OpenAI, Scaleway, …) and exposes custom tools.
- Telemetry helpers to wire Langfuse / OpenTelemetry (`workflow.withTelemetry`, `run.watch()`, `run.stream()`).

Check the documentation for advanced agent samples, Langfuse integration, and human-in-the-loop steps.

---

## Transcription

`@ai_kit/core` includes model-agnostic audio transcription support, compatible with any OpenAI-compatible endpoint (Scaleway Whisper large v3, OpenAI whisper-1, etc.).

### Three public primitives

| Export | Role |
|---|---|
| `createTranscriptionModel(config)` | Creates a `TranscriptionModelV3` provider |
| `transcribe(options)` | Standalone function: loads audio (path / URL / buffer), calls the model, returns the transcript |
| `createTranscriptionTool(model, options?)` | Returns an AI SDK `tool()` to attach directly to an `Agent` |

### `createTranscriptionModel`

```ts
import { createTranscriptionModel } from "@ai_kit/core";

const whisperModel = createTranscriptionModel({
  modelId: "whisper-large-v3",
  apiKey: process.env.SCALEWAY_API_KEY!,
  baseURL: "https://api.scaleway.ai/v1",
  providerName: "scaleway", // optional, used in logs
});
```

Supports any OpenAI-compatible `/audio/transcriptions` endpoint (`response_format=verbose_json`).

### `transcribe`

```ts
import { transcribe } from "@ai_kit/core";

// From a file path
const result = await transcribe({
  model: whisperModel,
  audio: "/path/to/audio.wav",
  inputType: "path",         // "path" | "url" | "buffer" — auto-detected if omitted
  language: "fr",            // optional ISO-639-1 code
});

console.log(result.text);
// result.segments → [{ text, startSecond, endSecond }]
// result.language, result.durationInSeconds
```

`audio` accepts a file path, an `http(s)` URL, or a `Buffer` / `Uint8Array`. The `inputType` is auto-detected when omitted.

### `createTranscriptionTool` — attach to an Agent

```ts
import { createTranscriptionModel, createTranscriptionTool } from "@ai_kit/core";
import { Agent } from "@ai_kit/core";
import { scaleway } from "@ai_kit/core";

const whisperModel = createTranscriptionModel({
  modelId: "whisper-large-v3",
  apiKey: process.env.SCALEWAY_API_KEY!,
  baseURL: "https://api.scaleway.ai/v1",
});

const agent = new Agent({
  name: "medical-assistant",
  model: scaleway("gpt-oss-120b"),
  tools: {
    transcribeAudio: createTranscriptionTool(whisperModel, {
      description: "Transcrit un enregistrement audio médical en texte",
    }),
  },
});

const result = await agent.generate({
  prompt: "Transcris ce fichier : /recordings/consultation.mp3",
});
```

The tool schema exposed to the LLM: `audio` (path / URL / base64), `inputType`, `language`.

### Supported audio formats

`flac`, `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `ogg`, `wav`, `webm` (identical to OpenAI Whisper).

## Where does `@ai_kit/server` fit?

[`@ai_kit/server`](https://www.npmjs.com/package/@ai_kit/server) complements the core by adding:

- A ready-to-use HTTP server (Express/Fastify) to expose your workflows / agents.
- Streaming endpoints (`/runs/:id/stream`), human-step resume handlers, supervisory APIs.
- Production guardrails (auth hooks, rate limiting, metrics).

Use them together:

- Define workflows, steps, and agents with `@ai_kit/core`.
- Install `@ai_kit/server` when you need HTTP/WebSocket exposure, centralized Langfuse telemetry, or a multi-workflow orchestrator.

## Useful links

- Docs: [https://ai.aidalinfo.fr](https://ai.aidalinfo.fr)
- Full examples (workflows + agents): `packages/create-ai-kit/templates/*`
- Questions/issues: open a ticket on the main repository.
