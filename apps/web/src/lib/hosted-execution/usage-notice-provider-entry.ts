import "server-only";

import {
  isHostedEmailConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  isHostedWhatsAppConversationMessageWake,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import {
  normalizeHostedEmailAddress,
  parseHostedEmailThreadTarget,
} from "@murphai/runtime-state";
import type { Prisma, PrismaClient } from "@prisma/client";

import {
  decodeHostedMailboxStoredPayload,
  readHostedMailboxItemByDedupeKey,
  readHostedMailboxPayload,
} from "../hosted-mailbox/store";
import {
  canHostedMemberReceiveInactiveAccessResponse,
  isHostedMemberSuspended,
} from "../hosted-onboarding/entitlement";
import {
  createHostedPhoneLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import {
  readHostedMemberEmailAuthorization,
  readHostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import {
  readHostedMemberRoutingState,
} from "../hosted-onboarding/hosted-member-routing-store";
import {
  markHostedAiUsageDeniedResponseDispatchStartedTx,
} from "../hosted-onboarding/linq-delivery-store";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import {
  readHostedWhatsAppMessagingConsentGrantedTx,
} from "../hosted-onboarding/whatsapp-consent";

export type HostedUsageNoticeProviderEntryAuthority =
  | { channel: "email"; target: string; targetKind: "explicit" | "thread" }
  | { channel: "telegram" | "whatsapp"; target: string };

export type HostedUsageNoticeProviderEntryResult =
  | "claimed"
  | "dispatch_already_started"
  | "authority_superseded";

export async function claimHostedUsageNoticeProviderEntry(input: {
  attemptedAt: Date;
  authority: HostedUsageNoticeProviderEntryAuthority;
  idempotencyKey: string;
  memberId: string;
  prisma: PrismaClient;
  sourceEventId: string;
}): Promise<HostedUsageNoticeProviderEntryResult> {
  const wake = await readHostedUsageNoticeSourceWake({
    memberId: input.memberId,
    prisma: input.prisma,
    sourceEventId: input.sourceEventId,
  });
  if (!wake || !hostedUsageNoticeAuthorityMatchesWake(input.authority, wake)) {
    return "authority_superseded";
  }

  return input.prisma.$transaction(async (tx) => {
    if (!await hasHostedUsageNoticeCurrentAuthorityTx({
      authority: input.authority,
      memberId: input.memberId,
      prisma: tx,
      wake,
    })) {
      return "authority_superseded";
    }

    return await markHostedAiUsageDeniedResponseDispatchStartedTx({
      expectedAttemptedAt: input.attemptedAt,
      idempotencyKey: input.idempotencyKey,
      prisma: tx,
    })
      ? "claimed"
      : "dispatch_already_started";
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function hasHostedUsageNoticeMemberResponseAuthorityTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  await lockHostedUsageNoticeMemberAccessRowsTx(input);
  const member = await readHostedMemberCoreState({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (!member || isHostedMemberSuspended(member.suspendedAt)) {
    return false;
  }
  return canHostedMemberReceiveInactiveAccessResponse(member)
    || await readActiveHostedMemberAccess({
      memberId: input.memberId,
      prisma: input.prisma,
    });
}

async function hasHostedUsageNoticeMemberActiveAccessTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  await lockHostedUsageNoticeMemberAccessRowsTx(input);
  return await readActiveHostedMemberAccess(input);
}

async function hasHostedUsageNoticeCurrentAuthorityTx(input: {
  authority: HostedUsageNoticeProviderEntryAuthority;
  memberId: string;
  prisma: Prisma.TransactionClient;
  wake: HostedExecutionWake;
}): Promise<boolean> {
  if (isHostedEmailConversationMessageWake(input.wake)) {
    const threadTarget = parseHostedEmailThreadTarget(
      input.wake.message.threadTarget,
    );
    if (threadTarget?.targetKind === "group") {
      return await hasHostedGroupEmailUsageNoticeAuthorityTx({
        actorMemberId: input.wake.message.actorMemberId ?? null,
        groupId: threadTarget.groupId,
        memberId: input.memberId,
        prisma: input.prisma,
        target: input.authority.target,
      });
    }
    return await hasHostedUsageNoticeMemberResponseAuthorityTx({
      memberId: input.memberId,
      prisma: input.prisma,
    });
  }

  if (!await hasHostedUsageNoticeMemberResponseAuthorityTx({
    memberId: input.memberId,
    prisma: input.prisma,
  })) {
    return false;
  }

  if (isHostedWhatsAppConversationMessageWake(input.wake)) {
    return await hasHostedWhatsAppUsageNoticeAuthorityTx({
      memberId: input.memberId,
      prisma: input.prisma,
      target: input.authority.target,
    });
  }
  if (isHostedTelegramConversationMessageWake(input.wake)) {
    return await hasHostedTelegramUsageNoticeAuthorityTx({
      memberId: input.memberId,
      prisma: input.prisma,
      target: input.authority.target,
    });
  }
  return false;
}

function hostedUsageNoticeAuthorityMatchesWake(
  authority: HostedUsageNoticeProviderEntryAuthority,
  wake: HostedExecutionWake,
): boolean {
  if (isHostedWhatsAppConversationMessageWake(wake)) {
    const expectedTarget = wake.message.whatsappMessage.threadId.trim()
      || wake.message.whatsappMessage.fromWaId.trim();
    return authority.channel === "whatsapp" && authority.target === expectedTarget;
  }
  if (isHostedTelegramConversationMessageWake(wake)) {
    return authority.channel === "telegram"
      && authority.target === wake.message.telegramMessage.threadId;
  }
  if (!isHostedEmailConversationMessageWake(wake) || authority.channel !== "email") {
    return false;
  }

  const threadTarget = wake.message.threadTarget?.trim() ?? "";
  const parsedThreadTarget = parseHostedEmailThreadTarget(threadTarget);
  if (parsedThreadTarget?.targetKind === "group") {
    return authority.targetKind === "explicit"
      && Boolean(wake.message.actorMemberId?.trim());
  }
  const explicitTarget = wake.message.from?.trim() ?? "";
  const expectedTarget = threadTarget || explicitTarget;
  const expectedTargetKind = threadTarget ? "thread" : "explicit";
  return Boolean(expectedTarget)
    && authority.target === expectedTarget
    && authority.targetKind === expectedTargetKind;
}

async function hasHostedWhatsAppUsageNoticeAuthorityTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  target: string;
}): Promise<boolean> {
  const identities = await input.prisma.$queryRaw<Array<{
    phoneLookupKey: string | null;
    phoneNumberVerifiedAt: Date | null;
  }>>`
    SELECT
      phone_lookup_key AS "phoneLookupKey",
      phone_number_verified_at AS "phoneNumberVerifiedAt"
    FROM hosted_member_identity
    WHERE member_id = ${input.memberId}
    FOR UPDATE
  `;
  const lookupKeys = new Set(createHostedPhoneLookupKeyReadCandidates(input.target));
  const identity = identities[0];
  if (
    !identity?.phoneLookupKey
    || !identity.phoneNumberVerifiedAt
    || !lookupKeys.has(identity.phoneLookupKey)
  ) {
    return false;
  }

  await input.prisma.$queryRaw`
    SELECT member_id
    FROM hosted_consent_grant
    WHERE member_id = ${input.memberId}
      AND scope = 'feature.whatsapp-messaging'
    FOR UPDATE
  `;
  return await readHostedWhatsAppMessagingConsentGrantedTx({
    memberId: input.memberId,
    prisma: input.prisma,
  });
}

async function hasHostedTelegramUsageNoticeAuthorityTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  target: string;
}): Promise<boolean> {
  const rows = await input.prisma.$queryRaw<Array<{ memberId: string }>>`
    SELECT member_id AS "memberId"
    FROM hosted_member_routing
    WHERE member_id = ${input.memberId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    return false;
  }
  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  return routing?.telegramThreadId === input.target;
}

async function hasHostedGroupEmailUsageNoticeAuthorityTx(input: {
  actorMemberId: string | null;
  groupId: string | null;
  memberId: string;
  prisma: Prisma.TransactionClient;
  target: string;
}): Promise<boolean> {
  const actorMemberId = input.actorMemberId?.trim() ?? "";
  const groupId = input.groupId?.trim() ?? "";
  const target = normalizeHostedEmailAddress(input.target);
  if (!actorMemberId || !groupId || !target) {
    return false;
  }

  const memberIds = [input.memberId, actorMemberId].sort();
  for (const memberId of memberIds) {
    await lockHostedMemberRow(input.prisma, memberId);
  }
  const groups = await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_group
    WHERE id = ${groupId}
      AND runtime_member_id = ${input.memberId}
    FOR UPDATE
  `;
  const memberships = await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_group_member
    WHERE group_id = ${groupId}
      AND member_id = ${actorMemberId}
    FOR UPDATE
  `;
  const grants = await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_vault_share
    WHERE destination_member_id = ${input.memberId}
      AND grantor_member_id = ${actorMemberId}
      AND projection_kind = 'group-email.v0'
      AND status = 'granted'
    FOR UPDATE
  `;
  await input.prisma.$queryRaw`
    SELECT member_id
    FROM hosted_member_email_authorization
    WHERE member_id = ${actorMemberId}
    FOR UPDATE
  `;
  if (groups.length !== 1 || memberships.length !== 1 || grants.length !== 1) {
    return false;
  }
  if (!await hasHostedUsageNoticeMemberResponseAuthorityTx({
    memberId: input.memberId,
    prisma: input.prisma,
  })) {
    return false;
  }
  if (!await hasHostedUsageNoticeMemberActiveAccessTx({
    memberId: actorMemberId,
    prisma: input.prisma,
  })) {
    return false;
  }

  const authorization = await readHostedMemberEmailAuthorization({
    memberId: actorMemberId,
    prisma: input.prisma,
  });
  return normalizeHostedEmailAddress(
    authorization?.verifiedEmail?.address,
  ) === target;
}

async function lockHostedUsageNoticeMemberAccessRowsTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await lockHostedMemberRow(input.prisma, input.memberId);
  await lockHostedUsageNoticePersonSponsorshipRowsTx(input);

  const containers = await input.prisma.$queryRaw<Array<{ ownerMemberId: string }>>`
    SELECT owner_member_id AS "ownerMemberId"
    FROM hosted_thread_container
    WHERE member_id = ${input.memberId}
    FOR UPDATE
  `;
  const ownerMemberId = containers[0]?.ownerMemberId ?? null;
  if (ownerMemberId) {
    await lockHostedMemberRow(input.prisma, ownerMemberId);
    await lockHostedUsageNoticePersonSponsorshipRowsTx({
      memberId: ownerMemberId,
      prisma: input.prisma,
    });
  }

  const participants = await input.prisma.$queryRaw<Array<{ participantMemberId: string }>>`
    SELECT participant_member_id AS "participantMemberId"
    FROM hosted_thread_container_participant
    WHERE container_member_id = ${input.memberId}
      AND removed_at IS NULL
    ORDER BY participant_member_id
    FOR UPDATE
  `;
  for (const participant of participants) {
    await lockHostedMemberRow(input.prisma, participant.participantMemberId);
    await lockHostedUsageNoticePersonSponsorshipRowsTx({
      memberId: participant.participantMemberId,
      prisma: input.prisma,
    });
  }
}

async function lockHostedUsageNoticePersonSponsorshipRowsTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await input.prisma.$queryRaw`
    SELECT membership.id
    FROM hosted_account_group_membership AS membership
    JOIN hosted_account_group AS account_group
      ON account_group.id = membership.group_id
    WHERE membership.member_id = ${input.memberId}
    ORDER BY membership.id
    FOR UPDATE OF membership, account_group
  `;
}

