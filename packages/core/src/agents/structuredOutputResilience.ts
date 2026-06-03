import type { JSONSchema7 } from "ai";

/** A JSON Schema node, or the boolean shorthand JSON Schema allows. */
type JSONSchema7Definition = JSONSchema7 | boolean;

/**
 * Resilience helpers for structured output produced by providers that do not
 * enforce a JSON schema (everything except OpenAI in this codebase).
 *
 * Models frequently return the right shape but with a drifted key name — a
 * different casing/separator (`documentType` vs `document_type`) or a semantic
 * alias (`id` vs `questionId`). These helpers make the structuring pass tolerant
 * to that drift without hard-coding any application-specific key.
 */

type JsonRecord = Record<string, unknown>;

/** Per-call configuration of structured-output resilience. */
export interface StructuredOutputResilienceOptions {
  /** Layer 1 — deterministic key normalization. Default: `true`. */
  normalizeStructuredKeys?: boolean;
  /**
   * Layer 2 — error-driven repair retries. `true` (default) enables repair with
   * `maxAttempts: 2`; `false` disables it; the object form tunes the attempts.
   */
  structuredOutputRepair?: boolean | { maxAttempts?: number };
}

export interface ResilienceConfig {
  normalizeKeys: boolean;
  repair: { enabled: boolean; maxAttempts: number };
}

const DEFAULT_REPAIR_ATTEMPTS = 2;

/** Resolves user-facing options into a fully-defaulted resilience config. */
export function resolveResilienceConfig(
  options: StructuredOutputResilienceOptions,
): ResilienceConfig {
  const normalizeKeys = options.normalizeStructuredKeys ?? true;
  const repairOption = options.structuredOutputRepair;

  if (repairOption === false) {
    return { normalizeKeys, repair: { enabled: false, maxAttempts: 0 } };
  }

  if (repairOption && typeof repairOption === "object") {
    return {
      normalizeKeys,
      repair: {
        enabled: true,
        maxAttempts: repairOption.maxAttempts ?? DEFAULT_REPAIR_ATTEMPTS,
      },
    };
  }

  return {
    normalizeKeys,
    repair: { enabled: true, maxAttempts: DEFAULT_REPAIR_ATTEMPTS },
  };
}

function isPlainObject(value: unknown): value is JsonRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function asObjectSchema(
  schema: JSONSchema7Definition | undefined,
): JSONSchema7 | undefined {
  return typeof schema === "object" && schema !== null ? schema : undefined;
}

/**
 * Canonical comparison form of a property name: lowercased with every
 * non-alphanumeric character (separators like `_`, `-`, spaces) stripped. So
 * `document_type`, `documentType`, `document-type` and `Document Type` all
 * collapse to `documenttype`.
 */
function canonicalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Recursively remaps the keys of `value` onto the property names declared by
 * `schema`, matching insensitively to case and separator. Keys that already
 * match exactly, and keys with no schema counterpart, are left untouched. An
 * exact match always wins over a drifted alias (the alias is dropped).
 */
export function normalizeKeysToSchema(
  value: unknown,
  schema: JSONSchema7Definition | undefined,
): unknown {
  const objectSchema = asObjectSchema(schema);

  if (Array.isArray(value)) {
    const itemSchema = objectSchema?.items;
    const resolvedItemSchema = Array.isArray(itemSchema)
      ? undefined
      : itemSchema;
    return value.map((item) =>
      normalizeKeysToSchema(item, resolvedItemSchema),
    );
  }

  if (!isPlainObject(value) || !objectSchema?.properties) {
    return value;
  }

  const properties = objectSchema.properties;
  const canonicalToProp = new Map<string, string>();
  for (const propName of Object.keys(properties)) {
    canonicalToProp.set(canonicalizeKey(propName), propName);
  }

  const result: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    const isExact = Object.prototype.hasOwnProperty.call(properties, key);
    const canonicalName = isExact
      ? key
      : canonicalToProp.get(canonicalizeKey(key)) ?? key;

    const propSchema = Object.prototype.hasOwnProperty.call(
      properties,
      canonicalName,
    )
      ? properties[canonicalName]
      : undefined;

    const normalizedChild = normalizeKeysToSchema(child, propSchema);

    const alreadySet = Object.prototype.hasOwnProperty.call(
      result,
      canonicalName,
    );
    if (alreadySet && !isExact) {
      // An exact match already claimed this canonical name — drop the alias.
      continue;
    }

    result[canonicalName] = normalizedChild;
  }

  return result;
}

/**
 * Conservatively reports the ways `value` fails to satisfy `schema`. It only
 * surfaces problems a model can realistically fix on a retry — missing required
 * properties (recursively) and enum violations — and never flags a conformant
 * object, so it is safe to use as the "should we repair?" signal: zero issues
 * means no extra LLM round-trip.
 */
