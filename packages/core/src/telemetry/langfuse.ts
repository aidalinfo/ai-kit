export type ShouldExportSpan = (input: unknown) => boolean;

interface LangfuseSpanProcessorLike {
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

interface LangfuseSpanProcessorConstructor {
  new (options: {
    publicKey: string;
    secretKey: string;
    baseUrl?: string;
    shouldExportSpan?: ShouldExportSpan;
  }): LangfuseSpanProcessorLike;
}

interface NodeTracerProviderLike {
  addSpanProcessor(processor: LangfuseSpanProcessorLike): void;
  register(): void;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

interface NodeTracerProviderConstructor {
  new (options?: Record<string, unknown>): NodeTracerProviderLike;
}

export interface LangfuseTelemetryConfig {
  shouldExportSpan?: ShouldExportSpan;
  autoFlush?: "process" | "request" | false;
}

export interface LangfuseTelemetryHandle {
  processor: LangfuseSpanProcessorLike;
  provider: NodeTracerProviderLike;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

interface LangfuseGlobalState {
  handle?: LangfuseTelemetryHandle;
  initializing?: Promise<LangfuseTelemetryHandle>;
}

const GLOBAL_KEY = Symbol.for("ai-kit.langfuse.telemetry");

type GlobalWithLangfuseState = typeof globalThis & {
  [GLOBAL_KEY]?: LangfuseGlobalState;
};

function getGlobalState(): LangfuseGlobalState {
  const globalObject = globalThis as GlobalWithLangfuseState;
  if (!globalObject[GLOBAL_KEY]) {
    globalObject[GLOBAL_KEY] = {};
  }

  return globalObject[GLOBAL_KEY] as LangfuseGlobalState;
}

function isNodeProcess(): boolean {
  return (
    typeof process !== "undefined" &&
    !!process?.versions?.node &&
    typeof process.on === "function"
  );
}

function registerProcessHooks(
  handle: LangfuseTelemetryHandle,
  mode: "process" | "request" | false,
): () => void {
  if (!isNodeProcess() || mode !== "process") {
    return () => {};
  }

  const listeners: Array<{
    event: NodeJS.Signals | "beforeExit";
    handler: (...args: unknown[]) => void;
  }> = [];

  const beforeExitHandler = () => {
    void handle.flush();
  };
  process.once("beforeExit", beforeExitHandler);
  listeners.push({ event: "beforeExit", handler: beforeExitHandler });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const signalHandler = () => {
      void (async () => {
        try {
          await handle.shutdown();
        } finally {
          setTimeout(() => {
            if (isNodeProcess()) {
              process.exit();
            }
          }, 0);
        }
      })();
    };

    process.once(signal, signalHandler);
    listeners.push({ event: signal, handler: signalHandler });
  }

  return () => {
    const removeListener =
      typeof process.off === "function"
        ? process.off.bind(process)
        : process.removeListener.bind(process);

    for (const { event, handler } of listeners) {
      removeListener(event as any, handler as any);
    }
  };
}

export async function ensureLangfuseTelemetry(
  config?: LangfuseTelemetryConfig,
): Promise<LangfuseTelemetryHandle> {
  const state = getGlobalState();

  if (state.handle) {
    return state.handle;
  }

  if (state.initializing) {
    return state.initializing;
  }

  const initialization = initializeLangfuseTelemetry(config).then((handle) => {
    state.handle = handle;
    return handle;
  });

  state.initializing = initialization.finally(() => {
    delete state.initializing;
  });

  return initialization;
}

async function initializeLangfuseTelemetry(
  config?: LangfuseTelemetryConfig,
): Promise<LangfuseTelemetryHandle> {
  if (!isNodeProcess()) {
    throw new Error("Langfuse telemetry is only supported in Node.js environments.");
  }

  const state = getGlobalState();
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_BASE_URL;

  if (!publicKey || !secretKey) {
    throw new Error(
      "Langfuse telemetry requires LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY environment variables.",
    );
  }

  let langfuseModule: unknown;
  try {
    langfuseModule = await import("@langfuse/otel");
  } catch (error) {
    throw new Error(
      "Langfuse telemetry requires the optional peer dependency '@langfuse/otel'. Install it to enable telemetry.",
      { cause: error },
    );
  }

  const { LangfuseSpanProcessor } = langfuseModule as {
    LangfuseSpanProcessor: LangfuseSpanProcessorConstructor;
  };

  let otelModule: unknown;
  try {
    otelModule = await import("@opentelemetry/sdk-trace-node");
  } catch (error) {
    throw new Error(
      "Langfuse telemetry requires the optional peer dependency '@opentelemetry/sdk-trace-node'. Install it to enable telemetry.",
      { cause: error },
    );
  }

  const { NodeTracerProvider } = otelModule as {
    NodeTracerProvider: NodeTracerProviderConstructor;
  };

  const processor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    baseUrl,
    shouldExportSpan: config?.shouldExportSpan,
  });

  const provider = new NodeTracerProvider();
  provider.addSpanProcessor(processor);
  provider.register();

  const flush = async () => {
    const [providerResult, processorResult] = await Promise.allSettled([
      provider.forceFlush(),
      processor.forceFlush(),
    ]);

    if (providerResult.status === "rejected") {
      throw providerResult.reason;
    }

    if (processorResult.status === "rejected") {
      throw processorResult.reason;
    }
  };

  let removeProcessHooks: (() => void) | undefined;

  const shutdown = async () => {
    removeProcessHooks?.();
    removeProcessHooks = undefined;

    const [providerResult, processorResult] = await Promise.allSettled([
      provider.shutdown(),
      processor.shutdown(),
    ]);

    state.handle = undefined;

    if (providerResult.status === "rejected") {
      throw providerResult.reason;
    }

    if (processorResult.status === "rejected") {
      throw processorResult.reason;
    }
  };

  const handle: LangfuseTelemetryHandle = {
    processor,
    provider,
    flush,
    shutdown,
  };

  const autoFlushMode = config?.autoFlush ?? "process";
  removeProcessHooks = registerProcessHooks(handle, autoFlushMode);

  return handle;
}
