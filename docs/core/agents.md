# Agents

Cette page explique comment instancier un agent avec `@ai-kit/core`, puis comment produire des reponses uniques (`generate`) ou en flux (`stream`). Un agent encapsule un modele et des instructions systeme reutilisables pour centraliser votre configuration.

## Installation et pre-requis

- Installez la bibliotheque core ainsi que le SDK modele :

```bash
pnpm add @ai-kit/core @ai-sdk/openai ai zod
```

- Preparez votre cle API dans une variable d'environnement. Par exemple avec Scaleway :

```bash
export SCALEWAY_API_KEY="skw-..."
```

## Creer un agent

```ts
import { Agent, scaleway } from "@ai-kit/core";

const assistant = new Agent({
  name: "assistant-documentation",
  instructions: "Tu aides les developpeurs a comprendre la plateforme AI Kit.",
  model: scaleway("hermes-2-pro"),
});
```

- `name` sert a identifier votre agent (utile pour la journalisation ou la supervision).
- `instructions` correspond aux consignes systeme appliquees par defaut. Vous pouvez les surcharger dans chaque appel via l'option `system`.
- `model` attend un `LanguageModel` du SDK `ai`. Ici nous utilisons l'assistant Scaleway, mais n'importe quel modele compatible est accepte.

### Ajouter des outils par defaut

Passez l'option `tools` pour que l'agent les expose automatiquement a chaque appel. Vous pouvez toujours fournir `tools` dans `generate`/`stream` pour les remplacer ponctuellement.

```ts
import { Agent, google } from "@ai-kit/core";

const assistant = new Agent({
  name: "assistant-vie",
  instructions: "Assistant de vie",
  model: google("gemini-2.5-flash"),
  tools: {
    google_search: google.tools.googleSearch({}),
  },
});

await assistant.generate({ prompt: "Quelle est la meteo a Paris ?" });
```

## Generer une reponse ponctuelle

Utilisez `agent.generate` lorsque vous attendez une reponse unique. Vous pouvez fournir un simple `prompt` ou une conversation `messages` compatible format ChatML.

```ts
const result = await assistant.generate({
  prompt: "Explique la difference entre generate et stream dans AI Kit."
});

console.log(result.text);
```

L'objet retourne par `generate` correspond directement a la sortie de `ai.generateText`. Parmi les champs utiles :

- `text` : la reponse finale sous forme de chaine.
- `response` : la reponse complete du modele (contenu, usage, tool calls...).

### Utiliser des messages structures

```ts
const chatResult = await assistant.generate({
  messages: [
    { role: "user", content: "Peux-tu me donner trois idees de tutoriels ?" }
  ],
  maxOutputTokens: 256
});
```

Lorsque vous fournissez `messages`, l'agent injecte automatiquement `instructions` comme systeme si vous ne les surchargez pas via `system`.

### Generer une sortie structuree

Vous pouvez demander au modele de respecter un schema `zod` en passant l'option `structuredOutput`. L'agent transmet ce schema au champ `experimental_output` du SDK `ai` et vous obtenez un objet type en sortie.

> Note : preferez `agent.generate` pour la generation structuree. Les flux (`stream`) peuvent rompre le parsing schema et ne sont pas encore suffisamment robustes.

```ts
import { Output } from "@ai-kit/core/agents";
import { z } from "zod";

const personSpec = Output.object({
  schema: z.object({
    name: z.string(),
    age: z.number().nullable().describe("Age de la personne."),
    contact: z.object({
      type: z.literal("email"),
      value: z.string(),
    }),
    occupation: z.object({
      type: z.literal("employed"),
      company: z.string(),
      position: z.string(),
    }),
  }),
});

const structured = await assistant.generate({
  prompt: "Cree un profil de test pour un client potentiel.",
  structuredOutput: personSpec,
});

console.log(structured.experimental_output);
// { name: "...", age: 32, contact: { ... }, occupation: { ... } }
```

Pour un schema plus cible, par exemple extraire un identifiant `SIRET` de 14 chiffres :

