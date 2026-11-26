import { hasClinicalRunChanges } from "@murphai/core";
import type { HostedExecutionSystemWake } from "@murphai/hosted-execution";
import {
  applyClinicalEnrichmentProposals,
  readClinicalEnrichmentStatus,
  readNextClinicalEnrichment,
} from "@murphai/vault-usecases/clinical-enrichment";

import { createNoopMailboxEffect, type HostedMailboxOutcome } from "./mailbox-outcome.ts";

/** Cursor steps one wake may take before it yields to the mailbox. */
const MAX_CURSOR_STEPS = 256;

/**
 * The job's only cursor owner. It settles holds and completion, promotes cached
 * extraction, and applies one unit at a time, checking cancellation and
 * cooperative yield between steps. `extract` means it waits for the cache.
 */
export async function executeHostedClinicalEnrichmentWake(input: {
  wake: Extract<HostedExecutionSystemWake, { kind: "clinical-records.enrichment-requested" }>;
  vaultRoot: string;
  signal?: AbortSignal | null;
  shouldYield?: (() => boolean) | null;
}): Promise<HostedMailboxOutcome> {
  const job = { vaultRoot: input.vaultRoot, jobId: input.wake.jobId };
  let applied = false;
  // Only a cursor waiting for the cache or a retry may sleep; an interrupted drain stays due.
  let waiting = false;
  for (let step = 0; step < MAX_CURSOR_STEPS && !input.signal?.aborted && input.shouldYield?.() !== true; step++) {
    const next = await readNextClinicalEnrichment(job);
    if (next?.status === "apply") {
      await applyClinicalEnrichmentProposals(job);
      applied = true;
    } else if (next?.status !== "advance") {
      waiting = true;
      break;
    }
  }
  const retryAt = new Date(Date.now() + (waiting ? 60_000 : 0)).toISOString();
  const status = await readClinicalEnrichmentStatus(job);
  const pending = status.status === "pending" || status.status === "prepared";
  const changeRun = input.wake.changeRun;
  // The canonical shard survives a crash after apply and before checkpoint publication.
  const proved = changeRun && await hasClinicalRunChanges(input.vaultRoot, changeRun.runId);
  return createNoopMailboxEffect({
    ...(proved ? { postCheckpointRecord: { kind: "clinical-records.outcome-recorded",
      ...(pending ? { resumeEnrichmentAt: status.nextAttemptAt ?? retryAt } : {}),
      request: { kind: "change-receipt", ...changeRun } } } : {}),
    conversationMetrics: null,
    mailboxLane: "clinical-records",
    ...(applied ? { systemProgressed: true as const } : {}),
    ...(pending ? {
      backgroundMaintenanceYielded: true as const,
      nextWakeAt: status.nextAttemptAt ?? retryAt,
    } : {}),
  });
}
