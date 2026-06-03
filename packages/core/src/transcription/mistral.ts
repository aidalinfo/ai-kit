// packages/core/src/transcription/mistral.ts
import { RealtimeTranscriptionError, createRealtimeTranscription } from "./realtime.js";
import type { RealtimeInternals, RealtimeTranscriptionModel } from "./types.js";

export const MISTRAL_REALTIME_MODEL = "voxtral-mini-transcribe-realtime-2602";
export const MISTRAL_REALTIME_BASE_URL = "https://api.mistral.ai/v1";

export interface MistralRealtimeOptions {
  /** Defaults to `process.env.MISTRAL_API_KEY`. */
  apiKey?: string;
  /** Defaults to "voxtral-mini-transcribe-realtime-2602". */
  modelId?: string;
  /** Defaults to "https://api.mistral.ai/v1". */
  baseURL?: string;
}

/**
 * Mistral-first shortcut over {@link createRealtimeTranscription}: applies the
 * Mistral realtime model, base URL and `MISTRAL_API_KEY` fallback.
 */
export function mistralRealtimeTranscription(
  options: MistralRealtimeOptions = {},
  internals?: RealtimeInternals,
): RealtimeTranscriptionModel {
  const apiKey = options.apiKey ?? process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new RealtimeTranscriptionError(
      "mistralRealtimeTranscription requires `apiKey` or the MISTRAL_API_KEY env var.",
    );
  }

  return createRealtimeTranscription(
    {
      modelId: options.modelId ?? MISTRAL_REALTIME_MODEL,
      apiKey,
      baseURL: options.baseURL ?? MISTRAL_REALTIME_BASE_URL,
      providerName: "mistral",
    },
    internals,
  );
}
