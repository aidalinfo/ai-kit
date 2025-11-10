#!/usr/bin/env node
import { createServerKit } from "./ServerKit.js";

function resolveBooleanFlag(args: string[], name: string) {
  const positive = `--${name}`;
  const negative = `--no-${name}`;

  if (args.includes(positive)) {
    return true;
  }

  if (args.includes(negative)) {
    return false;
  }

  return undefined;
}

async function main() {
  const port = Number(process.env.PORT ?? 8787);
  const hostname = process.env.HOST ?? "0.0.0.0";

  const cliArgs = process.argv.slice(2);
  const swaggerFlag = resolveBooleanFlag(cliArgs, "swagger");
  const telemetryFlag = resolveBooleanFlag(cliArgs, "telemetry");

  const serverKit = createServerKit({
    ...(typeof swaggerFlag === "boolean" ? { swagger: swaggerFlag } : {}),
    ...(typeof telemetryFlag === "boolean" ? { telemetry: telemetryFlag } : {}),
  });

  console.log(`Starting ServerKit on http://${hostname}:${port}`);

  try {
    serverKit.listen({ port, hostname });
  } catch (error) {
    console.error("ServerKit failed to start", error);
    process.exit(1);
  }
}

void main().catch(error => {
  console.error("ServerKit failed to start", error);
  process.exit(1);
});
