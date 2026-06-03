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
  /**
   * Agent name used as the default `functionId` (Langfuse trace name) and
   * `metadata.agent` when no explicit value is provided. Without it the AI SDK
   * names every span `ai.generateText`, leaving Langfuse traces unfilterable.
   */
  agentName?: string;
}

/**
 * Merge config-level telemetry defaults with per-call overrides into a single
 * {@link AgentTelemetryOverrides}. Per-call values win over config-level
 * defaults; `metadata` is shallow-merged with per-call keys taking precedence.
 */
export function combineTelemetryOverrides(
  defaults?: AgentTelemetryOverrides,
  overrides?: AgentTelemetryOverrides,
): AgentTelemetryOverrides | undefined {
  if (!defaults && !overrides) {
    return undefined;
  }

  const metadata =
    defaults?.metadata || overrides?.metadata
      ? { ...(defaults?.metadata ?? {}), ...(overrides?.metadata ?? {}) }
      : undefined;

  return {
    ...(defaults ?? {}),
    ...(overrides ?? {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function mergeTelemetryConfig({
  agentTelemetryEnabled,
  overrides,
  existing,
  agentName,
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

  const activeTelemetry = result as ExperimentalTelemetry;

  if (overrides) {
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
      const existingMetadata = asMetadataRecord(activeTelemetry.metadata);
      activeTelemetry.metadata = {
        ...overrides.metadata,
        ...existingMetadata,
      } as ExperimentalTelemetry["metadata"];
    }
  }

  // Default the trace name + agent metadata to the agent name so Langfuse
  // traces are filterable per agent instead of collapsing to ai.generateText.
  if (agentName) {
    if (activeTelemetry.functionId === undefined) {
      activeTelemetry.functionId = agentName;
    }

    const currentMetadata = asMetadataRecord(activeTelemetry.metadata);
    activeTelemetry.metadata = {
      agent: agentName,
      ...currentMetadata,
    } as ExperimentalTelemetry["metadata"];
  }

  return activeTelemetry;
}

function asMetadataRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
