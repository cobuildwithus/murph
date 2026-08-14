import "server-only";

import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionAssistantAskRequestedWake,
  buildHostedExecutionAssistantNotificationRequestedWake,
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_ANSWER_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_PERMISSION_TEXT_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  isHostedExecutionAssistantAskRequestedWake,
  readHostedExecutionConversationMessageText,
  type HostedExecutionAssistantAskAcceptedInputOrigin,
  type HostedExecutionAssistantAskResult,
  type HostedExecutionAssistantNotificationRoute,
  type HostedExecutionConversationMessageWake,
  type HostedExecutionExternalThreadRouteAuthority,
  type HostedExecutionPrivateAssistantAskCompletionDeliveryAuthority,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRuntimeGroupCurrentSenderMessageResult,
  HostedRuntimeGroupMemberAskResult,
} from "@murphai/hosted-execution/runtime-control";

import {
  appendHostedMailboxEnvelopeWithIdentityTx,
  readHostedMailboxConversationWakeByAssistantInputId,
  readHostedMailboxItemById,
  readHostedMailboxWakeByItemId,
} from "../hosted-mailbox/store";
import {
  requireHostedRuntimeActiveAccessForUpdateTx,
} from "../hosted-mailbox/runtime-access";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import {
  resolveHostedAssistantNotificationDestination,
} from "../hosted-routing/assistant-notification-destination";
import {
  assertHostedThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";
import { getPrisma } from "../prisma";
import {
  resolveHostedGroupMessageSenderMemberId,
} from "./group-message-sender";

const HOSTED_GROUP_CURRENT_SENDER_ASSISTANT_ASK_REQUEST_ID_NAMESPACE =
  "murph.hosted-group-current-sender-assistant-ask.request.v1";
const HOSTED_GROUP_CURRENT_SENDER_PRIVATE_ASSISTANT_ASK_REQUEST_ID_NAMESPACE =
  "murph.hosted-group-current-sender-private-assistant-ask.request.v1";
const HOSTED_GROUP_CURRENT_SENDER_PRIVATE_NOTIFICATION_INSTRUCTIONS =
  "Private current-sender Assistant Ask completion; exact reviewed text is in responsePolicy.";
const HOSTED_GROUP_CURRENT_SENDER_PRIVATE_UNAVAILABLE_TEXT =
  "I don't have enough context to answer that privately yet.";
const HOSTED_ASSISTANT_ASK_ADVISORY_LOCK_NAMESPACE = "hosted-assistant-ask";
const HOSTED_ASSISTANT_ASK_OPAQUE_ID_MAX_CODE_POINTS = 256;
const HOSTED_EXECUTION_ASSISTANT_INPUT_ID_PATTERN = /^ain_[0-9a-f]{32}$/u;

export const HOSTED_GROUP_CURRENT_SENDER_DISCLOSURE_PERMISSION_TEXT =
  "The owner of this personal Murph authored the exact incoming group question and may authorize one answer to that same group. Answer only when that question clearly asks Murph to share information about the owner. Treat first-person references as the owner, disclose only the owner's information directly requested by the question, and disclose nothing about anyone else. This authorization applies once to this question and grants no future, scheduled, or broader access.";

export const HOSTED_GROUP_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT =
  "The owner of this personal Murph authored the exact incoming group request and explicitly asked Murph to answer them privately. Answer as one direct private message to the owner. You may use only the owner's personal Murph context needed for this request. Do not disclose anyone else's private information, do not post anything back to the group, and do not perform actions. This authorization applies once to this request and grants no future, scheduled, or broader access.";

for (const [label, permissionText] of [
  [
    "Hosted current-sender disclosure permission",
    HOSTED_GROUP_CURRENT_SENDER_DISCLOSURE_PERMISSION_TEXT,
  ],
  [
    "Hosted current-sender private permission",
    HOSTED_GROUP_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
  ],
] as const) {
  if (
    [...permissionText].length
      > HOSTED_EXECUTION_ASSISTANT_ASK_PERMISSION_TEXT_MAX_CODE_POINTS
  ) {
    throw new TypeError(`${label} is too long.`);
  }
}

type HostedCurrentSenderAssistantAskPrismaClient = Pick<PrismaClient, "$transaction">;

export type HostedGroupCurrentSenderSourceChannel = "linq" | "telegram";

export interface HostedGroupCurrentSenderAuthority {
  groupRuntimeMemberId: string;
  messageText: string | null;
  occurredAt: string;
  sourceChannel: HostedGroupCurrentSenderSourceChannel;
  targetMemberId: string;
}

type HostedGroupCurrentSenderQuestionAuthority =
  Omit<HostedGroupCurrentSenderAuthority, "messageText"> & {
    question: string;
  };

export type HostedGroupCurrentSenderAssistantAskAuthority =
  HostedGroupCurrentSenderQuestionAuthority & {
    permissionDigest: string;
    permissionText: string;
  };

export type HostedGroupCurrentSenderPrivateAssistantAskAuthority =
  HostedGroupCurrentSenderQuestionAuthority & {
    permissionDigest: string;
    permissionText: string;
  };

export type HostedGroupCurrentSenderPrivateCompletionAuthority =
  HostedGroupCurrentSenderPrivateAssistantAskAuthority & {
    expiresAt: string;
    origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  };

export interface HostedGroupCurrentSenderAssistantAskAdmission {
  mailboxWake: {
    expectedUserId: string;
    mailboxItemId: string;
  } | null;
  result: HostedRuntimeGroupMemberAskResult;
}

export interface HostedGroupCurrentSenderPrivateAssistantAskAdmission {
  mailboxWake: {
    expectedUserId: string;
    mailboxItemId: string;
  } | null;
  result: HostedRuntimeGroupCurrentSenderMessageResult;
}

export function createHostedGroupCurrentSenderAssistantAskRequestId(input: {
  groupRuntimeMemberId: string;
  originAssistantInputId: string;
}): string {
  const groupRuntimeMemberId = normalizeHostedCurrentSenderOpaqueId(
    input.groupRuntimeMemberId,
    "Hosted current-sender group runtime member ID",
  );
  const originAssistantInputId = normalizeHostedCurrentSenderAssistantInputId(
    input.originAssistantInputId,
  );
  return `aask_req_${createHash("sha256")
    .update(HOSTED_GROUP_CURRENT_SENDER_ASSISTANT_ASK_REQUEST_ID_NAMESPACE)
    .update("\0")
    .update(groupRuntimeMemberId)
    .update("\0")
    .update(originAssistantInputId)
    .update("\0")
    .update(createHostedGroupCurrentSenderPermissionDigest())
    .digest("hex")}`;
}

export function createHostedGroupCurrentSenderPrivateAssistantAskRequestId(input: {
  groupRuntimeMemberId: string;
  originAssistantInputId: string;
}): string {
  const groupRuntimeMemberId = normalizeHostedCurrentSenderOpaqueId(
    input.groupRuntimeMemberId,
    "Hosted current-sender group runtime member ID",
  );
  const originAssistantInputId = normalizeHostedCurrentSenderAssistantInputId(
    input.originAssistantInputId,
  );
  return `aask_req_${createHash("sha256")
    .update(HOSTED_GROUP_CURRENT_SENDER_PRIVATE_ASSISTANT_ASK_REQUEST_ID_NAMESPACE)
    .update("\0")
    .update(groupRuntimeMemberId)
    .update("\0")
    .update(originAssistantInputId)
    .update("\0")
    .update(createHostedGroupCurrentSenderPrivatePermissionDigest())
    .digest("hex")}`;
}

export async function requestHostedGroupCurrentSenderAssistantAsk(input: {
  groupRuntimeMemberId: string;
  now?: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  prisma?: HostedCurrentSenderAssistantAskPrismaClient;
}): Promise<HostedGroupCurrentSenderAssistantAskAdmission> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const groupRuntimeMemberId = normalizeHostedCurrentSenderOpaqueId(
    input.groupRuntimeMemberId,
    "Hosted current-sender group runtime member ID",
  );
  const origin = normalizeHostedCurrentSenderOrigin(input.origin);
  const requestId = createHostedGroupCurrentSenderAssistantAskRequestId({
    groupRuntimeMemberId,
    originAssistantInputId: origin.assistantInputId,
  });

  return prisma.$transaction(async (tx) => {
    await acquireHostedCurrentSenderAssistantAskLockTx(tx, requestId);
    const existing = await readHostedMailboxItemById({
      mailboxItemId: requestId,
      prisma: tx,
    });
    if (existing) {
      return replayHostedGroupCurrentSenderAssistantAskTx({
        existingDedupeKey: existing.dedupeKey,
        existingKind: existing.kind,
        existingUserId: existing.userId,
        expiresAt: existing.expiresAt ?? null,
        groupRuntimeMemberId,
        now,
        origin,
        requestId,
        tx,
      });
    }

    const authority = await readHostedGroupCurrentSenderAssistantAskAuthorityTx({
      expectedGroupRuntimeMemberId: groupRuntimeMemberId,
      now,
      origin,
      tx,
    });
    if (!authority) {
      return unavailableHostedCurrentSenderAdmission("current_sender_unavailable");
    }

    const occurredAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
    ).toISOString();
    const wake = buildHostedExecutionAssistantAskRequestedWake({
      ask: {
        expiresAt,
        origin,
        question: authority.question,
        target: {
          groupRuntimeMemberId,
          kind: "group_sender",
          permissionDigest: authority.permissionDigest,
        },
      },
      eventId: requestId,
      memberId: authority.targetMemberId,
      occurredAt,
    });
    const append = await appendHostedMailboxEnvelopeWithIdentityTx({
      envelope: wake,
      expiresAt,
      itemId: requestId,
      tx,
    });
    if (append.dedupeConflict || append.item.id !== requestId) {
      return unavailableHostedCurrentSenderAdmission("request_conflict");
    }
    return {
      mailboxWake: {
        expectedUserId: authority.targetMemberId,
        mailboxItemId: requestId,
      },
      result: { status: "accepted" },
    };
  });
}

