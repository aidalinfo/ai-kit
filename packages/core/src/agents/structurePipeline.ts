import {
  generateObject,
  generateText,
  streamObject,
  streamText,
  jsonSchema,
  type JSONSchema7,
  type LanguageModel,
  type ToolSet,
  type GenerateTextResult,
  type StreamTextResult,
} from "ai";

import { RuntimeStore, type RuntimeState } from "../runtime/store.js";
import { parseToon } from "../shared/utils/toon/parseToon.js";
import { applyDefaultStopWhen } from "./toolDefaults.js";
import { mergeTelemetryConfig } from "./telemetry.js";

import {
  toToolSet,
  type AgentGenerateOptions,
  type AgentStreamOptions,
  type AgentTools,
  type AgentTelemetryOverrides,
  type GenerateTextParams,
  type StreamTextParams,
  type StructuredOutput,
  type WithMessages,
  type WithPrompt,
} from "./types.js";

const OPENAI_PROVIDER_ID = "openai";

type ModelMessages = NonNullable<GenerateTextParams["messages"]>;

interface StructuredGeneratePipelineParams<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState = RuntimeState,
> {
  model: LanguageModel;
  system?: string;
  tools?: AgentTools;
  structuredOutput: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
  options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>;
  telemetryEnabled: boolean;
  loopToolsEnabled: boolean;
  toon?: boolean;
}

interface StructuredStreamPipelineParams<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState = RuntimeState,
> {
  model: LanguageModel;
  system?: string;
  tools?: AgentTools;
  structuredOutput: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
  options: AgentStreamOptions<OUTPUT, PARTIAL_OUTPUT, STATE>;
  telemetryEnabled: boolean;
  loopToolsEnabled: boolean;
  toon?: boolean;
}

export function shouldUseStructuredPipeline<OUTPUT, PARTIAL_OUTPUT>(
  model: LanguageModel,
  tools: AgentTools,
  structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>,
): structuredOutput is StructuredOutput<OUTPUT, PARTIAL_OUTPUT> {
  if (!structuredOutput || structuredOutput.type !== "object") {
    return false;
  }

  return (
    hasTools(tools) &&
    (getProvider(model)?.toLowerCase() ?? "") !== OPENAI_PROVIDER_ID
  );
}

export async function generateWithStructuredPipeline<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState = RuntimeState,
>(
  params: StructuredGeneratePipelineParams<OUTPUT, PARTIAL_OUTPUT, STATE>,
) {
  const {
    model,
    system,
    tools,
    structuredOutput,
    options,
    telemetryEnabled,
    loopToolsEnabled,
    toon,
  } = params;

  const originalPrompt = "prompt" in options ? options.prompt : undefined;
  const originalMessages = "messages" in options ? options.messages : undefined;
  const textResult = await callGenerateText<OUTPUT, PARTIAL_OUTPUT, STATE>({
    model,
    system,
    tools,
    options,
    telemetryEnabled,
    loopToolsEnabled,
  });

  const schemaDefinition = createSchemaFromStructuredOutput(structuredOutput);
  const schema = jsonSchema(schemaDefinition);
  const structuringMessages = buildStructuringMessages({
    text: textResult.text,
    originalPrompt,
    originalMessages,
  });

  const useToon = (toon ?? options.toon) ?? false;

  if (useToon) {
    const toonSystem = buildToonSystemPrompt({
      baseSystem: system,
      schema: schemaDefinition,
    });

    const toonResult = await generateText({
      ...extractObjectCallSettings(
        options as unknown as Partial<GenerateTextParams>,
      ),
      model,
      system: toonSystem,
      messages: structuringMessages,
    });

    const parsed = parseToon<OUTPUT>(toonResult.text);
    setExperimentalOutput(toonResult, parsed);

    return toonResult;
  }

  const objectResult = await generateObject({
    ...extractObjectCallSettings(
      options as unknown as Partial<GenerateTextParams>,
    ),
    model,
    system,
    messages: structuringMessages,
    schema,
  });

  setExperimentalOutput(textResult, objectResult.object as OUTPUT);

  return textResult;
}

