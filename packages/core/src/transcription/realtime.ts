// packages/core/src/transcription/realtime.ts
import type {
  RealtimeConnectOptions,
  RealtimeInternals,
  RealtimeSessionInfo,
  RealtimeTranscriptionConfig,
  RealtimeTranscriptionEvent,
  RealtimeTranscriptionModel,
  RealtimeTranscriptionSession,
  RealtimeUsage,
  WebSocketLike,
} from "./types.js";

/** Max decoded PCM bytes per `input_audio.append` frame (provider limit). */
const MAX_APPEND_BYTES = 262144;
const DEFAULT_BASE_URL = "https://api.mistral.ai/v1";
const DEFAULT_PATH = "/audio/transcriptions/realtime";
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30000;

/** Error thrown for realtime transcription transport/protocol failures. */
export class RealtimeTranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealtimeTranscriptionError";
  }
}

// --- async queue: bridges socket push events into a pull-based generator ----

interface AsyncQueue<T> {
  push(value: T): void;
  finish(): void;
  fail(err: unknown): void;
  [Symbol.asyncIterator](): AsyncGenerator<T>;
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const values: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let done = false;
  let failure: unknown;
  let hasFailure = false;

  return {
    push(value: T) {
      if (done) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ value, done: false });
      else values.push(value);
    },
    finish() {
      if (done) return;
      done = true;
      while (waiters.length) {
        waiters.shift()!({ value: undefined as unknown as T, done: true });
      }
    },
    fail(err: unknown) {
      if (done) return;
      failure = err;
      hasFailure = true;
      done = true;
      while (waiters.length) {
        waiters.shift()!({ value: undefined as unknown as T, done: true });
      }
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      while (true) {
        if (values.length) {
          yield values.shift()!;
          continue;
        }
        if (hasFailure) throw failure;
        if (done) return;
        const result = await new Promise<IteratorResult<T>>((resolve) =>
          waiters.push(resolve),
        );
        if (result.done) {
          if (hasFailure) throw failure;
          return;
        }
        yield result.value;
      }
    },
  };
}

// --- protocol helpers -------------------------------------------------------

function buildWsUrl(config: RealtimeTranscriptionConfig): string {
  const base = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const path = config.path ?? DEFAULT_PATH;
  const url = new URL(base + path);
  url.searchParams.set("model", config.modelId);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  return url.toString();
}

function normalizeSession(raw: unknown): RealtimeSessionInfo {
  const s = (raw ?? {}) as Record<string, unknown>;
  const fmt = (s.audio_format ?? {}) as Record<string, unknown>;
  return {
    requestId: typeof s.request_id === "string" ? s.request_id : "",
    model: typeof s.model === "string" ? s.model : "",
    audioFormat: {
      encoding: typeof fmt.encoding === "string" ? fmt.encoding : "pcm_s16le",
      sampleRate: typeof fmt.sample_rate === "number" ? fmt.sample_rate : 16000,
    },
  };
}

function normalizeUsage(raw: unknown): RealtimeUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  return {
    promptTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : undefined,
    completionTokens:
      typeof u.completion_tokens === "number" ? u.completion_tokens : undefined,
  };
}

function extractError(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const e = raw as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    if (e.message && typeof e.message === "object") {
      const detail = (e.message as Record<string, unknown>).detail;
      if (typeof detail === "string") return detail;
    }
    try {
      return JSON.stringify(raw);
    } catch {
      return "Realtime transcription error";
    }
  }
  return "Realtime transcription error";
}

