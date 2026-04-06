export function readEnvValue(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) {
      return value
    }
  }

  return null
}
