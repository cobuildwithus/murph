import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  createHostedEmailLookupKeyReadCandidates,
  normalizeHostedEmailAddress,
} from "./contact-privacy";
import {
  createHostedMemberReplyAliasRoute,
  createHostedMemberReplyAliasRouteFromLookupKey,
} from "./hosted-email-reply-alias";
import {
  lookupHostedMemberByVerifiedEmailAddress,
  readHostedMemberEmailAuthorization,
} from "./hosted-member-store";
import {
  readHostedMemberReplyAliasState,
  resolveHostedMemberReplyAliasRegistrationTx,
} from "./hosted-member-routing-store";
import { readActiveHostedMemberAccess } from "./member-access";
import {
  HostedResendPlainTextEmailError,
  readHostedResendPlainTextEmailConfig,
  sendHostedResendPlainTextEmail,
} from "./resend-plain-text-email";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "./shared";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const HOSTED_EMAIL_PUBLIC_BOOTSTRAP_COOLDOWN_MS = 15 * MINUTE_MS;
export const HOSTED_EMAIL_PUBLIC_BOOTSTRAP_FAILED_RETRY_BACKOFF_MS = MINUTE_MS;
export const HOSTED_EMAIL_PUBLIC_BOOTSTRAP_MEMBER_DAILY_LIMIT = 3;
export const HOSTED_EMAIL_PUBLIC_BOOTSTRAP_GLOBAL_HOURLY_LIMIT = 100;
export const HOSTED_EMAIL_PUBLIC_BOOTSTRAP_RETENTION_MS = 2 * DAY_MS;

const HOSTED_EMAIL_PUBLIC_BOOTSTRAP_GLOBAL_LOCK_SCOPE =
  "hosted-email-public-bootstrap-global-v1";
const HOSTED_EMAIL_PUBLIC_BOOTSTRAP_SUBJECT =
  "Start a private conversation with Murph";
const HOSTED_EMAIL_PUBLIC_BOOTSTRAP_TEXT = [
  "We received an email that may have been sent from your address.",
  "",
  "For your privacy, Murph did not read or save the original message. Reply to this email with what you would like help with. Your reply—not the original email—will be the first message Murph processes.",
  "",
  "If this was not you, you can ignore this email.",
].join("\n");

export type HostedEmailPublicBootstrapResult =
  | {
      reason:
        | "authority_changed"
        | "cooldown"
        | "daily_limit"
        | "global_limit"
        | "inactive"
        | "invalid_candidate"
        | "member_not_found"
        | "not_configured"
        | "provider_backoff";
      status: "suppressed";
    }
  | {
      attemptId: string;
      providerMessageId: string | null;
      status: "ambiguous" | "failed" | "sent";
    };

interface ClaimedHostedEmailPublicBootstrapAttempt {
  attemptId: string;
  candidateEmailLookupKey: string;
  memberId: string;
  status: "claimed";
}

type HostedEmailPublicBootstrapSend = typeof sendHostedResendPlainTextEmail;
type HostedEmailPublicBootstrapEnv = Readonly<Record<string, string | undefined>>;

/**
 * Turns one unauthenticated public-address sender hint into a fixed challenge
 * sent only to the current stored verified address. This owner never receives,
 * stores, reflects, or later authorizes the original subject, body, attachments,
 * thread headers, or raw message. Replying through the current signed personal
 * alias is the first private assistant turn.
 */
