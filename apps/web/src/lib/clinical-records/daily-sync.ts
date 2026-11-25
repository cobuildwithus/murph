import "server-only";
import { clinicalProcessorAdmissionError } from "./processor-registry";

import { randomBytes } from "node:crypto";
import { clinicalFhirRetrievalPlanSchema } from "@murphai/clinical-records";
import { getHostedCryptoDomainForLane } from "@murphai/runtime-state";

import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { unwrapHostedDomainRootForWeb } from "../hosted-crypto/domain-root-store";
import { classifyClinicalRun, closeClinicalRunTx, lifecycleRunSelect, CLINICAL_DAILY_SYNC_MS } from "./run-lifecycle";
import { readClinicalTransportAccess } from "./transport-access";
import { lockHostedMemberRow, readHostedMemberSuspensionAfterLockTx } from "../hosted-onboarding/shared";
import { abortAtHostedRecoveryDeadline, HOSTED_RECOVERY_BUDGET_MS, HOSTED_RECOVERY_LOCK_TIMEOUT_MS, HOSTED_RECOVERY_TRANSACTION_OPTIONS } from "../hosted-orchestration/recovery-batch";
import { readHostedConsentStatus } from "../legal/consent";
import { getPrisma } from "../prisma";
import { CLEAR_CLINICAL_PERSISTENT_ACCESS } from "./persistent-access";
import { buildEpicDailyRetrievalPlan } from "./epic-policy";
import { appendClinicalRetrievalWakeTx, signalClinicalRetrievalWake } from "./retrieval";

// Just under the 15-minute sweep, so the next sweep sees the row.
export const CLINICAL_DAILY_ADMISSION_RETRY_MS = 14 * 60_000;

/** Existing recovery scheduler; one bounded selection and sequential admission, no provider egress. */
export async function runClinicalDailySyncSweep(input: { now?: Date; deadlineMs?: number } = {}) {
  const now = input.now ?? new Date();
  const stop = abortAtHostedRecoveryDeadline(input.deadlineMs ?? Date.now() + HOSTED_RECOVERY_BUDGET_MS);
  const candidates = await getPrisma().clinicalRecordConnection.findMany({
    where: { member: { suspendedAt: null }, status: { in: ["active", "error"] }, nextSyncAt: { lte: now },
      refreshTokenEncrypted: { not: null } },
    orderBy: [{ nextSyncAt: "asc" }, { id: "asc" }], take: 20,
    select: { id: true, memberId: true },
  });
  let checked = 0;
  let queued = 0;
  let failed = 0;
  for (const candidate of candidates) {
    if (stop.aborted) break; // Unstarted rows stay due.
    checked++;
    let retryMs = CLINICAL_DAILY_SYNC_MS;
    try {
      if (await admitClinicalDailySync({ abortSignal: stop, connectionId: candidate.id, memberId: candidate.memberId, now })) {
        queued++;
        continue; // Admission committed its own date.
      }
    } catch {
      if (!stop.aborted) failed++;
      retryMs = CLINICAL_DAILY_ADMISSION_RETRY_MS;
    }
    // Ineligible or failing rows must not monopolize the bounded candidate window.
    // The still-due guard lets a concurrent admission keep its date.
    await getPrisma().clinicalRecordConnection.updateMany({
      where: { id: candidate.id, nextSyncAt: { lte: now } },
      data: { nextSyncAt: new Date(now.getTime() + retryMs) },
    });
  }
  return { checked, queued, failed };
}

