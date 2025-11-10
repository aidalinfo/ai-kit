import { decode, encode } from "@toon-format/toon";
import type { GenerateTextResult, JSONSchema7, ToolSet } from "ai";

import { setExperimentalOutput } from "./experimentalOutput.js";
import { getJsonSchemaFromStructuredOutput } from "./structuredOutputSchema.js";
import type { StructuredOutput } from "./types.js";

const DEFAULT_ARRAY_EXAMPLE_LENGTH = 2;
const MAX_EXAMPLE_DEPTH = 6;

type SchemaDefinition =
  JSONSchema7["properties"] extends Record<string, infer Definition>
    ? Definition
    : never;

interface ExampleContext {
  key?: string;
  variant?: number;
  depth?: number;
}

export function buildToonSystemPrompt(
  baseSystem: string | undefined,
  schema: JSONSchema7,
): string {
  const rawExample = encode(buildExampleFromSchema(schema), { indent: 2 });

  // Convert inline string arrays to list format for better LLM guidance
  // This helps prevent parsing errors when LLMs generate long string values
  const example = convertInlineStringArraysToListFormat(rawExample);

  const instructions = [
    "You MUST respond using Token-Oriented Object Notation (TOON).",
    "Respect the schema below, output only the TOON block, and keep [N] equal to the number of rows you emit.",
    "Replace the placeholder values with the actual answer.",
    "",
    "IMPORTANT: For arrays of strings, always use list format with hyphens (-):",
    "✅ CORRECT:   items[2]:",
    "              - first item",
    "              - second item",
    "❌ WRONG:     items[2]: first item, second item",
    "",
    "```toon",
    example,
    "```",
  ].join("\n");

  if (!baseSystem) {
    return instructions;
  }

  return `${baseSystem}\n\n${instructions}`;
}

export async function parseToonStructuredOutput<OUTPUT>(
  result: GenerateTextResult<ToolSet, OUTPUT>,
  structuredOutput: StructuredOutput<OUTPUT, unknown>,
) {
  const payload = extractToonPayload(result.text);
  if (!payload) {
    throw new Error(
      "TOON output expected but the model response did not include a TOON block.",
    );
  }

  let decoded: unknown;
  try {
    decoded = decode(payload);
  } catch (error) {
    throw new Error("Failed to decode TOON output.", { cause: error });
  }

  // Apply minimal type coercion based on schema expectations
  // This handles edge cases like numeric IDs that should be strings (e.g., SIRET numbers)
  const schema = getJsonSchemaFromStructuredOutput(structuredOutput);
  const coerced = schema ? coerceBySchema(decoded, schema) : decoded;

  const jsonText = JSON.stringify(coerced);
  const parsedOutput = await structuredOutput.parseOutput(
    { text: jsonText },
    {
      response: result.response,
      usage: result.usage,
      finishReason: result.finishReason,
    },
  );

  setExperimentalOutput(result, parsedOutput as OUTPUT);
}

