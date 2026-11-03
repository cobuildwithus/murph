export function assertNever(value: never): never {
  throw new Error(`Unexpected hosted execution event: ${JSON.stringify(value)}`);
}

export function hasAnyHostedRuntimeConfigKey(
  source: Readonly<Record<string, string>>,
  keys: readonly string[],
): boolean {
  return keys.some((key) => typeof source[key] === "string" && source[key].length > 0);
}

export function computeHostedRuntimeElapsedMs(
  run: { startedAt?: string | null } | null | undefined,
): number | null {
  if (!run?.startedAt) {
    return null;
  }

  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  return Math.max(0, Date.now() - startedAtMs);
}
