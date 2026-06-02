import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { createWorldAdapter } from "./adapter.js";

const url = process.env.WORKFLOW_WORLD_PG_URL;

// Opt-in : ne s'exécute que si WORKFLOW_WORLD_PG_URL est défini (cf. script test:integration).
const RUN_IT = url ? describe : describe.skip;

RUN_IT("integration: postgres world", () => {
  beforeAll(() => {
    // Le world Postgres exige un provisioning de schéma AVANT usage (sinon
    // erreur "undefined_table" 42P01). En production c'est une étape de
    // déploiement : `npx workflow-postgres-setup` (lit WORKFLOW_POSTGRES_URL).
    // On l'exécute en SOUS-PROCESSUS car le CLI appelle process.exit (incompatible
    // avec un import in-process sous vitest).
    execFileSync("pnpm", ["exec", "workflow-postgres-setup"], {
      env: { ...process.env, WORKFLOW_POSTGRES_URL: url },
      stdio: "inherit",
    });
  }, 60_000);

  it("démarre et arrête un world Postgres réel", async () => {
    const adapter = createWorldAdapter({
      type: "postgres",
      url: url!,
    });
    await adapter.start();
    await adapter.stop();
    expect(true).toBe(true);
  }, 60_000);
});
