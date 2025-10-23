declare module "@langfuse/otel" {
  export interface LangfuseSpanProcessorOptions {
    publicKey: string;
    secretKey: string;
    baseUrl?: string;
    shouldExportSpan?: (input: unknown) => boolean;
  }

  export class LangfuseSpanProcessor {
    constructor(options: LangfuseSpanProcessorOptions);
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
  }
}

declare module "@opentelemetry/sdk-trace-node" {
  export interface NodeTracerProviderOptions {
    [key: string]: unknown;
  }

  export class NodeTracerProvider {
    constructor(options?: NodeTracerProviderOptions);
    addSpanProcessor(processor: {
      forceFlush(): Promise<void>;
      shutdown(): Promise<void>;
    }): void;
    register(): void;
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
  }
}
