import type { Workflow } from "../workflow.js";
import type { WorkflowRunOptions, WorkflowRunResult } from "../types.js";
import type {
  WorkflowEngine,
  WorkflowKitOptions,
  WorldConfig,
  WorldEngineAdapter,
  WorkflowWorldModule,
  WorldRunHandle,
  WorkflowRunDispatchOptions,
} from "./types.js";

const VALID_WORLD_TYPES = ["postgres", "mongodb"] as const;

// `: string` (not a literal) so tsc does NOT statically resolve the optional
// package; resolved at runtime by Node, or swapped by the test seam below.
const WORLD_PACKAGE: string = "@ai_kit/workflow-world";

type WorldModuleLoader = () => Promise<WorkflowWorldModule>;

let worldModuleLoader: WorldModuleLoader = () =>
  import(WORLD_PACKAGE) as Promise<WorkflowWorldModule>;

/** @internal Test seam. No argument resets to the default dynamic import. */
export function __setWorkflowWorldLoader(loader?: WorldModuleLoader): void {
  worldModuleLoader = loader ?? (() => import(WORLD_PACKAGE) as Promise<WorkflowWorldModule>);
}

export class WorkflowKit {
  readonly engine: WorkflowEngine;
  readonly world?: WorldConfig;
  #adapter?: WorldEngineAdapter;

  constructor(options: WorkflowKitOptions = {}) {
    this.engine = options.engine ?? "legacy";
    this.world = options.world;

    if (this.engine === "world" && !this.world) {
      throw new Error("WorkflowKit: engine 'world' requires a 'world' config");
    }
    if (this.world && !VALID_WORLD_TYPES.includes(this.world.type)) {
      throw new Error(`WorkflowKit: unsupported world type '${this.world.type}'`);
    }
  }

  async start(): Promise<void> {
    if (this.engine !== "world") return;
    const adapter = await this.#ensureAdapter();
    await adapter.start();
  }

  async stop(): Promise<void> {
    if (this.engine !== "world" || !this.#adapter) return;
    await this.#adapter.stop();
  }

  // Overload: legacy engine
  run<Output>(
    workflow: Workflow<any, Output, any, any>,
    options: WorkflowRunOptions<any, any, any>,
    dispatch?: WorkflowRunDispatchOptions,
  ): Promise<WorkflowRunResult<Output, any, any>>;
  // Overload: world engine
  run(
    workflow: (...args: any[]) => unknown,
    args: unknown[],
    dispatch?: WorkflowRunDispatchOptions,
  ): Promise<WorldRunHandle>;
  // Implementation
  async run(workflow: any, input: any, dispatch?: WorkflowRunDispatchOptions): Promise<unknown> {
    const engine = dispatch?.engine ?? this.engine;
    if (engine === "legacy") {
      return (workflow as Workflow<any, any, any, any>).run(input);
    }
    const adapter = await this.#ensureAdapter();
    return adapter.run(workflow, input as unknown[]);
  }

  async #ensureAdapter(): Promise<WorldEngineAdapter> {
    if (this.#adapter) return this.#adapter;
    if (!this.world) {
      throw new Error("WorkflowKit: engine 'world' requires a 'world' config");
    }
    let mod: WorkflowWorldModule;
    try {
      mod = await worldModuleLoader();
    } catch {
      throw new Error(
        "WorkflowKit: engine 'world' requires the '@ai_kit/workflow-world' package. " +
          "Install it: pnpm add @ai_kit/workflow-world",
      );
    }
    this.#adapter = mod.createWorldAdapter(this.world);
    return this.#adapter;
  }
}
