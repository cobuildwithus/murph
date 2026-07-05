import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  HostedExecutionExternalThreadRouteAuthority,
  HostedExecutionLinqExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import {
  isHostedLinqConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";

import {
  createHostedExternalThreadLookupKeyReadCandidates,
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  markHostedLinqDeliverySkippedTx,
} from "./linq-delivery-store";
import type {
  HostedLinqMessagePayload,
} from "./webhook-transport";
import {
  assertHostedThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";
import {
  decodeHostedMailboxStoredPayload,
  readHostedMailboxItemById,
  readHostedMailboxPayload,
} from "../hosted-mailbox/store";
import {
  hostedOnboardingError,
} from "./errors";
import { normalizePhoneNumber } from "./phone";

type HostedLinqEngagementClient = PrismaClient | Prisma.TransactionClient;
type HostedLinqEgressEngagementKind = "first_contact" | "requires_recent_inbound";

export const HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS = 28;
const HOSTED_LINQ_RECENT_INBOUND_WINDOW_MS =
  HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const HOSTED_LINQ_FUTURE_INBOUND_SKEW_MS = 5 * 60 * 1000;
const HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX = "signup-welcome:";

export type HostedLinqRecentInboundDecision =
  | {
      allowed: true;
      lastInboundAt: Date | null;
    }
  | {
      allowed: false;
      lastInboundAt: Date | null;
      reason: "missing_inbound" | "stale_inbound";
    };

export interface HostedLinqCurrentInboundProof {
  dedupeKey: string;
  eventId: string;
  mailboxItemId: string;
  occurredAt: string;
  replyToMessageId: string;
  target: string;
}

export function decideHostedLinqRecentInbound(input: {
  lastInboundAt: Date | null;
  now?: Date;
}): HostedLinqRecentInboundDecision {
  const now = input.now ?? new Date();
  const lastInboundAt = input.lastInboundAt;
  if (!lastInboundAt) {
    return { allowed: false, lastInboundAt: null, reason: "missing_inbound" };
  }
  if (lastInboundAt.getTime() > now.getTime() + HOSTED_LINQ_FUTURE_INBOUND_SKEW_MS) {
    return { allowed: false, lastInboundAt, reason: "stale_inbound" };
  }
  if (lastInboundAt.getTime() >= now.getTime() - HOSTED_LINQ_RECENT_INBOUND_WINDOW_MS) {
    return { allowed: true, lastInboundAt };
  }
  return { allowed: false, lastInboundAt, reason: "stale_inbound" };
}

export async function recordHostedMemberLinqInboundEngagementTx(input: {
  chatId: string | null | undefined;
  memberId: string;
  occurredAt: Date | string;
  linePhoneNumber?: string | null;
  now?: Date;
  prisma: HostedLinqEngagementClient;
}): Promise<void> {
  const occurredAt = normalizeHostedLinqInboundEngagementAt({
    now: input.now,
    occurredAt: input.occurredAt,
  });
  if (!occurredAt) {
    return;
  }
  const chatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  if (chatLookupKeys.length === 0) {
    return;
  }

  await input.prisma.hostedMemberRouting.updateMany({
    where: {
      linqChatLookupKey: { in: chatLookupKeys },
      memberId: input.memberId,
      OR: [
        { linqLastInboundAt: null },
        { linqLastInboundAt: { lt: occurredAt } },
      ],
    },
    data: {
      linqLastInboundAt: occurredAt,
    },
  });

  await input.prisma.hostedMemberRouting.updateMany({
    where: {
      memberId: input.memberId,
      pendingLinqChatLookupKey: { in: chatLookupKeys },
      OR: [
        { pendingLinqLastInboundAt: null },
        { pendingLinqLastInboundAt: { lt: occurredAt } },
      ],
    },
    data: {
      pendingLinqLastInboundAt: occurredAt,
    },
  });

}

export async function recordHostedThreadRouteLinqInboundEngagementTx(input: {
  chatId: string | null | undefined;
  occurredAt: Date | string;
  linePhoneNumberLookupKey: string | null;
  memberId: string;
  now?: Date;
  prisma: HostedLinqEngagementClient;
}): Promise<void> {
  const occurredAt = normalizeHostedLinqInboundEngagementAt({
    now: input.now,
    occurredAt: input.occurredAt,
  });
  if (!occurredAt) {
    return;
  }
  const threadLookupKeys = createHostedExternalThreadLookupKeyReadCandidates({
    accountLookupKey: input.linePhoneNumberLookupKey,
    channel: "linq",
    threadId: input.chatId,
  });
  if (threadLookupKeys.length === 0) {
    return;
  }

  await input.prisma.hostedThreadRoute.updateMany({
    where: {
      channel: "linq",
      containerMemberId: input.memberId,
      threadLookupKey: { in: threadLookupKeys },
      OR: [
        { lastInboundAt: null },
        { lastInboundAt: { lt: occurredAt } },
      ],
    },
    data: {
      lastInboundAt: occurredAt,
    },
  });

}

export async function readHostedLinqSideEffectRecentInboundDecision(input: {
  now?: Date;
  payload: HostedLinqMessagePayload;
  prisma: HostedLinqEngagementClient;
  route?: { lastInboundAt: Date | null } | null;
}): Promise<HostedLinqRecentInboundDecision> {
  const now = input.now ?? new Date();
  if (isHostedLinqFirstContactSideEffectPayload(input.payload)) {
    return { allowed: true, lastInboundAt: null };
  }
  const memberId = await resolveHostedLinqSideEffectMemberId(input);
  const routeAuthority = "routeAuthority" in input.payload
    ? input.payload.routeAuthority ?? null
    : null;
  if (routeAuthority) {
    const validatedRouteAuthority = assertHostedLinqRouteAuthorityMatchesTarget({
      chatId: input.payload.chatId,
      memberId,
      routeAuthority,
    });
    const route = input.route ?? await assertHostedThreadRouteEgressAuthority({
      authority: validatedRouteAuthority,
      prisma: input.prisma,
    });
    return decideHostedLinqRecentInbound({
      lastInboundAt: route.lastInboundAt,
      now,
    });
  }

  if (!memberId) {
    return decideHostedLinqRecentInbound({ lastInboundAt: null, now });
  }

  return decideHostedLinqRecentInbound({
    lastInboundAt: await readHostedMemberLinqRouteLastInboundAt({
      chatId: input.payload.chatId,
      memberId,
      prisma: input.prisma,
    }),
    now,
  });
}

export function assertHostedLinqRouteAuthorityMatchesTarget(input: {
  chatId: string | null | undefined;
  memberId?: string | null;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
}): HostedExecutionLinqExternalThreadRouteAuthority {
  const authority = input.routeAuthority;
  const chatId = normalizeNullable(input.chatId);
  const memberId = normalizeNullable(input.memberId);

  if (
    authority.channel !== "linq"
    || !chatId
    || authority.threadId !== chatId
    || (memberId !== null && authority.containerMemberId !== memberId)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
      message: "Linq egress route authority does not match the requested thread.",
      retryable: false,
    });
  }

  return {
    ...authority,
    channel: "linq",
  };
}

