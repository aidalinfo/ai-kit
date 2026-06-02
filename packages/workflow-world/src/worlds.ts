import type { WorldConfig } from "@ai_kit/core";

export const WORLD_TARGETS = {
  postgres: "@workflow/world-postgres",
  mongodb: "@workflow-worlds/mongodb",
} as const;

/**
 * Construit l'objet d'options passé à `createWorld(...)` du SDK Vercel, selon le type.
 * Pas de mutation d'env : on injecte le world programmatiquement (cf. adapter).
 */
export function buildWorldOptions(config: WorldConfig): Record<string, unknown> {
  if (!config.url) {
    throw new Error("workflow-world: 'url' is required in WorldConfig");
  }
  if (!(config.type in WORLD_TARGETS)) {
    throw new Error(`workflow-world: unsupported world type '${config.type}'`);
  }

  if (config.type === "postgres") {
    const opts: Record<string, unknown> = { connectionString: config.url };
    if (config.jobPrefix) opts.jobPrefix = config.jobPrefix;
    if (config.workerConcurrency != null) opts.queueConcurrency = config.workerConcurrency;
    if (config.maxPoolSize != null) opts.maxPoolSize = config.maxPoolSize;
    return opts;
  }

  // mongodb
  return { mongoUrl: config.url };
}
