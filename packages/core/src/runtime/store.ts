import { AsyncLocalStorage } from "node:async_hooks";

import { getRuntimeResource } from "./resources.js";

export type RuntimeState = Record<string, unknown>;

export const RUNTIME_CONTEXT_FIELD = "__ai_kit_runtime";

const runtimeStorage = new AsyncLocalStorage<RuntimeStore<any>>();

type CleanupHandler<State extends RuntimeState> = (
  value: State[keyof State & string] | undefined,
  context: { key: string; runtime: RuntimeStore<State> },
) => void | Promise<void>;

type CleanupMap<State extends RuntimeState> = Map<
  string,
  Set<CleanupHandler<State>>
>;

interface RuntimeStoreInternal<State extends RuntimeState> {
  values: Map<string, unknown>;
  cleanup: CleanupMap<State>;
  parent?: RuntimeStore<any>;
  disposed?: boolean;
}

export interface RuntimeStoreInit<State extends RuntimeState> {
  defaults?: Partial<State> | Iterable<[string, State[keyof State & string]]>;
}

export class RuntimeStore<State extends RuntimeState = RuntimeState> {
  private values: Map<string, unknown>;
  private cleanup: CleanupMap<State>;
  private disposed: boolean;
  private readonly parent?: RuntimeStore<any>;

  constructor(init?: RuntimeStoreInit<State> | { internal: RuntimeStoreInternal<State> }) {
    if (init && "internal" in init) {
      this.values = init.internal.values;
      this.cleanup = init.internal.cleanup;
      this.parent = init.internal.parent;
      this.disposed = init.internal.disposed ?? false;
      return;
    }

    this.values = new Map();
    this.cleanup = new Map();
    this.disposed = false;
    this.parent = undefined;

    const defaults = init?.defaults;
    if (defaults) {
      if (isIterableTuple(defaults)) {
        for (const [key, value] of defaults) {
          this.values.set(key, value);
        }
      } else {
        for (const [key, value] of Object.entries(defaults as Record<string, unknown>)) {
          if (value !== undefined) {
            this.values.set(key, value);
          }
        }
      }
    }
  }

  private cloneCleanup(): CleanupMap<State> {
    const next = new Map<string, Set<CleanupHandler<State>>>();
    for (const [key, handlers] of this.cleanup.entries()) {
      next.set(key, new Set(handlers));
    }
    return next;
  }

  snapshot(): RuntimeStore<State> {
    this.assertActive();
    return new RuntimeStore<State>({
      internal: {
        values: new Map(this.values),
        cleanup: this.cloneCleanup(),
        parent: this,
        disposed: false,
      },
    });
  }

  run<T>(callback: () => T | Promise<T>): T | Promise<T> {
    this.assertActive();
    return runtimeStorage.run(this, callback);
  }

  isDisposed() {
    return this.disposed;
  }

  get<Key extends string & keyof State>(key: Key): State[Key] | undefined;
  get(key: string): unknown;
  get(key: string) {
    return this.values.get(key);
  }

  has<Key extends string & keyof State>(key: Key): boolean;
  has(key: string): boolean;
  has(key: string) {
    return this.values.has(key);
  }

  set<Key extends string & keyof State>(key: Key, value: State[Key]): this;
  set(key: string, value: unknown): this;
  set(key: string, value: unknown) {
    this.assertActive();
    this.values.set(key, value);
    return this;
  }

  delete<Key extends string & keyof State>(key: Key): boolean;
  delete(key: string): boolean;
  delete(key: string) {
    this.assertActive();
    this.cleanup.delete(key);
    return this.values.delete(key);
  }

  clear() {
    this.assertActive();
    this.cleanup.clear();
    this.values.clear();
  }

  entries() {
    return this.values.entries();
  }

  keys() {
    return this.values.keys();
  }

  valuesIterator() {
    return this.values.values();
  }

  [Symbol.iterator]() {
    return this.values[Symbol.iterator]();
  }

  require<Key extends string & keyof State>(key: Key): State[Key] {
    if (!this.has(key)) {
      throw new Error(`Runtime value "${key}" is not loaded.`);
    }

    return this.get(key) as State[Key];
  }

  assertLoaded<Key extends string & keyof State>(key: Key): void {
    void this.require(key);
  }

