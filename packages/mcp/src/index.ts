import { Buffer } from "node:buffer";
import type { Readable, Writable } from "node:stream";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ContentBlock,
  GetPromptResult,
  PromptMessage,
  ReadResourceResult,
  ServerNotification,
  ServerRequest,
  Implementation,
  ToolAnnotations
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CompleteResourceTemplateCallback,
  ListResourcesCallback,
  ResourceMetadata
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { ZodObject, z, type ZodRawShape } from "zod";

type MaybePromise<T> = T | Promise<T>;

export type ToolContext = RequestHandlerExtra<ServerRequest, ServerNotification>;
export type ResourceContext = RequestHandlerExtra<ServerRequest, ServerNotification>;
export type PromptContext = RequestHandlerExtra<ServerRequest, ServerNotification>;

type ToolSchema = ZodRawShape | ZodObject<any>;
type PromptSchema = ZodRawShape | ZodObject<any>;

type InferFromSchema<S> = S extends ZodObject<infer Shape>
  ? z.infer<ZodObject<Shape>>
  : S extends ZodRawShape
    ? z.infer<ZodObject<S>>
    : never;

type ToolExecutionResult = CallToolResult | ContentBlock[] | string | string[];
type ResourceExecutionResult = ReadResourceResult | string | Buffer | Uint8Array;
type PromptExecutionResult = GetPromptResult | PromptMessage[] | string;

export type ToolHandler<S extends ToolSchema | undefined> = S extends undefined
  ? (context: ToolContext) => MaybePromise<ToolExecutionResult>
  : (args: InferFromSchema<S>, context: ToolContext) => MaybePromise<ToolExecutionResult>;

export type PromptHandler<S extends PromptSchema | undefined> = S extends undefined
  ? (context: PromptContext) => MaybePromise<PromptExecutionResult>
  : (args: InferFromSchema<S>, context: PromptContext) => MaybePromise<PromptExecutionResult>;

export interface ToolDefinition<
  InputSchema extends ToolSchema | undefined = undefined,
  OutputSchema extends ToolSchema | undefined = undefined
> {
  title?: string;
  description?: string;
  inputSchema?: InputSchema;
  outputSchema?: OutputSchema;
  annotations?: ToolAnnotations;
  meta?: Record<string, unknown>;
  handler: ToolHandler<InputSchema>;
}

export interface StaticResourceDefinition {
  uri: string;
  metadata?: ResourceMetadata;
  read: (params: { uri: URL; context: ResourceContext }) => MaybePromise<ResourceExecutionResult>;
}

export interface TemplateResourceDefinition {
  template: string | ResourceTemplate;
  metadata?: ResourceMetadata;
  list?: ListResourcesCallback;
  complete?: Record<string, CompleteResourceTemplateCallback>;
  read: (params: {
    uri: URL;
    variables: Variables;
    context: ResourceContext;
  }) => MaybePromise<ResourceExecutionResult>;
}

export type ResourceDefinition = StaticResourceDefinition | TemplateResourceDefinition;

export interface PromptDefinition<ArgsSchema extends PromptSchema | undefined = undefined> {
  title?: string;
  description?: string;
  argsSchema?: ArgsSchema;
  handler: PromptHandler<ArgsSchema>;
}

export interface DefineMcpServerConfig {
  name: string;
  version?: string;
  implementation?: Partial<Implementation>;
  tools?: Record<string, ToolDefinition<any, any>>;
  resources?: Record<string, ResourceDefinition>;
  prompts?: Record<string, PromptDefinition<any>>;
  setup?: (server: McpServer) => MaybePromise<void>;
}

export interface CreateServerOptions {
  version?: string;
}

export interface StartStdioServerOptions extends CreateServerOptions {
  stdio?: {
    stdin?: Readable;
    stdout?: Writable;
  };
  onReady?: (context: { server: McpServer; transport: StdioServerTransport }) => void;
}

