import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { createHostedLinqChatLookupKey, createHostedLinqChatLookupKeyReadCandidates } from "./contact-privacy";
import { shareHostedLinqContactCard } from "./linq-client";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import type {
  HostedRuntimeLinqContactCardShareClaimResponse,
  HostedRuntimeLinqContactCardShareResultRequest,
  HostedRuntimeLinqContactCardShareResultResponse,
} from "@murphai/hosted-execution/runtime-control";

type HostedLinqContactCardSharePersistenceClient =
  {
    hostedLinqContactCardShare: {
      create(input: HostedLinqContactCardShareCreateInput): Promise<unknown>;
      findFirst(input: HostedLinqContactCardShareFindFirstInput):
        Promise<HostedLinqContactCardShareExisting | null>;
      updateMany(input: HostedLinqContactCardShareUpdateManyInput):
        Promise<{ count: number }>;
    };
  };

type HostedLinqContactCardShareExisting = {
  contactCardShareClaimedAt: Date | null;
  lastContactCardShareSucceededAt: Date | null;
  linqChatLookupKey: string;
};

type HostedLinqContactCardShareCreateInput = {
  data: {
    contactCardShareClaimedAt: Date;
    contactCardShareClaimId: string;
    linqChatLookupKey: string;
    memberId: string;
  };
};

type HostedLinqContactCardShareUpdateManyInput = {
  data: {
    contactCardShareClaimedAt?: Date | null;
    contactCardShareClaimId?: string | null;
    lastContactCardShareSucceededAt?: Date | null;
    memberId?: string;
  };
  where: Record<string, unknown>;
};

type HostedLinqContactCardShareFindFirstInput = {
  select: {
    contactCardShareClaimedAt: true;
    lastContactCardShareSucceededAt: true;
    linqChatLookupKey: true;
  };
  where: {
    linqChatLookupKey: {
      in: string[];
    };
  };
};

const HOSTED_LINQ_CONTACT_CARD_SHARE_THROTTLE_MS = 48 * 60 * 60 * 1000;
const HOSTED_LINQ_CONTACT_CARD_SHARE_CLAIM_TTL_MS = 10 * 60 * 1000;

export type HostedLinqContactCardShareEligibility = {
  service: string | null;
  threadIsDirect: boolean | null;
};

export type HostedLinqContactCardShareClaimDecision =
  HostedRuntimeLinqContactCardShareClaimResponse;

export async function claimHostedLinqContactCardShareAfterOutbound(input: {
  chatId: string;
  eligibility: HostedLinqContactCardShareEligibility;
  memberId: string;
  now?: Date;
  prisma: HostedLinqContactCardSharePersistenceClient;
}): Promise<HostedLinqContactCardShareClaimDecision> {
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

  const successBefore = new Date(
    now.getTime() - HOSTED_LINQ_CONTACT_CARD_SHARE_THROTTLE_MS,
  );
  const claimBefore = new Date(
    now.getTime() - HOSTED_LINQ_CONTACT_CARD_SHARE_CLAIM_TTL_MS,
  );
  const existing = await input.prisma.hostedLinqContactCardShare.findFirst({
    where: {
      linqChatLookupKey: {
        in: [...chatLookup.readCandidates],
      },
    },
    select: {
      contactCardShareClaimedAt: true,
      lastContactCardShareSucceededAt: true,
      linqChatLookupKey: true,
    },
  });

  if (!existing) {
    return await createHostedLinqContactCardShareClaim({
      chatLookupKey: chatLookup.writeKey,
      memberId: input.memberId,
      now,
      prisma: input.prisma,
    });
  }

  if (
    existing.lastContactCardShareSucceededAt
    && existing.lastContactCardShareSucceededAt > successBefore
  ) {
    return {
      action: "skip",
      reason: "recent_success",
    };
  }
  if (
    existing.contactCardShareClaimedAt
    && existing.contactCardShareClaimedAt > claimBefore
  ) {
    return {
      action: "skip",
      reason: "claim_active",
    };
  }

  const claimId = randomUUID();
  const claimed = await input.prisma.hostedLinqContactCardShare.updateMany({
    where: {
      linqChatLookupKey: existing.linqChatLookupKey,
      AND: [
        {
          OR: [
            { lastContactCardShareSucceededAt: null },
            { lastContactCardShareSucceededAt: { lte: successBefore } },
          ],
        },
        {
          OR: [
            { contactCardShareClaimedAt: null },
            { contactCardShareClaimedAt: { lte: claimBefore } },
          ],
        },
      ],
    },
    data: {
      contactCardShareClaimedAt: now,
      contactCardShareClaimId: claimId,
      memberId: input.memberId,
    },
  });

  if (claimed.count !== 1) {
    return {
      action: "skip",
      reason: "claim_active",
    };
  }

  return {
    action: "share",
    claimId,
  };
}

