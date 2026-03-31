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

export function resolveMurphVitestMaxWorkers(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.MURPH_VITEST_MAX_WORKERS ?? (env.CI ? "50%" : "75%");
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
