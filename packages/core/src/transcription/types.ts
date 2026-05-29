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