export async function requestHostedGroupCurrentSenderPrivateAssistantAsk(input: {
  groupRuntimeMemberId: string;
  now?: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  prisma?: HostedCurrentSenderAssistantAskPrismaClient;
}): Promise<HostedGroupCurrentSenderPrivateAssistantAskAdmission> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const groupRuntimeMemberId = normalizeHostedCurrentSenderOpaqueId(
    input.groupRuntimeMemberId,
    "Hosted current-sender group runtime member ID",
  );
  const origin = normalizeHostedCurrentSenderOrigin(input.origin);
  const requestId = createHostedGroupCurrentSenderPrivateAssistantAskRequestId({
    groupRuntimeMemberId,
    originAssistantInputId: origin.assistantInputId,
  });

  return prisma.$transaction(async (tx) => {
    await acquireHostedCurrentSenderAssistantAskLockTx(tx, requestId);
    const existing = await readHostedMailboxItemById({
      mailboxItemId: requestId,
      prisma: tx,
    });
    if (existing) {
      return replayHostedGroupCurrentSenderPrivateAssistantAskTx({
        existingDedupeKey: existing.dedupeKey,
        existingKind: existing.kind,
        existingUserId: existing.userId,
        expiresAt: existing.expiresAt ?? null,
        groupRuntimeMemberId,
        now,
        origin,
        requestId,
        tx,
      });
    }

    const authority =
      await readHostedGroupCurrentSenderPrivateAssistantAskAuthorityTx({
        expectedGroupRuntimeMemberId: groupRuntimeMemberId,
        now,
        origin,
        tx,
      });
    if (!authority) {
      return unavailableHostedCurrentSenderPrivateAdmission(
        "current_sender_unavailable",
      );
    }
    const destination = await resolveHostedGroupCurrentSenderPrivateDestination({
      authority,
      tx,
    });
    if (!destination) {
      return unavailableHostedCurrentSenderPrivateAdmission(
        "same_channel_direct_route_unavailable",
      );
    }

    const occurredAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
    ).toISOString();
    const wake = buildHostedExecutionAssistantAskRequestedWake({
      ask: {
        expiresAt,
        origin,
        question: authority.question,
        target: {
          groupRuntimeMemberId,
          kind: "group_sender_private",
          permissionDigest: authority.permissionDigest,
        },
      },
      eventId: requestId,
      memberId: authority.targetMemberId,
      occurredAt,
    });
    const append = await appendHostedMailboxEnvelopeWithIdentityTx({
      envelope: wake,
      expiresAt,
      itemId: requestId,
      tx,
    });
    if (append.dedupeConflict || append.item.id !== requestId) {
      return unavailableHostedCurrentSenderPrivateAdmission("request_conflict");
    }
    return {
      mailboxWake: {
        expectedUserId: authority.targetMemberId,
        mailboxItemId: requestId,
      },
      result: { status: "accepted" },
    };
  });
}

