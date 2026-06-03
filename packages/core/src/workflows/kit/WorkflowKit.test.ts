import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowKit, __setWorkflowWorldLoader } from "./WorkflowKit.js";

afterEach(() => __setWorkflowWorldLoader());

describe("WorkflowKit — config", () => {
  it("défaut = engine legacy", () => {
    expect(new WorkflowKit().engine).toBe("legacy");
  });

  it("engine 'world' sans config world → throw", () => {
    expect(() => new WorkflowKit({ engine: "world" })).toThrow(/world/i);
  });

  it("type de world inconnu → throw", () => {
    // @ts-expect-error test runtime
    expect(() => new WorkflowKit({ engine: "world", world: { type: "redis", url: "x" } })).toThrow();
  });

  it("start/stop sont no-op en legacy", async () => {
    const kit = new WorkflowKit();
    await expect(kit.start()).resolves.toBeUndefined();
    await expect(kit.stop()).resolves.toBeUndefined();
  });
});

describe("WorkflowKit — dispatch run", () => {
  it("legacy : délègue à Workflow.run", async () => {
    const fakeWorkflow = { run: vi.fn().mockResolvedValue({ status: "success" }) };
    const kit = new WorkflowKit();
    const res = await kit.run(fakeWorkflow as any, { inputData: { id: 1 } });
    expect(fakeWorkflow.run).toHaveBeenCalledWith({ inputData: { id: 1 } });
    expect(res).toEqual({ status: "success" });
  });

  it("world : start/run/stop délèguent à l'adapter chargé via le seam", async () => {
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue({ runId: "r_9" }),
    };
    const createWorldAdapter = vi.fn(() => adapter);
    __setWorkflowWorldLoader(async () => ({ createWorldAdapter }));

    const kit = new WorkflowKit({ engine: "world", world: { type: "postgres", url: "postgres://x" } });
    await kit.start();
    expect(createWorldAdapter).toHaveBeenCalledWith({ type: "postgres", url: "postgres://x" });
    expect(adapter.start).toHaveBeenCalledTimes(1);

    const fn = async () => 1;
    const handle = await kit.run(fn, ["a"]);
    expect(adapter.run).toHaveBeenCalledWith(fn, ["a"]);
    expect(handle).toEqual({ runId: "r_9" });

    await kit.stop();
    expect(adapter.stop).toHaveBeenCalledTimes(1);
  });

  it("world : erreur claire si le package @ai_kit/workflow-world manque", async () => {
    __setWorkflowWorldLoader(async () => {
      throw new Error("not found");
    });
    const kit = new WorkflowKit({ engine: "world", world: { type: "postgres", url: "postgres://x" } });
    await expect(kit.start()).rejects.toThrow("@ai_kit/workflow-world");
  });
});

describe("WorkflowKit — runAndWait", () => {
  function worldKitWith(handle: Record<string, unknown>) {
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(handle),
    };
    __setWorkflowWorldLoader(async () => ({ createWorldAdapter: () => adapter }));
    return new WorkflowKit({ engine: "world", world: { type: "postgres", url: "postgres://x" } });
  }

  it("world : résout avec returnValue du run", async () => {
    const kit = worldKitWith({
      runId: "r_1",
      returnValue: Promise.resolve({ ok: true }),
      status: Promise.resolve("completed"),
      exists: Promise.resolve(true),
      cancel: vi.fn(),
    });
    const out = await kit.runAndWait(async () => ({ ok: true }), ["a"]);
    expect(out).toEqual({ ok: true });
  });

  it("world : propage le rejet de returnValue (échec du run)", async () => {
    const kit = worldKitWith({
      runId: "r_2",
      // getter : crée la promesse rejetée seulement quand runAndWait la lit (pas d'unhandled rejection)
      get returnValue() {
        return Promise.reject(new Error("workflow failed"));
      },
      status: Promise.resolve("failed"),
      exists: Promise.resolve(true),
      cancel: vi.fn(),
    });
    await expect(kit.runAndWait(async () => 1, ["a"])).rejects.toThrow("workflow failed");
  });

  it("legacy : résout avec result.result quand status=success", async () => {
    const fakeWorkflow = {
      run: vi.fn().mockResolvedValue({ status: "success", result: { total: 42 } }),
    };
    const kit = new WorkflowKit();
    const out = await kit.runAndWait(fakeWorkflow as any, { inputData: {} });
    expect(out).toEqual({ total: 42 });
  });

  it("legacy : throw quand status != success", async () => {
    const fakeWorkflow = {
      run: vi.fn().mockResolvedValue({ status: "failed", error: new Error("boom") }),
    };
    const kit = new WorkflowKit();
    await expect(kit.runAndWait(fakeWorkflow as any, { inputData: {} })).rejects.toThrow("boom");
  });
});

