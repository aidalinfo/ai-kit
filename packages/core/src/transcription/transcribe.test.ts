// packages/core/src/transcription/transcribe.test.ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createTranscriptionModel } from "./model.js";
import { transcribe } from "./transcribe.js";
import { createTranscriptionTool } from "./tool.js";
import { Agent } from "../agents/index.js";
import { scaleway } from "../shared/utils/provider/scaleway.js";

const apiKey = process.env.SCALEWAY_API_KEY;
if (!apiKey) throw new Error("SCALEWAY_API_KEY is required for these tests");

const whisperModel = createTranscriptionModel({
  modelId: "whisper-large-v3",
  apiKey,
  baseURL: "https://api.scaleway.ai/v1",
  providerName: "scaleway",
});

describe("transcription", () => {
  it(
    "transcribes from a file path",
    async () => {
      const result = await transcribe({
        model: whisperModel,
        audio: "/tmp/test-transcription.wav",
        inputType: "path",
        mediaType: "audio/wav",
      });
      expect(typeof result.text).toBe("string");
      expect(Array.isArray(result.segments)).toBe(true);
    },
    30_000,
  );

  it(
    "transcribes from a buffer",
    async () => {
      const buf = await readFile("/tmp/test-transcription.wav");
      const result = await transcribe({
        model: whisperModel,
        audio: new Uint8Array(buf),
        inputType: "buffer",
        mediaType: "audio/wav",
      });
      expect(typeof result.text).toBe("string");
    },
    30_000,
  );

  it(
    "agent uses createTranscriptionTool to transcribe a path",
    async () => {
      const transcribeTool = createTranscriptionTool(whisperModel, {
        description: "Transcrit un fichier audio en texte",
      });

      const agent = new Agent({
        name: "transcription-test-agent",
        model: scaleway("llama-3.3-70b-instruct"),
        tools: { transcribeAudio: transcribeTool },
        instructions:
          "When asked to transcribe a file, call the transcribeAudio tool and return the resulting text.",
      });

      const result = await agent.generate({
        prompt: "Transcris le fichier audio : /tmp/test-transcription.wav",
      });

      expect(result.text.trim().length).toBeGreaterThan(0);
    },
    60_000,
  );
});
