import { Prisma } from "@prisma/client";

import { createHostedLinqChatLookupKey, createHostedLinqChatLookupKeyReadCandidates } from "./contact-privacy";
import {
  hasHostedMemberGeneralAccess,
} from "./entitlement";
import { hostedOnboardingError } from "./errors";
import { shareHostedLinqContactCard } from "./linq-client";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import {
  assertHostedThreadRouteEgressAuthority,
  type HostedLinqThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";
import type {
  HostedOnboardingReadClient,
} from "./shared";

type HostedLinqContactCardSharePersistenceClient =
  {
    hostedLinqContactCardShare: {
      create(input: HostedLinqContactCardShareCreateInput): Promise<unknown>;
      findMany(input: HostedLinqContactCardShareFindManyInput):
        Promise<HostedLinqContactCardShareExisting[]>;
      updateMany(input: HostedLinqContactCardShareUpdateManyInput):
        Promise<{ count: number }>;
    };
  };

type HostedLinqContactCardShareExisting = {
  lastContactCardShareAttemptedAt: Date | null;
  linqChatLookupKey: string;
};

type HostedLinqContactCardShareCreateInput = {
  data: {
    lastContactCardShareAttemptedAt: Date;
    linqChatLookupKey: string;
    memberId: string;
  };
};

type HostedLinqContactCardShareUpdateManyInput = {
  data: {
    lastContactCardShareAttemptedAt?: Date | null;
    memberId?: string;
  };
  where: Record<string, unknown>;
};

type HostedLinqContactCardShareFindManyInput = {
  select: {
    lastContactCardShareAttemptedAt: true;
    linqChatLookupKey: true;
  };
  where: {
    linqChatLookupKey: {
      in: string[];
    };
  };
};

const HOSTED_LINQ_CONTACT_CARD_SHARE_THROTTLE_MS = 48 * 60 * 60 * 1000;

export type HostedLinqContactCardShareEligibility = {
  service: string | null;
  threadIsDirect: boolean | null;
};

type HostedLinqContactCardShareSkipReason =
  | "ineligible_chat"
  | "missing_chat_id"
  | "recent_attempt"
  | "state_unavailable";

export type HostedLinqContactCardShareDecision =
  | {
      action: "share";
    }
  | {
      action: "skip";
      reason: HostedLinqContactCardShareSkipReason;
    };

type HostedLinqContactCardShareReserveDecision =
  | Extract<HostedLinqContactCardShareDecision, { action: "share" }>
  | Extract<HostedLinqContactCardShareDecision, { action: "skip" }>;

export async function maybeShareHostedLinqContactCardAfterOutboundForRuntime(input: {
  authority?: HostedLinqThreadRouteEgressAuthority | null;
  boundUserId: string;
  chatId: string;
  eligibility: HostedLinqContactCardShareEligibility;
  prisma: HostedOnboardingReadClient & HostedLinqContactCardSharePersistenceClient;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCardShareDecision> {
  await assertHostedLinqContactCardShareAuthority({
    authority: input.authority,
    boundUserId: input.boundUserId,
    chatId: input.chatId,
    prisma: input.prisma,
  });

  return await maybeShareHostedLinqContactCardAfterOutbound({
    chatId: input.chatId,
    eligibility: input.eligibility,
    memberId: input.boundUserId,
    prisma: input.prisma,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

export async function maybeShareHostedLinqContactCardAfterOutboundWithAuthority(input: {
  authority: HostedLinqThreadRouteEgressAuthority;
  boundUserId: string;
  chatId: string;
  eligibility: HostedLinqContactCardShareEligibility;
  prisma: HostedOnboardingReadClient & HostedLinqContactCardSharePersistenceClient;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCardShareDecision> {
  return await maybeShareHostedLinqContactCardAfterOutboundForRuntime(input);
}

async function assertHostedLinqContactCardShareAuthority(input: {
  authority?: HostedLinqThreadRouteEgressAuthority | null;
  boundUserId: string;
  chatId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<void> {
  if (input.authority) {
    if (input.authority.containerMemberId !== input.boundUserId) {
      throwHostedLinqContactCardShareUnauthorized(
        "HOSTED_LINQ_CONTACT_CARD_SHARE_BOUND_USER_MISMATCH",
        "Hosted Linq contact-card share authority does not match the runtime user.",
      );
    }
    if (input.authority.threadId !== input.chatId) {
      throwHostedLinqContactCardShareUnauthorized(
        "HOSTED_LINQ_CONTACT_CARD_SHARE_THREAD_MISMATCH",
        "Hosted Linq contact-card share authority does not match the requested chat.",
      );
    }

    await assertHostedThreadRouteEgressAuthority({
      authority: input.authority,
      prisma: input.prisma,
    });
    return;
  }

  await assertHostedLinqContactCardShareMemberChat(input);
}

async function assertHostedLinqContactCardShareMemberChat(input: {
  boundUserId: string;
  chatId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<void> {
  const chatLookup = resolveHostedLinqContactCardShareLookup(input.chatId);
  if (!chatLookup) {
    throwHostedLinqContactCardShareUnauthorized(
      "HOSTED_LINQ_CONTACT_CARD_SHARE_THREAD_MISMATCH",
      "Hosted Linq contact-card share requires a known Linq chat.",
    );
  }

  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.boundUserId,
    },
    select: {
      linqChatLookupKey: true,
      member: {
        select: {
          billingStatus: true,
          createdAt: true,
          id: true,
          suspendedAt: true,
          updatedAt: true,
        },
      },
      pendingLinqChatLookupKey: true,
    },
  });

  const readCandidates = new Set(chatLookup.readCandidates);
  // First-contact members are not_started until they accept the invite, but we
  // still want them to receive Murph's contact card so they can save the
  // number during onboarding. Gate on general access (blocks suspended and
  // canceled/paused/unpaid) rather than active-only access, while still
  // requiring the chat to match the member's own bound route below.
  if (
    !routing
    || !hasHostedMemberGeneralAccess(routing.member)
    || !(
      (routing.linqChatLookupKey && readCandidates.has(routing.linqChatLookupKey))
      || (
        routing.pendingLinqChatLookupKey
        && readCandidates.has(routing.pendingLinqChatLookupKey)
      )
    )
  ) {
    throwHostedLinqContactCardShareUnauthorized(
      "HOSTED_LINQ_CONTACT_CARD_SHARE_THREAD_MISMATCH",
      "Hosted Linq contact-card share authority does not match the requested chat.",
    );
  }
}

function throwHostedLinqContactCardShareUnauthorized(
  code: string,
  message: string,
): never {
  throw hostedOnboardingError({
    code,
    httpStatus: 403,
    message,
    retryable: false,
  });
}

async function reserveHostedLinqContactCardShareAttemptAfterOutbound(input: {
  chatId: string;
  eligibility: HostedLinqContactCardShareEligibility;
  memberId: string;
  now?: Date;
  prisma: HostedLinqContactCardSharePersistenceClient;
}): Promise<HostedLinqContactCardShareReserveDecision> {
  const now = input.now ?? new Date();
  const chatLookup = resolveHostedLinqContactCardShareLookup(input.chatId);
  if (!chatLookup) {
    return {
      action: "skip",
      reason: "missing_chat_id",
    };
  }

  if (!isHostedLinqContactCardShareEligible(input.eligibility)) {
    return {
      action: "skip",
      reason: "ineligible_chat",
    };
  }

  const attemptBefore = new Date(
    now.getTime() - HOSTED_LINQ_CONTACT_CARD_SHARE_THROTTLE_MS,
  );
  const existingRows = await input.prisma.hostedLinqContactCardShare.findMany({
    where: {
      linqChatLookupKey: {
        in: [...chatLookup.readCandidates],
      },
    },
    select: {
      lastContactCardShareAttemptedAt: true,
      linqChatLookupKey: true,
    },
  });

  if (existingRows.length === 0) {
    return await createHostedLinqContactCardShareAttemptReservation({
      chatLookupKey: chatLookup.writeKey,
      memberId: input.memberId,
      now,
      prisma: input.prisma,
    });
  }

  const hasRecentAttempt = existingRows.some((row) =>
    row.lastContactCardShareAttemptedAt
    && row.lastContactCardShareAttemptedAt > attemptBefore,
  );
  if (hasRecentAttempt) {
    return {
      action: "skip",
      reason: "recent_attempt",
    };
  }

  const currentReservation = existingRows.find((row) =>
    row.linqChatLookupKey === chatLookup.writeKey
  );
  if (!currentReservation) {
    return await createHostedLinqContactCardShareAttemptReservation({
      chatLookupKey: chatLookup.writeKey,
      memberId: input.memberId,
      now,
      prisma: input.prisma,
    });
  }

  const reserved = await input.prisma.hostedLinqContactCardShare.updateMany({
    where: {
      linqChatLookupKey: chatLookup.writeKey,
      OR: [
        { lastContactCardShareAttemptedAt: null },
        { lastContactCardShareAttemptedAt: { lte: attemptBefore } },
      ],
    },
    data: {
      lastContactCardShareAttemptedAt: now,
      memberId: input.memberId,
    },
  });

  if (reserved.count !== 1) {
    return {
      action: "skip",
      reason: "recent_attempt",
    };
  }

  return {
    action: "share",
  };
}

export async function maybeShareHostedLinqContactCardAfterOutbound(input: {
  chatId: string;
  eligibility: HostedLinqContactCardShareEligibility;
  memberId: string;
  now?: Date;
  prisma: HostedLinqContactCardSharePersistenceClient;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCardShareDecision> {
  let reservation: HostedLinqContactCardShareReserveDecision;
  try {
    reservation = await reserveHostedLinqContactCardShareAttemptAfterOutbound({
      chatId: input.chatId,
      eligibility: input.eligibility,
      memberId: input.memberId,
      now: input.now,
      prisma: input.prisma,
    });
  } catch (error) {
    logHostedLinqContactCardShareFailure({
      chatId: input.chatId,
      error,
      phase: "reserve",
    });
    return {
      action: "skip",
      reason: "state_unavailable",
    };
  }

  if (reservation.action !== "share") {
    return reservation;
  }

  try {
    await shareHostedLinqContactCard({
      chatId: input.chatId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    logHostedLinqContactCardShareFailure({
      chatId: input.chatId,
      error,
      phase: "provider",
    });
    return {
      action: "share",
    };
  }

  return {
    action: "share",
  };
}

function resolveHostedLinqContactCardShareLookup(
  chatId: string,
): { readCandidates: readonly string[]; writeKey: string } | null {
  const writeKey = createHostedLinqChatLookupKey(chatId);
  const readCandidates = createHostedLinqChatLookupKeyReadCandidates(chatId);
  if (!writeKey || readCandidates.length === 0) {
    return null;
  }
  return {
    readCandidates,
    writeKey,
  };
}

function isHostedLinqContactCardShareEligible(
  eligibility: HostedLinqContactCardShareEligibility,
): boolean {
  return eligibility.service?.trim().toLowerCase() === "imessage"
    && eligibility.threadIsDirect === true;
}

async function createHostedLinqContactCardShareAttemptReservation(input: {
  chatLookupKey: string;
  memberId: string;
  now: Date;
  prisma: HostedLinqContactCardSharePersistenceClient;
}): Promise<HostedLinqContactCardShareReserveDecision> {
  try {
    await input.prisma.hostedLinqContactCardShare.create({
      data: {
        lastContactCardShareAttemptedAt: input.now,
        linqChatLookupKey: input.chatLookupKey,
        memberId: input.memberId,
      },
    });
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      return {
        action: "skip",
        reason: "recent_attempt",
      };
    }
    throw error;
  }

  return {
    action: "share",
  };
}

function logHostedLinqContactCardShareFailure(input: {
  chatId: string;
  error: unknown;
  phase: string;
}): void {
  const errorRecord = input.error && typeof input.error === "object"
    ? input.error as Record<string, unknown>
    : null;
  const details = errorRecord?.details && typeof errorRecord.details === "object"
    ? errorRecord.details as Record<string, unknown>
    : null;

  console.warn(
    "Hosted Linq contact-card share failed.",
    sanitizeHostedOnboardingStructuredLogDetails({
      chatIdSuffix: toHostedOnboardingLogIdSuffix(input.chatId),
      errorCode: readHostedLinqContactCardShareString(errorRecord, "code"),
      errorMessage: input.error instanceof Error ? input.error.message : null,
      errorName: input.error instanceof Error ? input.error.name : null,
      operation: "share_contact_card",
      phase: input.phase,
      provider: "linq",
      status: readHostedLinqContactCardShareNumber(details, "status"),
    }),
  );
}

function readHostedLinqContactCardShareString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  return record && typeof record[key] === "string" ? record[key] : null;
}

function readHostedLinqContactCardShareNumber(
  record: Record<string, unknown> | null,
  key: string,
): number | null {
  return record && typeof record[key] === "number" ? record[key] : null;
}

function isPrismaUniqueViolation(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
