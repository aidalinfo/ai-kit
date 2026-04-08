# Plan d’implémentation : `branchParallel` dans `createWorkflow` (core)

## Contexte (après lecture du code)
- `createWorkflow` retourne un `WorkflowBuilder` défini dans `packages/core/src/workflows/workflowBuilder.ts`. Ce builder empile les steps dans `WorkflowBuilderStore` (`steps`, `sequence`, `branchLookup`, `conditionSteps`, `entryId`).
- L’exécution est prise en charge par `WorkflowRun` (`packages/core/src/workflows/workflowRun.ts`) qui consomme la séquence et les branches sélectives pour avancer de manière strictement séquentielle en maintenant `current`.
- `WorkflowStep` (`packages/core/src/workflows/steps/step.ts`) encapsule les handlers, les résolutions de `next` et de `branchResolver`. Les implémentations personnalisées (ex : `createWhileStep`) montrent comment créer des steps composés sans changer la structure de graphe.
- Aucune primitive actuelle n’autorise plusieurs branches à être exécutées en parallèle ni à agréger plusieurs outputs dans `current`.

## Objectifs produit & DX
- Permettre au workflow `create` de lancer plusieurs branches de steps simultanément via un bloc `branchParallel`, tout en restant dans le paradigme TypeScript/Builder existant.
- Conserver la compatibilité avec la résolution de branches conditionnelles et la télémétrie actuelle (événements `step:start`, `step:success`, `step:error`, `step:branch`).
- Offrir une agrégation déterministe des résultats de chaque branche parallèle afin d’alimenter le step suivant.
- Fournir une DX explicite pour la délimitation des branches, la stratégie d’erreur (fail-fast vs wait-all) et la fusion des outputs/contextes.

## API proposée côté développeur
```ts
const workflow = createWorkflow({
  id: "create-workflow",
})
  .then(prepareEnvironmentStep)
  .branchParallel("prepare-infra", parallel =>
    parallel
      .branch("provisioning", branch =>
        branch
          .then(createClusterStep)
          .then(configureIngressStep),
      )
      .branch("observability", branch =>
        branch
          .then(setupGrafanaStep)
          .then(configureAlertsStep),
      )
      .onError("wait-all"),
  )
  .then(summarizeStep)
  .commit();
```
- `branchParallel(id, configure)` ouvre un builder dédié qui reçoit l’input courant et retourne la sortie agrégée.
- `branch(name, buildBranch)` définit une séquence de steps standard (réutilise `WorkflowBuilder` interne). Les branches reçoivent chacune l’input courant (ou un transformateur optionnel) et accèdent au `ctx` en lecture seule.
- `aggregate(fn)` (optionnel) transforme les résultats `{ [branchName]: output }` en output du bloc (par défaut, les résultats sont retournés tels quels).
- `onError(strategy)` détermine la propagation d’erreurs (`"fail-fast"`, `"wait-all"`, éventuellement `"collect"` pour renvoyer les succès et erreurs).

## Architecture technique cible
- **Builder**
  - Étendre `WorkflowBuilderStore` pour suivre les groupes parallèles (`parallelGroups: Map<string, ParallelGroup>`), chaque groupe contenant l’identifiant du step synthétique et la description des branches.
  - Ajouter une classe `ParallelWorkflowBuilder` qui encapsule un sous-`WorkflowBuilder` par branche (similaire à `ConditionalWorkflowBuilder`, mais capable de sérialiser plusieurs séquences complètes).
  - Lors de `commit`, valider que chaque bloc parallèle possède au moins une branche et que les identifiants sont uniques. Intégrer les steps des branches dans `store.steps` sans les forcer dans `sequence` linéaire (les rattacher au step parent via une nouvelle structure `parallelLookup`).
