import "server-only";
import { createHash } from "node:crypto";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import { readHostedMemberHomeLinqChatId } from "../hosted-onboarding/member-private-codecs";
import { CLINICAL_TEXT_TRANSPORT_BLOCK, type ClinicalNotificationDecision } from "@murphai/hosted-execution/clinical-records";
import type { HostedExecutionResolvedLinqDeliveryRoute } from "@murphai/hosted-execution/contracts";
import { createHostedLinqChatLookupKey } from "../hosted-onboarding/contact-privacy";
import type { Prisma } from "@prisma/client";
import { activeHostedPersonAccessWhere, hostedRuntimeMemberEligibleWhere } from "../hosted-onboarding/member-access";
import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { readHostedConsentStatus } from "../legal/consent";
import { CLINICAL_RECORD_OPEN_RUN_STATUSES } from "./client-contracts";

type RunPointer = { memberId: string; runId: string; generation: number };

/** Bind the exact participant, assigned line and private home chat without storing the addresses. */
export function clinicalNotificationRouteKey(participantKey: string, lineKey: string, chatKey: string) {
  return createHash("sha256").update(JSON.stringify([participantKey, lineKey, chatKey])).digest("hex");
}

export async function readClinicalNotificationAuthority(tx: Prisma.TransactionClient, input: Omit<RunPointer, "generation"> & { generation?: number }) {
  const run = await tx.clinicalRecordRetrievalRun.findFirst({
    where: { id: input.runId, memberId: input.memberId, generation: input.generation },
    select: {
      status: true, completedAt: true, notificationTokenVersion: true, notificationRouteKey: true,
      notificationSettingRevision: true, notificationCoverage: true,
      connection: { select: { providerDirectoryEntryId: true, tokenVersion: true, status: true, disconnectedAt: true } },
    },
  });
  if (!run || run.notificationTokenVersion !== run.connection.tokenVersion || !run.notificationRouteKey
    || run.connection.status !== "active" || run.connection.disconnectedAt) return null;
  const member = await readClinicalNotificationMember(tx, input.memberId);
  if (!member || member.clinicalRecordMessageMode === "off" || member.clinicalRecordMessageRevision !== run.notificationSettingRevision) return null;
  const route = verifiedClinicalHomeRoute(member, run);
  if (!route?.linqChatLookupKey) return null;
  const chat = await tx.hostedLinqChatHealth.findUnique({ where: { linqChatLookupKey: route.linqChatLookupKey },
    select: { service: true, isGroup: true, phoneNumberLookupKey: true } });
  if (chat?.isGroup !== false || chat.service?.toLowerCase() !== "imessage" || chat.phoneNumberLookupKey !== route.linqRecipientPhoneLookupKey
    || !(await readHostedConsentStatus({ memberId: input.memberId, prisma: tx })).launchGranted) return null;
  return { mode: member.clinicalRecordMessageMode, chatLookupKey: route.linqChatLookupKey, routing: route, run };
}

function readClinicalNotificationMember(tx: Prisma.TransactionClient, memberId: string) {
  return tx.hostedMember.findFirst({
    where: { id: memberId, suspendedAt: null, AND: [activeHostedPersonAccessWhere(), hostedRuntimeMemberEligibleWhere()] },
    select: {
      clinicalRecordMessageMode: true, clinicalRecordMessageRevision: true,
      identity: { select: { phoneNumberVerifiedAt: true, phoneLookupKey: true } },
      routing: { select: { memberId: true, linqChatIdEncrypted: true, linqChatLookupKey: true, linqRecipientPhoneLookupKey: true, linqParticipantContactKind: true, linqParticipantContactLookupKey: true } },
    },
  });
}

function verifiedClinicalHomeRoute(member: Awaited<ReturnType<typeof readClinicalNotificationMember>>, run: { notificationRouteKey: string | null }) {
  const route = member?.routing;
  if (!member?.identity?.phoneNumberVerifiedAt || !member.identity.phoneLookupKey
    || route?.linqParticipantContactKind !== "phone" || member.identity.phoneLookupKey !== route.linqParticipantContactLookupKey
    || !route.linqRecipientPhoneLookupKey || !route.linqChatLookupKey
    || clinicalNotificationRouteKey(member.identity.phoneLookupKey, route.linqRecipientPhoneLookupKey, route.linqChatLookupKey) !== run.notificationRouteKey) return null;
  return route;
}

function acceptedClinicalOccurrence(authority: Awaited<ReturnType<typeof readClinicalNotificationAuthority>>) {
  return authority && ["published", "scheduled"].includes(authority.run.notificationCoverage ?? "") && authority.run.completedAt
    && ["complete", "partial"].includes(authority.run.status) ? authority : null;
}

export async function readClinicalNotificationDecision(input: RunPointer): Promise<ClinicalNotificationDecision> {
  const prisma = getPrisma();
  const authority = await prisma.$transaction(async tx => {
    await lockHostedMemberRow(tx, input.memberId);
    return acceptedClinicalOccurrence(await readClinicalNotificationAuthority(tx, input));
  });
  if (!authority || authority.run.notificationCoverage !== "published") return { mode: "off" };
  const threadId = await readHostedMemberHomeLinqChatId(authority.routing, prisma);
  if (!threadId || createHostedLinqChatLookupKey(threadId) !== authority.chatLookupKey) return { mode: "off" };
  if (authority.mode === "detail") return { mode: "detail", threadId };
  const { resolveClinicalProviderDirectoryEntry } = await import("./provider-directory-store");
  const label = resolveClinicalProviderDirectoryEntry(authority.run.connection.providerDirectoryEntryId)?.brandName;
  return { mode: "notice", threadId, directoryLabel: label && label.length <= 256 ? label : null };
}

/** Scheduled preflight and every dispatch/retry enter the same signed egress owner. */
export async function clinicalEgressBlock(tx: Prisma.TransactionClient, input: {
  key: string; memberId: string; route: HostedExecutionResolvedLinqDeliveryRoute;
}) {
  const match = /^clinical-change:v1:([A-Za-z0-9._-]{1,120}):(notice|detail)(?::bubble:[1-9][0-9]*)?$/u.exec(input.key);
  if (!match || input.route.targetKind !== "thread" || !input.route.threadIsDirect) return "clinical_authority_unavailable";
  const authority = acceptedClinicalOccurrence(await readClinicalNotificationAuthority(tx, { memberId: input.memberId, runId: match[1]! }));
  if (!authority || authority.mode !== match[2]
    || createHostedLinqChatLookupKey(input.route.target) !== authority.chatLookupKey) return "clinical_authority_unavailable";
  return CLINICAL_TEXT_TRANSPORT_BLOCK;
}

/** Caller holds the member row lock. Proof, coverage and encrypted mailbox publication share its transaction. */
export async function publishClinicalChangeTx(tx: Prisma.TransactionClient, input: RunPointer) {
  const authority = await readClinicalNotificationAuthority(tx, input);
  if (!authority) return null;
  const { run } = authority;
  if (run.notificationCoverage !== null && run.notificationCoverage !== "proved") return null;
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
