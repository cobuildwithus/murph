import { Prisma } from "@prisma/client";

import { createHostedLinqChatLookupKey, createHostedLinqChatLookupKeyReadCandidates } from "./contact-privacy";
import { shareHostedLinqContactCard } from "./linq-client";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "./logging";

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

  const existingKeys = existingRows.map((row) => row.linqChatLookupKey);
  const hasWriteKey = existingKeys.includes(chatLookup.writeKey);
  const reserved = await input.prisma.hostedLinqContactCardShare.updateMany({
    where: {
      linqChatLookupKey: {
        in: existingKeys,
      },
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

  if (!hasWriteKey) {
    return await createHostedLinqContactCardShareAttemptReservation({
      chatLookupKey: chatLookup.writeKey,
      memberId: input.memberId,
      now,
      prisma: input.prisma,
    });
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