export async function streamWithStructuredPipeline<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState = RuntimeState,
>(
  params: StructuredStreamPipelineParams<OUTPUT, PARTIAL_OUTPUT, STATE>,
) {
  const {
    model,
    system,
    tools,
    structuredOutput,
    options,
    telemetryEnabled,
    loopToolsEnabled,
    toon,
  } = params;

  const originalPrompt = "prompt" in options ? options.prompt : undefined;
  const originalMessages = "messages" in options ? options.messages : undefined;

  const streamResult = await callStreamText<OUTPUT, PARTIAL_OUTPUT, STATE>({
    model,
    system,
    tools,
    options,
    telemetryEnabled,
    loopToolsEnabled,
  });

  const schemaDefinition = createSchemaFromStructuredOutput(structuredOutput);
  const schema = jsonSchema(schemaDefinition);
  const useToon = (toon ?? options.toon) ?? false;

  if (useToon) {
    const baseText = await streamResult.text;
    const structuringMessages = buildStructuringMessages({
      text: baseText,
      originalPrompt,
      originalMessages,
    });

    const toonSystem = buildToonSystemPrompt({
      baseSystem: system,
      schema: schemaDefinition,
    });

    const toonStream = await streamText({
      ...extractObjectCallSettings(
        options as unknown as Partial<GenerateTextParams>,
      ),
      model,
      system: toonSystem,
      messages: structuringMessages,
    });

    let pipelineError: unknown;

    const parsePromise = toonStream.text
      .then((toonText) => {
        const parsed = parseToon<OUTPUT>(toonText);
        setExperimentalOutput(toonStream, parsed);
      })
      .catch((error) => {
        pipelineError = error;
        throw error;
      });

    overrideExperimentalOutputGetter(toonStream, () => pipelineError);

    Object.defineProperty(toonStream, "experimental_partialOutputStream", {
      configurable: true,
      get() {
        return EMPTY_ASYNC_ITERABLE;
      },
    });

    void parsePromise.catch(() => {
      // handled via overridden getter
    });

    return toonStream;
  }

  let pipelineError: unknown;

  const objectStreamPromise = (async () => {
    const text = await streamResult.text;
    const structuringMessages = buildStructuringMessages({
      text,
      originalPrompt,
      originalMessages,
    });

    const objectStream = await streamObject({
      ...extractObjectCallSettings(
        options as unknown as Partial<GenerateTextParams>,
      ),
      model,
      system,
      messages: structuringMessages,
      schema,
    });

    try {
      const finalObject = await objectStream.object;
      setExperimentalOutput(streamResult, finalObject as OUTPUT);
    } catch (error) {
      pipelineError = error;
      throw error;
    }

    return objectStream;
  })().catch((error) => {
    pipelineError = error;
    throw error;
  });

  overrideExperimentalOutputGetter(streamResult, () => pipelineError);

  Object.defineProperty(streamResult, "experimental_partialOutputStream", {
    configurable: true,
    get() {
      return createDeferredAsyncIterable(async () => {
        const objectStream = await objectStreamPromise;
        return objectStream.partialObjectStream ?? EMPTY_ASYNC_ITERABLE;
      });
    },
  });

  // Ensure unhandled rejections are surfaced to consumers when awaiting
  // experimental_output or the partial stream.
  void objectStreamPromise.catch(() => {
    // no-op: the error will surface through the overridden getter/iterable
  });

  return streamResult;
}

function hasTools(tools: AgentTools): boolean {
  return !!tools && Object.keys(tools).length > 0;
}

function getProvider(model: LanguageModel): string | undefined {
  return typeof model === "string" ? undefined : model.provider;
}

