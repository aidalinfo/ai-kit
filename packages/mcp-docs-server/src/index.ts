import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocsTool } from "./docsTool.js";
import { getPackageRoot } from "./utils.js";

async function readPackageVersion(): Promise<string> {
  try {
    const packageJsonPath = path.resolve(getPackageRoot(), "package.json");
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch (error) {
    console.warn("Failed to read package.json version", error);
    return "0.0.0";
  }
}

export async function createServer(): Promise<McpServer> {
  const version = await readPackageVersion();
  const server = new McpServer({
    name: "AI Kit Docs MCP Server",
    version
  });

  registerDocsTool(server);

  return server;
}

export async function startServer(): Promise<McpServer> {
  const server = await createServer();
  return server;
}
