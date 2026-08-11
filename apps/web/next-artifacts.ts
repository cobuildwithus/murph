import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export const HOSTED_WEB_BUILD_DIST_DIR = ".next";
export const HOSTED_WEB_DEV_DIST_DIR = ".next-dev";
export const HOSTED_WEB_SMOKE_DIST_DIR = ".next-smoke";

const hostedWebDevFileSystemCacheEnvVarName = "MURPH_NEXT_DEV_FILESYSTEM_CACHE";
const hostedWebDistModeEnvVarName = "NEXT_DIST_DIR_MODE";
const hostedWebDistSuffixEnvVarName = "NEXT_DIST_DIR_SUFFIX";
const hostedWebSmokeDistMode = "smoke";
const hostedWebSmokeDefaultDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync";
const hostedWebSmokeDefaultEncryptionKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const hostedWebSmokeDefaultAppSessionHmacKey = Buffer.alloc(32, 8).toString("base64url");
const hostedWebSmokeDefaultEncryptionKeyVersion = "v1";
const hostedWebSmokeDefaultPrivyAppId = "cm_app_smoke_placeholder1";

export function isHostedWebSmokeArtifactMode(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment[hostedWebDistModeEnvVarName] === hostedWebSmokeDistMode;
}

export function createHostedWebSmokeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    DATABASE_URL: environment.DATABASE_URL ?? hostedWebSmokeDefaultDatabaseUrl,
    HOSTED_APP_SESSION_HMAC_KEY:
      environment.HOSTED_APP_SESSION_HMAC_KEY
      ?? hostedWebSmokeDefaultAppSessionHmacKey,
    HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION:
      environment.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION
      ?? hostedWebSmokeDefaultEncryptionKeyVersion,
    HOSTED_CONTACT_PRIVACY_KEYS:
      environment.HOSTED_CONTACT_PRIVACY_KEYS
      ?? `v1:${hostedWebSmokeDefaultEncryptionKey}`,
    HOSTED_MAILBOX_FINGERPRINT_KEY:
      environment.HOSTED_MAILBOX_FINGERPRINT_KEY
      ?? hostedWebSmokeDefaultEncryptionKey,
    NEXT_PUBLIC_PRIVY_APP_ID: environment.NEXT_PUBLIC_PRIVY_APP_ID ?? hostedWebSmokeDefaultPrivyAppId,
    [hostedWebDistModeEnvVarName]: hostedWebSmokeDistMode,
  };
}

export function isHostedWebDevFileSystemCacheEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalized = environment[hostedWebDevFileSystemCacheEnvVarName]?.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function resolveHostedWebDistDir(
  phase: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const useSmokeDistDir = isHostedWebSmokeArtifactMode(environment);
  if (phase !== PHASE_DEVELOPMENT_SERVER && !useSmokeDistDir) {
    return HOSTED_WEB_BUILD_DIST_DIR;
  }

  const baseDistDir = useSmokeDistDir
    ? HOSTED_WEB_SMOKE_DIST_DIR
    : HOSTED_WEB_DEV_DIST_DIR;

  return applyHostedWebDistSuffix(baseDistDir, environment);
}

function applyHostedWebDistSuffix(
  baseDistDir: string,
  environment: NodeJS.ProcessEnv,
): string {
  const configuredSuffix = environment[hostedWebDistSuffixEnvVarName]?.trim();

  if (!configuredSuffix) {
    return baseDistDir;
  }

  const normalizedSuffix = configuredSuffix.toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalizedSuffix)) {
    throw new Error(
      `${hostedWebDistSuffixEnvVarName} must use lowercase letters, digits, and hyphens only.`,
    );
  }

  return `${baseDistDir}-${normalizedSuffix}`;
}
