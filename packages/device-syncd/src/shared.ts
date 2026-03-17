import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

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

function encodeCrockford(value: number, length: number): string {
  let remainder = value;
  let encoded = "";

  do {
    encoded = CROCKFORD[remainder % 32] + encoded;
    remainder = Math.floor(remainder / 32);
  } while (remainder > 0);

  return encoded.padStart(length, "0").slice(-length);
}

function encodeRandomPart(length: number): string {
  const bytes = randomBytes(length);
  let encoded = "";

  for (const byte of bytes) {
    encoded += CROCKFORD[byte % 32];

    if (encoded.length >= length) {
      break;
    }
  }

  return encoded.slice(0, length);
}

export function generateUlid(now = Date.now()): string {
  return `${encodeCrockford(now, 10)}${encodeRandomPart(16)}`;
}

export function generatePrefixedId(prefix: string, now = Date.now()): string {
  return `${sanitizeKey(prefix, "rec")}_${generateUlid(now)}`;
}

export function generateStateCode(length = 24): string {
  return encodeRandomPart(length);
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
  return sequence[Math.min(Math.max(attempts, 0), sequence.length - 1)] ?? sequence[sequence.length - 1]!;
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

export function resolveRelativeOrSameOriginUrl(candidate: string | null | undefined, publicBaseUrl: string): string | null {
  const normalized = normalizeString(candidate);

  if (!normalized) {
    return null;
  }

  const base = new URL(normalizePublicBaseUrl(publicBaseUrl));

  if (normalized.startsWith("/")) {
    return new URL(normalized, base).toString();
  }

  try {
    const resolved = new URL(normalized);

    if (resolved.origin !== base.origin) {
      return null;
    }

    return resolved.toString();
  } catch {
    return null;
  }
}

export function joinUrl(base: string, relativePath: string): string {
  return new URL(relativePath.replace(/^\/+/, ""), `${normalizePublicBaseUrl(base)}/`).toString();
}

export function defaultStateDatabasePath(vaultRoot: string): string {
  return path.join(path.resolve(vaultRoot), ".runtime", "device-syncd.sqlite");
}
