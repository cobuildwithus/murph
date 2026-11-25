import { hasClinicalRunChanges } from "@murphai/core";
import type { HostedExecutionSystemWake } from "@murphai/hosted-execution";
import {
  applyClinicalEnrichmentProposals,
  readClinicalEnrichmentStatus,
} from "@murphai/vault-usecases/clinical-enrichment";

import { createNoopMailboxEffect, type HostedMailboxOutcome } from "./mailbox-outcome.ts";

export async function executeHostedClinicalEnrichmentWake(input: {
  wake: Extract<HostedExecutionSystemWake, { kind: "clinical-records.enrichment-requested" }>;
  vaultRoot: string;
  signal?: AbortSignal | null;
  shouldYield?: (() => boolean) | null;
}): Promise<HostedMailboxOutcome> {
  const job = { vaultRoot: input.vaultRoot, jobId: input.wake.jobId };
  let status = await readClinicalEnrichmentStatus(job);
  let applied = false;
  if (status.status === "prepared" && !input.signal?.aborted && input.shouldYield?.() !== true) {
    await applyClinicalEnrichmentProposals(job);
    applied = true;
    status = await readClinicalEnrichmentStatus(job);
  }
  const pending = status.status === "pending" || status.status === "prepared";
  const changeRun = input.wake.changeRun;
  // The canonical shard survives a crash after apply and before checkpoint publication.
  const proved = changeRun && await hasClinicalRunChanges(input.vaultRoot, changeRun.runId);
  return createNoopMailboxEffect({
    ...(proved ? { postCheckpointRecord: { kind: "clinical-records.outcome-recorded",
      ...(pending ? { resumeEnrichmentAt: status.nextAttemptAt ?? new Date(Date.now() + 60_000).toISOString() } : {}),
      request: { kind: "change-receipt", ...changeRun } } } : {}),
    conversationMetrics: null,
    mailboxLane: "clinical-records",
    ...(applied ? { systemProgressed: true as const } : {}),
    ...(pending ? {
      backgroundMaintenanceYielded: true as const,
      nextWakeAt: status.nextAttemptAt ?? new Date(Date.now() + 60_000).toISOString(),
    } : {}),
  });
}
