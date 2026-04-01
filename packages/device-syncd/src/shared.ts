import { createHash } from "node:crypto";
import path from "node:path";
import { DEVICE_SYNC_DB_RELATIVE_PATH, encodeRandomCrockford, generateUlid } from "@murph/runtime-state/node";

export const DEFAULT_DEVICE_SYNC_HOST = "127.0.0.1";

export function toIsoTimestamp(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new TypeError(`Invalid timestamp: ${String(value)}`);
  }

  return date.toISOString();
}

export function addMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

export function subtractDays(timestamp: string, days: number): string {
  return new Date(Date.parse(timestamp) - days * 86_400_000).toISOString();
}

export function generatePrefixedId(prefix: string, now = Date.now()): string {
  return `${sanitizeKey(prefix, "rec")}_${generateUlid(now)}`;
}

export function generateStateCode(length = 24): string {
  return encodeRandomCrockford(length);
}

export function sanitizeKey(value: unknown, fallback = "item"): string {
  const candidate = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return candidate || fallback;
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeIdentifier(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return normalizeString(value);
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => typeof entry === "string");
}

const DEVICE_SYNC_METADATA_MAX_ENTRIES = 16;
const DEVICE_SYNC_METADATA_MAX_KEY_LENGTH = 64;
const DEVICE_SYNC_METADATA_MAX_STRING_LENGTH = 256;
const DEVICE_SYNC_METADATA_BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type DeviceSyncMetadataScalar = string | number | boolean | null;

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

    if (!key || key.length > DEVICE_SYNC_METADATA_MAX_KEY_LENGTH || DEVICE_SYNC_METADATA_BLOCKED_KEYS.has(key)) {
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

export function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON`, { cause: error });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${label} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

export function maybeParseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  return parseJsonObject(value, "JSON payload");
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function computeRetryDelayMs(attempts: number): number {
  const sequence = [15_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
  const retryIndex = Math.min(Math.max(attempts - 1, 0), sequence.length - 1);
  return sequence[retryIndex] ?? sequence[sequence.length - 1]!;
}

export function coerceRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function normalizePublicBaseUrl(value: string): string {
  const url = new URL(value);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}

export function normalizeOriginList(values: readonly string[] | null | undefined): string[] {
  if (!values) {
    return [];
  }

  return [...new Set(values.map((value) => normalizeOrigin(value)).filter(Boolean))];
}

const INVALID_URL_VALUE_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;

function isSafeRootRelativeUrlPath(value: string): boolean {
  return value.startsWith("/")
    && !value.startsWith("//")
    && !value.includes("\\")
    && !INVALID_URL_VALUE_CHARACTER_PATTERN.test(value);
}

function hasEmbeddedUrlCredentials(value: URL): boolean {
  return value.username.length > 0 || value.password.length > 0;
}

export function resolveRelativeOrAllowedOriginUrl(
  candidate: string | null | undefined,
  publicBaseUrl: string,
  allowedOrigins: readonly string[] = [],
): string | null {
  const normalized = normalizeString(candidate);

  if (!normalized || INVALID_URL_VALUE_CHARACTER_PATTERN.test(normalized)) {
    return null;
  }

  const base = new URL(normalizePublicBaseUrl(publicBaseUrl));

  if (isSafeRootRelativeUrlPath(normalized)) {
    return new URL(normalized, base).toString();
  }

  try {
    const resolved = new URL(normalized);
    const allowed = new Set([base.origin, ...normalizeOriginList(allowedOrigins)]);

    if (!allowed.has(resolved.origin) || hasEmbeddedUrlCredentials(resolved)) {
      return null;
    }

    resolved.hash = "";
    return resolved.toString();
  } catch {
    return null;
  }
}

export function joinUrl(base: string, relativePath: string): string {
  return new URL(relativePath.replace(/^\/+/, ""), `${normalizePublicBaseUrl(base)}/`).toString();
}

export function defaultStateDatabasePath(vaultRoot: string): string {
  return path.join(path.resolve(vaultRoot), DEVICE_SYNC_DB_RELATIVE_PATH);
}
