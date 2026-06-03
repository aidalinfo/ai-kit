import { describe, expect, it, vi } from "vitest";

import {
  buildRepairInstruction,
  collectSchemaIssues,
  listExpectedKeys,
  normalizeKeysToSchema,
  resolveResilienceConfig,
  resolveResilientObject,
} from "./structuredOutputResilience.js";

describe("normalizeKeysToSchema", () => {
  it("remaps a camelCase key to the schema's snake_case property", () => {
    const schema = {
      type: "object",
      properties: { document_type: { type: "string" } },
      required: ["document_type"],
    };

    expect(normalizeKeysToSchema({ documentType: "Bilan" }, schema)).toEqual({
      document_type: "Bilan",
    });
  });

  it("remaps kebab-case and PascalCase variants to the schema property", () => {
    const schema = {
      type: "object",
      properties: { document_type: { type: "string" } },
    };

    expect(normalizeKeysToSchema({ "document-type": "a" }, schema)).toEqual({
      document_type: "a",
    });
    expect(normalizeKeysToSchema({ DocumentType: "b" }, schema)).toEqual({
      document_type: "b",
    });
  });

  it("is a no-op when keys already match the schema", () => {
    const schema = {
      type: "object",
      properties: { document_type: { type: "string" } },
    };
    const value = { document_type: "ok" };

    expect(normalizeKeysToSchema(value, schema)).toEqual({ document_type: "ok" });
  });

  it("preserves keys that have no matching schema property", () => {
    const schema = {
      type: "object",
      properties: { document_type: { type: "string" } },
    };

    expect(
      normalizeKeysToSchema({ documentType: "a", extra: 1 }, schema),
    ).toEqual({ document_type: "a", extra: 1 });
  });

  it("does not overwrite an exact match with a drifted alias", () => {
    const schema = {
      type: "object",
      properties: { document_type: { type: "string" } },
    };

    expect(
      normalizeKeysToSchema(
        { document_type: "snake", documentType: "camel" },
        schema,
      ),
    ).toEqual({ document_type: "snake" });
  });

  it("recurses into nested object properties", () => {
    const schema = {
      type: "object",
      properties: {
        patient_info: {
          type: "object",
          properties: { first_name: { type: "string" } },
        },
      },
    };

    expect(
      normalizeKeysToSchema({ patientInfo: { firstName: "Ada" } }, schema),
    ).toEqual({ patient_info: { first_name: "Ada" } });
  });

  it("recurses into arrays of objects via items schema", () => {
    const schema = {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: { question_id: { type: "string" } },
          },
        },
      },
    };

    expect(
      normalizeKeysToSchema(
        { questions: [{ questionId: "q1" }, { questionId: "q2" }] },
        schema,
      ),
    ).toEqual({ questions: [{ question_id: "q1" }, { question_id: "q2" }] });
  });

  it("returns primitives and unschemaed values unchanged", () => {
    expect(normalizeKeysToSchema("hello", { type: "string" })).toBe("hello");
    expect(normalizeKeysToSchema(42, undefined)).toBe(42);
    expect(normalizeKeysToSchema({ a: 1 }, undefined)).toEqual({ a: 1 });
  });
});

describe("collectSchemaIssues", () => {
  it("reports no issues for a conformant object", () => {
    const schema = {
      type: "object",
      properties: { questionId: { type: "string" } },
      required: ["questionId"],
    };

    expect(collectSchemaIssues({ questionId: "q1" }, schema)).toEqual([]);
  });

  it("flags a missing required property", () => {
    const schema = {
      type: "object",
      properties: { questionId: { type: "string" } },
      required: ["questionId"],
    };

    const issues = collectSchemaIssues({ id: "q1" }, schema);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("questionId");
  });

  it("flags a missing required property nested in an object with its path", () => {
    const schema = {
      type: "object",
      properties: {
        patient: {
          type: "object",
          properties: { lastName: { type: "string" } },
          required: ["lastName"],
        },
      },
      required: ["patient"],
    };

    const issues = collectSchemaIssues({ patient: { firstName: "Ada" } }, schema);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("patient.lastName");
  });

  it("flags an enum violation", () => {
    const schema = {
      type: "object",
      properties: { status: { type: "string", enum: ["draft", "final"] } },
      required: ["status"],
    };

    const issues = collectSchemaIssues({ status: "done" }, schema);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("status");
    expect(issues[0]).toContain("draft");
  });

  it("does not flag absent optional nested objects", () => {
    const schema = {
      type: "object",
      properties: {
        meta: {
          type: "object",
          properties: { note: { type: "string" } },
          required: ["note"],
        },
      },
    };

    expect(collectSchemaIssues({}, schema)).toEqual([]);
  });

  it("flags a missing required property inside array items", () => {
    const schema = {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: { questionId: { type: "string" } },
            required: ["questionId"],
          },
        },
      },
      required: ["questions"],
    };

    const issues = collectSchemaIssues(
      { questions: [{ questionId: "q1" }, { id: "q2" }] },
      schema,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("questions.1.questionId");
  });
});

