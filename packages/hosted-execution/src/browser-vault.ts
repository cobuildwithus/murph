import type {
  HostedBrowserVaultReplicaCursorRef,
  HostedBrowserVaultReplicaRef,
} from "./contracts.ts";

export type {
  HostedBrowserVaultReplicaCursorRef,
  HostedBrowserVaultReplicaRef,
} from "./contracts.ts";
export {
  getHostedBrowserVaultReplicaStorageKeyId,
} from "./contracts.ts";
export {
  parseHostedBrowserVaultReplicaRef,
} from "./parsers/cursor.ts";

export type BrowserVaultReplicaFreshness = "fresh" | "stale";

export type BrowserVaultReplicaFreshnessReason =
  | "current"
  | "missing"
  | "source_mismatch"
  | "max_age_exceeded"
  | "invalid_generated_at"
  | "invalid_now";

export const BROWSER_VAULT_REPLICA_DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES = 50 * 1024 * 1024;

export interface BrowserVaultRefreshDecision {
  reason: Exclude<BrowserVaultReplicaFreshnessReason, "current">;
  refresh: true;
}

export interface BrowserVaultReplicaFreshnessAssessment {
  freshness: BrowserVaultReplicaFreshness;
  reason: BrowserVaultReplicaFreshnessReason;
  shouldRefresh: boolean;
}

export interface BrowserVaultReplicaFreshnessInput {
  currentSourceHash?: string | null;
  maxAgeMs?: number | null;
  now?: Date | number | string | null;
  replicaRef: HostedBrowserVaultReplicaRef | null;
}

export function assessBrowserVaultReplicaFreshness(
  input: BrowserVaultReplicaFreshnessInput,
): BrowserVaultReplicaFreshnessAssessment {
  const stale = (
    reason: Exclude<BrowserVaultReplicaFreshnessReason, "current">,
  ): BrowserVaultReplicaFreshnessAssessment => ({
    freshness: "stale",
    reason,
    shouldRefresh: true,
  });

  if (!input.replicaRef) {
    return stale("missing");
  }

  const generatedAtMs = parseFreshnessTimestampMs(input.replicaRef.generatedAt);
  if (generatedAtMs === null) {
    return stale("invalid_generated_at");
  }

  const currentSourceHash = normalizeBrowserVaultSourceHash(input.currentSourceHash);
  if (
    currentSourceHash
    && input.replicaRef.sourceBundleHash !== currentSourceHash
  ) {
    return stale("source_mismatch");
  }

  const maxAgeMs = normalizeBrowserVaultMaxAgeMs(input.maxAgeMs);
  if (maxAgeMs !== null) {
    const nowMs = parseFreshnessNowMs(input.now);
    if (nowMs === null) {
      return stale("invalid_now");
    }
    if (nowMs - generatedAtMs > maxAgeMs) {
      return stale("max_age_exceeded");
    }
  }

  return {
    freshness: "fresh",
    reason: "current",
    shouldRefresh: false,
  };
}

export function getBrowserVaultReplicaFreshness(input: {
  currentSourceHash?: string | null;
  maxAgeMs?: number | null;
  now?: Date | number | string | null;
  replicaRef: HostedBrowserVaultReplicaRef | null;
}): BrowserVaultReplicaFreshness {
  return assessBrowserVaultReplicaFreshness(input).freshness;
}

export function shouldScheduleBrowserVaultRefresh(input: {
  currentReplicaRef: HostedBrowserVaultReplicaRef | null;
  currentSourceHash?: string | null;
  maxAgeMs?: number | null;
  now?: Date | number | string | null;
}): BrowserVaultRefreshDecision | null {
  const assessment = assessBrowserVaultReplicaFreshness({
    currentSourceHash: input.currentSourceHash,
    maxAgeMs: input.maxAgeMs,
    now: input.now,
    replicaRef: input.currentReplicaRef,
  });
  return assessment.shouldRefresh
    ? { reason: assessment.reason as Exclude<BrowserVaultReplicaFreshnessReason, "current">, refresh: true }
    : null;
}

function normalizeBrowserVaultSourceHash(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBrowserVaultMaxAgeMs(value: number | null | undefined): number | null {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return BROWSER_VAULT_REPLICA_DEFAULT_MAX_AGE_MS;
  }
  if (!Number.isFinite(value) || value < 0) {
    return BROWSER_VAULT_REPLICA_DEFAULT_MAX_AGE_MS;
  }
  return Math.trunc(value);
}

function parseFreshnessNowMs(value: Date | number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return Date.now();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return parseFreshnessTimestampMs(value);
}

function parseFreshnessTimestampMs(value: string): number | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return timestamp;
}
