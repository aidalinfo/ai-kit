# Intégration de TOON (Token-Oriented Object Notation)

Ce document décrit comment introduire le format [TOON](https://github.com/toon-format/toon) dans l'AI Kit pour réduire le coût token et fiabiliser la transmission de jeux de données structurés aux LLM. L'objectif est de convertir automatiquement les tableaux d'objets uniformes en TOON avant l'injection dans les prompts, puis de standardiser la manière dont le schéma est communiqué au modèle.

## Pourquoi TOON ?
- Réduction de 30 à 60 % du volume token vs JSON formaté sur des tableaux homogènes.
- Descripteur de schéma explicite (`collection[length]{fields}`) qui sert de garde-fou côté LLM.
- Syntaxe textuelle lisible (inspirée CSV + YAML) donc facile à auditer/logguer.
- Conversion aller/retour rapide via `@toon-format/toon`, compatible Node.js et CLI.

### Rappel de syntaxe
```text
users[2]{id,name,role}:
  1,Alice,admin
  2,Bob,user
```
Le header annonce le nom de la collection (`users`), la cardinalité (`[2]`) et les colonnes (`{id,name,role}`). Chaque ligne représente un objet.

## Périmètre visé
1. **Packages `core` & `server`** – fournir des helpers de sérialisation TOON et gérer le fallback JSON.
2. **Builder prompt côté runtime (`packages/server` ou `packages/core` selon usage)** – injecter le schéma TOON dans le prompt système.
3. **Connecteurs MCP / docs** – permettre de livrer des réponses hiérarchisées en TOON lorsque la source est tabulaire.
4. **Outils DX** – CLI ou script pour convertir localement des fixtures/tests en TOON.

## Plan d'intégration

### Phase 0 – Préparation & cadrage
- Cartographier les points d'entrée où des tableaux d'objets sont transmis au LLM (workflows, agents, MCP servers).
- Définir une heuristique `isToonCandidate(data)` (tableau d'objets, clés identiques, valeurs scalaires ou dates).
- Ajouter `@toon-format/toon` dans les packages concernés (`core`, `server`, `mcp`), valider la compatibilité TypeScript.

### Phase 1 – Utilitaires de conversion
- Créer un helper `serializeToToon(data, { name })` qui retourne soit une chaîne TOON soit `null` si le dataset n’est pas admissible.
- Exposer un équivalent `parseToon` pour les rares cas où l’on doit re-transformer la réponse modèle vers JSON.
- Ajouter des tests unitaires (fixtures JSON → TOON) dans `packages/core/tests`.
- Instrumenter pour logguer le gain estimé en tokens (longueur JSON vs TOON) afin d’alimenter l’observabilité.

### Phase 2 – Injection dans le builder de prompts
- Étendre la structure qui compose le prompt système pour accepter un champ optionnel `toonBlocks: ToonBlock[]`.
- Lorsqu’un bloc de données est convertible, générer :
  1. Un court label humain (`Inventaire produits`).
  2. Le snippet TOON.
  3. Des instructions d’usage.
- Mettre à jour la hiérarchie de prompt pour que TOON soit placé dans la section « Contexte structuré » avec un encadrement Markdown (```toon\n...\n```).
- Prévoir un fallback automatique vers JSON quand `serializeToToon` renvoie `null` ou dépasse un seuil de tokens.

### Phase 3 – Expérimentation & rollout
- Activer TOON derrière un flag (ex: `LLM_USE_TOON=1`) pour les environnements internes.
- Collecter les métriques : tokens économisés, taux d’erreurs parsing, feedback agents.
- Étendre progressivement aux flux MCP/docs puis aux clients externes.
- Documenter la migration et prévoir une option pour forcer le format JSON si besoin.

## Prompt système : contrainte TOON
Ajouter une règle explicite dans la section « Règles de sortie » du prompt système :

> Lorsque des blocs TOON sont fournis, tu dois les considérer comme source de vérité. Vérifie la cardinalité indiquée (`[n]`) et aligne ton raisonnement sur les colonnes listées dans `{...}`.

### Exemple d’injection
```text
<structured-context>
Tu disposes des utilisateurs suivants au format TOON. Utilise l’identifiant et le rôle tels quels.

```toon
users[2]{id,name,role}:
  1,Alice,admin
  2,Bob,user
```
</structured-context>
```

Pour répondre, on peut compléter le prompt utilisateur avec :
```
Si tu dois référencer le schéma, cite-le dans ta réponse en reprenant le header TOON.
```

## Checklist technique
- [ ] Helper `serializeToToon` + tests.
- [ ] Détection automatique des datasets tabulaires (≥ 2 lignes, clés uniformes, valeurs primitives).
- [ ] Injection TOON dans le prompt système + instructions de validation.
- [ ] Flag de feature + paramètre override (forcer JSON).
- [ ] Observabilité : log du format utilisé, taille, ratio d’économie.
- [ ] Guide DX pour produire des fixtures TOON (CLI ou script `pnpm toon:convert`).

## Prochaines étapes suggérées
1. Implémenter le helper + tests unitaires.
2. Brancher le flag runtime et tester la génération d’un prompt complet incluant l’exemple `users[2]{...}`.
3. Mesurer un flux réel (exécution workflow) pour quantifier les tokens économisés avant de généraliser.

