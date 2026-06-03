import {
  generateText,
  streamText,
  Output,
  jsonSchema,
  type LanguageModel,
  type ToolSet,
  type GenerateTextResult,
  type StreamTextResult,
} from "ai";

import { RuntimeStore, type RuntimeState } from "../runtime/store.js";
import { applyDefaultStopWhen } from "./toolDefaults.js";
import { combineTelemetryOverrides, mergeTelemetryConfig } from "./telemetry.js";

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
import { setExperimentalOutput } from "./experimentalOutput.js";
import { getJsonSchemaFromStructuredOutput } from "./structuredOutputSchema.js";
import {
  normalizeKeysToSchema,
  resolveResilienceConfig,
  resolveResilientObject,
  type ResilienceConfig,
} from "./structuredOutputResilience.js";

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
  telemetryDefaults?: AgentTelemetryOverrides;
  agentName?: string;
  loopToolsEnabled: boolean;
  resilienceConfig?: ResilienceConfig;
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
  telemetryDefaults?: AgentTelemetryOverrides;
  agentName?: string;
  loopToolsEnabled: boolean;
  resilienceConfig?: ResilienceConfig;
}

interface StructuredDirectGenerateParams<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState = RuntimeState,
> {
  model: LanguageModel;
  system?: string;
  structuredOutput: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
  options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>;
  telemetryEnabled: boolean;
  telemetryDefaults?: AgentTelemetryOverrides;
  agentName?: string;
  resilienceConfig?: ResilienceConfig;
}

export function shouldUseStructuredPipeline<OUTPUT, PARTIAL_OUTPUT>(
  model: LanguageModel,
  tools: AgentTools,
  structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>,
  options?: { toon?: boolean },
): structuredOutput is StructuredOutput<OUTPUT, PARTIAL_OUTPUT> {
  if (options?.toon) {
    return false;
  }

  // The AI SDK's `Output.object()` result identifies itself via `name`
  // ("object"), while hand-built structured outputs may use `type`. Accept
  // either, consistent with getJsonSchemaFromStructuredOutput.
  const kind = structuredOutput?.type ?? structuredOutput?.name;
  if (!structuredOutput || kind !== "object") {
    return false;
  }

  return (getProvider(model)?.toLowerCase() ?? "") !== OPENAI_PROVIDER_ID;
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
    telemetryDefaults,
    agentName,
    loopToolsEnabled,
    resilienceConfig,
  } = params;

  const originalPrompt = "prompt" in options ? options.prompt : undefined;
  const originalMessages = "messages" in options ? options.messages : undefined;

    const textResult = await callGenerateText<OUTPUT, PARTIAL_OUTPUT, STATE>({
      model,
      system,
      tools,
      options,
      telemetryEnabled,
      telemetryDefaults,
      agentName,
      loopToolsEnabled,
    });

  const jsonSchemaObject = await getJsonSchemaFromStructuredOutput(
    structuredOutput,
  );
  const schema = jsonSchema(jsonSchemaObject);
  const structuringMessages = buildStructuringMessages({
    text: textResult.text,
    originalPrompt,
    originalMessages,
  });
  const objectCallSettings = extractObjectCallSettings(
    options as unknown as Partial<GenerateTextParams>,
  );

  const runStructuredObjectCall = (messages: ModelMessages) =>
    generateStructuredObject({ model, system, schema, messages, objectCallSettings });

  const initialObject = await runStructuredObjectCall(structuringMessages);

  const resilient = await resolveResilientObject({
    initialObject,
    schema: jsonSchemaObject,
    config: resilienceConfig ?? resolveResilienceConfig({}),
    requery: ({ instruction, previousObject }) =>
      runStructuredObjectCall(
        appendRepairTurn(structuringMessages, instruction, previousObject),
      ),
  });

  setExperimentalOutput(textResult, resilient as OUTPUT);

  return textResult;
}

