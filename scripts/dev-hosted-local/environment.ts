import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

import { cloudflareDevVarsPath, WRANGLER_VAR_ALLOWLIST } from "./constants.ts";
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

export function buildWranglerVarArgs(cloudflareDevVars: Record<string, string>): string[] {
  const args: string[] = [];

  for (const key of WRANGLER_VAR_ALLOWLIST) {
    const value = cloudflareDevVars[key];

    if (!value?.trim()) {
      continue;
    }

    args.push("--var", `${key}:${value}`);
  }

  return args;
}

export async function readSimpleEnvFile(filePath: string): Promise<Record<string, string>> {
  const raw = await readFile(filePath, "utf8");
  return parseEnvText(raw);
}

export function parseEnvText(raw: string): Record<string, string> {
  const parsed = parseEnv(raw);

  return Object.fromEntries(
    Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, value]) => [key, normalizeLoadedEnvValue(key, value)]),
  );
}

export function normalizeLoadedEnvValue(key: string, value: string): string {
  const prefix = `${key}=`;
  let normalized = value;

  // Guard against values pasted into Vercel as `KEY=value` instead of just `value`.
  if (normalized.startsWith(prefix)) {
    normalized = normalized.slice(prefix.length);
  }

  if (normalized.startsWith("{\\\"") || normalized.startsWith("[\\\"")) {
    normalized = normalized.replace(/\\"/gu, "\"");
  }

  return normalized;
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