export async function assertHostedLinqRecentInboundEngagementForRuntime(input: {
  currentInbound?: HostedLinqCurrentInboundProof | null;
  directRecipientPhoneNumber?: string | null;
  engagementKind?: HostedLinqEgressEngagementKind | null;
  fromPhoneNumber?: string | null;
  idempotencyKey?: string | null;
  intentId?: string | null;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  routeAuthority?: HostedExecutionExternalThreadRouteAuthority | null;
  target: string | null;
  targetKind?: string | null;
}): Promise<void> {
  const now = input.now ?? new Date();
  const routeAuthority = normalizeHostedLinqRouteAuthorityForEgress({
    memberId: input.memberId,
    routeAuthority: input.routeAuthority ?? null,
    target: input.target,
    targetKind: input.targetKind,
  });
  if (routeAuthority && routeAuthority.containerMemberId !== input.memberId) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_BOUND_USER_MISMATCH",
      httpStatus: 403,
      message: "Linq egress engagement authority does not match the runtime user.",
      retryable: false,
    });
  }
  if ((input.engagementKind ?? "requires_recent_inbound") === "first_contact") {
    await assertHostedLinqFirstContactEgressAuthority({
      directRecipientPhoneNumber: input.directRecipientPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      idempotencyKey: input.idempotencyKey,
      memberId: input.memberId,
      prisma: input.prisma,
      target: input.target,
      targetKind: input.targetKind,
    });
    return;
  }

  const route = routeAuthority
    ? await assertHostedThreadRouteEgressAuthority({
        authority: routeAuthority,
        prisma: input.prisma,
      })
    : null;
  const fallbackChatId = input.targetKind === "participant" ? null : input.target;
  let fallbackRecipientPhone: string | null = null;
  if (input.targetKind === "participant") {
    await assertHostedLinqParticipantTargetMatchesMemberIdentity({
      memberId: input.memberId,
      participantPhone: input.target ?? input.directRecipientPhoneNumber ?? null,
      prisma: input.prisma,
    });
    fallbackRecipientPhone = input.fromPhoneNumber ?? null;
  }
  const decision = route
    ? decideHostedLinqRecentInbound({
      lastInboundAt: route.lastInboundAt,
      now,
    })
    : decideHostedLinqRecentInbound({
      lastInboundAt: await readHostedMemberLinqRouteLastInboundAt({
        chatId: fallbackChatId,
        memberId: input.memberId,
        prisma: input.prisma,
        recipientPhone: fallbackRecipientPhone,
      }),
      now,
    });

  if (decision.allowed) {
    return;
  }
  const currentInboundDecision = await readHostedLinqCurrentInboundDecision({
    currentInbound: input.currentInbound ?? null,
    memberId: input.memberId,
    now,
    prisma: input.prisma,
    route,
    routeAuthority,
    target: input.target,
  });
  if (currentInboundDecision?.allowed) {
    return;
  }
  const failureDecision = currentInboundDecision ?? decision;

  await markHostedLinqDeliverySkippedTx({
    idempotencyKey: input.idempotencyKey,
    linqChatId: input.targetKind === "participant" ? null : input.target,
    phoneNumber: input.fromPhoneNumber,
    prisma: input.prisma,
    reason: buildHostedLinqRecentInboundSkipReason(failureDecision.lastInboundAt),
    skippedAt: now,
    source: "hosted_runtime_linq_egress_guard",
    sourceRef: input.intentId,
    targetKind: input.targetKind,
  });

  throw hostedOnboardingError({
    code: "HOSTED_LINQ_RECIPIENT_RECENT_REPLY_REQUIRED",
    details: {
      lastInboundAt: failureDecision.lastInboundAt?.toISOString() ?? null,
      policyDays: HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS,
      reason: failureDecision.reason,
    },
    httpStatus: 403,
    message: `Linq/iMessage delivery requires a recipient reply within the last ${HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS} days.`,
    retryable: false,
  });
}

