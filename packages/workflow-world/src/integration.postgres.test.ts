import { describe, expect, it } from "vitest";
import { createWorldAdapter } from "./adapter.js";

// Opt-in : ne s'exécute que si WORKFLOW_WORLD_PG_URL est défini (cf. script test:integration).
const RUN_IT = process.env.WORKFLOW_WORLD_PG_URL ? describe : describe.skip;

RUN_IT("integration: postgres world", () => {
  it("démarre et arrête un world Postgres réel", async () => {
    const adapter = createWorldAdapter({
      type: "postgres",
      url: process.env.WORKFLOW_WORLD_PG_URL!,
    });
    await adapter.start();
    await adapter.stop();
    expect(true).toBe(true);
  }, 60_000);
});
