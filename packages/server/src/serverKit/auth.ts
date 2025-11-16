import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { jwtVerify } from "jose";
import type { ServerAuthConfig } from "./types.js";

export type NormalizedAuthOptions =
  | { enabled: false }
  | { enabled: true; secret: string };

export function resolveAuthOptions(
  auth?: ServerAuthConfig,
): NormalizedAuthOptions {
  if (!auth) {
    return { enabled: false };
  }

  const enabled = auth.enabled ?? true;

  if (!enabled) {
    return { enabled: false };
  }

  if (typeof auth.secret !== "string" || auth.secret.trim().length === 0) {
    throw new Error(
      "Server auth is enabled but no secret provided. Set server.auth.secret to a non-empty string.",
    );
  }

  const secret = auth.secret.trim();

  return { enabled: true, secret };
}

export function createAuthMiddleware(
  options: Extract<NormalizedAuthOptions, { enabled: true }>,
) {
  const secretKey = new TextEncoder().encode(options.secret);

  return (async (c, next) => {
    const header = c.req.header("authorization");

    if (!header) {
      throw new HTTPException(401, { message: "Missing Authorization header" });
    }

    const token = extractBearerToken(header);

    if (!token) {
      throw new HTTPException(401, {
        message: "Authorization header must use the Bearer scheme",
      });
    }

    try {
      const { payload } = await jwtVerify(token, secretKey);
      c.set("auth", { token, payload });
    } catch (error) {
      console.error("Failed to verify authorization token", error);
      throw new HTTPException(401, { message: "Invalid authorization token" });
    }

    await next();
  }) satisfies MiddlewareHandler;
}

export function extractBearerToken(header: string) {
  const [scheme, ...rest] = header.split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer") {
    return undefined;
  }

  const token = rest.join(" ").trim();
  return token.length > 0 ? token : undefined;
}

