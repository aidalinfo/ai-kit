// packages/core/src/transcription/streaming-model.ts
import { detectInputType, loadAudio } from "./audio.js";
import type {
  TranscribeStreamOptions,
  TranscriptionModelConfig,
  TranscriptionStreamChunk,
  TranscriptionStreamingModel,
} from "./types.js";

interface SseTranscriptEvent {
  type?: string;
  delta?: string;
  text?: string;
  usage?: { seconds?: number };
}

/**
 * Creates a streaming transcription model that talks to an OpenAI-compatible
 * `/audio/transcriptions` endpoint (e.g. Scaleway whisper-large-v3) directly,
 * without going through the AI SDK. The provider streams server-sent events
 * (`transcript.text.delta` / `transcript.text.done`) which are parsed natively.
 */
export function createTranscriptionStreamingModel(
  config: TranscriptionModelConfig,
): TranscriptionStreamingModel {
  const provider = config.providerName ?? "openai-compatible";

  return {
    provider,
    modelId: config.modelId,

    async *stream(
      options: TranscribeStreamOptions,
    ): AsyncGenerator<TranscriptionStreamChunk, void, unknown> {
      const inputType = options.inputType ?? detectInputType(options.audio);
      const audioData = await loadAudio(options.audio, inputType);

      const blob = new Blob([audioData as BlobPart], {
        type: options.mediaType ?? "audio/wav",
      });

      const form = new FormData();
      form.append("file", blob, "audio.wav");
      form.append("model", config.modelId);
      // Note: "verbose_json" is rejected when streaming; the default JSON
      // streaming format emits transcript.text.delta / transcript.text.done.
      form.append("stream", "true");
      if (options.language) form.append("language", options.language);

      const res = await fetch(`${config.baseURL}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: form,
        signal: options.abortSignal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "(no body)");
        throw new Error(
          `Transcription API error ${res.status} ${res.statusText}: ${body}`,
        );
      }
      if (!res.body) {
        throw new Error("Transcription API returned an empty stream body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let durationInSeconds: number | undefined;
      let doneEmitted = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by a blank line.
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);

            const dataLine = rawEvent
              .split("\n")
              .map((l) => l.trimStart())
              .find((l) => l.startsWith("data:"));
            if (!dataLine) continue;

            const data = dataLine.slice("data:".length).trim();
            if (data === "" || data === "[DONE]") continue;

            let event: SseTranscriptEvent;
            try {
              event = JSON.parse(data) as SseTranscriptEvent;
            } catch {
              continue;
            }

            if (event.type === "transcript.text.done") {
              // Authoritative final text when provided, otherwise what we accumulated.
              const text = event.text ?? fullText;
              durationInSeconds = event.usage?.seconds ?? durationInSeconds;
              doneEmitted = true;
              yield { type: "done", text, durationInSeconds };
              continue;
            }

            // transcript.text.delta (or any event carrying an incremental delta)
            const delta = event.delta ?? "";
            if (delta) {
              fullText += delta;
              yield { type: "delta", textDelta: delta };
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Some providers may close the stream without an explicit done event.
      if (!doneEmitted) {
        yield { type: "done", text: fullText, durationInSeconds };
      }
    },
  };
}
