// packages/core/src/transcription/tool.ts
import { tool } from "ai";
import { z } from "zod";
import { transcribe } from "./transcribe.js";
import type { TranscriptionModelV3, TranscriptionToolOptions } from "./types.js";

const transcriptionSchema = z.object({
  audio: z
    .string()
    .describe(
      "Chemin de fichier, URL http(s), ou contenu base64 de l'audio",
    ),
  inputType: z
    .enum(["path", "url", "base64"])
    .describe("Type de l'input audio"),
  language: z
    .string()
    .optional()
    .describe("Code langue ISO-639-1, ex: fr, en"),
});

export function createTranscriptionTool(
  model: TranscriptionModelV3,
  options?: TranscriptionToolOptions,
) {
  return tool({
    description:
      options?.description ??
      "Transcrit un fichier audio en texte. Accepte un chemin de fichier, une URL ou un contenu base64.",
    inputSchema: transcriptionSchema,
    async execute({ audio, inputType, language }: z.infer<typeof transcriptionSchema>) {
      let audioData: string | Uint8Array;
      let resolvedInputType: "buffer" | "path" | "url";

      if (inputType === "base64") {
        audioData = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
        resolvedInputType = "buffer";
      } else {
        audioData = audio;
        resolvedInputType = inputType;
      }

      const result = await transcribe({
        model,
        audio: audioData,
        inputType: resolvedInputType,
        language,
      });

      return {
        text: result.text,
        language: result.language,
        durationInSeconds: result.durationInSeconds,
        segmentCount: result.segments.length,
      };
    },
  });
}