export async function resolveHostedLinqCurrentInboundMailboxItemIdForRuntime(input: {
  currentInbound?: HostedLinqCurrentInboundProof | null;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  routeAuthority?: HostedExecutionExternalThreadRouteAuthority | null;
  target: string | null;
  targetKind?: string | null;
}): Promise<string | null> {
  const proof = normalizeHostedLinqCurrentInboundProof(input.currentInbound ?? null);
  if (!proof) {
    return null;
  }
  const now = input.now ?? new Date();
  const routeAuthority = normalizeHostedLinqRouteAuthorityForEgress({
    memberId: input.memberId,
    routeAuthority: input.routeAuthority ?? null,
    target: input.target,
    targetKind: input.targetKind,
  });
  if (routeAuthority && routeAuthority.containerMemberId !== input.memberId) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_BOUND_USER_MISMATCH",
      httpStatus: 403,
      message: "Linq egress engagement authority does not match the runtime user.",
      retryable: false,
    });
  }
  const route = routeAuthority
    ? await assertHostedThreadRouteEgressAuthority({
        authority: routeAuthority,
        prisma: input.prisma,
      })
    : null;
  const decision = await readHostedLinqCurrentInboundDecision({
    currentInbound: proof,
    memberId: input.memberId,
    now,
    prisma: input.prisma,
    route,
    routeAuthority,
    target: input.target,
  });

  return decision?.allowed ? proof.mailboxItemId : null;
}

