import { decodeHostedEncryptionKey } from "./crypto";
import { normalizeString, parseCommaSeparatedList } from "./shared";

export interface HostedOAuthProviderEnvironment {
  clientId: string;
  clientSecret: string;
}

export interface HostedDeviceSyncEnvironment {
  allowedReturnOrigins: string[];
  encryptionKey: Buffer;
  encryptionKeyVersion: string;
  isProduction: boolean;
  ouraWebhookVerificationToken: string | null;
  publicBaseUrl: string | null;
  trustedUserEmailHeader: string | null;
  trustedUserIdHeader: string;
  trustedUserNameHeader: string | null;
  devUserEmail: string | null;
  devUserId: string | null;
  devUserName: string | null;
  providers: {
    whoop: HostedOAuthProviderEnvironment | null;
    oura: HostedOAuthProviderEnvironment | null;
  };
}

const DEVICE_SYNC_ALLOWED_RETURN_ORIGINS_ENV_KEYS = [
  "DEVICE_SYNC_ALLOWED_RETURN_ORIGINS",
  "HEALTHYBOB_DEVICE_SYNC_ALLOWED_RETURN_ORIGINS",
] as const;
const DEVICE_SYNC_DEV_USER_EMAIL_ENV_KEYS = [
  "DEVICE_SYNC_DEV_USER_EMAIL",
  "HEALTHYBOB_DEVICE_SYNC_DEV_USER_EMAIL",
] as const;
const DEVICE_SYNC_DEV_USER_ID_ENV_KEYS = [
  "DEVICE_SYNC_DEV_USER_ID",
  "HEALTHYBOB_DEVICE_SYNC_DEV_USER_ID",
] as const;
const DEVICE_SYNC_DEV_USER_NAME_ENV_KEYS = [
  "DEVICE_SYNC_DEV_USER_NAME",
  "HEALTHYBOB_DEVICE_SYNC_DEV_USER_NAME",
] as const;
const DEVICE_SYNC_ENCRYPTION_KEY_ENV_KEYS = [
  "DEVICE_SYNC_ENCRYPTION_KEY",
  "HEALTHYBOB_DEVICE_SYNC_ENCRYPTION_KEY",
] as const;
const DEVICE_SYNC_ENCRYPTION_KEY_VERSION_ENV_KEYS = [
  "DEVICE_SYNC_ENCRYPTION_KEY_VERSION",
  "HEALTHYBOB_DEVICE_SYNC_ENCRYPTION_KEY_VERSION",
] as const;
const DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS = [
  "DEVICE_SYNC_PUBLIC_BASE_URL",
  "HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL",
] as const;
const DEVICE_SYNC_TRUSTED_USER_EMAIL_HEADER_ENV_KEYS = [
  "DEVICE_SYNC_TRUSTED_USER_EMAIL_HEADER",
  "HEALTHYBOB_DEVICE_SYNC_TRUSTED_USER_EMAIL_HEADER",
] as const;
const DEVICE_SYNC_TRUSTED_USER_ID_HEADER_ENV_KEYS = [
  "DEVICE_SYNC_TRUSTED_USER_ID_HEADER",
  "HEALTHYBOB_DEVICE_SYNC_TRUSTED_USER_ID_HEADER",
] as const;
const DEVICE_SYNC_TRUSTED_USER_NAME_HEADER_ENV_KEYS = [
  "DEVICE_SYNC_TRUSTED_USER_NAME_HEADER",
  "HEALTHYBOB_DEVICE_SYNC_TRUSTED_USER_NAME_HEADER",
] as const;
const OURA_CLIENT_ID_ENV_KEYS = ["OURA_CLIENT_ID", "HEALTHYBOB_OURA_CLIENT_ID"] as const;
const OURA_CLIENT_SECRET_ENV_KEYS = [
  "OURA_CLIENT_SECRET",
  "HEALTHYBOB_OURA_CLIENT_SECRET",
] as const;
const OURA_WEBHOOK_VERIFICATION_TOKEN_ENV_KEYS = [
  "OURA_WEBHOOK_VERIFICATION_TOKEN",
  "HEALTHYBOB_OURA_WEBHOOK_VERIFICATION_TOKEN",
] as const;
const WHOOP_CLIENT_ID_ENV_KEYS = ["WHOOP_CLIENT_ID", "HEALTHYBOB_WHOOP_CLIENT_ID"] as const;
const WHOOP_CLIENT_SECRET_ENV_KEYS = [
  "WHOOP_CLIENT_SECRET",
  "HEALTHYBOB_WHOOP_CLIENT_SECRET",
] as const;

