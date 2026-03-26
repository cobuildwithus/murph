import { AsyncLocalStorage } from "node:async_hooks";

interface ScopedProcessEnvState {
  deletedKeys: Set<string>;
  values: NodeJS.ProcessEnv;
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
  return processEnvStorage.getStore()?.values ?? fallbackEnv;
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
      const scopedState = processEnvStorage.getStore();

      if (typeof property === "string" && scopedState) {
        delete scopedState.values[property];
        scopedState.deletedKeys.add(property);
        return true;
      }

      return Reflect.deleteProperty(target, property);
    },
    get(target, property, receiver) {
      const scopedState = processEnvStorage.getStore();

      if (
        typeof property === "string" &&
        scopedState
      ) {
        if (scopedState.deletedKeys.has(property)) {
          return undefined;
        }

        if (Object.prototype.hasOwnProperty.call(scopedState.values, property)) {
          return scopedState.values[property];
        }
      }

      return Reflect.get(target, property, receiver);
    },
    getOwnPropertyDescriptor(target, property) {
      const scopedState = processEnvStorage.getStore();

      if (
        typeof property === "string" &&
        scopedState
      ) {
        if (scopedState.deletedKeys.has(property)) {
          return undefined;
        }

        if (!Object.prototype.hasOwnProperty.call(scopedState.values, property)) {
          return Reflect.getOwnPropertyDescriptor(target, property);
        }

        return {
          configurable: true,
          enumerable: true,
          value: scopedState.values[property],
          writable: true,
        };
      }

      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    has(target, property) {
      const scopedState = processEnvStorage.getStore();

      if (
        typeof property === "string" &&
        scopedState
      ) {
        if (scopedState.deletedKeys.has(property)) {
          return false;
        }

        if (Object.prototype.hasOwnProperty.call(scopedState.values, property)) {
          return true;
        }
      }

      return Reflect.has(target, property);
    },
    ownKeys(target) {
      const scopedState = processEnvStorage.getStore();
      const keys = new Set(Reflect.ownKeys(target));

      if (scopedState) {
        for (const key of Reflect.ownKeys(scopedState.values)) {
          keys.add(key);
        }

        for (const key of scopedState.deletedKeys) {
          keys.delete(key);
        }
      }

      return [...keys];
    },
    set(target, property, value, receiver) {
      const scopedState = processEnvStorage.getStore();

      if (typeof property === "string" && scopedState) {
        scopedState.deletedKeys.delete(property);
        scopedState.values[property] = String(value);
        return true;
      }

      return Reflect.set(target, property, value, receiver);
    },
  });

  process.env = proxy;
  installedProcessEnvProxy = proxy;
}
