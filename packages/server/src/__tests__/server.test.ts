import { describe, expect, it, vi } from "vitest";
import type {
  Agent,
  Workflow,
  WorkflowEvent,
  WorkflowRun,
  WorkflowRunOptions,
  WorkflowRunResult,
} from "@ai_kit/core";
import { ServerKit } from "../ServerKit.js";

class StubWorkflowRun {
  readonly runId: string;
  readonly start: ReturnType<typeof vi.fn>;
  readonly stream: ReturnType<typeof vi.fn>;
  readonly resumeWithHumanInput: ReturnType<typeof vi.fn>;
  readonly cancel = vi.fn();
  lastStartOptions?: WorkflowRunOptions<unknown, Record<string, unknown>>;
  lastStreamOptions?: WorkflowRunOptions<unknown, Record<string, unknown>>;

  constructor(
    private readonly startResult: WorkflowRunResult<unknown, Record<string, unknown>>,
    private readonly events: WorkflowEvent<Record<string, unknown>>[] = [],
    private readonly streamResult: WorkflowRunResult<unknown, Record<string, unknown>> = startResult,
    private readonly resumeResult: WorkflowRunResult<unknown, Record<string, unknown>> = streamResult,
    runId = "test-run",
  ) {
    this.runId = runId;

    this.start = vi.fn(async (options: WorkflowRunOptions<unknown, Record<string, unknown>>) => {
      this.lastStartOptions = options;
      return this.startResult;
    });

    this.stream = vi.fn(async (options: WorkflowRunOptions<unknown, Record<string, unknown>>) => {
      this.lastStreamOptions = options;

      const iterator = (async function* (
        emitted: WorkflowEvent<Record<string, unknown>>[],
      ) {
        for (const event of emitted) {
          yield event;
        }
      })(this.events);

      return {
        stream: iterator,
        final: Promise.resolve(this.streamResult),
        result: Promise.resolve(this.streamResult),
      };
    });

    this.resumeWithHumanInput = vi.fn(async () => this.resumeResult);
  }
}

