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
  mediaType?: string;
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
  toolName?: string;
}