type HostedGroupCurrentSenderAuthorityReadInput = {
  expectedGroupRuntimeMemberId: string;
  expectedTargetMemberId?: string | null;
  now: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  tx: Prisma.TransactionClient;
};

export async function readHostedGroupCurrentSenderAuthorityTx(
  input: HostedGroupCurrentSenderAuthorityReadInput,
): Promise<HostedGroupCurrentSenderAuthority | null> {
  const groupRuntimeMemberId = normalizeHostedCurrentSenderOpaqueId(
    input.expectedGroupRuntimeMemberId,
    "Hosted current-sender group runtime member ID",
  );
  const origin = normalizeHostedCurrentSenderOrigin(input.origin);
  const groupContainer = await input.tx.hostedThreadContainer.findUnique({
    select: { memberId: true },
    where: { memberId: groupRuntimeMemberId },
  });
  if (
    !groupContainer
    || !await hasHostedCurrentSenderRuntimeAccessForUpdateTx({
      memberId: groupRuntimeMemberId,
      tx: input.tx,
    })
  ) {
    return null;
  }

  const sourceWake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: origin.assistantInputId,
    availableAt: input.now,
    memberId: groupRuntimeMemberId,
    prisma: input.tx,
  });
  const source = sourceWake
    ? readHostedCurrentSenderSource(sourceWake, groupRuntimeMemberId)
    : null;
  if (!source || !sourceWake) {
    return null;
  }
  try {
    await assertHostedThreadRouteEgressAuthority({
      authority: source.routeAuthority,
      prisma: input.tx,
    });
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED"
      && !error.retryable
    ) {
      return null;
    }
    throw error;
  }

  const senderMemberId = await resolveHostedGroupMessageSenderMemberId({
    prisma: input.tx,
    routeAuthority: source.routeAuthority,
    wake: sourceWake,
  });
  if (!senderMemberId) {
    return null;
  }
  const expectedTargetMemberId = input.expectedTargetMemberId == null
    ? null
    : normalizeHostedCurrentSenderOpaqueId(
        input.expectedTargetMemberId,
        "Hosted current-sender target member ID",
      );
  if (
    expectedTargetMemberId !== null
    && senderMemberId !== expectedTargetMemberId
  ) {
    return null;
  }
  const targetContainer = await input.tx.hostedThreadContainer.findUnique({
    select: { memberId: true },
    where: { memberId: senderMemberId },
  });
  if (
    targetContainer
    || !await hasHostedCurrentSenderRuntimeAccessForUpdateTx({
      memberId: senderMemberId,
      tx: input.tx,
    })
  ) {
    return null;
  }

  return {
    groupRuntimeMemberId,
    messageText: source.messageText,
    occurredAt: sourceWake.occurredAt,
    sourceChannel: source.sourceChannel,
    targetMemberId: senderMemberId,
  };
}