```ts
import { Agent, Output } from "@ai-kit/core";
import { z } from "zod";
import { google } from "@ai-sdk/google";

const siretOutput = Output.object({
  schema: z.object({
    siret: z.string().length(14, {
      message: "Le SIRET doit contenir exactement 14 chiffres.",
    }),
  }),
});

const assistant = new Agent({
  name: "assistant-vie",
  instructions: "Assistant de vie",
  model: google("gemini-2.5-flash"),
  tools: {
    google_search: google.tools.googleSearch({}),
  },
});

const result = await assistant.generate({
  prompt: "Cherche le siret de la societe Aidalinfo",
  structuredOutput: siretOutput,
});

console.log(result.experimental_output);
// { siret: "12345678901234" }
```

Le schema `zod` impose ici exactement 14 caracteres, ce qui simplifie la validation cote application.

Le champ `experimental_output` contient la reponse validee par le schema. En cas d'erreur de parsing, le SDK leve une exception que vous pouvez intercepter pour reessayer ou journaliser l'echec.

## Streamer une reponse

`agent.stream` retourne un flux asynchrone permettant de traiter les tokens au fur et a mesure.

```ts
const stream = await assistant.stream({
  prompt: "Redige un plan detaille pour un guide sur AI Kit.",
  temperature: 0.5,
});

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}

const finalText = await stream.text;
console.log("\n---\n", finalText);
```

La fonction `streamText` du SDK renvoie des proprietes sous forme de promesses qui consomment le flux pour fournir un etat agrege :

- `text` : la reponse finale complete.
- `response` : les metadonnees LLM (messages, headers...).
- `usage` / `totalUsage` : les compteurs de tokens.
- `steps` : le detail des etapes intermediaires (notamment utile pour suivre les tool calls).

Champs principaux exposes par le resultat de `stream` (issu de `ai.streamText`) :

- `textStream` : un `AsyncIterable<string>` avec les tokens.
- `fullStream` : un flux complet incluant `text`, `reasoning`, outils et erreurs.
- `text`, `response`, `usage`, `steps` : promesses agregees (voir ci-dessus).
- `toAIStreamResponse()` / `toDataStreamResponse()` : helpers pour brancher le flux sur une reponse HTTP (utile dans Next.js ou Remix).

### Stream avec messages

```ts
const streamedChat = await assistant.stream({
  messages: [
    { role: "user", content: "Decris le cycle de vie d'un agent AI Kit." }
  ]
});

for await (const delta of streamedChat.textStream) {
  process.stdout.write(delta);
}
```

### Streamer une sortie structuree

Nous deconseillons d'utiliser `agent.stream` en combinaison avec `structuredOutput` : les sorties intermediaires peuvent devenir incoherentes et le parsing final risque d'echouer. Si vous devez tout de meme experimenter cette approche, partez du principe que vous devrez gerer les erreurs de parsing et reessayer la generation.

En reutilisant `personSpec` defini plus haut, vous pouvez recevoir des fragments partiels pendant le stream puis recuperer l'objet complet une fois la generation terminee.

```ts
const streamWithSchema = await assistant.stream({
  prompt: "Fournis un profil de test au format structure.",
  structuredOutput: personSpec,
});

let lastPartial;
for await (const partial of streamWithSchema.experimental_partialOutputStream) {
  lastPartial = partial;
  console.log("partial", partial);
}

const parsedOutput = await personSpec.parseOutput(
  { text: await streamWithSchema.text },
  {
    response: await streamWithSchema.response,
    usage: await streamWithSchema.usage,
    finishReason: await streamWithSchema.finishReason,
  },
);

console.log({ lastPartial, parsedOutput });
```

`experimental_partialOutputStream` diffuse des mises a jour incrementales respectant le schema `zod`. Conservez le dernier fragment pour afficher un resultat provisoire, puis parsez la reponse complete avec `parseOutput` pour obtenir un objet valide en fin de flux.

## Aller plus loin

- Surchargez `system` dans chaque appel pour modifier ponctuellement les instructions.
- Ajustez `maxOutputTokens`, `temperature`, `topP`, etc., directement dans les options passees a `generate` ou `stream`.
- Utilisez `structuredOutput` pour faire respecter un schema `zod` via `generate`; le support en `stream` reste experimental et fragile.
- Combinez plusieurs agents pour modeliser des roles specialises (par exemple : redaction, validation, resume).
