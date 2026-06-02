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

/** Statut d'un run world (SDK Vercel). */
export type WorldRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Handle d'un run "world" (pass-through du `Run` du SDK Vercel).
 *
 * `returnValue` poll jusqu'à la complétion du run : il **résout** avec la sortie
 * du workflow, ou **rejette** (`WorkflowRunFailedError` / `WorkflowRunCancelledError`)
 * si le run échoue ou est annulé.
 */
export interface WorldRunHandle<TResult = unknown> {
  /** Identifiant du run durable. */
  runId: string;
  /** Sortie du run : attend la complétion ; rejette en cas d'échec/annulation. */
  readonly returnValue: Promise<TResult>;
  /** Statut courant du run. */
  readonly status: Promise<WorldRunStatus>;
  /** Le run existe-t-il dans le world. */
  readonly exists: Promise<boolean>;
  /** Annule le run. */
  cancel(): Promise<void>;
  /** Pass-through : autres membres du `Run` SDK (wakeUp, getReadable, timestamps…) disponibles au runtime. */
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