async function readHostedLinqCurrentInboundDecision(input: {
  currentInbound: HostedLinqCurrentInboundProof | null;
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  route: { accountLookupKey: string; lastInboundAt: Date | null } | null;
  routeAuthority: HostedExecutionLinqExternalThreadRouteAuthority | null;
  target: string | null;
}): Promise<HostedLinqRecentInboundDecision | null> {
  const proof = normalizeHostedLinqCurrentInboundProof(input.currentInbound);
  const target = normalizeNullable(input.target);
  if (!proof || !target || proof.target !== target) {
    return null;
  }

  const item = await readHostedMailboxItemById({
    mailboxItemId: proof.mailboxItemId,
    prisma: input.prisma,
  });
  if (
    !item
    || item.id !== proof.mailboxItemId
    || item.dedupeKey !== proof.dedupeKey
    || item.userId !== input.memberId
    || item.kind !== "conversation.message"
    || item.lane !== "conversation"
    || !hostedLinqIsoStringsRepresentSameInstant(item.occurredAt, proof.occurredAt)
    || isHostedLinqMailboxItemExpired(item.expiresAt ?? null, input.now)
  ) {
    return null;
  }

  const sidecarPayload = item.payloadInlineCiphertext
    ? null
    : await readHostedMailboxPayload({
        dedupeKey: item.dedupeKey,
        mailboxItemId: item.id,
        payloadRef: item.payloadRef ?? null,
        prisma: input.prisma,
        userId: item.userId,
      });
  const decodedPayload = await decodeHostedMailboxStoredPayload({
    dedupeKey: item.dedupeKey,
    kind: item.kind,
    lane: item.lane,
    laneSeq: item.laneSeq,
    mailboxItemId: item.id,
    occurredAt: item.occurredAt,
    payloadCiphertext: sidecarPayload?.payloadCiphertext ?? null,
    payloadInlineCiphertext: item.payloadInlineCiphertext ?? null,
    payloadSchema: item.payloadSchema,
    prisma: input.prisma,
    userId: item.userId,
  }).catch(() => null);
  if (!decodedPayload) {
    return null;
  }

  const wake = parseHostedLinqCurrentInboundWake(decodedPayload);
  if (
    !wake
    || wake.userId !== input.memberId
    || wake.eventId !== proof.eventId
    || !hostedLinqIsoStringsRepresentSameInstant(wake.occurredAt, proof.occurredAt)
    || !hostedLinqIsoStringsRepresentSameInstant(wake.occurredAt, item.occurredAt)
    || wake.message.linqMessage.isFromMe
    || normalizeNullable(wake.message.linqMessage.chatId) !== proof.target
    || normalizeNullable(wake.message.linqMessage.messageId) !== proof.replyToMessageId
  ) {
    return null;
  }

  const occurredAt = parseHostedLinqCurrentInboundDate(proof.occurredAt);
  if (!occurredAt) {
    return null;
  }
  const decision = decideHostedLinqRecentInbound({
    lastInboundAt: occurredAt,
    now: input.now,
  });
  if (!decision.allowed) {
    return decision;
  }

  if (input.routeAuthority && input.route) {
    await recordHostedThreadRouteLinqInboundEngagementTx({
      chatId: proof.target,
      linePhoneNumberLookupKey: input.route.accountLookupKey,
      memberId: input.memberId,
      now: input.now,
      occurredAt,
      prisma: input.prisma,
    });
  } else {
    await recordHostedMemberLinqInboundEngagementTx({
      chatId: proof.target,
      memberId: input.memberId,
      now: input.now,
      occurredAt,
      prisma: input.prisma,
    });
  }

  return decision;
}

function parseHostedLinqCurrentInboundWake(value: unknown) {
  try {
    const wake = parseHostedExecutionWake(value);
    return isHostedLinqConversationMessageWake(wake) ? wake : null;
  } catch {
    return null;
  }
}

function normalizeHostedLinqCurrentInboundProof(
  proof: HostedLinqCurrentInboundProof | null,
): HostedLinqCurrentInboundProof | null {
  if (!proof) {
    return null;
  }
  const dedupeKey = normalizeNullable(proof.dedupeKey);
  const eventId = normalizeNullable(proof.eventId);
  const mailboxItemId = normalizeNullable(proof.mailboxItemId);
  const occurredAt = normalizeNullable(proof.occurredAt);
  const replyToMessageId = normalizeNullable(proof.replyToMessageId);
  const target = normalizeNullable(proof.target);
  if (
    !dedupeKey
    || !eventId
    || !mailboxItemId
    || !occurredAt
    || !replyToMessageId
    || !target
  ) {
    return null;
  }

  return {
    dedupeKey,
    eventId,
    mailboxItemId,
    occurredAt,
    replyToMessageId,
    target,
  };
}

function parseHostedLinqCurrentInboundDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hostedLinqIsoStringsRepresentSameInstant(left: string, right: string): boolean {
  const leftDate = parseHostedLinqCurrentInboundDate(left);
  const rightDate = parseHostedLinqCurrentInboundDate(right);
  return !!leftDate && !!rightDate && leftDate.getTime() === rightDate.getTime();
}

function isHostedLinqMailboxItemExpired(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) {
    return false;
  }
  const expiresAtDate = parseHostedLinqCurrentInboundDate(expiresAt);
  return !expiresAtDate || expiresAtDate.getTime() <= now.getTime();
}

async function assertHostedLinqParticipantTargetMatchesMemberIdentity(input: {
  memberId: string;
  participantPhone?: string | null;
  prisma: HostedLinqEngagementClient;
}): Promise<void> {
  const participantPhone = normalizePhoneNumber(input.participantPhone);
  const participantPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(participantPhone);
  if (!participantPhone || participantPhoneLookupKeys.length === 0) {
    throwHostedLinqParticipantEgressAuthorityMismatch();
  }

  const identity = await input.prisma.hostedMemberIdentity.findUnique({
    where: { memberId: input.memberId },
    select: { phoneLookupKey: true },
  });

  if (
    !identity?.phoneLookupKey
    || !participantPhoneLookupKeys.includes(identity.phoneLookupKey)
  ) {
    throwHostedLinqParticipantEgressAuthorityMismatch();
  }
}

function throwHostedLinqParticipantEgressAuthorityMismatch(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
    httpStatus: 403,
    message: "Linq participant egress requires the participant target to match the runtime user.",
    retryable: false,
  });
}

async function assertHostedLinqFirstContactEgressAuthority(input: {
  directRecipientPhoneNumber?: string | null;
  fromPhoneNumber?: string | null;
  idempotencyKey?: string | null;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  target: string | null;
  targetKind?: string | null;
}): Promise<void> {
  if (!isHostedLinqSignupWelcomeFirstContact(input)) {
    throwHostedLinqFirstContactEgressAuthorityMismatch();
  }

  const targetKind = normalizeNullable(input.targetKind);
  const recipientPhone = normalizePhoneNumber(
    targetKind === "participant"
      ? input.target ?? input.directRecipientPhoneNumber ?? null
      : null,
  );
  const fromPhoneNumber = normalizePhoneNumber(input.fromPhoneNumber);
  if (targetKind !== "participant" || !recipientPhone || !fromPhoneNumber) {
    throwHostedLinqFirstContactEgressAuthorityMismatch();
  }

  const recipientPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(recipientPhone);
  const fromPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(fromPhoneNumber);
  if (recipientPhoneLookupKeys.length === 0 || fromPhoneLookupKeys.length === 0) {
    throwHostedLinqFirstContactEgressAuthorityMismatch();
  }

  const [identity, routing] = await Promise.all([
    input.prisma.hostedMemberIdentity.findUnique({
      where: { memberId: input.memberId },
      select: { phoneLookupKey: true },
    }),
    input.prisma.hostedMemberRouting.findUnique({
      where: { memberId: input.memberId },
      select: { linqRecipientPhoneLookupKey: true },
    }),
  ]);

  if (
    !identity?.phoneLookupKey
    || !recipientPhoneLookupKeys.includes(identity.phoneLookupKey)
    || !routing?.linqRecipientPhoneLookupKey
    || !fromPhoneLookupKeys.includes(routing.linqRecipientPhoneLookupKey)
  ) {
    throwHostedLinqFirstContactEgressAuthorityMismatch();
  }
}

function throwHostedLinqFirstContactEgressAuthorityMismatch(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_FIRST_CONTACT_AUTHORITY_MISMATCH",
    httpStatus: 403,
    message: "Linq first-contact egress requires signup welcome authority for the runtime user.",
    retryable: false,
  });
}