export async function generateWithDirectStructuredObject<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState = RuntimeState,
>(
  params: StructuredDirectGenerateParams<OUTPUT, PARTIAL_OUTPUT, STATE>,
) {
  const {
    model,
    system,
    structuredOutput,
    options,
    telemetryEnabled,
    telemetryDefaults,
    agentName,
    resilienceConfig,
  } = params;

  const jsonSchemaObject = await getJsonSchemaFromStructuredOutput(
    structuredOutput,
  );
  const schema = jsonSchema(jsonSchemaObject);

  const textResult = await callGenerateTextDirect({
    model,
    system,
    options,
    telemetryEnabled,
    telemetryDefaults,
    agentName,
    schema,
  });

  const objectCallSettings = extractObjectCallSettings(
    options as unknown as Partial<GenerateTextParams>,
  );
  const baseMessages = deriveBaseMessages(options);

  const resilient = await resolveResilientObject({
    initialObject: textResult.output as unknown,
    schema: jsonSchemaObject,
    config: resilienceConfig ?? resolveResilienceConfig({}),
    requery: ({ instruction, previousObject }) =>
      generateStructuredObject({
        model,
        system,
        schema,
        messages: appendRepairTurn(baseMessages, instruction, previousObject),
        objectCallSettings,
      }),
  });

  setExperimentalOutput(textResult, resilient as OUTPUT);

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
    telemetryDefaults,
    agentName,
    loopToolsEnabled,
    resilienceConfig,
  } = params;

  const originalPrompt = "prompt" in options ? options.prompt : undefined;
  const originalMessages = "messages" in options ? options.messages : undefined;

  const streamResult = await callStreamText<OUTPUT, PARTIAL_OUTPUT, STATE>({
    model,
    system,
    tools,
    options,
    telemetryEnabled,
    telemetryDefaults,
    agentName,
    loopToolsEnabled,
  });

  const jsonSchemaObject = await getJsonSchemaFromStructuredOutput(
    structuredOutput,
  );
  const schema = jsonSchema(jsonSchemaObject);
  const config = resilienceConfig ?? resolveResilienceConfig({});
  let pipelineError: unknown;

  const objectStreamPromise = (async () => {
    const text = await streamResult.text;
    const structuringMessages = buildStructuringMessages({
      text,
      originalPrompt,
      originalMessages,
    });

    const objectStream = await streamText({
      ...extractObjectCallSettings(
        options as unknown as Partial<GenerateTextParams>,
      ),
      model,
      system,
      messages: structuringMessages,
      output: Output.object({ schema }),
    });

    try {
      const finalObject = await objectStream.output;
      const normalized = config.normalizeKeys
        ? normalizeKeysToSchema(finalObject, jsonSchemaObject)
        : finalObject;
      setExperimentalOutput(streamResult, normalized as OUTPUT);
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
        return objectStream.partialOutputStream ?? EMPTY_ASYNC_ITERABLE;
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

function getProvider(model: LanguageModel): string | undefined {
  return typeof model === "string" ? undefined : model.provider;
}

/**
 * Runs a single structuring object generation and returns the produced object
 * (unvalidated — the schema passed to `Output.object` here is a bare JSON
 * schema, so resilience layers downstream own validation).
 */
async function generateStructuredObject({
  model,
  system,
  schema,
  messages,
  objectCallSettings,
}: {
  model: LanguageModel;
  system?: string;
  schema: ReturnType<typeof jsonSchema>;
  messages: ModelMessages;
  objectCallSettings: ReturnType<typeof extractObjectCallSettings>;
}): Promise<unknown> {
  const objectResult = await generateText({
    ...objectCallSettings,
    model,
    system,
    messages,
    output: Output.object({ schema }),
  });

  return objectResult.output as unknown;
}

/** Appends the repair re-query (issues + expected keys + prior JSON) as a user turn. */
function appendRepairTurn(
  messages: ModelMessages,
  instruction: string,
  previousObject: unknown,
): ModelMessages {
  return [
    ...messages,
    {
      role: "user",
      content: `${instruction}\n\nPrevious response:\n${JSON.stringify(
        previousObject,
      )}`,
    },
  ];
}

/** Conversation to re-send when repairing a direct (single-pass) structured call. */
function deriveBaseMessages(options: {
  prompt?: GenerateTextParams["prompt"];
  messages?: GenerateTextParams["messages"];
}): ModelMessages {
  if (options.messages !== undefined) {
    return options.messages as ModelMessages;
  }

  const content = flattenPrompt(options.prompt);
  if (content !== undefined) {
    return [{ role: "user", content }];
  }

  return [];
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
  const messageList = originalMessages as ModelMessages | undefined;
  const latestUser = extractLatestUserContent(messageList);

  if (!latestUser && messageList && messageList.length > 0) {
    return [
      ...messageList,
      {
        role: "assistant",
        content: text,
      },
    ];
  }

  const userContent =
    flattenPrompt(originalPrompt) ?? latestUser ?? text;

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
  telemetryDefaults,
  agentName,
  loopToolsEnabled,
}: {
  model: LanguageModel;
  system?: string;
  tools?: AgentTools;
  options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>;
  telemetryEnabled: boolean;
  telemetryDefaults?: AgentTelemetryOverrides;
  agentName?: string;
  loopToolsEnabled: boolean;
}): Promise<GenerateTextResult<ToolSet, any>> {
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
      normalizeStructuredKeys: _normalizeStructuredKeys,
      structuredOutputRepair: _structuredOutputRepair,
      ...restWithoutContext
    } = rest as {
      experimental_context?: unknown;
      telemetry?: AgentTelemetryOverrides;
      experimental_telemetry?: GenerateTextParams["experimental_telemetry"];
    } & typeof rest & {
      loopTools?: unknown;
      maxStepTools?: unknown;
      normalizeStructuredKeys?: unknown;
      structuredOutputRepair?: unknown;
    };
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
      overrides: combineTelemetryOverrides(telemetryDefaults, telemetryOverrides),
      existing: experimental_telemetry,
      agentName,
    });

    if (mergedTelemetry !== undefined) {
      payload.experimental_telemetry = mergedTelemetry;
    }

    return generateText(payload) as Promise<GenerateTextResult<ToolSet, any>>;
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
      normalizeStructuredKeys: _normalizeStructuredKeys,
      structuredOutputRepair: _structuredOutputRepair,
      ...restWithoutContext
    } = rest as {
      experimental_context?: unknown;
      telemetry?: AgentTelemetryOverrides;
      experimental_telemetry?: GenerateTextParams["experimental_telemetry"];
    } & typeof rest & {
      loopTools?: unknown;
      maxStepTools?: unknown;
      normalizeStructuredKeys?: unknown;
      structuredOutputRepair?: unknown;
    };
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
      overrides: combineTelemetryOverrides(telemetryDefaults, telemetryOverrides),
      existing: experimental_telemetry,
      agentName,
    });

    if (mergedTelemetry !== undefined) {
      payload.experimental_telemetry = mergedTelemetry;
    }

    return generateText(payload) as Promise<GenerateTextResult<ToolSet, any>>;
  }

  throw new Error("Structured pipeline requires prompt or messages.");
}

