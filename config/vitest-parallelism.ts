function parseMurphBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return undefined;
  }
}

function parseMurphPositiveIntegerEnv(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveMurphVitestFileParallelism(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = parseMurphBooleanEnv(
    env.MURPH_VITEST_FILE_PARALLELISM ?? env.MURPH_TEST_FILE_PARALLELISM,
  );

  if (override !== undefined) {
    return override;
  }

  return !env.CI;
}

export function resolveMurphVitestSuiteConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = parseMurphBooleanEnv(
    env.MURPH_VITEST_SUITE_CONCURRENCY ?? env.MURPH_TEST_SUITE_CONCURRENCY,
  );

  if (override !== undefined) {
    return override;
  }

  // File-level parallelism delivers most of the local speedup. Keeping
  // in-file suite concurrency opt-in avoids shared-process collisions around
  // fetch stubs, process.env mutations, fake timers, and other global mocks.
  return false;
}

export function resolveMurphVitestMaxWorkers(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.MURPH_VITEST_MAX_WORKERS ?? (env.CI ? "50%" : "75%");
}

export function resolveMurphVitestMaxConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    parseMurphPositiveIntegerEnv(
      env.MURPH_VITEST_MAX_CONCURRENCY ??
        env.MURPH_TEST_MAX_CONCURRENCY ??
        env.MURPH_CLI_VITEST_MAX_CONCURRENCY,
    ) ?? (env.CI ? 1 : 2)
  );
}

export function resolveMurphVitestConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): {
  fileParallelism: boolean;
  maxConcurrency: number;
  sequence: {
    concurrent: boolean;
  };
} {
  return {
    fileParallelism: resolveMurphVitestFileParallelism(env),
    maxConcurrency: resolveMurphVitestMaxConcurrency(env),
    sequence: {
      concurrent: resolveMurphVitestSuiteConcurrency(env),
    },
  };
}

export function resolveMurphAppVitestMaxWorkers(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.MURPH_APP_VITEST_MAX_WORKERS ??
    env.MURPH_VITEST_MAX_WORKERS ??
    (env.CI ? "25%" : "50%")
  );
}