  onCleanup<Key extends string & keyof State>(
    key: Key,
    handler: CleanupHandler<State>,
  ) {
    this.assertActive();
    let handlers = this.cleanup.get(key);
    if (!handlers) {
      handlers = new Set();
      this.cleanup.set(key, handlers);
    }

    handlers.add(handler);

    return () => {
      const current = this.cleanup.get(key);
      if (!current) {
        return;
      }

      current.delete(handler);
      if (current.size === 0) {
        this.cleanup.delete(key);
      }
    };
  }

  async dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const errors: unknown[] = [];

    for (const [key, handlers] of this.cleanup.entries()) {
      if (!handlers.size) {
        continue;
      }

      const value = this.values.get(key) as
        | State[keyof State & string]
        | undefined;

      for (const handler of handlers) {
        try {
          await handler(value, { key, runtime: this });
        } catch (error) {
          errors.push(error);
        }
      }
    }

    this.cleanup.clear();
    this.values.clear();

    if (errors.length === 1) {
      throw errors[0];
    }

    if (errors.length > 1) {
      throw new AggregateError(errors, "Runtime cleanup failed.");
    }
  }

  async load<Source, Value = unknown>(
    name: string,
    source: Source,
  ): Promise<Value> {
    this.assertActive();
    const resource = getRuntimeResource<Source, Value>(name);

    if (!resource) {
      throw new Error(`Runtime resource "${name}" is not registered.`);
    }

    const value = await resource.loader(source, this);
    this.set(name, value);

    if (resource.dispose) {
      const disposer = resource.dispose;
      this.onCleanup(name as string & keyof State, async currentValue => {
        const runtimeValue =
          (currentValue as Value | undefined) ?? (value as Value);
        await disposer(runtimeValue, this);
      });
    }

    return value as Value;
  }

  static current<State extends RuntimeState = RuntimeState>() {
    return runtimeStorage.getStore() as RuntimeStore<State> | undefined;
  }

  static requireCurrent<State extends RuntimeState = RuntimeState>() {
    const runtime = RuntimeStore.current<State>();
    if (!runtime) {
      throw new Error("No runtime store bound to the current execution context.");
    }

    if (runtime.isDisposed()) {
      throw new Error("The current runtime store has already been disposed.");
    }

    return runtime;
  }

  static mergeExperimentalContext(
    base: unknown,
    runtime?: RuntimeStore<any>,
  ) {
    if (!runtime) {
      return base;
    }

    if (base !== undefined && (typeof base !== "object" || base === null)) {
      throw new Error(
        "experimental_context must be an object when using a runtime store.",
      );
    }

    const context = {
      ...((base as Record<string, unknown>) ?? {}),
      [RUNTIME_CONTEXT_FIELD]: runtime,
    } satisfies Record<string, unknown>;

    return context;
  }

  static resolveFromExperimentalContext<State extends RuntimeState = RuntimeState>(
    context: unknown,
  ) {
    if (context && typeof context === "object") {
      const runtime = (context as Record<string, unknown>)[RUNTIME_CONTEXT_FIELD];
      if (runtime instanceof RuntimeStore) {
        return runtime as RuntimeStore<State>;
      }
    }

    return undefined;
  }

  private assertActive() {
    if (this.disposed) {
      throw new Error("Runtime store has already been disposed.");
    }
  }
}

export function createRuntime<State extends RuntimeState = RuntimeState>(
  init?: RuntimeStoreInit<State>,
) {
  return new RuntimeStore<State>(init);
}

export function withRuntime<State extends RuntimeState, T>(
  runtime: RuntimeStore<State> | undefined,
  callback: (scoped: RuntimeStore<State> | undefined) => T,
) {
  if (!runtime) {
    return callback(undefined);
  }

  const scoped = runtime.snapshot();

  const result = scoped.run(() => callback(scoped));

  if (result instanceof Promise) {
    return result.finally(() => scoped.dispose()) as T;
  }

  void scoped.dispose();
  return result;
}

function isIterableTuple(
  value: Partial<RuntimeState> | Iterable<[string, unknown]>,
): value is Iterable<[string, unknown]> {
  return typeof value === "object" && value !== null && Symbol.iterator in value;
}