export function collectSchemaIssues(
  value: unknown,
  schema: JSONSchema7Definition | undefined,
  path = "",
): string[] {
  const objectSchema = asObjectSchema(schema);
  if (!objectSchema) {
    return [];
  }

  const issues: string[] = [];

  if (Array.isArray(objectSchema.enum) && value !== undefined) {
    const allowed: unknown[] = objectSchema.enum;
    if (!allowed.some((candidate) => candidate === value)) {
      issues.push(
        `property '${path || "value"}' must be one of [${allowed
          .map((candidate) => JSON.stringify(candidate))
          .join(", ")}] (received ${JSON.stringify(value)})`,
      );
    }
  }

  if (Array.isArray(value)) {
    const itemSchema = objectSchema.items;
    const resolvedItemSchema = Array.isArray(itemSchema)
      ? undefined
      : itemSchema;
    value.forEach((item, index) => {
      issues.push(
        ...collectSchemaIssues(item, resolvedItemSchema, joinPath(path, index)),
      );
    });
    return issues;
  }

  if (objectSchema.properties && isPlainObject(value)) {
    const required = Array.isArray(objectSchema.required)
      ? objectSchema.required
      : [];
    for (const requiredKey of required) {
      if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
        issues.push(
          `missing required property '${joinPath(path, requiredKey)}'`,
        );
      }
    }

    for (const [propName, propSchema] of Object.entries(
      objectSchema.properties,
    )) {
      if (Object.prototype.hasOwnProperty.call(value, propName)) {
        issues.push(
          ...collectSchemaIssues(
            value[propName],
            propSchema,
            joinPath(path, propName),
          ),
        );
      }
    }
  }

  return issues;
}

function joinPath(path: string, segment: string | number): string {
  return path ? `${path}.${segment}` : String(segment);
}

/** Top-level property names declared by the schema, in declaration order. */
export function listExpectedKeys(
  schema: JSONSchema7Definition | undefined,
): string[] {
  const objectSchema = asObjectSchema(schema);
  if (!objectSchema?.properties) {
    return [];
  }
  return Object.keys(objectSchema.properties);
}

/**
 * Builds the user turn used to re-query a model whose JSON drifted from the
 * schema. It restates the validation issues and the exact keys the schema
 * expects, then asks for corrected JSON only — the generic safety net for
 * semantic aliases that deterministic key normalization cannot guess.
 */
export function buildRepairInstruction({
  issues,
  expectedKeys,
}: {
  issues: string[];
  expectedKeys: string[];
}): string {
  const lines = [
    "Your previous JSON response did not match the required schema.",
  ];

  if (issues.length > 0) {
    lines.push(
      "Issues:",
      ...issues.map((issue) => `- ${issue}`),
    );
  }

  if (expectedKeys.length > 0) {
    lines.push(
      `Return ONLY the corrected JSON object, using EXACTLY these top-level keys: ${expectedKeys
        .map((key) => `"${key}"`)
        .join(", ")}.`,
    );
  } else {
    lines.push("Return ONLY the corrected JSON object.");
  }

  return lines.join("\n");
}

/**
 * Orchestrates the two resilience layers over a structured object:
 *
 * 1. normalize drifted keys onto the schema's property names (cheap, no LLM);
 * 2. if the object still misses required keys / violates enums, re-query the
 *    model up to `maxAttempts` times, re-normalizing each reply.
 *
 * A conformant (or normalization-fixable) object returns immediately with no
 * re-query, keeping the nominal-case cost unchanged. If a re-query throws, the
 * best-effort object obtained so far is returned rather than propagating the
 * failure — the pipeline never regresses a success into an error.
 */
export async function resolveResilientObject({
  initialObject,
  schema,
  config,
  requery,
}: {
  initialObject: unknown;
  schema: JSONSchema7Definition | undefined;
  config: ResilienceConfig;
  requery: (params: {
    instruction: string;
    previousObject: unknown;
  }) => Promise<unknown>;
}): Promise<unknown> {
  const normalize = (object: unknown) =>
    config.normalizeKeys ? normalizeKeysToSchema(object, schema) : object;

  let current = normalize(initialObject);

  if (!config.repair.enabled) {
    return current;
  }

  let issues = collectSchemaIssues(current, schema);
  if (issues.length === 0) {
    return current;
  }

  const expectedKeys = listExpectedKeys(schema);

  for (let attempt = 0; attempt < config.repair.maxAttempts; attempt += 1) {
    const instruction = buildRepairInstruction({ issues, expectedKeys });

    let retried: unknown;
    try {
      retried = await requery({ instruction, previousObject: current });
    } catch {
      // A failed re-query must not turn an already-obtained object into an
      // error; deliver the best-effort result we have.
      return current;
    }

    current = normalize(retried);
    issues = collectSchemaIssues(current, schema);
    if (issues.length === 0) {
      return current;
    }
  }

  return current;
}