describe("ServerKit", () => {
  it("invokes the agent generate endpoint", async () => {
    const agent = {
      generate: vi.fn(async () => ({ message: "ok" })),
      stream: vi.fn(),
    } as unknown as Agent;

    const server = new ServerKit({ agents: { demo: agent } });

    const response = await server.app.request("/api/agents/demo/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Hello" }),
    });

    expect(response.status).toBe(200);
    expect(agent.generate).toHaveBeenCalledWith({ prompt: "Hello" });
    await expect(response.json()).resolves.toEqual({ message: "ok" });
  });

  it("lists registered agents", async () => {
    const agent = {
      name: "Demo Agent",
      instructions: "Be helpful",
      generate: vi.fn(),
      stream: vi.fn(),
    } as unknown as Agent;

    const server = new ServerKit({ agents: { demo: agent } });

    const response = await server.app.request("/api/agents");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      agents: [
        {
          id: "demo",
          name: "Demo Agent",
          instructions: "Be helpful",
        },
      ],
    });
  });

  it("returns 404 for unknown workflows", async () => {
    const server = new ServerKit();

    const response = await server.app.request("/api/workflows/missing/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputData: {} }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Workflow missing not found" });
  });

  it("runs a workflow and returns the run id", async () => {
    const result: WorkflowRunResult<unknown, Record<string, unknown>> = {
      status: "success",
      result: { output: "done" },
      steps: {},
      metadata: {},
      startedAt: new Date(),
      finishedAt: new Date(),
    };

    const run = new StubWorkflowRun(result, [], result);
    const workflow = {
      id: "demo",
      createRun: vi.fn(() => run as unknown as WorkflowRun<any, any, Record<string, unknown>>),
    } as unknown as Workflow<any, any, Record<string, unknown>>;

    const server = new ServerKit({ workflows: { demo: workflow } });

    const response = await server.app.request("/api/workflows/demo/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputData: { foo: "bar" } }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      runId: "test-run",
      status: "success",
      result: { output: "done" },
    });

    expect(run.start).toHaveBeenCalled();
    expect(run.lastStartOptions?.inputData).toEqual({ foo: "bar" });
  });

  it("lists registered workflows", async () => {
    const workflow = {
      id: "workflow-demo",
      description: "Demo workflow",
      createRun: vi.fn(),
    } as unknown as Workflow<any, any, Record<string, unknown>>;

    const server = new ServerKit({ workflows: { demo: workflow } });

    const response = await server.app.request("/api/workflows");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      workflows: [
        {
          id: "demo",
          workflowId: "workflow-demo",
          description: "Demo workflow",
        },
      ],
    });
  });

  it("streams workflow events and final result", async () => {
    const baseResult: WorkflowRunResult<unknown, Record<string, unknown>> = {
      status: "success",
      result: { output: "stream" },
      steps: {},
      metadata: {},
      startedAt: new Date(),
      finishedAt: new Date(),
    };

    const events: WorkflowEvent<Record<string, unknown>>[] = [
      {
        type: "workflow:start",
        workflowId: "demo",
        runId: "stream-run",
        metadata: {},
        timestamp: Date.now(),
      },
    ];

    const run = new StubWorkflowRun(baseResult, events, baseResult, baseResult, "stream-run");
    const workflow = {
      id: "demo",
      createRun: vi.fn(() => run as unknown as WorkflowRun<any, any, Record<string, unknown>>),
    } as unknown as Workflow<any, any, Record<string, unknown>>;

    const server = new ServerKit({ workflows: { demo: workflow } });

    const response = await server.app.request("/api/workflows/demo/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputData: { foo: "bar" } }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const payload = await response.text();

    expect(payload).toContain('event: run');
    expect(payload).toContain('"runId":"stream-run"');
    expect(payload).toContain('event: workflow:start');
    expect(payload).toContain('event: result');
    expect(payload).toContain('"output":"stream"');
  });

  it("runs global middleware before routes", async () => {
    const middleware = vi.fn(async (_c, next) => {
      await next();
    });

    const server = new ServerKit({ server: { middleware: [middleware] } });

    const response = await server.app.request("/api/agents");

    expect(response.status).toBe(200);
    expect(middleware).toHaveBeenCalledTimes(1);
  });

  it("supports legacy middleware option but warns", async () => {
    const middleware = vi.fn(async (_c, next) => {
      await next();
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const server = new ServerKit({ middleware: [middleware] });

    const response = await server.app.request("/api/agents");

    expect(response.status).toBe(200);
    expect(middleware).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "ServerKitConfig.middleware is deprecated. Use server.middleware instead.",
    );

    warnSpy.mockRestore();
  });

  it("supports path-scoped middleware objects", async () => {
    const secureMiddleware = vi.fn(async (c, next) => {
      if (!c.req.header("x-auth")) {
        return c.json({ error: "unauthorized" }, 401);
      }

      await next();
    });

    const server = new ServerKit({
      server: { middleware: [{ path: "/secure/*", handler: secureMiddleware }] },
    });

    server.app.get("/secure/ping", c => c.json({ ok: true }));

    const unauthorized = await server.app.request("/secure/ping");
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({ error: "unauthorized" });

    const authorized = await server.app.request("/secure/ping", {
      headers: { "x-auth": "token" },
    });

    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toEqual({ ok: true });

    await server.app.request("/api/agents");
    expect(secureMiddleware).toHaveBeenCalledTimes(2);
  });

  it("resumes a waiting workflow run", async () => {
    const waitingResult: WorkflowRunResult<unknown, Record<string, unknown>> = {
      status: "waiting_human",
      steps: {},
      metadata: {},
      startedAt: new Date(),
      finishedAt: new Date(),
      pendingHuman: {
        runId: "resume-run",
        workflowId: "demo",
        stepId: "human-step",
        output: { question: "hi" },
        form: { fields: [] },
        requestedAt: new Date(),
      },
    };

    const resumedResult: WorkflowRunResult<unknown, Record<string, unknown>> = {
      status: "success",
      result: { output: "resumed" },
      steps: {},
      metadata: {},
      startedAt: new Date(),
      finishedAt: new Date(),
    };

    const run = new StubWorkflowRun(waitingResult, [], waitingResult, resumedResult, "resume-run");
    const workflow = {
      id: "demo",
      createRun: vi.fn(() => run as unknown as WorkflowRun<any, any, Record<string, unknown>>),
    } as unknown as Workflow<any, any, Record<string, unknown>>;

    const server = new ServerKit({ workflows: { demo: workflow } });

    const runResponse = await server.app.request("/api/workflows/demo/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputData: { question: "hi" } }),
    });

    expect(runResponse.status).toBe(200);
    await expect(runResponse.json()).resolves.toMatchObject({ status: "waiting_human" });

    const resumeResponse = await server.app.request(
      "/api/workflows/demo/runs/resume-run/resume",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stepId: "human-step", data: { answer: "42" } }),
      },
    );

    expect(resumeResponse.status).toBe(200);
    expect(run.resumeWithHumanInput).toHaveBeenCalledWith({
      runId: "resume-run",
      stepId: "human-step",
      data: { answer: "42" },
    });
    await expect(resumeResponse.json()).resolves.toMatchObject({
      runId: "resume-run",
      status: "success",
      result: { output: "resumed" },
    });
  });

  it("serves swagger spec and ui when enabled", async () => {
    const server = new ServerKit();

    const specResponse = await server.app.request("/swagger.json");
    expect(specResponse.status).toBe(200);
    await expect(specResponse.json()).resolves.toMatchObject({
      openapi: "3.0.3",
      info: expect.objectContaining({ title: "AI Kit API" }),
      paths: expect.objectContaining({
        "/api/agents": expect.any(Object),
        "/api/agents/{id}/generate": expect.any(Object),
        "/api/workflows": expect.any(Object),
      }),
    });

    const uiResponse = await server.app.request("/swagger");
    expect(uiResponse.status).toBe(200);
    await expect(uiResponse.text()).resolves.toContain("SwaggerUI");
  });

  it("disables swagger in production by default but allows overrides", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const disabledServer = new ServerKit();
      const disabledResponse = await disabledServer.app.request("/swagger.json");
      expect(disabledResponse.status).toBe(404);

      const forcedServer = new ServerKit({ swagger: true });
      const forcedResponse = await forcedServer.app.request("/swagger.json");
      expect(forcedResponse.status).toBe(200);
    } finally {
      if (typeof originalEnv === "string") {
        process.env.NODE_ENV = originalEnv;
      } else {
        delete process.env.NODE_ENV;
      }
    }
  });
});
