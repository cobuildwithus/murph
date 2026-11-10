import { test } from 'vitest'

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false
    default:
      return undefined
  }
}

export function resolveLocalCliSuiteConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = parseBooleanEnv(
    env.MURPH_VITEST_SUITE_CONCURRENCY,
  )

  if (override !== undefined) {
    return override
  }

  // Keep the helper aligned with the shared repo default. The CLI test
  // package cannot import the repo-root config helper without breaking its
  // package-local typecheck rootDir boundary, so this stays as a small local
  // mirror of the shared opt-in policy.
  return false
}

export const localParallelCliTest: typeof test | typeof test.concurrent = resolveLocalCliSuiteConcurrency()
  ? test.concurrent
  : test
