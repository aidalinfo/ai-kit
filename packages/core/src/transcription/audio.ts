// packages/core/src/transcription/audio.ts
import { readFile } from "node:fs/promises";
import type { AudioInput, AudioInputType } from "./types.js";

export function detectInputType(audio: AudioInput): AudioInputType {
  if (audio instanceof Uint8Array || Buffer.isBuffer(audio)) return "buffer";
  if (
    typeof audio === "string" &&
    (audio.startsWith("http://") || audio.startsWith("https://"))
  )
    return "url";
  return "path";
}

export async function loadAudio(
  audio: AudioInput,
  inputType: AudioInputType,
): Promise<Uint8Array> {
  if (inputType === "buffer") {
    if (audio instanceof Uint8Array) return audio;
    // Buffer extends Uint8Array — copy via shared underlying ArrayBuffer
    if (Buffer.isBuffer(audio))
      return new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
    throw new Error("Expected Buffer or Uint8Array for inputType 'buffer'");
  }
  if (inputType === "path") {
    const buf = await readFile(audio as string);
    return new Uint8Array(buf);
  }
  // url
  const response = await fetch(audio as string);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch audio from URL: ${response.status} ${response.statusText}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}
