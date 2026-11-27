import "server-only";
import { readCloudflareHostedControlHttpError } from "@murphai/cloudflare-hosted-control/client";
import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { clinicalOccurrenceExpired, freezeClinicalDailyNotification, freshClinicalEvidence, type ClinicalDailyNoticeReaders } from "./notification";
import { hasClinicalProcessorApprovals } from "./processor-registry";

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
import { oracleEgressDisabled } from "./oracle-integration";
import { buildOracleDailyRetrievalPlan } from "./oracle-policy";
import { appendClinicalRetrievalWakeTx, endUnusableRunTx, signalClinicalRetrievalWake } from "./retrieval";

// Just under the 15-minute sweep, so the next sweep sees the row.
export const CLINICAL_DAILY_ADMISSION_RETRY_MS = 14 * 60_000;

/** Existing recovery scheduler; one bounded selection and sequential admission, no provider egress. */
export async function runClinicalDailySyncSweep(input: { now?: Date; deadlineMs?: number } = {}) {
  const now = input.now ?? new Date();
  const stop = abortAtHostedRecoveryDeadline(input.deadlineMs ?? Date.now() + HOSTED_RECOVERY_BUDGET_MS);
  let failed = await resumeDueClinicalNotifications(now, stop);
  const candidates = await getPrisma().clinicalRecordConnection.findMany({
    where: { member: { suspendedAt: null }, status: { in: ["active", "error"] }, nextSyncAt: { lte: now },
      refreshTokenEncrypted: { not: null } },
    orderBy: [{ nextSyncAt: "asc" }, { id: "asc" }], take: 20,
    select: { id: true, memberId: true, requiresProcessorApprovals: true },
  });
  const evidence = clinicalSweepEvidence();
  let checked = 0;
  let queued = 0;
  for (const candidate of candidates) {
    if (stop.aborted) break; // Unstarted rows stay due.
    checked++;
    let retryMs = CLINICAL_DAILY_SYNC_MS;
    try {
      if (await admitWithServingReaders({ abortSignal: stop, connectionId: candidate.id, memberId: candidate.memberId, now }, candidate.requiresProcessorApprovals ? evidence : undefined)) {
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
  evidence.report(checked, queued);
  return { checked, queued, failed };
}

async function resumeDueClinicalNotifications(now: Date, stop: AbortSignal) {
  const prisma = getPrisma();
  const due = await prisma.clinicalRecordRetrievalRun.findMany({ where: { notificationRetryAt: { lte: now } },
    select: { id: true, memberId: true, generation: true, completedAt: true, notificationCoverage: true, notificationRetryAt: true, notificationDeferral: true },
    orderBy: [{ notificationRetryAt: "asc" }, { id: "asc" }], take: 20 });
  let failures = 0;
  for (const run of due) {
    if (stop.aborted) break;
    try {
      if (clinicalOccurrenceExpired(run.completedAt, now)) {
        await prisma.clinicalRecordRetrievalRun.updateMany({ where: { id: run.id, notificationRetryAt: run.notificationRetryAt,
          notificationCoverage: run.notificationCoverage }, data: { notificationRetryAt: null, notificationDeferral: null,
          notificationCoverage: run.notificationCoverage === "attempted" ? "settled" : "suppressed" } });
        continue;
      }
      await runWithHostedDomainRootUnwrapCache(async () => {
        const root = await unwrapHostedDomainRootForWeb({ domain: getHostedCryptoDomainForLane("mailbox-payload"),
          prisma, retainFailureInScopedCache: true, signal: stop, userId: run.memberId });
        root.rootKey.fill(0);
        const wake = await prisma.$transaction(async tx => {
          await lockHostedMemberRow(tx, run.memberId, { timeoutMs: HOSTED_RECOVERY_LOCK_TIMEOUT_MS });
          const claimed = await tx.clinicalRecordRetrievalRun.updateMany({
            where: { id: run.id, notificationRetryAt: run.notificationRetryAt },
            data: { notificationRetryAt: null, notificationDeferral: run.notificationDeferral === "transient" ? "retried" : null } });
          if (!claimed.count) return null;
          const { item } = await appendHostedMailboxEnvelopeTx({ tx, envelope: { kind: "clinical-records.change-recorded",
            eventId: `clinical-resume:v1:${run.id}:${run.notificationRetryAt!.getTime()}`, runId: run.id,
            userId: run.memberId, generation: run.generation, occurredAt: now.toISOString() } });
          return { userId: run.memberId, id: item.id, lane: item.lane, laneSeq: item.laneSeq };
        }, HOSTED_RECOVERY_TRANSACTION_OPTIONS);
        if (wake) await signalClinicalRetrievalWake(wake, stop);
      });
    } catch {
      if (stop.aborted) break;
      failures++;
      await prisma.clinicalRecordRetrievalRun.updateMany({ where: { id: run.id, notificationRetryAt: run.notificationRetryAt },
        data: { notificationRetryAt: new Date(now.getTime() + CLINICAL_DAILY_ADMISSION_RETRY_MS) } });
    }
  }
  return failures;
}

type DailyAdmission = { abortSignal?: AbortSignal; connectionId: string; memberId: string; now: Date };

/** One retry for an unavailable sample. Reuse a failure within the same window to avoid fanout. */
function clinicalSweepEvidence() {
  const counts = { fetch_failed: 0, port_unavailable: 0, stale_evidence: 0, reads: 0, candidatesWithoutEvidence: 0, admittedWithoutEvidence: 0 };
  let readers: ClinicalDailyNoticeReaders | undefined;
  let sampledAt: number | undefined;
  return {
    async read() {
      if (sampledAt === undefined || !freshClinicalEvidence(sampledAt)) {
        if (sampledAt !== undefined) counts.stale_evidence++;
        readers = undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          sampledAt = Date.now();
          counts.reads++;
          try {
            const value = await readHostedExecutionControlClientIfConfigured(2000)?.readClinicalNoticeReaders();
            if (!value) counts.fetch_failed++;
            else if (!freshClinicalEvidence(sampledAt)) counts.stale_evidence++;
            else {
              readers = { ...value, observedAt: sampledAt };
              break;
            }
          } catch (error) {
            if (readCloudflareHostedControlHttpError(error)?.status === 503) counts.port_unavailable++;
            else counts.fetch_failed++;
          }
        }
      }
      if (!readers) counts.candidatesWithoutEvidence++;
      return readers;
    },
    staleAtLock() { counts.stale_evidence++; },
    admittedWithoutEvidence() { counts.admittedWithoutEvidence++; },
    report(checked: number, queued: number) {
      if (counts.fetch_failed || counts.port_unavailable || counts.stale_evidence) {
        console.warn("Clinical daily admission reader evidence", { eventCode: "clinical_daily_reader_evidence", ...counts, checked, queued });
      }
    },
  };
}

export async function admitClinicalDailySync(input: DailyAdmission): Promise<boolean> {
  const evidence = clinicalSweepEvidence();
  const admitted = await admitWithServingReaders(input, evidence);
  evidence.report(1, Number(admitted));
  return admitted;
}

const staleDuringAdmission = Symbol("clinical reader evidence expired during admission");

async function admitWithServingReaders(input: DailyAdmission, evidence?: ReturnType<typeof clinicalSweepEvidence>) {
  async function attempt(refreshAtLock: boolean) {
    let sample = await evidence?.read();
    const readLockedSample = () => {
      if (sample && !freshClinicalEvidence(sample.observedAt)) {
        if (refreshAtLock) throw staleDuringAdmission;
        evidence?.staleAtLock();
        sample = undefined;
      }
      return sample;
    };
    const admitted = await admitClinicalRun(input, readLockedSample);
    if (admitted && !sample) evidence?.admittedWithoutEvidence();
    return admitted;
  }
  try {
    return await attempt(true);
  } catch (error) {
    if (error !== staleDuringAdmission) throw error;
    // The transaction rolled back. Refresh outside the member lock before retrying this occurrence.
    return attempt(false);
  }
}

async function admitClinicalRun(input: DailyAdmission, readLockedSample: () => ClinicalDailyNoticeReaders | undefined): Promise<boolean> {
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
      if (!connection || !hasDueClinicalGrant(connection, input.now)) return null;
      const previous = connection.retrievalRuns[0];
      if (!previous || previous.status === "needs_reauth") return null;
      if (connection.requiresProcessorApprovals && !await hasClinicalProcessorApprovals(input.memberId, tx)) {
        if (!previous.completedAt) await endUnusableRunTx(tx, {
          memberId: input.memberId, runId: previous.id, generation: previous.generation,
        }, connection, "processor-admission-blocked", input.now);
        return null;
      }
      const lifecycle = classifyClinicalRun(previous, input.now);
      if (lifecycle !== "available" && lifecycle !== "recoverable") return null;
      const grantedScopesJson = previous.grantedScopesJson;
      if (!Array.isArray(grantedScopesJson) || !grantedScopesJson.every((value) => typeof value === "string")) return null;
      const generation = connection.retrievalGeneration + 1;
      const retrievalPlanJson = buildClinicalDailyPlan(connection.sourceSystem, {
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
      const notification = await freezeClinicalDailyNotification(tx, connection, grantedScopesJson, readLockedSample());
      await tx.clinicalRecordRetrievalRun.create({ data: {
        id: runId, memberId: input.memberId, connectionId: connection.id, generation,
        createdAt: input.now, status: "queued", retrievalProtocol: "query-slices-v2", retrievalPlanJson,
        grantedScopesJson, ...notification,
      } });
      return appendClinicalRetrievalWakeTx({ generation, memberId: input.memberId, occurredAt: input.now, runId, tx });
    }, HOSTED_RECOVERY_TRANSACTION_OPTIONS);
    if (!wake) return false;
    await signalClinicalRetrievalWake(wake, input.abortSignal);
    return true;
  });
}

/** Each vendor's frozen slices resolve only inside its own catalog. */
function buildClinicalDailyPlan(sourceSystem: string, input: Parameters<typeof buildEpicDailyRetrievalPlan>[0]) {
  return sourceSystem === "cerner-fhir" ? buildOracleDailyRetrievalPlan(input) : buildEpicDailyRetrievalPlan(input);
}

// While the Oracle kill switch is on, its grants stay saved and back off a day without a run.
function dailyChecksEnabled(sourceSystem: string) {
  return sourceSystem !== "cerner-fhir" || !oracleEgressDisabled();
}

function hasDueClinicalGrant(connection: {
  sourceSystem: string; status: string; refreshTokenEncrypted: string | null; patientIdEncrypted: string | null; nextSyncAt: Date | null;
}, now: Date) {
  return dailyChecksEnabled(connection.sourceSystem) && ["active", "error"].includes(connection.status) && Boolean(connection.refreshTokenEncrypted)
    && Boolean(connection.patientIdEncrypted) && connection.nextSyncAt !== null && connection.nextSyncAt <= now;
}
