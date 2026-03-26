export interface HostedExecutionDispatchEnvironment {
  dispatchUrl: string | null;
  signingSecret: string | null;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedExecutionDispatchEnvironment(
  source: EnvSource = process.env,
): HostedExecutionDispatchEnvironment {
  return {
    dispatchUrl: normalizeBaseUrl(source.HOSTED_EXECUTION_DISPATCH_URL),
    signingSecret: normalizeString(source.HOSTED_EXECUTION_SIGNING_SECRET),
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
