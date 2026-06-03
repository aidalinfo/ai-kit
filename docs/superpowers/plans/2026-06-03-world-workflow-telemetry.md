# World Workflow Telemetry — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une trace racine nommée (traceName, metadata, userId, tags, input/output) aux runs durables du moteur `world` dans `WorkflowKit`, en créant le span côté dispatch et en tirant parti de la propagation traceparent automatique du SDK Vercel Workflow.

**Architecture:** Un span racine OTel est ouvert dans `WorkflowKit.run/runAndWait` (branche world uniquement) avant d'appeler `adapter.run`, ce qui force le SDK à sérialiser notre traceparent dans le run durable. Les spans `STEP` et `ai.generateText` du worker s'accrochent automatiquement sous cette racine via la propagation W3C existante du SDK. Le code vit entièrement dans `packages/core/src/workflows/kit/` ; `workflow-world`, le chemin legacy, et OpenAI ne sont pas modifiés.

**Tech Stack:** TypeScript, `@opentelemetry/api`, `@opentelemetry/sdk-trace-base` (tests), vitest — tout déjà présent dans `@ai_kit/core`.

---

## Cartographie des fichiers

| Fichier | Action | Rôle |
|---------|--------|------|
| `packages/core/src/workflows/types.ts` | Modifier | Ajouter `tags?: string[]` à `WorkflowTelemetryOverrides` et `WorkflowTelemetryResolvedConfig` |
| `packages/core/src/workflows/telemetry.ts` | Modifier | Propager `tags` dans `resolveWorkflowTelemetryConfig` |
| `packages/core/src/workflows/kit/types.ts` | Modifier | Ajouter `telemetry?: WorkflowTelemetryOption` à `WorkflowRunDispatchOptions` |
| `packages/core/src/workflows/kit/worldTelemetry.ts` | Créer | Helper `startWorldRootSpan` (span racine + attributs Langfuse) |
| `packages/core/src/workflows/kit/WorkflowKit.ts` | Modifier | Brancher `startWorldRootSpan` dans `run` et `runAndWait` world |
| `packages/core/src/workflows/kit/WorkflowKit.test.ts` | Modifier | Ajouter les 6 tests télémétrie world (TDD) |

---

## Tâche 1 — Ajouter `tags` au type `WorkflowTelemetryOverrides`

**Fichiers :**
- Modifier : `packages/core/src/workflows/types.ts`

- [ ] **Écrire le test qui échoue**

Dans `packages/core/src/workflows/kit/WorkflowKit.test.ts`, ajouter à la fin du fichier :

```typescript
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
});
```

- [ ] **Vérifier l'échec**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run src/workflows/kit/WorkflowKit.test.ts 2>&1 | tail -20
```

Résultat attendu : erreur TypeScript (type `tags` inexistant sur `WorkflowTelemetryOverrides`).

- [ ] **Implémenter le minimal**

Dans `packages/core/src/workflows/types.ts`, modifier `WorkflowTelemetryOverrides` :

```typescript
export interface WorkflowTelemetryOverrides {
  traceName?: string;
  metadata?: Record<string, unknown>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
  userId?: string;
  tags?: string[];          // ← ajouter
}
```

- [ ] **Vérifier le passage**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run src/workflows/kit/WorkflowKit.test.ts 2>&1 | tail -10
```

Résultat attendu : PASS (1 nouveau test + tous les anciens).

- [ ] **Commit**

```bash
git add packages/core/src/workflows/types.ts packages/core/src/workflows/kit/WorkflowKit.test.ts
git commit -m "feat(core/telemetry): ajouter tags à WorkflowTelemetryOverrides"
```

---

## Tâche 2 — Propager `tags` dans `resolveWorkflowTelemetryConfig`

**Fichiers :**
- Modifier : `packages/core/src/workflows/telemetry.ts`

- [ ] **Vérifier le test existant (pas de nouvelle logique à tester ici)**

`WorkflowTelemetryResolvedConfig` n'expose pas encore `tags`. Ajouter un test dans `WorkflowKit.test.ts` dans le describe déjà créé :

