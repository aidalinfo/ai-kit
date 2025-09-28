import {
  generateObject,
  generateText,
  streamObject,
  streamText,
  type LanguageModel,
  type ToolSet,
  type GenerateTextResult,
  type StreamTextResult,
} from "ai";
import { jsonSchema } from "@ai-sdk/provider-utils";
import type { JSONSchema7 } from "@ai-sdk/provider";

import {
  type AgentGenerateOptions,
  type AgentStreamOptions,
  type GenerateTextParams,
  type StreamTextParams,
  type StructuredOutput,
  type WithMessages,
  type WithPrompt,
} from "./types";

const OPENAI_PROVIDER_ID = "openai";

type ModelMessages = NonNullable<GenerateTextParams["messages"]>;

interface StructuredGeneratePipelineParams<OUTPUT, PARTIAL_OUTPUT> {
  model: LanguageModel;
  system?: string;
  tools?: ToolSet;
  structuredOutput: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
  options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT>;
}

interface StructuredStreamPipelineParams<OUTPUT, PARTIAL_OUTPUT> {
  model: LanguageModel;
  system?: string;
  tools?: ToolSet;
  structuredOutput: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
  options: AgentStreamOptions<OUTPUT, PARTIAL_OUTPUT>;
}

export function shouldUseStructuredPipeline<OUTPUT, PARTIAL_OUTPUT>(
  model: LanguageModel,
  tools: ToolSet | undefined,
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
>(
  params: StructuredGeneratePipelineParams<OUTPUT, PARTIAL_OUTPUT>,
) {
  const { model, system, tools, structuredOutput, options } = params;

  const originalPrompt = "prompt" in options ? options.prompt : undefined;
  const originalMessages = "messages" in options ? options.messages : undefined;

  const textResult = await callGenerateText<OUTPUT, PARTIAL_OUTPUT>({
    model,
    system,
    tools,
    options,
  });

  const schema = createSchemaFromStructuredOutput(structuredOutput);
  const structuringMessages = buildStructuringMessages({
    text: textResult.text,
    originalPrompt,
    originalMessages,
  });

  const objectResult = await generateObject({
    ...extractObjectCallSettings(
      options as unknown as Partial<GenerateTextParams>,
    ),
    model,
    system,
    messages: structuringMessages,
    schema,
  });

  (textResult as GenerateTextResult<ToolSet, OUTPUT> & {
    resolvedOutput?: OUTPUT;
  }).resolvedOutput = objectResult.object as OUTPUT;

  return textResult;
}

export async function streamWithStructuredPipeline<
  OUTPUT,
  PARTIAL_OUTPUT,
>(
  params: StructuredStreamPipelineParams<OUTPUT, PARTIAL_OUTPUT>,
) {
  const { model, system, tools, structuredOutput, options } = params;

  const originalPrompt = "prompt" in options ? options.prompt : undefined;
  const originalMessages = "messages" in options ? options.messages : undefined;

  const streamResult = await callStreamText<OUTPUT, PARTIAL_OUTPUT>({
    model,
    system,
    tools,
    options,
  });

  const schema = createSchemaFromStructuredOutput(structuredOutput);
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
      (streamResult as StreamTextResult<ToolSet, PARTIAL_OUTPUT> & {
        resolvedOutput?: OUTPUT;
      }).resolvedOutput = finalObject as OUTPUT;
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

function hasTools(tools: ToolSet | undefined): boolean {
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

  return jsonSchema(schema);
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
      .map((message) => flattenMessageContent(message.content))
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

async function callGenerateText<OUTPUT, PARTIAL_OUTPUT>({
  model,
  system,
  tools,
  options,
}: {
  model: LanguageModel;
  system?: string;
  tools?: ToolSet;
  options: AgentGenerateOptions<OUTPUT, PARTIAL_OUTPUT>;
}): Promise<GenerateTextResult<ToolSet, OUTPUT>> {
  if ("prompt" in options && options.prompt !== undefined) {
    const {
      system: _system,
      structuredOutput: _structured,
      experimental_output: _experimental,
      ...rest
    } =
      options as WithPrompt<GenerateTextParams> & {
        structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
      };
    const payload = {
      ...rest,
      model,
      system,
      ...(tools ? { tools } : {}),
    } satisfies WithPrompt<GenerateTextParams>;

    return generateText<ToolSet, OUTPUT>(payload);
  }

  if ("messages" in options && options.messages !== undefined) {
    const {
      system: _system,
      structuredOutput: _structured,
      experimental_output: _experimental,
      ...rest
    } =
      options as WithMessages<GenerateTextParams> & {
        structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
      };
    const payload = {
      ...rest,
      model,
      system,
      ...(tools ? { tools } : {}),
    } satisfies WithMessages<GenerateTextParams>;

    return generateText<ToolSet, OUTPUT>(payload);
  }

  throw new Error("Structured pipeline requires prompt or messages.");
}

async function callStreamText<OUTPUT, PARTIAL_OUTPUT>({
  model,
  system,
  tools,
  options,
}: {
  model: LanguageModel;
  system?: string;
  tools?: ToolSet;
  options: AgentStreamOptions<OUTPUT, PARTIAL_OUTPUT>;
}): Promise<StreamTextResult<ToolSet, PARTIAL_OUTPUT>> {
  if ("prompt" in options && options.prompt !== undefined) {
    const {
      system: _system,
      structuredOutput: _structured,
      experimental_output: _experimental,
      ...rest
    } =
      options as WithPrompt<StreamTextParams> & {
        structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
      };
    const payload = {
      ...rest,
      model,
      system,
      ...(tools ? { tools } : {}),
    } satisfies WithPrompt<StreamTextParams>;
    return streamText<ToolSet, OUTPUT, PARTIAL_OUTPUT>(payload);
  }

  if ("messages" in options && options.messages !== undefined) {
    const {
      system: _system,
      structuredOutput: _structured,
      experimental_output: _experimental,
      ...rest
    } =
      options as WithMessages<StreamTextParams> & {
        structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
      };
    const payload = {
      ...rest,
      model,
      system,
      ...(tools ? { tools } : {}),
    } satisfies WithMessages<StreamTextParams>;

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
