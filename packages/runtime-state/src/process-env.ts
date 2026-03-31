import { AsyncLocalStorage } from "node:async_hooks";

interface ScopedProcessEnvState {
  deletedKeys: Set<string>;
  values: NodeJS.ProcessEnv;
}

interface ScopedProcessEnvPropertyContext {
  property: string;
  scopedState: ScopedProcessEnvState;
}

const processEnvStorage = new AsyncLocalStorage<ScopedProcessEnvState>();
let installedProcessEnvProxy: NodeJS.ProcessEnv | null = null;

export function buildScopedProcessEnv(
  overrides: Readonly<Record<string, string>>,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    ...overrides,
  };
}

export function getScopedProcessEnv(
  fallbackEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return getScopedProcessEnvState()?.values ?? fallbackEnv;
}

export async function withScopedProcessEnv<T>(
  env: NodeJS.ProcessEnv,
  run: () => Promise<T>,
): Promise<T> {
  ensureProcessEnvProxyInstalled();
  return processEnvStorage.run(
    {
      deletedKeys: new Set(),
      values: { ...env },
    },
    run,
  );
}

function ensureProcessEnvProxyInstalled(): void {
  if (installedProcessEnvProxy === process.env) {
    return;
  }

  const baseEnv = process.env;
  const proxy = new Proxy(baseEnv, {
    deleteProperty(target, property) {
      const context = resolveScopedProcessEnvPropertyContext(property);

      if (!context) {
        return Reflect.deleteProperty(target, property);
      }

      delete context.scopedState.values[context.property];
      context.scopedState.deletedKeys.add(context.property);
      return true;
    },
    get(target, property, receiver) {
      const context = resolveScopedProcessEnvPropertyContext(property);

      if (!context) {
        return Reflect.get(target, property, receiver);
      }

      if (context.scopedState.deletedKeys.has(context.property)) {
        return undefined;
      }

      if (hasScopedProcessEnvValue(context.scopedState, context.property)) {
        return context.scopedState.values[context.property];
      }

      return Reflect.get(target, property, receiver);
    },
    getOwnPropertyDescriptor(target, property) {
      const context = resolveScopedProcessEnvPropertyContext(property);

      if (!context) {
        return Reflect.getOwnPropertyDescriptor(target, property);
      }

      if (context.scopedState.deletedKeys.has(context.property)) {
        return undefined;
      }

      if (!hasScopedProcessEnvValue(context.scopedState, context.property)) {
        return Reflect.getOwnPropertyDescriptor(target, property);
      }

      return {
        configurable: true,
        enumerable: true,
        value: context.scopedState.values[context.property],
        writable: true,
      };
    },
    has(target, property) {
      const context = resolveScopedProcessEnvPropertyContext(property);

      if (!context) {
        return Reflect.has(target, property);
      }

      if (context.scopedState.deletedKeys.has(context.property)) {
        return false;
      }

      if (hasScopedProcessEnvValue(context.scopedState, context.property)) {
        return true;
      }

      return Reflect.has(target, property);
    },
    ownKeys(target) {
      const scopedState = getScopedProcessEnvState();
      const keys = new Set(Reflect.ownKeys(target));

      if (!scopedState) {
        return [...keys];
      }

      for (const key of Reflect.ownKeys(scopedState.values)) {
        keys.add(key);
      }

      for (const key of scopedState.deletedKeys) {
        keys.delete(key);
      }

      return [...keys];
    },
    set(target, property, value, receiver) {
      const context = resolveScopedProcessEnvPropertyContext(property);

      if (!context) {
        return Reflect.set(target, property, value, receiver);
      }

      context.scopedState.deletedKeys.delete(context.property);
      context.scopedState.values[context.property] = String(value);
      return true;
    },
  });

  process.env = proxy;
  installedProcessEnvProxy = proxy;
}

function getScopedProcessEnvState(): ScopedProcessEnvState | null {
  return processEnvStorage.getStore() ?? null;
}

function resolveScopedProcessEnvPropertyContext(
  property: PropertyKey,
): ScopedProcessEnvPropertyContext | null {
  if (typeof property !== "string") {
    return null;
  }

  const scopedState = getScopedProcessEnvState();
  return scopedState
    ? {
        property,
        scopedState,
      }
    : null;
}

function hasScopedProcessEnvValue(
  scopedState: ScopedProcessEnvState,
  property: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(scopedState.values, property);
}
