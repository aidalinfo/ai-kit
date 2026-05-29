// packages/core/src/transcription/transcribe.ts
import { experimental_transcribe } from "ai";
import { detectInputType, loadAudio } from "./audio.js";
import type {
  TranscribeOptions,
  TranscribeResult,
} from "./types.js";

export async function transcribe(
  options: TranscribeOptions,
): Promise<TranscribeResult> {
  const inputType = options.inputType ?? detectInputType(options.audio);
  const audioData = await loadAudio(options.audio, inputType);

  const providerOptions: Record<string, Record<string, unknown>> =
    options.providerOptions ?? {};

  if (options.language) {
    const providerName = options.model.provider;
    providerOptions[providerName] = {
      ...(providerOptions[providerName] ?? {}),
      language: options.language,
    };
  }

  const result = await experimental_transcribe({
    model: options.model as any,
    audio: audioData,
    providerOptions: providerOptions as any,
    abortSignal: options.abortSignal,
  });

  return {
    text: result.text,
    segments: result.segments ?? [],
    language: result.language,
    durationInSeconds: result.durationInSeconds,
  };
}
