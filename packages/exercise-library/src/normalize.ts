import { createHash } from "node:crypto";

export function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/gu, "-");
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");

  if (!slug) {
    throw new Error(`Cannot create slug from "${value}".`);
  }

  return slug;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function stablePrettyJson(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

export function sha256StableJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      output[key] = sortJsonValue(input[key]);
    }
    return output;
  }

  return value;
}
