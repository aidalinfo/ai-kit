#!/usr/bin/env node
import { createServerKit } from "./ServerKit.js";

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "0.0.0.0";

const cliArgs = process.argv.slice(2);
const swaggerArg = cliArgs.find(arg => arg === "--swagger" || arg === "--no-swagger");

const serverKit = createServerKit({
  ...(swaggerArg ? { swagger: swaggerArg === "--swagger" } : {}),
});

console.log(`Starting ServerKit on http://${hostname}:${port}`);

try {
  serverKit.listen({ port, hostname });
} catch (error) {
  console.error("ServerKit failed to start", error);
  process.exit(1);
}
