# Realtime Transcription (WebSocket, Mistral-compatible) — Design

**Date:** 2026-06-03
**Package:** `@ai_kit/core`
**Status:** Approved (design questions answered: generic/Mistral-first, both API shapes, raw-PCM only, Node-core first)

## Goal

Add **real-time, full-duplex audio transcription** to `@ai_kit/core`: push audio chunks as they arrive (microphone, live stream) over a WebSocket and receive incremental transcription deltas. Compatible with Mistral's realtime transcription API, exposed as an easy-to-use feature, with documentation.

## Why a custom WebSocket client (Vercel AI SDK capability finding)

The Vercel AI SDK (`ai@6`) has **no realtime transcription primitive**. Its `experimental_transcribe` / `transcribe` and the `TranscriptionModelV3` provider interface are **batch only** (`doGenerate`: one file in → one result out). Realtime in the Vercel ecosystem is provider-specific (e.g. ElevenLabs sockets), not a core abstraction.

Therefore realtime requires a small, direct WebSocket client — the same "go direct, bypass the SDK" pattern already used by the existing `streaming-model.ts` (Scaleway SSE). Note: `streaming-model.ts` is a **different** feature — it streams the *output* of a *complete* uploaded file over SSE-on-HTTP-POST. Realtime is full-duplex: audio is *pushed* incrementally.

No new runtime dependency is needed: Node ≥ 22's global `WebSocket` (undici) supports the non-standard `{ headers }` option, verified to send `Authorization: Bearer …` on the upgrade request. (`ws` is added only as a **devDependency** for the in-test mock server.)

## Mistral realtime protocol (verified against the official `mistralai` Python SDK source)

- **Endpoint:** `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=<modelId>` (https→wss / http→ws upgrade). Auth: `Authorization: Bearer $MISTRAL_API_KEY` header.
- **Audio:** raw PCM `pcm_s16le`, 16000 Hz, mono.
- **Model:** `voxtral-mini-transcribe-realtime-2602`.
- **Client → server (JSON text frames):**
  - `{ "type": "input_audio.append", "audio": "<base64 PCM>" }` — max **262144 bytes decoded** per frame.
  - `{ "type": "input_audio.flush" }`
  - `{ "type": "input_audio.end" }`
  - `{ "type": "session.update", "session": { "audio_format": { "encoding", "sample_rate" }, "target_streaming_delay_ms" } }` — must be sent **before** any audio.
- **Server → client (JSON, discriminated by `type`):**
  - `session.created` → `{ session: { request_id, model, audio_format } }`
  - `session.updated` → `{ session }`
  - `transcription.text.delta` → `{ text }` (incremental text)
  - `transcription.segment` → segment delta
  - `transcription.language` → `{ … }`
  - `transcription.done` → `{ model, text, usage }`
  - `error` → `{ error }`
- **Flow:** open → wait for `session.created` → (optional) `session.update` → append audio chunks → `flush` + `end` → read events until `transcription.done` / `error`.

## Architecture

New code in `packages/core/src/transcription/` (next to batch transcription):

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `realtime.ts` | `createRealtimeTranscription()` factory, session object, WS handling, URL build |
| Create | `mistral.ts` | `mistralRealtimeTranscription()` thin Mistral-first wrapper |
| Modify | `types.ts` | Realtime types (config, options, event union, session/model interfaces) |
| Modify | `index.ts` | Export new symbols |
| Create | `realtime.test.ts` | Unit tests against a local mock WS server + gated real-Mistral integration test |
| Create | `packages/mintlify-docs/{fr,en}/agents/realtime-transcription.mdx` | Docs page |
| Modify | `packages/mintlify-docs/docs.json` | Nav entry |

### Public API

