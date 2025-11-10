import type { JSONSchema7 } from "ai";

import type { StructuredOutput } from "./types.js";

export function getJsonSchemaFromStructuredOutput(
  structuredOutput: StructuredOutput<unknown, unknown>,
): JSONSchema7 {
  if (structuredOutput.type !== "object") {
    throw new Error(
      "Structured output pipeline requires an object structured output.",
    );
  }

  const schema = (structuredOutput.responseFormat as {
    schema?: JSONSchema7;
  }).schema;

  if (!schema) {
    throw new Error(
      "Structured output pipeline requires a JSON schema on the response format.",
    );
  }

  return schema;
}
