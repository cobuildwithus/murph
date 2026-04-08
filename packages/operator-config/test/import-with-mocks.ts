import { vi } from 'vitest'

export async function importWithMocks<TModule>(
  modulePath: string,
  setupMocks: () => void,
): Promise<TModule> {
  vi.resetModules()
  setupMocks()
  return (await import(modulePath)) as TModule
}
