import { decodeHostedEncryptionKey, decodeHostedEncryptionKeyring } from "./crypto";
import { normalizeNullableString, parseCommaSeparatedList } from "./shared";
import {
  readHostedDeviceSyncPublicBaseUrl,
  readHostedPublicOrigin,
} from "../hosted-web/public-url";

export interface HostedDeviceSyncEnvironment {
  allowedMutationOrigins: string[];
  allowedReturnOrigins: string[];
  encryptionKey: Buffer;
  encryptionKeysByVersion: Readonly<Record<string, Buffer>>;
  encryptionKeyVersion: string;
  isProduction: boolean;
  publicBaseUrl: string | null;
  trustedUserAssertionHeader: string;
  trustedUserSignatureHeader: string;
  trustedUserSigningSecret: string | null;
}

const DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS_ENV_KEYS = [
  "DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS",
] as const;
const DEVICE_SYNC_ALLOWED_RETURN_ORIGINS_ENV_KEYS = [
  "DEVICE_SYNC_ALLOWED_RETURN_ORIGINS",
] as const;
const DEVICE_SYNC_ENCRYPTION_KEY_ENV_KEYS = [
  "DEVICE_SYNC_ENCRYPTION_KEY",
] as const;
const DEVICE_SYNC_ENCRYPTION_KEY_VERSION_ENV_KEYS = [
  "DEVICE_SYNC_ENCRYPTION_KEY_VERSION",
] as const;
const DEVICE_SYNC_ENCRYPTION_KEYRING_JSON_ENV_KEYS = [
  "DEVICE_SYNC_ENCRYPTION_KEYRING_JSON",
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
const REMOVED_DEVICE_SYNC_DEV_AUTH_ENV_KEYS = [
  "DEVICE_SYNC_DEV_USER_ID",
  "DEVICE_SYNC_DEV_USER_EMAIL",
  "DEVICE_SYNC_DEV_USER_NAME",
] as const;

export function readHostedDeviceSyncEnvironment(source: NodeJS.ProcessEnv = process.env): HostedDeviceSyncEnvironment {
  assertRemovedDeviceSyncDevAuthEnvUnset(source);

  const encryptionKeyValue = readEnv(source, DEVICE_SYNC_ENCRYPTION_KEY_ENV_KEYS);
  const encryptionKeyVersion = readEnv(source, DEVICE_SYNC_ENCRYPTION_KEY_VERSION_ENV_KEYS) ?? "v1";
  const encryptionKeyringJson = readEnv(source, DEVICE_SYNC_ENCRYPTION_KEYRING_JSON_ENV_KEYS);
  const hasExplicitAllowedMutationOrigins = hasExplicitEnv(
    source,
    DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS_ENV_KEYS,
  );
  const hasExplicitAllowedReturnOrigins = hasExplicitEnv(
    source,
    DEVICE_SYNC_ALLOWED_RETURN_ORIGINS_ENV_KEYS,
  );
  const allowedMutationOrigins = parseCommaSeparatedList(source.DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS);
  const allowedReturnOrigins = parseCommaSeparatedList(source.DEVICE_SYNC_ALLOWED_RETURN_ORIGINS);

  if (!encryptionKeyValue) {
    throw new TypeError("DEVICE_SYNC_ENCRYPTION_KEY is required for the hosted device-sync control plane.");
  }

  const encryptionKey = decodeHostedEncryptionKey(encryptionKeyValue);
  const hostedPublicOrigin =
    hasExplicitAllowedMutationOrigins && hasExplicitAllowedReturnOrigins
      ? null
      : readHostedPublicOrigin(source);

  return {
    allowedMutationOrigins:
      hasExplicitAllowedMutationOrigins ? allowedMutationOrigins : buildFallbackAllowedOrigins(hostedPublicOrigin),
    allowedReturnOrigins:
      hasExplicitAllowedReturnOrigins ? allowedReturnOrigins : buildFallbackAllowedOrigins(hostedPublicOrigin),
    encryptionKey,
    encryptionKeysByVersion: decodeHostedEncryptionKeyring({
      currentKey: encryptionKey,
      currentKeyVersion: encryptionKeyVersion,
      keyringJson: encryptionKeyringJson,
      label: "DEVICE_SYNC_ENCRYPTION_KEYRING_JSON",
    }),
    encryptionKeyVersion,
    isProduction: (source.NODE_ENV ?? "development") === "production",
    publicBaseUrl: readHostedDeviceSyncPublicBaseUrl(source),
    trustedUserAssertionHeader:
      normalizeHeaderName(readEnv(source, DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER_ENV_KEYS)) ??
      "x-hosted-user-assertion",
    trustedUserSignatureHeader:
      normalizeHeaderName(readEnv(source, DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER_ENV_KEYS)) ??
      "x-hosted-user-signature",
    trustedUserSigningSecret: readEnv(source, DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET_ENV_KEYS),
  };
}

function buildFallbackAllowedOrigins(origin: string | null): string[] {
  return origin ? [origin] : [];
}

function hasExplicitEnv(
  source: NodeJS.ProcessEnv,
  keys: readonly string[],
): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined);
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

function assertRemovedDeviceSyncDevAuthEnvUnset(source: NodeJS.ProcessEnv): void {
  const configuredKeys = REMOVED_DEVICE_SYNC_DEV_AUTH_ENV_KEYS.filter((key) =>
    Boolean(normalizeNullableString(source[key])),
  );

  if (configuredKeys.length === 0) {
    return;
  }

  throw new TypeError(
    `${configuredKeys.join(", ")} are no longer supported. Hosted device-sync browser routes require signed hosted-user assertions.`,
  );
}

function normalizeHeaderName(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}