function isHostedLinqSignupWelcomeFirstContact(input: {
  idempotencyKey?: string | null;
  memberId: string;
}): boolean {
  return normalizeNullable(input.idempotencyKey)
    === `${HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX}${input.memberId}`;
}

function isHostedLinqFirstContactSideEffectPayload(
  payload: HostedLinqMessagePayload,
): boolean {
  return payload.template === "invite_signup" || payload.template === "invite_signin";
}

function normalizeHostedLinqRouteAuthorityForEgress(input: {
  memberId: string;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority | null;
  target: string | null;
  targetKind?: string | null;
}): HostedExecutionLinqExternalThreadRouteAuthority | null {
  const authority = input.routeAuthority;
  if (!authority) {
    return null;
  }
  const targetKind = normalizeNullable(input.targetKind);
  const target = normalizeNullable(input.target);
  if (authority.channel !== "linq") {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
      message: "Linq egress route authority must be for a Linq thread.",
      retryable: false,
    });
  }
  const linqAuthority: HostedExecutionLinqExternalThreadRouteAuthority = {
    ...authority,
    channel: "linq",
  };
  if (linqAuthority.containerMemberId !== input.memberId) {
    return linqAuthority;
  }
  if (targetKind !== "thread" && targetKind !== "explicit") {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
      message: "Linq egress route authority can only authorize thread delivery.",
      retryable: false,
    });
  }
  if (!target || target !== linqAuthority.threadId) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
      message: "Linq egress route authority does not match the requested thread.",
      retryable: false,
    });
  }

  return linqAuthority;
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function buildHostedLinqRecentInboundSkipReason(lastInboundAt: Date | null): string {
  return lastInboundAt
    ? `last_inbound_at=${lastInboundAt.toISOString()}; window_days=${HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS}`
    : `last_inbound_at=null; window_days=${HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS}`;
}

function normalizeHostedLinqInboundEngagementAt(input: {
  now?: Date;
  occurredAt: Date | string;
}): Date | null {
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    return null;
  }
  const now = input.now ?? new Date();
  return occurredAt.getTime() > now.getTime() + HOSTED_LINQ_FUTURE_INBOUND_SKEW_MS
    ? now
    : occurredAt;
}

async function resolveHostedLinqSideEffectMemberId(input: {
  payload: HostedLinqMessagePayload;
  prisma: HostedLinqEngagementClient;
}): Promise<string | null> {
  if ("memberId" in input.payload && input.payload.memberId) {
    return input.payload.memberId;
  }
  if (!("inviteId" in input.payload) || !input.payload.inviteId) {
    return null;
  }
  const invite = await input.prisma.hostedInvite.findUnique({
    where: { id: input.payload.inviteId },
    select: { memberId: true },
  });
  return invite?.memberId ?? null;
}

async function readHostedMemberLinqRouteLastInboundAt(input: {
  chatId: string | null | undefined;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  recipientPhone?: string | null;
}): Promise<Date | null> {
  const chatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  const recipientPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(input.recipientPhone);
  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: {
      linqChatLookupKey: true,
      linqLastInboundAt: true,
      linqRecipientPhoneLookupKey: true,
      pendingLinqChatLookupKey: true,
      pendingLinqLastInboundAt: true,
      pendingLinqRecipientPhoneLookupKey: true,
    },
  });

  if (!routing) {
    return null;
  }

  if (
    routing.linqChatLookupKey
    && chatLookupKeys.includes(routing.linqChatLookupKey)
  ) {
    return routing.linqLastInboundAt;
  }
  if (
    routing.pendingLinqChatLookupKey
    && chatLookupKeys.includes(routing.pendingLinqChatLookupKey)
  ) {
    return routing.pendingLinqLastInboundAt;
  }
  if (
    routing.linqRecipientPhoneLookupKey
    && recipientPhoneLookupKeys.includes(routing.linqRecipientPhoneLookupKey)
  ) {
    return routing.linqLastInboundAt;
  }
  if (
    routing.pendingLinqRecipientPhoneLookupKey
    && recipientPhoneLookupKeys.includes(routing.pendingLinqRecipientPhoneLookupKey)
  ) {
    return routing.pendingLinqLastInboundAt;
  }

  return null;
}
