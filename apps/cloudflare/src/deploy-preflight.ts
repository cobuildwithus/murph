type EnvSource = Readonly<Record<string, string | undefined>>;

const REQUIRED_DEPLOY_ENV_NAMES = [
  "CF_WORKER_NAME",
  "CF_BUNDLES_BUCKET",
  "CF_BUNDLES_PREVIEW_BUCKET",
] as const;

export function listMissingHostedDeployEnvironment(
  source: EnvSource = process.env,
  input: {
    deployWorker: boolean;
  },
): string[] {
  const missing: string[] = REQUIRED_DEPLOY_ENV_NAMES.filter(
    (name) => normalizeString(source[name]) === null,
  );

  if (input.deployWorker && normalizeString(source.CF_PUBLIC_BASE_URL) === null) {
    missing.push("CF_PUBLIC_BASE_URL");
  }

  return missing;
}

export function assertHostedDeployEnvironment(
  source: EnvSource = process.env,
  input: {
    deployWorker: boolean;
  },
): void {
  const missing = listMissingHostedDeployEnvironment(source, input);

  if (missing.length > 0) {
    throw new Error(
      `Missing required GitHub environment variables for deploy workflow: ${missing.join(" ")}`,
    );
  }
}

export function parseDeployWorkerFlag(value: string | undefined): boolean {
  const normalized = normalizeString(value);
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
