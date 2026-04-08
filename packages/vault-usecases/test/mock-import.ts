import { vi } from "vitest";

export type ModuleMockFactory = () => unknown | Promise<unknown>;

export function mockActualModule<TModule extends Record<string, unknown>>(
  specifier: string,
  patch: (actual: TModule) => TModule | Promise<TModule>,
): ModuleMockFactory {
  return async () => {
    const actual = await vi.importActual<TModule>(specifier);
    return patch(actual);
  };
}

export async function importWithMocks<TModule>(
  moduleSpecifier: string,
  mocks: Record<string, ModuleMockFactory> = {},
): Promise<TModule> {
  vi.resetModules();
  for (const [specifier, factory] of Object.entries(mocks)) {
    vi.doMock(specifier, factory);
  }
  return import(moduleSpecifier) as Promise<TModule>;
}
