import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  HostedExecutionExternalThreadRouteAuthority,
  HostedExecutionLinqExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";

import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  hostedOnboardingError,
} from "./errors";
import {
  readHostedMemberRoutingPrivateState,
} from "./member-private-codecs";
import { normalizePhoneNumber } from "./phone";
import {
  assertHostedLinqRouteEgressAuthority,
  readHostedThreadRouteByThreadIdentity,
} from "../hosted-routing/thread-route-store";
import type {
  HostedLinqThreadRosterSnapshot,
} from "../hosted-routing/linq-thread-roster";

type HostedLinqEngagementClient = PrismaClient | Prisma.TransactionClient;
type HostedLinqLegacyCurrentInboundProof = {
  dedupeKey: string;
  eventId: string;
  mailboxItemId: string;
  occurredAt: string;
  replyToMessageId: string;
  target: string;
};
export type HostedLinqRuntimeEgressTargetOverride = {
  target: string;
  targetKind: "thread";
};
export type HostedLinqRuntimeEgressAssertionResult = {
  targetOverride: HostedLinqRuntimeEgressTargetOverride | null;
};

const HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX = "signup-welcome:";

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
  currentInbound?: HostedLinqLegacyCurrentInboundProof | null;
  directRecipientPhoneNumber?: string | null;
  fromPhoneNumber?: string | null;
  homeRouteFallbackAllowed?: boolean | null;
  idempotencyKey?: string | null;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  replyToMessageId?: string | null;
  routeAuthority?: HostedExecutionExternalThreadRouteAuthority | null;
  routeRosterSnapshot?: HostedLinqThreadRosterSnapshot | null;
  target: string | null;
  targetKind?: string | null;
}): Promise<HostedLinqRuntimeEgressAssertionResult> {
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
      message: "Linq egress authority does not match the runtime user.",
      retryable: false,
    });
  }
  if (input.routeAuthority && !routeAuthority) {
    throwHostedLinqRouteAuthorityMismatch();
  }

  if (normalizeNullable(input.targetKind) === "participant") {
    await assertHostedLinqSignupWelcomeParticipantEgressAuthority({
      directRecipientPhoneNumber: input.directRecipientPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      idempotencyKey: input.idempotencyKey,
      memberId: input.memberId,
      prisma: input.prisma,
      target: input.target,
      targetKind: input.targetKind,
    });
    return { targetOverride: null };
  }

  if (routeAuthority) {
    await assertHostedLinqRouteEgressAuthority({
      authority: routeAuthority,
      prisma: input.prisma,
      ...(input.routeRosterSnapshot
        ? { rosterSnapshot: input.routeRosterSnapshot }
        : {}),
    });
    return { targetOverride: null };
  }

  const targetThreadRoute = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.prisma,
    threadId: input.target,
  });
  if (targetThreadRoute) {
    throwHostedLinqRouteAuthorityMismatch();
  }

  if (legacyCurrentInboundMatchesRequestedTarget({
    currentInbound: input.currentInbound ?? null,
    target: input.target,
  })) {
    // Temporary CF-rollout follow-up compatibility: old warm runner bundles
    // sent currentInbound before external thread routeAuthority existed. Delete
    // this with the egress authority callback route after that rollout window is gone.
    return { targetOverride: null };
  }

  return await assertHostedMemberLinqRouteMatchesEgressTarget({
    chatId: input.target,
    currentInbound: input.currentInbound ?? null,
    memberId: input.memberId,
    prisma: input.prisma,
    recipientPhone: input.directRecipientPhoneNumber,
    replyToMessageId: input.replyToMessageId,
    targetKind: input.targetKind,
    homeRouteFallbackAllowed: input.homeRouteFallbackAllowed === true,
  });
}

