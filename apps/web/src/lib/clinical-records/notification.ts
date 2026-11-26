import { CLINICAL_DAILY_NOTICE_REVISION, parseClinicalDeliveryKey } from "@murphai/hosted-execution/clinical-records-boundary";
import "server-only";
import { CLINICAL_RECEIPT_PROTOCOL } from "@murphai/clinical-records/retrieval-limits";
import { createHash } from "node:crypto";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import { decideHostedGroupJoinOutreachSendWindow } from "../hosted-groups/group-join-outreach-window";
import { readHostedMemberIdentityPhoneNumber, readHostedMemberHomeLinqChatId } from "../hosted-onboarding/member-private-codecs";
import { type ClinicalNotificationDecision } from "@murphai/hosted-execution/clinical-records";
import type { HostedExecutionResolvedLinqDeliveryRoute } from "@murphai/hosted-execution/contracts";
import { createHostedLinqChatLookupKey, createHostedPhoneLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import type { ClinicalRecordConnection, Prisma } from "@prisma/client";
import { activeHostedPersonAccessWhere, hostedRuntimeMemberEligibleWhere } from "../hosted-onboarding/member-access";
import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { readHostedConsentStatus } from "../legal/consent";
import { CLINICAL_RECORD_OPEN_RUN_STATUSES } from "./client-contracts";
import { clinicalProcessors, hasClinicalProcessorApprovals } from "./processor-registry";

type RunPointer = { memberId: string; runId: string; generation: number };

/** Fingerprint the private recipient and the named notice versions approved at admission. */
function clinicalNotificationRouteKey(participantKey: string, lineKey: string, chatKey: string) {
  const notices = clinicalProcessors.map(({ id, version }) => [id, version]);
  return createHash("sha256").update(JSON.stringify([participantKey, lineKey, chatKey, notices])).digest("hex");
}

async function readClinicalNotificationRun(tx: Prisma.TransactionClient, input: Omit<RunPointer, "generation"> & { generation?: number }) {
  const run = await tx.clinicalRecordRetrievalRun.findFirst({
    where: { id: input.runId, memberId: input.memberId, generation: input.generation, retrievalProtocol: CLINICAL_RECEIPT_PROTOCOL,
      connection: { requiresProcessorApprovals: true, refreshTokenEncrypted: { not: null }, patientIdEncrypted: { not: null } } },
    select: {
      status: true, completedAt: true, notificationTokenVersion: true, notificationRouteKey: true,
      notificationSettingRevision: true, notificationCoverage: true, notificationTurnId: true, notificationSnapshotId: true,
      connection: { select: { baselineTokenVersion: true, tokenVersion: true, status: true, disconnectedAt: true } },
    },
  });
  if (!run || run.connection.baselineTokenVersion !== run.connection.tokenVersion
    || run.notificationTokenVersion !== run.connection.tokenVersion || !run.notificationRouteKey
    || run.connection.status !== "active" || run.connection.disconnectedAt) return null;
  const approved = await hasClinicalProcessorApprovals(input.memberId, tx);
  return { run, approved };
}

export async function readClinicalNotificationAuthority(tx: Prisma.TransactionClient, input: Omit<RunPointer, "generation"> & { generation?: number }) {
  const origin = await readClinicalNotificationRun(tx, input);
  return origin?.approved ? readClinicalNotificationRecipient(tx, input.memberId, origin.run) : null;
}

async function readClinicalNotificationRecipient(tx: Prisma.TransactionClient, memberId: string,
  run: NonNullable<Awaited<ReturnType<typeof readClinicalNotificationRun>>>["run"]) {
  const recipient = await readVerifiedClinicalRecipient(tx, memberId);
  if (!recipient || recipient.revision !== run.notificationSettingRevision || recipient.routeKey !== run.notificationRouteKey
    || !(await readHostedConsentStatus({ memberId, prisma: tx })).launchGranted) return null;
  return { ...recipient, run };
}

export type ClinicalDailyNoticeReaders = { runner: number; cloudflarePort: number; observedAt: number };

/** Daily admission has locked the member and checked launch consent, the due grant and named approvals. */
export async function freezeClinicalDailyNotification(
  tx: Prisma.TransactionClient,
  connection: Pick<ClinicalRecordConnection, "memberId" | "requiresProcessorApprovals" | "disconnectedAt" | "baselineTokenVersion" | "tokenVersion">,
  grantedScopes: string[], readers?: ClinicalDailyNoticeReaders,
) {
  if (process.env.CLINICAL_DAILY_NOTICE_ADMISSION_PAUSED === "1") return null;
  if (!readers || readers.observedAt > Date.now() || Date.now() - readers.observedAt > 30_000 || readers.runner < CLINICAL_DAILY_NOTICE_REVISION || readers.cloudflarePort < CLINICAL_DAILY_NOTICE_REVISION
    || !connection.requiresProcessorApprovals || connection.disconnectedAt
    || connection.baselineTokenVersion !== connection.tokenVersion || !grantedScopes.includes("offline_access")) return null;
  const recipient = await readVerifiedClinicalRecipient(tx, connection.memberId);
  if (!recipient) return null;
  return {
    retrievalProtocol: CLINICAL_RECEIPT_PROTOCOL,
    notificationTokenVersion: connection.tokenVersion,
    notificationSettingRevision: recipient.revision,
    notificationRouteKey: recipient.routeKey,
  };
}

async function readVerifiedClinicalRecipient(tx: Prisma.TransactionClient, memberId: string) {
  const member = await readClinicalNotificationMember(tx, memberId);
  if (!member || member.clinicalRecordMessageMode === "off") return null;
  const route = member.routing;
  const identity = member.identity;
  if (!identity?.phoneLookupKey || route?.linqParticipantContactKind !== "phone"
    || identity.phoneLookupKey !== route.linqParticipantContactLookupKey || !route.linqChatIdEncrypted
    || !route.linqRecipientPhoneLookupKey || !route.linqChatLookupKey) return null;
  const chat = await tx.hostedLinqChatHealth.findUnique({ where: { linqChatLookupKey: route.linqChatLookupKey },
    select: { isGroup: true, phoneNumberLookupKey: true } });
  if (chat?.isGroup !== false || chat.phoneNumberLookupKey !== route.linqRecipientPhoneLookupKey) return null;
  return {
    identity, mode: member.clinicalRecordMessageMode, revision: member.clinicalRecordMessageRevision,
    chatLookupKey: route.linqChatLookupKey, routing: route,
    routeKey: clinicalNotificationRouteKey(identity.phoneLookupKey, route.linqRecipientPhoneLookupKey, route.linqChatLookupKey),
  };
}

function readClinicalNotificationMember(tx: Prisma.TransactionClient, memberId: string) {
  return tx.hostedMember.findFirst({
    where: { id: memberId, suspendedAt: null, identity: { phoneNumberVerifiedAt: { not: null }, phoneNumberEncrypted: { not: null } },
      AND: [activeHostedPersonAccessWhere(), hostedRuntimeMemberEligibleWhere()] },
    select: {
      clinicalRecordMessageMode: true, clinicalRecordMessageRevision: true,
      identity: { select: { memberId: true, phoneLookupKey: true, phoneNumberEncrypted: true } },
      routing: { select: { memberId: true, linqChatIdEncrypted: true, linqChatLookupKey: true, linqRecipientPhoneLookupKey: true, linqParticipantContactKind: true, linqParticipantContactLookupKey: true } },
    },
  });
}

function acceptedClinicalOccurrence(authority: Awaited<ReturnType<typeof readClinicalNotificationAuthority>>) {
  return authority && ["published", "attempted"].includes(authority.run.notificationCoverage ?? "") && authority.run.completedAt
    && ["complete", "partial"].includes(authority.run.status) ? authority : null;
}

/** Decrypt before taking the member lock. The locked authority validates this phone's lookup key. */
export async function readClinicalWindowPhone(memberId: string) {
  const prisma = getPrisma();
  const identity = await prisma.hostedMemberIdentity.findFirst({ where: { memberId, phoneNumberVerifiedAt: { not: null } },
    select: { memberId: true, phoneNumberEncrypted: true } });
  return identity && readHostedMemberIdentityPhoneNumber(identity, prisma);
}

export async function readClinicalNotificationDecision(input: RunPointer & { savedReplyResult?: { turnId: string; status: "missing" | "drained" } }, now = new Date()): Promise<ClinicalNotificationDecision> {
  const prisma = getPrisma();
  const windowPhone = input.savedReplyResult ? null : await readClinicalWindowPhone(input.memberId);
  const authority = await prisma.$transaction(async tx => {
    await lockHostedMemberRow(tx, input.memberId);
    if (input.savedReplyResult) {
      const missing = input.savedReplyResult.status === "missing";
      await tx.clinicalRecordRetrievalRun.updateMany({ where: { id: input.runId, memberId: input.memberId,
        generation: input.generation, notificationTurnId: input.savedReplyResult.turnId,
        notificationCoverage: { in: missing ? ["published", "attempted"] : ["attempted"] } },
        data: { notificationCoverage: missing ? "lost" : "settled", notificationRetryAt: null, notificationDeferral: null } });
      return null;
    }
    const current = acceptedClinicalOccurrence(await readClinicalNotificationAuthority(tx, input));
    if (!current) {
      if (!await holdIfPhoneUnavailable(tx, input)) await closeUnauthorizedClinicalReply(tx, input);
      return null;
    }
    if (await deferOutsideClinicalWindow(tx, input, current, windowPhone, now)) return null;
    if (current.run.notificationCoverage === "published") {
      // A port which loses the positive field cannot report a block. Arm one recovery wake before handing off.
      await deferTransientClinicalReply(tx, input);
    }
    return current;
  });
  if (!authority || authority.run.notificationCoverage === "attempted" && !authority.run.notificationTurnId) return { mode: "off" };
  const threadId = await readHostedMemberHomeLinqChatId(authority.routing, prisma);
  if (!threadId || createHostedLinqChatLookupKey(threadId) !== authority.chatLookupKey) return { mode: "off" };
  return authority.mode === "detail" && authority.run.notificationTurnId
    ? { mode: "detail", threadId, savedTurnId: authority.run.notificationTurnId }
    : { mode: authority.mode, threadId };
}

/** Generation and staging may precede publication. A provider request may only use the bound turn. */
export async function clinicalEgressBlock(tx: Prisma.TransactionClient, input: {
  key: string; memberId: string; route: HostedExecutionResolvedLinqDeliveryRoute;
  providerEntry?: boolean; windowPhone: string | null; now?: Date;
}) {
  const key = parseClinicalDeliveryKey(input.key);
  if (!key || input.route.targetKind !== "thread" || !input.route.threadIsDirect) return "clinical_authority_unavailable";
  const pointer = { memberId: input.memberId, runId: key.runId };
  const authority = acceptedClinicalOccurrence(await readClinicalNotificationAuthority(tx, pointer));
  if (!authority) {
    if (await holdIfPhoneUnavailable(tx, pointer)) return "clinical_window_closed";
    await closeUnauthorizedClinicalReply(tx, pointer);
    return "clinical_authority_unavailable";
  }
  if (authority.mode !== key.mode || !matchesClinicalRoute(input.route, authority)) {
    return "clinical_authority_unavailable";
  }
  const block = clinicalCheckpointBlock(key, authority.run, input.providerEntry);
  if (block) return block;
  return await deferOutsideClinicalWindow(tx, pointer, authority, input.windowPhone, input.now ?? new Date()) ? "clinical_window_closed" : null;
}

function clinicalCheckpointBlock(key: NonNullable<ReturnType<typeof parseClinicalDeliveryKey>>,
  run: { notificationCoverage: string | null; notificationTurnId: string | null }, providerEntry?: boolean) {
  if (key.mode === "notice" && run.notificationCoverage === "attempted") return "clinical_authority_unavailable";
  if (key.mode === "detail") {
    const bound = run.notificationTurnId;
    if (bound && bound !== key.turnId) return "clinical_authority_unavailable";
    if (providerEntry && (!bound || !key.turnId)) return "clinical_checkpoint_pending";
    if (!key.turnId && key.suffix) return "clinical_authority_unavailable";
  }
  return null;
}

async function deferOutsideClinicalWindow(tx: Prisma.TransactionClient, pointer: { runId: string; memberId: string },
  authority: NonNullable<Awaited<ReturnType<typeof readClinicalNotificationAuthority>>>, number: string | null, now: Date) {
  if (!number || !createHostedPhoneLookupKeyReadCandidates(number).includes(authority.identity.phoneLookupKey!)) {
    // Identity changed after the external read. Retry against the new locked identity.
    await deferTransientClinicalReply(tx, pointer);
    return true;
  }
  const window = decideHostedGroupJoinOutreachSendWindow({ now, participantPhoneNumber: number });
  if (window.kind === "send_now") return false;
  await deferClinicalReply(tx, pointer, window.kind === "defer" ? window.nextAttemptAt : null);
  return true;
}

function matchesClinicalRoute(route: HostedExecutionResolvedLinqDeliveryRoute, authority: NonNullable<Awaited<ReturnType<typeof readClinicalNotificationAuthority>>>) {
  return createHostedLinqChatLookupKey(route.target) === authority.chatLookupKey
    && (!route.directRecipientPhoneNumber || createHostedPhoneLookupKeyReadCandidates(route.directRecipientPhoneNumber).includes(authority.identity.phoneLookupKey!))
    && (!route.fromPhoneNumber || createHostedPhoneLookupKeyReadCandidates(route.fromPhoneNumber).includes(authority.routing.linqRecipientPhoneLookupKey!));
}

export async function deferClinicalReply(tx: Prisma.TransactionClient, pointer: { runId: string; memberId: string }, next: Date | null) {
  await tx.clinicalRecordRetrievalRun.updateMany({ where: { id: pointer.runId, memberId: pointer.memberId,
    notificationCoverage: { in: ["published", "attempted"] } }, data: { notificationRetryAt: next, notificationDeferral: next === null ? "route" : "window" } });
}

async function closeUnauthorizedClinicalReply(tx: Prisma.TransactionClient, pointer: { runId: string; memberId: string }) {
  // Permanently close the original authority while preserving whether a provider was reached.
  for (const [from, to] of [["published", "suppressed"], ["attempted", "settled"]] as const) {
    await tx.clinicalRecordRetrievalRun.updateMany({ where: { id: pointer.runId, memberId: pointer.memberId, notificationCoverage: from },
      data: { notificationCoverage: to, notificationRetryAt: null, notificationDeferral: null } });
  }
}

async function holdIfPhoneUnavailable(tx: Prisma.TransactionClient, pointer: { runId: string; memberId: string }) {
  const verified = await tx.hostedMemberIdentity.findFirst({ where: { memberId: pointer.memberId,
    phoneNumberVerifiedAt: { not: null }, phoneNumberEncrypted: { not: null } }, select: { memberId: true } });
  if (verified) return false;
  await deferClinicalReply(tx, pointer, null);
  return true;
}

export async function deferTransientClinicalReply(tx: Prisma.TransactionClient, pointer: { runId: string; memberId: string }) {
  await tx.clinicalRecordRetrievalRun.updateMany({ where: { id: pointer.runId, memberId: pointer.memberId,
    notificationCoverage: { in: ["published", "attempted"] }, notificationDeferral: null, notificationRetryAt: null },
    data: { notificationDeferral: "transient", notificationRetryAt: new Date(Date.now() + 15 * 60_000) } });
}

export async function recordClinicalProviderAttempt(tx: Prisma.TransactionClient, memberId: string, idempotencyKey: string | null) {
  const key = parseClinicalDeliveryKey(idempotencyKey);
  if (!key) return;
  if (key.turnId) {
    const deferred = await tx.clinicalRecordRetrievalRun.updateMany({ where: { id: key.runId, memberId,
      notificationTurnId: key.turnId, notificationCoverage: "published", notificationDeferral: { in: ["window", "route"] } },
      data: { notificationCoverage: "attempted" } });
    if (deferred.count) return;
  }
  await tx.clinicalRecordRetrievalRun.updateMany({ where: { id: key.runId, memberId, notificationTurnId: key.turnId,
    notificationCoverage: "published" }, data: { notificationCoverage: "attempted", notificationDeferral: null,
      notificationRetryAt: key.turnId ? new Date(Date.now() + 15 * 60_000) : null } });
}

/** Caller holds the member row lock. Proof, coverage and encrypted mailbox publication share its transaction. */
export async function publishClinicalChangeTx(tx: Prisma.TransactionClient, input: RunPointer, hasChangeReceipt = true) {
  const origin = await readClinicalNotificationRun(tx, input);
  if (!origin) return null;
  const { run, approved } = origin;
  if (run.notificationCoverage !== null && run.notificationCoverage !== "proved") return null;
  if (!approved) {
    // A later approval cannot replay this blocked run, even if enrichment proves a change later.
    await tx.clinicalRecordRetrievalRun.update({ where: { id: input.runId }, data: { notificationCoverage: "suppressed" } });
    return null;
  }
  if (!hasChangeReceipt) return null;
  if (!await readClinicalNotificationRecipient(tx, input.memberId, run) && !await holdIfPhoneUnavailable(tx, input)) return null;
  if (!run.completedAt) {
    if (run.notificationCoverage === null && CLINICAL_RECORD_OPEN_RUN_STATUSES.some(status => status === run.status)) {
      await tx.clinicalRecordRetrievalRun.update({ where: { id: input.runId }, data: { notificationCoverage: "proved" } });
    }
    return null;
  }
  if (run.status !== "complete" && run.status !== "partial") return null;
  const appended = await appendHostedMailboxEnvelopeTx({ tx, envelope: {
    kind: "clinical-records.change-recorded", eventId: `clinical-change:v1:${input.runId}`, userId: input.memberId,
    occurredAt: run.completedAt.toISOString(), runId: input.runId, generation: input.generation,
  } });
  await tx.clinicalRecordRetrievalRun.update({ where: { id: input.runId },
    data: { notificationCoverage: appended.dedupeConflict ? "suppressed" : "published" } });
  if (appended.dedupeConflict) return null;
  return { id: appended.item.id, lane: appended.item.lane, laneSeq: appended.item.laneSeq, userId: input.memberId };
}
