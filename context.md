# Plan support du `ctx` dans les workflows

## 1. Objectifs DX
- Permettre de fournir un objet `ctx` lors de la construction d’un workflow, avec une valeur par défaut `{}`.
- Exposer ce `ctx` à chaque step via les `StepHandlerArgs`, en complément des données `input` et `context` actuelles.
- Garantir que le `ctx` reste typé de bout en bout (création du workflow → exécution des steps → résultat final).

## 2. API cible
- `WorkflowConfig` devient générique sur `Ctx` (`WorkflowConfig<Input, Output, Meta, Ctx>`), avec un nouveau champ optionnel `ctx?: Ctx`.
- `Workflow` et `WorkflowRun` héritent du même paramètre `Ctx` (défaut `Record<string, unknown>`).
- `WorkflowRunOptions` accepte un champ optionnel `ctx?: Partial<Ctx> | Ctx` pour ajuster le `ctx` par exécution (fusion avec la valeur par défaut).
- `StepHandlerArgs` expose `ctx: Readonly<Ctx>` et `stepRuntime: WorkflowStepRuntimeContext<Meta, RootInput>` (nouveau nom), tout en conservant `context` comme alias déprécié (commentaire `/** @deprecated */` pour surfacer l’avertissement dans TS/VS Code).
- `WorkflowStepContext` reçoit deux helpers : `getCtx(): Readonly<Ctx>` et `updateCtx(updater: (current: Ctx) => Ctx)` pour propager les mutations contrôlées (mutation directe interdite). Le nouveau type est renommé en `WorkflowStepRuntimeContext`, avec un alias déprécié `WorkflowStepContext`.
- `WorkflowRunResult` renvoie le `ctx` finalisé (`ctx: Ctx`) afin de connaître l’état consolidé après exécution.

### Exemple API
```ts
const workflow = createWorkflow({
  id: "order-processing",
  ctx: {
    currency: "EUR",
    total: 0,
  },
  steps: [
    createStep({
      id: "prepare-order",
      handler: async ({ input, ctx, stepRuntime, context }) => {
        const lineTotal = input.quantity * input.price;
        stepRuntime.updateCtx(current => ({
          ...current,
          total: current.total + lineTotal,
        }));
        // context est toujours disponible mais marqué déprécié ; à retirer à terme.
        return { lineTotal, currency: ctx.currency };
      },
    }),
    createStep({
      id: "format-summary",
      handler: async ({ ctx }) => {
        return `Total: ${ctx.total} ${ctx.currency}`;
      },
    }),
  ],
});

const run = await workflow.run({
  inputData: { items: cartLines },
  ctx: { currency: "USD" }, // surcharge ponctuelle
});

console.log(run.ctx); // { currency: "USD", total: 42 }
```

## 3. Surfaces à modifier
- `packages/core/src/workflows/types.ts`
  - Étendre les interfaces (`WorkflowConfig`, `WorkflowRunOptions`, `StepHandlerArgs`, `WorkflowRunResult`, `WorkflowStepRuntimeContext`), conserver `WorkflowStepContext` comme alias déprécié avec un commentaire `/** @deprecated */`, ajouter `context` déprécié dans `StepHandlerArgs`.
- `packages/core/src/workflows/workflow.ts`
  - Stocker le `ctx` initial, l’exposer via un getter.
- `packages/core/src/workflows/workflowRun.ts`
  - Initialiser le `ctx` (fusion config/run), le rendre disponible dans `StepHandlerArgs` sous `stepRuntime` et `context` (déprécié), gérer `updateCtx`, inclure le `ctx` final dans le résultat.
- `packages/core/src/workflows/steps/*.ts`
  - Ajuster les signatures génériques et la propagation des `StepHandlerArgs` (notamment `forEachStep`, `parallelStep`, `whileStep`, `humanStep`, `mapStep`) pour utiliser `stepRuntime` et ajouter le commentaire `/** @deprecated */` sur `context`.
- `packages/core/src/workflows/index.ts` & `workflowBuilder.ts`
  - Propager le nouveau paramètre générique, exposer les types.
- `packages/core/tests/workflows/**`
  - Mettre à jour les tests existants et ajouter de nouveaux cas.

## 4. Logique d’exécution détaillée
1. **Initialisation**  
   - `Workflow` mémorise `config.ctx ?? {}` dans un champ privé (`baseContext`).
   - `createRun/start` fusionnent `baseContext` et `options.ctx` (shallow merge, `options.ctx` prioritaire) pour produire `runtimeCtx` (copie défensive).
2. **Injection dans les steps**  
   - Lors du `runLoop`, construire `StepHandlerArgs` avec `ctx: Object.freeze(runtimeCtx)` et `stepRuntime` (ancien `context`).
   - `stepRuntime.getCtx` renvoie `Object.freeze(runtimeCtx)` pour les consumers nécessitant la valeur dans les helpers.
   - `stepRuntime.updateCtx` applique un updater synchrone, remplace `runtimeCtx`, puis rafraîchit la version figée exposée aux steps suivants.
   - Fournir `context` comme alias déprécié (`/** @deprecated */ const context = stepRuntime;`) pour compatibilité.
3. **Résultat final**  
   - `WorkflowRunResult` expose `metadata` (inchangé) ET `ctx` (`ctx` final).
   - Les watchers / telemetry conservent l’ancienne forme ; seules les structures d’arguments internes changent.

## 5. Compatibilité & migration
- Changements de type majeurs : nécessite publication d’une version minor résolvant les generics supplémentaires.
- Les steps existants devront mettre à jour la signature de handler (`({ input, ctx, stepRuntime })`). Fournir un type alias rétro-compatible (`LegacyStepHandlerArgs`) ou un guide de migration.
- Proposer une migration automatique : handlers peuvent ignorer `ctx` (grâce à la destructuration partielle).
- Conserver `context` en alias `/** @deprecated */` pour une migration douce (remontée d’avertissement dans l’IDE).
- Vérifier que les exports publics (`createStep`, `WorkflowStep`, helpers) continuent de fonctionner avec les nouveaux paramètres `Ctx` (metadata par défaut `Record<string, unknown>`, `ctx` par défaut `{}`).

## 6. Tests & validation
- **Unitaires**
  - Création d’un workflow avec `ctx` static → les steps reçoivent bien l’objet.
  - Override via `run({ ctx })` → merge correct + immutabilité dans les steps.
  - `updateCtx` dans un step → steps suivants voient la nouvelle valeur.
  - Résultat final contient le `ctx` mis à jour.
- **Intégration**
  - Workflow multi-steps (condition, boucle, human) pour vérifier la propagation complète du `ctx`.
  - Surveillance des watchers/telemetry pour s’assurer que le `ctx` n’altère pas les événements existants.

## 7. Documentation & DX
- Ajouter une section “Partager un contexte cross-step (`ctx`)" dans la doc workflows.
- Mettre à jour les snippets (`createStep`, builder) pour illustrer la destructuration `{ input, ctx, stepRuntime }` et mettre en avant la dépréciation de `context`.
- Communiquer la différence entre `metadata` (audit/telemetry) et `ctx` (données runtime mutables).
