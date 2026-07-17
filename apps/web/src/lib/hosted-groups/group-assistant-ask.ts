import "server-only";

import { createHash } from "node:crypto";

import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  buildHostedExecutionAssistantAskCompletedWake,
  buildHostedExecutionAssistantAskRequestedWake,
  createHostedExecutionReviewedAssistantAskCompletionDeliveryKey,
  HOSTED_EXECUTION_REVIEWED_ASSISTANT_ASK_COMPLETION_DELIVERY_KEY_PREFIX,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
  isHostedExecutionAssistantAskCompletedWake,
  isHostedExecutionAssistantAskRequestedWake,
  type HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX,
  type HostedRuntimeAssistantAskControlRequest,
  type HostedRuntimeAssistantAskControlResponse,
  type HostedRuntimeGroupAskResult,
  type HostedRuntimeGroupMemberAskResult,
} from "@murphai/hosted-execution/runtime-control";

import {
  appendHostedMailboxEnvelopeWithIdentityTx,
  readHostedMailboxConversationWakeByAssistantInputId,
  readHostedMailboxItemById,
  readHostedMailboxWakeByDedupeKey,
  readHostedMailboxWakeByItemId,
} from "../hosted-mailbox/store";
import {
  requireHostedRuntimeActiveAccess,
  requireHostedRuntimeActiveAccessForUpdateTx,
} from "../hosted-mailbox/runtime-access";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import { assertHostedLinqRouteEgressAuthority } from "../hosted-routing/thread-route-store";
import { getPrisma } from "../prisma";
import {
  readHostedGroupDisclosureGrantAuthorityTx,
} from "./group-disclosure-store";

export const HOSTED_ASSISTANT_ASK_PRODUCER_ENABLED_ENV =
  "HOSTED_ASSISTANT_ASK_PRODUCER_ENABLED";
export const HOSTED_GROUP_DISCLOSURE_PRODUCER_ENABLED_ENV =
  "HOSTED_GROUP_DISCLOSURE_PRODUCER_ENABLED";

const HOSTED_ASSISTANT_ASK_REQUEST_ID_NAMESPACE =
  "murph.hosted-assistant-ask.request.v1";
const HOSTED_GROUP_MEMBER_ASSISTANT_ASK_REQUEST_ID_NAMESPACE =
  "murph.hosted-group-member-assistant-ask.request.v1";
const HOSTED_ASSISTANT_ASK_COMPLETION_ID_NAMESPACE =
  "murph.hosted-assistant-ask.completion.v1";
const HOSTED_ASSISTANT_ASK_COMPLETION_ID_PREFIX = "aask_done_";
const HOSTED_ASSISTANT_ASK_ADVISORY_LOCK_NAMESPACE =
  "hosted-assistant-ask";
const HOSTED_ASSISTANT_ASK_OPAQUE_ID_MAX_CODE_POINTS = 256;
const HOSTED_ASSISTANT_ASK_UNSAFE_LABEL_PATTERN =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu;

type HostedAssistantAskPrismaClient = Pick<PrismaClient, "$transaction">;

interface HostedAssistantAskMembership {
  group: {
    displayName: string | null;
    runtimeMemberId: string | null;
  };
  id: string;
  memberId: string;
}

export interface HostedAssistantAskMailboxWake {
  expectedUserId: string;
  mailboxItemId: string;
}

export interface HostedGroupAssistantAskAdmission {
  mailboxWake: HostedAssistantAskMailboxWake | null;
  result: HostedRuntimeGroupAskResult;
}

export interface HostedGroupMemberAssistantAskAdmission {
  mailboxWake: HostedAssistantAskMailboxWake | null;
  result: HostedRuntimeGroupMemberAskResult;
}

export interface HostedAssistantAskControlResult {
  mailboxWake: HostedAssistantAskMailboxWake | null;
  response: HostedRuntimeAssistantAskControlResponse;
}

type HostedAssistantAskAuthority = {
  expiresAt: string;
  originAssistantInputId: string;
  originMemberId: string;
  originSessionId: string;
  question: string;
  targetLabel: string | null;
} & (
  | { deliveryMode: "legacy" }
  | { deliveryMode: "reviewed_exact"; permissionText: string }
);

interface HostedAssistantAskRequestReadResult {
  authority: HostedAssistantAskAuthority | null;
  terminalReason: "expired" | "unavailable" | null;
}

export function isHostedAssistantAskProducerEnabled(
  source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return source[HOSTED_ASSISTANT_ASK_PRODUCER_ENABLED_ENV] === "1";
}

export function isHostedGroupDisclosureProducerEnabled(
  source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return source[HOSTED_GROUP_DISCLOSURE_PRODUCER_ENABLED_ENV] === "1";
}

export function createHostedAssistantAskRequestId(input: {
  memberId: string;
  originAssistantInputId: string;
}): string {
  return `aask_req_${createHash("sha256")
    .update(HOSTED_ASSISTANT_ASK_REQUEST_ID_NAMESPACE)
    .update("\0")
    .update(input.memberId)
    .update("\0")
    .update(input.originAssistantInputId)
    .digest("hex")}`;
}

export function createHostedAssistantAskCompletionId(requestId: string): string {
  return `aask_done_${createHash("sha256")
    .update(HOSTED_ASSISTANT_ASK_COMPLETION_ID_NAMESPACE)
    .update("\0")
    .update(requestId)
    .digest("hex")}`;
}

