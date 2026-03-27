type EnvSource = Readonly<Record<string, string | undefined>>;

export function resolveSmokeWorkerBaseUrl(source: EnvSource = process.env): string {
  const workerBaseUrl =
    normalizeConfiguredString(source.HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL)
    ?? normalizeConfiguredString(source.HOSTED_EXECUTION_DISPATCH_URL);

  if (!workerBaseUrl) {
    throw new Error(
      "HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL or HOSTED_EXECUTION_DISPATCH_URL must be configured.",
    );
  }

  return workerBaseUrl.replace(/\/$/u, "");
}

function normalizeConfiguredString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