function createSchemaFromStructuredOutput(
  structuredOutput: StructuredOutput<unknown, unknown>,
) {
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

function buildToonSystemPrompt({
  baseSystem,
  schema,
}: {
  baseSystem?: string;
  schema: JSONSchema7;
}) {
  const schemaJson = JSON.stringify(schema, null, 2);
  const instructions = [
    "You are a formatter that converts assistant replies into Token-Oriented Object Notation (TOON).",
    "Follow these rules:",
    "- Use the JSON schema below to drive the structure of the output.",
    "- Return only valid TOON without any additional commentary or explanations.",
    "- Preserve key ordering and include every required property from the schema.",
    "- When data is missing, emit the literal null rather than omitting the key.",
  ].join("\n");

  const sections = [
    baseSystem?.trim() ? baseSystem.trim() : undefined,
    instructions,
    `JSON schema:\n${schemaJson}`,
  ].filter(Boolean) as string[];

  return sections.join("\n\n");
}

function buildStructuringMessages({
  text,
  originalPrompt,
  originalMessages,
}: {
  text: string;
  originalPrompt?: GenerateTextParams["prompt"];
  originalMessages?: GenerateTextParams["messages"];
}): NonNullable<GenerateTextParams["messages"]> {
  const userContent =
    flattenPrompt(originalPrompt) ?? extractLatestUserContent(originalMessages) ?? text;

  return [
    {
      role: "user",
      content: userContent,
    },
    {
      role: "assistant",
      content: text,
    },
  ];
}

function extractLatestUserContent(
  messages?: GenerateTextParams["messages"],
): string | undefined {
  if (!messages) return undefined;

  const messageList = messages as ModelMessages;

  for (let index = messageList.length - 1; index >= 0; index -= 1) {
    const message = messageList[index];
    if (message.role !== "user") {
      continue;
    }

    const content = message.content;
    const flattened = flattenMessageContent(content);
    if (flattened) {
      return flattened;
    }
  }

  return undefined;
}

function flattenPrompt(
  prompt: GenerateTextParams["prompt"],
): string | undefined {
  if (typeof prompt === "string") {
    return prompt;
  }

  if (Array.isArray(prompt)) {
    return (prompt as ModelMessages)
      .map((message: ModelMessages[number]) =>
        flattenMessageContent(message.content),
      )
      .filter(Boolean)
      .join("\n");
  }

  return undefined;
}

function flattenMessageContent(
  content: ModelMessages[number]["content"],
): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((part) => ("text" in part && part.text != null ? part.text : ""))
      .filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  return undefined;
}

async function callGenerateText<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState,
>({
  model,
  system,
  tools,
  options,
  telemetryEnabled,
  loopToolsEnabled,
}: {
  model: LanguageModel;
  system?: string;
  tools?: AgentTools;
  options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>;
  telemetryEnabled: boolean;
  loopToolsEnabled: boolean;
}): Promise<GenerateTextResult<ToolSet, OUTPUT>> {
  if ("prompt" in options && options.prompt !== undefined) {
    const {
      system: _system,
      structuredOutput: _structured,
      runtime,
      experimental_output: _experimental,
      ...rest
    } =
      options as WithPrompt<GenerateTextParams> & {
        structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
        runtime?: RuntimeStore<STATE>;
        telemetry?: AgentTelemetryOverrides;
      };
    const {
      experimental_context,
      telemetry: telemetryOverrides,
      experimental_telemetry,
      loopTools: _loopTools,
      maxStepTools: _maxStepTools,
      toon: _toon,
      ...restWithoutContext
    } = rest as {
      experimental_context?: unknown;
      telemetry?: AgentTelemetryOverrides;
      experimental_telemetry?: GenerateTextParams["experimental_telemetry"];
    } & typeof rest & { loopTools?: unknown; maxStepTools?: unknown };
    const toolSet = toToolSet(tools);
    const payload = {
      ...restWithoutContext,
      model,
      system,
      ...(toolSet ? { tools: toolSet } : {}),
    } as Omit<WithPrompt<GenerateTextParams>, "experimental_output"> & {
      experimental_context?: unknown;
      experimental_telemetry?: GenerateTextParams["experimental_telemetry"];
    };

    const mergedContext = RuntimeStore.mergeExperimentalContext(
      experimental_context,
      runtime,
    );

    if (mergedContext !== undefined) {
      payload.experimental_context = mergedContext;
    }

    if (loopToolsEnabled) {
      applyDefaultStopWhen(payload, tools);
    }

    const mergedTelemetry = mergeTelemetryConfig({
      agentTelemetryEnabled: telemetryEnabled,
      overrides: telemetryOverrides,
      existing: experimental_telemetry,
    });

    if (mergedTelemetry !== undefined) {
      payload.experimental_telemetry = mergedTelemetry;
    }

    return generateText<ToolSet, OUTPUT>(payload);
  }

  if ("messages" in options && options.messages !== undefined) {
    const {
      system: _system,
      structuredOutput: _structured,
      runtime,
      experimental_output: _experimental,
      ...rest
    } =
      options as WithMessages<GenerateTextParams> & {
        structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
        runtime?: RuntimeStore<STATE>;
        telemetry?: AgentTelemetryOverrides;
      };
    const {
      experimental_context,
      telemetry: telemetryOverrides,
      experimental_telemetry,
      loopTools: _loopTools,
      maxStepTools: _maxStepTools,
      toon: _toon,
      ...restWithoutContext
    } = rest as {
      experimental_context?: unknown;
      telemetry?: AgentTelemetryOverrides;
      experimental_telemetry?: GenerateTextParams["experimental_telemetry"];
    } & typeof rest & { loopTools?: unknown; maxStepTools?: unknown };
    const toolSet = toToolSet(tools);
    const payload = {
      ...restWithoutContext,
      model,
      system,
      ...(toolSet ? { tools: toolSet } : {}),
    } as Omit<WithMessages<GenerateTextParams>, "experimental_output"> & {
      experimental_context?: unknown;
      experimental_telemetry?: GenerateTextParams["experimental_telemetry"];
    };

    const mergedContext = RuntimeStore.mergeExperimentalContext(
      experimental_context,
      runtime,
    );

    if (mergedContext !== undefined) {
      payload.experimental_context = mergedContext;
    }

    if (loopToolsEnabled) {
      applyDefaultStopWhen(payload, tools);
    }

    const mergedTelemetry = mergeTelemetryConfig({
      agentTelemetryEnabled: telemetryEnabled,
      overrides: telemetryOverrides,
      existing: experimental_telemetry,
    });

    if (mergedTelemetry !== undefined) {
      payload.experimental_telemetry = mergedTelemetry;
    }

    return generateText<ToolSet, OUTPUT>(payload);
  }

  throw new Error("Structured pipeline requires prompt or messages.");
}

