import type { AgentTools, GenerateTextParams } from "./types.js";

/**
 * When tools are available, disable the AI SDK default stop condition so the
 * model can speak after executing a tool. Otherwise the generation would stop
 * right after the first tool roundtrip, leaving `result.text` empty.
 */
export function applyDefaultStopWhen<T extends { stopWhen?: GenerateTextParams["stopWhen"] }>(
  payload: T,
  tools: AgentTools,
) {
  if (!tools || payload.stopWhen !== undefined) {
    return;
  }

  payload.stopWhen = [];
}
