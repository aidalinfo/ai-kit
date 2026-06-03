# Spec : télémétrie workflow pour le moteur « world »

**Date :** 2026-06-03
**Package cible :** `@ai_kit/core`
**Statut :** approuvé — prêt pour le plan d'implémentation

---

## Contexte et problème

Il existe deux exécuteurs de workflow dans `@ai_kit/core` :

| Exécuteur | Fichier | Télémétrie |
|-----------|---------|------------|
| Legacy (in-process) | `workflows/workflowRun.ts` → `WorkflowRunTelemetry` | ✅ span racine nommée (traceName), metadata, tags, langfuse.user.id, input/output |
| World (durable) | `WorkflowKit.run/runAndWait` → `adapter.run` | ❌ aucune |

Sur le moteur world, Langfuse voit des spans `ai.generateText` orphelins : `name=""`, `tags=[]`, `metadata={}`, `userId=null`. La montée 1.6→1.9 n'a rien ajouté côté télémétrie world ; le trou existait déjà, il devient visible dès que les runs passent durablement par world.

**Investigation SDK (`workflow@4.3.1`) :**
- Le SDK émet ses propres spans OTel (tracer `"workflow"`) : `workflow.start {name}` au dispatch, `STEP {name}` sur le worker — portant `WorkflowName`, `WorkflowRunId`, `StepId`, etc.
- Il propage le W3C traceparent via `serializeTraceCarrier()` (inject à l'enqueue) / `withTraceContext()` (extract sur le worker) → les spans enfants s'accrochent déjà à *quelque chose*, mais ce quelque chose n'est pas une racine nommée par l'application.
- `start()` n'offre **aucun champ** pour passer des métadonnées applicatives (`tags`, `traceName`, `userId`).
- `createWorld()` n'expose **aucun hook** (pas d'observers, pas de callbacks, pas d'option OTel).
- `getWorkflowMetadata()` (accessible dans un step) ne retourne que `{workflowName, workflowRunId, startedAt, url}`.

---

## Objectif

Un run durable (`world`) produit dans Langfuse **une seule trace racine nommée** portant `traceName`, `metadata`, `langfuse.user.id`, `langfuse.trace.tags` et l'input (+ output pour `runAndWait`), sous laquelle apparaissent les spans `STEP` du SDK et les spans `ai.generateText` imbriqués.

**Opt-in strict :** aucune config → aucun span → aucun overhead.
**Legacy et OpenAI inchangés.**

---

## Approche retenue : span racine côté dispatch (A)

Le `serializeTraceCarrier()` du SDK lit `otelContext.active()` pendant `start()`. Il suffit d'envelopper l'appel `adapter.run(...)` dans le contexte OTel de notre span racine pour que le SDK sérialise automatiquement notre traceparent dans le run — sans toucher aucun interne du SDK.

Le code vit **entièrement dans `WorkflowKit`** (`packages/core/src/workflows/kit/`). `workflow-world` n'est pas modifié.

---

## Design

### 1. Configuration — `WorkflowRunDispatchOptions`

```ts
// packages/core/src/workflows/kit/types.ts
interface WorkflowRunDispatchOptions {
  engine?: WorkflowEngine;
  telemetry?: WorkflowTelemetryOption;
  // WorkflowTelemetryOption = boolean | {
  //   traceName?: string     // défaut : fn.name
  //   metadata?: Record<string, unknown>
  //   userId?: string        // → langfuse.user.id / user.id
  //   tags?: string[]        // → langfuse.trace.tags  ← nouveau champ partagé
  //   recordInputs?: boolean  // défaut : true
  //   recordOutputs?: boolean // défaut : true
  // }
}
```

`traceName` est résolu exactement comme dans le chemin legacy (`resolveWorkflowTelemetryConfig`) ; si omis, on tombe sur `fn.name` (nom de la fonction workflow). C'est le seul défaut spécifique au chemin world.

Le champ `tags?: string[]` est ajouté à `WorkflowTelemetryOverrides` et `WorkflowTelemetryResolvedConfig` (partagés avec legacy). Legacy ne les exploite pas tant qu'ils ne sont pas renseignés — aucune régression.

### 2. Helper `startWorldRootSpan`

Nouveau helper dans `WorkflowKit.ts` (ou un fichier `worldTelemetry.ts` co-localisé) :

```ts
function startWorldRootSpan(
  config: WorkflowTelemetryResolvedConfig,
  input: unknown,
): { span: Span; rootContext: Context }
```

- Utilise le même tracer `@ai-kit/workflow` que le chemin legacy.
- Nom du span = `config.traceName`.
- Attributs posés : `name`, `ai_kit.workflow.id` (= traceName), `metadata` (JSON), `langfuse.user.id` / `user.id`, `langfuse.trace.tags` (array → JSON), `input` (si `recordInputs`).
- Retourne `{ span, rootContext }` pour que l'appelant puisse terminer le span après le run.

### 3. Branche world dans `WorkflowKit.run` et `runAndWait`

**`run` (fire-and-forget) :**
```
config = resolveWorkflowTelemetryConfig({ workflowId: fn.name, overrideOption: dispatch.telemetry })
si config absent → adapter.run(fn, args)  // identique à aujourd'hui
sinon :
  { span, rootContext } = startWorldRootSpan(config, args)
  handle = await otelContext.with(rootCtx, () => adapter.run(fn, args))
  span.setStatus(OK)
  span.end()          // terminé immédiatement ; output non capturé (fire-and-forget)
  return handle
```

**`runAndWait` :**
```
config = resolveWorkflowTelemetryConfig(...)
si config absent → comportement actuel
sinon :
  { span, rootContext } = startWorldRootSpan(config, args)
  try :
    handle = await otelContext.with(rootCtx, () => adapter.run(fn, args))
    result = await handle.returnValue
    if config.recordOutputs : span.setAttribute("output", JSON.stringify(result))
    span.setStatus(OK)
    span.end()
    return result
  catch e :
    span.recordException(e)
    span.setStatus(ERROR, e.message)
    span.end()
    throw e            // comportement actuel préservé
```

### 4. Sûreté et no-op garanti

- Pas de SDK OTel configuré → `trace.getTracer()` → tracer no-op → spans sont des no-op, pas d'exception possible.
- `telemetry` absent de `WorkflowRunDispatchOptions` → `resolveWorkflowTelemetryConfig` retourne `undefined` → branche ignorée, comportement byte-for-byte identique.
- Pas de dépendance ajoutée : OTel API est déjà une dépendance directe de `@ai_kit/core`.

### 5. Risque empirique — parent vs span-link

Le SDK lie les worker spans au contexte propagé. Selon le mode (parent-child vs span-link), Langfuse affichera soit un **arbre** (idéal) soit des **traces liées** (acceptable mais moins lisible). Ce point doit être validé sur une world DB réelle avant merge vers main.

Si les spans s'affichent en lien (pas en arbre), le fallback est l'approche D (SpanProcessor hôte enrichissant les spans `workflow.start`/`STEP` via le baggage OTel) — documenté mais non implémenté dans cette spec.

---

## Tests

### Unitaires (TDD, in-process)
Avec le seam `__setWorkflowWorldLoader` + adapter factice + `InMemorySpanExporter` :

1. `run` sans telemetry → 0 span émis, adapter appelé normalement.
2. `run` avec `telemetry: true` → 1 span racine nommé `fn.name`, attributs `name`/`input`, span terminé avant return.
3. `run` avec `telemetry: { traceName, metadata, userId, tags }` → attributs vérifiés.
4. `runAndWait` succès → span terminé avec `output` et statut OK.
5. `runAndWait` exception → span terminé avec `recordException` et statut ERROR, exception rethrow.
6. Propagation de contexte : l'adapter factice crée un span enfant dans son `run()` et on assert que son parent est le span racine.

### Validation manuelle (spike avant merge main)
Pointer un world postgres/mongo réel (env dev/staging), vérifier dans Langfuse que les spans `STEP` et `ai.generateText` apparaissent en **enfants** de la trace racine nommée (et non en traces distinctes liées).

---

## Ce qui ne change pas

- Chemin legacy (`workflowRun.ts`) : aucune modification.
- `workflow-world` (`adapter.ts`, `worlds.ts`) : aucune modification.
- Appels existants sans `telemetry` dans `WorkflowRunDispatchOptions` : comportement identique.
- OpenAI et autres providers : non concernés.

---

## Utilisation côté application

```ts
// lrd-nuxt/server — appel depuis un handler
const result = await kit.runAndWait(formBuilderWorkflow, [input], {
  telemetry: {
    traceName: "form-builder",
    metadata: { documentType: input.type },
    userId: session.userId,
    tags: ["form-builder", "prod"],
  },
});
```

Sans `telemetry`, l'appel est strictement identique à aujourd'hui.
