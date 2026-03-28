import type {
  OuraDeviceSyncProviderConfig,
  WhoopDeviceSyncProviderConfig,
} from "@murph/device-syncd";
import {
  readConfiguredOuraDeviceSyncProviderConfig,
  readConfiguredWhoopDeviceSyncProviderConfig,
} from "@murph/device-syncd";

import { decodeHostedEncryptionKey } from "./crypto";
import { normalizeNullableString, parseCommaSeparatedList } from "./shared";

export interface HostedDeviceSyncEnvironment {
  allowedMutationOrigins: string[];
  allowedReturnOrigins: string[];
  encryptionKey: Buffer;
  encryptionKeyVersion: string;
  isProduction: boolean;
  ouraWebhookVerificationToken: string | null;
  publicBaseUrl: string | null;
  trustedUserAssertionHeader: string;
  trustedUserSignatureHeader: string;
  trustedUserSigningSecret: string | null;
  devUserEmail: string | null;
  devUserId: string | null;
  devUserName: string | null;
  providers: {
    whoop: WhoopDeviceSyncProviderConfig | null;
    oura: OuraDeviceSyncProviderConfig | null;
  };
}

const DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS_ENV_KEYS = [
  "DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS",
] as const;
const DEVICE_SYNC_ALLOWED_RETURN_ORIGINS_ENV_KEYS = [
  "DEVICE_SYNC_ALLOWED_RETURN_ORIGINS",
] as const;
const DEVICE_SYNC_DEV_USER_EMAIL_ENV_KEYS = [
  "DEVICE_SYNC_DEV_USER_EMAIL",
] as const;
const DEVICE_SYNC_DEV_USER_ID_ENV_KEYS = [
  "DEVICE_SYNC_DEV_USER_ID",
] as const;
const DEVICE_SYNC_DEV_USER_NAME_ENV_KEYS = [
  "DEVICE_SYNC_DEV_USER_NAME",
] as const;
const DEVICE_SYNC_ENCRYPTION_KEY_ENV_KEYS = [
  "DEVICE_SYNC_ENCRYPTION_KEY",
] as const;
const DEVICE_SYNC_ENCRYPTION_KEY_VERSION_ENV_KEYS = [
  "DEVICE_SYNC_ENCRYPTION_KEY_VERSION",
] as const;
const DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS = [
  "DEVICE_SYNC_PUBLIC_BASE_URL",
] as const;
const DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER_ENV_KEYS = [
  "DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER",
] as const;
const DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER_ENV_KEYS = [
  "DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER",
] as const;
const DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET_ENV_KEYS = [
  "DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET",
] as const;
const OURA_WEBHOOK_VERIFICATION_TOKEN_ENV_KEYS = [
  "OURA_WEBHOOK_VERIFICATION_TOKEN",
] as const;

export function readHostedDeviceSyncEnvironment(source: NodeJS.ProcessEnv = process.env): HostedDeviceSyncEnvironment {
  const encryptionKey = readEnv(source, DEVICE_SYNC_ENCRYPTION_KEY_ENV_KEYS);
  const encryptionKeyVersion = readEnv(source, DEVICE_SYNC_ENCRYPTION_KEY_VERSION_ENV_KEYS) ?? "v1";

  if (!encryptionKey) {
    throw new TypeError("DEVICE_SYNC_ENCRYPTION_KEY is required for the hosted device-sync control plane.");
  }

  return {
    allowedMutationOrigins: parseCommaSeparatedList(readEnv(source, DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS_ENV_KEYS)),
    allowedReturnOrigins: parseCommaSeparatedList(readEnv(source, DEVICE_SYNC_ALLOWED_RETURN_ORIGINS_ENV_KEYS)),
    encryptionKey: decodeHostedEncryptionKey(encryptionKey),
    encryptionKeyVersion,
    isProduction: (source.NODE_ENV ?? "development") === "production",
    ouraWebhookVerificationToken: readEnv(source, OURA_WEBHOOK_VERIFICATION_TOKEN_ENV_KEYS) ?? null,
    publicBaseUrl: readEnv(source, DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS) ?? null,
    trustedUserAssertionHeader:
      normalizeHeaderName(readEnv(source, DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER_ENV_KEYS)) ??
      "x-hosted-user-assertion",
    trustedUserSignatureHeader:
      normalizeHeaderName(readEnv(source, DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER_ENV_KEYS)) ??
      "x-hosted-user-signature",
    trustedUserSigningSecret: readEnv(source, DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET_ENV_KEYS),
    devUserEmail: readEnv(source, DEVICE_SYNC_DEV_USER_EMAIL_ENV_KEYS) ?? null,
    devUserId: readEnv(source, DEVICE_SYNC_DEV_USER_ID_ENV_KEYS) ?? null,
    devUserName: readEnv(source, DEVICE_SYNC_DEV_USER_NAME_ENV_KEYS) ?? null,
    providers: {
      whoop: readConfiguredWhoopDeviceSyncProviderConfig(source),
      oura: readConfiguredOuraDeviceSyncProviderConfig(source),
    },
  };
}

function readEnv(
  source: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = normalizeNullableString(source[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeHeaderName(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}
