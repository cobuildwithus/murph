import { createHash } from "node:crypto";

/**
 * Pure subject/lock key derivation for the dedicated runtime-log database.
 * Kept free of database and Prisma imports so the shared test harness can
 * reuse the canonical derivation without pulling the runtime storage graph
 * into non-web typecheck contexts.
 */
export function hostedRuntimeLogSubjectKey(userId: string): string {
  return createHash("sha256")
    .update(`murph:hosted-runtime-log-subject:${requireBoundedOpaqueString(userId, "Hosted runtime log userId")}`)
    .digest("hex");
}

export function hostedRuntimeLogLockKey(subjectKey: string): string {
  const boundedSubjectKey = requireBoundedOpaqueString(
    subjectKey,
    "Hosted runtime log subject key",
  );
  if (!/^[0-9a-f]{64}$/u.test(boundedSubjectKey)) {
    throw new TypeError("Hosted runtime log subject key must be a SHA-256 hex digest.");
  }
  return BigInt.asIntN(64, BigInt(`0x${boundedSubjectKey.slice(0, 16)}`))
    .toString();
}

function requireBoundedOpaqueString(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 1_024) {
    throw new TypeError(`${label} must be a non-empty bounded string.`);
  }
  return normalized;
}
