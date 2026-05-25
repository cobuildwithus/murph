const DEVICE_SYNC_METADATA_MAX_ENTRIES = 16;
const DEVICE_SYNC_METADATA_MAX_KEY_LENGTH = 64;
const DEVICE_SYNC_METADATA_MAX_STRING_LENGTH = 256;
const DEVICE_SYNC_METADATA_BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const DEVICE_SYNC_METADATA_BLOCKED_KEY_SUBSTRINGS = [
  "accesstoken",
  "refreshtoken",
  "authorization",
  "bearer",
  "cookie",
  "setcookie",
  "apikey",
  "clientsecret",
  "password",
  "sessiontoken",
  "sessionid",
];

type DeviceSyncMetadataScalar = string | number | boolean | null;

function isBlockedDeviceSyncMetadataKey(value: string): boolean {
  if (DEVICE_SYNC_METADATA_BLOCKED_KEYS.has(value)) {
    return true;
  }

  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return DEVICE_SYNC_METADATA_BLOCKED_KEY_SUBSTRINGS.some((token) => normalized.includes(token));
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

    const key = rawKey.trim();

    if (!key || key.length > DEVICE_SYNC_METADATA_MAX_KEY_LENGTH || isBlockedDeviceSyncMetadataKey(key)) {
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
  const merged: Record<string, DeviceSyncMetadataScalar> = {};

  for (const [key, value] of Object.entries(sanitizedPatch)) {
    merged[key] = value;
  }

  for (const [key, value] of Object.entries(sanitizedExisting)) {
    if (Object.keys(merged).length >= DEVICE_SYNC_METADATA_MAX_ENTRIES) {
      break;
    }
    if (!Object.prototype.hasOwnProperty.call(merged, key)) {
      merged[key] = value;
    }
  }

  return merged;
}