export function createHostedGroupMemberAssistantAskRequestId(input: {
  groupRuntimeMemberId: string;
  originAssistantInputId: string;
}): string {
  return `aask_req_${createHash("sha256")
    .update(HOSTED_GROUP_MEMBER_ASSISTANT_ASK_REQUEST_ID_NAMESPACE)
    .update("\0")
    .update(input.groupRuntimeMemberId)
    .update("\0")
    .update(input.originAssistantInputId)
    .digest("hex")}`;
}

export async function requestHostedGroupAssistantAsk(input: {
  environment?: Readonly<Record<string, string | undefined>>;
  groupLabel?: string | null;
  memberId: string;
  now?: Date;
  originAssistantInputId: string;
  originSessionId: string;
  prisma?: HostedAssistantAskPrismaClient;
  question: string;
}): Promise<HostedGroupAssistantAskAdmission> {
  if (!isHostedAssistantAskProducerEnabled(input.environment)) {
    return unavailableAdmission("feature_disabled");
  }

  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const question = normalizeHostedAssistantAskText({
    label: "Hosted assistant ask question",
    maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
    value: input.question,
  });
  const requestedLabel = normalizeHostedAssistantAskSelector(input.groupLabel);
  const originSessionId = normalizeHostedAssistantAskText({
    label: "Hosted assistant ask origin session ID",
    maxCodePoints: HOSTED_ASSISTANT_ASK_OPAQUE_ID_MAX_CODE_POINTS,
    value: input.originSessionId,
  });
  const requestId = createHostedAssistantAskRequestId({
    memberId: input.memberId,
    originAssistantInputId: input.originAssistantInputId,
  });

  return prisma.$transaction(async (tx) => {
    await acquireHostedAssistantAskLockTx(tx, requestId);

    const existing = await readHostedMailboxItemById({
      mailboxItemId: requestId,
      prisma: tx,
    });
    if (existing) {
      return replayHostedGroupAssistantAskTx({
        existingDedupeKey: existing.dedupeKey,
        existingKind: existing.kind,
        existingUserId: existing.userId,
        expiresAt: existing.expiresAt ?? null,
        memberId: input.memberId,
        now,
        originAssistantInputId: input.originAssistantInputId,
        originSessionId,
        question,
        requestId,
        requestedLabel,
        tx,
      });
    }

    if (!await isEligiblePersonalAssistantAskCallerTx({
      memberId: input.memberId,
      now,
      originAssistantInputId: input.originAssistantInputId,
      tx,
    })) {
      return unavailableAdmission("origin_unavailable");
    }

    const memberships = await tx.hostedGroupMember.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        group: {
          select: {
            displayName: true,
            runtimeMemberId: true,
          },
        },
        id: true,
        memberId: true,
      },
      take: HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX + 1,
      where: { memberId: input.memberId },
    });
    const resolution = resolveHostedAssistantAskMembership({
      memberships,
      requestedLabel,
    });
    if (resolution.result) {
      return { mailboxWake: null, result: resolution.result };
    }
    if (!resolution.membership) {
      return unavailableAdmission("membership_unavailable");
    }

    const authority = await readHostedAssistantAskMembershipAuthorityTx({
      expectedOriginMemberId: input.memberId,
      expectedTargetRuntimeMemberId: resolution.membership.group.runtimeMemberId,
      membershipId: resolution.membership.id,
      now,
      originAssistantInputId: input.originAssistantInputId,
      tx,
    });
    if (!authority) {
      return unavailableAdmission("membership_unavailable");
    }

    const occurredAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
    ).toISOString();
    const wake = buildHostedExecutionAssistantAskRequestedWake({
      ask: {
        expiresAt,
        originAssistantInputId: input.originAssistantInputId,
        originSessionId,
        question,
        target: {
          kind: "joined_group",
          membershipId: authority.membership.id,
          requestedLabel,
        },
      },
      eventId: requestId,
      memberId: authority.targetRuntimeMemberId,
      occurredAt,
    });
    const append = await appendHostedMailboxEnvelopeWithIdentityTx({
      envelope: wake,
      expiresAt,
      itemId: requestId,
      tx,
    });
    if (append.dedupeConflict || append.item.id !== requestId) {
      return unavailableAdmission("request_conflict");
    }

    return {
      mailboxWake: {
        expectedUserId: authority.targetRuntimeMemberId,
        mailboxItemId: requestId,
      },
      result: {
        status: "accepted",
        targetLabel: authority.targetLabel,
      },
    };
  });
}

