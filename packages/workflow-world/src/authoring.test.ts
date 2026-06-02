import { describe, it, expectTypeOf } from "vitest";
import type { WorldStep, WorldWorkflow } from "./authoring.js";

describe("authoring types (verdict 2: type-only)", () => {
  it("WorldStep est une fonction async typée par args/retour", () => {
    expectTypeOf<WorldStep<[number], string>>().toEqualTypeOf<(x: number) => Promise<string>>();
  });
  it("WorldWorkflow est une fonction async typée par args/retour", () => {
    expectTypeOf<WorldWorkflow<[string, number], void>>().toEqualTypeOf<(a: string, b: number) => Promise<void>>();
  });
});
