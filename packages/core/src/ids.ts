import { createHash } from "node:crypto";

import { generateUlid } from "@murphai/runtime-state";

import { ID_PREFIXES } from "./constants.ts";

const CROCKFORD_BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(bytes: Uint8Array, length: number): string {
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;

    while (bits >= 5 && output.length < length) {
      bits -= 5;
      output += CROCKFORD_BASE32_ALPHABET[(buffer >> bits) & 31];
    }
  }

  if (bits > 0 && output.length < length) {
    output += CROCKFORD_BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  }

  return output.padEnd(length, "0").slice(0, length);
}

export function deterministicContractId(prefix: string, seed: string): string {
  const hash = createHash("sha256").update(seed).digest();
  return `${prefix}_${encodeBase32(hash, 26)}`;
}

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
