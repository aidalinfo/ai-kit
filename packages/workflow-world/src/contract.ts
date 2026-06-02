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
  /**
   * Loader du module world fourni par l'app hôte, sous forme de littéral
   * (`() => import('@workflow/world-postgres')`). Quand présent, il remplace
   * l'import dynamique interne : le littéral vit dans le code tracé de l'app,
   * donc le bundler (nft) inclut le package dans `.output`. Doit exposer `createWorld`.
   */
  module?: () => Promise<{ createWorld: (opts: Record<string, unknown>) => unknown }>;
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
 * `returnValue` résout avec la sortie, ou rejette si le run échoue/est annulé.
 */
export interface WorldRunHandle<TResult = unknown> {
  runId: string;
  readonly returnValue: Promise<TResult>;
  readonly status: Promise<WorldRunStatus>;
  readonly exists: Promise<boolean>;
  cancel(): Promise<void>;
  [key: string]: unknown;
}

/** Contrat consommé par `WorkflowKit`. */
export interface WorldEngineAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  run(workflow: (...args: any[]) => unknown, args: unknown[]): Promise<WorldRunHandle>;
}
