import { describe, expect, it, vi } from "vitest";

import ClientKit, {
  ClientKitError,
  type AgentSummary,
  type WorkflowSummary,
} from "../ClientKit.js";

function createJsonResponse(data: unknown, status = 200) {
  const headers = new Headers({ "content-type": "application/json" });
  return new Response(JSON.stringify(data), { status, headers });
}

describe("ClientKit", () => {
  const baseUrl = "https://example.com";

  it("lists agents", async () => {
    const agents: AgentSummary[] = [
      { id: "assistant", name: "Assistant" },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ agents }),
    );
    const client = new ClientKit({ baseUrl, fetch: fetchMock });

    const result = await client.listAgents();

    expect(result).toEqual(agents);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api/agents",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("throws when an agent is not found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ agents: [] }),
    );
    const client = new ClientKit({ baseUrl, fetch: fetchMock });

    await expect(client.getAgent("unknown")).rejects.toThrowError(
      ClientKitError,
    );
  });

  it("validates agent payloads", async () => {
    const fetchMock = vi.fn();
    const client = new ClientKit({ baseUrl, fetch: fetchMock });

    await expect(
      client.generateAgent("assistant", {} as never),
    ).rejects.toThrowError(ClientKitError);
  });

  it("merges default runtime metadata and ctx for workflow runs", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        runId: "run-xyz",
        status: "success",
        steps: {},
        metadata: { tenant: "aidalinfo", userId: "42" },
        ctx: { traceId: "trace-123", locale: "fr-FR" },
        startedAt: now,
        finishedAt: now,
      }),
    );

    const client = new ClientKit({
      baseUrl,
      fetch: fetchMock,
      runtime: {
        metadata: { tenant: "aidalinfo" },
        ctx: { traceId: "trace-123" },
      },
    });

    await client.runWorkflow("enrich-data", {
      inputData: { id: "1" },
      metadata: { userId: "42" },
      ctx: { locale: "fr-FR" },
    });

    const call = fetchMock.mock.calls.at(-1);
    expect(call).toBeDefined();
    const [, init] = call!;
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.metadata).toEqual({ tenant: "aidalinfo", userId: "42" });
    expect(body.ctx).toEqual({ traceId: "trace-123", locale: "fr-FR" });
  });

  it("resumes workflow runs", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        runId: "run-123",
        status: "success",
        steps: {},
        metadata: {},
        ctx: {},
        startedAt: now,
        finishedAt: now,
      }),
    );

    const client = new ClientKit({ baseUrl, fetch: fetchMock });

    await client.resumeWorkflow("demo", "run-123", {
      stepId: "human-step",
      data: { answer: "ok" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api/workflows/demo/runs/run-123/resume",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("raises errors when the server responds with an error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );

    const client = new ClientKit({ baseUrl, fetch: fetchMock });

    await expect(
      client.listWorkflows(),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("lists workflows", async () => {
    const workflows: WorkflowSummary[] = [
      { id: "pipeline", workflowId: "pipeline", description: "Demo" },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ workflows }),
    );

    const client = new ClientKit({ baseUrl, fetch: fetchMock });
    const result = await client.listWorkflows();

    expect(result).toEqual(workflows);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("GET");
    const headers = init?.headers as Headers;
    expect(headers.get("accept")).toBe("application/json");
  });

  it("preserves base paths when building URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ agents: [] }),
    );

    const client = new ClientKit({
      baseUrl: "https://example.com/workspace",
      fetch: fetchMock,
    });

    await client.listAgents();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/workspace/api/agents",
      expect.any(Object),
    );
  });
});
