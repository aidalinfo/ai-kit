// packages/core/src/transcription/transcribe.ts
import { readFile } from "node:fs/promises";
import { experimental_transcribe } from "ai";
import type {
  AudioInput,
  AudioInputType,
  TranscribeOptions,
  TranscribeResult,
} from "./types.js";

function detectInputType(audio: AudioInput): AudioInputType {
  if (audio instanceof Uint8Array || Buffer.isBuffer(audio)) return "buffer";
  if (
    typeof audio === "string" &&
    (audio.startsWith("http://") || audio.startsWith("https://"))
  )
    return "url";
  return "path";
}

async function loadAudio(
  audio: AudioInput,
  inputType: AudioInputType,
): Promise<Uint8Array> {
  if (inputType === "buffer") {
    return audio instanceof Uint8Array
      ? audio
      : new Uint8Array(audio as unknown as ArrayBuffer);
  }
  if (inputType === "path") {
    const buf = await readFile(audio as string);
    return new Uint8Array(buf);
  }
  // url
  const response = await fetch(audio as string);
  return new Uint8Array(await response.arrayBuffer());
}

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
    ...(options.mediaType !== undefined && { mediaType: options.mediaType }),
    providerOptions: providerOptions as any,
    abortSignal: options.abortSignal,
  });

  return {
    text: result.text,
    segments: result.segments,
    language: result.language,
    durationInSeconds: result.durationInSeconds,
  };
}
