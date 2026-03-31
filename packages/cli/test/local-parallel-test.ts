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

function resolveLocalCliSuiteConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = parseBooleanEnv(
    env.MURPH_VITEST_SUITE_CONCURRENCY ?? env.MURPH_TEST_SUITE_CONCURRENCY,
  )

  if (override !== undefined) {
    return override
  }

  return !env.CI
}

const localParallelCliTestBase = ((...args: Parameters<typeof test>) =>
  resolveLocalCliSuiteConcurrency()
    ? test.concurrent(...args)
    : test(...args)) as typeof test

export const localParallelCliTest: typeof test = Object.assign(
  localParallelCliTestBase,
  test,
)