export interface DefinedMcpServer {
  readonly name: string;
  readonly config: Readonly<DefineMcpServerConfig>;
  createServer(options?: CreateServerOptions): Promise<McpServer>;
  connect(transport: Transport, options?: CreateServerOptions): Promise<McpServer>;
  startStdioServer(options?: StartStdioServerOptions): Promise<McpServer>;
}

export function defineTool<
  InputSchema extends ToolSchema | undefined,
  OutputSchema extends ToolSchema | undefined = undefined
>(definition: ToolDefinition<InputSchema, OutputSchema>): ToolDefinition<InputSchema, OutputSchema> {
  return definition;
}

export function defineResource(definition: StaticResourceDefinition): StaticResourceDefinition;
export function defineResource(definition: TemplateResourceDefinition): TemplateResourceDefinition;
export function defineResource(definition: ResourceDefinition): ResourceDefinition {
  return definition;
}

export function definePrompt<ArgsSchema extends PromptSchema | undefined>(
  definition: PromptDefinition<ArgsSchema>
): PromptDefinition<ArgsSchema> {
  return definition;
}

export function defineMcpServer(config: DefineMcpServerConfig): DefinedMcpServer {
  const frozenConfig: DefineMcpServerConfig = {
    ...config,
    tools: { ...(config.tools ?? {}) },
    resources: { ...(config.resources ?? {}) },
    prompts: { ...(config.prompts ?? {}) }
  };

  async function createServer(options?: CreateServerOptions): Promise<McpServer> {
    const resolvedVersion = options?.version ?? frozenConfig.version ?? "0.0.0";
    const implementation: Implementation = {
      ...(frozenConfig.implementation ?? {}),
      name: (frozenConfig.implementation?.name as string | undefined) ?? frozenConfig.name,
      version: resolvedVersion
    };

    const server = new McpServer(implementation);

    registerTools(server, frozenConfig.tools ?? {});
    registerResources(server, frozenConfig.resources ?? {});
    registerPrompts(server, frozenConfig.prompts ?? {});

    if (frozenConfig.setup) {
      await frozenConfig.setup(server);
    }

    return server;
  }

  async function connect(transport: Transport, options?: CreateServerOptions): Promise<McpServer> {
    const server = await createServer(options);
    await server.connect(transport);
    return server;
  }

  async function startStdioServer(options?: StartStdioServerOptions): Promise<McpServer> {
    const server = await createServer(options);
    const transport = new StdioServerTransport(options?.stdio?.stdin, options?.stdio?.stdout);
    await server.connect(transport);
    options?.onReady?.({ server, transport });
    return server;
  }

  return {
    name: frozenConfig.name,
    config: frozenConfig,
    createServer,
    connect,
    startStdioServer
  };
}

export const createMcpServer = defineMcpServer;

function registerTools(server: McpServer, tools: Record<string, ToolDefinition<any, any>>) {
  for (const [name, definition] of Object.entries(tools)) {
    const inputShape = normalizeSchema(definition.inputSchema);
    const outputShape = normalizeSchema(definition.outputSchema);

    if (inputShape === undefined) {
      const handler = definition.handler as (context: ToolContext) => MaybePromise<ToolExecutionResult>;
      server.registerTool(
        name,
        {
          title: definition.title,
          description: definition.description,
          outputSchema: outputShape,
          annotations: definition.annotations,
          _meta: definition.meta
        },
        async extra => normalizeToolResult(await handler(extra as ToolContext))
      );
      continue;
    }

    const handler = definition.handler as (
      args: Record<string, unknown>,
      context: ToolContext
    ) => MaybePromise<ToolExecutionResult>;

    server.registerTool(
      name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: inputShape,
        outputSchema: outputShape,
        annotations: definition.annotations,
        _meta: definition.meta
      },
      async (args, extra) =>
        normalizeToolResult(await handler(args as Record<string, unknown>, extra as ToolContext))
    );
  }
}