async function callStreamText<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState,
>({
  model,
  system,
  tools,
  options,
  telemetryEnabled,
  loopToolsEnabled,
}: {
  model: LanguageModel;
  system?: string;
  tools?: AgentTools;
  options: AgentStreamOptions<OUTPUT, PARTIAL_OUTPUT, STATE>;
  telemetryEnabled: boolean;
  loopToolsEnabled: boolean;
}): Promise<StreamTextResult<ToolSet, PARTIAL_OUTPUT>> {
  if ("prompt" in options && options.prompt !== undefined) {
    const {
      system: _system,
      structuredOutput: _structured,
      runtime,
      experimental_output: _experimental,
      ...rest
    } =
      options as WithPrompt<StreamTextParams> & {
        structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
        runtime?: RuntimeStore<STATE>;
        telemetry?: AgentTelemetryOverrides;
      };
    const {
      experimental_context,
      telemetry: telemetryOverrides,
      experimental_telemetry,
      loopTools: _loopTools,
      maxStepTools: _maxStepTools,
      toon: _toon,
      ...restWithoutContext
    } = rest as {
      experimental_context?: unknown;
      telemetry?: AgentTelemetryOverrides;
      experimental_telemetry?: StreamTextParams["experimental_telemetry"];
    } & typeof rest & { loopTools?: unknown; maxStepTools?: unknown };
    const toolSet = toToolSet(tools);
    const payload = {
      ...restWithoutContext,
      model,
      system,
      ...(toolSet ? { tools: toolSet } : {}),
    } as Omit<WithPrompt<StreamTextParams>, "experimental_output"> & {
      experimental_context?: unknown;
      experimental_telemetry?: StreamTextParams["experimental_telemetry"];
    };
    const mergedContext = RuntimeStore.mergeExperimentalContext(
      experimental_context,
      runtime,
    );

    if (mergedContext !== undefined) {
      payload.experimental_context = mergedContext;
    }

    if (loopToolsEnabled) {
      applyDefaultStopWhen(payload, tools);
    }

    const mergedTelemetry = mergeTelemetryConfig({
      agentTelemetryEnabled: telemetryEnabled,
      overrides: telemetryOverrides,
      existing: experimental_telemetry,
    });

    if (mergedTelemetry !== undefined) {
      payload.experimental_telemetry = mergedTelemetry;
    }

    return streamText<ToolSet, OUTPUT, PARTIAL_OUTPUT>(payload);
  }

  if ("messages" in options && options.messages !== undefined) {
    const {
      system: _system,
      structuredOutput: _structured,
      runtime,
      experimental_output: _experimental,
      ...rest
    } =
      options as WithMessages<StreamTextParams> & {
        structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
        runtime?: RuntimeStore<STATE>;
        telemetry?: AgentTelemetryOverrides;
      };
    const {
      experimental_context,
      telemetry: telemetryOverrides,
      experimental_telemetry,
      loopTools: _loopTools,
      maxStepTools: _maxStepTools,
      toon: _toon,
      ...restWithoutContext
    } = rest as {
      experimental_context?: unknown;
      telemetry?: AgentTelemetryOverrides;
      experimental_telemetry?: StreamTextParams["experimental_telemetry"];
    } & typeof rest & { loopTools?: unknown; maxStepTools?: unknown };
    const toolSet = toToolSet(tools);
    const payload = {
      ...restWithoutContext,
      model,
      system,
      ...(toolSet ? { tools: toolSet } : {}),
    } as Omit<WithMessages<StreamTextParams>, "experimental_output"> & {
      experimental_context?: unknown;
      experimental_telemetry?: StreamTextParams["experimental_telemetry"];
    };

    const mergedContext = RuntimeStore.mergeExperimentalContext(
      experimental_context,
      runtime,
    );

    if (mergedContext !== undefined) {
      payload.experimental_context = mergedContext;
    }

    if (loopToolsEnabled) {
      applyDefaultStopWhen(payload, tools);
    }

    const mergedTelemetry = mergeTelemetryConfig({
      agentTelemetryEnabled: telemetryEnabled,
      overrides: telemetryOverrides,
      existing: experimental_telemetry,
    });

    if (mergedTelemetry !== undefined) {
      payload.experimental_telemetry = mergedTelemetry;
    }

    return streamText<ToolSet, OUTPUT, PARTIAL_OUTPUT>(payload);
  }

  throw new Error("Structured pipeline requires prompt or messages.");
}