describe("WorkflowKit — adapter injecté", () => {
  it("world : start/run/stop délèguent à l'adapter SANS charger @ai_kit/workflow-world", async () => {
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue({ runId: "r_inj" }),
    };
    const loader = vi.fn().mockRejectedValue(new Error("loader must not be called")); // le seam ne doit JAMAIS être invoqué
    __setWorkflowWorldLoader(loader);

    const kit = new WorkflowKit({ engine: "world", adapter });
    await kit.start();
    const fn = async () => 1;
    const handle = await kit.run(fn, ["a"]);
    await kit.stop();

    expect(adapter.start).toHaveBeenCalledTimes(1);
    expect(adapter.run).toHaveBeenCalledWith(fn, ["a"]);
    expect(handle).toEqual({ runId: "r_inj" });
    expect(adapter.stop).toHaveBeenCalledTimes(1);
    expect(loader).not.toHaveBeenCalled();
  });

  it("world : adapter injecté sans config 'world' → ne throw pas", () => {
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue({ runId: "r" }),
    };
    expect(() => new WorkflowKit({ engine: "world", adapter })).not.toThrow();
  });

  it("world : adapter injecté + config world de type invalide → ne throw pas (world ignoré)", () => {
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue({ runId: "r" }),
    };
    expect(
      // @ts-expect-error type de world volontairement invalide
      () => new WorkflowKit({ engine: "world", world: { type: "redis", url: "x" }, adapter }),
    ).not.toThrow();
  });
});

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { trace, SpanStatusCode } from "@opentelemetry/api";

describe("startWorldRootSpan", () => {
  let provider: BasicTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    trace.disable();
  });

  it("crée un span nommé traceName avec les attributs Langfuse", async () => {
    const { startWorldRootSpan } = await import("./worldTelemetry.js");

    const { span } = startWorldRootSpan(
      {
        traceName: "form-builder",
        metadata: { documentType: "bilan" },
        userId: "user-42",
        tags: ["env:prod"],
        recordInputs: true,
        recordOutputs: true,
      },
      [{ id: 1 }],
    );
    span.end();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const s = spans[0]!;
    expect(s.name).toBe("form-builder");
    expect(s.attributes["name"]).toBe("form-builder");
    expect(s.attributes["langfuse.user.id"]).toBe("user-42");
    expect(s.attributes["user.id"]).toBe("user-42");
    expect(s.attributes["langfuse.trace.tags"]).toBe('["env:prod"]');
    expect(s.attributes["metadata"]).toContain("bilan");
    expect(s.attributes["input"]).toBeDefined();
  });

  it("ne pose pas input si recordInputs=false", async () => {
    const { startWorldRootSpan } = await import("./worldTelemetry.js");

    const { span } = startWorldRootSpan(
      { traceName: "t", recordInputs: false, recordOutputs: true },
      ["secret"],
    );
    span.end();

    const s = exporter.getFinishedSpans()[0]!;
    expect(s.attributes["input"]).toBeUndefined();
  });
});

describe("WorkflowKit — world — télémétrie run (fire-and-forget)", () => {
  let provider: BasicTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    trace.disable();
  });

  it("sans telemetry → 0 span émis, adapter appelé normalement", async () => {
    const handle = { runId: "r1", returnValue: Promise.resolve("ok") };
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(handle),
    };
    __setWorkflowWorldLoader(async () => ({ createWorldAdapter: () => adapter }));

    const kit = new WorkflowKit({ engine: "world", world: { type: "postgres", url: "x" } });
    const fn = async () => 42;
    const result = await kit.run(fn, ["a"]);

    expect(adapter.run).toHaveBeenCalledWith(fn, ["a"]);
    expect(result).toBe(handle);
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("avec telemetry → 1 span racine nommé terminé avant le return", async () => {
    const handle = { runId: "r2", returnValue: Promise.resolve("ok") };
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(handle),
    };
    __setWorkflowWorldLoader(async () => ({ createWorldAdapter: () => adapter }));

    const kit = new WorkflowKit({ engine: "world", world: { type: "postgres", url: "x" } });

    async function monWorkflow(input: string) { return input; }

    await kit.run(monWorkflow, ["hello"], {
      telemetry: { traceName: "mon-workflow", userId: "u1", tags: ["t"] },
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const s = spans[0]!;
    expect(s.name).toBe("mon-workflow");
    expect(s.attributes["langfuse.user.id"]).toBe("u1");
    expect(s.attributes["langfuse.trace.tags"]).toBe('["t"]');
    expect(s.attributes["input"]).toBeDefined();
  });

  it("avec telemetry: true → traceName = fn.name", async () => {
    const handle = { runId: "r3", returnValue: Promise.resolve("ok") };
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(handle),
    };
    __setWorkflowWorldLoader(async () => ({ createWorldAdapter: () => adapter }));

    const kit = new WorkflowKit({ engine: "world", world: { type: "postgres", url: "x" } });

    async function buildForm() { return "done"; }

    await kit.run(buildForm, [], { telemetry: true });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("buildForm");
  });
});

