#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./index.js";

async function main() {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AI Kit Docs MCP Server is running over stdio");
}

main().catch(error => {
  console.error("Failed to start AI Kit Docs MCP Server", error);
  process.exit(1);
});