export async function readHostedGroupCurrentSenderAssistantAskAuthorityTx(
  input: HostedGroupCurrentSenderAuthorityReadInput,
): Promise<HostedGroupCurrentSenderAssistantAskAuthority | null> {
  const authority = await readHostedGroupCurrentSenderAuthorityTx(input);
  const question = authority
    ? readHostedCurrentSenderQuestion(authority.messageText)
    : null;
  return authority && question
    ? {
        ...hostedCurrentSenderQuestionAuthority(authority, question),
        permissionDigest: createHostedGroupCurrentSenderPermissionDigest(),
        permissionText: HOSTED_GROUP_CURRENT_SENDER_DISCLOSURE_PERMISSION_TEXT,
      }
    : null;
}

export async function readHostedGroupCurrentSenderPrivateAssistantAskAuthorityTx(
  input: HostedGroupCurrentSenderAuthorityReadInput,
): Promise<HostedGroupCurrentSenderPrivateAssistantAskAuthority | null> {
  const authority = await readHostedGroupCurrentSenderAuthorityTx(input);
  const question = authority
    ? readHostedCurrentSenderQuestion(authority.messageText)
    : null;
  return authority && question
    ? {
        ...hostedCurrentSenderQuestionAuthority(authority, question),
        permissionDigest:
          createHostedGroupCurrentSenderPrivatePermissionDigest(),
        permissionText: HOSTED_GROUP_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
      }
    : null;
}

