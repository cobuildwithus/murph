import { decodeHostedDeviceRoutingIndexKey } from "./routing-index";
import { normalizeNullableString, parseCommaSeparatedList } from "./shared";
import {
  readHostedDeviceSyncPublicBaseUrl,
  readHostedPublicOrigin,
} from "../hosted-web/public-url";

export interface HostedDeviceSyncEnvironment {
  allowedMutationOrigins: string[];
  allowedReturnOrigins: string[];
  isProduction: boolean;
  publicBaseUrl: string | null;
  routingIndexKey: Buffer;
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
const HOSTED_DEVICE_ROUTING_INDEX_KEY_ENV_KEYS = [
  "HOSTED_DEVICE_ROUTING_INDEX_KEY",
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

export function readHostedDeviceSyncEnvironment(source: NodeJS.ProcessEnv = process.env): HostedDeviceSyncEnvironment {
  const routingIndexKeyValue = readEnv(source, HOSTED_DEVICE_ROUTING_INDEX_KEY_ENV_KEYS);
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

  if (!routingIndexKeyValue) {
    throw new TypeError("HOSTED_DEVICE_ROUTING_INDEX_KEY is required for hosted device-sync routing indexes.");
  }

  const routingIndexKey = decodeHostedDeviceRoutingIndexKey(routingIndexKeyValue);
  const hostedPublicOrigin =
    hasExplicitAllowedMutationOrigins && hasExplicitAllowedReturnOrigins
      ? null
      : readHostedPublicOrigin(source);

  return {
    allowedMutationOrigins:
      hasExplicitAllowedMutationOrigins ? allowedMutationOrigins : buildFallbackAllowedOrigins(hostedPublicOrigin),
    allowedReturnOrigins:
      hasExplicitAllowedReturnOrigins ? allowedReturnOrigins : buildFallbackAllowedOrigins(hostedPublicOrigin),
    isProduction: (source.NODE_ENV ?? "development") === "production",
    publicBaseUrl: readHostedDeviceSyncPublicBaseUrl(source),
    routingIndexKey,
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

function normalizeHeaderName(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}