- **Step synthétique**
  - Créer un `ParallelWorkflowStep` (héritant de `WorkflowStep`) dont le handler déclenche en parallèle l’exécution de chaque branche :
    - Préparer un contexte d’exécution (input, ctx snapshot, stepRuntime).
    - Pour chaque branche, instancier une machine `WorkflowRun` dérivée restreinte aux steps de la branche ou, plus léger, exécuter manuellement la séquence de steps via un helper réutilisant `WorkflowStep.execute`.
    - Agréger les promesses via `Promise.allSettled` pour pouvoir appliquer la stratégie d’erreur.
    - Fournir une vue `ctx` en lecture seule à chaque branche (tentatives d’`updateCtx` -> erreur explicite).
    - Appliquer la fonction `aggregate` si fournie, sinon retourner le dictionnaire `{ branchName: output }`.
- **Runtime (`WorkflowRun`)**
  - Introduire un nouveau type de nœud dans le graphe (`parallelLookup: Map<string, ParallelBranch[]>`) inspecté au démarrage pour dériver `branchMembers`/`branchOwners`.
  - Adapter la boucle principale pour détecter un `ParallelWorkflowStep` : suspendre l’exécution séquentielle, déléguer au step la résolution des branches et intégrer le résultat agrégé dans `current`.
  - Étendre `stepsSnapshot` pour journaliser les sous-steps parallèles (`{ branchId, parentParallelId }`), et ajouter des événements `step:parallel:start/success/error` si nécessaire ou recycler `step:branch` avec un flag `parallel: true`.
- **Télémétrie & persistance**
  - Ajouter des attributs `parallel_group_id`, `parallel_branch_id` dans `packages/core/src/workflows/telemetry.ts`.
  - Mettre à jour la sérialisation des résultats (`WorkflowRunResult`) pour exposer les snapshots de branches parallèles, en conservant la compatibilité ascendante.
  - Garantir la compatibilité avec `WorkflowWatcher` et l’instrumentation OpenTelemetry existante (attributs cohérents, pas de rupture d’événements).

## Étapes de réalisation
1. **Spécifier la surface DX** (tests d’usage dans `packages/core/tests/workflows` + RFC interne).
2. **Refactor Builder**
   - Étendre `WorkflowBuilderStore` (`workflowBuilder.ts`).
   - Implémenter `branchParallel` + `ParallelWorkflowBuilder`.
   - Serializer les branches dans une nouvelle structure `parallelLookup`.
   - Interdire explicitement l’imbrication de blocs parallèles dans ce premier scope (validation à la construction + message d’erreur clair).
3. **Créer le step parallèle**
   - Ajouter `ParallelWorkflowStep` dans `packages/core/src/workflows/steps/parallelStep.ts`.
   - Couvrir les cas `fail-fast` vs `wait-all` + agrégation par défaut (pass-through si aucun `aggregate` personnalisé).
4. **Adapter `WorkflowRun`**
   - Comprendre la détection des steps parallèles (type guard) et la boucle d’exécution.
   - Gérer la capture des snapshots pour chaque branche.
   - Mettre à jour la résolution du `next` (le step parent fournit le `next` standard).
5. **Télémétrie & événements**
   - Mettre à jour `telemetry.ts` pour propager les attributs.
   - Adapter `WorkflowWatcher` pour exposer les hooks sur les branches parallèles sans romper les signatures existantes.
   - Ajouter les nouveaux événements dans `WorkflowEventType` si nécessaire.
6. **Tests**
   - Unitaires sur `ParallelWorkflowStep`.
   - Tests d’intégration via `createWorkflow` couvrant cas succès, échec dans une branche, agrégation personnalisée, rejet d’imbrication et erreur lorsqu’une branche tente de modifier le `ctx`.
7. **Documentation**
   - Guides dans `packages/docs` + exemple concret dans le workflow `create`.
8. **Stabilisation**
   - Bench de contention sur le scheduler.
   - Audit des interactions avec `ctx` (écritures concurrentes).

## Points ouverts
- Imbrication de blocs parallèles : hors scope initial, mais prévoir la stratégie d’évolution (levier de RFC ultérieure).
