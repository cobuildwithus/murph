import { generateUlid } from "@healthybob/runtime-state";

import { ID_PREFIXES } from "./constants.js";

function normalizePrefix(prefix: unknown, fallback = "rec"): string {
  if (typeof prefix === "string" && prefix in ID_PREFIXES) {
    return ID_PREFIXES[prefix as keyof typeof ID_PREFIXES];
  }

  const candidate = String(prefix ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return candidate || fallback;
}

export function generateRecordId(prefix: unknown = "record", now = Date.now()): string {
  return `${normalizePrefix(prefix)}_${generateUlid(now)}`;
}

export function generateVaultId(now = Date.now()): string {
  return generateRecordId("vault", now);
}