export async function requestHostedGroupMemberAssistantAsk(input: {
  environment?: Readonly<Record<string, string | undefined>>;
  grantId: string;
  memberId: string;
  now?: Date;
  originAssistantInputId: string;
  originSessionId: string;
  prisma?: HostedAssistantAskPrismaClient;
  question: string;
}): Promise<HostedGroupMemberAssistantAskAdmission> {
  if (!isHostedGroupDisclosureProducerEnabled(input.environment)) {
    return unavailableAdmission("feature_disabled");
  }

  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const grantId = normalizeHostedAssistantAskText({
    label: "Hosted group disclosure grant ID",
    maxCodePoints: HOSTED_ASSISTANT_ASK_OPAQUE_ID_MAX_CODE_POINTS,
    value: input.grantId,
  });
  const question = normalizeHostedAssistantAskText({
    label: "Hosted assistant ask question",
    maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
    value: input.question,
  });
  const originSessionId = normalizeHostedAssistantAskText({
    label: "Hosted assistant ask origin session ID",
    maxCodePoints: HOSTED_ASSISTANT_ASK_OPAQUE_ID_MAX_CODE_POINTS,
    value: input.originSessionId,
  });
  const requestId = createHostedGroupMemberAssistantAskRequestId({
    groupRuntimeMemberId: input.memberId,
    originAssistantInputId: input.originAssistantInputId,
  });

  return prisma.$transaction(async (tx) => {
    await acquireHostedAssistantAskLockTx(tx, requestId);

    const existing = await readHostedMailboxItemById({
      mailboxItemId: requestId,
      prisma: tx,
    });
    if (existing) {
      return replayHostedGroupMemberAssistantAskTx({
        existingDedupeKey: existing.dedupeKey,
        existingKind: existing.kind,
        existingUserId: existing.userId,
        expiresAt: existing.expiresAt ?? null,
        grantId,
        groupRuntimeMemberId: input.memberId,
        now,
        originAssistantInputId: input.originAssistantInputId,
        originSessionId,
        question,
        requestId,
        tx,
      });
    }

    const authority = await readHostedGroupDisclosureGrantAuthorityTx({
      expectedGroupRuntimeMemberId: input.memberId,
      grantId,
      tx,
    });
    if (!authority) {
      return unavailableAdmission("grant_unavailable");
    }
    if (!await isEligibleGroupAssistantAskCallerTx({
      groupRuntimeMemberId: input.memberId,
      now,
      originAssistantInputId: input.originAssistantInputId,
      tx,
    })) {
      return unavailableAdmission("origin_unavailable");
    }
    if (!await isEligiblePersonalAssistantAskTargetTx({
        memberId: authority.targetMemberId,
        tx,
      })) {
      return unavailableAdmission("grant_unavailable");
    }

    const occurredAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
    ).toISOString();
    const wake = buildHostedExecutionAssistantAskRequestedWake({
      ask: {
        expiresAt,
        originAssistantInputId: input.originAssistantInputId,
        originSessionId,
        question,
        target: {
          grantId: authority.grantId,
          kind: "consented_member",
          membershipId: authority.membershipId,
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
      return unavailableAdmission("request_conflict");
    }

    return {
      mailboxWake: {
        expectedUserId: authority.targetMemberId,
        mailboxItemId: requestId,
      },
      result: {
        status: "accepted",
      },
    };
  });
}

export async function handleHostedRuntimeAssistantAskControl(input: {
  boundRuntimeMemberId: string;
  now?: Date;
  prisma?: HostedAssistantAskPrismaClient;
  request: HostedRuntimeAssistantAskControlRequest;
}): Promise<HostedAssistantAskControlResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    await acquireHostedAssistantAskLockTx(tx, input.request.requestId);
    const requestRead = await readHostedAssistantAskAuthorityTx({
      boundRuntimeMemberId: input.boundRuntimeMemberId,
      now,
      requestId: input.request.requestId,
      tx,
    });
    if (!requestRead.authority) {
      return {
        mailboxWake: null,
        response: {
          action: input.request.action,
          status: "terminal",
          terminalReason: requestRead.terminalReason ?? "unavailable",
        },
      };
    }
    const authority = requestRead.authority;
    const completionId = createHostedAssistantAskCompletionId(
      input.request.requestId,
    );
    const existingCompletion = await readHostedMailboxItemById({
      mailboxItemId: completionId,
      prisma: tx,
    });
    const existingCompletionIsValid = existingCompletion
      ? await isMatchingHostedAssistantAskCompletionTx({
          completionId,
          existingDedupeKey: existingCompletion.dedupeKey,
          existingExpiresAt: existingCompletion.expiresAt ?? null,
          existingKind: existingCompletion.kind,
          existingUserId: existingCompletion.userId,
          expectedExpiresAt: authority.expiresAt,
          expectedDeliveryMode: authority.deliveryMode === "reviewed_exact"
            ? "reviewed_exact"
            : undefined,
          expectedOriginAssistantInputId: authority.originAssistantInputId,
          expectedOriginMemberId: authority.originMemberId,
          expectedOriginSessionId: authority.originSessionId,
          expectedQuestion: authority.question,
          expectedRequestId: input.request.requestId,
          now,
          tx,
        })
      : false;

    if (input.request.action === "prepare") {
      if (existingCompletion) {
        return {
          mailboxWake: existingCompletionIsValid
            ? {
                expectedUserId: authority.originMemberId,
                mailboxItemId: completionId,
              }
            : null,
          response: {
            action: "prepare",
            status: "terminal",
            terminalReason: "unavailable",
          },
        };
      }
      if (authority.deliveryMode === "reviewed_exact") {
        return {
          mailboxWake: null,
          response: {
            action: "prepare",
            disclosure: { permissionText: authority.permissionText },
            question: authority.question,
            status: "ready",
            targetLabel: authority.targetLabel,
          },
        };
      }
      return {
        mailboxWake: null,
        response: {
          action: "prepare",
          question: authority.question,
          status: "ready",
          targetLabel: authority.targetLabel,
        },
      };
    }

    if (existingCompletion) {
      return {
        mailboxWake: existingCompletionIsValid
          ? {
              expectedUserId: authority.originMemberId,
              mailboxItemId: completionId,
            }
          : null,
        response: existingCompletionIsValid
          ? { action: "complete", status: "already_completed" }
          : {
              action: "complete",
              status: "terminal",
              terminalReason: "unavailable",
            },
      };
    }

    const occurredAt = now.toISOString();
    const wake = buildHostedExecutionAssistantAskCompletedWake({
      ask: {
        ...(authority.deliveryMode === "reviewed_exact"
          ? { deliveryMode: "reviewed_exact" as const }
          : {}),
        expiresAt: authority.expiresAt,
        originAssistantInputId: authority.originAssistantInputId,
        originSessionId: authority.originSessionId,
        question: authority.question,
        requestId: input.request.requestId,
        result: input.request.result,
        targetLabel: authority.targetLabel,
      },
      eventId: completionId,
      memberId: authority.originMemberId,
      occurredAt,
    });
    const append = await appendHostedMailboxEnvelopeWithIdentityTx({
      envelope: wake,
      expiresAt: authority.expiresAt,
      itemId: completionId,
      tx,
    });
    if (append.dedupeConflict || append.item.id !== completionId) {
      return {
        mailboxWake: null,
        response: {
          action: "complete",
          status: "terminal",
          terminalReason: "unavailable",
        },
      };
    }

    return {
      mailboxWake: {
        expectedUserId: authority.originMemberId,
        mailboxItemId: completionId,
      },
      response: { action: "complete", status: "completed" },
    };
  });
}

