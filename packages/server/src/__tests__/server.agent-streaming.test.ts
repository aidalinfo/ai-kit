import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@ai_kit/core";

import { ServerKit } from "../ServerKit.js";

describe("ServerKit agents endpoints (structured/stream)", () => {
  it("injecte experimental_output dans /generate", async () => {
    const agent = {
      generate: vi.fn(async () => {
        const result = { text: "ok" };
        Object.defineProperty(result, "experimental_output", {
          enumerable: false,
          configurable: true,
          value: { summary: "structured" },
        });
        return result;
      }),
      stream: vi.fn(),
    } as unknown as Agent;

    const server = new ServerKit({ agents: { demo: agent } });
    const response = await server.app.request("/api/agents/demo/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      text: "ok",
      experimental_output: { summary: "structured" },
    });
  });

  it("privilégie toDataStreamResponse quand disponible", async () => {
    const toReadableStream = vi.fn();
    const toDataStreamResponse = vi.fn(() =>
      new Response("event: data\ndata: {}\n\n", {
        headers: {
          "Content-Type": "text/event-stream",
          "x-source": "data-stream",
        },
      }),
    );

    const agent = {
      generate: vi.fn(),
      stream: vi.fn(async () => ({ toDataStreamResponse, toReadableStream })),
    } as unknown as Agent;

    const server = new ServerKit({ agents: { demo: agent } });
    const response = await server.app.request("/api/agents/demo/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-source")).toBe("data-stream");
    expect(toDataStreamResponse).toHaveBeenCalledTimes(1);
    expect(toReadableStream).not.toHaveBeenCalled();
  });

  it("retourne une réponse SSE depuis toReadableStream", async () => {
    const toReadableStream = vi.fn(
      () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("event: message\\ndata: ping\\n\\n"));
            controller.close();
          },
        }),
    );

    const agent = {
      generate: vi.fn(),
      stream: vi.fn(async () => ({ toReadableStream })),
    } as unknown as Agent;

    const server = new ServerKit({ agents: { demo: agent } });
    const response = await server.app.request("/api/agents/demo/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await expect(response.text()).resolves.toContain("event: message");
  });
});