export function readHostedDeviceSyncEnvironment(source: NodeJS.ProcessEnv = process.env): HostedDeviceSyncEnvironment {
  const encryptionKey = readEnv(source, DEVICE_SYNC_ENCRYPTION_KEY_ENV_KEYS);
  const encryptionKeyVersion = readEnv(source, DEVICE_SYNC_ENCRYPTION_KEY_VERSION_ENV_KEYS) ?? "v1";

  if (!encryptionKey) {
    throw new TypeError("DEVICE_SYNC_ENCRYPTION_KEY is required for the hosted device-sync control plane.");
  }

  return {
    allowedReturnOrigins: parseCommaSeparatedList(readEnv(source, DEVICE_SYNC_ALLOWED_RETURN_ORIGINS_ENV_KEYS)),
    encryptionKey: decodeHostedEncryptionKey(encryptionKey),
    encryptionKeyVersion,
    isProduction: (source.NODE_ENV ?? "development") === "production",
    ouraWebhookVerificationToken: readEnv(source, OURA_WEBHOOK_VERIFICATION_TOKEN_ENV_KEYS) ?? null,
    publicBaseUrl: readEnv(source, DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS) ?? null,
    trustedUserEmailHeader: normalizeHeaderName(readEnv(source, DEVICE_SYNC_TRUSTED_USER_EMAIL_HEADER_ENV_KEYS)),
    trustedUserIdHeader:
      normalizeHeaderName(readEnv(source, DEVICE_SYNC_TRUSTED_USER_ID_HEADER_ENV_KEYS)) ?? "x-healthybob-user-id",
    trustedUserNameHeader: normalizeHeaderName(readEnv(source, DEVICE_SYNC_TRUSTED_USER_NAME_HEADER_ENV_KEYS)),
    devUserEmail: readEnv(source, DEVICE_SYNC_DEV_USER_EMAIL_ENV_KEYS) ?? null,
    devUserId: readEnv(source, DEVICE_SYNC_DEV_USER_ID_ENV_KEYS) ?? null,
    devUserName: readEnv(source, DEVICE_SYNC_DEV_USER_NAME_ENV_KEYS) ?? null,
    providers: {
      whoop: buildProviderEnvironment(source, WHOOP_CLIENT_ID_ENV_KEYS, WHOOP_CLIENT_SECRET_ENV_KEYS),
      oura: buildProviderEnvironment(source, OURA_CLIENT_ID_ENV_KEYS, OURA_CLIENT_SECRET_ENV_KEYS),
    },
  };
}

function buildProviderEnvironment(
  source: NodeJS.ProcessEnv,
  clientIdKeys: readonly string[],
  clientSecretKeys: readonly string[],
): HostedOAuthProviderEnvironment | null {
  const normalizedClientId = readEnv(source, clientIdKeys);
  const normalizedClientSecret = readEnv(source, clientSecretKeys);

  if (!normalizedClientId && !normalizedClientSecret) {
    return null;
  }

  if (!normalizedClientId || !normalizedClientSecret) {
    throw new TypeError("Hosted WHOOP/Oura provider configuration must include both client ID and client secret.");
  }

  return {
    clientId: normalizedClientId,
    clientSecret: normalizedClientSecret,
  };
}

function readEnv(
  source: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = normalizeString(source[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeHeaderName(value: string | null | undefined): string | null {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}