export async function assertHostedAssistantAskCompletionDeliveryAuthorityTx(
  input: {
    answeredMailboxItemIds: readonly string[];
    assistantAskCompletionExpiresAt?: string;
    assistantAskFallback?: boolean;
    boundRuntimeMemberId: string;
    idempotencyKey: string | null;
    now?: Date;
    tx: Prisma.TransactionClient;
  },
): Promise<{ assistantAskFallbackRequired: true } | void> {
  const isCompletionDelivery = input.idempotencyKey?.startsWith(
    HOSTED_EXECUTION_REVIEWED_ASSISTANT_ASK_COMPLETION_DELIVERY_KEY_PREFIX,
  ) === true;
  if (!isCompletionDelivery) {
    return;
  }

  const completionId = input.answeredMailboxItemIds[0] ?? null;
  if (
    !completionId
    || input.answeredMailboxItemIds.length !== 1
    || !completionId.startsWith(HOSTED_ASSISTANT_ASK_COMPLETION_ID_PREFIX)
    || createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
      completionId,
    ) !== input.idempotencyKey
  ) {
    throwHostedAssistantAskDeliveryAuthorityMismatch();
  }

  const now = input.now ?? new Date();
  const declaredExpiresAt = input.assistantAskCompletionExpiresAt ?? null;
  const supportsSafeFallback =
    input.assistantAskFallback !== undefined
    && declaredExpiresAt !== null
    && Number.isFinite(Date.parse(declaredExpiresAt));
  if (
    input.assistantAskFallback !== undefined
    && !supportsSafeFallback
  ) {
    throwHostedAssistantAskDeliveryAuthorityMismatch();
  }
  if (input.assistantAskFallback === true) {
    return;
  }
  const completionItem = await readHostedMailboxItemById({
    mailboxItemId: completionId,
    prisma: input.tx,
  });
  if (!completionItem) {
    if (
      supportsSafeFallback
      && isHostedAssistantAskExpired(declaredExpiresAt, now)
    ) {
      return { assistantAskFallbackRequired: true };
    }
    throwHostedAssistantAskDeliveryAuthorityMismatch();
  }
  if (
    completionItem.dedupeKey !== completionId
    || completionItem.kind !== "assistant.ask.completed"
    || completionItem.userId !== input.boundRuntimeMemberId
    || (
      supportsSafeFallback
      && completionItem.expiresAt !== declaredExpiresAt
    )
  ) {
    throwHostedAssistantAskDeliveryAuthorityMismatch();
  }

  if (
    !supportsSafeFallback
    && isHostedAssistantAskExpired(completionItem.expiresAt ?? null, now)
  ) {
    throwHostedAssistantAskDeliveryAuthorityMismatch();
  }

  const completionWake = supportsSafeFallback
    ? await readHostedMailboxWakeByDedupeKey({
      dedupeKey: completionId,
      prisma: input.tx,
      userId: input.boundRuntimeMemberId,
    })
    : await readHostedMailboxWakeByItemId({
      availableAt: now,
      mailboxItemId: completionId,
      prisma: input.tx,
    });
  if (
    !completionWake
    || !isHostedExecutionAssistantAskCompletedWake(completionWake)
    || completionWake.eventId !== completionId
    || completionWake.userId !== input.boundRuntimeMemberId
    || completionWake.ask.deliveryMode !== "reviewed_exact"
    || completionWake.ask.expiresAt !== completionItem.expiresAt
    || createHostedAssistantAskCompletionId(completionWake.ask.requestId)
      !== completionId
  ) {
    throwHostedAssistantAskDeliveryAuthorityMismatch();
  }

  if (
    supportsSafeFallback
    && isHostedAssistantAskExpired(completionItem.expiresAt ?? null, now)
  ) {
    return { assistantAskFallbackRequired: true };
  }

  const requestItem = await readHostedMailboxItemById({
    mailboxItemId: completionWake.ask.requestId,
    prisma: input.tx,
  });
  if (!requestItem) {
    if (supportsSafeFallback) {
      return { assistantAskFallbackRequired: true };
    }
    throwHostedAssistantAskDeliveryAuthorityMismatch();
  }
  const requestRead = await readHostedAssistantAskAuthorityTx({
    boundRuntimeMemberId: requestItem.userId,
    now,
    requestId: completionWake.ask.requestId,
    tx: input.tx,
  });
  const authority = requestRead.authority;
  if (
    !authority
    || authority.deliveryMode !== "reviewed_exact"
    || authority.originMemberId !== input.boundRuntimeMemberId
    || authority.expiresAt !== completionWake.ask.expiresAt
    || authority.originAssistantInputId
      !== completionWake.ask.originAssistantInputId
    || authority.originSessionId !== completionWake.ask.originSessionId
    || authority.question !== completionWake.ask.question
  ) {
    if (supportsSafeFallback) {
      return { assistantAskFallbackRequired: true };
    }
    throwHostedAssistantAskDeliveryAuthorityMismatch();
  }
}