```ts
interface RealtimeTranscriptionConfig {
  modelId: string;
  apiKey: string;
  baseURL?: string;        // default "https://api.mistral.ai/v1"
  providerName?: string;   // default "mistral"
  headers?: Record<string, string>;
  path?: string;           // default "/audio/transcriptions/realtime"
}

interface AudioFormat { encoding?: string; sampleRate?: number } // defaults pcm_s16le / 16000

interface RealtimeConnectOptions {
  audioFormat?: AudioFormat;
  targetStreamingDelayMs?: number;
  timeoutMs?: number;       // handshake timeout, default 30000
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

type RealtimeTranscriptionEvent =
  | { type: "session.created"; session: { requestId: string; model: string; audioFormat: { encoding: string; sampleRate: number } } }
  | { type: "session.updated"; session: { requestId: string; model: string; audioFormat: { encoding: string; sampleRate: number } } }
  | { type: "delta"; textDelta: string }
  | { type: "segment"; text: string; startSecond?: number; endSecond?: number }
  | { type: "language"; language: string }
  | { type: "done"; text: string; usage?: { promptTokens?: number; completionTokens?: number } }
  | { type: "error"; error: string }
  | { type: "unknown"; raw: unknown };

interface RealtimeTranscriptionSession {
  readonly requestId: string;
  readonly model: string;
  readonly audioFormat: { encoding: string; sampleRate: number };
  readonly closed: boolean;
  sendAudio(chunk: Uint8Array): Promise<void>;   // base64-encodes, auto-splits > 262144 bytes
  flush(): Promise<void>;
  end(): Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
  events(): AsyncGenerator<RealtimeTranscriptionEvent>;
  [Symbol.asyncIterator](): AsyncGenerator<RealtimeTranscriptionEvent>;
}

interface RealtimeTranscriptionModel {
  readonly modelId: string;
  readonly provider: string;
  connect(options?: RealtimeConnectOptions): Promise<RealtimeTranscriptionSession>;
  transcribeStream(
    audioStream: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    options?: RealtimeConnectOptions,
  ): AsyncGenerator<RealtimeTranscriptionEvent>;
}

// Optional injection point for testing.
interface RealtimeInternals { webSocketFactory?: (url: string, headers: Record<string, string>) => WebSocketLike }

function createRealtimeTranscription(
  config: RealtimeTranscriptionConfig,
  internals?: RealtimeInternals,
): RealtimeTranscriptionModel;

function mistralRealtimeTranscription(opts?: {
  apiKey?: string;     // default process.env.MISTRAL_API_KEY
  modelId?: string;    // default "voxtral-mini-transcribe-realtime-2602"
  baseURL?: string;    // default "https://api.mistral.ai/v1"
}): RealtimeTranscriptionModel;
```

### Data flow

- **connect()**: build ws URL (`baseURL + path + ?model=`, scheme upgraded) → `new WebSocket(url, { headers })` → await `open` → read frames until `session.created` (with `timeoutMs`; pre-session frames are buffered and replayed) → if `audioFormat`/`targetStreamingDelayMs` set, send `session.update` → return session.
- **push → pull bridge**: socket `onmessage` parses + normalizes each frame into a `RealtimeTranscriptionEvent` and enqueues it in an internal async queue; `events()` drains the queue. `onclose`/`onerror` terminate the iterator.
- **sendAudio(chunk)**: split into ≤ 262144-byte slices, base64-encode, send `input_audio.append` per slice.
- **transcribeStream(audioStream, opts)**: `connect()` → background task pumps `audioStream` then `flush()`+`end()` → yields events until `done`/`error` → `finally` cancels the pump and `close()`s.

### Error handling & robustness

- Connection failure / handshake timeout / aborted signal → throw `RealtimeTranscriptionError` (an `Error` subclass).
- Server `error` event → yielded as `{ type: "error", error }`; `transcribeStream` stops after emitting it (low-level `events()` leaves the decision to the caller).
- `AbortSignal` → closes the socket and ends the iterator.
- Unknown server `type` → `{ type: "unknown", raw }` — never throws (forward-compat).
- Audio: **raw PCM `s16le` 16 kHz mono required**. No bundled ffmpeg; the conversion recipe is documented. Format overridable via `session.update`.

### Testing

- **Local mock WS server** (`ws` devDependency): a server speaking the exact Mistral frames (`session.created`, `transcription.text.delta`, `transcription.done`, `error`). Connect the real client at `http://127.0.0.1:<port>` (upgraded to ws) and assert: handshake, header auth, normalized events, that the server received correct `input_audio.append` (base64 round-trip) / `flush` / `end` frames, and `> 262144`-byte auto-splitting. This exercises the real runtime path (no mocking of the WebSocket).
- **Real Mistral integration** (`it.skipIf(!process.env.MISTRAL_API_KEY)`): convert a short fixture to PCM via ffmpeg, stream it through `transcribeStream`, assert deltas + a final `done` with non-empty text. Run end-to-end before merge.

## Self-review

- **Placeholders:** none.
- **Consistency:** event union mirrors the existing `TranscriptionStreamChunk` (`delta`/`done`) style; config mirrors `TranscriptionModelConfig`. The 262144-byte cap matches the protocol. Frame `type` strings verified against the Python SDK.
- **Scope:** single feature, single plan. Browser relay explicitly deferred. No ffmpeg dependency.
- **Ambiguity:** `transcribeStream` stops on `done`/`error`; `events()` does not — explicit above.
