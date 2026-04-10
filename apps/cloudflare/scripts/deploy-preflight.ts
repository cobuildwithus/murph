import { HOSTED_WORKER_REQUIRED_SECRET_NAMES } from "./deploy-automation/secrets.ts";
import { normalizeOptionalString } from "./deploy-automation/shared.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;

const REQUIRED_DEPLOY_ENV_NAMES = [
  "CF_WORKER_NAME",
  "CF_BUNDLES_BUCKET",
  "CF_BUNDLES_PREVIEW_BUCKET",
] as const;

const REQUIRED_DEPLOY_WORKER_ENV_NAMES = [
  "CF_PUBLIC_BASE_URL",
  "HOSTED_WEB_BASE_URL",
  "HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG",
  "HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME",
] as const;

const BRAVE_REQUIRED_ENV_NAMES = ["BRAVE_API_KEY"] as const;

export function listMissingHostedDeployEnvironment(
  source: EnvSource = process.env,
  input: {
    deployWorker: boolean;
  },
): string[] {
  const requiredEnvNames: readonly string[] = [
    ...REQUIRED_DEPLOY_ENV_NAMES,
    ...(input.deployWorker
      ? [
          ...REQUIRED_DEPLOY_WORKER_ENV_NAMES,
          ...HOSTED_WORKER_REQUIRED_SECRET_NAMES,
          ...(isBraveWebSearchProvider(source) ? BRAVE_REQUIRED_ENV_NAMES : []),
        ]
      : []),
  ];

  return listMissingRequiredEnvNames(source, requiredEnvNames);
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
  const normalized = normalizeOptionalString(value);
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function listMissingRequiredEnvNames(
  source: EnvSource,
  names: readonly string[],
): string[] {
  return names.filter((name) => normalizeOptionalString(source[name]) === null);
}

function isBraveWebSearchProvider(source: EnvSource): boolean {
  return normalizeOptionalString(source.MURPH_WEB_SEARCH_PROVIDER)?.toLowerCase() === "brave";
}
