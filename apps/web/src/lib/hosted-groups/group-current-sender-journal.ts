import "server-only";

import { createHash } from "node:crypto";

import { type Prisma } from "@prisma/client";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionGroupJournalFactRecordedWake,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionAssistantAskAcceptedInputOrigin,
  HostedExecutionGroupJournalFactPayload,
} from "@murphai/hosted-execution/contracts";
import type { HostedRuntimeGroupJournalActionResult } from "@murphai/hosted-execution/runtime-control";

import { appendHostedMailboxEnvelopeWithIdentityTx } from "../hosted-mailbox/store";
import { resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { getPrisma } from "../prisma";
import { readHostedGroupCurrentSenderAuthorityTx } from "./group-current-sender-assistant-ask";

const GROUP_JOURNAL_ID_NAMESPACE = "murph.hosted-group-journal.v1";
const GROUP_JOURNAL_PRIVATE_QUESTION_INSTRUCTIONS =
  "This is one private question about the member's Journal. Keep it private and use the required response text.";

interface GroupJournalPrismaClient {
  $transaction<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
}

export interface HostedGroupJournalAdmission {
  mailboxWake: {
    expectedUserId: string;
    mailboxItemId: string;
  } | null;
  result: HostedRuntimeGroupJournalActionResult;
}

export async function recordHostedGroupCurrentSenderJournalFact(input: {
  confidence: "high" | "medium";
  groupRuntimeMemberId: string;
  journalFact: HostedExecutionGroupJournalFactPayload;
  now?: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  prisma?: GroupJournalPrismaClient;
  privateQuestion: string;
}): Promise<HostedGroupJournalAdmission> {
  const prisma: GroupJournalPrismaClient = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const authority = await readHostedGroupCurrentSenderAuthorityTx({
      expectedGroupRuntimeMemberId: input.groupRuntimeMemberId,
      now,
      origin: input.origin,
      tx,
    });
    if (!authority) {
      return unavailableAdmission("current_sender_unavailable");
    }
    const state = await readGroupJournalCaptureStateTx({
      groupRuntimeMemberId: input.groupRuntimeMemberId,
      memberId: authority.targetMemberId,
      tx,
    });
    if (!state) {
      return unavailableAdmission("membership_unavailable");
    }
    if (
      state.groupJournalCaptureEnabled === false ||
      state.journalCaptureDisabledAt !== null
    ) {
      return handledAdmission();
    }

    if (state.groupJournalCaptureEnabled === null) {
      if (input.confidence === "medium") {
        return handledAdmission();
      }
      if (state.groupJournalCaptureConsentRequestedAt !== null) {
        return handledAdmission();
      }
      const admission = await appendPrivateQuestionTx({
        authority,
        factIndex: input.journalFact.factIndex,
        kind: "consent",
        now,
        originAssistantInputId: input.origin.assistantInputId,
        question: input.privateQuestion,
        tx,
      });
      if (admission.result.status === "handled") {
        await tx.hostedMember.update({
          data: { groupJournalCaptureConsentRequestedAt: now },
          where: { id: authority.targetMemberId },
        });
      }
      return admission;
    }

    if (input.confidence === "medium") {
      return appendPrivateQuestionTx({
        authority,
        factIndex: input.journalFact.factIndex,
        kind: "clarification",
        now,
        originAssistantInputId: input.origin.assistantInputId,
        question: input.privateQuestion,
        tx,
      });
    }

    const eventId = createGroupJournalId({
      factIndex: input.journalFact.factIndex,
      identityScope: input.groupRuntimeMemberId,
      kind: "fact",
      originAssistantInputId: input.origin.assistantInputId,
    });
    const wake = buildHostedExecutionGroupJournalFactRecordedWake({
      eventId,
      journalFact: input.journalFact,
      memberId: authority.targetMemberId,
      occurredAt: authority.occurredAt,
    });
    const append = await appendHostedMailboxEnvelopeWithIdentityTx({
      envelope: wake,
      expiresAt: null,
      itemId: eventId,
      tx,
    });
    if (append.dedupeConflict || append.item.id !== eventId) {
      return unavailableAdmission("journal_fact_conflict");
    }
    return handledAdmission({
      expectedUserId: authority.targetMemberId,
      mailboxItemId: eventId,
    });
  });
}

export async function setHostedMemberGroupJournalCapture(input: {
  enabled: boolean;
  memberId: string;
  prisma?: GroupJournalPrismaClient;
}): Promise<
  | { enabled: boolean; status: "updated" }
  | { status: "unavailable"; unavailableReason: string }
> {
  const prisma: GroupJournalPrismaClient = input.prisma ?? getPrisma();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.hostedMember.updateMany({
      data: { groupJournalCaptureEnabled: input.enabled },
      where: { id: input.memberId, suspendedAt: null },
    });
    return updated.count === 1
      ? { enabled: input.enabled, status: "updated" }
      : { status: "unavailable", unavailableReason: "member_unavailable" };
  });
}