async function replayHostedGroupCurrentSenderAssistantAskTx(input: {
  existingDedupeKey: string;
  existingKind: string;
  existingUserId: string;
  expiresAt: string | null;
  groupRuntimeMemberId: string;
  now: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  requestId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupCurrentSenderAssistantAskAdmission> {
  if (isHostedCurrentSenderAssistantAskExpired(input.expiresAt, input.now)) {
    return unavailableHostedCurrentSenderAdmission("request_expired");
  }
  if (
    input.existingDedupeKey !== input.requestId
    || input.existingKind !== "assistant.ask.requested"
  ) {
    return unavailableHostedCurrentSenderAdmission("request_conflict");
  }
  const wake = await readHostedMailboxWakeByItemId({
    availableAt: input.now,
    mailboxItemId: input.requestId,
    prisma: input.tx,
  });
  if (
    !wake
    || !isHostedExecutionAssistantAskRequestedWake(wake)
    || wake.eventId !== input.requestId
    || wake.userId !== input.existingUserId
    || wake.ask.expiresAt !== input.expiresAt
    || !("origin" in wake.ask)
    || wake.ask.origin.kind !== "accepted_input"
    || wake.ask.target.kind !== "group_sender"
    || wake.ask.target.groupRuntimeMemberId !== input.groupRuntimeMemberId
    || wake.ask.target.permissionDigest
      !== createHostedGroupCurrentSenderPermissionDigest()
    || !hostedCurrentSenderOriginsEqual(wake.ask.origin, input.origin)
    || createHostedGroupCurrentSenderAssistantAskRequestId({
      groupRuntimeMemberId: input.groupRuntimeMemberId,
      originAssistantInputId: wake.ask.origin.assistantInputId,
    }) !== input.requestId
  ) {
    return unavailableHostedCurrentSenderAdmission("request_conflict");
  }
  const authority = await readHostedGroupCurrentSenderAssistantAskAuthorityTx({
    expectedGroupRuntimeMemberId: input.groupRuntimeMemberId,
    expectedTargetMemberId: input.existingUserId,
    now: input.now,
    origin: input.origin,
    tx: input.tx,
  });
  if (!authority || authority.question !== wake.ask.question) {
    return unavailableHostedCurrentSenderAdmission("current_sender_unavailable");
  }
  return {
    mailboxWake: {
      expectedUserId: input.existingUserId,
      mailboxItemId: input.requestId,
    },
    result: { status: "accepted" },
  };
}

async function replayHostedGroupCurrentSenderPrivateAssistantAskTx(input: {
  existingDedupeKey: string;
  existingKind: string;
  existingUserId: string;
  expiresAt: string | null;
  groupRuntimeMemberId: string;
  now: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  requestId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupCurrentSenderPrivateAssistantAskAdmission> {
  if (isHostedCurrentSenderAssistantAskExpired(input.expiresAt, input.now)) {
    return unavailableHostedCurrentSenderPrivateAdmission("request_expired");
  }
  if (
    input.existingDedupeKey !== input.requestId
    || input.existingKind !== "assistant.ask.requested"
  ) {
    return unavailableHostedCurrentSenderPrivateAdmission("request_conflict");
  }
  const wake = await readHostedMailboxWakeByItemId({
    availableAt: input.now,
    mailboxItemId: input.requestId,
    prisma: input.tx,
  });
  if (
    !wake
    || !isHostedExecutionAssistantAskRequestedWake(wake)
    || wake.eventId !== input.requestId
    || wake.userId !== input.existingUserId
    || wake.ask.expiresAt !== input.expiresAt
    || !("origin" in wake.ask)
    || wake.ask.origin.kind !== "accepted_input"
    || wake.ask.target.kind !== "group_sender_private"
    || wake.ask.target.groupRuntimeMemberId !== input.groupRuntimeMemberId
    || wake.ask.target.permissionDigest
      !== createHostedGroupCurrentSenderPrivatePermissionDigest()
    || !hostedCurrentSenderOriginsEqual(wake.ask.origin, input.origin)
    || createHostedGroupCurrentSenderPrivateAssistantAskRequestId({
      groupRuntimeMemberId: input.groupRuntimeMemberId,
      originAssistantInputId: wake.ask.origin.assistantInputId,
    }) !== input.requestId
  ) {
    return unavailableHostedCurrentSenderPrivateAdmission("request_conflict");
  }
  const authority =
    await readHostedGroupCurrentSenderPrivateAssistantAskAuthorityTx({
      expectedGroupRuntimeMemberId: input.groupRuntimeMemberId,
      expectedTargetMemberId: input.existingUserId,
      now: input.now,
      origin: input.origin,
      tx: input.tx,
    });
  if (!authority || authority.question !== wake.ask.question) {
    return unavailableHostedCurrentSenderPrivateAdmission(
      "current_sender_unavailable",
    );
  }
  const destination = await resolveHostedGroupCurrentSenderPrivateDestination({
    authority,
    tx: input.tx,
  });
  if (!destination) {
    return unavailableHostedCurrentSenderPrivateAdmission(
      "same_channel_direct_route_unavailable",
    );
  }
  return {
    mailboxWake: {
      expectedUserId: input.existingUserId,
      mailboxItemId: input.requestId,
    },
    result: { status: "accepted" },
  };
}

export async function readHostedGroupCurrentSenderPrivateCompletionMailboxWakeTx(
  input: {
    authority: HostedGroupCurrentSenderPrivateCompletionAuthority;
    completionId: string;
    existingCompletion: {
      dedupeKey: string;
      expiresAt: string | null;
      kind: string;
      userId: string;
    };
    now: Date;
    tx: Prisma.TransactionClient;
  },
): Promise<{
  expectedUserId: string;
  mailboxItemId: string;
} | null> {
  if (
    input.existingCompletion.dedupeKey !== input.completionId
    || input.existingCompletion.expiresAt !== input.authority.expiresAt
    || input.existingCompletion.kind !== "assistant.notification.requested"
    || input.existingCompletion.userId !== input.authority.targetMemberId
  ) {
    return null;
  }
  const destination = await resolveHostedGroupCurrentSenderPrivateDestination({
    authority: input.authority,
    tx: input.tx,
  });
  if (!destination) {
    return null;
  }
  const wake = await readHostedMailboxWakeByItemId({
    availableAt: input.now,
    mailboxItemId: input.completionId,
    prisma: input.tx,
  });
  const responsePolicy = wake?.kind === "assistant.notification.requested"
    ? wake.notification.responsePolicy
    : null;
  const responseText =
    responsePolicy?.kind === "require_send_exact_text"
      ? responsePolicy.text.trim()
      : "";
  const notification = wake?.kind === "assistant.notification.requested"
    ? wake.notification
    : null;
  const privateCompletion = notification?.privateAssistantAskCompletion;
  const deliveryKey = createHostedGroupCurrentSenderPrivateDeliveryKey(
    input.completionId,
  );
  const requestId =
    createHostedGroupCurrentSenderPrivateAssistantAskRequestId({
      groupRuntimeMemberId: input.authority.groupRuntimeMemberId,
      originAssistantInputId: input.authority.origin.assistantInputId,
    });
  if (
    !wake
    || wake.kind !== "assistant.notification.requested"
    || wake.eventId !== input.completionId
    || wake.userId !== input.authority.targetMemberId
    || !notification
    || notification.deliveryDedupeToken !== deliveryKey
    || notification.deliveryDispatchMode !== "queue-only"
    || notification.deliveryIdempotencyKey !== deliveryKey
    || (notification.externalThreadRouteAuthority ?? null) !== null
    || (notification.firstContact ?? null) !== null
    || notification.instructions
      !== HOSTED_GROUP_CURRENT_SENDER_PRIVATE_NOTIFICATION_INSTRUCTIONS
    || (notification.notificationPromptProfile ?? null) !== null
    || !privateCompletion
    || privateCompletion.expiresAt !== input.authority.expiresAt
    || privateCompletion.requestId !== requestId
    || responsePolicy?.kind !== "require_send_exact_text"
    || responseText.length === 0
    || [...responseText].length
      > HOSTED_EXECUTION_ASSISTANT_ASK_ANSWER_MAX_CODE_POINTS
    || !hostedGroupCurrentSenderPrivateRoutesEqual(
      notification.route,
      destination.route,
    )
  ) {
    return null;
  }
  return {
    expectedUserId: input.authority.targetMemberId,
    mailboxItemId: input.completionId,
  };
}

export async function appendHostedGroupCurrentSenderPrivateCompletionTx(input: {
  authority: HostedGroupCurrentSenderPrivateCompletionAuthority;
  completionId: string;
  now: Date;
  result: HostedExecutionAssistantAskResult;
  tx: Prisma.TransactionClient;
}): Promise<{
  expectedUserId: string;
  mailboxItemId: string;
} | null> {
  const destination = await resolveHostedGroupCurrentSenderPrivateDestination({
    authority: input.authority,
    tx: input.tx,
  });
  if (!destination) {
    return null;
  }
  const deliveryKey = createHostedGroupCurrentSenderPrivateDeliveryKey(
    input.completionId,
  );
  const requestId =
    createHostedGroupCurrentSenderPrivateAssistantAskRequestId({
      groupRuntimeMemberId: input.authority.groupRuntimeMemberId,
      originAssistantInputId: input.authority.origin.assistantInputId,
    });
  const responseText = buildHostedGroupCurrentSenderPrivateResponseText(
    input.result,
  );
  const wake = buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: input.completionId,
    memberId: input.authority.targetMemberId,
    notification: {
      deliveryDedupeToken: deliveryKey,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: deliveryKey,
      externalThreadRouteAuthority: null,
      instructions:
        HOSTED_GROUP_CURRENT_SENDER_PRIVATE_NOTIFICATION_INSTRUCTIONS,
      privateAssistantAskCompletion: {
        expiresAt: input.authority.expiresAt,
        requestId,
      },
      responsePolicy: {
        kind: "require_send_exact_text",
        text: responseText,
      },
      route: destination.route,
    },
    occurredAt: input.now.toISOString(),
  });
  const append = await appendHostedMailboxEnvelopeWithIdentityTx({
    envelope: wake,
    expiresAt: input.authority.expiresAt,
    itemId: input.completionId,
    tx: input.tx,
  });
  if (append.dedupeConflict || append.item.id !== input.completionId) {
    return null;
  }
  return {
    expectedUserId: input.authority.targetMemberId,
    mailboxItemId: input.completionId,
  };
}

export async function assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx(
  input: HostedExecutionPrivateAssistantAskCompletionDeliveryAuthority & {
    boundRuntimeMemberId: string;
    now?: Date;
    tx: Prisma.TransactionClient;
  },
): Promise<void> {
  const completionId = input.answeredMailboxItemIds[0] ?? null;
  let expectedDeliveryKey: string;
  try {
    expectedDeliveryKey = completionId
      ? createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
          completionId,
        )
      : "";
  } catch {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }
  const now = input.now ?? new Date();
  const expiresAtMs = Date.parse(input.assistantAskCompletionExpiresAt);
  if (
    !completionId
    || input.answeredMailboxItemIds.length !== 1
    || completionId.trim() !== completionId
    || input.idempotencyKey !== expectedDeliveryKey
    || !Number.isFinite(expiresAtMs)
    || new Date(expiresAtMs).toISOString()
      !== input.assistantAskCompletionExpiresAt
    || expiresAtMs <= now.getTime()
    || !/^[0-9a-f]{64}$/u.test(input.responseTextDigest)
  ) {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }

  const completionItem = await readHostedMailboxItemById({
    mailboxItemId: completionId,
    prisma: input.tx,
  });
  if (
    !completionItem
    || completionItem.dedupeKey !== completionId
    || completionItem.expiresAt !== input.assistantAskCompletionExpiresAt
    || completionItem.kind !== "assistant.notification.requested"
    || completionItem.userId !== input.boundRuntimeMemberId
  ) {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }

  const completionWake = await readHostedMailboxWakeByItemId({
    availableAt: now,
    mailboxItemId: completionId,
    prisma: input.tx,
  });
  const notification = completionWake?.kind
      === "assistant.notification.requested"
    ? completionWake.notification
    : null;
  const responsePolicy = notification?.responsePolicy;
  const responseText = responsePolicy?.kind === "require_send_exact_text"
    ? responsePolicy.text
    : null;
  const privateCompletion = notification?.privateAssistantAskCompletion;
  if (
    !completionWake
    || completionWake.kind !== "assistant.notification.requested"
    || completionWake.eventId !== completionId
    || completionWake.userId !== input.boundRuntimeMemberId
    || !notification
    || notification.deliveryDedupeToken !== expectedDeliveryKey
    || notification.deliveryDispatchMode !== "queue-only"
    || notification.deliveryIdempotencyKey !== expectedDeliveryKey
    || (notification.externalThreadRouteAuthority ?? null) !== null
    || (notification.firstContact ?? null) !== null
    || notification.instructions
      !== HOSTED_GROUP_CURRENT_SENDER_PRIVATE_NOTIFICATION_INSTRUCTIONS
    || (notification.notificationPromptProfile ?? null) !== null
    || !privateCompletion
    || privateCompletion.expiresAt
      !== input.assistantAskCompletionExpiresAt
    || responsePolicy?.kind !== "require_send_exact_text"
    || responseText === null
    || responseText.trim().length === 0
    || [...responseText].length
      > HOSTED_EXECUTION_ASSISTANT_ASK_ANSWER_MAX_CODE_POINTS
    || createHash("sha256").update(responseText).digest("hex")
      !== input.responseTextDigest
    || !hostedGroupCurrentSenderPrivateRoutesEqual(
      notification.route,
      input.route,
    )
  ) {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }

  const requestItem = await readHostedMailboxItemById({
    mailboxItemId: privateCompletion.requestId,
    prisma: input.tx,
  });
  const requestWake = requestItem
    ? await readHostedMailboxWakeByItemId({
        availableAt: now,
        mailboxItemId: privateCompletion.requestId,
        prisma: input.tx,
      })
    : null;
  if (
    !requestItem
    || requestItem.dedupeKey !== privateCompletion.requestId
    || requestItem.expiresAt !== input.assistantAskCompletionExpiresAt
    || requestItem.kind !== "assistant.ask.requested"
    || requestItem.userId !== input.boundRuntimeMemberId
    || !requestWake
    || !isHostedExecutionAssistantAskRequestedWake(requestWake)
    || requestWake.eventId !== privateCompletion.requestId
    || requestWake.userId !== input.boundRuntimeMemberId
    || requestWake.ask.expiresAt !== input.assistantAskCompletionExpiresAt
    || !("origin" in requestWake.ask)
    || requestWake.ask.origin.kind !== "accepted_input"
    || requestWake.ask.target.kind !== "group_sender_private"
  ) {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }

  const expectedRequestId =
    createHostedGroupCurrentSenderPrivateAssistantAskRequestId({
      groupRuntimeMemberId: requestWake.ask.target.groupRuntimeMemberId,
      originAssistantInputId: requestWake.ask.origin.assistantInputId,
    });
  if (expectedRequestId !== privateCompletion.requestId) {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }
  const authority =
    await readHostedGroupCurrentSenderPrivateAssistantAskAuthorityTx({
      expectedGroupRuntimeMemberId:
        requestWake.ask.target.groupRuntimeMemberId,
      expectedTargetMemberId: input.boundRuntimeMemberId,
      now,
      origin: requestWake.ask.origin,
      tx: input.tx,
    });
  if (
    !authority
    || authority.permissionDigest !== requestWake.ask.target.permissionDigest
    || authority.question !== requestWake.ask.question
  ) {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }
  const destination = await resolveHostedGroupCurrentSenderPrivateDestination({
    authority,
    tx: input.tx,
  });
  if (
    !destination
    || !hostedGroupCurrentSenderPrivateRoutesEqual(
      destination.route,
      notification.route,
    )
    || !hostedGroupCurrentSenderPrivateRoutesEqual(
      destination.route,
      input.route,
    )
  ) {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }
}

export function buildHostedGroupCurrentSenderPrivateResponseText(
  result: HostedExecutionAssistantAskResult,
): string {
  const text = result.outcome === "answered"
    ? result.answer.trim()
    : result.answer?.trim()
      || HOSTED_GROUP_CURRENT_SENDER_PRIVATE_UNAVAILABLE_TEXT;
  if (
    !text
    || [...text].length > HOSTED_EXECUTION_ASSISTANT_ASK_ANSWER_MAX_CODE_POINTS
  ) {
    throw new TypeError(
      "Hosted current-sender private response is out of bounds.",
    );
  }
  return text;
}

async function resolveHostedGroupCurrentSenderPrivateDestination(input: {
  authority: Pick<
    HostedGroupCurrentSenderPrivateCompletionAuthority,
    "sourceChannel" | "targetMemberId"
  >;
  tx: Prisma.TransactionClient;
}): Promise<{
  route: HostedExecutionAssistantNotificationRoute;
} | null> {
  const destination = await resolveHostedAssistantNotificationDestination({
    directChannel: input.authority.sourceChannel,
    memberId: input.authority.targetMemberId,
    prisma: input.tx,
  });
  return (
    destination
    && destination.conversationShape === "direct-member"
    && destination.externalThreadRouteAuthority === null
    && destination.route.channel === input.authority.sourceChannel
    && destination.route.delivery.kind === "thread"
    && destination.route.threadIsDirect === true
  )
    ? { route: destination.route }
    : null;
}

function createHostedGroupCurrentSenderPrivateDeliveryKey(
  completionId: string,
): string {
  return createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
    normalizeHostedCurrentSenderOpaqueId(
      completionId,
      "Hosted current-sender private completion ID",
    ),
  );
}

