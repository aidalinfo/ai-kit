import { describe, expect, it } from "vitest";
import { buildWorldOptions, WORLD_TARGETS } from "./worlds.js";

describe("WORLD_TARGETS", () => {
  it("mappe les types vers les packages SDK", () => {
    expect(WORLD_TARGETS.postgres).toBe("@workflow/world-postgres");
    expect(WORLD_TARGETS.mongodb).toBe("@workflow-worlds/mongodb");
  });
});

describe("buildWorldOptions", () => {
  it("postgres : mappe url→connectionString et workerConcurrency→queueConcurrency", () => {
    const opts = buildWorldOptions({
      type: "postgres",
      url: "postgres://u:p@h:5432/db",
      jobPrefix: "wf__",
      workerConcurrency: 5,
      maxPoolSize: 12,
    });
    expect(opts).toEqual({
      connectionString: "postgres://u:p@h:5432/db",
      jobPrefix: "wf__",
      queueConcurrency: 5,
      maxPoolSize: 12,
    });
  });

  it("postgres : omet les champs optionnels absents", () => {
    expect(buildWorldOptions({ type: "postgres", url: "postgres://x" })).toEqual({
      connectionString: "postgres://x",
    });
  });

  it("mongodb : mappe url→mongoUrl", () => {
    expect(buildWorldOptions({ type: "mongodb", url: "mongodb://h:27017/db" })).toEqual({
      mongoUrl: "mongodb://h:27017/db",
    });
  });

  it("rejette une url manquante", () => {
    expect(() => buildWorldOptions({ type: "postgres", url: "" })).toThrow(/url/i);
  });

  it("rejette un type inconnu", () => {
    // @ts-expect-error test runtime
    expect(() => buildWorldOptions({ type: "redis", url: "x" })).toThrow(/unsupported|inconnu/i);
  });
});
