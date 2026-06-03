# Realtime Transcription Implementation Plan

> Spec: `docs/superpowers/specs/2026-06-03-realtime-transcription-design.md`. Built with TDD (real local WS server, no socket mocks).

**Goal:** Add full-duplex realtime transcription to `@ai_kit/core` (`createRealtimeTranscription` + `mistralRealtimeTranscription`), Mistral-compatible, with docs.

## File Map

| Action | Path |
|--------|------|
| Modify | `packages/core/package.json` — add `ws` + `@types/ws` devDependencies (test server only) |
| Modify | `packages/core/src/transcription/types.ts` — realtime types |
| Create | `packages/core/src/transcription/realtime.ts` — factory, session, WS client |
| Create | `packages/core/src/transcription/mistral.ts` — `mistralRealtimeTranscription` wrapper |
| Modify | `packages/core/src/transcription/index.ts` — exports |
| Create | `packages/core/src/transcription/realtime.test.ts` — unit (local mock server) + gated real Mistral |
| Create | `packages/mintlify-docs/fr/agents/realtime-transcription.mdx` |
| Create | `packages/mintlify-docs/en/agents/realtime-transcription.mdx` |
| Modify | `packages/mintlify-docs/docs.json` — nav |

## TDD increments

1. **Happy path** — `transcribeStream(audioStream)` against a local mock server: emits `session.created` → `delta` → `done`. Assert normalized events.
2. **Low-level push** — `connect()` → `sendAudio`/`flush`/`end`; assert server received `input_audio.append` (base64 round-trips to the bytes), `input_audio.flush`, `input_audio.end`.
3. **Chunk splitting** — `sendAudio` of a > 262144-byte buffer produces multiple `input_audio.append` frames, each ≤ cap, concatenating back to the original.
4. **session.update** — `connect({ audioFormat, targetStreamingDelayMs })` sends a `session.update` before audio.
5. **Errors & forward-compat** — server `error` → `{type:"error"}` and `transcribeStream` stops; unknown `type` → `{type:"unknown", raw}`; handshake timeout → throws `RealtimeTranscriptionError`.
6. **Wrapper** — `mistralRealtimeTranscription()` applies Mistral defaults (modelId, baseURL, env key) — assert via injected `webSocketFactory` capturing the URL.
7. **Real integration** (`it.skipIf(!MISTRAL_API_KEY)`) — ffmpeg-convert a fixture to PCM, stream through `transcribeStream`, assert deltas + non-empty `done.text`.

## Verify

- `pnpm --filter @ai_kit/core test` (load `.env`) — all green, incl. real Mistral run.
- `pnpm --filter @ai_kit/core build` — dist emits `realtime.js` + `.d.ts`; exports reachable.
- Docs build/lint if available.