async function callGenerateTextDirect<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState,
>({
  model,
  system,
  options,
  telemetryEnabled,
  telemetryDefaults,
  agentName,
  schema,
}: {
  model: LanguageModel;
  system?: string;
  options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT, STATE>;
  telemetryEnabled: boolean;
  telemetryDefaults?: AgentTelemetryOverrides;
  agentName?: string;
  schema: ReturnType<typeof jsonSchema>;
}): Promise<GenerateTextResult<ToolSet, any>> {
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
      normalizeStructuredKeys: _normalizeStructuredKeys,
      structuredOutputRepair: _structuredOutputRepair,
      ...restWithoutContext
    } = rest as {
      experimental_context?: unknown;
      telemetry?: AgentTelemetryOverrides;
      experimental_telemetry?: GenerateTextParams["experimental_telemetry"];
    } & typeof rest & {
      normalizeStructuredKeys?: unknown;
      structuredOutputRepair?: unknown;
    };

    const payload = {
      ...restWithoutContext,
      model,
      system,
      output: Output.object({ schema }),
    } as Omit<WithPrompt<GenerateTextParams>, "experimental_output"> & {
      experimental_context?: unknown;
      experimental_telemetry?: GenerateTextParams["experimental_telemetry"];
      output: unknown;
    };

    const mergedContext = RuntimeStore.mergeExperimentalContext(
      experimental_context,
      runtime,
    );

    if (mergedContext !== undefined) {
      payload.experimental_context = mergedContext;
    }

    const mergedTelemetry = mergeTelemetryConfig({
      agentTelemetryEnabled: telemetryEnabled,
      overrides: combineTelemetryOverrides(telemetryDefaults, telemetryOverrides),
      existing: experimental_telemetry,
      agentName,
    });

    if (mergedTelemetry !== undefined) {
      payload.experimental_telemetry = mergedTelemetry;
    }

    return generateText(payload) as Promise<GenerateTextResult<ToolSet, any>>;
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
      normalizeStructuredKeys: _normalizeStructuredKeys,
      structuredOutputRepair: _structuredOutputRepair,
      ...restWithoutContext
    } = rest as {
      experimental_context?: unknown;
      telemetry?: AgentTelemetryOverrides;
      experimental_telemetry?: GenerateTextParams["experimental_telemetry"];
    } & typeof rest & {
      normalizeStructuredKeys?: unknown;
      structuredOutputRepair?: unknown;
    };

    const payload = {
      ...restWithoutContext,
      model,
      system,
      output: Output.object({ schema }),
    } as Omit<WithMessages<GenerateTextParams>, "experimental_output"> & {
      experimental_context?: unknown;
      experimental_telemetry?: GenerateTextParams["experimental_telemetry"];
      output: unknown;
    };

    const mergedContext = RuntimeStore.mergeExperimentalContext(
      experimental_context,
      runtime,
    );

    if (mergedContext !== undefined) {
      payload.experimental_context = mergedContext;
    }

    const mergedTelemetry = mergeTelemetryConfig({
      agentTelemetryEnabled: telemetryEnabled,
      overrides: combineTelemetryOverrides(telemetryDefaults, telemetryOverrides),
      existing: experimental_telemetry,
      agentName,
    });

    if (mergedTelemetry !== undefined) {
      payload.experimental_telemetry = mergedTelemetry;
    }

    return generateText(payload) as Promise<GenerateTextResult<ToolSet, any>>;
  }

  throw new Error("Structured pipeline requires prompt or messages.");
}

