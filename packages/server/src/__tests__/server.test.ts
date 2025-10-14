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
});
