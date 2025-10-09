#!/usr/bin/env node
import { createServerKit } from "./ServerKit.js";

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "0.0.0.0";

const serverKit = createServerKit();

console.log(`Starting ServerKit on http://${hostname}:${port}`);

await serverKit
  .listen({ port, hostname })
  .catch(error => {
    console.error("ServerKit failed to start", error);
    process.exit(1);
  });
