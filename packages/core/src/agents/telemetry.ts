import type {
  AgentTelemetryOverrides,
  GenerateTextParams,
  StreamTextParams,
} from "./types.js";

type TelemetryVariant =
  | GenerateTextParams["experimental_telemetry"]
  | StreamTextParams["experimental_telemetry"];

type ExperimentalTelemetry = NonNullable<TelemetryVariant>;

interface MergeTelemetryParams {
  agentTelemetryEnabled: boolean;
  overrides?: AgentTelemetryOverrides;
  existing?: TelemetryVariant;
}

export function mergeTelemetryConfig({
  agentTelemetryEnabled,
  overrides,
  existing,
}: MergeTelemetryParams): TelemetryVariant | undefined {
  const existingTelemetry = existing
    ? ({ ...existing } as ExperimentalTelemetry)
    : undefined;

  const explicitDisable = existingTelemetry?.isEnabled === false;

  let result = existingTelemetry;

  if (agentTelemetryEnabled && !explicitDisable) {
    result = { ...(result ?? {}), isEnabled: true } as ExperimentalTelemetry;
  }

  const telemetryActive = result?.isEnabled === true;

  if (!telemetryActive) {
    return result;
  }

  if (!overrides) {
    return result;
  }

  const activeTelemetry = result as ExperimentalTelemetry;

  if (
    overrides.functionId !== undefined &&
    activeTelemetry.functionId === undefined
  ) {
    activeTelemetry.functionId = overrides.functionId;
  }

  if (
    overrides.recordInputs !== undefined &&
    activeTelemetry.recordInputs === undefined
  ) {
    activeTelemetry.recordInputs = overrides.recordInputs;
  }

  if (
    overrides.recordOutputs !== undefined &&
    activeTelemetry.recordOutputs === undefined
  ) {
    activeTelemetry.recordOutputs = overrides.recordOutputs;
  }

  if (overrides.metadata) {
    const existingMetadata =
      typeof activeTelemetry.metadata === "object" &&
      activeTelemetry.metadata !== null
        ? (activeTelemetry.metadata as Record<string, unknown>)
        : {};
    activeTelemetry.metadata = {
      ...overrides.metadata,
      ...existingMetadata,
    } as ExperimentalTelemetry["metadata"];
  }

  return activeTelemetry;
}