function extractToonPayload(text: string): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) {
    return undefined;
  }

  const fencedMatch = trimmed.match(/```(?:toon)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  return trimmed;
}

/**
 * Converts inline string arrays to list format in TOON examples.
 * This prevents LLMs from generating inline format for long strings which causes parsing errors.
 *
 * Example:
 *   notes[2]: first,second
 * Becomes:
 *   notes[2]:
 *     - first
 *     - second
 */
function convertInlineStringArraysToListFormat(toon: string): string {
  // Match patterns like: key[N]: value1,value2,value3
  // where values contain alphabetic characters (indicating strings, not just numbers)
  const inlineArrayPattern = /^(\s*)(\w+)\[(\d+)\]:\s*(.+)$/gm;

  return toon.replace(inlineArrayPattern, (match, indent, key, count, values) => {
    // Check if this looks like a string array (contains letters, not just numbers/special chars)
    const hasLetters = /[a-zA-Z]/.test(values);
    if (!hasLetters) {
      return match; // Keep numeric arrays as inline
    }

    // Split by comma and trim
    const items = values.split(',').map((v: string) => v.trim());

    // Only convert if the count matches the actual items
    if (items.length !== parseInt(count, 10)) {
      return match;
    }

    // Build list format
    const listItems = items.map((item: string) => `${indent}  - ${item}`).join('\n');
    return `${indent}${key}[${count}]:\n${listItems}`;
  });
}

/**
 * Applies type coercion based on JSON Schema expectations.
 * Only converts numbers to strings when the schema explicitly expects a string type.
 * This is simpler and more correct than the previous complex recursive approach.
 */
function coerceBySchema(value: unknown, schema: JSONSchema7): unknown {
  const schemaType = resolveType(schema);

  // If schema expects a string and we have a finite number, convert it
  if (
    schemaType === "string" &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value.toString();
  }

  // Handle arrays
  if (schemaType === "array" && Array.isArray(value) && schema.items) {
    const itemSchema = Array.isArray(schema.items)
      ? null
      : normalizeDefinition(schema.items as SchemaDefinition);

    if (itemSchema) {
      return value.map((item) => coerceBySchema(item, itemSchema));
    }
  }

  // Handle objects
  if (
    schemaType === "object" &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    schema.properties
  ) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const propSchema = schema.properties[key];
      if (propSchema) {
        result[key] = coerceBySchema(
          val,
          normalizeDefinition(propSchema as SchemaDefinition),
        );
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  return value;
}

function buildExampleFromSchema(
  schema: JSONSchema7,
  context: ExampleContext = {},
): unknown {
  const depth = context.depth ?? 0;
  if (depth > MAX_EXAMPLE_DEPTH) {
    return null;
  }

  if ("const" in schema && schema.const !== undefined) {
    return schema.const;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return buildExampleFromSchema(
      normalizeDefinition(schema.anyOf[0]),
      increaseDepth(context, depth),
    );
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return buildExampleFromSchema(
      normalizeDefinition(schema.oneOf[0]),
      increaseDepth(context, depth),
    );
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return buildExampleFromSchema(
      normalizeDefinition(schema.allOf[0]),
      increaseDepth(context, depth),
    );
  }

  const resolvedType = resolveType(schema);
  switch (resolvedType) {
    case "object":
      return buildObjectExample(schema, context, depth);
    case "array":
      return buildArrayExample(schema, context, depth);
    case "number":
    case "integer":
      return buildNumberExample(schema, context);
    case "boolean":
      return buildBooleanExample(schema, context);
    case "null":
      return null;
    case "string":
      return buildStringExample(schema, context);
    default:
      return schema.default ?? null;
  }
}

function buildObjectExample(
  schema: JSONSchema7,
  context: ExampleContext,
  depth: number,
) {
  const properties = schema.properties ?? {};
  const example: Record<string, unknown> = {};

  for (const [key, definition] of Object.entries(properties)) {
    const propertySchema = normalizeDefinition(definition as SchemaDefinition);
    example[key] = buildExampleFromSchema(propertySchema, {
      key,
      depth: depth + 1,
    });
  }

  return example;
}

function buildArrayExample(
  schema: JSONSchema7,
  context: ExampleContext,
  depth: number,
) {
  const items = schema.items;

  if (Array.isArray(items)) {
    return items.map((item, index) =>
      buildExampleFromSchema(normalizeDefinition(item), {
        key: context.key,
        variant: index,
        depth: depth + 1,
      }),
    );
  }

  const length = clampLength(schema.minItems);
  const itemSchema = normalizeDefinition(items as SchemaDefinition);

  return Array.from({ length }, (_, index) =>
    buildExampleFromSchema(itemSchema, {
      key: context.key,
      variant: index,
      depth: depth + 1,
    }),
  );
}

function buildStringExample(schema: JSONSchema7, context: ExampleContext) {
  const existing = firstExampleOfType<string>(schema, "string");
  if (existing) {
    return existing;
  }

  if (schema.format === "date-time") {
    const baseDate = new Date(Date.UTC(2025, 0, 1));
    if (context.variant) {
      baseDate.setUTCDate(baseDate.getUTCDate() + context.variant);
    }
    return baseDate.toISOString();
  }

  const sanitizedKey = sanitizeKey(context.key);
  const suffix = context.variant ? `_${context.variant + 1}` : "";
  return `${sanitizedKey}${suffix}`;
}

function buildNumberExample(schema: JSONSchema7, context: ExampleContext) {
  const existing = firstExampleOfType<number>(schema, "number");
  if (existing !== undefined) {
    return existing;
  }

  const base =
    typeof schema.minimum === "number"
      ? Math.max(schema.minimum, 1)
      : typeof schema.exclusiveMinimum === "number"
        ? schema.exclusiveMinimum + 1
        : typeof schema.default === "number"
          ? schema.default
          : 1;
  const increment = context.variant ?? 0;
  return base + increment;
}

function buildBooleanExample(schema: JSONSchema7, context: ExampleContext) {
  const existing = firstExampleOfType<boolean>(schema, "boolean");
  if (existing !== undefined) {
    return existing;
  }

  if (typeof schema.default === "boolean") {
    return schema.default;
  }

  return (context.variant ?? 0) % 2 === 0;
}

function firstExampleOfType<T>(
  schema: JSONSchema7,
  type: "string" | "number" | "boolean",
): T | undefined {
  if (Array.isArray(schema.examples)) {
    const match = (schema.examples as Array<unknown>).find(
      (candidate): candidate is T => typeof candidate === type,
    );
    if (match !== undefined) {
      return match;
    }
  }

  return undefined;
}

type SchemaInput = SchemaDefinition | JSONSchema7 | undefined;

function normalizeDefinition(definition?: SchemaInput): JSONSchema7 {
  if (definition === undefined || definition === true) {
    return {};
  }

  if (definition === false) {
    return {};
  }

  return definition;
}

function clampLength(minItems?: number) {
  if (typeof minItems === "number" && minItems > DEFAULT_ARRAY_EXAMPLE_LENGTH) {
    return DEFAULT_ARRAY_EXAMPLE_LENGTH;
  }

  if (typeof minItems === "number" && minItems > 0) {
    return minItems;
  }

  return DEFAULT_ARRAY_EXAMPLE_LENGTH;
}

function resolveType(schema: JSONSchema7) {
  const type = schema.type;
  if (Array.isArray(type)) {
    return type.find((entry) => entry !== "null") ?? type[0];
  }

  if (!type) {
    if (schema.properties) {
      return "object";
    }

    if (schema.items) {
      return "array";
    }
  }

  return type;
}

function sanitizeKey(key?: string) {
  if (!key) {
    return "value";
  }

  const sanitized = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || "value";
}

function increaseDepth(context: ExampleContext, depth: number): ExampleContext {
  return {
    ...context,
    depth: depth + 1,
  };
}
