import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock, streamTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  streamTextMock: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
  streamText: streamTextMock,
  stepCountIs: vi.fn(() => () => false),
  jsonSchema: vi.fn((schema: unknown) => schema),
  Output: { object: vi.fn(({ schema }: { schema: unknown }) => ({ type: "object", schema })) },
}));

import { Agent } from "./index.js";

const model = { provider: "anthropic", modelId: "claude" } as any;

function lastTelemetry() {
  const payload = generateTextMock.mock.calls.at(-1)?.[0];
  return payload?.experimental_telemetry;
}

beforeEach(() => {
  generateTextMock.mockReset();
  generateTextMock.mockResolvedValue({ text: "ok" });
  streamTextMock.mockReset();
});

describe("Agent telemetry tagging", () => {
  it("names the trace after the agent when telemetry is enabled with a boolean", async () => {
    const agent = new Agent({ name: "writer-agent", model, telemetry: true });

    await agent.generate({ prompt: "hi" });

    expect(lastTelemetry()).toMatchObject({
      isEnabled: true,
      functionId: "writer-agent",
      metadata: { agent: "writer-agent" },
    });
  });

  it("does not enable telemetry when the flag is absent", async () => {
    const agent = new Agent({ name: "writer-agent", model });

    await agent.generate({ prompt: "hi" });

    expect(lastTelemetry()).toBeUndefined();
  });

  it("accepts a config object and merges workflow metadata", async () => {
    const agent = new Agent({
      name: "constructor-form-agent",
      model,
      telemetry: { metadata: { workflow: "form-builder" } },
    });

    await agent.generate({ prompt: "hi" });

    expect(lastTelemetry()).toMatchObject({
      isEnabled: true,
      functionId: "constructor-form-agent",
      metadata: { agent: "constructor-form-agent", workflow: "form-builder" },
    });
  });

  it("honours an explicit functionId from the config object", async () => {
    const agent = new Agent({
      name: "writer-agent",
      model,
      telemetry: { functionId: "writeDoc" },
    });

    await agent.generate({ prompt: "hi" });

    expect(lastTelemetry()).toMatchObject({ functionId: "writeDoc" });
  });

  it("treats { enabled: false } as disabled", async () => {
    const agent = new Agent({
      name: "writer-agent",
      model,
      telemetry: { enabled: false, metadata: { workflow: "x" } },
    });

    await agent.generate({ prompt: "hi" });

    expect(lastTelemetry()).toBeUndefined();
  });

  it("tags the trace on the structured-output pipeline path", async () => {
    generateTextMock.mockResolvedValue({ text: "ok", output: { ok: true } });
    const agent = new Agent({
      name: "dependency-classifier-agent",
      model,
      telemetry: { metadata: { workflow: "form-builder" } },
    });

    await agent.generate({
      prompt: "classify",
      structuredOutput: {
        type: "object",
        responseFormat: { schema: { type: "object", properties: {} } },
      } as any,
    });

    expect(lastTelemetry()).toMatchObject({
      isEnabled: true,
      functionId: "dependency-classifier-agent",
      metadata: { agent: "dependency-classifier-agent", workflow: "form-builder" },
    });
  });

  it("lets a per-call functionId override the config default", async () => {
    const agent = new Agent({
      name: "writer-agent",
      model,
      telemetry: { functionId: "config-id" },
    });

    await agent.generate({ prompt: "hi", telemetry: { functionId: "call-id" } });

    expect(lastTelemetry()).toMatchObject({ functionId: "call-id" });
  });
});