async function assertHostedMemberLinqRouteMatchesEgressTarget(input: {
  chatId?: string | null;
  currentInbound?: HostedLinqLegacyCurrentInboundProof | null;
  homeRouteFallbackAllowed: boolean;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  recipientPhone?: string | null;
  replyToMessageId?: string | null;
  targetKind?: string | null;
}): Promise<HostedLinqRuntimeEgressAssertionResult> {
  const chatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  const recipientPhoneLookupKeys =
    createHostedPhoneLookupKeyReadCandidates(input.recipientPhone);
  if (chatLookupKeys.length === 0 && recipientPhoneLookupKeys.length === 0) {
    throwHostedLinqRouteAuthorityMismatch();
  }

  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: {
      linqChatIdEncrypted: true,
      linqChatLookupKey: true,
      linqRecipientPhoneEncrypted: true,
      linqRecipientPhoneLookupKey: true,
      memberId: true,
      pendingLinqChatIdEncrypted: true,
      pendingLinqChatLookupKey: true,
      pendingLinqParticipantContactEncrypted: true,
      pendingLinqRecipientPhoneEncrypted: true,
      pendingLinqRecipientPhoneLookupKey: true,
      telegramUserIdEncrypted: true,
    },
  });

  if (!routing) {
    throwHostedLinqRouteAuthorityMismatch();
  }
  if (
    routing.linqChatLookupKey
    && chatLookupKeys.includes(routing.linqChatLookupKey)
  ) {
    return { targetOverride: null };
  }
  if (
    routing.pendingLinqChatLookupKey
    && chatLookupKeys.includes(routing.pendingLinqChatLookupKey)
  ) {
    return { targetOverride: null };
  }
  if (
    routing.linqRecipientPhoneLookupKey
    && recipientPhoneLookupKeys.includes(routing.linqRecipientPhoneLookupKey)
  ) {
    return { targetOverride: null };
  }
  if (
    routing.pendingLinqRecipientPhoneLookupKey
    && recipientPhoneLookupKeys.includes(routing.pendingLinqRecipientPhoneLookupKey)
  ) {
    return { targetOverride: null };
  }

  if (canResolveHostedLinqHomeRouteOverride(input)) {
    const privateState = await readHostedMemberRoutingPrivateState(routing, input.prisma);
    const homeChatId = normalizeNullable(privateState.linqChatId);
    if (homeChatId) {
      return {
        targetOverride: {
          target: homeChatId,
          targetKind: "thread",
        },
      };
    }
  }

  throwHostedLinqRouteAuthorityMismatch();
}

function canResolveHostedLinqHomeRouteOverride(input: {
  chatId?: string | null;
  currentInbound?: HostedLinqLegacyCurrentInboundProof | null;
  homeRouteFallbackAllowed?: boolean | null;
  recipientPhone?: string | null;
  replyToMessageId?: string | null;
  targetKind?: string | null;
}): boolean {
  const targetKind = normalizeNullable(input.targetKind);
  return (
    input.homeRouteFallbackAllowed === true
    && normalizeNullable(input.chatId) !== null
    && input.currentInbound === null
    && normalizeNullable(input.recipientPhone) === null
    && normalizeNullable(input.replyToMessageId) === null
    && (targetKind === null || targetKind === "explicit" || targetKind === "thread")
  );
}

function legacyCurrentInboundMatchesRequestedTarget(input: {
  currentInbound: HostedLinqLegacyCurrentInboundProof | null;
  target: string | null;
}): boolean {
  if (!input.currentInbound) {
    return false;
  }

  const target = normalizeNullable(input.target);
  return Boolean(target && normalizeNullable(input.currentInbound.target) === target);
}

function throwHostedLinqRouteAuthorityMismatch(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
    httpStatus: 403,
    message: "Linq egress target does not match the runtime user's Linq route.",
    retryable: false,
  });
}

async function assertHostedLinqSignupWelcomeParticipantEgressAuthority(input: {
  directRecipientPhoneNumber?: string | null;
  fromPhoneNumber?: string | null;
  idempotencyKey?: string | null;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  target: string | null;
  targetKind?: string | null;
}): Promise<void> {
  if (!isHostedLinqSignupWelcomeFirstContact(input)) {
    throwHostedLinqParticipantEgressAuthorityMismatch();
  }

  const targetKind = normalizeNullable(input.targetKind);
  const recipientPhone = normalizePhoneNumber(
    targetKind === "participant"
      ? input.target ?? input.directRecipientPhoneNumber ?? null
      : null,
  );
  const fromPhoneNumber = normalizePhoneNumber(input.fromPhoneNumber);
  if (targetKind !== "participant" || !recipientPhone || !fromPhoneNumber) {
    throwHostedLinqParticipantEgressAuthorityMismatch();
  }

  const recipientPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(recipientPhone);
  const fromPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(fromPhoneNumber);
  if (recipientPhoneLookupKeys.length === 0 || fromPhoneLookupKeys.length === 0) {
    throwHostedLinqParticipantEgressAuthorityMismatch();
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
    throwHostedLinqParticipantEgressAuthorityMismatch();
  }
}

function throwHostedLinqParticipantEgressAuthorityMismatch(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
    httpStatus: 403,
    message: "Linq participant egress requires signup welcome authority for the runtime user.",
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
    return null;
  }
  if (!target || target !== linqAuthority.threadId) {
    return null;
  }

  return linqAuthority;
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
