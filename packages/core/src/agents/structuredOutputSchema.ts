import type { JSONSchema7 } from "ai";

import type { StructuredOutput } from "./types.js";

export async function getJsonSchemaFromStructuredOutput(
  structuredOutput: StructuredOutput<unknown, unknown>,
): Promise<JSONSchema7> {
  const kind = (structuredOutput.type ?? structuredOutput.name) as string | undefined;
  if (kind && kind !== "object") {
    throw new Error(
      "Structured output pipeline requires an object structured output.",
    );
  }

  const responseFormat = await Promise.resolve(structuredOutput.responseFormat);
  const schema = (responseFormat as { schema?: JSONSchema7 } | undefined)?.schema;

  if (!schema) {
    throw new Error(
      "Structured output pipeline requires a JSON schema on the response format.",
    );
  }

  return schema;
}
