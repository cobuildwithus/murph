const DEVICE_SYNC_METADATA_MAX_ENTRIES = 16;
const DEVICE_SYNC_METADATA_MAX_KEY_LENGTH = 64;
export const DEVICE_SYNC_METADATA_MAX_STRING_LENGTH = 256;
const DEVICE_SYNC_METADATA_BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const DEVICE_SYNC_METADATA_RAW_IDENTIFIER_EXACT_KEYS = new Set([
  "account",
  "client",
  "external",
  "externalaccount",
  "member",
  "owner",
  "profile",
  "provideraccount",
  "subject",
  "user",
]);
const DEVICE_SYNC_METADATA_RAW_IDENTIFIER_ALIASES = [
  "account",
  "app",
  "athlete",
  "client",
  "clientuser",
  "device",
  "external",
  "externalaccount",
  "member",
  "owner",
  "profile",
  "provideraccount",
  "providerconnection",
  "source",
  "sourceinstance",
  "subject",
  "user",
];
const DEVICE_SYNC_METADATA_RAW_IDENTIFIER_EMBEDDED_ALIASES = DEVICE_SYNC_METADATA_RAW_IDENTIFIER_ALIASES.filter(
  (alias) => alias !== "app",
);
const DEVICE_SYNC_METADATA_SECRET_KEY_SUBSTRINGS = [
  "accesstoken",
  "auth",
  "authorization",
  "bearer",
  "cookie",
  "credential",
  "hmac",
  "apikey",
  "clientsecret",
  "password",
  "refreshtoken",
  "secret",
  "setcookie",
  "session",
  "sessionkey",
  "sessiontoken",
  "sessionid",
  "token",
  "webhook",
];
const DEVICE_SYNC_METADATA_RAW_IDENTIFIER_KEY_SUBSTRINGS = [
  "macaddress",
  "serial",
];

type DeviceSyncMetadataScalar = string | number | boolean | null;

/** In-process metadata-patch instruction; never a storable metadata value. */
export const DEVICE_SYNC_METADATA_DELETE = Symbol("device-sync-metadata-delete");

function normalizeStoredDeviceSyncMetadataKey(rawKey: string): string | null {
  const key = rawKey.trim();
  return !key
      || key.length > DEVICE_SYNC_METADATA_MAX_KEY_LENGTH
      || isBlockedStoredDeviceSyncMetadataKey(key)
    ? null
    : key;
}

function isAllowedHashedDeviceSyncIdentifierMetadataKey(normalizedKey: string): boolean {
  return normalizedKey.startsWith("hashed")
    || normalizedKey.endsWith("hash")
    || normalizedKey.endsWith("blindindex");
}

function isRawDeviceSyncIdentifierMetadataKey(normalizedKey: string): boolean {
  return DEVICE_SYNC_METADATA_RAW_IDENTIFIER_EXACT_KEYS.has(normalizedKey)
    || DEVICE_SYNC_METADATA_RAW_IDENTIFIER_KEY_SUBSTRINGS.some((token) => normalizedKey.includes(token))
    || DEVICE_SYNC_METADATA_RAW_IDENTIFIER_ALIASES.some((alias) =>
      normalizedKey.endsWith(`${alias}id`) || normalizedKey.endsWith(`${alias}identifier`)
    )
    || DEVICE_SYNC_METADATA_RAW_IDENTIFIER_EMBEDDED_ALIASES.some((alias) =>
      (normalizedKey.endsWith("id") && normalizedKey.slice(0, -"id".length).includes(alias))
      || (normalizedKey.endsWith("identifier")
        && normalizedKey.slice(0, -"identifier".length).includes(alias))
    );
}

export function isBlockedStoredDeviceSyncMetadataKey(value: string): boolean {
  if (DEVICE_SYNC_METADATA_BLOCKED_KEYS.has(value)) {
    return true;
  }

  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized === "id") {
    return true;
  }
  if (DEVICE_SYNC_METADATA_SECRET_KEY_SUBSTRINGS.some((token) => normalized.includes(token))) {
    return true;
  }
  if (isAllowedHashedDeviceSyncIdentifierMetadataKey(normalized)) {
    return false;
  }

  return isRawDeviceSyncIdentifierMetadataKey(normalized);
}

function sanitizeStoredDeviceSyncMetadataValue(value: unknown): DeviceSyncMetadataScalar | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.length <= DEVICE_SYNC_METADATA_MAX_STRING_LENGTH ? value : undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

export function sanitizeStoredDeviceSyncMetadata(
  value: Record<string, unknown> | null | undefined,
): Record<string, DeviceSyncMetadataScalar> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const sanitized: Record<string, DeviceSyncMetadataScalar> = {};

  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (Object.keys(sanitized).length >= DEVICE_SYNC_METADATA_MAX_ENTRIES) {
      break;
    }

    const key = normalizeStoredDeviceSyncMetadataKey(rawKey);
    if (!key) {
      continue;
    }

    const normalizedValue = sanitizeStoredDeviceSyncMetadataValue(rawValue);

    if (normalizedValue === undefined) {
      continue;
    }

    sanitized[key] = normalizedValue;
  }

  return sanitized;
}

export function mergeStoredDeviceSyncMetadataPatch(
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown> | null | undefined,
): Record<string, DeviceSyncMetadataScalar> {
  if (!patch) {
    return sanitizeStoredDeviceSyncMetadata(existing);
  }

  const sanitizedPatch = sanitizeStoredDeviceSyncMetadata(patch);
  const sanitizedExisting = sanitizeStoredDeviceSyncMetadata(existing);
  const deletedKeys = new Set(
    Object.entries(patch).flatMap(([rawKey, value]) => {
      const key = value === DEVICE_SYNC_METADATA_DELETE
        ? normalizeStoredDeviceSyncMetadataKey(rawKey)
        : null;
      return key ? [key] : [];
    }),
  );
  const merged: Record<string, DeviceSyncMetadataScalar> = {};

  for (const [key, value] of Object.entries(sanitizedPatch)) {
    merged[key] = value;
  }

  for (const [key, value] of Object.entries(sanitizedExisting)) {
    if (Object.keys(merged).length >= DEVICE_SYNC_METADATA_MAX_ENTRIES) {
      break;
    }
    if (!deletedKeys.has(key) && !Object.prototype.hasOwnProperty.call(merged, key)) {
      merged[key] = value;
    }
  }

  return merged;
}