function hostedGroupCurrentSenderPrivateRoutesEqual(
  actual: HostedExecutionAssistantNotificationRoute,
  expected: HostedExecutionAssistantNotificationRoute,
): boolean {
  return actual.actorId === expected.actorId
    && actual.channel === expected.channel
    && actual.delivery.kind === expected.delivery.kind
    && (actual.delivery.source?.fromPhoneNumber ?? null)
      === (expected.delivery.source?.fromPhoneNumber ?? null)
    && (actual.delivery.source?.kind ?? null)
      === (expected.delivery.source?.kind ?? null)
    && actual.delivery.target === expected.delivery.target
    && actual.identityId === expected.identityId
    && actual.threadId === expected.threadId
    && actual.threadIsDirect === expected.threadIsDirect;
}

function throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch(): never {
  throw hostedOnboardingError({
    code: "HOSTED_ASSISTANT_ASK_DELIVERY_AUTHORITY_MISMATCH",
    httpStatus: 403,
    message: "Hosted Assistant Ask delivery authority is no longer valid.",
    retryable: false,
  });
}

function readHostedCurrentSenderSource(
  wake: HostedExecutionConversationMessageWake,
  groupRuntimeMemberId: string,
): {
  messageText: string | null;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  sourceChannel: HostedGroupCurrentSenderSourceChannel;
} | null {
  if (wake.userId !== groupRuntimeMemberId) {
    return null;
  }
  const message = wake.message;
  let routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  let sourceChannel: HostedGroupCurrentSenderSourceChannel;
  if (message.channel === "linq") {
    const authority = message.routeAuthority;
    if (
      message.linqMessage.threadIsDirect !== false
      || message.linqMessage.isFromMe
      || !authority
      || authority.channel !== "linq"
      || authority.containerMemberId !== groupRuntimeMemberId
      || authority.threadId !== message.linqMessage.chatId
    ) {
      return null;
    }
    routeAuthority = authority;
    sourceChannel = "linq";
  } else if (message.channel === "telegram") {
    const authority = message.routeAuthority;
    if (
      message.telegramMessage.threadIsDirect !== false
      || !authority
      || authority.channel !== "telegram"
      || authority.containerMemberId !== groupRuntimeMemberId
      || authority.threadId !== message.telegramMessage.threadId
    ) {
      return null;
    }
    routeAuthority = authority;
    sourceChannel = "telegram";
  } else {
    return null;
  }
  return {
    messageText: readHostedExecutionConversationMessageText(message),
    routeAuthority,
    sourceChannel,
  };
}

