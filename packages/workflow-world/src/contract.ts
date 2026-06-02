/**
 * Contrat partagé avec la façade `WorkflowKit` de `@ai_kit/core`.
 *
 * Défini LOCALEMENT (et non importé de `@ai_kit/core`) pour que ce package
 * compile de façon autonome, sans dépendance de build inter-packages.
 * Les formes sont structurellement identiques à
 * `packages/core/src/workflows/kit/types.ts` → compatibilité au runtime quand
 * core charge ce module dynamiquement (via son loader de world).
 */

export type WorldType = "postgres" | "mongodb";

export interface WorldConfig {
  type: WorldType;
  /** Connection string (postgres:// ou mongodb://). */
  url: string;
  /** Postgres : namespacing des jobs si DB partagée. */
  jobPrefix?: string;
  /** Postgres : nombre de workers concurrents. */
  workerConcurrency?: number;
  /** Postgres : taille du pool de connexions. */
  maxPoolSize?: number;
}

/** Handle opaque renvoyé par le moteur world (pass-through du SDK Vercel). */
export interface WorldRunHandle {
  runId?: string;
  [key: string]: unknown;
}

/** Contrat consommé par `WorkflowKit`. */
export interface WorldEngineAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  run(workflow: (...args: any[]) => unknown, args: unknown[]): Promise<WorldRunHandle>;
}