describe("WorkflowKit — télémétrie world (tags compile-check)", () => {
  it("WorkflowRunDispatchOptions accepte telemetry avec tags (type-check uniquement)", () => {
    // Ce test ne fait que vérifier que le type compile — il n'a pas de logique runtime.
    // Si les types ne sont pas définis, tsc et vitest échouent à l'import.
    const _options: import("./types.js").WorkflowRunDispatchOptions = {
      engine: "world",
      telemetry: { traceName: "t", tags: ["a", "b"], userId: "u" },
    };
    expect(true).toBe(true);
  });

  it("resolveWorkflowTelemetryConfig propage tags dans la config résolue", async () => {
    const { resolveWorkflowTelemetryConfig } = await import("../telemetry.js");
    const config = resolveWorkflowTelemetryConfig({
      workflowId: "wf",
      overrideOption: { tags: ["env:prod", "wf:form-builder"] },
    });
    expect(config?.tags).toEqual(["env:prod", "wf:form-builder"]);
  });
});

describe("WorkflowKit — world — télémétrie runAndWait", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    trace.disable();
  });

  it("succès → span terminé OK avec output", async () => {
    const handle = {
      runId: "r_ok",
      returnValue: Promise.resolve({ result: 42 }),
    };
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(handle),
    };
    __setWorkflowWorldLoader(async () => ({ createWorldAdapter: () => adapter }));

    const kit = new WorkflowKit({ engine: "world", world: { type: "postgres", url: "x" } });
    async function computeResult(n: number) { return n * 2; }

    const out = await kit.runAndWait(computeResult, [21], {
      telemetry: { traceName: "compute", recordOutputs: true },
    });

    expect(out).toEqual({ result: 42 });
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const s = spans[0]!;
    expect(s.name).toBe("compute");
    expect(s.status.code).toBe(SpanStatusCode.OK);
    expect(s.attributes["output"]).toContain("42");
  });

  it("erreur du run → span terminé ERROR, exception propagée", async () => {
    const handle = {
      runId: "r_fail",
      get returnValue() {
        return Promise.reject(new Error("run crashed"));
      },
    };
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(handle),
    };
    __setWorkflowWorldLoader(async () => ({ createWorldAdapter: () => adapter }));

    const kit = new WorkflowKit({ engine: "world", world: { type: "postgres", url: "x" } });
    async function failingWorkflow() { return 0; }

    await expect(
      kit.runAndWait(failingWorkflow, [], { telemetry: true }),
    ).rejects.toThrow("run crashed");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("propagation de contexte — adapter.run s'exécute dans le contexte du span racine", async () => {
    let capturedParentSpanId: string | undefined;

    const handle = { runId: "r_ctx", returnValue: Promise.resolve("done") };
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockImplementation(async () => {
        const { trace: otelTrace } = await import("@opentelemetry/api");
        capturedParentSpanId = otelTrace.getActiveSpan()?.spanContext().spanId;
        return handle;
      }),
    };
    __setWorkflowWorldLoader(async () => ({ createWorldAdapter: () => adapter }));

    const kit = new WorkflowKit({ engine: "world", world: { type: "postgres", url: "x" } });
    async function ctxWorkflow() { return "x"; }

    await kit.runAndWait(ctxWorkflow, [], { telemetry: { traceName: "ctx-test" } });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const rootSpanId = spans[0]!.spanContext().spanId;
    expect(capturedParentSpanId).toBe(rootSpanId);
  });
});
