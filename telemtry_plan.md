# Langfuse Telemetry Toggle Plan

## 1. Objectifs
- Offrir un moyen officiel d’activer la télémétrie Langfuse directement depuis la classe `Agent` via une option simple `telemetry: boolean`.
- Proposer un utilitaire de mise en place Langfuse (enregistrement du `LangfuseSpanProcessor`, flush, gestion des clés) utilisable par les applications qui adoptent AI Kit.
- Préserver la compatibilité existante : sans activer `telemetry`, aucun comportement ne change et aucune dépendance Langfuse n’est chargée.

## 2. Constat actuel
- `packages/core/src/agents/index.ts` délègue à `generateText` / `streamText` (Vercel AI SDK) sans injecter `experimental_telemetry`.
- `AgentConfig` ne possède pas de drapeau de télémétrie; la responsabilité est côté application.
- Aucune abstraction centralisée n’aide à initialiser `LangfuseSpanProcessor` ou à forcer `forceFlush`.
- La documentation officielle recommande :
  - Enregistrer manuellement le `LangfuseSpanProcessor` avec un `NodeTracerProvider` (`Langfuse TypeScript SDK - Overview` & `Instrumentation`).
  - Activer la télémétrie Vercel AI SDK par `experimental_telemetry: { isEnabled: true }` (`Langfuse Vercel AI SDK integration guide`).

## 3. API cible
### 3.1 Agent
```ts
export interface AgentConfig {
  name: string;
  instructions?: string;
  model: LanguageModel;
  tools?: AgentTools;
  telemetry?: boolean;
}
```
- `telemetry: true` → injection automatique de `experimental_telemetry.isEnabled = true`.
- Les développeurs peuvent toujours passer `experimental_telemetry` manuellement à l’appel; la fusion privilégie les valeurs locales.

### 3.2 Options de télémétrie par appel
```ts
export interface AgentTelemetryOverrides {
  functionId?: string;
  metadata?: Record<string, unknown>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
}

// BaseAgentOptions inclut désormais `telemetry?`
export type BaseAgentOptions<
  T,
  OUTPUT = never,
  PARTIAL_OUTPUT = never,
  STATE extends RuntimeState = RuntimeState,
> = Omit<T, "model" | "system" | "experimental_output" | "tools"> & {
  system?: string;
  structuredOutput?: StructuredOutput<OUTPUT, PARTIAL_OUTPUT>;
  runtime?: RuntimeStore<STATE>;
  telemetry?: AgentTelemetryOverrides;
};
```
- `telemetry` dans les options de `generate`/`stream` permet de définir `functionId`, `metadata`, `recordInputs`, `recordOutputs` à la volée.
- Ces overrides ne demandent pas d’activer globalement la télémétrie : si l’agent est sans télémétrie, ils sont ignorés sauf si `experimental_telemetry.isEnabled` est défini par l’appelant.
- `metadata` merge superficiel (spread) avec celle déjà présente dans `experimental_telemetry`.

### 3.3 Utilitaire Langfuse
`packages/core/src/telemetry/langfuse.ts` :
```ts
export interface LangfuseTelemetryConfig {
  shouldExportSpan?: ShouldExportSpan;
  autoFlush?: "process" | "request" | false;
}

export function ensureLangfuseTelemetry(config?: LangfuseTelemetryConfig): LangfuseTelemetryHandle;

export interface LangfuseTelemetryHandle {
  processor: LangfuseSpanProcessor;
  provider: NodeTracerProvider;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
```
- Utilise `globalThis` pour éviter double initialisation (voir cookbook Langfuse JS/TS SDK).
- Charge les clés depuis `process.env.LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`.
- Documente l’appel dans l’entrée serveur (`instrumentation.ts` ou `server/plugins`).
- Gère automatiquement `process.on("beforeExit")`/`"SIGTERM"` si `autoFlush === "process"` pour garantir un flush.

## 4. Implémentation
### 4.1 Setup Langfuse
1. Ajouter dépendances peer dans `packages/core/package.json` :
   ```json
   "peerDependencies": {
     "@langfuse/otel": "^4.2.0",
     "@opentelemetry/sdk-trace-node": "^0.207.0"
   },
   "peerDependenciesMeta": {
     "@langfuse/otel": { "optional": true },
     "@opentelemetry/sdk-trace-node": { "optional": true }
   }
   ```
