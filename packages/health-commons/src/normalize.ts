import { createHash } from "node:crypto";

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function stablePrettyJson(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

export function sha256StableJson(value: unknown): string {
  return sha256String(stableJson(value));
}

export function sha256String(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function sha256Buffer(value: Buffer | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) {
      sorted[key] = sortJsonValue(child);
    }
  }
  return sorted;
}
