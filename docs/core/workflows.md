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
import { createStep } from "@ai-kit/core";
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
import { cloneStep } from "@ai-kit/core";

export const fetchWeatherCopy = cloneStep(fetchWeather, {
  id: "fetch-weather-copy",
  description: "Météo pour une autre ville",
});
```

## Assembler un workflow

Composez vos étapes avec `createWorkflow`, enchaînez-les avec `.then()` puis finalisez avec `.commit()`.

```ts
import { createWorkflow } from "@ai-kit/core";
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

## Étapes parallèles et foreach

`createParallelStep` exécute un ensemble d'étapes partageant la même entrée en concurrence et regroupe leurs sorties sous forme d'objet. `createForEachStep` applique un sous-workflow à chaque élément d'une collection et retourne les résultats agrégés (avec `collect` facultatif pour customiser la sortie).

L'exemple ci-dessous illustre un pipeline de chunking : on découpe un texte, puis pour chaque chunk on calcule un embedding et on extrait des tags en parallèle.

```ts
import {
  Chunk,
  TChunkDocument,
  createForEachStep,
  createParallelStep,
  createStep,
  createWorkflow,
} from "@ai-kit/core";
import { z } from "zod";

const chunkText = createStep<{ text: string }, Chunk[]>({
  id: "chunk-text",
  description: "Découpe le texte source en segments homogènes",
  handler: async ({ input }) => {
    const document = TChunkDocument.fromText(input.text);
    return document.chunk({
      chunkSize: 200,
      chunkOverlap: 20,
      metadata: { source: "raw-text" },
    });
  },
});

const embedChunk = createStep<Chunk, number[]>({
  id: "embed-chunk",
  description: "Calcule un embedding pour un chunk",
  handler: async ({ input }) => {
    // Remplacez par votre modèle d'embedding ; ici un stub déterministe
    return Array.from({ length: 3 }, (_, i) => input.content.length * (i + 1));
  },
});

const tagChunk = createStep<Chunk, string[]>({
  id: "tag-chunk",
  description: "Extrait des tags clés du chunk",
  handler: async ({ input }) => {
    return input.content
      .split(/[^a-zA-ZÀ-ÿ]+/)
      .filter(word => word.length > 4)
      .slice(0, 5);
  },
});

const processChunk = createParallelStep({
  id: "process-chunk",
  description: "Lance les tâches analytiques en parallèle pour un chunk",
  steps: {
    embedding: embedChunk,
    tags: tagChunk,
  },
});

const foreachChunk = createForEachStep({
  id: "foreach-chunk",
  description: "Traite chaque chunk en réutilisant le step parallèle",
  items: ({ input }) => input,
  itemStep: processChunk,
  concurrency: 4,
});

export const chunkingWorkflow = createWorkflow({
  id: "chunking-parallel-pipeline",
  description: "Chunking + traitement parallèle de chaque segment",
  inputSchema: z.object({ text: z.string().min(1) }),
  outputSchema: z.array(
    z.object({
      embedding: z.array(z.number()),
      tags: z.array(z.string()),
    }),
  ),
})
  .then(chunkText)
  .then(foreachChunk)
  .commit();

const result = await chunkingWorkflow.run({
  inputData: { text: "Votre long document..." },
});

if (result.status === "success") {
  console.log(result.result);
}
```

`createForEachStep` retourne par défaut un tableau : utilisez l'option `collect` pour fusionner les résultats (ex. concaténation des embeddings). `TChunkDocument` assure ici un chunking homogène et la propagation de metadata (`source: "raw-text"`). Ajoutez `concurrency` (par défaut 1) pour traiter plusieurs items en parallèle lorsque vos handlers sont I/O bound. Les deux helpers sont composables, vous pouvez donc imbriquer un `createParallelStep` dans un `createForEachStep` comme montré ci-dessus, ou l'inverse lorsque vous devez lancer des boucles indépendantes en parallèle.

## Exemple complet : workflow météo + agent

> Ce scénario requiert un environnement qui expose `fetch` (Node.js 18+ ou polyfill).