function registerResources(server: McpServer, resources: Record<string, ResourceDefinition>) {
  for (const [name, definition] of Object.entries(resources)) {
    if (isTemplateResource(definition)) {
      const template =
        definition.template instanceof ResourceTemplate
          ? definition.template
          : new ResourceTemplate(definition.template, {
              list: definition.list,
              complete: definition.complete
            });

      server.registerResource(
        name,
        template,
        (definition.metadata ?? {}) as ResourceMetadata,
        async (uri, variables, context) =>
          normalizeResourceResult(
            await definition.read({
              uri,
              variables,
              context
            }),
            uri,
            definition.metadata
          )
      );
    } else {
      server.registerResource(
        name,
        definition.uri,
        (definition.metadata ?? {}) as ResourceMetadata,
        async (uri, context) =>
          normalizeResourceResult(await definition.read({ uri, context }), uri, definition.metadata)
      );
    }
  }
}

function registerPrompts(server: McpServer, prompts: Record<string, PromptDefinition<any>>) {
  for (const [name, definition] of Object.entries(prompts)) {
    const argsShape = normalizeSchema(definition.argsSchema);

    const callback =
      argsShape === undefined
        ? async extra =>
            normalizePromptResult(
              await (definition.handler as (context: PromptContext) => MaybePromise<PromptExecutionResult>)(
                extra as PromptContext
              )
            )
        : async (args: unknown, extra) =>
            normalizePromptResult(
              await (
                definition.handler as (
                  args: Record<string, unknown>,
                  context: PromptContext
                ) => MaybePromise<PromptExecutionResult>
              )(args as Record<string, unknown>, extra as PromptContext)
            );

    server.registerPrompt(
      name,
      {
        title: definition.title,
        description: definition.description,
        argsSchema: argsShape
      },
      callback as any
    );
  }
}

function normalizeSchema(schema: ToolSchema | PromptSchema | undefined): ZodRawShape | undefined {
  if (!schema) return undefined;
  if (schema instanceof ZodObject) {
    return schema.shape;
  }
  return schema;
}

function normalizeToolResult(result: ToolExecutionResult): CallToolResult {
  if (typeof result === "string") {
    return {
      content: [
        {
          type: "text",
          text: result
        }
      ]
    };
  }

  if (Array.isArray(result)) {
    if (result.every(entry => typeof entry === "string")) {
      return {
        content: (result as string[]).map(text => ({
          type: "text",
          text
        }))
      };
    }

    return {
      content: result as ContentBlock[]
    };
  }

  if (result && typeof result === "object") {
    if ("content" in result || "structuredContent" in result || "isError" in result) {
      return result as CallToolResult;
    }
  }

  return {
    content: []
  };
}

function normalizeResourceResult(
  result: ResourceExecutionResult,
  uri: URL,
  metadata?: ResourceMetadata
): ReadResourceResult {
  if (typeof result === "string") {
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: (metadata?.mimeType as string | undefined) ?? undefined,
          text: result
        }
      ]
    };
  }

  if (result instanceof Uint8Array || Buffer.isBuffer(result)) {
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: (metadata?.mimeType as string | undefined) ?? "application/octet-stream",
          blob: Buffer.from(result).toString("base64")
        }
      ]
    };
  }

  if (result && typeof result === "object" && "contents" in result) {
    return result as ReadResourceResult;
  }

  throw new Error("Invalid resource read result. Provide a string, binary data, or a ReadResourceResult.");
}

function normalizePromptResult(result: PromptExecutionResult): GetPromptResult {
  if (typeof result === "string") {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: result
          }
        }
      ]
    };
  }

  if (Array.isArray(result)) {
    if (result.every(entry => typeof entry === "string")) {
      return {
        messages: (result as string[]).map(text => ({
          role: "assistant",
          content: {
            type: "text",
            text
          }
        }))
      };
    }

    return {
      messages: result as PromptMessage[]
    };
  }

  if (result && typeof result === "object" && "messages" in result) {
    return result as GetPromptResult;
  }

  throw new Error("Invalid prompt result. Provide a string, PromptMessage[], or GetPromptResult.");
}

function isTemplateResource(definition: ResourceDefinition): definition is TemplateResourceDefinition {
  return "template" in definition;
}
