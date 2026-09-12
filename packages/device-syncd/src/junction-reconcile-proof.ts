import { createHmac } from "node:crypto";

/** Non-canonical, checkpoint-fenced evidence. No provider records are persisted. */
export interface JunctionReconcileProof {
  windowStart: string;
  validUntil: string;
  binding: string;
  digest: string;
  timeZone: string;
}

export function encodeJunctionReconcileProof(proof: JunctionReconcileProof): string {
  return JSON.stringify([
    proof.windowStart, proof.validUntil, proof.binding, proof.digest, proof.timeZone,
  ]);
}

export function readJunctionReconcileProof(value: unknown): JunctionReconcileProof | null {
  if (typeof value !== "string" || value.length > 256) return null;
  try {
    const parts: unknown = JSON.parse(value);
    if (!Array.isArray(parts) || parts.length !== 5) return null;
    const [windowStart, validUntil, binding, digest, timeZone] = parts;
    if (typeof windowStart !== "string" || typeof validUntil !== "string"
      || typeof binding !== "string" || typeof digest !== "string"
      || typeof timeZone !== "string"
      || !/^[a-f0-9]{64}$/u.test(binding) || !/^[a-f0-9]{64}$/u.test(digest)
      || new Date(windowStart).toISOString() !== windowStart
      || new Date(validUntil).toISOString() !== validUntil
      || windowStart >= validUntil) return null;
    new Intl.DateTimeFormat("en", { timeZone }).format(0);
    return { windowStart, validUntil, binding, digest, timeZone };
  } catch {
    return null;
  }
}

// Canonicalize object key ordering, preserving nested array semantics. Sort only
// the outer provider collection: pagination/row order is not a data change.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashJunctionReconcileValue(secret: string, value: unknown): string {
  return createHmac("sha256", secret).update(stableJson(value)).digest("hex");
}

export function appendJunctionReconcileRecords(
  secret: string, digest: string, resource: string, records: readonly unknown[],
): string {
  return hashJunctionReconcileValue(secret, [digest, resource, records.map(stableJson).sort()]);
}