/** Maps a raw Mistral frame to a normalized event. Never throws. */
export function normalizeEvent(payload: unknown): RealtimeTranscriptionEvent {
  if (!payload || typeof payload !== "object") {
    return { type: "unknown", raw: payload };
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.type !== "string") return { type: "unknown", raw: payload };

  switch (p.type) {
    case "session.created":
      return { type: "session.created", session: normalizeSession(p.session) };
    case "session.updated":
      return { type: "session.updated", session: normalizeSession(p.session) };
    case "transcription.text.delta":
      return { type: "delta", textDelta: typeof p.text === "string" ? p.text : "" };
    case "transcription.segment":
      return {
        type: "segment",
        text: typeof p.text === "string" ? p.text : "",
        startSecond: typeof p.start === "number" ? p.start : undefined,
        endSecond: typeof p.end === "number" ? p.end : undefined,
      };
    case "transcription.language":
      return {
        type: "language",
        language: typeof p.language === "string" ? p.language : "",
      };
    case "transcription.done":
      return {
        type: "done",
        text: typeof p.text === "string" ? p.text : "",
        usage: normalizeUsage(p.usage),
      };
    case "error":
      return { type: "error", error: extractError(p.error) };
    default:
      return { type: "unknown", raw: payload };
  }
}

function parseFrame(data: unknown): unknown {
  const text =
    typeof data === "string"
      ? data
      : data instanceof ArrayBuffer
        ? new TextDecoder().decode(data)
        : ArrayBuffer.isView(data)
          ? new TextDecoder().decode(data as ArrayBufferView)
          : String(data);
  try {
    return JSON.parse(text);
  } catch {
    return { __unparsable: text };
  }
}

function defaultWebSocketFactory(
  url: string,
  headers: Record<string, string>,
): WebSocketLike {
  const WS = (
    globalThis as { WebSocket?: new (url: string, opts?: unknown) => unknown }
  ).WebSocket;
  if (!WS) {
    throw new RealtimeTranscriptionError(
      "Global WebSocket is unavailable; requires Node >= 22 (or a browser).",
    );
  }
  return new WS(url, { headers }) as unknown as WebSocketLike;
}

async function* toAsyncIterable(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  if (Symbol.asyncIterator in source) {
    yield* source as AsyncIterable<Uint8Array>;
  } else {
    for (const chunk of source as Iterable<Uint8Array>) yield chunk;
  }
}

// --- connection / session ---------------------------------------------------

interface Connection {
  socket: WebSocketLike;
  session: RealtimeSessionInfo;
  queue: AsyncQueue<RealtimeTranscriptionEvent>;
}

async function openConnection(
  config: RealtimeTranscriptionConfig,
  options: RealtimeConnectOptions,
  factory: (url: string, headers: Record<string, string>) => WebSocketLike,
): Promise<Connection> {
  const url = buildWsUrl(config);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    ...config.headers,
    ...options.headers,
  };

  const socket = factory(url, headers);
  const queue = createAsyncQueue<RealtimeTranscriptionEvent>();

  let session: RealtimeSessionInfo | null = null;
  let settled = false;
  let resolveHandshake!: (info: RealtimeSessionInfo) => void;
  let rejectHandshake!: (err: unknown) => void;
  const handshake = new Promise<RealtimeSessionInfo>((resolve, reject) => {
    resolveHandshake = resolve;
    rejectHandshake = reject;
  });

  socket.addEventListener("message", (event: unknown) => {
    const data = (event as { data?: unknown }).data ?? event;
    const normalized = normalizeEvent(parseFrame(data));
    if (normalized.type === "session.created" && !session) {
      session = normalized.session;
      settled = true;
      resolveHandshake(normalized.session);
    } else if (normalized.type === "session.updated") {
      session = normalized.session;
    }
    queue.push(normalized);
  });

  socket.addEventListener("error", () => {
    const err = new RealtimeTranscriptionError("WebSocket transport error");
    if (!settled) {
      settled = true;
      rejectHandshake(err);
    }
    queue.fail(err);
  });

  socket.addEventListener("close", () => {
    if (!settled) {
      settled = true;
      rejectHandshake(
        new RealtimeTranscriptionError("Connection closed before session.created"),
      );
    }
    queue.finish();
  });

  const timeoutMs = options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    if (!settled) {
      settled = true;
      rejectHandshake(new RealtimeTranscriptionError("Aborted"));
    }
    queue.fail(new RealtimeTranscriptionError("Aborted"));
    socket.close(1000, "aborted");
  };
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const info = await new Promise<RealtimeSessionInfo>((resolve, reject) => {
      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.close(1000, "handshake timeout");
          reject(
            new RealtimeTranscriptionError(
              `Handshake timed out after ${timeoutMs}ms`,
            ),
          );
        }
      }, timeoutMs);
      handshake.then(resolve, reject);
    });
    return { socket, session: info, queue };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function makeSession(connection: Connection): RealtimeTranscriptionSession {
  const { socket, session, queue } = connection;
  let closed = false;

  const ensureOpen = () => {
    if (closed) throw new RealtimeTranscriptionError("Connection is closed");
  };

  return {
    requestId: session.requestId,
    model: session.model,
    audioFormat: session.audioFormat,
    get closed() {
      return closed;
    },
    async sendAudio(chunk: Uint8Array) {
      ensureOpen();
      for (let offset = 0; offset < chunk.byteLength; offset += MAX_APPEND_BYTES) {
        const slice = chunk.subarray(
          offset,
          Math.min(offset + MAX_APPEND_BYTES, chunk.byteLength),
        );
        const audio = Buffer.from(
          slice.buffer,
          slice.byteOffset,
          slice.byteLength,
        ).toString("base64");
        socket.send(JSON.stringify({ type: "input_audio.append", audio }));
      }
    },
    async flush() {
      ensureOpen();
      socket.send(JSON.stringify({ type: "input_audio.flush" }));
    },
    async end() {
      if (closed) return;
      socket.send(JSON.stringify({ type: "input_audio.end" }));
    },
    async close(code = 1000, reason = "") {
      if (closed) return;
      closed = true;
      socket.close(code, reason);
      queue.finish();
    },
    events() {
      return queue[Symbol.asyncIterator]();
    },
    [Symbol.asyncIterator]() {
      return queue[Symbol.asyncIterator]();
    },
  };
}

