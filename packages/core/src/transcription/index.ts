// packages/core/src/transcription/index.ts
export { createTranscriptionModel } from "./model.js";
export { transcribe } from "./transcribe.js";
export { createTranscriptionTool } from "./tool.js";
export type {
  TranscriptionModelConfig,
  AudioInput,
  AudioInputType,
  TranscribeOptions,
  TranscribeResult,
  TranscriptionToolOptions,
  TranscriptionModelV3,
} from "./types.js";