describe("listExpectedKeys", () => {
  it("returns the top-level property names in declaration order", () => {
    const schema = {
      type: "object",
      properties: {
        questionId: { type: "string" },
        answer: { type: "string" },
      },
    };

    expect(listExpectedKeys(schema)).toEqual(["questionId", "answer"]);
  });

  it("returns an empty list when the schema has no properties", () => {
    expect(listExpectedKeys({ type: "string" })).toEqual([]);
    expect(listExpectedKeys(undefined)).toEqual([]);
  });
});

describe("buildRepairInstruction", () => {
  it("includes the schema issues and the exact expected keys", () => {
    const instruction = buildRepairInstruction({
      issues: ["missing required property 'questionId'"],
      expectedKeys: ["questionId", "answer"],
    });

    expect(instruction).toContain("missing required property 'questionId'");
    expect(instruction).toContain("questionId");
    expect(instruction).toContain("answer");
  });

  it("instructs the model to return only corrected JSON", () => {
    const instruction = buildRepairInstruction({
      issues: ["missing required property 'questionId'"],
      expectedKeys: ["questionId"],
    });

    expect(instruction.toLowerCase()).toContain("json");
  });
});

describe("resolveResilienceConfig", () => {
  it("defaults to normalization on and repair with 2 attempts", () => {
    expect(resolveResilienceConfig({})).toEqual({
      normalizeKeys: true,
      repair: { enabled: true, maxAttempts: 2 },
    });
  });

  it("disables repair when structuredOutputRepair is false", () => {
    expect(
      resolveResilienceConfig({ structuredOutputRepair: false }).repair,
    ).toEqual({ enabled: false, maxAttempts: 0 });
  });

  it("honours a custom maxAttempts", () => {
    expect(
      resolveResilienceConfig({ structuredOutputRepair: { maxAttempts: 5 } })
        .repair,
    ).toEqual({ enabled: true, maxAttempts: 5 });
  });

  it("can disable key normalization", () => {
    expect(
      resolveResilienceConfig({ normalizeStructuredKeys: false }).normalizeKeys,
    ).toBe(false);
  });
});

describe("resolveResilientObject", () => {
  const schema = {
    type: "object",
    properties: { document_type: { type: "string" } },
    required: ["document_type"],
  };
  const aliasSchema = {
    type: "object",
    properties: { questionId: { type: "string" } },
    required: ["questionId"],
  };
  const config = resolveResilienceConfig({});

  it("fixes a casing drift via normalization without any re-query", async () => {
    const requery = vi.fn();
    const result = await resolveResilientObject({
      initialObject: { documentType: "Bilan" },
      schema,
      config,
      requery,
    });

    expect(result).toEqual({ document_type: "Bilan" });
    expect(requery).not.toHaveBeenCalled();
  });

  it("leaves a conformant object untouched and never re-queries", async () => {
    const requery = vi.fn();
    const result = await resolveResilientObject({
      initialObject: { document_type: "ok" },
      schema,
      config,
      requery,
    });

    expect(result).toEqual({ document_type: "ok" });
    expect(requery).not.toHaveBeenCalled();
  });

  it("repairs a semantic alias with a single re-query", async () => {
    const requery = vi.fn(
      async (_params: { instruction: string; previousObject: unknown }) => ({
        questionId: "q1",
      }),
    );
    const result = await resolveResilientObject({
      initialObject: { id: "q1" },
      schema: aliasSchema,
      config,
      requery,
    });

    expect(result).toEqual({ questionId: "q1" });
    expect(requery).toHaveBeenCalledTimes(1);
    const instruction = requery.mock.calls[0]?.[0]?.instruction as string;
    expect(instruction).toContain("questionId");
  });

  it("stops after maxAttempts and returns the best-effort object", async () => {
    const requery = vi.fn(async () => ({ id: "still-wrong" }));
    const result = await resolveResilientObject({
      initialObject: { id: "q1" },
      schema: aliasSchema,
      config: resolveResilienceConfig({
        structuredOutputRepair: { maxAttempts: 3 },
      }),
      requery,
    });

    expect(requery).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ id: "still-wrong" });
  });

  it("does not re-query when repair is disabled", async () => {
    const requery = vi.fn();
    const result = await resolveResilientObject({
      initialObject: { id: "q1" },
      schema: aliasSchema,
      config: resolveResilienceConfig({ structuredOutputRepair: false }),
      requery,
    });

    expect(result).toEqual({ id: "q1" });
    expect(requery).not.toHaveBeenCalled();
  });

  it("delivers the best-effort object if a re-query throws", async () => {
    const requery = vi.fn(async () => {
      throw new Error("network");
    });
    const result = await resolveResilientObject({
      initialObject: { id: "q1" },
      schema: aliasSchema,
      config,
      requery,
    });

    expect(result).toEqual({ id: "q1" });
    expect(requery).toHaveBeenCalledTimes(1);
  });
});
