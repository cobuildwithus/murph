import { createHash, randomBytes } from "node:crypto";

export { toIsoTimestamp } from "@murphai/device-syncd/public-ingress";

export function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function parseCommaSeparatedList(value: string | null | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return [...new Set(value.split(/[\n,]/u).map((entry) => entry.trim()).filter(Boolean))];
}
export function maybeDate(value: string | null | undefined): Date | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function maybeIsoTimestamp(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function generateHostedRandomPrefixedId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

// Keep this hosted-local on purpose. Importing the daemon helper would widen
// the `@murphai/device-syncd` public surface just to reuse a trivial primitive.
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Keep this hosted-local on purpose for the same reason as `sha256Hex`.
export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function toJsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(asRecord(value))) as Record<string, unknown>;
}

export function parseInteger(value: string | null | undefined): number | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
