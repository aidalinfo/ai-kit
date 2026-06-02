/**
 * Types d'aide pour écrire des workflows/steps "world" (SDK Vercel).
 *
 * ⚠️ Il n'existe PAS de helper runtime `defineWorldStep`/`defineWorldWorkflow` :
 * le compilateur `workflow/nitro` ne détecte les directives `"use step"` /
 * `"use workflow"` que sur des **liaisons top-level** (fonction nommée, ou
 * arrow/fonction liée directement à un `const`, ou méthode d'objet). Passer la
 * fonction à un wrapper casserait la détection (non-durabilité silencieuse).
 *
 * Écris donc une liaison top-level avec la directive en première instruction,
 * et annote-la avec ces types pour l'ergonomie :
 *
 * @example
 * // Forme nommée (canonique)
 * export async function charge(order: Order): Promise<Receipt> {
 *   "use step";
 *   return chargePayment(order);
 * }
 *
 * @example
 * // Forme const (équivalente, détectée car liée directement au const)
 * export const charge: WorldStep<[Order], Receipt> = async (order) => {
 *   "use step";
 *   return chargePayment(order);
 * };
 */

/** Signature d'un step world : fonction async dont le corps commence par `"use step"`. */
export type WorldStep<Args extends unknown[], Out> = (...args: Args) => Promise<Out>;

/** Signature d'un workflow world : fonction async dont le corps commence par `"use workflow"`. */
export type WorldWorkflow<Args extends unknown[], Out> = (...args: Args) => Promise<Out>;
