// packages/core/src/transcription/transcribe.test.ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createTranscriptionModel } from "./model.js";
import { createTranscriptionStreamingModel } from "./streaming-model.js";
import { transcribe } from "./transcribe.js";
import { createTranscriptionTool } from "./tool.js";
import { Agent } from "../agents/index.js";
import { scaleway } from "../shared/utils/provider/scaleway.js";

// Integration tests: they hit the real Scaleway API and need a local audio
// fixture. Run only when both the API key and the fixture are available;
// otherwise skip cleanly instead of failing the suite.
const apiKey = process.env.SCALEWAY_API_KEY;
const AUDIO_FIXTURE = process.env.TRANSCRIPTION_FIXTURE ?? "/tmp/test-transcription.wav";
const canRun = Boolean(apiKey) && existsSync(AUDIO_FIXTURE);

const scalewayConfig = {
  modelId: "whisper-large-v3",
  apiKey: apiKey ?? "",
  baseURL: "https://api.scaleway.ai/v1",
  providerName: "scaleway",
};

const whisperModel = createTranscriptionModel(scalewayConfig);
const whisperStreamingModel = createTranscriptionStreamingModel(scalewayConfig);

describe.skipIf(!canRun)("transcription", () => {
  it(
    "transcribes from a file path",
    async () => {
      const result = await transcribe({
        model: whisperModel,
        audio: AUDIO_FIXTURE,
        inputType: "path",
      });
      expect(typeof result.text).toBe("string");
      expect(Array.isArray(result.segments)).toBe(true);
    },
    30_000,
  );

  it(
    "transcribes from a buffer",
    async () => {
      const buf = await readFile(AUDIO_FIXTURE);
      const result = await transcribe({
        model: whisperModel,
        audio: new Uint8Array(buf),
        inputType: "buffer",
      });
      expect(typeof result.text).toBe("string");
    },
    30_000,
  );

  it(
    "streams a transcription natively from a buffer",
    async () => {
      const buf = await readFile(AUDIO_FIXTURE);

      const deltas: string[] = [];
      let finalText: string | undefined;
      let doneCount = 0;

      for await (const chunk of whisperStreamingModel.stream({
        audio: new Uint8Array(buf),
        inputType: "buffer",
      })) {
        if (chunk.type === "delta") {
          expect(typeof chunk.textDelta).toBe("string");
          deltas.push(chunk.textDelta);
        } else {
          doneCount += 1;
          finalText = chunk.text;
        }
      }

      // Exactly one done event closing the stream.
      expect(doneCount).toBe(1);
      expect(typeof finalText).toBe("string");
      // The final text matches the concatenation of the streamed deltas.
      expect(finalText).toBe(deltas.join(""));
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
        prompt: `Transcris le fichier audio : ${AUDIO_FIXTURE}`,
      });

      // The agent must have called the tool (at least one step with tool calls)
      const toolCallSteps = result.steps.filter((s) => s.toolCalls?.length > 0);
      expect(toolCallSteps.length).toBeGreaterThan(0);
    },
    60_000,
  );
});
