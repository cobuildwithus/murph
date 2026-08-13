import "server-only";

import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionAssistantAskCompletedWake,
  buildHostedExecutionAssistantAskRequestedWake,
  buildHostedExecutionAssistantNotificationRequestedWake,
  createHostedExecutionAssistantAskCompletionId,
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_ANSWER_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_PERMISSION_TEXT_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT,
  HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
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
  HostedRuntimeGroupCurrentSenderDirectResult,
} from "@murphai/hosted-execution/runtime-control";

import {
  appendHostedMailboxEnvelopeWithIdentityTx,
  readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
  readHostedMailboxConversationWakeByAssistantInputId,
  readHostedMailboxItemById,
  readHostedMailboxWakeByDedupeKey,
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
  "murph.hosted-group-current-sender-assistant-ask.request.v3";
const HOSTED_GROUP_CURRENT_SENDER_LEGACY_ASSISTANT_ASK_REQUEST_ID_NAMESPACE =
  "murph.hosted-group-current-sender-assistant-ask.request.v1";
const HOSTED_GROUP_CURRENT_SENDER_LEGACY_PRIVATE_ASSISTANT_ASK_REQUEST_ID_NAMESPACE =
  "murph.hosted-group-current-sender-private-assistant-ask.request.v1";
const HOSTED_GROUP_CURRENT_SENDER_PRIVATE_DELIVERY_ID_NAMESPACE =
  "murph.hosted-group-current-sender.private-delivery.v1";
const HOSTED_GROUP_CURRENT_SENDER_LEGACY_PRIVATE_FALLBACK_ID_NAMESPACE =
  "murph.hosted-group-current-sender.legacy-private-fallback.v1";
const HOSTED_GROUP_CURRENT_SENDER_PRIVATE_NOTIFICATION_INSTRUCTIONS =
  "Private current-sender Assistant Ask completion; exact reviewed text is in responsePolicy.";
const HOSTED_GROUP_CURRENT_SENDER_PRIVATE_UNAVAILABLE_TEXT =
  "I don't have enough context to answer that privately yet.";
const HOSTED_GROUP_CURRENT_SENDER_DIRECT_ROUTE_GUIDANCE =
  "Ask the sender to open a direct chat with Murph on this channel, then try again.";
const HOSTED_GROUP_CURRENT_SENDER_CLARIFICATION_GUIDANCE =
  "No pending audience clarification was found for this sender.";
const HOSTED_ASSISTANT_ASK_ADVISORY_LOCK_NAMESPACE = "hosted-assistant-ask";
const HOSTED_ASSISTANT_ASK_OPAQUE_ID_MAX_CODE_POINTS = 256;
const HOSTED_EXECUTION_ASSISTANT_INPUT_ID_PATTERN = /^ain_[0-9a-f]{32}$/u;

for (const [label, permissionText] of [
  ["Hosted current-sender group permission", HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT],
  ["Hosted current-sender private permission", HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT],
] as const) {
  if ([...permissionText].length > HOSTED_EXECUTION_ASSISTANT_ASK_PERMISSION_TEXT_MAX_CODE_POINTS) {
    throw new TypeError(`${label} is too long.`);
  }
}

type HostedCurrentSenderAssistantAskPrismaClient = Pick<PrismaClient, "$transaction">;
export type HostedGroupCurrentSenderAudience = "group" | "current_sender";
export type HostedGroupCurrentSenderAssistantAskTargetKind =
  | "group_sender"
  | "group_sender_private";

interface HostedGroupCurrentSenderSourceAuthority {
  causalSeq: string;
  groupRuntimeMemberId: string;
  occurredAt: string;
  question: string;
  sourceChannel: "linq" | "telegram";
  targetMemberId: string;
}

export interface HostedGroupCurrentSenderAssistantAskAuthority {
  audience: HostedGroupCurrentSenderAudience;
  groupRuntimeMemberId: string;
  occurredAt: string;
  permissionDigest: string;
  permissionText: string;
  personalReadAllowed: boolean;
  question: string;
  requestId: string;
  sourceChannel: "linq" | "telegram" | null;
  targetMemberId: string;
}

export type HostedGroupCurrentSenderCompletionAuthority =
  HostedGroupCurrentSenderAssistantAskAuthority & {
    expiresAt: string;
    origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  };
export type HostedGroupCurrentSenderPrivateCompletionAuthority =
  HostedGroupCurrentSenderCompletionAuthority;

export interface HostedGroupCurrentSenderAssistantAskAdmission {
  mailboxWake: { expectedUserId: string; mailboxItemId: string } | null;
  result: HostedRuntimeGroupCurrentSenderDirectResult;
}

class HostedCurrentSenderAdmissionRollback extends Error {
  constructor(
    readonly admission: HostedGroupCurrentSenderAssistantAskAdmission,
  ) {
    super("Hosted current-sender admission did not commit.");
  }
}

export function createHostedGroupCurrentSenderAssistantAskRequestId(input: {
  groupRuntimeMemberId: string;
  originAssistantInputId: string;
}): string {
  return createHostedGroupCurrentSenderRequestId(input, {
    namespace: HOSTED_GROUP_CURRENT_SENDER_ASSISTANT_ASK_REQUEST_ID_NAMESPACE,
  });
}

export function createHostedGroupCurrentSenderLegacyAssistantAskRequestId(input: {
  audience: HostedGroupCurrentSenderAudience;
  groupRuntimeMemberId: string;
  originAssistantInputId: string;
}): string {
  return createHostedGroupCurrentSenderRequestId(
    input,
    input.audience === "current_sender"
      ? {
          namespace: HOSTED_GROUP_CURRENT_SENDER_LEGACY_PRIVATE_ASSISTANT_ASK_REQUEST_ID_NAMESPACE,
          permissionText: HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
        }
      : {
          namespace: HOSTED_GROUP_CURRENT_SENDER_LEGACY_ASSISTANT_ASK_REQUEST_ID_NAMESPACE,
          permissionText: HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT,
        },
  );
}

export function readHostedGroupCurrentSenderAssistantAskRequestIds(input: {
  groupRuntimeMemberId: string;
  originAssistantInputId: string;
}): readonly [string, string, string] {
  return [
    createHostedGroupCurrentSenderAssistantAskRequestId(input),
    createHostedGroupCurrentSenderLegacyAssistantAskRequestId({
      ...input,
      audience: "group",
    }),
    createHostedGroupCurrentSenderLegacyAssistantAskRequestId({
      ...input,
      audience: "current_sender",
    }),
  ];
}

function createHostedGroupCurrentSenderRequestId(
  input: { groupRuntimeMemberId: string; originAssistantInputId: string },
  config: { namespace: string; permissionText?: string },
): string {
  const groupRuntimeMemberId = normalizeHostedCurrentSenderOpaqueId(
    input.groupRuntimeMemberId,
    "Hosted current-sender group runtime member ID",
  );
  const originAssistantInputId = normalizeHostedCurrentSenderAssistantInputId(
    input.originAssistantInputId,
  );
  const hash = createHash("sha256")
    .update(config.namespace)
    .update("\0")
    .update(groupRuntimeMemberId)
    .update("\0")
    .update(originAssistantInputId);
  if (config.permissionText !== undefined) {
    hash.update("\0").update(
      createHostedGroupCurrentSenderPermissionDigest(config.permissionText),
    );
  }
  return `aask_req_${hash.digest("hex")}`;
}

export async function requestHostedGroupCurrentSenderAssistantAsk(input: {
  audience?: HostedGroupCurrentSenderAudience;
  groupRuntimeMemberId: string;
  mode: "clarification" | "continuation" | "new";
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
  if (
    (input.mode === "clarification" && input.audience !== undefined)
    || (input.mode !== "clarification" && input.audience === undefined)
  ) {
    throw new TypeError(
      "Hosted current-sender audience must be omitted only for clarification.",
    );
  }
  if (input.mode === "clarification") {
    return await createHostedGroupCurrentSenderClarification({
      groupRuntimeMemberId,
      now,
      origin,
      prisma,
    });
  }
  if (input.mode === "continuation") {
    return await continueHostedGroupCurrentSenderAssistantAsk({
      audience: input.audience!,
      groupRuntimeMemberId,
      now,
      origin,
      prisma,
    });
  }
  return await prisma.$transaction(async (tx) =>
    await requestHostedGroupCurrentSenderAssistantAskTx({
      audience: input.audience!,
      groupRuntimeMemberId,
      now,
      origin,
      tx,
    })
  );
}

async function requestHostedGroupCurrentSenderAssistantAskTx(input: {
  audience: HostedGroupCurrentSenderAudience;
  groupRuntimeMemberId: string;
  now: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupCurrentSenderAssistantAskAdmission> {
  const requestIds = readHostedGroupCurrentSenderAssistantAskRequestIds({
    groupRuntimeMemberId: input.groupRuntimeMemberId,
    originAssistantInputId: input.origin.assistantInputId,
  });
  const requestId = requestIds[0];

  await acquireHostedCurrentSenderAssistantAskLocksTx(input.tx, requestIds);
  const existingItems: Array<{
    item: NonNullable<Awaited<ReturnType<typeof readHostedMailboxItemById>>>;
    requestId: string;
  }> = [];
  for (const candidateId of requestIds) {
    const item = await readHostedMailboxItemById({
      mailboxItemId: candidateId,
      prisma: input.tx,
    });
    if (item) existingItems.push({ item, requestId: candidateId });
  }
  if (existingItems.length > 1) {
    return unavailableHostedCurrentSenderAdmission("request_conflict");
  }
  const existing = existingItems[0];
  if (existing) {
    return replayHostedGroupCurrentSenderAssistantAskTx({
      audience: input.audience,
      existingDedupeKey: existing.item.dedupeKey,
      existingKind: existing.item.kind,
      existingUserId: existing.item.userId,
      expiresAt: existing.item.expiresAt ?? null,
      groupRuntimeMemberId: input.groupRuntimeMemberId,
      now: input.now,
      origin: input.origin,
      requestId: existing.requestId,
      tx: input.tx,
    });
  }

  const sourceAuthority = await readHostedGroupCurrentSenderSourceAuthorityTx({
    expectedGroupRuntimeMemberId: input.groupRuntimeMemberId,
    now: input.now,
    origin: input.origin,
    tx: input.tx,
  });
  if (!sourceAuthority) {
    return unavailableHostedCurrentSenderAdmission("current_sender_unavailable");
  }
  const targetKind = targetKindForHostedCurrentSenderAudience(input.audience);
  const permissionText = permissionTextForHostedCurrentSenderAudience(input.audience);
  const authority = {
    audience: input.audience,
    groupRuntimeMemberId: input.groupRuntimeMemberId,
    occurredAt: sourceAuthority.occurredAt,
    permissionDigest: createHostedGroupCurrentSenderPermissionDigest(permissionText),
    permissionText,
    personalReadAllowed: true,
    question: sourceAuthority.question,
    requestId,
    sourceChannel: sourceAuthority.sourceChannel,
    targetMemberId: sourceAuthority.targetMemberId,
  } satisfies HostedGroupCurrentSenderAssistantAskAuthority;
  if (
    input.audience === "current_sender"
    && !await resolveHostedGroupCurrentSenderPrivateDestination({
      authority,
      tx: input.tx,
    })
  ) {
    return unavailableHostedCurrentSenderAdmission(HOSTED_GROUP_CURRENT_SENDER_DIRECT_ROUTE_GUIDANCE);
  }

  const occurredAt = input.now.toISOString();
  const expiresAt = new Date(
    input.now.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  ).toISOString();
  const wake = buildHostedExecutionAssistantAskRequestedWake({
    ask: {
      expiresAt,
      origin: input.origin,
      question: authority.question,
      target: {
        groupRuntimeMemberId: input.groupRuntimeMemberId,
        kind: targetKind,
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
    tx: input.tx,
  });
  if (append.dedupeConflict || append.item.id !== requestId) {
    return unavailableHostedCurrentSenderAdmission("request_conflict");
  }
  return {
    mailboxWake: { expectedUserId: authority.targetMemberId, mailboxItemId: requestId },
    result: { status: "accepted" },
  };
}

async function createHostedGroupCurrentSenderClarification(input: {
  groupRuntimeMemberId: string;
  now: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  prisma: HostedCurrentSenderAssistantAskPrismaClient;
}): Promise<HostedGroupCurrentSenderAssistantAskAdmission> {
  return await input.prisma.$transaction(async (tx) => {
    const source = await readHostedGroupCurrentSenderSourceAuthorityTx({
      expectedGroupRuntimeMemberId: input.groupRuntimeMemberId,
      now: input.now,
      origin: input.origin,
      tx,
    });
    if (!source) {
      return unavailableHostedCurrentSenderAdmission(
        "current_sender_unavailable",
      );
    }
    const expiresAt = new Date(
      input.now.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
    );
    await tx.hostedGroupCurrentSenderClarification.upsert({
      create: {
        expiresAt,
        groupRuntimeMemberId: source.groupRuntimeMemberId,
        originAssistantInputId: input.origin.assistantInputId,
        originSessionId: input.origin.sessionId,
        sourceCausalSeq: BigInt(source.causalSeq),
        targetMemberId: source.targetMemberId,
      },
      update: {
        expiresAt,
        originAssistantInputId: input.origin.assistantInputId,
        originSessionId: input.origin.sessionId,
        resolvedAudience: null,
        resolvedByAssistantInputId: null,
        sourceCausalSeq: BigInt(source.causalSeq),
      },
      where: {
        groupRuntimeMemberId_targetMemberId: {
          groupRuntimeMemberId: source.groupRuntimeMemberId,
          targetMemberId: source.targetMemberId,
        },
      },
    });
    return {
      mailboxWake: null,
      result: { status: "clarification_required" },
    };
  });
}

async function continueHostedGroupCurrentSenderAssistantAsk(input: {
  audience: HostedGroupCurrentSenderAudience;
  groupRuntimeMemberId: string;
  now: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  prisma: HostedCurrentSenderAssistantAskPrismaClient;
}): Promise<HostedGroupCurrentSenderAssistantAskAdmission> {
  let admission: HostedGroupCurrentSenderAssistantAskAdmission | null;
  try {
    admission = await input.prisma.$transaction(async (tx) => {
      const responseSource = await readHostedGroupCurrentSenderSourceAuthorityTx({
        expectedGroupRuntimeMemberId: input.groupRuntimeMemberId,
        now: input.now,
        origin: input.origin,
        tx,
      });
      if (!responseSource) {
        return null;
      }
      const pending = await tx.hostedGroupCurrentSenderClarification.findUnique({
        where: {
          groupRuntimeMemberId_targetMemberId: {
            groupRuntimeMemberId: responseSource.groupRuntimeMemberId,
            targetMemberId: responseSource.targetMemberId,
          },
        },
      });
      if (
        !pending
        || pending.expiresAt <= input.now
        || BigInt(responseSource.causalSeq) <= pending.sourceCausalSeq
        || (
          pending.resolvedByAssistantInputId !== null
          && (
            pending.resolvedByAssistantInputId !== input.origin.assistantInputId
            || pending.resolvedAudience !== input.audience
          )
        )
      ) {
        return null;
      }
      if (pending.resolvedByAssistantInputId === null) {
        const claimed = await tx.hostedGroupCurrentSenderClarification.updateMany({
          data: {
            resolvedAudience: input.audience,
            resolvedByAssistantInputId: input.origin.assistantInputId,
          },
          where: {
            expiresAt: pending.expiresAt,
            groupRuntimeMemberId: responseSource.groupRuntimeMemberId,
            originAssistantInputId: pending.originAssistantInputId,
            originSessionId: pending.originSessionId,
            resolvedByAssistantInputId: null,
            targetMemberId: responseSource.targetMemberId,
          },
        });
        if (claimed.count !== 1) {
          const resolved = await tx.hostedGroupCurrentSenderClarification.findUnique({
            where: {
              groupRuntimeMemberId_targetMemberId: {
                groupRuntimeMemberId: responseSource.groupRuntimeMemberId,
                targetMemberId: responseSource.targetMemberId,
              },
            },
          });
          if (
            !resolved
            || resolved.expiresAt <= input.now
            || resolved.originAssistantInputId !== pending.originAssistantInputId
            || resolved.originSessionId !== pending.originSessionId
            || resolved.resolvedAudience !== input.audience
            || resolved.resolvedByAssistantInputId !== input.origin.assistantInputId
          ) {
            return null;
          }
        }
      }
      const originalAdmission = await requestHostedGroupCurrentSenderAssistantAskTx({
        audience: input.audience,
        groupRuntimeMemberId: input.groupRuntimeMemberId,
        now: input.now,
        origin: {
          assistantInputId: pending.originAssistantInputId,
          kind: "accepted_input",
          sessionId: pending.originSessionId,
        },
        tx,
      });
      if (originalAdmission.result.status !== "accepted") {
        throw new HostedCurrentSenderAdmissionRollback(originalAdmission);
      }
      return originalAdmission;
    });
  } catch (error) {
    if (error instanceof HostedCurrentSenderAdmissionRollback) {
      return error.admission;
    }
    throw error;
  }
  if (!admission) {
    return unavailableHostedCurrentSenderAdmission(
      HOSTED_GROUP_CURRENT_SENDER_CLARIFICATION_GUIDANCE,
    );
  }
  return admission;
}

type HostedGroupCurrentSenderAuthorityReadInput = {
  expectedGroupRuntimeMemberId: string;
  expectedTargetMemberId?: string | null;
  now: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  persistedOccurredAt?: string | null;
  persistedQuestion?: string | null;
  tx: Prisma.TransactionClient;
};

async function readHostedGroupCurrentSenderSourceAuthorityTx(
  input: HostedGroupCurrentSenderAuthorityReadInput,
): Promise<HostedGroupCurrentSenderSourceAuthority | null> {
  const groupRuntimeMemberId = normalizeHostedCurrentSenderOpaqueId(
    input.expectedGroupRuntimeMemberId,
    "Hosted current-sender group runtime member ID",
  );
  const origin = normalizeHostedCurrentSenderOrigin(input.origin);
  const groupContainer = await input.tx.hostedThreadContainer.findUnique({
    select: { memberId: true },
    where: { memberId: groupRuntimeMemberId },
  });
  if (!groupContainer || !await hasHostedCurrentSenderRuntimeAccessForUpdateTx({ memberId: groupRuntimeMemberId, tx: input.tx })) {
    return null;
  }

  const sourceWake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: origin.assistantInputId,
    availableAt: input.now,
    memberId: groupRuntimeMemberId,
    prisma: input.tx,
  });
  const source = sourceWake ? readHostedCurrentSenderSource(sourceWake, groupRuntimeMemberId) : null;
  if (!source || !sourceWake) return null;
  const sourceInputAuthority =
    await readHostedMailboxConversationInputAuthorityByAssistantInputIdTx({
      assistantInputId: origin.assistantInputId,
      memberId: groupRuntimeMemberId,
      prisma: input.tx,
    });
  if (!sourceInputAuthority) return null;
  try {
    await assertHostedThreadRouteEgressAuthority({ authority: source.routeAuthority, prisma: input.tx });
  } catch (error) {
    if (isHostedOnboardingError(error) && error.code === "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED" && !error.retryable) {
      return null;
    }
    throw error;
  }

  const senderMemberId = await resolveHostedGroupMessageSenderMemberId({
    prisma: input.tx,
    routeAuthority: source.routeAuthority,
    wake: sourceWake,
  });
  if (!senderMemberId) return null;
  const expectedTargetMemberId = input.expectedTargetMemberId == null
    ? null
    : normalizeHostedCurrentSenderOpaqueId(input.expectedTargetMemberId, "Hosted current-sender target member ID");
  if (expectedTargetMemberId !== null && senderMemberId !== expectedTargetMemberId) return null;
  const targetContainer = await input.tx.hostedThreadContainer.findUnique({
    select: { memberId: true },
    where: { memberId: senderMemberId },
  });
  if (targetContainer || !await hasHostedCurrentSenderRuntimeAccessForUpdateTx({ memberId: senderMemberId, tx: input.tx })) {
    return null;
  }

  return {
    causalSeq: sourceInputAuthority.causalSeq,
    groupRuntimeMemberId,
    occurredAt: sourceWake.occurredAt,
    question: source.question,
    sourceChannel: source.sourceChannel,
    targetMemberId: senderMemberId,
  };
}

export async function readHostedGroupCurrentSenderAssistantAskAuthorityTx(
  input: HostedGroupCurrentSenderAuthorityReadInput & {
    permissionDigest: string;
    requestId: string;
    targetKind: HostedGroupCurrentSenderAssistantAskTargetKind;
  },
): Promise<HostedGroupCurrentSenderAssistantAskAuthority | null> {
  const storedRequest = readHostedGroupCurrentSenderStoredRequest({
    groupRuntimeMemberId: input.expectedGroupRuntimeMemberId,
    originAssistantInputId: input.origin.assistantInputId,
    permissionDigest: input.permissionDigest,
    requestId: input.requestId,
    targetKind: input.targetKind,
  });
  if (!storedRequest) {
    return null;
  }
  const sourceAuthority = await readHostedGroupCurrentSenderSourceAuthorityTx(
    input,
  );
  if (!sourceAuthority) {
    const targetMemberId = input.expectedTargetMemberId == null
      ? null
      : normalizeHostedCurrentSenderOpaqueId(
          input.expectedTargetMemberId,
          "Hosted current-sender target member ID",
        );
    const question = readHostedCurrentSenderPersistedQuestion(
      input.persistedQuestion,
    );
    if (!targetMemberId || !question) {
      return null;
    }
    const audience = storedRequest.fixedAudience ?? "group";
    return {
      audience,
      groupRuntimeMemberId: normalizeHostedCurrentSenderOpaqueId(
        input.expectedGroupRuntimeMemberId,
        "Hosted current-sender group runtime member ID",
      ),
      occurredAt: input.persistedOccurredAt ?? input.now.toISOString(),
      permissionDigest: input.permissionDigest,
      permissionText: permissionTextForHostedCurrentSenderAudience(audience),
      personalReadAllowed: false,
      question,
      requestId: input.requestId,
      sourceChannel: null,
      targetMemberId,
    };
  }

  const audience = storedRequest.fixedAudience ?? "group";
  const permissionText = permissionTextForHostedCurrentSenderAudience(audience);
  const authority = {
    audience,
    groupRuntimeMemberId: sourceAuthority.groupRuntimeMemberId,
    occurredAt: sourceAuthority.occurredAt,
    permissionDigest: input.permissionDigest,
    permissionText,
    personalReadAllowed: true,
    question: sourceAuthority.question,
    requestId: input.requestId,
    sourceChannel: sourceAuthority.sourceChannel,
    targetMemberId: sourceAuthority.targetMemberId,
  } satisfies HostedGroupCurrentSenderAssistantAskAuthority;
  if (
    authority.personalReadAllowed
    && authority.audience === "current_sender"
    && !await resolveHostedGroupCurrentSenderPrivateDestination({
      authority,
      tx: input.tx,
    })
  ) {
    return { ...authority, personalReadAllowed: false };
  }
  return authority;
}

async function replayHostedGroupCurrentSenderAssistantAskTx(input: {
  audience: HostedGroupCurrentSenderAudience;
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
  if (input.existingDedupeKey !== input.requestId || input.existingKind !== "assistant.ask.requested") {
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
    || (wake.ask.target.kind !== "group_sender" && wake.ask.target.kind !== "group_sender_private")
    || wake.ask.target.groupRuntimeMemberId !== input.groupRuntimeMemberId
    || !hostedCurrentSenderOriginsEqual(wake.ask.origin, input.origin)
  ) {
    return unavailableHostedCurrentSenderAdmission("request_conflict");
  }
  const authority = await readHostedGroupCurrentSenderAssistantAskAuthorityTx({
    expectedGroupRuntimeMemberId: input.groupRuntimeMemberId,
    expectedTargetMemberId: input.existingUserId,
    now: input.now,
    origin: input.origin,
    permissionDigest: wake.ask.target.permissionDigest,
    persistedOccurredAt: wake.occurredAt,
    persistedQuestion: wake.ask.question,
    requestId: input.requestId,
    targetKind: wake.ask.target.kind,
    tx: input.tx,
  });
  if (!authority || authority.question !== wake.ask.question) {
    return unavailableHostedCurrentSenderAdmission("current_sender_unavailable");
  }
  if (authority.audience !== input.audience) {
    return unavailableHostedCurrentSenderAdmission("request_conflict");
  }
  return {
    mailboxWake: { expectedUserId: input.existingUserId, mailboxItemId: input.requestId },
    result: { status: "accepted" },
  };
}

type HostedGroupCurrentSenderStoredRequest = {
  fixedAudience: HostedGroupCurrentSenderAudience | null;
};

function readHostedGroupCurrentSenderStoredRequest(input: {
  groupRuntimeMemberId: string;
  originAssistantInputId: string;
  permissionDigest: string;
  requestId: string;
  targetKind: HostedGroupCurrentSenderAssistantAskTargetKind;
}): HostedGroupCurrentSenderStoredRequest | null {
  const targetAudience = audienceForHostedCurrentSenderTargetKind(
    input.targetKind,
  );
  const fixedPermissionText = permissionTextForHostedCurrentSenderAudience(
    targetAudience,
  );
  if (
    input.requestId === createHostedGroupCurrentSenderAssistantAskRequestId(input)
  ) {
    return input.permissionDigest
        === createHostedGroupCurrentSenderPermissionDigest(fixedPermissionText)
      ? { fixedAudience: targetAudience }
      : null;
  }
  for (const legacyAudience of ["group", "current_sender"] as const) {
    if (
      targetAudience === legacyAudience
      && input.requestId
        === createHostedGroupCurrentSenderLegacyAssistantAskRequestId({
          ...input,
          audience: legacyAudience,
        })
      && input.permissionDigest
        === createHostedGroupCurrentSenderPermissionDigest(
          permissionTextForHostedCurrentSenderAudience(legacyAudience),
        )
    ) {
      // Already-accepted v1 work keeps its persisted audience. The current
      // source is still reloaded before personal-model work can continue.
      return { fixedAudience: legacyAudience };
    }
  }
  return null;
}

function targetKindForHostedCurrentSenderAudience(
  audience: HostedGroupCurrentSenderAudience,
): HostedGroupCurrentSenderAssistantAskTargetKind {
  return audience === "current_sender" ? "group_sender_private" : "group_sender";
}

function audienceForHostedCurrentSenderTargetKind(
  targetKind: HostedGroupCurrentSenderAssistantAskTargetKind,
): HostedGroupCurrentSenderAudience {
  return targetKind === "group_sender_private" ? "current_sender" : "group";
}

function permissionTextForHostedCurrentSenderAudience(
  audience: HostedGroupCurrentSenderAudience,
): string {
  return audience === "current_sender"
    ? HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT
    : HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT;
}

export async function readHostedGroupCurrentSenderPrivateCompletionMailboxWakeTx(
  input: {
    authority: HostedGroupCurrentSenderPrivateCompletionAuthority;
    existingPrivateDelivery: {
      dedupeKey: string;
      expiresAt: string | null;
      kind: string;
      userId: string;
    };
    privateDeliveryId: string;
    now: Date;
    tx: Prisma.TransactionClient;
  },
): Promise<{
  expectedUserId: string;
  mailboxItemId: string;
} | null> {
  if (
    input.authority.audience !== "current_sender"
    || !input.authority.personalReadAllowed
    || (
      input.privateDeliveryId
        !== createHostedGroupCurrentSenderPrivateDeliveryId(
          input.authority.requestId,
        )
      && (
        input.privateDeliveryId
          !== createHostedExecutionAssistantAskCompletionId(
            input.authority.requestId,
          )
        || input.authority.requestId
          === createHostedGroupCurrentSenderAssistantAskRequestId({
            groupRuntimeMemberId: input.authority.groupRuntimeMemberId,
            originAssistantInputId:
              input.authority.origin.assistantInputId,
          })
      )
    )
    || input.existingPrivateDelivery.dedupeKey !== input.privateDeliveryId
    || input.existingPrivateDelivery.kind !== "assistant.notification.requested"
    || input.existingPrivateDelivery.userId !== input.authority.targetMemberId
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
    mailboxItemId: input.privateDeliveryId,
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
    input.privateDeliveryId,
  );
  const requestId = input.authority.requestId;
  if (
    !wake
    || wake.kind !== "assistant.notification.requested"
    || wake.eventId !== input.privateDeliveryId
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
    || !isHostedCurrentSenderPrivateCompletionEnvelopeValid({
      completionExpiresAt: privateCompletion.expiresAt,
      deliveryId: input.privateDeliveryId,
      envelopeExpiresAt: input.existingPrivateDelivery.expiresAt,
      occurredAt: wake.occurredAt,
      requestId,
    })
    || isHostedCurrentSenderAssistantAskExpired(
      input.existingPrivateDelivery.expiresAt,
      input.now,
    )
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
    mailboxItemId: input.privateDeliveryId,
  };
}

export async function appendHostedGroupCurrentSenderPrivateCompletionTx(input: {
  authority: HostedGroupCurrentSenderPrivateCompletionAuthority;
  now: Date;
  result: HostedExecutionAssistantAskResult;
  tx: Prisma.TransactionClient;
}): Promise<{
  expectedUserId: string;
  mailboxItemId: string;
} | null> {
  if (
    input.authority.audience !== "current_sender"
    || !input.authority.personalReadAllowed
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
  const privateDeliveryId = createHostedGroupCurrentSenderPrivateDeliveryId(
    input.authority.requestId,
  );
  const deliveryKey = createHostedGroupCurrentSenderPrivateDeliveryKey(
    privateDeliveryId,
  );
  const requestId = input.authority.requestId;
  const responseText = buildHostedGroupCurrentSenderPrivateResponseText(
    input.result,
  );
  const deliveryExpiresAt = new Date(
    input.now.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  ).toISOString();
  const wake = buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: privateDeliveryId,
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
    expiresAt: deliveryExpiresAt,
    itemId: privateDeliveryId,
    tx: input.tx,
  });
  if (append.dedupeConflict || append.item.id !== privateDeliveryId) {
    return null;
  }
  return {
    expectedUserId: input.authority.targetMemberId,
    mailboxItemId: privateDeliveryId,
  };
}

export function createHostedGroupCurrentSenderPrivateDeliveryId(
  requestId: string,
): string {
  return createHostedCurrentSenderDerivedId({
    namespace: HOSTED_GROUP_CURRENT_SENDER_PRIVATE_DELIVERY_ID_NAMESPACE,
    prefix: "aask_private_",
    requestId,
  });
}

function createHostedGroupCurrentSenderLegacyPrivateFallbackId(
  requestId: string,
): string {
  return createHostedCurrentSenderDerivedId({
    namespace:
      HOSTED_GROUP_CURRENT_SENDER_LEGACY_PRIVATE_FALLBACK_ID_NAMESPACE,
    prefix: "aask_done_",
    requestId,
  });
}

function createHostedCurrentSenderDerivedId(input: {
  namespace: string;
  prefix: string;
  requestId: string;
}): string {
  const requestId = normalizeHostedCurrentSenderOpaqueId(
    input.requestId,
    "Hosted current-sender request ID",
  );
  return `${input.prefix}${createHash("sha256")
    .update(input.namespace)
    .update("\0")
    .update(requestId)
    .digest("hex")}`;
}

export function createHostedGroupCurrentSenderFallbackCompletionId(input: {
  privateDeliveryId: string | null;
  requestId: string;
}): string {
  const canonicalCompletionId =
    createHostedExecutionAssistantAskCompletionId(input.requestId);
  return input.privateDeliveryId === canonicalCompletionId
    ? createHostedGroupCurrentSenderLegacyPrivateFallbackId(input.requestId)
    : canonicalCompletionId;
}

export async function appendHostedGroupCurrentSenderFallbackCompletionTx(input: {
  authority: HostedGroupCurrentSenderCompletionAuthority;
  completionId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<{
  expectedUserId: string;
  mailboxItemId: string;
} | null> {
  const expiresAt = new Date(
    input.now.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  ).toISOString();
  const wake = buildHostedExecutionAssistantAskCompletedWake({
    ask: {
      expiresAt,
      origin: input.authority.origin,
      question: input.authority.question,
      requestId: input.authority.requestId,
      result: { answer: null, outcome: "cannot_answer" },
      targetLabel: null,
    },
    eventId: input.completionId,
    memberId: input.authority.groupRuntimeMemberId,
    occurredAt: input.now.toISOString(),
  });
  const append = await appendHostedMailboxEnvelopeWithIdentityTx({
    envelope: wake,
    expiresAt,
    itemId: input.completionId,
    tx: input.tx,
  });
  if (append.dedupeConflict || append.item.id !== input.completionId) {
    const existing = await readHostedMailboxItemById({
      mailboxItemId: input.completionId,
      prisma: input.tx,
    });
    const existingWake = existing
      ? await readHostedMailboxWakeByDedupeKey({
          dedupeKey: input.completionId,
          prisma: input.tx,
          userId: input.authority.groupRuntimeMemberId,
        })
      : null;
    if (
      !existing
      || existing.dedupeKey !== input.completionId
      || existing.kind !== "assistant.ask.completed"
      || existing.userId !== input.authority.groupRuntimeMemberId
      || !existingWake
      || existingWake.kind !== "assistant.ask.completed"
      || existingWake.eventId !== input.completionId
      || existingWake.userId !== input.authority.groupRuntimeMemberId
      || existingWake.ask.requestId !== input.authority.requestId
      || existingWake.ask.question !== input.authority.question
      || existingWake.ask.targetLabel !== null
      || !("origin" in existingWake.ask)
      || existingWake.ask.origin.kind !== "accepted_input"
      || !hostedCurrentSenderOriginsEqual(
        existingWake.ask.origin,
        input.authority.origin,
      )
      || existingWake.ask.result.outcome !== "cannot_answer"
      || (existingWake.ask.result.answer ?? null) !== null
      || existing.expiresAt !== existingWake.ask.expiresAt
      || Date.parse(existingWake.ask.expiresAt)
        !== Date.parse(existingWake.occurredAt)
          + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS
      || Date.parse(existingWake.ask.expiresAt) <= input.now.getTime()
    ) {
      return null;
    }
  }
  return {
    expectedUserId: input.authority.groupRuntimeMemberId,
    mailboxItemId: input.completionId,
  };
}

export async function assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx(
  input: HostedExecutionPrivateAssistantAskCompletionDeliveryAuthority & {
    boundRuntimeMemberId: string;
    now?: Date;
    tx: Prisma.TransactionClient;
  },
): Promise<{
  assistantAskFallbackRequired: true;
  mailboxWake: { expectedUserId: string; mailboxItemId: string };
} | void> {
  const privateDeliveryId = input.answeredMailboxItemIds[0] ?? null;
  let expectedDeliveryKey: string;
  try {
    expectedDeliveryKey = privateDeliveryId
      ? createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
          privateDeliveryId,
        )
      : "";
  } catch {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }
  const now = input.now ?? new Date();
  const expiresAtMs = Date.parse(input.assistantAskCompletionExpiresAt);
  if (
    !privateDeliveryId
    || input.answeredMailboxItemIds.length !== 1
    || privateDeliveryId.trim() !== privateDeliveryId
    || input.idempotencyKey !== expectedDeliveryKey
    || !Number.isFinite(expiresAtMs)
    || new Date(expiresAtMs).toISOString()
      !== input.assistantAskCompletionExpiresAt
    || !/^[0-9a-f]{64}$/u.test(input.responseTextDigest)
  ) {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }

  const completionItem = await readHostedMailboxItemById({
    mailboxItemId: privateDeliveryId,
    prisma: input.tx,
  });
  if (
    !completionItem
    || completionItem.dedupeKey !== privateDeliveryId
    || completionItem.kind !== "assistant.notification.requested"
    || completionItem.userId !== input.boundRuntimeMemberId
  ) {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }

  const completionWake = await readHostedMailboxWakeByDedupeKey({
    dedupeKey: privateDeliveryId,
    prisma: input.tx,
    userId: input.boundRuntimeMemberId,
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
    || completionWake.eventId !== privateDeliveryId
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
    || !isHostedCurrentSenderPrivateCompletionEnvelopeValid({
      completionExpiresAt: privateCompletion.expiresAt,
      deliveryId: privateDeliveryId,
      envelopeExpiresAt: completionItem.expiresAt ?? null,
      occurredAt: completionWake.occurredAt,
      requestId: privateCompletion.requestId,
    })
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
    ? await readHostedMailboxWakeByDedupeKey({
        dedupeKey: privateCompletion.requestId,
        prisma: input.tx,
        userId: input.boundRuntimeMemberId,
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
    || (
      requestWake.ask.target.kind !== "group_sender"
      && requestWake.ask.target.kind !== "group_sender_private"
    )
  ) {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }

  const requestIds = readHostedGroupCurrentSenderAssistantAskRequestIds({
    groupRuntimeMemberId: requestWake.ask.target.groupRuntimeMemberId,
    originAssistantInputId: requestWake.ask.origin.assistantInputId,
  });
  await acquireHostedCurrentSenderAssistantAskLocksTx(input.tx, requestIds);
  let storedRequestCount = 0;
  for (const requestId of requestIds) {
    if (await readHostedMailboxItemById({
      mailboxItemId: requestId,
      prisma: input.tx,
    })) {
      storedRequestCount += 1;
    }
  }
  if (
    storedRequestCount !== 1
    || !requestIds.includes(privateCompletion.requestId)
    || (
      privateDeliveryId
        !== createHostedGroupCurrentSenderPrivateDeliveryId(
          privateCompletion.requestId,
        )
      && (
        privateDeliveryId
          !== createHostedExecutionAssistantAskCompletionId(
            privateCompletion.requestId,
          )
        || privateCompletion.requestId
          === createHostedGroupCurrentSenderAssistantAskRequestId({
            groupRuntimeMemberId:
              requestWake.ask.target.groupRuntimeMemberId,
            originAssistantInputId:
              requestWake.ask.origin.assistantInputId,
          })
      )
    )
  ) {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }

  const authority =
    await readHostedGroupCurrentSenderAssistantAskAuthorityTx({
      expectedGroupRuntimeMemberId:
        requestWake.ask.target.groupRuntimeMemberId,
      expectedTargetMemberId: input.boundRuntimeMemberId,
      now,
      origin: requestWake.ask.origin,
      permissionDigest: requestWake.ask.target.permissionDigest,
      persistedOccurredAt: requestWake.occurredAt,
      persistedQuestion: requestWake.ask.question,
      requestId: privateCompletion.requestId,
      targetKind: requestWake.ask.target.kind,
      tx: input.tx,
    });
  if (
    !authority
    || authority.audience !== "current_sender"
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
    expiresAtMs > now.getTime()
    && authority.personalReadAllowed
    && destination
    && hostedGroupCurrentSenderPrivateRoutesEqual(
      destination.route,
      notification.route,
    )
    && hostedGroupCurrentSenderPrivateRoutesEqual(
      destination.route,
      input.route,
    )
  ) {
    return;
  }

  const mailboxWake =
    await appendHostedGroupCurrentSenderFallbackCompletionTx({
      authority: {
        ...authority,
        expiresAt: requestWake.ask.expiresAt,
        origin: requestWake.ask.origin,
      },
      completionId: createHostedGroupCurrentSenderFallbackCompletionId({
        privateDeliveryId,
        requestId: privateCompletion.requestId,
      }),
      now,
      tx: input.tx,
    });
  if (!mailboxWake) {
    throwHostedGroupCurrentSenderPrivateDeliveryAuthorityMismatch();
  }
  return { assistantAskFallbackRequired: true, mailboxWake };
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
  if (input.authority.sourceChannel === null) {
    return null;
  }
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
  question: string;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  sourceChannel: "linq" | "telegram";
} | null {
  if (wake.userId !== groupRuntimeMemberId) {
    return null;
  }
  const message = wake.message;
  let routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  let sourceChannel: "linq" | "telegram";
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
  const question = readHostedExecutionConversationMessageText(message);
  if (
    !question
    || [...question].length > HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS
  ) {
    return null;
  }
  return { question, routeAuthority, sourceChannel };
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

function readHostedCurrentSenderPersistedQuestion(
  value: string | null | undefined,
): string | null {
  return typeof value === "string"
    && value.trim().length > 0
    && [...value].length <= HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS
    ? value
    : null;
}

function createHostedGroupCurrentSenderPermissionDigest(
  permissionText: string,
): string {
  return createHash("sha256").update(permissionText).digest("hex");
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

function isHostedCurrentSenderPrivateCompletionEnvelopeValid(input: {
  completionExpiresAt: string;
  deliveryId: string;
  envelopeExpiresAt: string | null;
  occurredAt: string;
  requestId: string;
}): boolean {
  if (!input.envelopeExpiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(input.envelopeExpiresAt);
  const occurredAtMs = Date.parse(input.occurredAt);
  const freshEnvelope = Number.isFinite(expiresAtMs)
    && Number.isFinite(occurredAtMs)
    && new Date(expiresAtMs).toISOString() === input.envelopeExpiresAt
    && new Date(occurredAtMs).toISOString() === input.occurredAt
    && expiresAtMs
      === occurredAtMs + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS;
  if (freshEnvelope) {
    return true;
  }
  return input.deliveryId
      === createHostedExecutionAssistantAskCompletionId(input.requestId)
    && input.envelopeExpiresAt === input.completionExpiresAt;
}

function unavailableHostedCurrentSenderAdmission(
  unavailableReason: string,
): HostedGroupCurrentSenderAssistantAskAdmission {
  return {
    mailboxWake: null,
    result: { status: "unavailable", unavailableReason },
  };
}

async function acquireHostedCurrentSenderAssistantAskLocksTx(
  tx: Prisma.TransactionClient,
  requestIds: readonly string[],
): Promise<void> {
  for (const requestId of [...new Set(requestIds)].sort()) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${HOSTED_ASSISTANT_ASK_ADVISORY_LOCK_NAMESPACE}),
        hashtext(${requestId})
      )
    `;
  }
}
