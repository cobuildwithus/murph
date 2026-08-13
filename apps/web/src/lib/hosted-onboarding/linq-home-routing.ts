import { type HostedMemberSnapshot } from "./hosted-member-store";
import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  acquireHostedMemberHomeLinqRouteLockTx,
  readHostedMemberRoutingState,
  type HostedMemberRoutingStateSnapshot,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
} from "./hosted-member-routing-store";
import {
  chooseHostedLinqHomeLine,
  chooseHostedLinqSignupWelcomeLine,
  resolveHostedLinqSignupWelcomeDailyLimit,
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
  claimHostedLinqProactiveConversationCapacityTx,
  type HostedLinqAssignableHomeLine,
  listHostedLinqAssignableHomeLines,
  readHostedLinqIncomingLineState,
  readHostedLinqRecentMessageEffectCountsTx,
  listHostedLinqHealthyProactiveLines,
} from "./linq-line-store";
import {
  buildHostedLinqAssignmentPlanningMessages,
  readHostedLinqLinePlanningLoadSnapshot,
} from "./linq-line-planning-load";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "./linq-observability-identifiers";
import { normalizePhoneNumber } from "./phone";
import { hostedOnboardingError } from "./errors";
import type { HostedLinqParticipantContact } from "./linq-participant-contact";
import { lockHostedMemberRow } from "./shared";
import type { Prisma } from "@prisma/client";

const HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX = "signup-welcome:";

export interface HostedMemberActivationLinqRouteResolution {
  welcomeRoute: HostedMemberAssistantNotificationRoute | null;
}

export interface HostedLinqHomeLineAssignmentReservation {
  assignedAt: Date;
  line: HostedLinqAssignableHomeLine;
  proactiveConversationReserved: boolean;
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
      selectedLine?: HostedLinqAssignableHomeLine;
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

export type HostedSignupWelcomeHomeRouteMaterializationResult =
  | {
      kind: "materialized" | "already_materialized";
    }
  | {
      kind: "superseded";
    };

/**
 * Promotes the provider chat returned by Murph's canonical participant welcome
 * into the existing Web-owned home route. Provider/dashboard telemetry is not
 * sufficient authority for this transition; the signed runtime callback must
 * agree with the verified member, assigned line, and pre-provider dispatch
 * fence while the current route is locked.
 */
export async function materializeHostedSignupWelcomeHomeRouteTx(input: {
  directRecipientPhoneNumber: string;
  fromPhoneNumber: string;
  idempotencyKey: string;
  linqChatId: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedSignupWelcomeHomeRouteMaterializationResult> {
  const idempotencyKey = input.idempotencyKey.trim();
  const linqChatId = input.linqChatId.trim();
  const directRecipientPhoneNumber = normalizePhoneNumber(
    input.directRecipientPhoneNumber,
  );
  const fromPhoneNumber = normalizePhoneNumber(input.fromPhoneNumber);
  const expectedIdempotencyKey =
    `${HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX}${input.memberId}`;
  const deliveryIdempotencyLookupKey =
    createHostedLinqDeliveryIdempotencyLookupKey(idempotencyKey);
  const directRecipientLookupKeys =
    createHostedPhoneLookupKeyReadCandidates(directRecipientPhoneNumber);
  const fromPhoneLookupKeys =
    createHostedPhoneLookupKeyReadCandidates(fromPhoneNumber);
  const linqChatLookupKeys =
    createHostedLinqChatLookupKeyReadCandidates(linqChatId);

  if (
    idempotencyKey !== expectedIdempotencyKey
    || !deliveryIdempotencyLookupKey
    || !directRecipientPhoneNumber
    || directRecipientLookupKeys.length === 0
    || !fromPhoneNumber
    || fromPhoneLookupKeys.length === 0
    || !linqChatId
    || linqChatLookupKeys.length === 0
  ) {
    throwHostedSignupWelcomeRouteAuthorityInvalid();
  }

  // Identity reconciliation locks the member row before mutating verified
  // identity. Taking the same lock closes the send-to-callback phone-change
  // race without persisting the raw participant target.
  await lockHostedMemberRow(input.prisma, input.memberId);
  await acquireHostedMemberHomeLinqRouteLockTx({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  const delivery = await input.prisma.hostedLinqDelivery.findUnique({
    where: { idempotencyKey: deliveryIdempotencyLookupKey },
    select: {
      acceptedAt: true,
      linqChatLookupKey: true,
      phoneNumberLookupKey: true,
      source: true,
      targetKind: true,
    },
  });

  if (
    !delivery
    || delivery.source !== "hosted_runtime_linq_delivery"
    || delivery.targetKind !== "participant"
    || !delivery.phoneNumberLookupKey
    || !fromPhoneLookupKeys.includes(delivery.phoneNumberLookupKey)
    || (
      delivery.linqChatLookupKey !== null
      && !linqChatLookupKeys.includes(delivery.linqChatLookupKey)
    )
    || (delivery.acceptedAt !== null && delivery.linqChatLookupKey === null)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_SIGNUP_WELCOME_DELIVERY_PROVENANCE_MISMATCH",
      httpStatus: 409,
      message: "Hosted signup welcome delivery does not match its provider dispatch claim.",
      retryable: true,
    });
  }

  const identity = await input.prisma.hostedMemberIdentity.findUnique({
    where: { memberId: input.memberId },
    select: {
      phoneLookupKey: true,
      phoneNumberVerifiedAt: true,
    },
  });
  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const authority = readHostedLinqHomeLineAuthority(routing);
  if (
    (authority.kind === "home" || authority.kind === "pending")
    && authority.chatId !== linqChatId
  ) {
    return { kind: "superseded" };
  }

  if (authority.kind === "none") {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_SIGNUP_WELCOME_HOME_ROUTE_UNAVAILABLE",
      httpStatus: 503,
      message: "Hosted signup welcome home-line authority is unavailable.",
      retryable: true,
    });
  }

  if (
    normalizePhoneNumber(authority.recipientPhone) !== fromPhoneNumber
    || !identity?.phoneNumberVerifiedAt
    || !identity.phoneLookupKey
    || !directRecipientLookupKeys.includes(identity.phoneLookupKey)
  ) {
    // The send was valid when it crossed the provider fence, but current member
    // identity or routing has since changed. Preserve the newer authority while
    // still allowing the factual delivery outcome to be recorded.
    return { kind: "superseded" };
  }

  await upsertHostedMemberHomeLinqBindingTx({
    clearPending: true,
    homeLineAssignedAt: authority.assignedAt,
    linqChatId,
    memberId: input.memberId,
    participantContact: {
      kind: "phone",
      lookupKey: identity.phoneLookupKey,
    },
    prisma: input.prisma,
    recipientPhone: fromPhoneNumber,
  });

  return {
    kind:
      authority.kind === "home"
        ? "already_materialized"
        : "materialized",
  };
}

function throwHostedSignupWelcomeRouteAuthorityInvalid(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_SIGNUP_WELCOME_ROUTE_AUTHORITY_INVALID",
    httpStatus: 400,
    message: "Hosted signup welcome route materialization authority is invalid.",
    retryable: false,
  });
}