2. Utiliser des imports dynamiques dans `ensureLangfuseTelemetry` pour éviter de charger `@langfuse/otel` si absent.
3. Relever une erreur explicite si `telemetry` activée sans dépendances disponibles.
4. Inspirer l’exemple officiel : enregistrer un `NodeTracerProvider` avec `LangfuseSpanProcessor` et filtrer les spans Next.js (`doc Langfuse instrumentation`, section “instrumentation.ts”).
5. Exposer `forceFlush` (qui appelle `processor.forceFlush()`).

### 4.2 Injection `experimental_telemetry`
1. Étendre `Agent` pour mémoriser un drapeau `this.telemetryEnabled`.
2. Lors de `generateText` / `streamText`, construire la charge utile :
   - Lire à la fois `options.telemetry` (nouveau) et `options.experimental_telemetry`.
   - Si `this.telemetryEnabled` est `true`, forcer `isEnabled: true` tout en mergeant les autres propriétés.
   - Appliquer les overrides : `functionId`, `metadata`, `recordInputs`, `recordOutputs` issus de `options.telemetry` si absents de `experimental_telemetry`.
   - Respecter en priorité les champs fournis dans `experimental_telemetry`.
   - Si `this.telemetryEnabled` est `false`, appliquer uniquement les overrides manuels si `experimental_telemetry.isEnabled` est déjà défini par l’appelant.
3. Propager l’objet `experimental_telemetry` résultant dans l’appel au SDK Vercel AI.
4. Ajouter `Agent.prototype.withTelemetry(enabled: boolean = true)` pour un chaining DX simple.

### 4.3 Propagation runtime
- Ne pas introduire de nouvel objet `AgentTelemetryContext`. L’activation booléenne suffit côté SDK.
- Documenter que les applications peuvent continuer à fournir `experimental_telemetry` au cas par cas pour ajuster `functionId` ou `metadata`.

### 4.4 Gestion d’erreurs & fallback
- Si `telemetry: true` mais `ensureLangfuseTelemetry` jamais appelé → laisser la télémétrie Vercel active (elles restent dans OTEL provider existant). Documenter la nécessité d’initialiser Langfuse pour l’export.
- Si l’appelant fournit explicitement `experimental_telemetry.isEnabled === false`, respecter ce choix (le drapeau reste un opt-in).
- Si l’agent est créé sans télémétrie, ignorer `options.telemetry` tant que l’appelant n’active pas `experimental_telemetry.isEnabled` lui-même.

### 4.5 Tests
- Pas de tests unitaires à implémenter pour cette itération (demande explicite). Valider manuellement via un exemple d’agent si nécessaire.

### 4.6 Documentation
- `packages/docs` :
  - Nouvelle page “Activer la télémétrie Langfuse”.
  - Snippet instrumentation (`ensureLangfuseTelemetry` + import early).
  - Section dédiée aux variables d’environnement à définir (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` optionnelle) avec exemple `.env`.
  - Exemple Agent :
    ```ts
    const agent = new Agent({
      name: "support-assistant",
      model: openai("gpt-4.1"),
      telemetry: true, // false pour désactiver
    });
    ```
  - Montrer un appel avec overrides :
    ```ts
    await agent.generate({
      prompt: "Créer un ticket",
      telemetry: {
        functionId: "support-ticket",
        metadata: { taskId: "42" },
        recordInputs: false,
      },
    });
    ```
  - Référence docs Langfuse :
    - [TypeScript SDK - Overview](https://langfuse.com/docs/observability/sdk/typescript/overview)
    - [TypeScript SDK - Instrumentation](https://langfuse.com/docs/observability/sdk/typescript/instrumentation)
    - [Vercel AI SDK integration](https://langfuse.com/integrations/frameworks/vercel-ai-sdk)

### 4.7 Exemples & DX
- Mettre à jour `packages/server` ou exemples internes pour utiliser `ensureLangfuseTelemetry`.
- Ajouter un snippet dans README principal montrant l’activation en deux lignes.
- Fournir un helper `createLangfuseTelemetryAgent(model, options?)` (optionnel) qui wrap `new Agent({ …, telemetry: true })`.

## 5. Roadmap ultérieure
- Support d’autres exporteurs OTEL (OpenLIT) à côté de Langfuse via interface générique.
- Surface `langfuseTraceId` / `langfuseParentObservationId` pour des intégrations avancées (datasets, evaluators).
- Ajouter un décorateur `withTelemetry` sur les workflows pour propager `traceName` automatiquement.
