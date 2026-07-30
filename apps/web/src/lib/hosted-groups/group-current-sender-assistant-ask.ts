import "server-only";

import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionAssistantAskRequestedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_PERMISSION_TEXT_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  isHostedExecutionAssistantAskRequestedWake,
  readHostedExecutionConversationMessageText,
  type HostedExecutionAssistantAskAcceptedInputOrigin,
  type HostedExecutionConversationMessageWake,
  type HostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution/contracts";
import type {
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
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import {
  assertHostedThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";
import { getPrisma } from "../prisma";
import {
  resolveHostedGroupMessageSenderMemberId,
} from "./group-message-sender";

const HOSTED_GROUP_CURRENT_SENDER_ASSISTANT_ASK_REQUEST_ID_NAMESPACE =
  "murph.hosted-group-current-sender-assistant-ask.request.v1";
const HOSTED_ASSISTANT_ASK_ADVISORY_LOCK_NAMESPACE = "hosted-assistant-ask";
const HOSTED_ASSISTANT_ASK_OPAQUE_ID_MAX_CODE_POINTS = 256;
const HOSTED_EXECUTION_ASSISTANT_INPUT_ID_PATTERN = /^ain_[0-9a-f]{32}$/u;

const HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_AFFIRMATIVE_PATTERN =
  /^(?:yes|yeah|yep|yup|ok|okay|sure|confirm(?:ed)?|approve(?:d)?|go ahead|please do)\b/u;
const HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_PRIVATE_MURPH_PATTERN =
  /\bprivate murph\b/u;
const HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_DISCLOSURE_PATTERN =
  /\b(?:share|send|post|tell|summari[sz]e|compare)\b/u;
const HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_DISCLOSURE_GLOBAL_PATTERN =
  /\b(?:share|send|post|tell|summari[sz]e|compare)\b/gu;
const HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_DENIAL_PATTERN =
  /\b(?:(?:do not|don't|dont|never|not)\s+(?:ask|use|share|send|post|tell|summari[sz]e|compare)|no\s+(?:sharing|disclosure)|(?:stop|cancel)\s+(?:this|it|the request|sharing|disclosure))\b/u;
const HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_BOILERPLATE_TOKENS = new Set([
  "a",
  "about",
  "all",
  "and",
  "any",
  "anything",
  "answer",
  "ask",
  "data",
  "details",
  "everyone",
  "everything",
  "from",
  "group",
  "here",
  "info",
  "information",
  "it",
  "me",
  "my",
  "of",
  "please",
  "room",
  "someone",
  "something",
  "summary",
  "that",
  "the",
  "them",
  "this",
  "to",
  "us",
  "use",
  "with",
  "you",
  "your",
]);

export const HOSTED_GROUP_CURRENT_SENDER_DISCLOSURE_PERMISSION_TEXT =
  "The owner of this personal Murph authored the exact incoming group question and may authorize one answer to that same group. Answer only when that question clearly asks Murph to share information about the owner. Treat first-person references as the owner, disclose only the owner's information directly requested by the question, and disclose nothing about anyone else. This authorization applies once to this question and grants no future, scheduled, or broader access.";

if (
  [...HOSTED_GROUP_CURRENT_SENDER_DISCLOSURE_PERMISSION_TEXT].length
    > HOSTED_EXECUTION_ASSISTANT_ASK_PERMISSION_TEXT_MAX_CODE_POINTS
) {
  throw new TypeError("Hosted current-sender disclosure permission is too long.");
}

type HostedCurrentSenderAssistantAskPrismaClient = Pick<PrismaClient, "$transaction">;

export interface HostedGroupCurrentSenderAssistantAskAuthority {
  groupRuntimeMemberId: string;
  permissionDigest: string;
  permissionText: string;
  question: string;
  targetMemberId: string;
}

export interface HostedGroupCurrentSenderAssistantAskAdmission {
  mailboxWake: {
    expectedUserId: string;
    mailboxItemId: string;
  } | null;
  result: HostedRuntimeGroupMemberAskResult;
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

    const disclosureIntro = await tx.hostedMember.findUnique({
      select: { groupPrivateDisclosureIntroAcknowledgedAt: true },
      where: { id: authority.targetMemberId },
    });
    if (!disclosureIntro) {
      return unavailableHostedCurrentSenderAdmission("current_sender_unavailable");
    }
    if (disclosureIntro.groupPrivateDisclosureIntroAcknowledgedAt === null) {
      if (!isHostedGroupCurrentSenderDisclosureConfirmation(authority.question)) {
        return {
          mailboxWake: null,
          result: { status: "confirmation_required" },
        };
      }
      await tx.hostedMember.update({
        data: {
          groupPrivateDisclosureIntroAcknowledgedAt: now,
        },
        where: { id: authority.targetMemberId },
      });
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

export async function readHostedGroupCurrentSenderAssistantAskAuthorityTx(input: {
  expectedGroupRuntimeMemberId: string;
  expectedTargetMemberId?: string | null;
  now: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupCurrentSenderAssistantAskAuthority | null> {
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
    permissionDigest: createHostedGroupCurrentSenderPermissionDigest(),
    permissionText: HOSTED_GROUP_CURRENT_SENDER_DISCLOSURE_PERMISSION_TEXT,
    question: source.question,
    targetMemberId: senderMemberId,
  };
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

function readHostedCurrentSenderSource(
  wake: HostedExecutionConversationMessageWake,
  groupRuntimeMemberId: string,
): {
  question: string;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
} | null {
  if (wake.userId !== groupRuntimeMemberId) {
    return null;
  }
  const message = wake.message;
  let routeAuthority: HostedExecutionExternalThreadRouteAuthority;
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
  return { question, routeAuthority };
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

export function isHostedGroupCurrentSenderDisclosureConfirmation(
  value: string,
): boolean {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("’", "'")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    normalized.length === 0
    || !HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_AFFIRMATIVE_PATTERN.test(normalized)
    || !HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_PRIVATE_MURPH_PATTERN.test(normalized)
    || !HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_DISCLOSURE_PATTERN.test(normalized)
    || HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_DENIAL_PATTERN.test(normalized)
  ) {
    return false;
  }
  const substantiveTokens = normalized
    .replace(HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_AFFIRMATIVE_PATTERN, " ")
    .replace(HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_PRIVATE_MURPH_PATTERN, " ")
    .replace(HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_DISCLOSURE_GLOBAL_PATTERN, " ")
    .match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  return substantiveTokens.some(
    (token) =>
      !HOSTED_GROUP_CURRENT_SENDER_CONFIRMATION_BOILERPLATE_TOKENS.has(token),
  );
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