function readHostedCurrentSenderQuestion(messageText: string | null): string | null {
  if (
    !messageText
    || [...messageText].length > HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS
  ) {
    return null;
  }
  return messageText;
}

function hostedCurrentSenderQuestionAuthority(
  authority: HostedGroupCurrentSenderAuthority,
  question: string,
): HostedGroupCurrentSenderQuestionAuthority {
  return {
    groupRuntimeMemberId: authority.groupRuntimeMemberId,
    occurredAt: authority.occurredAt,
    question,
    sourceChannel: authority.sourceChannel,
    targetMemberId: authority.targetMemberId,
  };
}

async function hasHostedCurrentSenderRuntimeAccessForUpdateTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  try {
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, {
      code: "HOSTED_ASSISTANT_ASK_RUNTIME_INACTIVE",
      message: "Hosted Assistant Ask runtime access is inactive.",
      prisma: input.tx,
    });
    return true;
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "HOSTED_ASSISTANT_ASK_RUNTIME_INACTIVE"
      && !error.retryable
    ) {
      return false;
    }
    throw error;
  }
}

function createHostedGroupCurrentSenderPrivatePermissionDigest(): string {
  return createHash("sha256")
    .update(HOSTED_GROUP_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT)
    .digest("hex");
}

function createHostedGroupCurrentSenderPermissionDigest(): string {
  return createHash("sha256")
    .update(HOSTED_GROUP_CURRENT_SENDER_DISCLOSURE_PERMISSION_TEXT)
    .digest("hex");
}