export async function admitClinicalDailySync(input: { abortSignal?: AbortSignal; connectionId: string; memberId: string; now: Date }): Promise<boolean> {
  if (!await readClinicalTransportAccess({ memberId: input.memberId })) return false;
  return runWithHostedDomainRootUnwrapCache(async () => {
    const prisma = getPrisma();
    const root = await unwrapHostedDomainRootForWeb({ domain: getHostedCryptoDomainForLane("mailbox-payload"),
      prisma, retainFailureInScopedCache: true, signal: input.abortSignal, userId: input.memberId });
    root.rootKey.fill(0);
    input.abortSignal?.throwIfAborted();
    const wake = await prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, input.memberId, { timeoutMs: HOSTED_RECOVERY_LOCK_TIMEOUT_MS });
      if (await readHostedMemberSuspensionAfterLockTx(tx, input.memberId) !== "active"
        || !await readClinicalTransportAccess({ memberId: input.memberId, prisma: tx })) return null;
      if (!(await readHostedConsentStatus({ memberId: input.memberId, prisma: tx })).launchGranted) return null;
      const connection = await tx.clinicalRecordConnection.findFirst({
        where: { id: input.connectionId, memberId: input.memberId },
        include: { retrievalRuns: { orderBy: { generation: "desc" }, take: 1, select: { ...lifecycleRunSelect, grantedScopesJson: true, retrievalPlanJson: true } } },
      });
      const previous = connection?.retrievalRuns[0];
      if (!connection || !previous || previous.status === "needs_reauth" || !hasDueClinicalGrant(connection, input.now)) return null;
      if (connection.requiresProcessorApprovals && await clinicalProcessorAdmissionError(input.memberId, tx)) return null;
      const lifecycle = classifyClinicalRun(previous, input.now);
      if (lifecycle !== "available" && lifecycle !== "recoverable") return null;
      const grantedScopesJson = previous.grantedScopesJson;
      if (!Array.isArray(grantedScopesJson) || !grantedScopesJson.every((value) => typeof value === "string")) return null;
      const generation = connection.retrievalGeneration + 1;
      const retrievalPlanJson = buildEpicDailyRetrievalPlan({
        previous: clinicalFhirRetrievalPlanSchema.parse(previous.retrievalPlanJson), now: input.now, generation,
      });
      if (lifecycle === "recoverable") {
        const closed = await closeClinicalRunTx(tx, {
          memberId: input.memberId, runId: previous.id, generation: previous.generation,
        }, retrievalPlanJson ? "canceled" : "failed", retrievalPlanJson ? "superseded" : "daily-queries-retired", input.now);
        if (!closed) return null;
      }
      if (!retrievalPlanJson) {
        // No grant can be polled. A new authorization can supply a current plan.
        await tx.clinicalRecordConnection.update({ where: { id: connection.id }, data: {
          ...CLEAR_CLINICAL_PERSISTENT_ACCESS, accessTokenEncrypted: null, accessTokenExpiresAt: null,
          patientIdEncrypted: null, status: "needs_reauth", lastErrorCode: "daily-queries-retired",
        } });
        return null;
      }
      const runId = `crr_${randomBytes(24).toString("base64url")}`;
      await tx.clinicalRecordConnection.update({ where: { id: connection.id }, data: {
        retrievalGeneration: generation, status: "active", nextSyncAt: new Date(input.now.getTime() + CLINICAL_DAILY_SYNC_MS),
      } });
      await tx.clinicalRecordRetrievalRun.create({ data: {
        id: runId, memberId: input.memberId, connectionId: connection.id, generation,
        createdAt: input.now, status: "queued", retrievalProtocol: "query-slices-v2", retrievalPlanJson,
        grantedScopesJson,
      } });
      return appendClinicalRetrievalWakeTx({ generation, memberId: input.memberId, occurredAt: input.now, runId, tx });
    }, HOSTED_RECOVERY_TRANSACTION_OPTIONS);
    if (!wake) return false;
    await signalClinicalRetrievalWake(wake, input.abortSignal);
    return true;
  });
}

function hasDueClinicalGrant(connection: {
  status: string; refreshTokenEncrypted: string | null; patientIdEncrypted: string | null; nextSyncAt: Date | null;
}, now: Date) {
  return ["active", "error"].includes(connection.status) && Boolean(connection.refreshTokenEncrypted)
    && Boolean(connection.patientIdEncrypted) && connection.nextSyncAt !== null && connection.nextSyncAt <= now;
}
