import type { ServerTelemetryOptions } from "../instrument.js";
import type { ServerKitConfig } from "./types.js";

export function resolveTelemetryOptions(
  value: ServerKitConfig["telemetry"],
): ServerTelemetryOptions {
  if (typeof value === "boolean") {
    return { enabled: value };
  }

  return value ?? { enabled: false };
}