function callStreamText<
  OUTPUT,
  PARTIAL_OUTPUT,
  STATE extends RuntimeState,
>({
  model,
  system,
  tools,
  options,
  telemetryEnabled,
  telemetryDefaults,
  agentName,
  loopToolsEnabled,
}: {
  model: LanguageModel;
  system?: string;
  tools?: AgentTools;
  options: AgentStreamOptions<OUTPUT, PARTIAL_OUTPUT, STATE>;
  telemetryEnabled: boolean;
  telemetryDefaults?: AgentTelemetryOverrides;
  agentName?: string;
  loopToolsEnabled: boolean;
}): StreamTextResult<ToolSet, any> {
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
      normalizeStructuredKeys: _normalizeStructuredKeys,
      structuredOutputRepair: _structuredOutputRepair,
      ...restWithoutContext
    } = rest as {
      experimental_context?: unknown;
      telemetry?: AgentTelemetryOverrides;
      experimental_telemetry?: StreamTextParams["experimental_telemetry"];
    } & typeof rest & {
      loopTools?: unknown;
      maxStepTools?: unknown;
      normalizeStructuredKeys?: unknown;
      structuredOutputRepair?: unknown;
    };
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
      overrides: combineTelemetryOverrides(telemetryDefaults, telemetryOverrides),
      existing: experimental_telemetry,
      agentName,
    });

    if (mergedTelemetry !== undefined) {
      payload.experimental_telemetry = mergedTelemetry;
    }

    return streamText(payload) as StreamTextResult<ToolSet, any>;
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
      normalizeStructuredKeys: _normalizeStructuredKeys,
      structuredOutputRepair: _structuredOutputRepair,
      ...restWithoutContext
    } = rest as {
      experimental_context?: unknown;
      telemetry?: AgentTelemetryOverrides;
      experimental_telemetry?: StreamTextParams["experimental_telemetry"];
    } & typeof rest & {
      loopTools?: unknown;
      maxStepTools?: unknown;
      normalizeStructuredKeys?: unknown;
      structuredOutputRepair?: unknown;
    };
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
      overrides: combineTelemetryOverrides(telemetryDefaults, telemetryOverrides),
      existing: experimental_telemetry,
      agentName,
    });

    if (mergedTelemetry !== undefined) {
      payload.experimental_telemetry = mergedTelemetry;
    }

    return streamText(payload) as StreamTextResult<ToolSet, any>;
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