async function replayHostedGroupAssistantAskTx(input: {
  existingDedupeKey: string;
  existingKind: string;
  existingUserId: string;
  expiresAt: string | null;
  memberId: string;
  now: Date;
  originAssistantInputId: string;
  originSessionId: string;
  question: string;
  requestId: string;
  requestedLabel: string | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupAssistantAskAdmission> {
  if (isHostedAssistantAskExpired(input.expiresAt, input.now)) {
    return unavailableAdmission("request_expired");
  }
  if (
    input.existingDedupeKey !== input.requestId
    || input.existingKind !== "assistant.ask.requested"
  ) {
    return unavailableAdmission("request_conflict");
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
    || wake.ask.originAssistantInputId !== input.originAssistantInputId
    || wake.ask.originSessionId !== input.originSessionId
    || wake.ask.question !== input.question
    || wake.ask.target.kind !== "joined_group"
    || wake.ask.target.requestedLabel !== input.requestedLabel
    || createHostedAssistantAskRequestId({
      memberId: input.memberId,
      originAssistantInputId: wake.ask.originAssistantInputId,
    }) !== input.requestId
  ) {
    return unavailableAdmission("request_conflict");
  }

  const authority = await readHostedAssistantAskMembershipAuthorityTx({
    expectedOriginMemberId: input.memberId,
    expectedTargetRuntimeMemberId: input.existingUserId,
    membershipId: wake.ask.target.membershipId,
    now: input.now,
    originAssistantInputId: wake.ask.originAssistantInputId,
    tx: input.tx,
  });
  if (!authority) {
    return unavailableAdmission("membership_unavailable");
  }

  return {
    mailboxWake: {
      expectedUserId: input.existingUserId,
      mailboxItemId: input.requestId,
    },
    result: {
      status: "accepted",
      targetLabel: authority.targetLabel,
    },
  };
}

async function replayHostedGroupMemberAssistantAskTx(input: {
  existingDedupeKey: string;
  existingKind: string;
  existingUserId: string;
  expiresAt: string | null;
  grantId: string;
  groupRuntimeMemberId: string;
  now: Date;
  originAssistantInputId: string;
  originSessionId: string;
  question: string;
  requestId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupMemberAssistantAskAdmission> {
  if (isHostedAssistantAskExpired(input.expiresAt, input.now)) {
    return unavailableAdmission("request_expired");
  }
  if (
    input.existingDedupeKey !== input.requestId
    || input.existingKind !== "assistant.ask.requested"
  ) {
    return unavailableAdmission("request_conflict");
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
    || wake.ask.originAssistantInputId !== input.originAssistantInputId
    || wake.ask.originSessionId !== input.originSessionId
    || wake.ask.question !== input.question
    || wake.ask.target.kind !== "consented_member"
    || wake.ask.target.grantId !== input.grantId
    || createHostedGroupMemberAssistantAskRequestId({
      groupRuntimeMemberId: input.groupRuntimeMemberId,
      originAssistantInputId: wake.ask.originAssistantInputId,
    }) !== input.requestId
  ) {
    return unavailableAdmission("request_conflict");
  }

  const authority = await readHostedGroupDisclosureGrantAuthorityTx({
    expectedGroupRuntimeMemberId: input.groupRuntimeMemberId,
    expectedTargetMemberId: input.existingUserId,
    grantId: wake.ask.target.grantId,
    membershipId: wake.ask.target.membershipId,
    permissionDigest: wake.ask.target.permissionDigest,
    tx: input.tx,
  });
  if (!authority) {
    return unavailableAdmission("grant_unavailable");
  }
  if (!await isEligibleGroupAssistantAskCallerTx({
    groupRuntimeMemberId: input.groupRuntimeMemberId,
    now: input.now,
    originAssistantInputId: wake.ask.originAssistantInputId,
    tx: input.tx,
  })) {
    return unavailableAdmission("origin_unavailable");
  }
  if (!await isEligiblePersonalAssistantAskTargetTx({
      memberId: authority.targetMemberId,
      tx: input.tx,
    })) {
    return unavailableAdmission("grant_unavailable");
  }

  return {
    mailboxWake: {
      expectedUserId: input.existingUserId,
      mailboxItemId: input.requestId,
    },
    result: {
      status: "accepted",
    },
  };
}

async function readHostedAssistantAskAuthorityTx(input: {
  boundRuntimeMemberId: string;
  now: Date;
  requestId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedAssistantAskRequestReadResult> {
  const item = await readHostedMailboxItemById({
    mailboxItemId: input.requestId,
    prisma: input.tx,
  });
  if (!item) {
    return { authority: null, terminalReason: "unavailable" };
  }
  if (isHostedAssistantAskExpired(item.expiresAt ?? null, input.now)) {
    return { authority: null, terminalReason: "expired" };
  }
  if (
    item.dedupeKey !== input.requestId
    || item.kind !== "assistant.ask.requested"
    || item.userId !== input.boundRuntimeMemberId
  ) {
    return { authority: null, terminalReason: "unavailable" };
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
    || wake.userId !== item.userId
    || wake.ask.expiresAt !== item.expiresAt
  ) {
    return { authority: null, terminalReason: "unavailable" };
  }

  if (wake.ask.target.kind === "joined_group") {
    const membershipAuthority = await readHostedAssistantAskMembershipAuthorityTx({
      expectedOriginMemberId: null,
      expectedTargetRuntimeMemberId: item.userId,
      membershipId: wake.ask.target.membershipId,
      now: input.now,
      originAssistantInputId: wake.ask.originAssistantInputId,
      tx: input.tx,
    });
    if (
      !membershipAuthority
      || createHostedAssistantAskRequestId({
        memberId: membershipAuthority.membership.memberId,
        originAssistantInputId: wake.ask.originAssistantInputId,
      }) !== input.requestId
    ) {
      return { authority: null, terminalReason: "unavailable" };
    }

    return {
      authority: {
        deliveryMode: "legacy",
        expiresAt: wake.ask.expiresAt,
        originAssistantInputId: wake.ask.originAssistantInputId,
        originMemberId: membershipAuthority.membership.memberId,
        originSessionId: wake.ask.originSessionId,
        question: wake.ask.question,
        targetLabel: membershipAuthority.targetLabel,
      },
      terminalReason: null,
    };
  }

  const disclosureAuthority = await readHostedGroupDisclosureGrantAuthorityTx({
    expectedTargetMemberId: item.userId,
    grantId: wake.ask.target.grantId,
    membershipId: wake.ask.target.membershipId,
    permissionDigest: wake.ask.target.permissionDigest,
    tx: input.tx,
  });
  if (
    !disclosureAuthority
    || !await isEligibleGroupAssistantAskCallerTx({
      groupRuntimeMemberId: disclosureAuthority.groupRuntimeMemberId,
      now: input.now,
      originAssistantInputId: wake.ask.originAssistantInputId,
      tx: input.tx,
    })
    || !await isEligiblePersonalAssistantAskTargetTx({
      memberId: disclosureAuthority.targetMemberId,
      tx: input.tx,
    })
    || createHostedGroupMemberAssistantAskRequestId({
      groupRuntimeMemberId: disclosureAuthority.groupRuntimeMemberId,
      originAssistantInputId: wake.ask.originAssistantInputId,
    }) !== input.requestId
  ) {
    return { authority: null, terminalReason: "unavailable" };
  }

  return {
    authority: {
      deliveryMode: "reviewed_exact",
      expiresAt: wake.ask.expiresAt,
      originAssistantInputId: wake.ask.originAssistantInputId,
      originMemberId: disclosureAuthority.groupRuntimeMemberId,
      originSessionId: wake.ask.originSessionId,
      permissionText: disclosureAuthority.permissionText,
      question: wake.ask.question,
      targetLabel: null,
    },
    terminalReason: null,
  };
}

async function readHostedAssistantAskMembershipAuthorityTx(input: {
  expectedOriginMemberId: string | null;
  expectedTargetRuntimeMemberId: string | null;
  membershipId: string;
  now: Date;
  originAssistantInputId: string;
  tx: Prisma.TransactionClient;
}): Promise<{
  membership: HostedAssistantAskMembership;
  targetLabel: string | null;
  targetRuntimeMemberId: string;
} | null> {
  const locked = await input.tx.$queryRaw<Array<{ id: string }>>`
    SELECT gm.id
    FROM hosted_group_member AS gm
    INNER JOIN hosted_group AS g ON g.id = gm.group_id
    WHERE gm.id = ${input.membershipId}
    FOR UPDATE OF gm, g
  `;
  if (locked.length !== 1) {
    return null;
  }

  const membership = await input.tx.hostedGroupMember.findUnique({
    select: {
      group: {
        select: {
          displayName: true,
          runtimeMemberId: true,
        },
      },
      id: true,
      memberId: true,
    },
    where: { id: input.membershipId },
  });
  if (!membership) {
    return null;
  }
  const targetRuntimeMemberId = membership.group.runtimeMemberId;
  if (
    !targetRuntimeMemberId
    || (
      input.expectedOriginMemberId !== null
      && membership.memberId !== input.expectedOriginMemberId
    )
    || (
      input.expectedTargetRuntimeMemberId !== null
      && targetRuntimeMemberId !== input.expectedTargetRuntimeMemberId
    )
  ) {
    return null;
  }

  const targetContainer = await input.tx.hostedThreadContainer.findUnique({
    select: { memberId: true },
    where: { memberId: targetRuntimeMemberId },
  });
  if (!targetContainer) {
    return null;
  }
  if (
    !await hasHostedAssistantAskRuntimeAccessForUpdateTx({
      memberId: membership.memberId,
      tx: input.tx,
    })
    || !await hasHostedAssistantAskRuntimeAccessForUpdateTx({
      memberId: targetRuntimeMemberId,
      tx: input.tx,
    })
  ) {
    return null;
  }

  const originWake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: input.originAssistantInputId,
    availableAt: input.now,
    memberId: membership.memberId,
    prisma: input.tx,
  });
  if (!originWake || !isHostedAssistantAskDirectConversation(originWake)) {
    return null;
  }

  return {
    membership,
    targetLabel: sanitizeHostedAssistantAskDisplayLabel(
      membership.group.displayName,
    ),
    targetRuntimeMemberId,
  };
}

async function isEligiblePersonalAssistantAskCallerTx(input: {
  memberId: string;
  now: Date;
  originAssistantInputId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const container = await input.tx.hostedThreadContainer.findUnique({
    select: { memberId: true },
    where: { memberId: input.memberId },
  });
  if (container) {
    return false;
  }
  if (!await hasHostedAssistantAskRuntimeAccess({
    memberId: input.memberId,
    tx: input.tx,
  })) {
    return false;
  }
  const originWake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: input.originAssistantInputId,
    availableAt: input.now,
    memberId: input.memberId,
    prisma: input.tx,
  });
  return originWake !== null && isHostedAssistantAskDirectConversation(originWake);
}

async function isEligibleGroupAssistantAskCallerTx(input: {
  groupRuntimeMemberId: string;
  now: Date;
  originAssistantInputId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const container = await input.tx.hostedThreadContainer.findUnique({
    select: { memberId: true },
    where: { memberId: input.groupRuntimeMemberId },
  });
  if (
    !container
    || !await hasHostedAssistantAskRuntimeAccessForUpdateTx({
      memberId: input.groupRuntimeMemberId,
      tx: input.tx,
    })
  ) {
    return false;
  }

  const originWake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: input.originAssistantInputId,
    availableAt: input.now,
    memberId: input.groupRuntimeMemberId,
    prisma: input.tx,
  });
  if (
    !originWake
    || !isHostedAssistantAskBoundGroupConversation(
      originWake,
      input.groupRuntimeMemberId,
    )
  ) {
    return false;
  }

  try {
    await assertHostedLinqRouteEgressAuthority({
      authority: originWake.message.routeAuthority,
      prisma: input.tx,
    });
    return true;
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED"
      && !error.retryable
    ) {
      return false;
    }
    throw error;
  }
}

async function isEligiblePersonalAssistantAskTargetTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const container = await input.tx.hostedThreadContainer.findUnique({
    select: { memberId: true },
    where: { memberId: input.memberId },
  });
  return !container && await hasHostedAssistantAskRuntimeAccessForUpdateTx({
    memberId: input.memberId,
    tx: input.tx,
  });
}