export async function setHostedGroupCurrentSenderJournalCapture(input: {
  enabled: boolean;
  groupRuntimeMemberId: string;
  now?: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  prisma?: GroupJournalPrismaClient;
  scope: "global" | "group";
}): Promise<HostedGroupJournalAdmission> {
  const prisma: GroupJournalPrismaClient = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const authority = await readHostedGroupCurrentSenderAuthorityTx({
      expectedGroupRuntimeMemberId: input.groupRuntimeMemberId,
      now,
      origin: input.origin,
      tx,
    });
    if (!authority) {
      return unavailableAdmission("current_sender_unavailable");
    }
    if (input.scope === "global") {
      const updated = await tx.hostedMember.updateMany({
        data: { groupJournalCaptureEnabled: input.enabled },
        where: { id: authority.targetMemberId, suspendedAt: null },
      });
      return updated.count === 1
        ? handledAdmission()
        : unavailableAdmission("member_unavailable");
    }
    const group = await tx.hostedGroup.findUnique({
      select: { id: true },
      where: { runtimeMemberId: input.groupRuntimeMemberId },
    });
    if (!group) {
      return unavailableAdmission("membership_unavailable");
    }
    const updated = await tx.hostedGroupMember.updateMany({
      data: { journalCaptureDisabledAt: input.enabled ? null : now },
      where: { groupId: group.id, memberId: authority.targetMemberId },
    });
    return updated.count === 1
      ? handledAdmission()
      : unavailableAdmission("membership_unavailable");
  });
}

async function readGroupJournalCaptureStateTx(input: {
  groupRuntimeMemberId: string;
  memberId: string;
  tx: Prisma.TransactionClient;
}) {
  return input.tx.hostedGroupMember
    .findFirst({
      select: {
        journalCaptureDisabledAt: true,
        member: {
          select: {
            groupJournalCaptureConsentRequestedAt: true,
            groupJournalCaptureEnabled: true,
          },
        },
      },
      where: {
        group: { runtimeMemberId: input.groupRuntimeMemberId },
        memberId: input.memberId,
      },
    })
    .then((membership) =>
      membership
        ? {
            groupJournalCaptureConsentRequestedAt:
              membership.member.groupJournalCaptureConsentRequestedAt,
            groupJournalCaptureEnabled:
              membership.member.groupJournalCaptureEnabled,
            journalCaptureDisabledAt: membership.journalCaptureDisabledAt,
          }
        : null,
    );
}

async function appendPrivateQuestionTx(input: {
  authority: {
    sourceChannel: "linq" | "telegram";
    targetMemberId: string;
  };
  factIndex: number;
  kind: "clarification" | "consent";
  now: Date;
  originAssistantInputId: string;
  question: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJournalAdmission> {
  const destination = await resolveHostedAssistantNotificationDestination({
    directChannel: input.authority.sourceChannel,
    memberId: input.authority.targetMemberId,
    prisma: input.tx,
  });
  if (
    !destination ||
    destination.conversationShape !== "direct-member" ||
    destination.externalThreadRouteAuthority !== null ||
    destination.route.channel !== input.authority.sourceChannel ||
    destination.route.delivery.kind !== "thread" ||
    destination.route.threadIsDirect !== true
  ) {
    return unavailableAdmission("private_route_unavailable");
  }
  const eventId = createGroupJournalId({
    factIndex: input.factIndex,
    identityScope: input.authority.targetMemberId,
    kind: input.kind,
    originAssistantInputId: input.originAssistantInputId,
  });
  const wake = buildHostedExecutionAssistantNotificationRequestedWake({
    eventId,
    memberId: input.authority.targetMemberId,
    notification: {
      deliveryDedupeToken: eventId,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: eventId,
      externalThreadRouteAuthority: null,
      instructions: GROUP_JOURNAL_PRIVATE_QUESTION_INSTRUCTIONS,
      responsePolicy: {
        kind: "require_send_exact_text",
        text: input.question,
      },
      route: destination.route,
    },
    occurredAt: input.now.toISOString(),
  });
  const append = await appendHostedMailboxEnvelopeWithIdentityTx({
    envelope: wake,
    expiresAt: null,
    itemId: eventId,
    tx: input.tx,
  });
  if (append.dedupeConflict || append.item.id !== eventId) {
    return unavailableAdmission("private_question_conflict");
  }
  return handledAdmission({
    expectedUserId: input.authority.targetMemberId,
    mailboxItemId: eventId,
  });
}

function createGroupJournalId(input: {
  factIndex: number;
  identityScope: string;
  kind: "clarification" | "consent" | "fact";
  originAssistantInputId: string;
}): string {
  const digest = createHash("sha256")
    .update(GROUP_JOURNAL_ID_NAMESPACE)
    .update("\0")
    .update(input.identityScope)
    .update("\0")
    .update(input.originAssistantInputId)
    .update("\0")
    .update(String(input.factIndex))
    .update("\0")
    .update(input.kind)
    .digest("hex");
  return `group_journal_${digest}`;
}

function handledAdmission(
  mailboxWake: HostedGroupJournalAdmission["mailboxWake"] = null,
): HostedGroupJournalAdmission {
  return { mailboxWake, result: { status: "handled" } };
}

function unavailableAdmission(
  unavailableReason: string,
): HostedGroupJournalAdmission {
  return {
    mailboxWake: null,
    result: { status: "unavailable", unavailableReason },
  };
}
