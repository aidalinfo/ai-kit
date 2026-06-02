import type { WorldConfig, WorldEngineAdapter } from "./contract.js";
import { buildWorldOptions, WORLD_TARGETS } from "./worlds.js";

interface SdkWorld {
  start?(): Promise<void>;
  /** Present at runtime on @workflow/world-postgres (undocumented); absent on @workflow-worlds/mongodb (lazy/no-op). */
  close?(): Promise<void>;
}

interface WorldModuleLoaders {
  postgres: () => Promise<{ createWorld: (opts: Record<string, unknown>) => SdkWorld }>;
  mongodb: () => Promise<{ createWorld: (opts: Record<string, unknown>) => SdkWorld }>;
  api: () => Promise<{
    start: (
      fn: (...args: any[]) => unknown,
      args: unknown[],
      options?: { world?: SdkWorld },
    ) => Promise<any>;
  }>;
  runtime: () => Promise<{ setWorld: (world: SdkWorld | undefined) => void }>;
}

function defaultLoaders(): WorldModuleLoaders {
  return {
    postgres: () => import(WORLD_TARGETS.postgres) as Promise<any>,
    mongodb: () => import(WORLD_TARGETS.mongodb) as Promise<any>,
    api: () => import("workflow/api") as Promise<any>,
    runtime: () => import("workflow/runtime") as Promise<any>,
  };
}

let loaders: WorldModuleLoaders = defaultLoaders();

/** @internal Test seam. Called with no argument, it resets to the default loaders. */
export function __setWorldModuleLoaders(custom?: Partial<WorldModuleLoaders>): void {
  loaders = { ...defaultLoaders(), ...custom };
}

async function loadWorldModule(config: WorldConfig) {
  const loader = config.module ?? loaders[config.type];
  try {
    return await loader();
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        `workflow-world: the world module '${WORLD_TARGETS[config.type]}' could not be loaded. ` +
          `Install it (pnpm add ${WORLD_TARGETS[config.type]}) or pass 'module' in the world config.`,
      );
    }
    throw err;
  }
}

export function createWorldAdapter(config: WorldConfig): WorldEngineAdapter {
  let world: SdkWorld | undefined;

  return {
    async start() {
      const mod = await loadWorldModule(config);
      world = mod.createWorld(buildWorldOptions(config)) as SdkWorld;
      const { setWorld } = await loaders.runtime();
      setWorld(world);
      await world.start?.();
    },

    async stop() {
      if (!world) return;
      const { setWorld } = await loaders.runtime();
      const closing = world;
      world = undefined;       // clear local ref first
      setWorld(undefined);     // release SDK injection first
      await closing.close?.(); // best-effort cleanup (may throw; injection already released)
    },

    async run(fn, args) {
      if (!world) {
        throw new Error("workflow-world: call start() before run() (the world is not initialized)");
      }
      const { start } = await loaders.api();
      return start(fn, args, { world });
    },
  };
}
