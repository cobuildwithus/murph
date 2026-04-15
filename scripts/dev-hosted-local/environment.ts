import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

import { cloudflareDevVarsPath, WRANGLER_VAR_ALLOWLIST } from "./constants.ts";
import {
  HOSTED_WORKER_OPTIONAL_SECRET_NAMES,
  HOSTED_WORKER_REQUIRED_SECRET_NAMES,
} from "../../apps/cloudflare/scripts/deploy-automation/worker-secret-names.ts";
import {
  createEcP256JwkPairJson,
  parsePrivateEcP256Jwk,
  type EcP256JwkPairJson,
  toPublicEcP256Jwk,
} from "./crypto.ts";
import type {
  HostedExecutionOidcIdentity,
  HostedLocalDevConfig,
} from "./types.ts";

export async function resolveCloudflareLocalEnv(input: {
  config: HostedLocalDevConfig;
  oidcIdentity: HostedExecutionOidcIdentity;
}): Promise<Record<string, string>> {
  const originalContents = await tryReadTextFile(cloudflareDevVarsPath);
  const existing = originalContents === null ? {} : parseEnvText(originalContents);

  return mergeCloudflareLocalEnv({
    config: input.config,
    existing,
    oidcIdentity: input.oidcIdentity,
  });
}

export function mergeCloudflareLocalEnv(input: {
  config: HostedLocalDevConfig;
  existing: Record<string, string>;
  oidcIdentity: HostedExecutionOidcIdentity;
  createEnvelopeKey?: () => string;
  createJwkPair?: () => EcP256JwkPairJson;
}): Record<string, string> {
  const createEnvelopeKey = input.createEnvelopeKey ?? (() => randomBytes(32).toString("base64"));
  const createJwkPair = input.createJwkPair ?? createEcP256JwkPairJson;

  assertLocalWorkerOidcEnvironment(input.existing);

  const automationKeys = input.existing.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK?.trim()
    && input.existing.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK?.trim()
    ? {
      privateJwkJson: input.existing.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK,
      publicJwkJson: input.existing.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK,
    }
    : createJwkPair();
  const callbackSigningPrivateJwkJson = input.existing.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK?.trim()
    ? input.existing.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK
    : createJwkPair().privateJwkJson;
  const webOrigin = `http://${input.config.webHost}:${input.config.webPort}`;

  return {
    ...input.existing,
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY:
      input.existing.HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY?.trim()
      ?? createEnvelopeKey(),
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID:
      input.existing.HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID?.trim()
      ?? "v1",
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID:
      input.existing.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID?.trim()
      ?? "automation:v1",
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: automationKeys.privateJwkJson,
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: automationKeys.publicJwkJson,
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID:
      input.existing.HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID?.trim()
      ?? "recovery:v1",
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK:
      input.existing.HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK?.trim()
      ?? automationKeys.publicJwkJson,
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: input.oidcIdentity.teamSlug,
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: input.oidcIdentity.projectName,
    HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: input.oidcIdentity.environment,
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackSigningPrivateJwkJson,
    HOSTED_WEB_CALLBACK_SIGNING_KEY_ID:
      input.existing.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID?.trim()
      ?? "v1",
    HOSTED_WEB_BASE_URL: webOrigin,
  };
}

export function buildHostedLocalDevOverrides(
  config: HostedLocalDevConfig,
  cloudflareDevVars: Record<string, string>,
): NodeJS.ProcessEnv {
  const webOrigin = `http://${config.webHost}:${config.webPort}`;
  const workerBaseUrl = `${config.workerProtocol}://${config.workerHost}:${config.workerPort}`;
  const callbackPrivateJwkJson = cloudflareDevVars.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK;
  const callbackKeyId = cloudflareDevVars.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID?.trim();

  return {
    HOSTED_EXECUTION_DISPATCH_URL: workerBaseUrl,
    HOSTED_ONBOARDING_PUBLIC_BASE_URL: webOrigin,
    HOSTED_WEB_BASE_URL: webOrigin,
    ...(callbackPrivateJwkJson
      ? {
        HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK: JSON.stringify(
          toPublicEcP256Jwk(parsePrivateEcP256Jwk(callbackPrivateJwkJson)),
        ),
      }
      : {}),
    ...(callbackKeyId ? { HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: callbackKeyId } : {}),
    VERCEL_PROJECT_PRODUCTION_URL: `${config.webHost}:${config.webPort}`,
  };
}

export function buildWranglerVarArgs(
  cloudflareDevVars: Readonly<Record<string, string | undefined>>,
): string[] {
  const args: string[] = [];

  for (const key of new Set(WRANGLER_VAR_ALLOWLIST)) {
    const value = cloudflareDevVars[key];

    if (!value?.trim()) {
      continue;
    }

    args.push("--var", `${key}:${value}`);
  }

  return args;
}

