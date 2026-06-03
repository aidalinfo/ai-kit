// packages/core/src/transcription/realtime.test.ts
import { describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { createRealtimeTranscription } from "./realtime.js";
import { mistralRealtimeTranscription } from "./mistral.js";
import type { RealtimeTranscriptionEvent, WebSocketLike } from "./types.js";

interface MockServerOptions {
  behavior?: "ok" | "error" | "unknown" | "silent";
  deltas?: string[];
  finalText?: string;
}

interface MockServer {
  baseURL: string;
  received: Array<Record<string, unknown>>;
  lastConnection: { authorization?: string; url?: string };
  close(): Promise<void>;
}

/**
 * A local WebSocket server that speaks the exact Mistral realtime frames, so
 * the real client (global WebSocket) is exercised end-to-end without network.
 */
async function startMockServer(opts: MockServerOptions = {}): Promise<MockServer> {
  const received: Array<Record<string, unknown>> = [];
  const lastConnection: { authorization?: string; url?: string } = {};
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const port = (wss.address() as AddressInfo).port;

  wss.on("connection", (socket: WsWebSocket, req) => {
    lastConnection.authorization = req.headers["authorization"] as string | undefined;
    lastConnection.url = req.url;
    if (opts.behavior === "silent") return; // never sends session.created → handshake timeout

    const model =
      new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("model") ?? "unknown";
    const sessionPayload = {
      request_id: "sess-test",
      model,
      audio_format: { encoding: "pcm_s16le", sample_rate: 16000 },
    };
    socket.send(JSON.stringify({ type: "session.created", session: sessionPayload }));

    if (opts.behavior === "error") {
      socket.send(JSON.stringify({ type: "error", error: "boom" }));
      return;
    }
    if (opts.behavior === "unknown") {
      socket.send(JSON.stringify({ type: "transcription.future_thing", foo: 1 }));
      return;
    }

    socket.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      received.push(msg);
      if (msg.type === "session.update") {
        socket.send(
          JSON.stringify({ type: "session.updated", session: sessionPayload }),
        );
      }
      if (msg.type === "input_audio.end") {
        for (const d of opts.deltas ?? ["hello "]) {
          socket.send(JSON.stringify({ type: "transcription.text.delta", text: d }));
        }
        socket.send(
          JSON.stringify({
            type: "transcription.done",
            model,
            text: opts.finalText ?? "hello world",
            usage: { prompt_tokens: 1, completion_tokens: 2 },
          }),
        );
      }
    });
  });

  return {
    baseURL: `http://127.0.0.1:${port}`,
    received,
    lastConnection,
    close: () =>
      new Promise<void>((resolve) => {
        // Force-close any client still connected (low-level tests may break the
        // event loop without closing the session), so wss.close() can complete.
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}

async function collect(
  stream: AsyncIterable<RealtimeTranscriptionEvent>,
): Promise<RealtimeTranscriptionEvent[]> {
  const events: RealtimeTranscriptionEvent[] = [];
  for await (const ev of stream) events.push(ev);
  return events;
}

/** A fake WebSocket that immediately reports session.created (no real network). */
function fakeSocket(model: string): WebSocketLike {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  setTimeout(() => {
    const created = {
      data: JSON.stringify({
        type: "session.created",
        session: {
          request_id: "fake",
          model,
          audio_format: { encoding: "pcm_s16le", sample_rate: 16000 },
        },
      }),
    };
    for (const l of listeners.message ?? []) l(created);
  }, 0);
  return {
    readyState: 1,
    send() {},
    close() {},
    addEventListener(type, listener) {
      (listeners[type] ??= []).push(listener);
    },
  };
}

describe("realtime transcription", () => {
  it("transcribeStream emits normalized session/delta/done events", async () => {
    const server = await startMockServer({ deltas: ["hello ", "world"], finalText: "hello world" });
    try {
      const rt = createRealtimeTranscription({
        modelId: "voxtral-test",
        apiKey: "test-key",
        baseURL: server.baseURL,
      });

      async function* audio() {
        yield new Uint8Array([1, 2, 3, 4]);
      }

      const events = await collect(rt.transcribeStream(audio()));

      expect(events.some((e) => e.type === "session.created")).toBe(true);
      const deltas = events
        .filter((e): e is Extract<RealtimeTranscriptionEvent, { type: "delta" }> => e.type === "delta")
        .map((e) => e.textDelta);
      expect(deltas.join("")).toBe("hello world");
      const done = events.find(
        (e): e is Extract<RealtimeTranscriptionEvent, { type: "done" }> => e.type === "done",
      );
      expect(done?.text).toBe("hello world");
    } finally {
      await server.close();
    }
  });

  it("connect() sends append/flush/end frames the server can decode, with bearer auth", async () => {
    const server = await startMockServer();
    try {
      const rt = createRealtimeTranscription({
        modelId: "voxtral-x",
        apiKey: "secret-key",
        baseURL: server.baseURL,
      });
      const session = await rt.connect();
      expect(session.requestId).toBe("sess-test");
      expect(session.model).toBe("voxtral-x");

      await session.sendAudio(new Uint8Array([10, 20, 30]));
      await session.flush();
      await session.end();

      for await (const ev of session.events()) {
        if (ev.type === "done") break;
      }

      const appends = server.received.filter((m) => m.type === "input_audio.append");
      expect(appends.length).toBe(1);
      expect(Array.from(Buffer.from(appends[0].audio as string, "base64"))).toEqual([
        10, 20, 30,
      ]);
      expect(server.received.some((m) => m.type === "input_audio.flush")).toBe(true);
      expect(server.received.some((m) => m.type === "input_audio.end")).toBe(true);
      expect(server.lastConnection.authorization).toBe("Bearer secret-key");
      expect(server.lastConnection.url).toContain("model=voxtral-x");
    } finally {
      await server.close();
    }
  });

  it("sendAudio splits chunks larger than 262144 bytes", async () => {
    const server = await startMockServer();
    try {
      const rt = createRealtimeTranscription({
        modelId: "m",
        apiKey: "k",
        baseURL: server.baseURL,
      });
      const session = await rt.connect();
      const big = new Uint8Array(262144 * 2 + 100);
      for (let i = 0; i < big.length; i++) big[i] = i % 251;

      await session.sendAudio(big);
      await session.end();
      for await (const ev of session.events()) {
        if (ev.type === "done") break;
      }

      const appends = server.received.filter((m) => m.type === "input_audio.append");
      expect(appends.length).toBe(3);
      for (const a of appends) {
        expect(Buffer.from(a.audio as string, "base64").length).toBeLessThanOrEqual(
          262144,
        );
      }
      const reassembled = Buffer.concat(
        appends.map((a) => Buffer.from(a.audio as string, "base64")),
      );
      expect(reassembled.length).toBe(big.length);
      expect(Array.from(reassembled.subarray(0, 6))).toEqual(
        Array.from(big.subarray(0, 6)),
      );
    } finally {
      await server.close();
    }
  });

  it("connect() sends session.update before audio when options are set", async () => {
    const server = await startMockServer();
    try {
      const rt = createRealtimeTranscription({
        modelId: "m",
        apiKey: "k",
        baseURL: server.baseURL,
      });
      const session = await rt.connect({
        audioFormat: { encoding: "pcm_s16le", sampleRate: 8000 },
        targetStreamingDelayMs: 1000,
      });
      await session.end();
      for await (const ev of session.events()) {
        if (ev.type === "done") break;
      }

      const update = server.received.find((m) => m.type === "session.update") as
        | { session: { audio_format: { sample_rate: number }; target_streaming_delay_ms: number } }
        | undefined;
      expect(update).toBeTruthy();
      expect(update?.session.audio_format.sample_rate).toBe(8000);
      expect(update?.session.target_streaming_delay_ms).toBe(1000);
    } finally {
      await server.close();
    }
  });

  it("surfaces a server error event and transcribeStream stops", async () => {
    const server = await startMockServer({ behavior: "error" });
    try {
      const rt = createRealtimeTranscription({
        modelId: "m",
        apiKey: "k",
        baseURL: server.baseURL,
      });
      async function* audio() {
        yield new Uint8Array([1]);
      }
      const events = await collect(rt.transcribeStream(audio()));
      const err = events.find(
        (e): e is Extract<RealtimeTranscriptionEvent, { type: "error" }> => e.type === "error",
      );
      expect(err?.error).toBe("boom");
      expect(events.some((e) => e.type === "done")).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("maps unknown server events to { type: 'unknown' } without throwing", async () => {
    const server = await startMockServer({ behavior: "unknown" });
    try {
      const rt = createRealtimeTranscription({
        modelId: "m",
        apiKey: "k",
        baseURL: server.baseURL,
      });
      const session = await rt.connect();
      const events: RealtimeTranscriptionEvent[] = [];
      for await (const ev of session.events()) {
        events.push(ev);
        if (ev.type === "unknown") break;
      }
      expect(events.some((e) => e.type === "unknown")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("throws RealtimeTranscriptionError when the handshake times out", async () => {
    const server = await startMockServer({ behavior: "silent" });
    try {
      const rt = createRealtimeTranscription({
        modelId: "m",
        apiKey: "k",
        baseURL: server.baseURL,
      });
      await expect(rt.connect({ timeoutMs: 200 })).rejects.toThrow(/timed out/i);
    } finally {
      await server.close();
    }
  });

  it("mistralRealtimeTranscription applies Mistral defaults (url, model, auth)", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const rt = mistralRealtimeTranscription(
      { apiKey: "mk" },
      {
        webSocketFactory: (url, headers) => {
          capturedUrl = url;
          capturedHeaders = headers;
          return fakeSocket("voxtral-mini-transcribe-realtime-2602");
        },
      },
    );

    expect(rt.modelId).toBe("voxtral-mini-transcribe-realtime-2602");
    expect(rt.provider).toBe("mistral");

    const session = await rt.connect();
    expect(session.model).toBe("voxtral-mini-transcribe-realtime-2602");
    expect(capturedUrl).toBe(
      "wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-2602",
    );
    expect(capturedHeaders.Authorization).toBe("Bearer mk");
  });
});

// --- Real Mistral integration (gated) --------------------------------------

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const WAV_FIXTURE = process.env.TRANSCRIPTION_FIXTURE ?? "/tmp/test-transcription.wav";
const canRunReal = Boolean(MISTRAL_API_KEY) && existsSync(WAV_FIXTURE) && hasFfmpeg();

describe.skipIf(!canRunReal)("realtime transcription (real Mistral API)", () => {
  it(
    "streams PCM to Mistral and completes the realtime protocol",
    async () => {
      const pcmPath = join(tmpdir(), "ai-kit-realtime-fixture.pcm");
      execFileSync(
        "ffmpeg",
        ["-y", "-i", WAV_FIXTURE, "-f", "s16le", "-ar", "16000", "-ac", "1", pcmPath],
        { stdio: "ignore" },
      );
      const pcm = new Uint8Array(await readFile(pcmPath));

      async function* chunks() {
        const size = 4096;
        for (let i = 0; i < pcm.length; i += size) {
          yield pcm.subarray(i, Math.min(i + size, pcm.length));
          await new Promise((r) => setTimeout(r, 10));
        }
      }

      const rt = mistralRealtimeTranscription({ apiKey: MISTRAL_API_KEY });
      const events = await collect(
        rt.transcribeStream(chunks(), {
          audioFormat: { encoding: "pcm_s16le", sampleRate: 16000 },
        }),
      );

      expect(events.some((e) => e.type === "session.created")).toBe(true);
      expect(events.some((e) => e.type === "error")).toBe(false);
      expect(events.some((e) => e.type === "done" || e.type === "delta")).toBe(true);
    },
    60_000,
  );
});
