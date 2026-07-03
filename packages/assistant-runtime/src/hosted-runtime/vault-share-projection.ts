import {
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH,
  HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionKind,
} from "@murphai/hosted-execution/vault-share";
import {
  type ProjectedWearableSleepSummary,
  readProfileDocumentRuntime,
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
 * Deterministic, best-effort projection offer: read each projectable kind from the
 * member's own vault and offer it as delivery records through the vault-share port. The
 * web control plane is the sole authority on whether shares exist; this step holds no
 * share state.
 *
 * Never throws — a projection failure must never affect the runtime's primary work — and
 * sends nothing for a kind the vault cannot project (no fully-timed nights, no typed
 * profile name), so members without that data make no delivery call for it at all.
 */
export async function offerHostedVaultShareProjectionBestEffort(input: {
  readProfileNameRecords?: (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]>;
  readRecords?: (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]>;
  vaultRoot: string;
  vaultSharePort: HostedRuntimeVaultSharePort | null | undefined;
}): Promise<HostedVaultShareProjectionOfferResult> {
  const port = input.vaultSharePort ?? null;

  if (!port) {
    return { outcome: "no-port" };
  }

  const outcomes = [
    await offerHostedVaultShareKindBestEffort({
      port,
      projectionKind: "sleep-times.v0",
      readRecords: input.readRecords ?? readProjectableSleepNights,
      vaultRoot: input.vaultRoot,
    }),
    await offerHostedVaultShareKindBestEffort({
      port,
      projectionKind: "profile-name.v0",
      readRecords: input.readProfileNameRecords ?? readProjectableProfileName,
      vaultRoot: input.vaultRoot,
    }),
  ];

  return { outcome: combineHostedVaultShareOfferOutcomes(outcomes) };
}

type HostedVaultShareOfferOutcome = HostedVaultShareProjectionOfferResult["outcome"];

async function offerHostedVaultShareKindBestEffort(input: {
  port: HostedRuntimeVaultSharePort;
  projectionKind: HostedVaultShareProjectionKind;
  readRecords: (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]>;
  vaultRoot: string;
}): Promise<HostedVaultShareOfferOutcome> {
  try {
    const records = await input.readRecords(input.vaultRoot);

    if (records.length === 0) {
      return "no-projectable-records";
    }

    const response = await input.port.deliver({
      projectionKind: input.projectionKind,
      records,
    });

    return response.status === "delivered" ? "delivered" : "no-active-share";
  } catch {
    return "error";
  }
}

/**
 * Kind outcomes collapse to one summary for the existing single-outcome logging seam:
 * any error is worth the warn log, otherwise any delivery counts as delivered.
 */
function combineHostedVaultShareOfferOutcomes(
  outcomes: readonly HostedVaultShareOfferOutcome[],
): HostedVaultShareOfferOutcome {
  for (const outcome of ["error", "delivered", "no-active-share"] as const) {
    if (outcomes.includes(outcome)) {
      return outcome;
    }
  }
  return "no-projectable-records";
}

/**
 * The profile display name projects only from the typed canonical profile document —
 * never parsed out of freeform memory text. occurredAt reuses the document's own
 * updatedAt so retries stay byte-identical and the only plaintext mailbox metadata is
 * when the name was set.
 */
export async function readProjectableProfileName(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const snapshot = await readProfileDocumentRuntime(vaultRoot);
  const displayName = snapshot.frontmatter.displayName;

  if (
    !displayName
    || displayName.length > HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH
    || !Number.isFinite(Date.parse(snapshot.frontmatter.updatedAt))
  ) {
    return [];
  }

  return [
    {
      data: { displayName },
      occurredAt: new Date(Date.parse(snapshot.frontmatter.updatedAt)).toISOString(),
      recordKey: HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
    },
  ];
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
 * recordKey is the night date and whose occurredAt is the night date at UTC midnight —
 * occurredAt becomes plaintext mailbox metadata on the destination side, so it must
 * disclose nothing beyond the night date the dedupe key already carries; the exact
 * sleep timestamps stay inside the encrypted payload.
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
      occurredAt: `${summary.date}T00:00:00.000Z`,
      recordKey: summary.date,
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_NIGHT_WINDOW) {
      break;
    }
  }

  return records;
}
