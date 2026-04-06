export function loadRuntimeModule<TModule>(specifier: string): Promise<TModule> {
  return import(specifier) as Promise<TModule>
}