export async function sendHostedEmailPublicBootstrapChallenge(input: {
  beforeProviderEntry?: () => Promise<void>;
  candidateAddress: string;
  env?: HostedEmailPublicBootstrapEnv;
  fetchImpl?: typeof fetch;
  now?: Date;
  prisma?: PrismaClient;
  sendEmail?: HostedEmailPublicBootstrapSend;
}): Promise<HostedEmailPublicBootstrapResult> {
  const candidateAddress = normalizeHostedEmailAddress(input.candidateAddress);
  if (!candidateAddress) {
    return { reason: "invalid_candidate", status: "suppressed" };
  }

  const source = input.env ?? process.env;
  const resendConfig = readHostedResendPlainTextEmailConfig(source);
  if (!resendConfig) {
    return { reason: "not_configured", status: "suppressed" };
  }

  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const candidate = await lookupHostedMemberByVerifiedEmailAddress({
    address: candidateAddress,
    prisma,
    projection: "core",
  });
  if (!candidate) {
    return { reason: "member_not_found", status: "suppressed" };
  }

  const currentAliasState = await readHostedMemberReplyAliasState({
    memberId: candidate.core.id,
    prisma,
  });
  const memberFallbackAliasGeneration = currentAliasState?.generation ?? 0;
  const memberFallbackAlias = await createHostedMemberReplyAliasRoute({
    generation: memberFallbackAliasGeneration,
    memberId: candidate.core.id,
    source,
  });
  if (!memberFallbackAlias) {
    return { reason: "not_configured", status: "suppressed" };
  }

  const claim = await claimHostedEmailPublicBootstrapAttempt({
    candidateAddress,
    memberId: candidate.core.id,
    now,
    prisma,
  });
  if (claim.status !== "claimed") {
    return claim;
  }

  let providerEntered = false;
  try {
    const currentAuthorization = await readHostedMemberEmailAuthorization({
      memberId: claim.memberId,
      prisma,
    });
    const currentVerifiedEmail = currentAuthorization?.verifiedEmail ?? null;
    if (
      !currentVerifiedEmail
      || currentVerifiedEmail.lookupKey !== claim.candidateEmailLookupKey
      || normalizeHostedEmailAddress(currentVerifiedEmail.address) !== candidateAddress
    ) {
      await abandonHostedEmailPublicBootstrapAttempt({
        attemptId: claim.attemptId,
        now,
        prisma,
      });
      return { reason: "authority_changed", status: "suppressed" };
    }

    await input.beforeProviderEntry?.();

    const providerEntry = await enterHostedEmailPublicBootstrapProvider({
      attemptId: claim.attemptId,
      candidateEmailLookupKey: claim.candidateEmailLookupKey,
      fallbackAliasGeneration: memberFallbackAliasGeneration,
      fallbackAliasLookupKey: memberFallbackAlias.replyAliasLookupKey,
      memberId: claim.memberId,
      now,
      prisma,
    });
    if (!providerEntry) {
      await abandonHostedEmailPublicBootstrapAttempt({
        attemptId: claim.attemptId,
        now,
        prisma,
      });
      return { reason: "authority_changed", status: "suppressed" };
    }
    providerEntered = true;

    const currentAlias = await createHostedMemberReplyAliasRouteFromLookupKey({
      replyAliasLookupKey: providerEntry.replyAliasLookupKey,
      source,
    });
    if (!currentAlias) {
      await completeHostedEmailPublicBootstrapAttempt({
        attemptId: claim.attemptId,
        now,
        prisma,
        status: "abandoned",
      });
      return { reason: "not_configured", status: "suppressed" };
    }

    const idempotencyKey = buildHostedEmailPublicBootstrapIdempotencyKey(
      claim.attemptId,
    );
    try {
      const result = await (input.sendEmail ?? sendHostedResendPlainTextEmail)({
        config: resendConfig,
        fetchImpl: input.fetchImpl,
        idempotencyKey,
        replyTo: currentAlias.address,
        subject: HOSTED_EMAIL_PUBLIC_BOOTSTRAP_SUBJECT,
        text: HOSTED_EMAIL_PUBLIC_BOOTSTRAP_TEXT,
        to: [currentVerifiedEmail.address],
      });
      const status = result.providerMessageId ? "sent" : "ambiguous";
      await completeHostedEmailPublicBootstrapAttempt({
        attemptId: claim.attemptId,
        now,
        prisma,
        providerMessageId: result.providerMessageId,
        status,
      });
      return {
        attemptId: claim.attemptId,
        providerMessageId: result.providerMessageId,
        status,
      };
    } catch (error) {
      const status = error instanceof HostedResendPlainTextEmailError
        ? "failed"
        : "ambiguous";
      await completeHostedEmailPublicBootstrapAttempt({
        attemptId: claim.attemptId,
        now,
        prisma,
        status,
      });
      return {
        attemptId: claim.attemptId,
        providerMessageId: null,
        status,
      };
    }
  } catch (error) {
    if (providerEntered) {
      await completeHostedEmailPublicBootstrapAttempt({
        attemptId: claim.attemptId,
        now,
        prisma,
        status: "ambiguous",
      }).catch(() => undefined);
    } else {
      await abandonHostedEmailPublicBootstrapAttempt({
        attemptId: claim.attemptId,
        now,
        prisma,
      }).catch(() => undefined);
    }
    throw error;
  }
}

