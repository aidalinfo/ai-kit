import { stepCountIs, type StopCondition, type ToolSet } from "ai";

import type { AgentTools } from "./types.js";

export const DEFAULT_MAX_STEP_TOOLS = 20;

export interface ToolLoopSettings {
  enabled: boolean;
  maxToolExecutions: number;
}

type MaybeStopCondition<TOOLS extends ToolSet> =
  | StopCondition<TOOLS>
  | StopCondition<TOOLS>[]
  | undefined;

interface RunAgentWithToolLoopParams<RESULT, TOOLS extends ToolSet> {
  settings: ToolLoopSettings;
  existingStopWhen?: MaybeStopCondition<TOOLS>;
  execute: (
    stopWhen: MaybeStopCondition<TOOLS>,
  ) => Promise<RESULT>;
}

export function createToolLoopSettings({
  loopToolsEnabled,
  tools,
  maxStepTools,
}: {
  loopToolsEnabled: boolean;
  tools?: AgentTools;
  maxStepTools: number | undefined;
}): ToolLoopSettings {
  const sanitizedMaxSteps = sanitizeMaxToolExecutions(maxStepTools);

  return {
    enabled: loopToolsEnabled && hasTools(tools),
    maxToolExecutions: sanitizedMaxSteps,
  };
}

export async function runAgentWithToolLoop<RESULT, TOOLS extends ToolSet>({
  settings,
  existingStopWhen,
  execute,
}: RunAgentWithToolLoopParams<RESULT, TOOLS>): Promise<RESULT> {
  const stopWhen = settings.enabled
    ? mergeStopConditions(existingStopWhen, settings)
    : existingStopWhen;

  const result = await execute(stopWhen);

  if (settings.enabled) {
    markLoopTool(result);
  }

  return result;
}

export function mergeStopConditions<TOOLS extends ToolSet>(
  stopWhen: MaybeStopCondition<TOOLS>,
  settings: ToolLoopSettings,
): StopCondition<TOOLS>[] {
  const stopConditions = normalizeStopConditions(stopWhen);

  if (settings.maxToolExecutions !== Infinity) {
    const maxExecutions = settings.maxToolExecutions;
    stopConditions.push(stepCountIs(maxExecutions));
    stopConditions.push(limitToolExecutions<TOOLS>(maxExecutions));
  }

  return stopConditions;
}

export function markLoopTool(result: unknown) {
  if (!result || typeof result !== "object") {
    return;
  }

  try {
    (result as Record<string, unknown>).loopTool = true;
  } catch {
    Object.defineProperty(result as object, "loopTool", {
      value: true,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }
}

function normalizeStopConditions<TOOLS extends ToolSet>(
  stopWhen: MaybeStopCondition<TOOLS>,
): StopCondition<TOOLS>[] {
  if (!stopWhen) {
    return [];
  }

  return Array.isArray(stopWhen) ? [...stopWhen] : [stopWhen];
}

function limitToolExecutions<TOOLS extends ToolSet>(
  maxExecutions: number,
): StopCondition<TOOLS> {
  return ({ steps }) => {
    let totalExecutions = 0;

    for (const step of steps) {
      totalExecutions += countToolExecutions(step);

      if (totalExecutions >= maxExecutions) {
        return true;
      }
    }

    return false;
  };
}

function countToolExecutions(step: unknown): number {
  if (!step || typeof step !== "object") {
    return 0;
  }

  const { toolCalls, toolResults } = step as {
    toolCalls?: unknown;
    toolResults?: unknown;
  };

  const callCount = Array.isArray(toolCalls) ? toolCalls.length : 0;
  const resultCount = Array.isArray(toolResults)
    ? toolResults.length
    : 0;

  return Math.max(callCount, resultCount);
}

function hasTools(tools: AgentTools | undefined) {
  if (!tools) {
    return false;
  }

  return Object.keys(tools).length > 0;
}

function sanitizeMaxToolExecutions(maxStepTools: number | undefined) {
  if (maxStepTools === undefined) {
    return DEFAULT_MAX_STEP_TOOLS;
  }

  if (!Number.isFinite(maxStepTools)) {
    return Infinity;
  }

  const sanitized = Math.floor(maxStepTools);
  if (sanitized < 1) {
    return DEFAULT_MAX_STEP_TOOLS;
  }

  return sanitized;
}
