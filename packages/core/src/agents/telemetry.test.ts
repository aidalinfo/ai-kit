import { describe, expect, it } from "vitest";

import { combineTelemetryOverrides, mergeTelemetryConfig } from "./telemetry.js";

describe("mergeTelemetryConfig with agentName", () => {
  it("defaults functionId and metadata.agent to the agent name when telemetry is active", () => {
    const result = mergeTelemetryConfig({
      agentTelemetryEnabled: true,
      agentName: "writer-agent",
    });

    expect(result).toMatchObject({
      isEnabled: true,
      functionId: "writer-agent",
      metadata: { agent: "writer-agent" },
    });
  });

  it("does not add functionId or metadata when telemetry is disabled", () => {
    const result = mergeTelemetryConfig({
      agentTelemetryEnabled: false,
      agentName: "writer-agent",
    });

    expect(result).toBeUndefined();
  });

  it("respects an explicit functionId override instead of the agent name", () => {
    const result = mergeTelemetryConfig({
      agentTelemetryEnabled: true,
      agentName: "writer-agent",
      overrides: { functionId: "custom-id" },
    });

    expect(result).toMatchObject({
      functionId: "custom-id",
      metadata: { agent: "writer-agent" },
    });
  });

  it("keeps a functionId already present on experimental_telemetry", () => {
    const result = mergeTelemetryConfig({
      agentTelemetryEnabled: true,
      agentName: "writer-agent",
      existing: { isEnabled: true, functionId: "explicit" },
    });

    expect(result).toMatchObject({ functionId: "explicit" });
  });

  it("lets a caller-provided metadata.agent win over the default", () => {
    const result = mergeTelemetryConfig({
      agentTelemetryEnabled: true,
      agentName: "writer-agent",
      overrides: { metadata: { agent: "override", workflow: "form-builder" } },
    });

    expect(result).toMatchObject({
      functionId: "writer-agent",
      metadata: { agent: "override", workflow: "form-builder" },
    });
  });

  it("merges agent metadata with existing experimental_telemetry metadata", () => {
    const result = mergeTelemetryConfig({
      agentTelemetryEnabled: true,
      agentName: "writer-agent",
      existing: { isEnabled: true, metadata: { tenant: "acme" } },
    });

    expect(result).toMatchObject({
      functionId: "writer-agent",
      metadata: { agent: "writer-agent", tenant: "acme" },
    });
  });

  it("does not inject agent defaults when no agentName is provided", () => {
    const result = mergeTelemetryConfig({
      agentTelemetryEnabled: true,
    });

    expect(result).toEqual({ isEnabled: true });
  });
});

describe("combineTelemetryOverrides", () => {
  it("returns undefined when neither defaults nor overrides are provided", () => {
    expect(combineTelemetryOverrides(undefined, undefined)).toBeUndefined();
  });

  it("lets call-level overrides win over config-level defaults", () => {
    const result = combineTelemetryOverrides(
      { functionId: "config-id", metadata: { workflow: "form-builder" } },
      { functionId: "call-id", metadata: { step: "draft" } },
    );

    expect(result).toEqual({
      functionId: "call-id",
      metadata: { workflow: "form-builder", step: "draft" },
    });
  });

  it("keeps config-level defaults when no call-level override is given", () => {
    const result = combineTelemetryOverrides(
      { functionId: "config-id", metadata: { workflow: "form-builder" } },
      undefined,
    );

    expect(result).toEqual({
      functionId: "config-id",
      metadata: { workflow: "form-builder" },
    });
  });
});
