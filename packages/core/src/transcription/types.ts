// packages/core/src/transcription/types.ts
import type { TranscriptionModelV3 } from "@ai-sdk/provider";

export type { TranscriptionModelV3 };

export interface TranscriptionModelConfig {
  modelId: string;
  apiKey: string;
  baseURL: string;
  providerName?: string;
}

export type AudioInput = Buffer | Uint8Array | string;
export type AudioInputType = "buffer" | "path" | "url";

export interface TranscribeOptions {
  model: TranscriptionModelV3;
  audio: AudioInput;
  inputType?: AudioInputType;
  language?: string;
  providerOptions?: Record<string, Record<string, unknown>>;
  abortSignal?: AbortSignal;
}

export interface TranscribeResult {
  text: string;
  segments: Array<{ text: string; startSecond: number; endSecond: number }>;
  language: string | undefined;
  durationInSeconds: number | undefined;
}

export interface TranscriptionToolOptions {
  description?: string;
}

export interface TranscribeStreamOptions {
  audio: AudioInput;
  inputType?: AudioInputType;
  language?: string;
  /** MIME type of the audio payload (defaults to "audio/wav"). */
  mediaType?: string;
  abortSignal?: AbortSignal;
}

/**
 * A chunk emitted while streaming a transcription.
 * - `delta`: an incremental piece of transcribed text.
 * - `done`: the final event, carrying the full accumulated text.
 */
export type TranscriptionStreamChunk =
  | { type: "delta"; textDelta: string }
  | { type: "done"; text: string; durationInSeconds?: number };

/**
 * A native (non AI SDK) streaming transcription model. Streams partial text
 * over server-sent events as the provider processes the audio.
 */
export interface TranscriptionStreamingModel {
  modelId: string;
  provider: string;
  stream(
    options: TranscribeStreamOptions,
  ): AsyncGenerator<TranscriptionStreamChunk, void, unknown>;
}

// ---------------------------------------------------------------------------
// Realtime (full-duplex WebSocket) transcription — Mistral-compatible.
// ---------------------------------------------------------------------------

/** Configuration for a realtime transcription model. */
export interface RealtimeTranscriptionConfig {
  modelId: string;
  apiKey: string;
  /** API base URL. Defaults to "https://api.mistral.ai/v1". http/https are upgraded to ws/wss. */
  baseURL?: string;
  /** Logical provider name (telemetry/debug). Defaults to "mistral". */
  providerName?: string;
  /** Extra headers merged onto the upgrade request (e.g. custom auth). */
  headers?: Record<string, string>;
  /** Path appended to baseURL. Defaults to "/audio/transcriptions/realtime". */
  path?: string;
}

/** Raw PCM audio format announced to the provider. Mistral expects pcm_s16le / 16000 / mono. */
export interface RealtimeAudioFormat {
  /** Defaults to "pcm_s16le". */
  encoding?: string;
  /** Defaults to 16000. */
  sampleRate?: number;
}

/** Options for opening a realtime connection. */
export interface RealtimeConnectOptions {
  /** Sent via session.update before any audio. */
  audioFormat?: RealtimeAudioFormat;
  /** Latency/accuracy tuning, sent via session.update before any audio. */
  targetStreamingDelayMs?: number;
  /** Handshake timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Aborts the connection and ends the stream. */
  signal?: AbortSignal;
  /** Extra headers merged onto the upgrade request for this connection. */
  headers?: Record<string, string>;
}

/** Normalized session metadata, derived from session.created / session.updated. */
export interface RealtimeSessionInfo {
  requestId: string;
  model: string;
  audioFormat: { encoding: string; sampleRate: number };
}

/** Token usage reported on the final event. */
export interface RealtimeUsage {
  promptTokens?: number;
  completionTokens?: number;
}

/**
 * A normalized realtime transcription event. Mirrors the friendly delta/done
 * shape of {@link TranscriptionStreamChunk}; unknown server event types are
 * surfaced as `{ type: "unknown" }` rather than throwing (forward-compat).
 */
export type RealtimeTranscriptionEvent =
  | { type: "session.created"; session: RealtimeSessionInfo }
  | { type: "session.updated"; session: RealtimeSessionInfo }
  | { type: "delta"; textDelta: string }
  | { type: "segment"; text: string; startSecond?: number; endSecond?: number }
  | { type: "language"; language: string }
  | { type: "done"; text: string; usage?: RealtimeUsage }
  | { type: "error"; error: string }
  | { type: "unknown"; raw: unknown };

/** A live realtime transcription session (push audio, pull events). */
export interface RealtimeTranscriptionSession {
  readonly requestId: string;
  readonly model: string;
  readonly audioFormat: { encoding: string; sampleRate: number };
  readonly closed: boolean;
  /** Sends a PCM chunk; base64-encodes and auto-splits chunks larger than 262144 bytes. */
  sendAudio(chunk: Uint8Array): Promise<void>;
  /** Asks the provider to flush its buffer and emit pending transcription. */
  flush(): Promise<void>;
  /** Signals the end of the audio stream. */
  end(): Promise<void>;
  /** Closes the underlying WebSocket and ends the event stream. */
  close(code?: number, reason?: string): Promise<void>;
  /** Async iterator over normalized server events. */
  events(): AsyncGenerator<RealtimeTranscriptionEvent>;
  [Symbol.asyncIterator](): AsyncGenerator<RealtimeTranscriptionEvent>;
}

/** A realtime transcription model: open a session or run a one-shot stream. */
export interface RealtimeTranscriptionModel {
  readonly modelId: string;
  readonly provider: string;
  /** Low-level: open a session you push audio into (microphone / live source). */
  connect(options?: RealtimeConnectOptions): Promise<RealtimeTranscriptionSession>;
  /** High-level: pump an audio iterable through a session and yield events until done/error. */
  transcribeStream(
    audioStream: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    options?: RealtimeConnectOptions,
  ): AsyncGenerator<RealtimeTranscriptionEvent>;
}

/** Minimal WebSocket surface used by the client (satisfied by the global WebSocket). */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener?(type: string, listener: (event: unknown) => void): void;
}

/** Internal injection points (testing). */
export interface RealtimeInternals {
  /** Override the WebSocket factory (defaults to the global WebSocket with a headers option). */
  webSocketFactory?: (url: string, headers: Record<string, string>) => WebSocketLike;
}
