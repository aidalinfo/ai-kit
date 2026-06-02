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
    if (options.adapter) this.#adapter = options.adapter;

    if (this.engine === "world" && !this.world && !this.#adapter) {
      throw new Error(
        "WorkflowKit: engine 'world' requires a 'world' config or an 'adapter'",
      );
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
  run<TResult = unknown>(
    workflow: (...args: any[]) => TResult | Promise<TResult>,
    args: unknown[],
    dispatch?: WorkflowRunDispatchOptions,
  ): Promise<WorldRunHandle<TResult>>;
  // Implementation
  async run(workflow: any, input: any, dispatch?: WorkflowRunDispatchOptions): Promise<unknown> {
    const engine = dispatch?.engine ?? this.engine;
    if (engine === "legacy") {
      return (workflow as Workflow<any, any, any, any>).run(input);
    }
    const adapter = await this.#ensureAdapter();
    return adapter.run(workflow, input as unknown[]);
  }

  // Overload: legacy engine — returns the workflow output, throws on non-success
  runAndWait<Output>(
    workflow: Workflow<any, Output, any, any>,
    options: WorkflowRunOptions<any, any, any>,
    dispatch?: WorkflowRunDispatchOptions,
  ): Promise<Output>;
  // Overload: world engine — awaits the durable run, returns its return value
  runAndWait<TResult = unknown>(
    workflow: (...args: any[]) => TResult | Promise<TResult>,
    args: unknown[],
    dispatch?: WorkflowRunDispatchOptions,
  ): Promise<TResult>;
  /**
   * Runs a workflow and resolves with its output (synchronous-style), regardless
   * of engine. Throws if the run does not succeed:
   * - legacy: throws when the result status is not "success" (with the run error);
   * - world: rejects via the SDK (`WorkflowRunFailedError` / `WorkflowRunCancelledError`).
   */
  async runAndWait(
    workflow: any,
    input: any,
    dispatch?: WorkflowRunDispatchOptions,
  ): Promise<unknown> {
    const engine = dispatch?.engine ?? this.engine;
    if (engine === "legacy") {
      const result = await (workflow as Workflow<any, any, any, any>).run(input);
      if (result.status !== "success") {
        if (result.error instanceof Error) throw result.error;
        throw new Error(
          `WorkflowKit: workflow run finished with status '${result.status}'`,
        );
      }
      return result.result;
    }
    const adapter = await this.#ensureAdapter();
    const handle = await adapter.run(workflow, input as unknown[]);
    return handle.returnValue;
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