```ts
import { Agent, createStep, createWorkflow, scaleway } from "@ai-kit/core";
import { z } from "zod";

type WeatherInput = { city: string };
type WeatherSnapshot = {
  location: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windGust: number;
  conditions: string;
};
type AdviceOutput = { text: string };
type WorkflowMeta = Record<string, unknown>;

const weatherCodeLabels: Record<number, string> = {
  0: "Ciel dégagé",
  1: "Globalement dégagé",
  2: "Partiellement nuageux",
  61: "Pluie faible",
};

const getWeatherCondition = (code: number) =>
  weatherCodeLabels[code] ?? "Conditions inconnues";

const getWeather = async (location: string) => {
  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
  const geocodingResponse = await fetch(geocodingUrl);
  const geocodingData = await geocodingResponse.json();

  if (!geocodingData.results?.[0]) {
    throw new Error(`Location '${location}' not found`);
  }

  const { latitude, longitude, name } = geocodingData.results[0];

  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code`;
  const response = await fetch(weatherUrl);
  const data = await response.json();

  return {
    temperature: data.current.temperature_2m,
    feelsLike: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    windGust: data.current.wind_gusts_10m,
    conditions: getWeatherCondition(data.current.weather_code),
    location: name,
  };
};

const assistant = new Agent({
  name: "assistant-meteo",
  instructions: "Tu guides une personne pour profiter du temps.",
  model: scaleway("gpt-oss-120b"),
});

const fetchWeatherStep = createStep<WeatherInput, WeatherSnapshot, WorkflowMeta, WeatherInput>({
  id: "fetch-weather",
  description: "Interroge Open-Meteo",
  inputSchema: z.object({ city: z.string().min(1) }),
  handler: async ({ input, signal }) => {
    if (signal.aborted) throw new Error("Requête annulée");
    const snapshot = await getWeather(input.city);
    return snapshot;
  },
});

const summarizeWeather = createStep<WeatherSnapshot, AdviceOutput, WorkflowMeta, WeatherInput>({
  id: "summarize-weather",
  description: "Produis un texte exploitable",
  inputSchema: z.object({
    location: z.string(),
    temperature: z.number(),
    feelsLike: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    windGust: z.number(),
    conditions: z.string(),
  }),
  handler: async ({ input, context, signal }) => {
    if (signal.aborted) throw new Error("Requête annulée");

    const { city } = context.initialInput;
    const prompt = [
      `Ville: ${city} (${input.location})`,
      `Conditions: ${input.conditions}`,
      `Température: ${input.temperature}°C (ressenti ${input.feelsLike}°C)`,
      `Humidité: ${input.humidity}%`,
      `Vent: ${input.windSpeed} km/h (rafales ${input.windGust} km/h)`,
      "Donne-moi un court paragraphe de conseils pour cette météo.",
    ].join("\n");

    const result = await assistant.generate({ prompt });
    return { text: result.text };
  },
});

export const weatherAdvisorWorkflow = createWorkflow<WeatherInput, AdviceOutput, WorkflowMeta>({
  id: "weather-advisor",
  description: "Bulletin météo personnalisé avec conseils",
  inputSchema: z.object({ city: z.string().min(1) }),
  outputSchema: z.object({ text: z.string() }),
})
  .then(fetchWeatherStep)
  .then(summarizeWeather)
  .commit();
```

```ts
const result = await weatherAdvisorWorkflow.run({ inputData: { city: "Paris" } });
console.log(result.result?.text);
```

Dans le second handler, `context.initialInput` permet de réutiliser la ville choisie par l'utilisateur tout en exploitant les données enrichies de l'étape précédente. Rien n'empêche d'ajouter `context.emit(...)` pour tracer les snapshots ou d'alimenter `context.updateMetadata` afin de partager des informations additionnelles avec d'autres étapes.

## Pour aller plus loin

- Ajoutez des méthodes utilitaires pour gérer le parallélisme ou le branching conditionnel.
- Alimentez vos dashboards d'observabilité avec `run.watch()` et `run.stream()`.
- Couplez les workflows à vos stockages/plugins maison via `context.store` ou des métadonnées enrichies.