```typescript
  it("resolveWorkflowTelemetryConfig propage tags dans la config résolue", () => {
    const { resolveWorkflowTelemetryConfig } = require("../telemetry.js");
    const config = resolveWorkflowTelemetryConfig({
      workflowId: "wf",
      overrideOption: { tags: ["env:prod", "wf:form-builder"] },
    });
    expect(config?.tags).toEqual(["env:prod", "wf:form-builder"]);
  });
```

> Note : ce test utilise `require` dynamique pour éviter la circularité de mock. Si vitest refuse, remplacer par un import statique en tête de fichier (pas de mock requis ici).

- [ ] **Vérifier l'échec**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run src/workflows/kit/WorkflowKit.test.ts 2>&1 | grep -E "FAIL|tags"
```

Résultat attendu : le test `tags` échoue (`config.tags` est `undefined`).

- [ ] **Implémenter le minimal**

Dans `packages/core/src/workflows/telemetry.ts` :

1. Ajouter `tags` à `WorkflowTelemetryResolvedConfig` :

```typescript
export interface WorkflowTelemetryResolvedConfig {
  traceName: string;
  metadata?: Record<string, unknown>;
  recordInputs: boolean;
  recordOutputs: boolean;
  userId?: string;
  tags?: string[];          // ← ajouter
}
```

2. Dans la fonction `resolveWorkflowTelemetryConfig`, ajouter la résolution de `tags` (après `resolvedUserId`) :

```typescript
  const resolvedTags =
    overrideOverrides?.tags ??
    baseOverrides?.tags;

  return {
    traceName: resolvedTraceName,
    metadata: hasMetadata ? metadata : undefined,
    recordInputs: resolvedRecordInputs,
    recordOutputs: resolvedRecordOutputs,
    userId: resolvedUserId,
    tags: resolvedTags,     // ← ajouter
  };
```

- [ ] **Vérifier le passage**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run src/workflows/kit/WorkflowKit.test.ts 2>&1 | tail -10
```

Résultat attendu : PASS.

- [ ] **Commit**

```bash
git add packages/core/src/workflows/telemetry.ts packages/core/src/workflows/kit/WorkflowKit.test.ts
git commit -m "feat(core/telemetry): propager tags dans resolveWorkflowTelemetryConfig"
```

---

## Tâche 3 — Ajouter `telemetry` à `WorkflowRunDispatchOptions`

**Fichiers :**
- Modifier : `packages/core/src/workflows/kit/types.ts`

- [ ] **Le test compile-check de la tâche 1 couvre déjà ça** — vérifier qu'il passe encore :

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run src/workflows/kit/WorkflowKit.test.ts 2>&1 | tail -10
```

Résultat attendu : PASS (si ce n'est pas le cas, le type n'est pas encore ajouté — continuer).

- [ ] **Implémenter**

Dans `packages/core/src/workflows/kit/types.ts`, modifier `WorkflowRunDispatchOptions` :

```typescript
import type { WorkflowTelemetryOption } from "../types.js";

// ...

export interface WorkflowRunDispatchOptions {
  engine?: WorkflowEngine;
  telemetry?: WorkflowTelemetryOption;  // ← ajouter
}
```

- [ ] **Vérifier le passage**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run src/workflows/kit/WorkflowKit.test.ts 2>&1 | tail -10
```

Résultat attendu : PASS.

- [ ] **Commit**

```bash
git add packages/core/src/workflows/kit/types.ts
git commit -m "feat(core/kit): ajouter telemetry à WorkflowRunDispatchOptions"
```

---

## Tâche 4 — Créer le helper `startWorldRootSpan`

**Fichiers :**
- Créer : `packages/core/src/workflows/kit/worldTelemetry.ts`
- Modifier (tests) : `packages/core/src/workflows/kit/WorkflowKit.test.ts`

- [ ] **Écrire le test qui échoue**

Ajouter dans `WorkflowKit.test.ts` (nouveau describe, après les describes existants) :

