import {
  context as otelContext,
  trace,
  type Span,
  type Context,
} from "@opentelemetry/api";

import type { WorkflowTelemetryResolvedConfig } from "../telemetry.js";

const TRACER_NAME = "@ai-kit/workflow";

function toJsonAttribute(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Ouvre le span racine nommé pour un run world.
 * Le span doit être terminé par l'appelant (via span.end()).
 * Envelopper adapter.run() dans otelContext.with(rootContext, fn) pour
 * que le SDK Vercel sérialise ce traceparent dans le run durable.
 */
export function startWorldRootSpan(
  config: WorkflowTelemetryResolvedConfig,
  input: unknown,
): { span: Span; rootContext: Context } {
  const tracer = trace.getTracer(TRACER_NAME);

  const span = tracer.startSpan(config.traceName, {
    attributes: {
      name: config.traceName,
      "ai_kit.workflow.id": config.traceName,
    },
  });

  if (config.metadata) {
    span.setAttribute("metadata", toJsonAttribute(config.metadata));
    for (const [key, val] of Object.entries(config.metadata)) {
      const safe = key.replace(/\s+/g, "_").replace(/[^\w./-]/g, "_");
      const primitive =
        typeof val === "string" || typeof val === "number" || typeof val === "boolean"
          ? val
          : toJsonAttribute(val);
      span.setAttribute(`ai_kit.workflow.metadata.${safe}`, primitive);
    }
  }

  if (config.userId) {
    span.setAttribute("langfuse.user.id", config.userId);
    span.setAttribute("user.id", config.userId);
    span.setAttribute("ai_kit.workflow.user_id", config.userId);
  }

  if (config.tags && config.tags.length > 0) {
    span.setAttribute("langfuse.trace.tags", toJsonAttribute(config.tags));
  }

  if (config.recordInputs) {
    span.setAttribute("input", toJsonAttribute(input));
  }

  const rootContext = trace.setSpan(otelContext.active(), span);

  return { span, rootContext };
}
