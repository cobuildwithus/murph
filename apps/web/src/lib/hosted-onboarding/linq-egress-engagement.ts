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
import { normalizePhoneNumber } from "./phone";
import {
  assertHostedThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";

type HostedLinqEngagementClient = PrismaClient | Prisma.TransactionClient;
type HostedLinqEgressEngagementKind = "first_contact" | "requires_recent_inbound";

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
  directRecipientPhoneNumber?: string | null;
  engagementKind?: HostedLinqEgressEngagementKind | null;
  fromPhoneNumber?: string | null;
  idempotencyKey?: string | null;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  routeAuthority?: HostedExecutionExternalThreadRouteAuthority | null;
  target: string | null;
  targetKind?: string | null;
}): Promise<void> {
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

  if (routeAuthority) {
    await assertHostedThreadRouteEgressAuthority({
      authority: routeAuthority,
      prisma: input.prisma,
    });
    return;
  }

  if (normalizeNullable(input.targetKind) === "participant") {
    await assertHostedLinqParticipantTargetMatchesMemberIdentity({
      memberId: input.memberId,
      participantPhone: input.target ?? input.directRecipientPhoneNumber ?? null,
      prisma: input.prisma,
    });
    await assertHostedMemberLinqRouteMatchesEgressTarget({
      memberId: input.memberId,
      prisma: input.prisma,
      recipientPhone: input.fromPhoneNumber ?? null,
    });
    return;
  }

  await assertHostedMemberLinqRouteMatchesEgressTarget({
    chatId: input.target,
    memberId: input.memberId,
    prisma: input.prisma,
  });
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

async function assertHostedMemberLinqRouteMatchesEgressTarget(input: {
  chatId?: string | null;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  recipientPhone?: string | null;
}): Promise<void> {
  const chatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  const recipientPhoneLookupKeys =
    createHostedPhoneLookupKeyReadCandidates(input.recipientPhone);
  if (chatLookupKeys.length === 0 && recipientPhoneLookupKeys.length === 0) {
    throwHostedLinqRouteAuthorityMismatch();
  }

  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: {
      linqChatLookupKey: true,
      linqRecipientPhoneLookupKey: true,
      pendingLinqChatLookupKey: true,
      pendingLinqRecipientPhoneLookupKey: true,
    },
  });

  if (!routing) {
    throwHostedLinqRouteAuthorityMismatch();
  }
  if (
    routing.linqChatLookupKey
    && chatLookupKeys.includes(routing.linqChatLookupKey)
  ) {
    return;
  }
  if (
    routing.pendingLinqChatLookupKey
    && chatLookupKeys.includes(routing.pendingLinqChatLookupKey)
  ) {
    return;
  }
  if (
    routing.linqRecipientPhoneLookupKey
    && recipientPhoneLookupKeys.includes(routing.linqRecipientPhoneLookupKey)
  ) {
    return;
  }
  if (
    routing.pendingLinqRecipientPhoneLookupKey
    && recipientPhoneLookupKeys.includes(routing.pendingLinqRecipientPhoneLookupKey)
  ) {
    return;
  }

  throwHostedLinqRouteAuthorityMismatch();
}

function throwHostedLinqRouteAuthorityMismatch(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
    httpStatus: 403,
    message: "Linq egress target does not match the runtime user's Linq route.",
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
