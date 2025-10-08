import type { RuntimeStore } from "./store.js";

export interface RuntimeResourceDefinition<Source = unknown, Value = unknown> {
  loader: (source: Source, runtime: RuntimeStore<any>) => Promise<Value> | Value;
  dispose?: (value: Value, runtime: RuntimeStore<any>) => Promise<void> | void;
}

type RuntimeResourceRegistry = Map<string, RuntimeResourceDefinition<any, any>>;

const registry: RuntimeResourceRegistry = new Map();

export function registerRuntimeResource<Source, Value>(
  name: string,
  definition: RuntimeResourceDefinition<Source, Value>,
) {
  if (registry.has(name)) {
    throw new Error(`Runtime resource "${name}" is already registered.`);
  }

  registry.set(name, definition as RuntimeResourceDefinition<any, any>);

  return () => {
    const current = registry.get(name);
    if (current === definition) {
      registry.delete(name);
    }
  };
}

export function getRuntimeResource<Source, Value>(
  name: string,
): RuntimeResourceDefinition<Source, Value> | undefined {
  return registry.get(name) as RuntimeResourceDefinition<Source, Value> | undefined;
}

