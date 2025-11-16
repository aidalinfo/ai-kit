import { HTTPException } from "hono/http-exception";

export const invalidAgentPayload = new HTTPException(400, {
  message: "Agent request payload must include either prompt or messages",
});

export function normalizeError(error: unknown) {
  if (error instanceof HTTPException) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : "Internal Server Error";

  return new HTTPException(500, { message });
}

export function ensureAgentPayload(payload: Record<string, unknown>) {
  if (!("prompt" in payload) && !("messages" in payload)) {
    throw invalidAgentPayload;
  }
}

