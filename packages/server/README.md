# @ai_kit/server

`@ai_kit/server` exposes a thin HTTP facade over the agents and workflows defined in `@ai_kit/core`. It wraps a [Hono](https://hono.dev/) application that can be embedded inside your own runtime or started directly via the bundled CLI script.

## Quick start

```ts
import { Agent, createWorkflow } from "@ai_kit/core";
import { ServerKit } from "@ai_kit/server";
import { serve } from "@hono/node-server";

const echoAgent = new Agent({
  name: "echo",
  model: /* configure an ai-sdk LanguageModel here */ {} as any,
});

const workflow = createWorkflow({
  id: "demo",
  description: "Echoes input data",
  steps: [],
});

const server = new ServerKit({
  agents: { echo: echoAgent },
  workflows: { demo: workflow },
});

await server.listen({ port: 8787 });
```

The server registers the following endpoints:

- `POST /api/agents/:id/generate` — synchronously invoke `Agent.generate`.
- `POST /api/agents/:id/stream` — stream the result of `Agent.stream`.
- `POST /api/workflows/:id/run` — execute a workflow to completion.
- `POST /api/workflows/:id/stream` — stream workflow events (Server-Sent Events).
- `POST /api/workflows/:id/runs/:runId/resume` — resume a suspended workflow run that awaits human input.

See `src/ServerKit.ts` for the complete implementation and error-handling behaviour.
