import type { Workflow } from "../workflow.js";
import type { WorkflowRunOptions, WorkflowRunResult } from "../types.js";

export type WorkflowEngine = "legacy" | "world";

export interface WorldConfig {
  type: "postgres" | "mongodb";
  /** Connection string (postgres:// ou mongodb://). */
  url: string;
  /** Postgres : namespacing des jobs si DB partagée. */
  jobPrefix?: string;
  /** Postgres : nombre de workers concurrents. */
  workerConcurrency?: number;
  /** Postgres : taille du pool de connexions. */
  maxPoolSize?: number;
}

export interface WorkflowKitOptions {
  /** Moteur par défaut. Défaut : "legacy". */
  engine?: WorkflowEngine;
  /** Config du world. Requis si engine === "world". */
  world?: WorldConfig;
}

/** Handle opaque renvoyé par le moteur world (pass-through du SDK Vercel). */
export interface WorldRunHandle {
  runId?: string;
  [key: string]: unknown;
}

/** Contrat implémenté par @ai_kit/workflow-world. Défini ici pour découpler core du SDK. */
export interface WorldEngineAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  run(workflow: (...args: any[]) => unknown, args: unknown[]): Promise<WorldRunHandle>;
}

/** Forme du module @ai_kit/workflow-world chargé dynamiquement. */
export interface WorkflowWorldModule {
  createWorldAdapter(config: WorldConfig): WorldEngineAdapter;
}

/** Options par appel de WorkflowKit.run. */
export interface WorkflowRunDispatchOptions {
  engine?: WorkflowEngine;
}

export type { Workflow, WorkflowRunOptions, WorkflowRunResult };
