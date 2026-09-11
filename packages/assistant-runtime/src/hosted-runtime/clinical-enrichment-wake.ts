import type { HostedExecutionClinicalEnrichmentRequestedWake } from "@murphai/hosted-execution/contracts";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";

import {
  updateHostedSystemMailboxState,
  type HostedSystemMailboxPendingItem,
} from "./system-mailbox-state.ts";

function enrichmentItemId(jobId: string): string {
  if (!/^[a-f0-9]{64}$/u.test(jobId)) {
    throw new TypeError("Hosted clinical enrichment job identity is invalid.");
  }
  return `clinical-enrichment:${jobId}`;
}

/** Call after durable job admission, before releasing its retrieval checkpoint. */
export async function admitHostedClinicalEnrichmentWake(input: {
  vaultRoot: string;
  userId: string;
  jobId: string;
  occurredAt: string;
}): Promise<{ admitted: boolean; nextWakeAt: string }> {
  const itemId = enrichmentItemId(input.jobId);
  const wake: HostedExecutionClinicalEnrichmentRequestedWake = {
    eventId: itemId,
    jobId: input.jobId,
    kind: "clinical-records.enrichment-requested",
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
  parseHostedExecutionWake(wake);
  return updateHostedSystemMailboxState<{ admitted: boolean; nextWakeAt: string }>(input.vaultRoot, (state) => {
    const existing = state.pending.find((item) => item.itemId === itemId);
    if (existing) {
      if (existing.wake.kind !== wake.kind || existing.wake.jobId !== wake.jobId
        || existing.wake.userId !== wake.userId || existing.routeAction !== "apply-clinical-enrichment") {
        throw new TypeError("Hosted clinical enrichment wake identity conflicts.");
      }
      return {
        result: { admitted: false, nextWakeAt: existing.nextAttemptAt ?? existing.occurredAt },
        write: false,
      };
    }
    const item: HostedSystemMailboxPendingItem = {
      attemptCount: 0,
      itemId,
      lastAttemptAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      mailboxDedupeKey: itemId,
      mailboxLaneSeq: null,
      nextAttemptAt: null,
      occurredAt: input.occurredAt,
      postCheckpointRecord: null,
      requestId: null,
      routeAction: "apply-clinical-enrichment",
      status: "pending",
      wake,
    };
    return {
      result: { admitted: true, nextWakeAt: input.occurredAt },
      state: { pending: [...state.pending, item] },
    };
  });
}

/** Ready proposals advance only the existing pending wake, never an active claim. */
export async function makeHostedClinicalEnrichmentWakeDue(input: {
  vaultRoot: string;
  jobId: string;
  now?: Date;
}): Promise<boolean> {
  const now = (input.now ?? new Date()).toISOString();
  return updateClinicalEnrichmentWakeTime({ ...input, nextAttemptAt: now, onlyEarlier: true });
}

export async function setHostedClinicalEnrichmentWakeNextAttempt(input: {
  vaultRoot: string;
  jobId: string;
  nextAttemptAt: string;
}): Promise<boolean> {
  const nextAttemptAt = new Date(input.nextAttemptAt).toISOString();
  return updateClinicalEnrichmentWakeTime({ ...input, nextAttemptAt, onlyEarlier: false });
}

async function updateClinicalEnrichmentWakeTime(input: {
  vaultRoot: string;
  jobId: string;
  nextAttemptAt: string;
  onlyEarlier: boolean;
}): Promise<boolean> {
  const itemId = enrichmentItemId(input.jobId);
  return updateHostedSystemMailboxState<boolean>(input.vaultRoot, (state) => {
    const index = state.pending.findIndex((item) => item.itemId === itemId
      && item.routeAction === "apply-clinical-enrichment"
      && item.wake.kind === "clinical-records.enrichment-requested"
      && item.wake.jobId === input.jobId);
    const item = state.pending[index];
    if (!item || item.status !== "pending"
      || (input.onlyEarlier && Date.parse(item.nextAttemptAt ?? item.occurredAt) <= Date.parse(input.nextAttemptAt))
      || item.nextAttemptAt === input.nextAttemptAt) {
      return { result: false, write: false };
    }
    const pending = [...state.pending];
    pending[index] = { ...item, nextAttemptAt: input.nextAttemptAt, lastErrorCode: null, lastErrorMessage: null };
    return { result: true, state: { pending } };
  });
}
