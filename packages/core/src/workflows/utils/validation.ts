import type { SchemaLike } from "../types.js";
import { WorkflowSchemaError } from "../errors.js";

export const hasFunction = <T extends object, K extends keyof T>(
  value: T | undefined,
  key: K,
): value is T & Record<K, (...args: unknown[]) => unknown> => {
  return Boolean(value && typeof value[key] === "function");
};

export const parseWithSchema = <T>(schema: SchemaLike<T> | undefined, value: unknown, context: string): T => {
  if (!schema) {
    return value as T;
  }

  if (hasFunction(schema, "safeParse")) {
    const result = schema.safeParse(value);
    if (result.success) {
      return result.data;
    }

    throw new WorkflowSchemaError(`Schema validation failed for ${context}`, result.error);
  }

  if (hasFunction(schema, "parse")) {
    return schema.parse(value);
  }

  throw new WorkflowSchemaError(
    `Schema validation failed for ${context}`,
    new Error("Schema must expose parse or safeParse"),
  );
};