function normalizeHostedCurrentSenderOrigin(
  origin: HostedExecutionAssistantAskAcceptedInputOrigin,
): HostedExecutionAssistantAskAcceptedInputOrigin {
  if (origin.kind !== "accepted_input") {
    throw new TypeError("Hosted current-sender origin must be an accepted input.");
  }
  return {
    assistantInputId: normalizeHostedCurrentSenderAssistantInputId(
      origin.assistantInputId,
    ),
    kind: "accepted_input",
    sessionId: normalizeHostedCurrentSenderOpaqueId(
      origin.sessionId,
      "Hosted current-sender origin session ID",
    ),
  };
}

function normalizeHostedCurrentSenderAssistantInputId(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!HOSTED_EXECUTION_ASSISTANT_INPUT_ID_PATTERN.test(normalized)) {
    throw new TypeError("Hosted current-sender assistant input ID is invalid.");
  }
  return normalized;
}

function normalizeHostedCurrentSenderOpaqueId(
  value: unknown,
  label: string,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    normalized.length === 0
    || [...normalized].length > HOSTED_ASSISTANT_ASK_OPAQUE_ID_MAX_CODE_POINTS
  ) {
    throw new TypeError(`${label} is invalid.`);
  }
  return normalized;
}

function hostedCurrentSenderOriginsEqual(
  left: HostedExecutionAssistantAskAcceptedInputOrigin,
  right: HostedExecutionAssistantAskAcceptedInputOrigin,
): boolean {
  return left.assistantInputId === right.assistantInputId
    && left.kind === right.kind
    && left.sessionId === right.sessionId;
}

function isHostedCurrentSenderAssistantAskExpired(
  expiresAt: string | null,
  now: Date,
): boolean {
  if (!expiresAt) {
    return true;
  }
  const expiresAtMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime();
}

function unavailableHostedCurrentSenderAdmission(
  unavailableReason: string,
): HostedGroupCurrentSenderAssistantAskAdmission {
  return {
    mailboxWake: null,
    result: { status: "unavailable", unavailableReason },
  };
}

function unavailableHostedCurrentSenderPrivateAdmission(
  unavailableReason: string,
): HostedGroupCurrentSenderPrivateAssistantAskAdmission {
  return {
    mailboxWake: null,
    result: { status: "unavailable", unavailableReason },
  };
}

async function acquireHostedCurrentSenderAssistantAskLockTx(
  tx: Prisma.TransactionClient,
  requestId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${HOSTED_ASSISTANT_ASK_ADVISORY_LOCK_NAMESPACE}),
      hashtext(${requestId})
    )
  `;
}