async function readHostedUsageNoticeSourceWake(input: {
  memberId: string;
  prisma: PrismaClient;
  sourceEventId: string;
}): Promise<HostedExecutionWake | null> {
  const item = await readHostedMailboxItemByDedupeKey({
    dedupeKey: input.sourceEventId,
    prisma: input.prisma,
    userId: input.memberId,
  });
  if (!item || item.kind !== "conversation.message") {
    return null;
  }
  const payload = item.payloadRef
    ? await readHostedMailboxPayload({
        dedupeKey: item.dedupeKey,
        mailboxItemId: item.id,
        payloadRef: item.payloadRef,
        prisma: input.prisma,
        userId: item.userId,
      })
    : null;
  const decoded = await decodeHostedMailboxStoredPayload({
    dedupeKey: item.dedupeKey,
    kind: item.kind,
    lane: item.lane,
    laneSeq: item.laneSeq,
    mailboxItemId: item.id,
    occurredAt: item.occurredAt,
    payloadCiphertext: payload?.payloadCiphertext ?? null,
    payloadInlineCiphertext: item.payloadInlineCiphertext,
    payloadSchema: item.payloadSchema,
    prisma: input.prisma,
    userId: item.userId,
  });
  if (!decoded) {
    return null;
  }
  const wake = parseHostedExecutionWake(decoded);
  return wake.eventId === input.sourceEventId && wake.userId === input.memberId
    ? wake
    : null;
}