```typescript
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";

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
```

Ajouter `beforeEach` et `afterEach` aux imports de vitest en tête de fichier si pas déjà présents.

- [ ] **Vérifier l'échec**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run src/workflows/kit/WorkflowKit.test.ts 2>&1 | grep -E "FAIL|worldTelemetry"
```

Résultat attendu : erreur d'import (fichier `worldTelemetry.ts` inexistant).

- [ ] **Implémenter**

Créer `packages/core/src/workflows/kit/worldTelemetry.ts` :

```typescript
import {
  context as otelContext,
  trace,
  type Span,
  type Context,
} from "@opentelemetry/api";

import type { WorkflowTelemetryResolvedConfig } from "../telemetry.js";

const TRACER_NAME = "@ai-kit/workflow";

function toJsonAttribute(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Ouvre le span racine nommé pour un run world.
 * Le span doit être terminé par l'appelant (via span.end()).
 * Envelopper adapter.run() dans otelContext.with(rootContext, fn) pour
 * que le SDK Vercel sérialise ce traceparent dans le run durable.
 */
export function startWorldRootSpan(
  config: WorkflowTelemetryResolvedConfig,
  input: unknown,
): { span: Span; rootContext: Context } {
  const tracer = trace.getTracer(TRACER_NAME);

  const span = tracer.startSpan(config.traceName, {
    attributes: {
      name: config.traceName,
      "ai_kit.workflow.id": config.traceName,
    },
  });

  if (config.metadata) {
    span.setAttribute("metadata", toJsonAttribute(config.metadata));
    for (const [key, val] of Object.entries(config.metadata)) {
      const safe = key.replace(/\s+/g, "_").replace(/[^\w./-]/g, "_");
      const primitive =
        typeof val === "string" || typeof val === "number" || typeof val === "boolean"
          ? val
          : toJsonAttribute(val);
      span.setAttribute(`ai_kit.workflow.metadata.${safe}`, primitive);
    }
  }

  if (config.userId) {
    span.setAttribute("langfuse.user.id", config.userId);
    span.setAttribute("user.id", config.userId);
    span.setAttribute("ai_kit.workflow.user_id", config.userId);
  }

  if (config.tags && config.tags.length > 0) {
    span.setAttribute("langfuse.trace.tags", toJsonAttribute(config.tags));
  }

  if (config.recordInputs) {
    span.setAttribute("input", toJsonAttribute(input));
  }

  const rootContext = trace.setSpan(otelContext.active(), span);

  return { span, rootContext };
}
```

- [ ] **Vérifier le passage**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run src/workflows/kit/WorkflowKit.test.ts 2>&1 | tail -10
```

Résultat attendu : PASS (tous les tests).

- [ ] **Commit**

```bash
git add packages/core/src/workflows/kit/worldTelemetry.ts packages/core/src/workflows/kit/WorkflowKit.test.ts
git commit -m "feat(core/kit): helper startWorldRootSpan pour span racine world"
```

---

## Tâche 5 — Brancher la télémétrie dans `WorkflowKit.run` (fire-and-forget)

**Fichiers :**
- Modifier : `packages/core/src/workflows/kit/WorkflowKit.ts`
- Modifier (tests) : `packages/core/src/workflows/kit/WorkflowKit.test.ts`

- [ ] **Écrire le test qui échoue**

Ajouter dans le describe `startWorldRootSpan` (ou créer un nouveau describe `WorkflowKit — world — télémétrie`) dans `WorkflowKit.test.ts` :

```typescript
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
```

- [ ] **Vérifier l'échec**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run src/workflows/kit/WorkflowKit.test.ts 2>&1 | grep -E "FAIL|telemetry"
```

Résultat attendu : les 3 nouveaux tests échouent (le span n'est pas créé / n'existe pas).

- [ ] **Implémenter dans `WorkflowKit.ts`**

Ajouter les imports en tête de fichier :

```typescript
import { context as otelContext, SpanStatusCode } from "@opentelemetry/api";
import { startWorldRootSpan } from "./worldTelemetry.js";
import {
  resolveWorkflowTelemetryConfig,
} from "../telemetry.js";
import type { WorkflowTelemetryOption } from "../types.js";
```

Remplacer la méthode `run` (branche world uniquement) dans `WorkflowKit.ts`. Trouver :

```typescript
    const adapter = await this.#ensureAdapter();
    return adapter.run(workflow, input as unknown[]);
```

Remplacer par :

```typescript
    const adapter = await this.#ensureAdapter();
    const telemetryOption = (dispatch as { telemetry?: WorkflowTelemetryOption } | undefined)
      ?.telemetry;
    const telemetryConfig = resolveWorkflowTelemetryConfig({
      workflowId: (workflow as { name?: string }).name ?? "workflow",
      overrideOption: telemetryOption,
    });

    if (!telemetryConfig) {
      return adapter.run(workflow, input as unknown[]);
    }

    const { span, rootContext } = startWorldRootSpan(telemetryConfig, input);
    const handle = await otelContext.with(rootContext, () =>
      adapter.run(workflow, input as unknown[]),
    );
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    return handle;
```

- [ ] **Vérifier le passage**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run src/workflows/kit/WorkflowKit.test.ts 2>&1 | tail -10
```

Résultat attendu : PASS (tous les tests, anciens + nouveaux).

- [ ] **Commit**

```bash
git add packages/core/src/workflows/kit/WorkflowKit.ts packages/core/src/workflows/kit/WorkflowKit.test.ts
git commit -m "feat(core/kit): span racine world dans WorkflowKit.run (fire-and-forget)"
```

---

## Tâche 6 — Brancher la télémétrie dans `WorkflowKit.runAndWait`

**Fichiers :**
- Modifier : `packages/core/src/workflows/kit/WorkflowKit.ts`
- Modifier (tests) : `packages/core/src/workflows/kit/WorkflowKit.test.ts`

- [ ] **Écrire le test qui échoue**

Ajouter dans `WorkflowKit.test.ts` :

```typescript
describe("WorkflowKit — world — télémétrie runAndWait", () => {
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
    // L'adapter crée lui-même un span enfant → on vérifie que son parent = le span racine.
    let capturedParentSpanId: string | undefined;

    const handle = { runId: "r_ctx", returnValue: Promise.resolve("done") };
    const { trace: otelTrace, context: otelCtx } = await import("@opentelemetry/api");
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockImplementation(async () => {
        // Lire le span actif au moment où adapter.run est appelé
        capturedParentSpanId = otelTrace.getActiveSpan()?.spanContext().spanId;
        return handle;
      }),
    };
    __setWorkflowWorldLoader(async () => ({ createWorldAdapter: () => adapter }));

    const kit = new WorkflowKit({ engine: "world", world: { type: "postgres", url: "x" } });
    async function ctxWorkflow() { return "x"; }

    await kit.runAndWait(ctxWorkflow, [], { telemetry: { traceName: "ctx-test" } });

    // Le span est terminé — on récupère son spanId via l'exporter
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const rootSpanId = spans[0]!.spanContext().spanId;
    // Le span actif vu par adapter.run au moment du dispatch = le span racine
    expect(capturedParentSpanId).toBe(rootSpanId);
  });
});
```

Ajouter `SpanStatusCode` aux imports `@opentelemetry/api` en tête du fichier de test.

- [ ] **Vérifier l'échec**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run src/workflows/kit/WorkflowKit.test.ts 2>&1 | grep -E "FAIL|runAndWait.*télémétrie"
```

Résultat attendu : les 3 nouveaux tests échouent.

- [ ] **Implémenter dans `WorkflowKit.ts`**

Trouver la branche world de `runAndWait` (après le check `if (engine === "legacy")`). Remplacer :

```typescript
    const adapter = await this.#ensureAdapter();
    const handle = await adapter.run(workflow, input as unknown[]);
    return handle.returnValue;
```

Par :

```typescript
    const adapter = await this.#ensureAdapter();
    const telemetryOption = (dispatch as { telemetry?: WorkflowTelemetryOption } | undefined)
      ?.telemetry;
    const telemetryConfig = resolveWorkflowTelemetryConfig({
      workflowId: (workflow as { name?: string }).name ?? "workflow",
      overrideOption: telemetryOption,
    });

    if (!telemetryConfig) {
      const handle = await adapter.run(workflow, input as unknown[]);
      return handle.returnValue;
    }

    const { span, rootContext } = startWorldRootSpan(telemetryConfig, input);
    try {
      const handle = await otelContext.with(rootContext, () =>
        adapter.run(workflow, input as unknown[]),
      );
      const result = await handle.returnValue;
      if (telemetryConfig.recordOutputs) {
        span.setAttribute("output", JSON.stringify(result));
      }
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.end();
      throw error;
    }
```

- [ ] **Vérifier le passage**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run src/workflows/kit/WorkflowKit.test.ts 2>&1 | tail -10
```

Résultat attendu : PASS (tous les tests, anciens + nouveaux).

- [ ] **Commit**

```bash
git add packages/core/src/workflows/kit/WorkflowKit.ts packages/core/src/workflows/kit/WorkflowKit.test.ts
git commit -m "feat(core/kit): span racine world dans WorkflowKit.runAndWait (succès + erreur)"
```

---

## Tâche 7 — Vérification finale : build + suite complète

**Fichiers :**
- Aucun changement de code.

- [ ] **Build TypeScript**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm run build 2>&1 | tail -10
```

Résultat attendu : `build: OK`, 0 erreur tsc.

- [ ] **Suite complète**

```bash
cd /home/killian/Documents/dev/ai-kit/packages/core
pnpm vitest run 2>&1 | tail -10
```

Résultat attendu : tous les tests passent (149+ tests, 7 skippés env-gated), 0 régression.

- [ ] **Bump de version (minor) et commit**

Dans `packages/core/package.json`, changer `"version"` de `1.9.0` à `1.10.0`.

```bash
git add packages/core/package.json
git commit -m "chore(release): @ai_kit/core 1.10.0"
```

---

## Tâche 8 — Branch, PR et merge vers `dev` (pas de merge vers main avant validation manuelle)

- [ ] **Créer la branche et pousser**

```bash
git checkout -b feat/world-workflow-telemetry
# cherry-pick ou reset : tous les commits de ce plan sont déjà sur cette branche
git push -u origin feat/world-workflow-telemetry
```

- [ ] **Ouvrir la PR vers `dev`**

```bash
gh pr create --repo aidalinfo/ai-kit --base dev --head feat/world-workflow-telemetry \
  --title "feat(core): télémétrie workflow pour le moteur world" \
  --body "Ajoute une trace racine nommée (traceName, metadata, userId, tags, input/output) aux runs world. Span créé côté dispatch ; propagation traceparent du SDK Vercel assure le parentage des spans STEP et ai.generateText. Opt-in strict, legacy inchangé. Voir docs/superpowers/specs/2026-06-03-world-workflow-telemetry-design.md"
```

- [ ] **⚠️ Validation manuelle avant merge `dev` → `main`**

Avant de merger vers `main` (ce qui publierait 1.10.0 sur npm) :
- Dans un env avec world DB réelle (postgres/mongo) et Langfuse configuré, appeler `kit.runAndWait(monWorkflow, args, { telemetry: { traceName: "mon-workflow", userId: "...", tags: ["..."] } })`.
- Vérifier dans Langfuse que les spans `STEP {name}` et `ai.generateText` apparaissent **en enfants** de la trace racine nommée (arbre, pas traces liées).
- Si les spans s'affichent en lien (pas en arbre), documenter et appliquer le fallback D (SpanProcessor hôte enrichissant les spans SDK via baggage OTel — spec disponible).

- [ ] **Merge `dev` → `main` après validation manuelle** (déclenche la publication npm 1.10.0)
