# AI Kit MCP Server

The `@ai_kit/mcp-docs` package exposes the AI Kit documentation through the Model Context Protocol (MCP). You can run it as a standalone server or wire it into your MCP-compatible client so the documentation stays close to your agents.

## Wiring it into an MCP client

Add the server to your client configuration. For example, using the Claude Desktop inspector:

```json
{
  "mcpServers": {
    "ai_kit-docs": {
      "command": "npx",
      "args": ["-y", "@ai_kit/mcp-docs@latest"]
    }
  }
}
```

For Codex, configure the server through TOML:

```toml
[mcp_servers."ai_kit-docs"]
command = "npx"
args = ["-y", "@ai_kit/mcp-docs@latest"]
env = { }
startup_timeout_ms = 20000  # optional
```

For Claude Code, define the server the same way:

```json
{
  "mcpServers": {
    "ai_kit-docs": {
      "command": "npx",
      "args": ["-y", "@ai_kit/mcp-docs@latest"]
    }
  }
}
```

The server registers two tools:

- `ai_kit-docs` lists directories or reads Markdown/MDX files from the `docs/` tree. Pass `path` (relative to `docs/`) to open a file or directory, and optionally supply `keywords` to highlight matches.
- `ai_kit-docs-search` performs a keyword search across the docs and returns paginated snippets. Use this when you want targeted references without loading entire files.

Request `core/quickstart.md`, for example, to receive the rendered Markdown content ready for your agent.
