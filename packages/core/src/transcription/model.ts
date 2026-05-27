// packages/core/src/transcription/model.ts
import type {
  TranscriptionModelV3,
  TranscriptionModelV3CallOptions,
} from "@ai-sdk/provider";
import type { TranscriptionModelConfig } from "./types.js";

export function createTranscriptionModel(
  config: TranscriptionModelConfig,
): TranscriptionModelV3 {
  const provider = config.providerName ?? "openai-compatible";

  return {
    specificationVersion: "v3",
    provider,
    modelId: config.modelId,

    async doGenerate(options: TranscriptionModelV3CallOptions) {
      const audioData =
        typeof options.audio === "string"
          ? Uint8Array.from(atob(options.audio), (c) => c.charCodeAt(0))
          : options.audio;

      const blob = new Blob([audioData], {
        type: options.mediaType ?? "audio/wav",
      });

      const form = new FormData();
      form.append("file", blob, "audio.wav");
      form.append("model", config.modelId);
      form.append("response_format", "verbose_json");

      const extraHeaders = Object.fromEntries(
        Object.entries(options.headers ?? {}).filter(([, v]) => v !== undefined)
      ) as Record<string, string>;

      const res = await fetch(`${config.baseURL}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...extraHeaders,
        },
        body: form,
        signal: options.abortSignal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "(no body)");
        throw new Error(
          `Transcription API error ${res.status} ${res.statusText}: ${body}`,
        );
      }

      const json = (await res.json()) as {
        text: string;
        language?: string;
        duration?: number;
        segments?: Array<{ text: string; start: number; end: number }>;
      };

      return {
        text: json.text,
        language: json.language,
        durationInSeconds: json.duration,
        segments: (json.segments ?? []).map((s) => ({
          text: s.text,
          startSecond: s.start,
          endSecond: s.end,
        })),
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId: config.modelId,
          headers: {},
        },
      };
    },
  };
}