function extractObjectCallSettings(options: Partial<GenerateTextParams>) {
  const {
    maxOutputTokens,
    temperature,
    topP,
    topK,
    presencePenalty,
    frequencyPenalty,
    seed,
    maxRetries,
    abortSignal,
    headers,
    providerOptions,
  } = options as GenerateTextParams;

  return pickDefined({
    maxOutputTokens,
    temperature,
    topP,
    topK,
    presencePenalty,
    frequencyPenalty,
    seed,
    maxRetries,
    abortSignal,
    headers,
    providerOptions,
  });
}

const EMPTY_ASYNC_ITERABLE = {
  async *[Symbol.asyncIterator]() {},
};

function createDeferredAsyncIterable<T>(
  factory: () => Promise<AsyncIterable<T>>,
): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      const iterable = await factory();
      for await (const value of iterable) {
        yield value;
      }
    },
  };
}

function pickDefined<T extends Record<string, unknown>>(input: T) {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

function overrideExperimentalOutputGetter(
  streamResult: unknown,
  getError: () => unknown,
) {
  const prototype = Object.getPrototypeOf(streamResult);
  if (!prototype) return;

  const descriptor = Object.getOwnPropertyDescriptor(
    prototype,
    "experimental_output",
  );

  const getter = descriptor?.get;
  if (!getter) {
    return;
  }

  Object.defineProperty(streamResult, "experimental_output", {
    configurable: true,
    get() {
      const error = getError();
      if (error) {
        throw error;
      }
      return getter.call(this);
    },
  });
}

function setExperimentalOutput<OUTPUT>(result: unknown, output: OUTPUT) {
  Object.defineProperty(result as object, "experimental_output", {
    configurable: true,
    enumerable: false,
    value: output,
    writable: false,
  });
}
