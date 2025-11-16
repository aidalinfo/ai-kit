import type {
  ApiRouteConfig,
  ApiRouteDefinition,
  ApiRouteMethod,
  ServerKitConfig,
} from "./types.js";
import { ensureLeadingSlash } from "./swaggerOptions.js";
import { SUPPORTED_HTTP_METHODS } from "./constants.js";

export function registerApiRoute(
  path: string,
  config: ApiRouteConfig,
): ApiRouteDefinition {
  const route: ApiRouteDefinition = {
    path,
    method: normalizeApiRouteMethod(config.method),
    handler: config.handler,
    middleware: config.middleware,
  };

  return normalizeApiRoute(route);
}

export function resolveApiRouteEntries(config: ServerKitConfig) {
  const routes = config.server?.apiRoutes ?? [];
  return routes.map(normalizeApiRoute);
}

function normalizeApiRoute(route: ApiRouteDefinition): ApiRouteDefinition {
  if (typeof route.path !== "string") {
    throw new Error("API route path must be a string.");
  }

  if (typeof route.handler !== "function") {
    throw new Error("API route handler must be a function.");
  }

  const path = ensureLeadingSlash(route.path.trim());
  const method = normalizeApiRouteMethod(route.method);

  const middleware = route.middleware?.map((entry, index) => {
    if (typeof entry !== "function") {
      throw new Error(
        `API route middleware at index ${index} for ${path} must be a function.`,
      );
    }

    return entry;
  });

  return {
    path,
    method,
    handler: route.handler,
    middleware,
  };
}

export function normalizeApiRouteMethod(
  method?: ApiRouteMethod | Lowercase<ApiRouteMethod>,
): ApiRouteMethod {
  if (!method) {
    return "GET";
  }

  const candidate = method.toUpperCase();

  if (!isSupportedHttpMethod(candidate)) {
    throw new Error(`Unsupported HTTP method for API route: ${method}`);
  }

  return candidate as ApiRouteMethod;
}

function isSupportedHttpMethod(value: string): value is ApiRouteMethod {
  return (SUPPORTED_HTTP_METHODS as readonly string[]).includes(value);
}

