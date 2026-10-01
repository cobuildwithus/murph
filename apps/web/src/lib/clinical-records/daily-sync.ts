import "server-only";

import { randomBytes } from "node:crypto";
import { clinicalFhirRetrievalPlanSchema } from "@murphai/clinical-records";
import { getHostedCryptoDomainForLane } from "@murphai/runtime-state";

import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { unwrapHostedDomainRootForWeb } from "../hosted-crypto/domain-root-store";
import { readHostedRuntimeAiAccessDecision } from "../hosted-onboarding/member-access";
import { lockHostedMemberRow, readHostedMemberSuspensionAfterLockTx } from "../hosted-onboarding/shared";
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { getPrisma } from "../prisma";
import { buildEpicDailyRetrievalPlan } from "./epic-policy";
import { CLINICAL_DAILY_SYNC_MS } from "./persistent-access";
import { appendClinicalRetrievalWakeTx, signalClinicalRetrievalWake } from "./retrieval";

/** Existing recovery scheduler; one bounded selection and sequential admission, no provider egress. */
export async function runClinicalDailySyncSweep(input: { now?: Date } = {}) {
  const now = input.now ?? new Date();
  const candidates = await getPrisma().clinicalRecordConnection.findMany({
    where: { member: { suspendedAt: null }, status: { in: ["active", "error"] }, nextSyncAt: { lte: now },
      refreshTokenEncrypted: { not: null }, retrievalRuns: { none: { completedAt: null } } },
    orderBy: [{ nextSyncAt: "asc" }, { id: "asc" }], take: 20,
    select: { id: true, memberId: true },
  });
  let queued = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      if (await admitClinicalDailySync({ connectionId: candidate.id, memberId: candidate.memberId, now })) queued++;
    } catch { failed++; }
    // Ineligible or failing rows must not monopolize the bounded candidate window.
    await getPrisma().clinicalRecordConnection.updateMany({
      where: { id: candidate.id, nextSyncAt: { lte: now } },
      data: { nextSyncAt: new Date(now.getTime() + CLINICAL_DAILY_SYNC_MS) },
    });
  }
  return { checked: candidates.length, queued, failed };
}

export async function admitClinicalDailySync(input: { connectionId: string; memberId: string; now: Date }): Promise<boolean> {
  if (!(await readHostedRuntimeAiAccessDecision({ memberId: input.memberId })).allowed) return false;
  return runWithHostedDomainRootUnwrapCache(async () => {
    const prisma = getPrisma();
    const root = await unwrapHostedDomainRootForWeb({ domain: getHostedCryptoDomainForLane("mailbox-payload"),
      prisma, retainFailureInScopedCache: true, userId: input.memberId });
    root.rootKey.fill(0);
    const wake = await prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, input.memberId);
      if (await readHostedMemberSuspensionAfterLockTx(tx, input.memberId) !== "active") return null;
      await assertHostedLaunchRequiredConsentGranted({ memberId: input.memberId, prisma: tx });
      const connection = await tx.clinicalRecordConnection.findFirst({
        where: { id: input.connectionId, memberId: input.memberId },
        include: { retrievalRuns: { orderBy: { generation: "desc" }, take: 1 } },
      });
      const previous = connection?.retrievalRuns[0];
      if (!connection || !["active", "error"].includes(connection.status) || !connection.refreshTokenEncrypted
        || !connection.patientIdEncrypted || !connection.nextSyncAt || connection.nextSyncAt > input.now
        || !previous?.completedAt || previous.status === "needs_reauth") return null;
      const grantedScopesJson = previous.grantedScopesJson;
      if (!Array.isArray(grantedScopesJson) || !grantedScopesJson.every((value) => typeof value === "string")) return null;
      const generation = connection.retrievalGeneration + 1;
      const retrievalPlanJson = buildEpicDailyRetrievalPlan({
        previous: clinicalFhirRetrievalPlanSchema.parse(previous.retrievalPlanJson), now: input.now, generation,
      });
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
    });
    if (!wake) return false;
    await signalClinicalRetrievalWake(wake);
    return true;
  });
}
