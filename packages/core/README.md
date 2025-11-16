# AI Kit – Core

👉 **Read the full docs:** [ai.aidalinfo.fr](https://ai.aidalinfo.fr)

`@ai_kit/core` bundles the foundational building blocks of AI Kit: typed workflows (`createStep`, `createMapStep`, `createWorkflow`), agents (`Agent`), and telemetry utilities. Everything else (server kit, templates, CLI) builds on this package.

## Installation

```bash
pnpm add @ai_kit/core zod
# or
npm install @ai_kit/core zod
```

`zod` is optional but enables automatic type inference via `inputSchema` / `outputSchema`.

## Quick start

```ts
import { createStep, createWorkflow } from "@ai_kit/core";
import { z } from "zod";

const fetchWeather = createStep({
  id: "fetch-weather",
  inputSchema: z.object({ city: z.string().min(1) }),
  outputSchema: z.object({ forecast: z.string() }),
  handler: async ({ input }) => {
    // Call your API here
    return { forecast: `Sunny in ${input.city}` };
  },
});

export const weatherWorkflow = createWorkflow({
  id: "weather-line",
  description: "Minimal weather pipeline",
})
  .then(fetchWeather)
  .commit();

const run = await weatherWorkflow.run({ inputData: { city: "Paris" } });
console.log(run.status, run.result);
```

### Agents & telemetry

`@ai_kit/core` also ships with:

- `Agent` – orchestrates model calls (OpenAI, Scaleway, …) and exposes custom tools.
- Telemetry helpers to wire Langfuse / OpenTelemetry (`workflow.withTelemetry`, `run.watch()`, `run.stream()`).

Check the documentation for advanced agent samples, Langfuse integration, and human-in-the-loop steps.

## Where does `@ai_kit/server` fit?

[`@ai_kit/server`](https://www.npmjs.com/package/@ai_kit/server) complements the core by adding:

- A ready-to-use HTTP server (Express/Fastify) to expose your workflows / agents.
- Streaming endpoints (`/runs/:id/stream`), human-step resume handlers, supervisory APIs.
- Production guardrails (auth hooks, rate limiting, metrics).

Use them together:

- Define workflows, steps, and agents with `@ai_kit/core`.
- Install `@ai_kit/server` when you need HTTP/WebSocket exposure, centralized Langfuse telemetry, or a multi-workflow orchestrator.

## Useful links

- Docs: [https://ai.aidalinfo.fr](https://ai.aidalinfo.fr)
- Full examples (workflows + agents): `packages/create-ai-kit/templates/*`
- Questions/issues: open a ticket on the main repository.
