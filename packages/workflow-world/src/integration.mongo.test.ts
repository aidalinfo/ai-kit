import { describe, expect, it } from "vitest";
import { createWorldAdapter } from "./adapter.js";

// Opt-in : ne s'exécute que si WORKFLOW_WORLD_MONGO_URL est défini (cf. script test:integration).
// World Mongo = communautaire / expérimental (cf. spec §1, §7.2).
const RUN_IT = process.env.WORKFLOW_WORLD_MONGO_URL ? describe : describe.skip;

RUN_IT("integration: mongodb world (expérimental)", () => {
  it("démarre et arrête un world MongoDB réel", async () => {
    const adapter = createWorldAdapter({
      type: "mongodb",
      url: process.env.WORKFLOW_WORLD_MONGO_URL!,
    });
    await adapter.start();
    await adapter.stop();
    expect(true).toBe(true);
  }, 60_000);
});
