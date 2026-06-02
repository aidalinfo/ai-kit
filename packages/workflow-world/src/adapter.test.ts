import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorldAdapter, __setWorldModuleLoaders } from "./adapter.js";

afterEach(() => __setWorldModuleLoaders());

function mockPostgres() {
  const start = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const world = { start, close };
  const createWorld = vi.fn(() => world);
  const setWorld = vi.fn();
  const startRun = vi.fn().mockResolvedValue({ runId: "r_1" });
  __setWorldModuleLoaders({
    postgres: async () => ({ createWorld }),
    runtime: async () => ({ setWorld }),
    api: async () => ({ start: startRun }),
  });
  return { createWorld, world, start, close, setWorld, startRun };
}

describe("createWorldAdapter (postgres)", () => {
  it("start: crée le world avec les options mappées, l'injecte et démarre le worker", async () => {
    const m = mockPostgres();
    const adapter = createWorldAdapter({
      type: "postgres",
      url: "postgres://u:p@h:5432/db",
      jobPrefix: "wf__",
      workerConcurrency: 5,
    });
    await adapter.start();
    expect(m.createWorld).toHaveBeenCalledWith({
      connectionString: "postgres://u:p@h:5432/db",
      jobPrefix: "wf__",
      queueConcurrency: 5,
    });
    expect(m.setWorld).toHaveBeenCalledWith(m.world);
    expect(m.start).toHaveBeenCalledTimes(1);
  });

  it("run: délègue à start() du SDK en passant l'instance world", async () => {
    const m = mockPostgres();
    const adapter = createWorldAdapter({ type: "postgres", url: "postgres://x" });
    await adapter.start();
    const fn = async () => 1;
    const handle = await adapter.run(fn, ["a"]);
    expect(m.startRun).toHaveBeenCalledWith(fn, ["a"], { world: m.world });
    expect(handle).toEqual({ runId: "r_1" });
  });

  it("stop: ferme le world et réinitialise l'injection", async () => {
    const m = mockPostgres();
    const adapter = createWorldAdapter({ type: "postgres", url: "postgres://x" });
    await adapter.start();
    await adapter.stop();
    expect(m.close).toHaveBeenCalledTimes(1);
    expect(m.setWorld).toHaveBeenLastCalledWith(undefined);
  });

  it("erreur claire si le package world manque", async () => {
    __setWorldModuleLoaders({
      postgres: async () => {
        const e = new Error("nf") as Error & { code?: string };
        e.code = "ERR_MODULE_NOT_FOUND";
        throw e;
      },
    });
    const adapter = createWorldAdapter({ type: "postgres", url: "postgres://x" });
    await expect(adapter.start()).rejects.toThrow("@workflow/world-postgres");
  });

  it("stop avant start: ne throw pas", async () => {
    const adapter = createWorldAdapter({ type: "postgres", url: "postgres://x" });
    await expect(adapter.stop()).resolves.toBeUndefined();
  });

  it("run avant start: throw une erreur claire", async () => {
    const adapter = createWorldAdapter({ type: "postgres", url: "postgres://x" });
    await expect(adapter.run(async () => 1, [])).rejects.toThrow(/start\(\) before run\(\)/);
  });
});

describe("createWorldAdapter (mongodb)", () => {
  it("start: world Mongo sans start() ne throw pas (connexion lazy)", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const world = { close }; // pas de start()
    const createWorld = vi.fn(() => world);
    const setWorld = vi.fn();
    __setWorldModuleLoaders({
      mongodb: async () => ({ createWorld }),
      runtime: async () => ({ setWorld }),
    });
    const adapter = createWorldAdapter({ type: "mongodb", url: "mongodb://h:27017/db" });
    await expect(adapter.start()).resolves.toBeUndefined();
    expect(createWorld).toHaveBeenCalledWith({ mongoUrl: "mongodb://h:27017/db" });
    expect(setWorld).toHaveBeenCalledWith(world);
  });
});
