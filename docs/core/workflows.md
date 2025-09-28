# Workflows

Les workflows orchestrent une suite d'étapes typées inspirées de Mastra. Chaque étape valide ses entrées/sorties, partage un contexte commun et peut émettre des événements temps réel pour suivre l'exécution.

## Installation

Ajoutez `@ai-kit/core` et un validateur (ex. Zod) dans votre projet :

```bash
pnpm add @ai-kit/core zod
```

## Créer des étapes

Une étape se décrit avec `createStep` : identifiant, schémas optionnels et fonction `handler`. Le handler reçoit l'entrée validée, le contexte partagé et un `AbortSignal`.

```ts
import { createStep } from "@ai-kit/core/workflows";
import { z } from "zod";

type WeatherInput = { city: string };
type WeatherOutput = { forecast: string };

export const fetchWeather = createStep<WeatherInput, WeatherOutput>({
  id: "fetch-weather",
  description: "Récupère la météo courante",
  inputSchema: z.object({ city: z.string().min(1) }),
  handler: async ({ input, signal }) => {
    if (signal.aborted) {
      throw new Error("Requête annulée");
    }

    // TODO: remplacez par un appel API réel
    return { forecast: `Il fait beau à ${input.city}` };
  },
});
```

Le schéma est optionnel. Un objet exposant `parse` ou `safeParse` suffit (compatible Zod). Réutilisez la même étape dans plusieurs workflows en la clonant via `cloneStep` :

```ts
import { cloneStep } from "@ai-kit/core/workflows";

export const fetchWeatherCopy = cloneStep(fetchWeather, {
  id: "fetch-weather-copy",
  description: "Météo pour une autre ville",
});
```

## Assembler un workflow

Composez vos étapes avec `createWorkflow`, enchaînez-les avec `.then()` puis finalisez avec `.commit()`.

```ts
import { createWorkflow } from "@ai-kit/core/workflows";
import { z } from "zod";
import { fetchWeather } from "./steps/fetchWeather";

export const weatherWorkflow = createWorkflow({
  id: "weather-line",
  description: "Workflow météo simple",
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ forecast: z.string() }),
})
  .then(fetchWeather)
  .commit();
```

`commit()` retourne une instance immuable de `Workflow`. Le schéma de sortie est appliqué sur la valeur retournée par la dernière étape (après éventuellement un `finalize`).

## Exécuter un workflow

Utilisez `.run()` pour une exécution directe. Le résultat contient le statut global, un snapshot par étape et les métadonnées partagées.

```ts
const result = await weatherWorkflow.run({
  inputData: { city: "Paris" },
});

if (result.status === "success") {
  console.log(result.result.forecast);
} else {
  console.error("Échec", result.error);
}
```

### Contrôler l'exécution

- `workflow.createRun()` retourne un `WorkflowRun` réutilisable.
- `run.watch(listener)` enregistre un observateur appelé à chaque événement (`workflow:start`, `step:success`, etc.).
- `run.stream()` retourne un itérateur asynchrone pour consommer les événements en direct tout en attendant la résolution.
- `run.cancel()` annule proprement l'exécution via un `AbortSignal`.

```ts
const run = weatherWorkflow.createRun();

const unwatch = run.watch(event => {
  console.log(`[${event.type}]`, event);
});

const { stream, final } = await run.stream({ inputData: { city: "Lyon" } });

for await (const evt of stream) {
  // Alimentez votre UI temps réel ou vos logs
}

const outcome = await final;
unwatch();
```

### Métadonnées et contexte partagé

- Passez `metadata` lors du `run.start()` / `run.stream()` pour initialiser un objet partagé.
- Accédez-y dans une étape via `context.getMetadata()` et mettez-le à jour avec `context.updateMetadata()`.
- `context.store` expose une `Map` partagée pour stocker des références temporaires.

Les étapes peuvent également émettre des événements personnalisés visibles dans le flux `step:event` :

```ts
const notifyTeam = createStep({
  id: "notify-team",
  handler: async ({ context }) => {
    context.emit({ type: "notification", data: { channel: "slack" } });
    return { status: "sent" };
  },
});
```

## Gestion des erreurs

- Toute exception levée par un handler ou un schéma est encapsulée et renvoyée via `result.error`.
- Les erreurs de validation utilisent `WorkflowSchemaError` pour faciliter le diagnostic.
- Une annulation (signal externe ou `run.cancel()`) renvoie un statut `cancelled`.

## Bonnes pratiques

- Rendez vos schémas explicites pour éviter des transitions incohérentes.
- Privilégiez des étapes courtes et testables ; loggez les événements pour tracer vos runs.
- Réutilisez `cloneStep` pour décliner un même handler sur plusieurs branches.
- Combinez workflows + agents (`docs/core/agents.md`) pour modéliser des boucles complexes.

## Pour aller plus loin

- Ajoutez des méthodes utilitaires pour gérer le parallélisme ou le branching conditionnel.
- Alimentez vos dashboards d'observabilité avec `run.watch()` et `run.stream()`.
- Couplez les workflows à vos stockages/plugins maison via `context.store` ou des métadonnées enrichies.