async function hasHostedAssistantAskRuntimeAccess(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  try {
    await requireHostedRuntimeActiveAccess(input.memberId, {
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

async function hasHostedAssistantAskRuntimeAccessForUpdateTx(input: {
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

async function isMatchingHostedAssistantAskCompletionTx(input: {
  completionId: string;
  expectedDeliveryMode: "reviewed_exact" | undefined;
  existingDedupeKey: string;
  existingExpiresAt: string | null;
  existingKind: string;
  existingUserId: string;
  expectedExpiresAt: string;
  expectedOriginAssistantInputId: string;
  expectedOriginMemberId: string;
  expectedOriginSessionId: string;
  expectedQuestion: string;
  expectedRequestId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  if (
    input.existingDedupeKey !== input.completionId
    || input.existingExpiresAt !== input.expectedExpiresAt
    || input.existingKind !== "assistant.ask.completed"
    || input.existingUserId !== input.expectedOriginMemberId
  ) {
    return false;
  }
  const wake = await readHostedMailboxWakeByItemId({
    availableAt: input.now,
    mailboxItemId: input.completionId,
    prisma: input.tx,
  });
  return Boolean(
    wake
    && isHostedExecutionAssistantAskCompletedWake(wake)
    && wake.eventId === input.completionId
    && wake.userId === input.expectedOriginMemberId
    && wake.ask.deliveryMode === input.expectedDeliveryMode
    && wake.ask.originAssistantInputId === input.expectedOriginAssistantInputId
    && wake.ask.originSessionId === input.expectedOriginSessionId
    && wake.ask.question === input.expectedQuestion
    && wake.ask.requestId === input.expectedRequestId
    && wake.ask.expiresAt === input.expectedExpiresAt,
  );
}

function resolveHostedAssistantAskMembership(input: {
  memberships: readonly HostedAssistantAskMembership[];
  requestedLabel: string | null;
}): {
  membership: HostedAssistantAskMembership | null;
  result: HostedRuntimeGroupAskResult | null;
} {
  if (input.memberships.length === 0) {
    return { membership: null, result: { status: "no_groups" } };
  }
  if (input.memberships.length > HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX) {
    return {
      membership: null,
      result: { status: "unavailable", unavailableReason: "too_many_groups" },
    };
  }

  if (input.requestedLabel === null && input.memberships.length === 1) {
    return { membership: input.memberships[0] ?? null, result: null };
  }

  const labels = readHostedAssistantAskClarificationLabels(input.memberships);
  if (input.requestedLabel === null) {
    return labels.length > 0
      ? {
          membership: null,
          result: { groupLabels: labels, status: "clarification_required" },
        }
      : {
          membership: null,
          result: { status: "unavailable", unavailableReason: "group_labels_unavailable" },
        };
  }

  const matches = input.memberships.filter((membership) =>
    normalizeHostedAssistantAskPersistedSelector(membership.group.displayName)
      === input.requestedLabel
  );
  if (matches.length === 1) {
    return { membership: matches[0] ?? null, result: null };
  }
  if (matches.length > 1) {
    return {
      membership: null,
      result: { status: "unavailable", unavailableReason: "ambiguous_group_label" },
    };
  }
  return labels.length > 0
    ? {
        membership: null,
        result: { groupLabels: labels, status: "clarification_required" },
      }
    : {
        membership: null,
        result: { status: "unavailable", unavailableReason: "group_label_unavailable" },
      };
}

function readHostedAssistantAskClarificationLabels(
  memberships: readonly HostedAssistantAskMembership[],
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const membership of memberships) {
    const displayLabel = sanitizeHostedAssistantAskDisplayLabel(
      membership.group.displayName,
    );
    const selector = normalizeHostedAssistantAskSelector(displayLabel);
    if (!displayLabel || !selector || seen.has(selector)) {
      continue;
    }
    seen.add(selector);
    result.push(displayLabel);
  }
  return result;
}

function isHostedAssistantAskDirectConversation(
  wake: HostedExecutionConversationMessageWake,
): boolean {
  if (wake.message.channel === "linq") {
    return wake.message.linqMessage.threadIsDirect === true;
  }
  if (wake.message.channel === "email") {
    return wake.message.threadIsDirect === true;
  }
  return wake.message.channel === "telegram";
}

function isHostedAssistantAskBoundGroupConversation(
  wake: HostedExecutionConversationMessageWake,
  groupRuntimeMemberId: string,
): wake is HostedExecutionConversationMessageWake & {
  message: Extract<
    HostedExecutionConversationMessageWake["message"],
    { channel: "linq" }
  > & { routeAuthority: NonNullable<Extract<
    HostedExecutionConversationMessageWake["message"],
    { channel: "linq" }
  >["routeAuthority"]> };
} {
  return wake.message.channel === "linq"
    && wake.message.linqMessage.threadIsDirect === false
    && wake.message.routeAuthority?.containerMemberId === groupRuntimeMemberId
    && wake.message.routeAuthority.threadId === wake.message.linqMessage.chatId;
}

function normalizeHostedAssistantAskSelector(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = sanitizeHostedAssistantAskDisplayLabel(value);
  if (!normalized) {
    throw new TypeError("Hosted assistant ask group label must not be blank.");
  }
  if (
    [...normalized].length
    > HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS
  ) {
    throw new TypeError("Hosted assistant ask group label is too long.");
  }
  return normalized.toLocaleLowerCase("und");
}

function normalizeHostedAssistantAskPersistedSelector(
  value: string | null | undefined,
): string | null {
  const normalized = sanitizeHostedAssistantAskDisplayLabel(value);
  return normalized ? normalized.toLocaleLowerCase("und") : null;
}

function sanitizeHostedAssistantAskDisplayLabel(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .normalize("NFC")
    .replace(HOSTED_ASSISTANT_ASK_UNSAFE_LABEL_PATTERN, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) {
    return null;
  }
  return normalized;
}

function normalizeHostedAssistantAskText(input: {
  label: string;
  maxCodePoints: number;
  value: string;
}): string {
  const normalized = input.value.trim();
  const codePoints = [...normalized].length;
  if (codePoints === 0 || codePoints > input.maxCodePoints) {
    throw new TypeError(
      `${input.label} must contain between 1 and ${input.maxCodePoints} Unicode code points.`,
    );
  }
  return normalized;
}

function isHostedAssistantAskExpired(
  expiresAt: string | null,
  now: Date,
): boolean {
  if (!expiresAt) {
    return true;
  }
  const expiresAtMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime();
}

function throwHostedAssistantAskDeliveryAuthorityMismatch(): never {
  throw hostedOnboardingError({
    code: "HOSTED_ASSISTANT_ASK_DELIVERY_AUTHORITY_MISMATCH",
    httpStatus: 403,
    message: "Hosted Assistant Ask delivery authority is no longer valid.",
    retryable: false,
  });
}

async function acquireHostedAssistantAskLockTx(
  tx: Prisma.TransactionClient,
  requestId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${HOSTED_ASSISTANT_ASK_ADVISORY_LOCK_NAMESPACE}),
      hashtext(${requestId})
    )
  `;
}

function unavailableAdmission(
  unavailableReason: string,
): {
  mailboxWake: null;
  result: Extract<HostedRuntimeGroupAskResult, { status: "unavailable" }>;
} {
  return {
    mailboxWake: null,
    result: { status: "unavailable", unavailableReason },
  };
}
