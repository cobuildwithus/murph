export interface HostedExecutionDispatchEnvironment {
  dispatchTimeoutMs: number;
  dispatchUrl: string | null;
  signingSecret: string | null;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedExecutionDispatchEnvironment(
  source: EnvSource = process.env,
): HostedExecutionDispatchEnvironment {
  const dispatchUrl = normalizeBaseUrl(source.HOSTED_EXECUTION_CLOUDFLARE_BASE_URL);
  const legacyDispatchUrl = normalizeBaseUrl(source.HOSTED_EXECUTION_DISPATCH_URL);
  const signingSecret = normalizeString(source.HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET);
  const legacySigningSecret = normalizeString(source.HOSTED_EXECUTION_SIGNING_SECRET);
  const dispatchTimeout = normalizeString(source.HOSTED_EXECUTION_CLOUDFLARE_TIMEOUT_MS);
  const legacyDispatchTimeout = normalizeString(source.HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS);

  return {
    dispatchTimeoutMs: parsePositiveInteger(
      dispatchTimeout ?? legacyDispatchTimeout,
      30_000,
      "HOSTED_EXECUTION_CLOUDFLARE_TIMEOUT_MS",
    ),
    dispatchUrl: dispatchUrl ?? legacyDispatchUrl,
    signingSecret: signingSecret ?? legacySigningSecret,
  };
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  const url = new URL(normalized);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/u, "");
}

function normalizeString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parsePositiveInteger(value: string | null, fallback: number, label: string): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }

  return parsed;
}
