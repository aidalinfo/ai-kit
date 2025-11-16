import type {
  ServerKitConfig,
  SwaggerOptions,
} from "./types.js";
import {
  DEFAULT_SWAGGER_ROUTE,
  DEFAULT_SWAGGER_TITLE,
  packageVersion,
} from "./constants.js";

export interface NormalizedSwaggerOptions {
  enabled: boolean;
  uiPath: string;
  jsonPath: string;
  title: string;
  version: string;
  description?: string;
}

export function resolveSwaggerOptions(
  value: ServerKitConfig["swagger"],
): NormalizedSwaggerOptions {
  const defaultEnabled = process.env.NODE_ENV !== "production";
  const asOptions =
    typeof value === "object" && value !== null
      ? (value as SwaggerOptions)
      : undefined;

  const uiPath = normalizeRoute(asOptions?.route);
  const jsonPath = deriveJsonPath(uiPath);

  return {
    enabled:
      typeof value === "boolean"
        ? value
        : asOptions?.enabled ?? defaultEnabled,
    uiPath,
    jsonPath,
    title: asOptions?.title ?? DEFAULT_SWAGGER_TITLE,
    version: asOptions?.version ?? packageVersion,
    description: asOptions?.description,
  };
}

export function normalizeRoute(route?: string) {
  const target = route?.trim() || DEFAULT_SWAGGER_ROUTE;
  const withSlash = ensureLeadingSlash(target);

  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.replace(/\/+$/, "");
  }

  return withSlash || DEFAULT_SWAGGER_ROUTE;
}

export function ensureLeadingSlash(route: string) {
  return route.startsWith("/") ? route : `/${route}`;
}

export function deriveJsonPath(uiPath: string) {
  if (uiPath.endsWith(".json")) {
    return uiPath;
  }

  return `${uiPath}.json`;
}

