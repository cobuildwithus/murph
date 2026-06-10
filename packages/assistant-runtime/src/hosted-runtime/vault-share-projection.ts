import {
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  type HostedVaultShareDeliveryRecord,
} from "@murphai/hosted-execution/vault-share";
import {
  type ProjectedWearableSleepSummary,
  summarizeWearableSleepRuntime,
} from "@murphai/query";

import type { HostedRuntimeVaultSharePort } from "./platform.ts";

export const HOSTED_VAULT_SHARE_PROJECTION_NIGHT_WINDOW = 3;

export const HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS = 7;

export interface HostedVaultShareProjectionOfferResult {
  outcome:
    | "delivered"
    | "error"
    | "no-active-share"
    | "no-port"
    | "no-projectable-records";
}

/**
 * Deterministic, best-effort projection offer: read the latest fully-timed sleep nights
 * from the member's own vault and offer them as delivery records through the vault-share
 * port. The web control plane is the sole authority on whether shares exist; this step
 * holds no share state.
 *
 * Never throws — a projection failure must never affect the runtime's primary work — and
 * sends nothing when the vault has no fully-timed nights, so members without sleep data
 * (or without wearables) make no delivery calls at all.
 */
export async function offerHostedVaultShareProjectionBestEffort(input: {
  readRecords?: (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]>;
  vaultRoot: string;
  vaultSharePort: HostedRuntimeVaultSharePort | null | undefined;
}): Promise<HostedVaultShareProjectionOfferResult> {
  const port = input.vaultSharePort ?? null;

  if (!port) {
    return { outcome: "no-port" };
  }

  const readRecords = input.readRecords ?? readProjectableSleepNights;

  try {
    const records = await readRecords(input.vaultRoot);

    if (records.length === 0) {
      return { outcome: "no-projectable-records" };
    }

    const response = await port.deliver({
      projectionKind: "sleep-times.v0",
      records,
    });

    return {
      outcome: response.status === "delivered" ? "delivered" : "no-active-share",
    };
  } catch {
    return { outcome: "error" };
  }
}

export async function readProjectableSleepNights(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const summaries = await summarizeWearableSleepRuntime(vaultRoot, {
    limit: HOSTED_VAULT_SHARE_PROJECTION_NIGHT_WINDOW + HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  });
  return selectProjectableSleepNights(summaries, Date.now());
}

/**
 * Pure selection step: keep the most recent fully-timed nights, capped at the projection
 * window, and drop nights older than the recency cutoff so members with only stale sleep
 * data never offer undeliverable records. Each night maps to one delivery record whose
 * recordKey is the night date and whose occurredAt is the night's sleepEndAt.
 */
export function selectProjectableSleepNights(
  summaries: readonly Pick<ProjectedWearableSleepSummary, "date" | "sleepEndAt" | "sleepStartAt">[],
  nowMs: number,
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs =
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS * 24 * 60 * 60 * 1000;
  const records: HostedVaultShareDeliveryRecord[] = [];

  for (const summary of summaries) {
    if (typeof summary.sleepStartAt !== "string" || typeof summary.sleepEndAt !== "string") {
      continue;
    }

    const nightMs = Date.parse(`${summary.date}T00:00:00.000Z`);
    if (!Number.isFinite(nightMs) || nightMs < cutoffMs) {
      continue;
    }

    records.push({
      data: {
        date: summary.date,
        sleepEndAt: summary.sleepEndAt,
        sleepStartAt: summary.sleepStartAt,
      },
      occurredAt: summary.sleepEndAt,
      recordKey: summary.date,
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_NIGHT_WINDOW) {
      break;
    }
  }

  return records;
}
