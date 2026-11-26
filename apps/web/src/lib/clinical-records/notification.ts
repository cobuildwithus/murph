import "server-only";
import { CLINICAL_RECEIPT_PROTOCOL } from "@murphai/clinical-records/retrieval-limits";
import { createHash } from "node:crypto";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import { readHostedMemberHomeLinqChatId } from "../hosted-onboarding/member-private-codecs";
import { CLINICAL_TEXT_TRANSPORT_BLOCK, type ClinicalNotificationDecision } from "@murphai/hosted-execution/clinical-records";
import type { HostedExecutionResolvedLinqDeliveryRoute } from "@murphai/hosted-execution/contracts";
import { createHostedLinqChatLookupKey } from "../hosted-onboarding/contact-privacy";
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

// The production sweep supplies no reader revisions until dispatch and recovery ship together.
export type ClinicalDailyNoticeReaders = { runner: number; cloudflarePort: number };
// Revision 2 requires the port to forward explicit clinical reply authorization to the runner.
const CLINICAL_DAILY_NOTICE_REVISION = 2;

/** Daily admission has locked the member and checked launch consent, the due grant and named approvals. */
export async function freezeClinicalDailyNotification(
  tx: Prisma.TransactionClient,
  connection: Pick<ClinicalRecordConnection, "memberId" | "requiresProcessorApprovals" | "disconnectedAt" | "baselineTokenVersion" | "tokenVersion">,
  grantedScopes: string[], readers?: ClinicalDailyNoticeReaders,
) {
  if (readers?.runner !== CLINICAL_DAILY_NOTICE_REVISION || readers.cloudflarePort !== CLINICAL_DAILY_NOTICE_REVISION
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
    mode: member.clinicalRecordMessageMode, revision: member.clinicalRecordMessageRevision,
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
      identity: { select: { phoneLookupKey: true } },
      routing: { select: { memberId: true, linqChatIdEncrypted: true, linqChatLookupKey: true, linqRecipientPhoneLookupKey: true, linqParticipantContactKind: true, linqParticipantContactLookupKey: true } },
    },
  });
}

function acceptedClinicalOccurrence(authority: Awaited<ReturnType<typeof readClinicalNotificationAuthority>>) {
  return authority && authority.run.notificationCoverage === "published" && authority.run.completedAt
    && ["complete", "partial"].includes(authority.run.status) ? authority : null;
}

export async function readClinicalNotificationDecision(input: RunPointer): Promise<ClinicalNotificationDecision> {
  const prisma = getPrisma();
  const authority = await prisma.$transaction(async tx => {
    await lockHostedMemberRow(tx, input.memberId);
    return acceptedClinicalOccurrence(await readClinicalNotificationAuthority(tx, input));
  });
  if (!authority) return { mode: "off" };
  const threadId = await readHostedMemberHomeLinqChatId(authority.routing, prisma);
  if (!threadId || createHostedLinqChatLookupKey(threadId) !== authority.chatLookupKey) return { mode: "off" };
  return { mode: authority.mode, threadId };
}

/** Scheduled preflight and every dispatch/retry enter the same signed egress owner. */
export async function clinicalEgressBlock(tx: Prisma.TransactionClient, input: {
  key: string; memberId: string; route: HostedExecutionResolvedLinqDeliveryRoute;
}) {
  const match = /^clinical-change:v1:([A-Za-z0-9._-]{1,120}):(notice|detail)((?::bubble:(?:0|[1-9][0-9]*))?(?::(?:voice|transcript))?)$/u.exec(input.key);
  if (!match || (match[2] === "notice" && match[3]) || input.route.targetKind !== "thread" || !input.route.threadIsDirect) return "clinical_authority_unavailable";
  const authority = acceptedClinicalOccurrence(await readClinicalNotificationAuthority(tx, { memberId: input.memberId, runId: match[1]! }));
  if (!authority || authority.mode !== match[2]
    || createHostedLinqChatLookupKey(input.route.target) !== authority.chatLookupKey) return "clinical_authority_unavailable";
  return CLINICAL_TEXT_TRANSPORT_BLOCK;
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
  if (!hasChangeReceipt || !await readClinicalNotificationRecipient(tx, input.memberId, run)) return null;
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
