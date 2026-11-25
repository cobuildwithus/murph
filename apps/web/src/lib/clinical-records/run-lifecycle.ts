import type { Prisma } from "@prisma/client";
import { CLINICAL_RECORD_RUN_STATUSES } from "./client-contracts";

export const CLINICAL_DAILY_SYNC_MS = 24 * 60 * 60_000;
// Two maximum mailbox execution backoffs for a checkpoint to publish its receipt.
export const CLINICAL_RECEIPT_GRACE_MS = 30 * 60_000;

export const lifecycleRunSelect = {
  id: true, generation: true, status: true, createdAt: true, completedAt: true, outcomeCountsJson: true,
  requests: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
} as const;

export interface LifecycleRun {
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  requests: readonly { updatedAt: Date }[];
  outcomeCountsJson: unknown;
}

export function lastRunActivity(run: LifecycleRun) {
  return run.requests[0]?.updatedAt ?? run.createdAt;
}

export function classifyClinicalRun(run: LifecycleRun | undefined, now: Date) {
  if (!run) return "available";
  if (!CLINICAL_RECORD_RUN_STATUSES.some(status => status === run.status)) return "unknown";
  if (run.completedAt) {
    if (run.status === "needs_reauth" && run.outcomeCountsJson === null
      && now.getTime() - run.completedAt.getTime() < CLINICAL_RECEIPT_GRACE_MS) return "awaiting_counts";
    return "available";
  }
  // A due daily successor can replace a quiet run. Age alone never writes a terminal result.
  return now.getTime() - lastRunActivity(run).getTime() >= CLINICAL_DAILY_SYNC_MS ? "recoverable" : "busy";
}

/** Caller holds the member lock. Close only the still-current generation in this transaction. */
export async function closeClinicalRunTx(tx: Prisma.TransactionClient,
  input: { memberId: string; runId: string; generation: number },
  status: "canceled" | "failed" | "needs_reauth", lastErrorCode: string, now: Date, tokenVersion?: number) {
  const result = await tx.clinicalRecordRetrievalRun.updateMany({
    where: { memberId: input.memberId, id: input.runId, generation: input.generation,
      connection: { retrievalGeneration: input.generation, tokenVersion }, completedAt: null },
    data: { status, lastErrorCode, completedAt: now },
  });
  return result.count === 1;
}