// --- public factory ---------------------------------------------------------

/**
 * Creates a realtime (full-duplex WebSocket) transcription model. Generic and
 * config-driven; defaults target Mistral's realtime API. See also
 * {@link mistralRealtimeTranscription} for a Mistral-first shortcut.
 */
export function createRealtimeTranscription(
  config: RealtimeTranscriptionConfig,
  internals: RealtimeInternals = {},
): RealtimeTranscriptionModel {
  const factory = internals.webSocketFactory ?? defaultWebSocketFactory;
  const provider = config.providerName ?? "mistral";

  async function connect(
    options: RealtimeConnectOptions = {},
  ): Promise<RealtimeTranscriptionSession> {
    const connection = await openConnection(config, options, factory);

    if (options.audioFormat || options.targetStreamingDelayMs != null) {
      const sessionPayload: Record<string, unknown> = {};
      if (options.audioFormat) {
        sessionPayload.audio_format = {
          encoding: options.audioFormat.encoding ?? "pcm_s16le",
          sample_rate: options.audioFormat.sampleRate ?? 16000,
        };
      }
      if (options.targetStreamingDelayMs != null) {
        sessionPayload.target_streaming_delay_ms = options.targetStreamingDelayMs;
      }
      connection.socket.send(
        JSON.stringify({ type: "session.update", session: sessionPayload }),
      );
    }

    return makeSession(connection);
  }

  async function* transcribeStream(
    audioStream: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    options: RealtimeConnectOptions = {},
  ): AsyncGenerator<RealtimeTranscriptionEvent> {
    const session = await connect(options);

    const pump = (async () => {
      try {
        for await (const chunk of toAsyncIterable(audioStream)) {
          if (session.closed) break;
          await session.sendAudio(chunk);
        }
        if (!session.closed) {
          await session.flush();
          await session.end();
        }
      } catch {
        // Surfaced through the event stream / socket lifecycle.
      }
    })();

    try {
      for await (const event of session.events()) {
        yield event;
        if (event.type === "done" || event.type === "error") break;
      }
    } finally {
      await session.close();
      await pump.catch(() => {});
    }
  }

  return {
    modelId: config.modelId,
    provider,
    connect,
    transcribeStream,
  };
}