export async function reserveHostedLinqHomeLineFromPoolTx(input: {
  preferredRecipientPhone: string | null;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLinePhoneReservationResult> {
  return reserveHostedLinqHomeLineFromAssignablePoolTx({
    preferredRecipientPhone: input.preferredRecipientPhone,
    prisma: input.prisma,
    reservationKind: "inbound",
  });
}

/**
 * Claims one healthy line for a new participant-target conversation. The
 * shared chooser, active-home load, UTC-day capacity, and atomic line counter
 * remain owned here; callers receive no line unless capacity was reserved.
 */
export async function reserveHostedLinqHealthyProactiveLineTx(input: {
  excludedPhoneNumberLookupKey?: string | null;
  now?: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLinePhoneReservationResult> {
  const healthyLines = await listHostedLinqHealthyProactiveLines({ prisma: input.prisma });
  const lines = input.excludedPhoneNumberLookupKey
    ? healthyLines.filter((line) =>
        line.phoneNumberLookupKey !== input.excludedPhoneNumberLookupKey
      )
    : healthyLines;
  const reservation = await reserveHostedLinqHomeLineFromCandidatesTx({
    lines,
    ...(input.now ? { now: input.now } : {}),
    preferredRecipientPhone: null,
    prisma: input.prisma,
    reservationKind: "required_proactive",
  });

  return reservation
    ? { kind: "reserved", reservation }
    : { kind: "capacity_exhausted" };
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
  acceptManagedInboundLine?: boolean;
  incomingChatId: string;
  incomingDirectAttested: boolean;
  incomingRecipientPhone: string | null;
  memberAuthority?: HostedLinqHomeLineRouteBindingAuthority | null;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLineRouteBindingResult> {
  // One member owns one home route. Serializing only that member keeps
  // concurrent first binds stable without coupling unrelated members.
  await acquireHostedMemberHomeLinqRouteLockTx({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const decision = await resolveHostedMemberLinqHomeLineRouteBindingDecision(input);
  if (decision.kind === "done") {
    return decision.result;
  }

  if (
    input.acceptManagedInboundLine === true
    && input.incomingDirectAttested
    && input.memberAuthority?.kind === "member-identity"
  ) {
    const recipientPhone = normalizePhoneNumber(decision.preferredRecipientPhone);
    const incomingLineState = await readHostedLinqIncomingLineState({
      phoneNumberLookupKeys:
        createHostedPhoneLookupKeyReadCandidates(recipientPhone),
      prisma: input.prisma,
    });
    if (
      recipientPhone
      && (
        incomingLineState.kind === "assignable"
        || incomingLineState.kind === "at_risk"
        || incomingLineState.kind === "degraded_unavailable"
      )
    ) {
      // A provider-attested direct message from an active, exact member
      // identity establishes the relationship itself. The contacted managed
      // line only needs to be safe for a reply; proactive assignment health
      // and capacity must not discard the member's already-arrived message.
      return {
        homeLineAssignedAt: new Date(),
        kind: "bind",
        recipientPhone,
      };
    }
  }

  const reservationResult = await reserveHostedLinqHomeLineFromAssignablePoolTx({
    preferredRecipientPhone: decision.preferredRecipientPhone,
    now: new Date(),
    prisma: input.prisma,
    reservationKind: "inbound",
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
    selectedLine: reservationResult.reservation.line,
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

  // New claim: prefer the contacted line. Whether it is assignable is decided
  // from the current pool snapshot, so a degraded incoming line falls over
  // instead of failing closed.
  return {
    kind: "reserve",
    preferredRecipientPhone: recipientPhone,
  };
}

export async function resolveHostedMemberActivationLinqRoute(input: {
  allowNoAssignableLine?: boolean;
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberActivationLinqRouteResolution> {
  await acquireHostedMemberHomeLinqRouteLockTx({
    memberId: input.member.core.id,
    prisma: input.prisma,
  });
  return resolveHostedMemberActivationLinqRouteAttempt({
    ...(input.allowNoAssignableLine
      ? { allowNoAssignableLine: true }
      : {}),
    member: input.member,
    prisma: input.prisma,
  });
}

async function resolveHostedMemberActivationLinqRouteAttempt(input: {
  allowNoAssignableLine?: boolean;
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberActivationLinqRouteResolution> {
  const routing = await readHostedMemberRoutingState({
    memberId: input.member.core.id,
    prisma: input.prisma,
  }) ?? input.member.routing;
  const messaging = resolveHostedMemberMessagingState({
    identity: input.member.identity,
    routing,
  });
  const memberPhoneNumber = input.member.identity?.phoneNumber ?? null;
  const authority = readHostedLinqHomeLineAuthority(routing);
  const linqContactLookupKey =
    resolveHostedMemberActivationLinqContactLookupKey({
      member: input.member,
      routing,
    });

  if (authority.kind === "home") {
    if (routing?.pendingLinqChatId) {
      await upsertHostedMemberHomeLinqBindingTx({
        clearPending: true,
        linqChatId: authority.chatId,
        memberId: input.member.core.id,
        participantContact: authority.participantContact,
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
    && canPromoteHostedMemberActivationPendingLinqRoute({
      authority,
      linqContactLookupKey,
      memberPhoneNumber,
    })
  ) {
    await upsertHostedMemberHomeLinqBindingTx({
      clearPending: true,
      linqChatId: authority.chatId,
      memberId: input.member.core.id,
      participantContact: authority.participantContact,
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
    member: input.member,
    prisma: input.prisma,
    routing,
  });
  const targetRecipientPhone = normalizePhoneNumber(target.recipientPhone);

  if (!targetRecipientPhone) {
    if (input.allowNoAssignableLine) {
      return {
        welcomeRoute: null,
      };
    }
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

  if (!target.proactiveConversationReserved) {
    return {
      welcomeRoute: null,
    };
  }

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

function resolveHostedMemberActivationLinqContactLookupKey(input: {
  member: HostedMemberSnapshot;
  routing: HostedMemberRoutingStateSnapshot | null;
}): string | null {
  return input.member.identity?.phoneLookupKey
    ?? input.routing?.pendingLinqParticipantContact?.lookupKey
    ?? input.member.emailAuthorization?.verifiedEmail?.lookupKey
    ?? null;
}

function canPromoteHostedMemberActivationPendingLinqRoute(input: {
  authority: {
    recipientPhone: string | null;
  };
  linqContactLookupKey: string | null;
  memberPhoneNumber: string | null;
}): boolean {
  return Boolean(
    input.linqContactLookupKey
    && (
      input.memberPhoneNumber === null
      || input.authority.recipientPhone !== null
    ),
  );
}

async function reserveHostedLinqHomeLineFromCandidatesTx(input: {
  excludedActiveMemberId?: string | null;
  lines: readonly HostedLinqAssignableHomeLine[];
  now?: Date;
  preferredRecipientPhone?: string | null;
  prisma: Prisma.TransactionClient;
  reservationKind: "inbound" | "required_proactive" | "signup_welcome";
}): Promise<HostedLinqHomeLineAssignmentReservation | null> {
  const recipientPhones = input.lines.map((line) => line.phoneNumber);

  if (recipientPhones.length === 0) {
    return null;
  }

  const now = input.now ?? new Date();
  const preferredRecipientPhone = normalizePhoneNumber(input.preferredRecipientPhone);
  const preferredInboundLine = input.reservationKind === "inbound"
    ? input.lines.find((line) => line.phoneNumber === preferredRecipientPhone)
    : null;

  // A healthy contacted line owns member-initiated first contact. Weighted
  // planning and recent traffic balance proactive placement and degraded-line
  // fallback; neither may turn a reciprocal inbound conversation into a
  // cross-line send that can be suppressed by proactive pacing.
  if (preferredInboundLine) {
    return {
      assignedAt: now,
      line: preferredInboundLine,
      proactiveConversationReserved: false,
    };
  }

  const planningLoadSnapshot = await readHostedLinqLinePlanningLoadSnapshot({
    ...(input.excludedActiveMemberId
      ? { excludedActiveMemberId: input.excludedActiveMemberId }
      : {}),
    lines: input.lines,
    now,
    prisma: input.prisma,
  });
  const plannedMessagesByRecipientPhone =
    buildHostedLinqAssignmentPlanningMessages(planningLoadSnapshot);
  const dayUtc = startOfUtcDay(now);
  const proactiveConversationCounts = new Map(
    input.lines.map((line) => [
      line.phoneNumber,
      line.proactiveConversationDayUtc?.getTime() === dayUtc.getTime()
        ? line.proactiveConversationCount ?? 0
        : 0,
    ]),
  );
  const recentMessageEffectsByLineLookupKey = input.lines.length > 1
    ? await readHostedLinqRecentMessageEffectCountsTx({
        lineLookupKeys: input.lines.map((line) => line.phoneNumberLookupKey),
        now,
        prisma: input.prisma,
      })
    : new Map<string, number>();
  const preferredOrFallbackLine = chooseHostedLinqHomeLine({
    ignoreDailyNewConversationLimit: true,
    lines: input.lines,
    newAssignmentsByRecipientPhone: proactiveConversationCounts,
    plannedMessagesByRecipientPhone,
    preferredRecipientPhone: input.preferredRecipientPhone ?? null,
    recentMessageEffectsByLineLookupKey,
  });

  if (input.reservationKind === "inbound") {
    const proactiveLine = chooseHostedLinqSignupWelcomeLine({
      lines: input.lines,
      newAssignmentsByRecipientPhone: proactiveConversationCounts,
      plannedMessagesByRecipientPhone,
      preferredRecipientPhone: input.preferredRecipientPhone ?? null,
      recentMessageEffectsByLineLookupKey,
    });
    const selectedLine = proactiveLine ?? preferredOrFallbackLine;
    if (!selectedLine) {
      return null;
    }

    return {
      assignedAt: now,
      line: selectedLine,
      proactiveConversationReserved: false,
    };
  }

  for (let lineAttempt = 0; lineAttempt < input.lines.length; lineAttempt += 1) {
    const proactiveLine = chooseHostedLinqSignupWelcomeLine({
      lines: input.lines,
      newAssignmentsByRecipientPhone: proactiveConversationCounts,
      plannedMessagesByRecipientPhone,
      preferredRecipientPhone: input.preferredRecipientPhone ?? null,
      recentMessageEffectsByLineLookupKey,
    });
    if (!proactiveLine) {
      break;
    }

    const limit = resolveHostedLinqSignupWelcomeDailyLimit(proactiveLine);
    let proactiveConversationReserved = false;
    // A day rollover can make the first conditional update lose to another
    // transaction even when capacity remains. Retry once inside this request,
    // then move to the next line if the claim still loses.
    for (let claimAttempt = 0; claimAttempt < 2; claimAttempt += 1) {
      proactiveConversationReserved =
        await claimHostedLinqProactiveConversationCapacityTx({
          dayUtc,
          limit,
          phoneNumberLookupKey: proactiveLine.phoneNumberLookupKey,
          prisma: input.prisma,
          ...(input.reservationKind === "required_proactive"
            ? { requiredHealthStatus: "healthy" as const }
            : {}),
        });
      if (proactiveConversationReserved) {
        break;
      }
    }

    if (proactiveConversationReserved) {
      return {
        assignedAt: now,
        line: proactiveLine,
        proactiveConversationReserved: true,
      };
    }

    proactiveConversationCounts.set(proactiveLine.phoneNumber, limit);
  }

  if (input.reservationKind === "required_proactive") {
    return null;
  }

  return preferredOrFallbackLine
    ? {
        assignedAt: now,
        line: preferredOrFallbackLine,
        proactiveConversationReserved: false,
      }
    : null;
}

async function resolveHostedMemberActivationTargetRecipientPhone(input: {
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
  routing: HostedMemberRoutingStateSnapshot | null;
}): Promise<{
  homeLineAssignedAt?: Date;
  proactiveConversationReserved?: boolean;
  recipientPhone: string | null;
}> {
  const routing = input.routing;
  const existingRecipientPhone = normalizePhoneNumber(routing?.linqRecipientPhone);

  const reservationResult = await reserveHostedLinqHomeLineFromAssignablePoolTx({
    excludedActiveMemberId: existingRecipientPhone ? input.member.core.id : null,
    preferredRecipientPhone:
      existingRecipientPhone
      ?? routing?.pendingLinqRecipientPhone
      ?? null,
    prisma: input.prisma,
    reservationKind: "signup_welcome",
  });

  if (reservationResult.kind !== "reserved") {
    return { recipientPhone: null };
  }

  return {
    homeLineAssignedAt:
      existingRecipientPhone === reservationResult.reservation.line.phoneNumber
        ? routing?.linqHomeLineAssignedAt ?? reservationResult.reservation.assignedAt
        : reservationResult.reservation.assignedAt,
    recipientPhone: reservationResult.reservation.line.phoneNumber,
    proactiveConversationReserved: reservationResult.reservation.proactiveConversationReserved,
  };
}

async function reserveHostedLinqHomeLineFromAssignablePoolTx(input: {
  excludedActiveMemberId?: string | null;
  now?: Date;
  preferredRecipientPhone: string | null;
  prisma: Prisma.TransactionClient;
  reservationKind: "inbound" | "signup_welcome";
}): Promise<HostedLinqHomeLinePhoneReservationResult> {
  const lines = await listHostedLinqAssignableHomeLines({ prisma: input.prisma });
  const reservation = await reserveHostedLinqHomeLineFromCandidatesTx({
    ...(input.excludedActiveMemberId
      ? { excludedActiveMemberId: input.excludedActiveMemberId }
      : {}),
    lines,
    ...(input.now ? { now: input.now } : {}),
    preferredRecipientPhone: input.preferredRecipientPhone,
    prisma: input.prisma,
    reservationKind: input.reservationKind,
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
      participantContact?: {
        kind: "email" | "phone";
        lookupKey: string;
      } | null;
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
      ...(routing.linqParticipantContact
        ? { participantContact: routing.linqParticipantContact }
        : {}),
      recipientPhone: normalizePhoneNumber(routing.linqRecipientPhone),
    };
  }

  if (routing?.pendingLinqChatId) {
    return {
      assignedAt: routing.linqHomeLineAssignedAt ?? null,
      chatId: routing.pendingLinqChatId,
      kind: "pending",
      ...(routing.pendingLinqParticipantContact
        ? {
            participantContact: {
              kind: routing.pendingLinqParticipantContact.kind,
              lookupKey: routing.pendingLinqParticipantContact.lookupKey,
            },
          }
        : {}),
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

export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}