async function claimHostedEmailPublicBootstrapAttempt(input: {
  candidateAddress: string;
  memberId: string;
  now: Date;
  prisma: PrismaClient;
}): Promise<
  | ClaimedHostedEmailPublicBootstrapAttempt
  | Extract<HostedEmailPublicBootstrapResult, { status: "suppressed" }>
> {
  const attemptId = generateHostedEmailPublicBootstrapAttemptId();
  return input.prisma.$transaction(async (tx) => {
    // One global advisory lock makes the hourly ceiling exact across members.
    // The member row then serializes cooldown, daily admission, identity
    // rotation, and current access without provider or crypto I/O in the
    // transaction.
    await acquireHostedEmailPublicBootstrapGlobalClaimLockTx(tx);
    await lockHostedMemberRow(tx, input.memberId);

    const authorization = await tx.hostedMemberEmailAuthorization.findUnique({
      where: { memberId: input.memberId },
      select: {
        verifiedEmailLookupKey: true,
        verifiedEmailVerifiedAt: true,
      },
    });
    const candidateLookupKeys = createHostedEmailLookupKeyReadCandidates(
      input.candidateAddress,
    );
    const candidateEmailLookupKey = authorization?.verifiedEmailLookupKey ?? null;
    if (
      !authorization?.verifiedEmailVerifiedAt
      || !candidateEmailLookupKey
      || !candidateLookupKeys.includes(candidateEmailLookupKey)
    ) {
      return { reason: "authority_changed", status: "suppressed" } as const;
    }
    if (!await readActiveHostedMemberAccess({
      memberId: input.memberId,
      now: input.now,
      prisma: tx,
    })) {
      return { reason: "inactive", status: "suppressed" } as const;
    }

    const recentAttempt = await tx.hostedEmailPublicBootstrapAttempt.findFirst({
      where: {
        memberId: input.memberId,
        OR: [
          {
            claimedAt: {
              gte: new Date(
                input.now.getTime() - HOSTED_EMAIL_PUBLIC_BOOTSTRAP_COOLDOWN_MS,
              ),
            },
            status: { in: ["claimed", "sending", "sent", "ambiguous"] },
          },
          {
            claimedAt: {
              gte: new Date(
                input.now.getTime()
                  - HOSTED_EMAIL_PUBLIC_BOOTSTRAP_FAILED_RETRY_BACKOFF_MS,
              ),
            },
            status: "failed",
          },
        ],
      },
      orderBy: [{ claimedAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true },
    });
    if (recentAttempt?.status === "failed") {
      return { reason: "provider_backoff", status: "suppressed" } as const;
    }
    if (recentAttempt) {
      return { reason: "cooldown", status: "suppressed" } as const;
    }

    const memberDailyAttempts = await tx.hostedEmailPublicBootstrapAttempt.findMany({
      where: {
        claimedAt: { gte: new Date(input.now.getTime() - DAY_MS) },
        memberId: input.memberId,
      },
      orderBy: [{ claimedAt: "desc" }, { id: "desc" }],
      select: { id: true },
      take: HOSTED_EMAIL_PUBLIC_BOOTSTRAP_MEMBER_DAILY_LIMIT,
    });
    if (
      memberDailyAttempts.length
      >= HOSTED_EMAIL_PUBLIC_BOOTSTRAP_MEMBER_DAILY_LIMIT
    ) {
      return { reason: "daily_limit", status: "suppressed" } as const;
    }

    const globalHourlyAttempts = await tx.hostedEmailPublicBootstrapAttempt.findMany({
      where: {
        claimedAt: { gte: new Date(input.now.getTime() - HOUR_MS) },
      },
      orderBy: [{ claimedAt: "desc" }, { id: "desc" }],
      select: { id: true },
      take: HOSTED_EMAIL_PUBLIC_BOOTSTRAP_GLOBAL_HOURLY_LIMIT,
    });
    if (
      globalHourlyAttempts.length
      >= HOSTED_EMAIL_PUBLIC_BOOTSTRAP_GLOBAL_HOURLY_LIMIT
    ) {
      return { reason: "global_limit", status: "suppressed" } as const;
    }

    await tx.hostedEmailPublicBootstrapAttempt.create({
      data: {
        candidateEmailLookupKey,
        claimedAt: input.now,
        expiresAt: new Date(
          input.now.getTime() + HOSTED_EMAIL_PUBLIC_BOOTSTRAP_RETENTION_MS,
        ),
        id: attemptId,
        memberId: input.memberId,
        status: "claimed",
      },
    });

    return {
      attemptId,
      candidateEmailLookupKey,
      memberId: input.memberId,
      status: "claimed",
    } satisfies ClaimedHostedEmailPublicBootstrapAttempt;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function enterHostedEmailPublicBootstrapProvider(input: {
  attemptId: string;
  candidateEmailLookupKey: string;
  fallbackAliasGeneration: number;
  fallbackAliasLookupKey: string;
  memberId: string;
  now: Date;
  prisma: PrismaClient;
}): Promise<{ replyAliasLookupKey: string } | null> {
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const attempt = await tx.hostedEmailPublicBootstrapAttempt.findUnique({
      where: { id: input.attemptId },
      select: {
        candidateEmailLookupKey: true,
        memberId: true,
        status: true,
      },
    });
    const authorization = await tx.hostedMemberEmailAuthorization.findUnique({
      where: { memberId: input.memberId },
      select: {
        verifiedEmailLookupKey: true,
        verifiedEmailVerifiedAt: true,
      },
    });
    if (
      !attempt
      || attempt.memberId !== input.memberId
      || attempt.status !== "claimed"
      || attempt.candidateEmailLookupKey !== input.candidateEmailLookupKey
      || !authorization?.verifiedEmailVerifiedAt
      || authorization.verifiedEmailLookupKey !== input.candidateEmailLookupKey
      || !await readActiveHostedMemberAccess({
        memberId: input.memberId,
        now: input.now,
        prisma: tx,
      })
    ) {
      return null;
    }

    const alias = await resolveHostedMemberReplyAliasRegistrationTx({
      candidateLookupKey: null,
      fallbackGeneration: input.fallbackAliasGeneration,
      fallbackLookupKey: input.fallbackAliasLookupKey,
      memberId: input.memberId,
      prisma: tx,
    });
    if (!alias.lookupKey) {
      return null;
    }
    const updated = await tx.hostedEmailPublicBootstrapAttempt.updateMany({
      where: {
        id: input.attemptId,
        memberId: input.memberId,
        status: "claimed",
      },
      data: {
        providerEntryAt: input.now,
        status: "sending",
      },
    });
    return updated.count === 1
      ? { replyAliasLookupKey: alias.lookupKey }
      : null;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function completeHostedEmailPublicBootstrapAttempt(input: {
  attemptId: string;
  now: Date;
  prisma: PrismaClient;
  providerMessageId?: string | null;
  status: "abandoned" | "ambiguous" | "failed" | "sent";
}): Promise<void> {
  await input.prisma.hostedEmailPublicBootstrapAttempt.updateMany({
    where: {
      id: input.attemptId,
      status: "sending",
    },
    data: {
      completedAt: input.now,
      ...(input.providerMessageId
        ? { providerMessageId: input.providerMessageId }
        : {}),
      status: input.status,
    },
  });
}

async function abandonHostedEmailPublicBootstrapAttempt(input: {
  attemptId: string;
  now: Date;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.hostedEmailPublicBootstrapAttempt.updateMany({
    where: {
      id: input.attemptId,
      status: { in: ["claimed", "sending"] },
    },
    data: {
      completedAt: input.now,
      status: "abandoned",
    },
  });
}

async function acquireHostedEmailPublicBootstrapGlobalClaimLockTx(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('hosted-email-public-bootstrap'),
      hashtext(${HOSTED_EMAIL_PUBLIC_BOOTSTRAP_GLOBAL_LOCK_SCOPE})
    )
  `;
}

function buildHostedEmailPublicBootstrapIdempotencyKey(attemptId: string): string {
  return `hosted-email-public-bootstrap/${attemptId}`.slice(0, 256);
}

function generateHostedEmailPublicBootstrapAttemptId(): string {
  return `heba_${randomBytes(18).toString("base64url")}`;
}
