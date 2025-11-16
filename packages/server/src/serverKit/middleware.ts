import type {
  ServerKitConfig,
  ServerMiddleware,
  ServerMiddlewareConfig,
} from "./types.js";

export function normalizeMiddleware(entry: ServerMiddleware): ServerMiddlewareConfig {
  if (typeof entry === "function") {
    return { handler: entry };
  }

  if (entry.path !== undefined && typeof entry.path !== "string") {
    throw new Error("Server middleware path must be a string.");
  }

  return entry;
}

export function resolveMiddlewareEntries(config: ServerKitConfig) {
  const legacy = config.middleware ?? [];
  const nested = config.server?.middleware ?? [];

  if (legacy.length && !config.server?.middleware?.length) {
    console.warn(
      "ServerKitConfig.middleware is deprecated. Use server.middleware instead.",
    );
  }

  return [...legacy, ...nested];
}

