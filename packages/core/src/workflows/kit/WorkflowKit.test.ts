import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowKit, __setWorkflowWorldLoader } from "./WorkflowKit.js";

afterEach(() => __setWorkflowWorldLoader());

describe("WorkflowKit — config", () => {
  it("défaut = engine legacy", () => {
    expect(new WorkflowKit().engine).toBe("legacy");
  });

  it("engine 'world' sans config world → throw", () => {
    expect(() => new WorkflowKit({ engine: "world" })).toThrow(/world/i);
  });

  it("type de world inconnu → throw", () => {
    // @ts-expect-error test runtime
    expect(() => new WorkflowKit({ engine: "world", world: { type: "redis", url: "x" } })).toThrow();
  });

  it("start/stop sont no-op en legacy", async () => {
    const kit = new WorkflowKit();
    await expect(kit.start()).resolves.toBeUndefined();
    await expect(kit.stop()).resolves.toBeUndefined();
  });
});

describe("WorkflowKit — dispatch run", () => {
  it("legacy : délègue à Workflow.run", async () => {
    const fakeWorkflow = { run: vi.fn().mockResolvedValue({ status: "success" }) };
    const kit = new WorkflowKit();
    const res = await kit.run(fakeWorkflow as any, { inputData: { id: 1 } });
    expect(fakeWorkflow.run).toHaveBeenCalledWith({ inputData: { id: 1 } });
    expect(res).toEqual({ status: "success" });
  });

  it("world : start/run/stop délèguent à l'adapter chargé via le seam", async () => {
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue({ runId: "r_9" }),
    };
    const createWorldAdapter = vi.fn(() => adapter);
    __setWorkflowWorldLoader(async () => ({ createWorldAdapter }));

    const kit = new WorkflowKit({ engine: "world", world: { type: "postgres", url: "postgres://x" } });
    await kit.start();
    expect(createWorldAdapter).toHaveBeenCalledWith({ type: "postgres", url: "postgres://x" });
    expect(adapter.start).toHaveBeenCalledTimes(1);

    const fn = async () => 1;
    const handle = await kit.run(fn, ["a"]);
    expect(adapter.run).toHaveBeenCalledWith(fn, ["a"]);
    expect(handle).toEqual({ runId: "r_9" });

    await kit.stop();
    expect(adapter.stop).toHaveBeenCalledTimes(1);
  });

  it("world : erreur claire si le package @ai_kit/workflow-world manque", async () => {
    __setWorkflowWorldLoader(async () => {
      throw new Error("not found");
    });
    const kit = new WorkflowKit({ engine: "world", world: { type: "postgres", url: "postgres://x" } });
    await expect(kit.start()).rejects.toThrow("@ai_kit/workflow-world");
  });
});

describe("WorkflowKit — runAndWait", () => {
  function worldKitWith(handle: Record<string, unknown>) {
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(handle),
    };
    __setWorkflowWorldLoader(async () => ({ createWorldAdapter: () => adapter }));
    return new WorkflowKit({ engine: "world", world: { type: "postgres", url: "postgres://x" } });
  }

  it("world : résout avec returnValue du run", async () => {
    const kit = worldKitWith({
      runId: "r_1",
      returnValue: Promise.resolve({ ok: true }),
      status: Promise.resolve("completed"),
      exists: Promise.resolve(true),
      cancel: vi.fn(),
    });
    const out = await kit.runAndWait(async () => ({ ok: true }), ["a"]);
    expect(out).toEqual({ ok: true });
  });

  it("world : propage le rejet de returnValue (échec du run)", async () => {
    const kit = worldKitWith({
      runId: "r_2",
      // getter : crée la promesse rejetée seulement quand runAndWait la lit (pas d'unhandled rejection)
      get returnValue() {
        return Promise.reject(new Error("workflow failed"));
      },
      status: Promise.resolve("failed"),
      exists: Promise.resolve(true),
      cancel: vi.fn(),
    });
    await expect(kit.runAndWait(async () => 1, ["a"])).rejects.toThrow("workflow failed");
  });

  it("legacy : résout avec result.result quand status=success", async () => {
    const fakeWorkflow = {
      run: vi.fn().mockResolvedValue({ status: "success", result: { total: 42 } }),
    };
    const kit = new WorkflowKit();
    const out = await kit.runAndWait(fakeWorkflow as any, { inputData: {} });
    expect(out).toEqual({ total: 42 });
  });

  it("legacy : throw quand status != success", async () => {
    const fakeWorkflow = {
      run: vi.fn().mockResolvedValue({ status: "failed", error: new Error("boom") }),
    };
    const kit = new WorkflowKit();
    await expect(kit.runAndWait(fakeWorkflow as any, { inputData: {} })).rejects.toThrow("boom");
  });
});
