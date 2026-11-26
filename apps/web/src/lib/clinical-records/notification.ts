import { CLINICAL_DAILY_NOTICE_REVISION, clinicalBlockDisposition, parseClinicalDeliveryKey } from "@murphai/hosted-execution/clinical-records-boundary";
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
      notificationSettingRevision: true, notificationCoverage: true,
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

export function freshClinicalEvidence(observedAt: number, now = Date.now()) {
  return observedAt <= now && now - observedAt < 30_000;
}

/** Daily admission has locked the member and checked launch consent, the due grant and named approvals. */
export async function freezeClinicalDailyNotification(
  tx: Prisma.TransactionClient,
  connection: Pick<ClinicalRecordConnection, "id" | "memberId" | "requiresProcessorApprovals" | "disconnectedAt" | "baselineTokenVersion" | "tokenVersion">,
  grantedScopes: string[], readers?: ClinicalDailyNoticeReaders,
) {
  if (process.env.CLINICAL_DAILY_NOTICE_ADMISSION_PAUSED === "1") return null;
  if (!readers || !freshClinicalEvidence(readers.observedAt) || readers.runner < CLINICAL_DAILY_NOTICE_REVISION || readers.cloudflarePort < CLINICAL_DAILY_NOTICE_REVISION
    || !connection.requiresProcessorApprovals || connection.disconnectedAt
    || connection.baselineTokenVersion !== connection.tokenVersion || !grantedScopes.includes("offline_access")) return null;
  const recipient = await readVerifiedClinicalRecipient(tx, connection.memberId);
  if (!recipient) return null;
  // The new eligible run and retirement of all prior pins commit together under the member lock.
  const older = { connectionId: connection.id, notificationTokenVersion: { not: null } };
  const terminal = { notificationRetryAt: null, notificationDeferral: null };
  await tx.clinicalRecordRetrievalRun.updateMany({ where: { ...older, OR: [{ notificationCoverage: null },
    { notificationCoverage: { in: ["proved", "published"] } }] }, data: { ...terminal, notificationCoverage: "suppressed" } });
  await tx.clinicalRecordRetrievalRun.updateMany({ where: { ...older, notificationCoverage: "attempted" },
    data: { ...terminal, notificationCoverage: "settled" } });

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
    identity, revision: member.clinicalRecordMessageRevision,
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

export function clinicalOccurrenceExpired(acceptedAt: Date | null, now: Date) {
  return acceptedAt !== null && now.getTime() - acceptedAt.getTime() >= 24 * 60 * 60_000;
}

async function acceptedClinicalOccurrence(tx: Prisma.TransactionClient, pointer: { runId: string; memberId: string }, now: Date) {
  const authority = await readClinicalNotificationAuthority(tx, pointer);
  if (!authority?.run.completedAt || !["complete", "partial"].includes(authority.run.status)
    || !["published", "attempted"].includes(authority.run.notificationCoverage ?? "")) return null;
  if (clinicalOccurrenceExpired(authority.run.completedAt, now)) {
    await closeUnauthorizedClinicalReply(tx, pointer);
    return null;
  }
  return authority;
}

/** Decrypt before taking the member lock. The locked authority validates this phone's lookup key. */
export async function readClinicalWindowPhone(memberId: string) {
  const prisma = getPrisma();
  const identity = await prisma.hostedMemberIdentity.findFirst({ where: { memberId, phoneNumberVerifiedAt: { not: null } },
    select: { memberId: true, phoneNumberEncrypted: true } });
  return identity && readHostedMemberIdentityPhoneNumber(identity, prisma);
}

export async function readClinicalNotificationDecision(input: RunPointer, now = new Date()): Promise<ClinicalNotificationDecision> {
  const prisma = getPrisma();
  const windowPhone = await readClinicalWindowPhone(input.memberId);
  const authority = await prisma.$transaction(async tx => {
    await lockHostedMemberRow(tx, input.memberId);
    const current = await acceptedClinicalOccurrence(tx, input, now);
    if (!current) {
      if (!await holdIfPhoneUnavailable(tx, input, now)) await closeUnauthorizedClinicalReply(tx, input);
      return null;
    }
    if (current.run.notificationCoverage === "attempted" || await deferOutsideClinicalWindow(tx, input, current, windowPhone, now)) return null;
    // Arm one recovery wake in case the port loses the positive authorization.
    await deferTransientClinicalReply(tx, input);
    return current;
  });
  if (!authority) return { mode: "off" };
  const threadId = await readHostedMemberHomeLinqChatId(authority.routing, prisma);
  if (!threadId || createHostedLinqChatLookupKey(threadId) !== authority.chatLookupKey) return { mode: "off" };
  return { mode: "notice", threadId };
}

export async function clinicalEgressBlock(tx: Prisma.TransactionClient, input: {
  key: string; memberId: string; route: HostedExecutionResolvedLinqDeliveryRoute;
  windowPhone: string | null; now?: Date;
}) {
  const key = parseClinicalDeliveryKey(input.key);
  if (!key || input.route.targetKind !== "thread" || !input.route.threadIsDirect) return "clinical_authority_unavailable";
  const pointer = { memberId: input.memberId, runId: key.runId };
  const authority = await acceptedClinicalOccurrence(tx, pointer, input.now ?? new Date());
  if (!authority) {
    if (await holdIfPhoneUnavailable(tx, pointer, input.now)) return "clinical_window_closed";
    await closeUnauthorizedClinicalReply(tx, pointer);
    return "clinical_authority_unavailable";
  }
  if (authority.run.notificationCoverage === "attempted" || !matchesClinicalRoute(input.route, authority)) {
    return "clinical_authority_unavailable";
  }
  return await deferOutsideClinicalWindow(tx, pointer, authority, input.windowPhone, input.now ?? new Date()) ? "clinical_window_closed" : null;
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

async function deferClinicalReply(tx: Prisma.TransactionClient, pointer: { runId: string; memberId: string }, next: Date | null) {
  await tx.clinicalRecordRetrievalRun.updateMany({ where: { id: pointer.runId, memberId: pointer.memberId,
    notificationCoverage: "published" }, data: { notificationRetryAt: next, notificationDeferral: next === null ? "route" : "window" } });
}

async function closeUnauthorizedClinicalReply(tx: Prisma.TransactionClient, pointer: { runId: string; memberId: string }) {
  // Permanently close the original authority while preserving whether a provider was reached.
  for (const [from, to] of [["published", "suppressed"], ["attempted", "settled"]] as const) {
    await tx.clinicalRecordRetrievalRun.updateMany({ where: { id: pointer.runId, memberId: pointer.memberId, notificationCoverage: from },
      data: { notificationCoverage: to, notificationRetryAt: null, notificationDeferral: null } });
  }
}

async function holdIfPhoneUnavailable(tx: Prisma.TransactionClient, pointer: { runId: string; memberId: string }, now = new Date()) {
  const verified = await tx.hostedMemberIdentity.findFirst({ where: { memberId: pointer.memberId,
    phoneNumberVerifiedAt: { not: null }, phoneNumberEncrypted: { not: null } }, select: { memberId: true } });
  if (verified) return false;
  const origin = await readClinicalNotificationRun(tx, pointer);
  if (!origin?.approved || clinicalOccurrenceExpired(origin.run.completedAt, now)) return false;
  const stillEnabled = await tx.hostedMember.findFirst({ where: { id: pointer.memberId, suspendedAt: null,
    clinicalRecordMessageMode: { not: "off" }, clinicalRecordMessageRevision: origin.run.notificationSettingRevision ?? -1,
    AND: [activeHostedPersonAccessWhere(), hostedRuntimeMemberEligibleWhere()] }, select: { id: true } });
  if (!stillEnabled || !(await readHostedConsentStatus({ memberId: pointer.memberId, prisma: tx })).launchGranted) return false;
  await deferClinicalReply(tx, pointer, null);
  return true;
}

async function deferTransientClinicalReply(tx: Prisma.TransactionClient, pointer: { runId: string; memberId: string }) {
  await tx.clinicalRecordRetrievalRun.updateMany({ where: { id: pointer.runId, memberId: pointer.memberId,
    notificationCoverage: "published", notificationDeferral: null, notificationRetryAt: null },
    data: { notificationDeferral: "transient", notificationRetryAt: new Date(Date.now() + 15 * 60_000) } });
}

export async function recordClinicalPolicyBlock(tx: Prisma.TransactionClient, memberId: string, deliveryKey: string,
  code: Parameters<typeof clinicalBlockDisposition>[0], route: HostedExecutionResolvedLinqDeliveryRoute) {
  const key = parseClinicalDeliveryKey(deliveryKey);
  if (!key) return;
  const pointer = { runId: key.runId, memberId };
  const authority = await acceptedClinicalOccurrence(tx, pointer, new Date());
  if (!authority) {
    if (!await holdIfPhoneUnavailable(tx, pointer)) await closeUnauthorizedClinicalReply(tx, pointer);
    return;
  }
  if (!matchesClinicalRoute(route, authority)) return;
  if (clinicalBlockDisposition(code) === "hold") await deferTransientClinicalReply(tx, pointer);
  else await closeUnauthorizedClinicalReply(tx, pointer);
}

export async function recordClinicalProviderAttempt(tx: Prisma.TransactionClient, memberId: string, idempotencyKey: string | null) {
  const key = parseClinicalDeliveryKey(idempotencyKey);
  if (!key) return;
  await tx.clinicalRecordRetrievalRun.updateMany({ where: { id: key.runId, memberId,
    notificationCoverage: "published" }, data: { notificationCoverage: "attempted", notificationDeferral: null,
      notificationRetryAt: null } });
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
