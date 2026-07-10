import { createHash, randomBytes } from "node:crypto";

export function toIsoTimestamp(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new TypeError(`Invalid timestamp: ${String(value)}`);
  }

  return date.toISOString();
}

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

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function containsUrlLikeText(value: string): boolean {
  if (/(?:^|[\s([<{])(?:[a-z][a-z\d+.-]*):\/\/[^\s<>)\]}]+/iu.test(value)) {
    return true;
  }
  if (/(?:^|[\s([<{])\/\/[^\s<>)\]}]+/u.test(value)) {
    return true;
  }
  if (/(?:^|[\s([<{])(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?:[/?#][^\s<>)\]}]*)?(?=$|[\s).,!?;:>\]}])/u.test(value)) {
    return true;
  }
  if (/(?:^|[\s([<{])(?=[0-9a-f:]*::)[0-9a-f:]{3,}(?=$|[\s).,!?;:>\]}])/iu.test(value)) {
    return true;
  }
  return /(?:^|[\s([<{])(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+(?:[a-z]{2,63}|xn--[a-z\d-]{2,59})(?::\d{2,5})?(?:[/?#][^\s<>)\]}]*)?(?=$|[\s).,!?;:>\]}])/iu
    .test(value);
}

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

export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }));
}
