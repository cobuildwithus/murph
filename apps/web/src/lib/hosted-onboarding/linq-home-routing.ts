import { type HostedMemberSnapshot } from "./hosted-member-store";
import {
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx,
  countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince,
  countHostedMemberHomeLinqBindingsByRecipientPhone,
  readHostedMemberRoutingState,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
} from "./hosted-member-routing-store";
import { chooseHostedLinqHomeLine } from "./linq-routing-policy";
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

export async function reserveHostedLinqHomeLineForPhoneTx(input: {
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLinePhoneReservationResult> {
  await acquireHostedMemberHomeLinqRecipientAssignmentLockTx({
    prisma: input.prisma,
  });

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

export async function reserveOrReuseHostedMemberLinqHomeLineForRouteTx(input: {
  chatId: string;
  memberId: string;
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLinePhoneReservationResult> {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  if (!phoneNumber) {
    return {
      kind: "unassignable",
    };
  }

  await acquireHostedMemberHomeLinqRecipientAssignmentLockTx({
    prisma: input.prisma,
  });

  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const existingAssignedAt = routing?.linqHomeLineAssignedAt ?? null;
  const existingRecipientPhone = normalizePhoneNumber(routing?.linqRecipientPhone);
  const routeMatches =
    existingAssignedAt !== null
    && existingRecipientPhone === phoneNumber
    && (routing?.linqChatId === input.chatId || routing?.pendingLinqChatId === input.chatId);

  const line = await readHostedLinqAssignableHomeLineByPhone({
    phoneNumber,
    prisma: input.prisma,
  });

  if (!line) {
    return {
      kind: "unassignable",
    };
  }

  if (routeMatches) {
    return {
      kind: "reserved",
      reservation: {
        assignedAt: existingAssignedAt,
        line,
      },
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

export async function reserveHostedLinqHomeLineFromPoolTx(input: {
  preferredRecipientPhone?: string | null;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLineAssignmentReservation | null> {
  await acquireHostedMemberHomeLinqRecipientAssignmentLockTx({
    prisma: input.prisma,
  });

  return reserveHostedLinqHomeLineFromCandidatesTx({
    lines: await listHostedLinqAssignableHomeLines({
      prisma: input.prisma,
    }),
    preferredRecipientPhone: input.preferredRecipientPhone ?? null,
    prisma: input.prisma,
  });
}

export async function resolveHostedMemberActivationLinqRoute(input: {
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberActivationLinqRouteResolution> {
  const routing = input.member.routing;
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
    member: input.member,
    prisma: input.prisma,
  });
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
  lines: readonly HostedLinqAssignableHomeLine[];
  preferredRecipientPhone?: string | null;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLineAssignmentReservation | null> {
  const recipientPhones = input.lines.map((line) => line.phoneNumber);

  if (recipientPhones.length === 0) {
    return null;
  }

  const now = new Date();
  const activeMembersByRecipientPhone = await countHostedMemberHomeLinqBindingsByRecipientPhone({
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
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<{ homeLineAssignedAt?: Date; recipientPhone: string | null }> {
  const existingRecipientPhone = normalizePhoneNumber(input.member.routing?.linqRecipientPhone);
  if (existingRecipientPhone) {
    return {
      recipientPhone: existingRecipientPhone,
    };
  }

  const reservation = await reserveHostedLinqHomeLineFromPoolTx({
    preferredRecipientPhone: input.member.routing?.pendingLinqRecipientPhone ?? null,
    prisma: input.prisma,
  });

  return {
    ...(reservation ? { homeLineAssignedAt: reservation.assignedAt } : {}),
    recipientPhone: reservation?.line.phoneNumber ?? null,
  };
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}
