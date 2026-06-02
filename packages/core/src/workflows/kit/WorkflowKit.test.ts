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
