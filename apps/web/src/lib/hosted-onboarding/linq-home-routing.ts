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
  readHostedLinqAssignableHomeLineByPhone,
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

export type HostedLinqHomeLineNewChatDeliveryResult =
  | {
      chatId: string;
      kind: "existing_pending";
    }
  | {
      kind: "reserved";
      reservation: HostedLinqHomeLineAssignmentReservation;
    }
  | {
      kind: "already_bound";
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

export async function reserveHostedLinqHomeLineForPhoneTx(input: {
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLinePhoneReservationResult> {
  await acquireHostedMemberHomeLinqRecipientAssignmentLockTx({
    prisma: input.prisma,
  });

  return reserveHostedLinqHomeLineForPhoneAfterLockTx({
    phoneNumber: input.phoneNumber,
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
      line: HostedLinqAssignableHomeLine;
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
  // shared pool lock so they never wait behind unrelated line assignment;
  // the ops new-chat path holds that lock across a provider call.
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

  const reservationResult = await reserveHostedLinqHomeLineForLineAfterLockTx({
    line: lockedDecision.line,
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
  const currentRoute = resolveHostedMemberCurrentLinqRoute(routing);

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

  const routeDecision = resolveHostedLinqActiveRouteDecision({
    homeChatId: currentRoute?.chatId ?? null,
    homeRecipientPhone: currentRoute?.recipientPhone ?? null,
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
    homeChatId: currentRoute?.chatId ?? null,
    homeRecipientPhone: currentRoute?.recipientPhone ?? null,
    incomingChatId: input.incomingChatId,
    incomingRecipientPhone: input.incomingRecipientPhone,
  });

  if (currentRoute?.chatId === input.incomingChatId) {
    if (currentRoute.kind === "pending" && recipientPhone) {
      const line = await readHostedLinqAssignableHomeLineByPhone({
        phoneNumber: recipientPhone,
        prisma: input.prisma,
      });

      if (!line) {
        return {
          kind: "done",
          result: {
            kind: "unassignable",
          },
        };
      }

      return {
        kind: "done",
        result: {
          homeLineAssignedAt: routing?.linqHomeLineAssignedAt ?? null,
          kind: "bind",
          recipientPhone: line.phoneNumber,
        },
      };
    }

    return {
      kind: "done",
      result: {
        homeLineAssignedAt: routing?.linqHomeLineAssignedAt ?? null,
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

  const line = await readHostedLinqAssignableHomeLineByPhone({
    phoneNumber: recipientPhone,
    prisma: input.prisma,
  });

  if (!line) {
    return {
      kind: "done",
      result: {
        kind: "unassignable",
      },
    };
  }

  if (routing && currentRoute && currentRoute.recipientPhone === line.phoneNumber) {
    return {
      kind: "done",
      result: {
        homeLineAssignedAt: routing.linqHomeLineAssignedAt ?? null,
        kind: "bind",
        recipientPhone: line.phoneNumber,
      },
    };
  }

  const homeRecipientPhone = normalizePhoneNumber(routing?.linqRecipientPhone);
  if (
    routing
    && !routing.linqChatId
    && !routing.pendingLinqChatId
    && homeRecipientPhone === line.phoneNumber
  ) {
    return {
      kind: "done",
      result: {
        homeLineAssignedAt: routing.linqHomeLineAssignedAt ?? null,
        kind: "bind",
        recipientPhone: line.phoneNumber,
      },
    };
  }

  return {
    kind: "reserve",
    line,
  };
}

export async function resolveHostedMemberLinqHomeLineNewChatDeliveryTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  senderPhone: string;
}): Promise<HostedLinqHomeLineNewChatDeliveryResult> {
  const senderPhone = normalizePhoneNumber(input.senderPhone);
  if (!senderPhone) {
    return {
      kind: "unassignable",
    };
  }

  await acquireHostedMemberHomeLinqRecipientAssignmentLockTx({
    prisma: input.prisma,
  });

  const now = new Date();
  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const line = await readHostedLinqAssignableHomeLineByPhone({
    phoneNumber: senderPhone,
    prisma: input.prisma,
  });

  if (!line) {
    return {
      kind: "unassignable",
    };
  }

  const pendingRecipientPhone = normalizePhoneNumber(routing?.pendingLinqRecipientPhone);
  const homeRecipientPhone = normalizePhoneNumber(routing?.linqRecipientPhone);
  if (
    routing?.pendingLinqChatId
    && homeRecipientPhone === line.phoneNumber
    && pendingRecipientPhone === line.phoneNumber
  ) {
    return {
      chatId: routing.pendingLinqChatId,
      kind: "existing_pending",
    };
  }

  // Reclaim this member's own bare same-line reservation (left when a crash
  // or failed bind interrupted a prior attempt after the claim committed)
  // instead of blocking the retry. Legacy direct routes carry no assignment
  // timestamp and still fail closed below.
  if (
    routing
    && !routing.linqChatId
    && !routing.pendingLinqChatId
    && homeRecipientPhone === line.phoneNumber
    && routing.linqHomeLineAssignedAt
  ) {
    return {
      kind: "reserved",
      reservation: {
        assignedAt: routing.linqHomeLineAssignedAt,
        line,
      },
    };
  }

  if (routing?.linqChatId || routing?.pendingLinqChatId || homeRecipientPhone) {
    return {
      kind: "already_bound",
    };
  }

  return reserveHostedLinqHomeLineForLineAfterLockTx({
    line,
    now,
    prisma: input.prisma,
  });
}

export async function resolveHostedMemberActivationLinqRoute(input: {
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberActivationLinqRouteResolution> {
  // Most activations promote an existing home, pending, or assigned-line
  // route. Resolve those without the shared pool lock so activation never
  // waits behind unrelated line assignment; the ops new-chat path holds
  // that lock across a provider call.
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

  if (routing?.linqChatId) {
    if (routing.pendingLinqChatId) {
      await upsertHostedMemberHomeLinqBindingTx({
        clearPending: true,
        linqChatId: routing.linqChatId,
        memberId: input.member.core.id,
        prisma: input.prisma,
        recipientPhone: routing.linqRecipientPhone,
      });
    }

    return {
      welcomeRoute: resolveHostedMemberAssistantNotificationRoute({
        linqChatId: routing.linqChatId,
        linqContactLookupKey,
        memberId: input.member.core.id,
        memberPhoneNumber,
        messaging,
      }),
    };
  }

  const pendingLinqRecipientPhone = normalizePhoneNumber(routing?.pendingLinqRecipientPhone);
  const pendingLinqRecipientLine = pendingLinqRecipientPhone
    ? await readHostedLinqAssignableHomeLineByPhone({
        phoneNumber: pendingLinqRecipientPhone,
        prisma: input.prisma,
      })
    : null;
  if (
    routing?.pendingLinqChatId
    && linqContactLookupKey
    && (
      pendingLinqRecipientPhone
        ? pendingLinqRecipientLine !== null
        : true
    )
    && (
      memberPhoneNumber
        ? pendingLinqRecipientPhone !== null
        : true
    )
  ) {
    await upsertHostedMemberHomeLinqBindingTx({
      clearPending: true,
      linqChatId: routing.pendingLinqChatId,
      memberId: input.member.core.id,
      prisma: input.prisma,
      recipientPhone: pendingLinqRecipientPhone,
    });

    return {
      welcomeRoute: resolveHostedMemberAssistantNotificationRoute({
        linqChatId: routing.pendingLinqChatId,
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

async function reserveHostedLinqHomeLineForPhoneAfterLockTx(input: {
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLinePhoneReservationResult> {
  const line = await readHostedLinqAssignableHomeLineByPhone({
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
  });

  if (!line) {
    return {
      kind: "unassignable",
    };
  }

  const reservation = await reserveHostedLinqHomeLineFromCandidatesTx({
    lines: [line],
    preferredRecipientPhone: line.phoneNumber,
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

async function resolveHostedMemberActivationTargetRecipientPhone(input: {
  claimNewHomeLine: boolean;
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
  routing: HostedMemberRoutingStateSnapshot | null;
}): Promise<{ homeLineAssignedAt?: Date; recipientPhone: string | null } | "needs_claim"> {
  const routing = input.routing;
  const existingRecipientPhone = normalizePhoneNumber(routing?.linqRecipientPhone);
  if (existingRecipientPhone) {
    const existingRecipientLine = await readHostedLinqAssignableHomeLineByPhone({
      phoneNumber: existingRecipientPhone,
      prisma: input.prisma,
    });

    if (existingRecipientLine) {
      return {
        ...(routing?.linqHomeLineAssignedAt
          ? { homeLineAssignedAt: routing.linqHomeLineAssignedAt }
          : {}),
        recipientPhone: existingRecipientLine.phoneNumber,
      };
    }
  }

  // Claiming a new line consumes pool capacity; the caller must hold the
  // pool lock before allowing this branch.
  if (!input.claimNewHomeLine) {
    return "needs_claim";
  }

  const reservation = await reserveHostedLinqHomeLineFromCandidatesTx({
    lines: await listHostedLinqAssignableHomeLines({
      prisma: input.prisma,
    }),
    preferredRecipientPhone: routing?.pendingLinqRecipientPhone ?? null,
    prisma: input.prisma,
  });

  return {
    ...(reservation ? { homeLineAssignedAt: reservation.assignedAt } : {}),
    recipientPhone: reservation?.line.phoneNumber ?? null,
  };
}

async function reserveHostedLinqHomeLineForLineAfterLockTx(input: {
  line: HostedLinqAssignableHomeLine;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLinePhoneReservationResult> {
  const reservation = await reserveHostedLinqHomeLineFromCandidatesTx({
    lines: [input.line],
    now: input.now,
    preferredRecipientPhone: input.line.phoneNumber,
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

function resolveHostedMemberCurrentLinqRoute(
  routing: HostedMemberRoutingStateSnapshot | null,
): { chatId: string; kind: "home" | "pending"; recipientPhone: string | null } | null {
  if (routing?.linqChatId) {
    return {
      chatId: routing.linqChatId,
      kind: "home",
      recipientPhone: normalizePhoneNumber(routing.linqRecipientPhone),
    };
  }

  if (routing?.pendingLinqChatId) {
    return {
      chatId: routing.pendingLinqChatId,
      kind: "pending",
      recipientPhone: normalizePhoneNumber(routing.pendingLinqRecipientPhone),
    };
  }

  return null;
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