export function buildWranglerEnvFileText(
  source: Readonly<Record<string, string | undefined>>,
): string {
  const entries = new Map<string, string>();

  for (const key of [
    ...HOSTED_WORKER_REQUIRED_SECRET_NAMES,
    ...HOSTED_WORKER_OPTIONAL_SECRET_NAMES,
    ...WRANGLER_VAR_ALLOWLIST,
  ]) {
    const value = resolveWranglerEnvValue(key, source);

    if (!value) {
      continue;
    }

    entries.set(key, value);
  }

  return [...entries.entries()]
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
}

export function buildWranglerLocalDevConfig(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, unknown> {
  const vars: Record<string, string> = {
    HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS: resolveWranglerEnvValue("HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS", source) ?? "3",
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID: resolveWranglerEnvValue("HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID", source) ?? "v1",
    HOSTED_EXECUTION_RETRY_DELAY_MS: resolveWranglerEnvValue("HOSTED_EXECUTION_RETRY_DELAY_MS", source) ?? "30000",
    HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: resolveWranglerEnvValue("HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS", source) ?? "30000",
    HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: resolveWranglerEnvValue("HOSTED_EXECUTION_RUNNER_TIMEOUT_MS", source) ?? "120000",
    HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: resolveWranglerEnvValue("HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT", source) ?? "development",
  };

  for (const key of new Set(WRANGLER_VAR_ALLOWLIST)) {
    const value = resolveWranglerEnvValue(key, source);
    if (value) {
      vars[key] = value;
    }
  }

  const requiredSecrets = [
    ...HOSTED_WORKER_REQUIRED_SECRET_NAMES,
    ...HOSTED_WORKER_OPTIONAL_SECRET_NAMES.filter((key) => Boolean(resolveWranglerEnvValue(key, source))),
  ];

  return {
    name: "murph-hosted",
    main: "../src/index.ts",
    compatibility_date: "2026-03-27",
    compatibility_flags: ["nodejs_compat"],
    containers: [
      {
        class_name: "RunnerContainer",
        image: "../../../Dockerfile.cloudflare-hosted-runner",
        image_build_context: "..",
        instance_type: "standard-1",
        max_instances: 50,
      },
    ],
    durable_objects: {
      bindings: [
        {
          name: "USER_RUNNER",
          class_name: "UserRunnerDurableObject",
        },
        {
          name: "RUNNER_CONTAINER",
          class_name: "RunnerContainer",
        },
      ],
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: ["UserRunnerDurableObject"],
      },
      {
        tag: "v2",
        new_sqlite_classes: ["RunnerContainer"],
      },
    ],
    r2_buckets: [
      {
        binding: "BUNDLES",
        bucket_name: "murph-hosted-bundles",
        preview_bucket_name: "murph-hosted-bundles-preview",
      },
    ],
    observability: {
      enabled: true,
      head_sampling_rate: 1,
      logs: {
        enabled: true,
        invocation_logs: true,
        persist: true,
        head_sampling_rate: 1,
      },
      traces: {
        enabled: true,
        persist: true,
        head_sampling_rate: 1,
      },
    },
    secrets: {
      required: requiredSecrets,
    },
    vars,
  };
}

export async function readSimpleEnvFile(filePath: string): Promise<Record<string, string>> {
  const raw = await readFile(filePath, "utf8");
  return parseEnvText(raw);
}

export async function readOptionalSimpleEnvFile(filePath: string): Promise<Record<string, string>> {
  const raw = await tryReadTextFile(filePath);
  return raw === null ? {} : parseEnvText(raw);
}

export function parseEnvText(raw: string): Record<string, string> {
  const parsed = parseEnv(raw);

  return Object.fromEntries(
    Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function assertLocalWorkerOidcEnvironment(cloudflareDevVars: Record<string, string>): void {
  const environment = cloudflareDevVars.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT?.trim();

  if (environment && environment !== "development") {
    throw new Error(
      [
        "apps/cloudflare/.dev.vars must set HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=development for local `pnpm dev`.",
        `Current value: ${JSON.stringify(environment)}`,
      ].join(" "),
    );
  }
}

export function requireEnvValue(label: string, value: string | undefined, help: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`${label} is required for local hosted dev. ${help}`);
  }

  return normalized;
}

export function warnForMissingEnv(label: string, value: string | undefined): void {
  if (value?.trim()) {
    return;
  }

  process.stderr.write(
    `[setup] Warning: ${label} is not configured. The full hosted signup flow will stay incomplete until it is added.\n`,
  );
}

function resolveWranglerEnvValue(
  key: string,
  source: Readonly<Record<string, string | undefined>>,
): string | null {
  const value = source[key]?.trim();

  if (value) {
    return value;
  }

  if (key === "HOSTED_EXECUTION_RUNNER_ENV_PROFILES") {
    return "device-sync,hosted-email,linq,mapbox,telegram";
  }

  return null;
}

async function tryReadTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}
