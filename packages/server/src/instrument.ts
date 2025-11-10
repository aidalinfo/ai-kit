import { ensureLangfuseTelemetry, type LangfuseTelemetryConfig } from "@ai_kit/core";

export interface ServerTelemetryOptions extends LangfuseTelemetryConfig {
  enabled?: boolean;
}

export type ServerTelemetryHandle = Awaited<
  ReturnType<typeof ensureLangfuseTelemetry>
>;

let telemetryHandlePromise: Promise<ServerTelemetryHandle> | undefined;

export async function instrumentServerTelemetry(
  options: ServerTelemetryOptions = {},
): Promise<ServerTelemetryHandle | undefined> {
  if (!options.enabled) {
    return undefined;
  }

  if (!telemetryHandlePromise) {
    const { enabled: _enabled, ...config } = options;
    telemetryHandlePromise = ensureLangfuseTelemetry(config);
  }

  return telemetryHandlePromise;
}

export async function getServerTelemetryHandle(): Promise<
  ServerTelemetryHandle | undefined
> {
  return telemetryHandlePromise ? await telemetryHandlePromise : undefined;
}

export async function flushServerTelemetry(): Promise<void> {
  const handle = await getServerTelemetryHandle();
  if (handle) {
    await handle.flush();
  }
}

export async function shutdownServerTelemetry(): Promise<void> {
  if (!telemetryHandlePromise) {
    return;
  }

  const handle = await telemetryHandlePromise;
  telemetryHandlePromise = undefined;
  await handle.shutdown();
}

export function isServerTelemetryEnabled(): boolean {
  return telemetryHandlePromise !== undefined;
}

export default instrumentServerTelemetry;