export async function recordHostedLinqContactCardShareResult(input: {
  chatId: string;
  claimId: string;
  memberId?: string | null;
  now?: Date;
  prisma: HostedLinqContactCardSharePersistenceClient;
  status: HostedRuntimeLinqContactCardShareResultRequest["status"];
}): Promise<HostedRuntimeLinqContactCardShareResultResponse> {
  const chatLookup = resolveHostedLinqContactCardShareLookup(input.chatId);
  if (!chatLookup) {
    return { ok: true };
  }

  if (input.status === "succeeded") {
    const now = input.now ?? new Date();
    await input.prisma.hostedLinqContactCardShare.updateMany({
      where: {
        contactCardShareClaimId: input.claimId,
        ...(input.memberId ? { memberId: input.memberId } : {}),
        linqChatLookupKey: {
          in: [...chatLookup.readCandidates],
        },
      },
      data: {
        contactCardShareClaimedAt: null,
        contactCardShareClaimId: null,
        lastContactCardShareSucceededAt: now,
      },
    });
    return { ok: true };
  }

  await input.prisma.hostedLinqContactCardShare.updateMany({
    where: {
      contactCardShareClaimId: input.claimId,
      ...(input.memberId ? { memberId: input.memberId } : {}),
      linqChatLookupKey: {
        in: [...chatLookup.readCandidates],
      },
    },
    data: {
      contactCardShareClaimedAt: null,
      contactCardShareClaimId: null,
    },
  });
  return { ok: true };
}

export async function maybeShareHostedLinqContactCardAfterOutbound(input: {
  chatId: string;
  eligibility: HostedLinqContactCardShareEligibility;
  memberId: string;
  now?: Date;
  prisma: HostedLinqContactCardSharePersistenceClient;
  shareContactCard?: (input: { chatId: string; signal?: AbortSignal }) => Promise<void>;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCardShareClaimDecision> {
  let claim: HostedLinqContactCardShareClaimDecision;
  try {
    claim = await claimHostedLinqContactCardShareAfterOutbound({
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
      phase: "claim",
    });
    return {
      action: "skip",
      reason: "state_unavailable",
    };
  }

  if (claim.action !== "share") {
    return claim;
  }

  const share = input.shareContactCard ?? shareHostedLinqContactCard;
  try {
    await share({
      chatId: input.chatId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    logHostedLinqContactCardShareFailure({
      chatId: input.chatId,
      error,
      phase: "provider",
    });
    await releaseHostedLinqContactCardShareClaimBestEffort({
      chatId: input.chatId,
      claimId: claim.claimId,
      memberId: input.memberId,
      prisma: input.prisma,
    });
    return claim;
  }

  try {
    await recordHostedLinqContactCardShareResult({
      chatId: input.chatId,
      claimId: claim.claimId,
      memberId: input.memberId,
      now: input.now,
      prisma: input.prisma,
      status: "succeeded",
    });
  } catch (error) {
    logHostedLinqContactCardShareFailure({
      chatId: input.chatId,
      error,
      phase: "record_success",
    });
  }

  return claim;
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

async function createHostedLinqContactCardShareClaim(input: {
  chatLookupKey: string;
  memberId: string;
  now: Date;
  prisma: HostedLinqContactCardSharePersistenceClient;
}): Promise<HostedLinqContactCardShareClaimDecision> {
  const claimId = randomUUID();
  try {
    await input.prisma.hostedLinqContactCardShare.create({
      data: {
        contactCardShareClaimedAt: input.now,
        contactCardShareClaimId: claimId,
        linqChatLookupKey: input.chatLookupKey,
        memberId: input.memberId,
      },
    });
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      return {
        action: "skip",
        reason: "claim_active",
      };
    }
    throw error;
  }

  return {
    action: "share",
    claimId,
  };
}

async function releaseHostedLinqContactCardShareClaimBestEffort(input: {
  chatId: string;
  claimId: string;
  memberId?: string | null;
  prisma: HostedLinqContactCardSharePersistenceClient;
}): Promise<void> {
  try {
    await recordHostedLinqContactCardShareResult({
      chatId: input.chatId,
      claimId: input.claimId,
      memberId: input.memberId ?? null,
      prisma: input.prisma,
      status: "failed",
    });
  } catch (error) {
    logHostedLinqContactCardShareFailure({
      chatId: input.chatId,
      error,
      phase: "release_claim",
    });
  }
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
