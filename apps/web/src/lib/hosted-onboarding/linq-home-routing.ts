import { type HostedMemberSnapshot } from "./hosted-member-store";
import {
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx,
  countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince,
  countHostedMemberHomeLinqBindingsByRecipientPhone,
  readHostedMemberRoutingState,
  type HostedMemberRoutingStateSnapshot,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
} from "./hosted-member-routing-store";
import {
  chooseHostedLinqHomeLine,
  resolveHostedLinqActiveRouteDecision,
  resolveHostedLinqHomeBindingRecipientPhone,
  type HostedLinqActiveRouteDecision,
} from "./linq-routing-policy";
import {
  type HostedMemberAssistantNotificationRoute,
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "./messaging-state";
import {
  type HostedLinqAssignableHomeLine,
  listHostedLinqAssignableHomeLines,
} from "./linq-line-store";
import { normalizePhoneNumber } from "./phone";
import { hostedOnboardingError } from "./errors";
import type { HostedLinqParticipantContact } from "./linq-participant-contact";
import type { Prisma } from "@prisma/client";

export interface HostedMemberActivationLinqRouteResolution {
  welcomeRoute: HostedMemberAssistantNotificationRoute;
}

export interface HostedLinqHomeLineAssignmentReservation {
  assignedAt: Date;
  line: HostedLinqAssignableHomeLine;
}

export type HostedLinqHomeLinePhoneReservationResult =
  | {
      kind: "reserved";
      reservation: HostedLinqHomeLineAssignmentReservation;
    }
  | {
      kind: "unassignable";
    }
  | {
      kind: "capacity_exhausted";
    };

export type HostedLinqHomeLineRouteBindingResult =
  | {
      homeLineAssignedAt: Date | null;
      kind: "bind";
      recipientPhone: string | null;
    }
  | Exclude<HostedLinqActiveRouteDecision, { kind: "bind_home" }>
  | {
      kind: "unassignable";
    }
  | {
      kind: "capacity_exhausted";
    };

export type HostedLinqHomeLineRouteBindingAuthority =
  | {
      kind: "home-linq-chat";
    }
  | {
      contact: HostedLinqParticipantContact;
      kind: "pending-contact";
    }
  | {
      kind: "member-identity";
    };

export async function reserveHostedLinqHomeLineFromPoolTx(input: {
  preferredRecipientPhone: string | null;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLinePhoneReservationResult> {
  await acquireHostedMemberHomeLinqRecipientAssignmentLockTx({
    prisma: input.prisma,
  });

  return reserveHostedLinqHomeLineFromPoolAfterLockTx({
    preferredRecipientPhone: input.preferredRecipientPhone,
    prisma: input.prisma,
  });
}

type HostedLinqHomeLineRouteBindingDecision =
  | {
      kind: "done";
      result: HostedLinqHomeLineRouteBindingResult;
    }
  | {
      kind: "reserve";
      preferredRecipientPhone: string;
    };

export async function resolveHostedMemberLinqHomeLineRouteBindingTx(input: {
  incomingChatId: string;
  incomingDirectAttested: boolean;
  incomingRecipientPhone: string | null;
  memberAuthority?: HostedLinqHomeLineRouteBindingAuthority | null;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLineRouteBindingResult> {
  // Most inbound messages resolve onto an existing route. Decide without the
  // shared pool lock so they never wait behind unrelated line assignment.
  const decision = await resolveHostedMemberLinqHomeLineRouteBindingDecision(input);
  if (decision.kind === "done") {
    return decision.result;
  }

  await acquireHostedMemberHomeLinqRecipientAssignmentLockTx({
    prisma: input.prisma,
  });
  // Routing and capacity may have changed while another transaction held the
  // pool lock, so the claim decision must be re-resolved under it.
  const lockedDecision = await resolveHostedMemberLinqHomeLineRouteBindingDecision(input);
  if (lockedDecision.kind === "done") {
    return lockedDecision.result;
  }

  // Reserve from the whole assignable pool, preferring the line the member
  // contacted. A healthy, under-quota incoming line is chosen unchanged; a
  // degraded or full one falls over to another working line.
  const reservationResult = await reserveHostedLinqHomeLineFromPoolAfterLockTx({
    preferredRecipientPhone: lockedDecision.preferredRecipientPhone,
    now: new Date(),
    prisma: input.prisma,
  });

  if (reservationResult.kind !== "reserved") {
    return {
      kind: reservationResult.kind,
    };
  }

  return {
    homeLineAssignedAt: reservationResult.reservation.assignedAt,
    kind: "bind",
    recipientPhone: reservationResult.reservation.line.phoneNumber,
  };
}

async function resolveHostedMemberLinqHomeLineRouteBindingDecision(input: {
  incomingChatId: string;
  incomingDirectAttested: boolean;
  incomingRecipientPhone: string | null;
  memberAuthority?: HostedLinqHomeLineRouteBindingAuthority | null;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLineRouteBindingDecision> {
  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const authority = readHostedLinqHomeLineAuthority(routing);

  if (!hostedLinqRouteBindingAuthorityMatchesCurrentRoute({
    authority: input.memberAuthority ?? { kind: "member-identity" },
    incomingChatId: input.incomingChatId,
    routing,
  })) {
    return {
      kind: "done",
      result: {
        kind: "ignore_unknown_home",
      },
    };
  }

  const authorityChatId = authority.kind === "none" ? null : authority.chatId;
  const authorityRecipientPhone = authority.kind === "none" ? null : authority.recipientPhone;

  const routeDecision = resolveHostedLinqActiveRouteDecision({
    homeChatId: authorityChatId,
    homeRecipientPhone: authorityRecipientPhone,
    incomingChatId: input.incomingChatId,
    incomingDirectAttested: input.incomingDirectAttested,
    incomingRecipientPhone: input.incomingRecipientPhone,
  });

  if (routeDecision.kind !== "bind_home") {
    return {
      kind: "done",
      result: routeDecision,
    };
  }

  const recipientPhone = resolveHostedLinqHomeBindingRecipientPhone({
    homeChatId: authorityChatId,
    homeRecipientPhone: authorityRecipientPhone,
    incomingChatId: input.incomingChatId,
    incomingRecipientPhone: input.incomingRecipientPhone,
  });

  // An existing authority binds from the routing row alone; the assignable
  // pool gates only new claims, so a degraded or de-configured line never
  // drops a route the member already owns.
  if (
    authority.kind !== "none"
    && (
      authority.chatId === input.incomingChatId
      || (authority.recipientPhone !== null && authority.recipientPhone === recipientPhone)
    )
  ) {
    return {
      kind: "done",
      result: {
        homeLineAssignedAt: authority.assignedAt,
        kind: "bind",
        recipientPhone,
      },
    };
  }

  if (!recipientPhone) {
    return {
      kind: "done",
      result: {
        kind: "unassignable",
      },
    };
  }

  // New claim: defer to the shared pool reservation under the lock, preferring
  // the contacted line. Whether the preferred line is assignable is decided
  // there, so a degraded incoming line falls over instead of failing closed.
  return {
    kind: "reserve",
    preferredRecipientPhone: recipientPhone,
  };
}

export async function resolveHostedMemberActivationLinqRoute(input: {
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberActivationLinqRouteResolution> {
  // Most activations promote an existing home, pending, or assigned-line
  // route. Resolve those without the shared pool lock so activation never
  // waits behind unrelated line assignment.
  const promoted = await resolveHostedMemberActivationLinqRouteAttempt({
    claimNewHomeLine: false,
    member: input.member,
    prisma: input.prisma,
  });
  if (promoted) {
    return promoted;
  }

  await acquireHostedMemberHomeLinqRecipientAssignmentLockTx({
    prisma: input.prisma,
  });
  // Routing and capacity may have changed while another transaction held
  // the pool lock, so re-resolve before claiming a new home line.
  const resolved = await resolveHostedMemberActivationLinqRouteAttempt({
    claimNewHomeLine: true,
    member: input.member,
    prisma: input.prisma,
  });
  if (!resolved) {
    throw hostedOnboardingError({
      code: "LINQ_CONVERSATION_PHONE_REQUIRED",
      message: "Configure an enabled hosted_linq_line row before activating members without an existing Linq conversation thread.",
      httpStatus: 500,
    });
  }

  return resolved;
}

async function resolveHostedMemberActivationLinqRouteAttempt(input: {
  claimNewHomeLine: boolean;
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberActivationLinqRouteResolution | null> {
  const routing = await readHostedMemberRoutingState({
    memberId: input.member.core.id,
    prisma: input.prisma,
  }) ?? input.member.routing;
  const messaging = resolveHostedMemberMessagingState({
    identity: input.member.identity,
    routing,
  });
  const memberPhoneNumber = input.member.identity?.phoneNumber ?? null;
  const linqContactLookupKey =
    input.member.identity?.phoneLookupKey
    ?? routing?.pendingLinqParticipantContact?.lookupKey
    ?? input.member.emailAuthorization?.verifiedEmail?.lookupKey
    ?? null;

  const authority = readHostedLinqHomeLineAuthority(routing);

  if (authority.kind === "home") {
    if (routing?.pendingLinqChatId) {
      await upsertHostedMemberHomeLinqBindingTx({
        clearPending: true,
        linqChatId: authority.chatId,
        memberId: input.member.core.id,
        prisma: input.prisma,
        recipientPhone: authority.recipientPhone,
      });
    }

    return {
      welcomeRoute: resolveHostedMemberAssistantNotificationRoute({
        linqChatId: authority.chatId,
        linqContactLookupKey,
        memberId: input.member.core.id,
        memberPhoneNumber,
        messaging,
      }),
    };
  }

  // An existing pending route is durable authority; promoting it must not
  // depend on the line still being in the assignable pool.
  if (
    authority.kind === "pending"
    && linqContactLookupKey
    && (
      memberPhoneNumber
        ? authority.recipientPhone !== null
        : true
    )
  ) {
    await upsertHostedMemberHomeLinqBindingTx({
      clearPending: true,
      linqChatId: authority.chatId,
      memberId: input.member.core.id,
      prisma: input.prisma,
      recipientPhone: authority.recipientPhone,
    });

    return {
      welcomeRoute: resolveHostedMemberAssistantNotificationRoute({
        linqChatId: authority.chatId,
        linqContactLookupKey,
        memberId: input.member.core.id,
        memberPhoneNumber,
        messaging,
      }),
    };
  }

  const target = await resolveHostedMemberActivationTargetRecipientPhone({
    claimNewHomeLine: input.claimNewHomeLine,
    member: input.member,
    prisma: input.prisma,
    routing,
  });
  if (target === "needs_claim") {
    return null;
  }
  const targetRecipientPhone = normalizePhoneNumber(target.recipientPhone);

  if (!targetRecipientPhone) {
    throw hostedOnboardingError({
      code: "LINQ_CONVERSATION_PHONE_REQUIRED",
      message: "Configure an enabled hosted_linq_line row before activating members without an existing Linq conversation thread.",
      httpStatus: 500,
    });
  }

  if (!memberPhoneNumber) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_PHONE_REQUIRED",
      message: "A verified hosted member phone number is required before a Linq home line can be assigned.",
      httpStatus: 500,
    });
  }

  await upsertHostedMemberHomeLinqRecipientPhoneTx({
    clearPending: true,
    homeLineAssignedAt: target.homeLineAssignedAt,
    memberId: input.member.core.id,
    prisma: input.prisma,
    recipientPhone: targetRecipientPhone,
  });

  return {
    welcomeRoute: resolveHostedMemberAssistantNotificationRoute({
      linqChatId: null,
      linqRecipientPhone: targetRecipientPhone,
      memberId: input.member.core.id,
      memberPhoneNumber,
      messaging,
    }),
  };
}

async function reserveHostedLinqHomeLineFromCandidatesTx(input: {
  excludedActiveMemberId?: string | null;
  lines: readonly HostedLinqAssignableHomeLine[];
  now?: Date;
  preferredRecipientPhone?: string | null;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLineAssignmentReservation | null> {
  const recipientPhones = input.lines.map((line) => line.phoneNumber);

  if (recipientPhones.length === 0) {
    return null;
  }

  const now = input.now ?? new Date();
  const activeMembersByRecipientPhone = await countHostedMemberHomeLinqBindingsByRecipientPhone({
    ...(input.excludedActiveMemberId
      ? { excludedMemberId: input.excludedActiveMemberId }
      : {}),
    now,
    prisma: input.prisma,
    recipientPhones,
  });
  const newAssignmentsByRecipientPhone =
    await countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince({
      prisma: input.prisma,
      recipientPhones,
      since: startOfUtcDay(now),
    });

  const chosen = chooseHostedLinqHomeLine({
    activeMembersByRecipientPhone,
    lines: input.lines,
    newAssignmentsByRecipientPhone,
    preferredRecipientPhone: input.preferredRecipientPhone ?? null,
  });

  return chosen
    ? {
        assignedAt: now,
        line: chosen,
      }
    : null;
}

async function resolveHostedMemberActivationTargetRecipientPhone(input: {
  claimNewHomeLine: boolean;
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
  routing: HostedMemberRoutingStateSnapshot | null;
}): Promise<{ homeLineAssignedAt?: Date; recipientPhone: string | null } | "needs_claim"> {
  const routing = input.routing;
  // An existing assigned line is durable authority; activation keeps it
  // without rechecking assignable-pool eligibility.
  const existingRecipientPhone = normalizePhoneNumber(routing?.linqRecipientPhone);
  if (existingRecipientPhone) {
    return {
      ...(routing?.linqHomeLineAssignedAt
        ? { homeLineAssignedAt: routing.linqHomeLineAssignedAt }
        : {}),
      recipientPhone: existingRecipientPhone,
    };
  }

  // Claiming a new line consumes pool capacity; the caller must hold the
  // pool lock before allowing this branch.
  if (!input.claimNewHomeLine) {
    return "needs_claim";
  }

  const reservationResult = await reserveHostedLinqHomeLineFromPoolAfterLockTx({
    preferredRecipientPhone: routing?.pendingLinqRecipientPhone ?? null,
    prisma: input.prisma,
  });

  if (reservationResult.kind !== "reserved") {
    return { recipientPhone: null };
  }

  return {
    homeLineAssignedAt: reservationResult.reservation.assignedAt,
    recipientPhone: reservationResult.reservation.line.phoneNumber,
  };
}

async function reserveHostedLinqHomeLineFromPoolAfterLockTx(input: {
  now?: Date;
  preferredRecipientPhone: string | null;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLinePhoneReservationResult> {
  const reservation = await reserveHostedLinqHomeLineFromCandidatesTx({
    lines: await listHostedLinqAssignableHomeLines({ prisma: input.prisma }),
    ...(input.now ? { now: input.now } : {}),
    preferredRecipientPhone: input.preferredRecipientPhone,
    prisma: input.prisma,
  });

  if (!reservation) {
    return {
      kind: "capacity_exhausted",
    };
  }

  return {
    kind: "reserved",
    reservation,
  };
}

export type HostedLinqHomeLineAuthority =
  | {
      kind: "none";
    }
  | {
      assignedAt: Date | null;
      chatId: string;
      kind: "home" | "pending";
      recipientPhone: string | null;
    }
  | {
      assignedAt: Date | null;
      chatId: null;
      kind: "bare";
      recipientPhone: string;
    };

/**
 * The single durable interpretation of a member's hosted_member_routing row
 * as home-line authority. Every consumer resolves existing routes through
 * this projection; only a "none" authority may claim a new line from the
 * assignable pool.
 */
export function readHostedLinqHomeLineAuthority(
  routing: HostedMemberRoutingStateSnapshot | null,
): HostedLinqHomeLineAuthority {
  if (routing?.linqChatId) {
    return {
      assignedAt: routing.linqHomeLineAssignedAt ?? null,
      chatId: routing.linqChatId,
      kind: "home",
      recipientPhone: normalizePhoneNumber(routing.linqRecipientPhone),
    };
  }

  if (routing?.pendingLinqChatId) {
    return {
      assignedAt: routing.linqHomeLineAssignedAt ?? null,
      chatId: routing.pendingLinqChatId,
      kind: "pending",
      recipientPhone:
        normalizePhoneNumber(routing.pendingLinqRecipientPhone)
        ?? normalizePhoneNumber(routing.linqRecipientPhone),
    };
  }

  const bareRecipientPhone = normalizePhoneNumber(routing?.linqRecipientPhone);
  if (routing && bareRecipientPhone) {
    return {
      assignedAt: routing.linqHomeLineAssignedAt ?? null,
      chatId: null,
      kind: "bare",
      recipientPhone: bareRecipientPhone,
    };
  }

  return {
    kind: "none",
  };
}

function hostedLinqRouteBindingAuthorityMatchesCurrentRoute(input: {
  authority: HostedLinqHomeLineRouteBindingAuthority;
  incomingChatId: string;
  routing: HostedMemberRoutingStateSnapshot | null;
}): boolean {
  if (input.authority.kind === "member-identity") {
    return true;
  }

  if (input.authority.kind === "home-linq-chat") {
    return input.routing?.linqChatId === input.incomingChatId;
  }

  return input.routing?.pendingLinqParticipantContact?.lookupKey === input.authority.contact.lookupKey;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}
