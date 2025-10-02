import { WorkflowAbortError } from "../errors.js";

export const createRunId = () => `run_${Math.random().toString(36).slice(2, 10)}`;

export const cloneMetadata = <Meta extends Record<string, unknown>>(metadata?: Meta): Meta => {
  if (metadata === undefined) {
    return {} as Meta;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(metadata);
  }

  return JSON.parse(JSON.stringify(metadata));
};

export const mergeSignals = (signals: AbortSignal[]): AbortSignal => {
  if (signals.length === 0) {
    return new AbortController().signal;
  }

  if (signals.length === 1) {
    return signals[0];
  }

  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; handler: () => void }> = [];

  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  const cleanup = () => {
    for (const { signal, handler } of listeners) {
      signal.removeEventListener("abort", handler);
    }
    listeners.length = 0;
  };

  for (const signal of signals) {
    if (signal.aborted) {
      abort(signal.reason ?? new WorkflowAbortError());
      cleanup();
      break;
    }

    const handler = () => {
      abort(signal.reason ?? new WorkflowAbortError());
      cleanup();
    };

    signal.addEventListener("abort", handler, { once: true });
    listeners.push({ signal, handler });
  }

  controller.signal.addEventListener("abort", cleanup, { once: true });

  return controller.signal;
};
