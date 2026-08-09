import {
  type HostedInvite,
  type HostedMember,
  type HostedMemberRouting,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import type {
  HostedInviteEmailAuthTarget,
  HostedInvitePhoneAuthTarget,
  HostedInviteStatusPayload,
} from "./types";

import { getPrisma } from "../prisma";
import { isHostedMemberActivationPending } from "./activation-progress";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
  resolveConfiguredHostedBillingPlanCodes,
  resolveHostedBillingReady,
} from "./billing-plans";
import {
  readHostedPhoneHint,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import {
  projectHostedMemberRoutingState,
  type HostedMemberRoutingStateSnapshot,
} from "./hosted-member-routing-store";
import { type HostedMemberCoreState } from "./hosted-member-store";
import {
  isHostedMemberMessagingSetupRequired,
  resolveHostedMemberMessagingState,
} from "./messaging-state";
import { deriveHostedOnboardingStage } from "./lifecycle";
import { readActiveHostedMemberAccess } from "./member-access";
import {
  projectHostedMemberIdentityState,
  type HostedMemberIdentityState,
  readHostedMemberIdentity,
  writeHostedMemberSignupPhoneState,
} from "./hosted-member-identity-store";
import { ensureHostedMemberForPhoneTx } from "./member-identity-service";
import { hasHostedPrivyPhoneAuthConfig } from "./privy";
import {
  getHostedOnboardingEnvironment,
  requireHostedOnboardingPublicBaseUrl,
} from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  generateHostedInviteCode,
  generateHostedInviteId,
  generateHostedPhoneCodeAttemptId,
  inviteExpiresAt,
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";
import { normalizePhoneNumber } from "./phone";

const HOSTED_INVITE_SEND_CODE_COOLDOWN_MS = 60_000;

type HostedInvitePhoneAuthTargetWithNumber =
  | {
      kind: "saved";
      phoneHint: string;
      phoneNumber: string;
    }
  | {
      kind: "manual";
    };

export async function getHostedInviteStatus(input: {
  authenticatedMember?: HostedMemberCoreState | null;
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedInviteStatusPayload> {
  const prisma = input.prisma ?? getPrisma();
  const environment = getHostedOnboardingEnvironment();
  const now = input.now ?? new Date();
  const invite = await findHostedInviteByCode(input.inviteCode, prisma);
  const configuredBillingPlanCodes = resolveConfiguredHostedBillingPlanCodes({
    stripePriceIdsByPlan: environment.stripePriceIdsByPlan,
  });
  const billingReady = resolveHostedBillingReady({
    stripePriceIdsByPlan: environment.stripePriceIdsByPlan,
    stripeSecretKey: environment.stripeSecretKey,
  });
  const billingPlans = listHostedBillingPlanPresentations({
    configuredPlanCodes: configuredBillingPlanCodes,
  });
  const defaultBillingPlanCode = billingPlans.some(
    (plan) => plan.code === getHostedDefaultBillingPlanCode(),
  )
    ? getHostedDefaultBillingPlanCode()
    : (billingPlans[0]?.code ?? null);
  const phoneAuthReady = hasHostedPrivyPhoneAuthConfig();

  if (!invite) {
    return {
      billing: {
        defaultPlanCode: defaultBillingPlanCode,
        plans: billingPlans,
      },
      capabilities: {
        billingReady,
        phoneAuthReady,
      },
      invite: null,
      messagingSetupRequired: false,
      session: {
        authenticated: Boolean(input.authenticatedMember),
        expiresAt: null,
        matchesInvite: false,
      },
      stage: "invalid",
      telegramStartRequired: false,
    };
  }

  const memberMatchesInvite = input.authenticatedMember?.id === invite.memberId;
  const sessionMatchesInvite = memberMatchesInvite;
  const inviteIdentity = requireHostedInviteMemberIdentity(invite.member);
  const activationPending = sessionMatchesInvite
    ? await isHostedMemberActivationPending({
        billingStatus: invite.member.billingStatus,
        memberId: invite.memberId,
        prisma,
      })
    : false;
  const inviteRouting = invite.member.routing
    ? await projectHostedMemberRoutingState(invite.member.routing, prisma)
    : null;
  const stage = deriveHostedOnboardingStage({
    activationPending,
    billingStatus: invite.member.billingStatus,
    expiresAt: invite.expiresAt,
    now,
    sessionMatchesInvite,
    sponsoredAccessActive: sessionMatchesInvite
      ? await readActiveHostedMemberAccess({
          memberId: invite.memberId,
          prisma,
        })
      : false,
    suspendedAt: invite.member.suspendedAt,
  });
  const messagingInput = {
    identity: {
      ...(invite.member.identity ?? {}),
      emailLinked: Boolean(
        invite.member.emailAuthorization?.verifiedEmailVerifiedAt,
      ),
    },
    routing: inviteRouting,
  };
  const messagingSetupRequired = isHostedMemberMessagingSetupRequired(messagingInput);
  const telegramStartRequired =
    resolveHostedMemberMessagingState(messagingInput).telegramAwaitingInbound;
  const phoneAuthTarget = resolveHostedInvitePhoneAuthTarget(
    await projectHostedMemberIdentityState(inviteIdentity, prisma),
  );
  const verificationMode =
    inviteRouting?.pendingLinqParticipantContact?.kind === "email"
      ? "invite_email"
      : resolveHostedInviteVerificationMode(phoneAuthTarget);
  const emailAuthTarget = resolveHostedInviteEmailAuthTarget({
    pendingLinqParticipantContact: inviteRouting?.pendingLinqParticipantContact ?? null,
    verificationMode,
  });
  const statusPhoneAuthTarget =
    verificationMode === "invite_email"
      ? ({ kind: "manual" } as const)
      : toHostedInviteStatusPhoneAuthTarget(phoneAuthTarget);

  return {
    billing: {
      defaultPlanCode: defaultBillingPlanCode,
      plans: billingPlans,
    },
    capabilities: {
      billingReady,
      phoneAuthReady,
    },
    invite: {
      code: invite.inviteCode,
      ...(emailAuthTarget ? { emailAuthTarget } : {}),
      expiresAt: invite.expiresAt.toISOString(),
      phoneAuthTarget: statusPhoneAuthTarget,
      phoneHint:
        verificationMode === "invite_phone" && phoneAuthTarget.kind === "saved"
          ? phoneAuthTarget.phoneHint
          : null,
      verificationMode,
    },
    messagingSetupRequired,
    murphPhoneNumber: resolveHostedInviteMurphPhoneNumber({
      routing: inviteRouting,
      sessionMatchesInvite,
      stage,
    }),
    session: {
      authenticated: Boolean(input.authenticatedMember),
      expiresAt: null,
      matchesInvite: Boolean(sessionMatchesInvite),
    },
    stage,
    telegramStartRequired,
  };
}

export async function buildHostedInvitePageData(input: {
  authenticatedMember?: HostedMemberCoreState | null;
  inviteCode: string;
  prisma?: PrismaClient;
}) {
  return getHostedInviteStatus(input);
}

export async function issueHostedInviteForPhone(input: {
  channel?: "share" | "web";
  phoneNumber: string;
  prisma?: PrismaClient;
}): Promise<{ invite: HostedInvite; inviteUrl: string; member: HostedMemberCoreState }> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction(async (tx) => {
    const member = await ensureHostedMemberForPhoneTx({
      phoneNumber: input.phoneNumber,
      prisma: tx,
    });
    const invite = await issueHostedInviteTx({
      channel: input.channel ?? "share",
      memberId: member.id,
      prisma: tx,
    });

    return {
      invite,
      inviteUrl: buildHostedInviteUrl(invite.inviteCode),
      member,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function issueHostedInvite(input: {
  channel: "linq" | "share" | "web";
  memberId: string;
  prisma?: PrismaClient;
}): Promise<HostedInvite> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => issueHostedInviteTx({
    channel: input.channel,
    memberId: input.memberId,
    prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function issueHostedInviteTx(input: {
  channel: "linq" | "share" | "web";
  instantStartAdmissionEventId?: string | null;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedInvite> {
  const now = new Date();

  await lockHostedMemberRow(input.prisma, input.memberId);

  const existingInvite = await input.prisma.hostedInvite.findFirst({
    where: {
      memberId: input.memberId,
      expiresAt: {
        gt: now,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (existingInvite) {
    return input.prisma.hostedInvite.update({
      where: {
        id: existingInvite.id,
      },
      data: {
        channel: input.channel,
        instantStartAdmissionEventId:
          input.instantStartAdmissionEventId ?? null,
      },
    });
  }

  return input.prisma.hostedInvite.create({
    data: {
      id: generateHostedInviteId(),
      memberId: input.memberId,
      inviteCode: generateHostedInviteCode(),
      channel: input.channel,
      instantStartAdmissionEventId:
        input.instantStartAdmissionEventId ?? null,
      expiresAt: inviteExpiresAt(now, getHostedOnboardingEnvironment().inviteTtlHours),
    },
  });
}

export function buildHostedInviteUrl(inviteCode: string): string {
  return `${requireHostedOnboardingPublicBaseUrl()}/join/${encodeURIComponent(inviteCode)}`;
}

export async function requireHostedInviteForAuthentication(
  inviteCode: string,
  prisma: PrismaClient | Prisma.TransactionClient,
  now: Date,
) {
  const invite = await findHostedInviteByCode(inviteCode, prisma);

  if (!invite) {
    throw hostedOnboardingError({
      code: "INVITE_NOT_FOUND",
      message: "That Murph invite link is no longer valid.",
      httpStatus: 404,
    });
  }

  if (invite.expiresAt <= now) {
    throw hostedOnboardingError({
      code: "INVITE_EXPIRED",
      message: "That Murph invite link has expired. Text the number again for a fresh link.",
      httpStatus: 410,
    });
  }

  return invite;
}

export interface HostedInviteBillingCheckoutSnapshot {
  expiresAt: Date;
  inviteCode: string;
  member: {
    billingStatus: HostedMember["billingStatus"];
    id: string;
    billingRef: {
      currentBillingPhase: string | null;
      currentCheckoutOffer: string | null;
      stripeSubscriptionLookupKey: string | null;
    } | null;
    identity: {
      memberId: string;
      phoneLookupKey: string | null;
    } | null;
    routing: HostedMemberRouting | null;
    suspendedAt: Date | null;
  };
  memberId: string;
}

export async function requireHostedInviteForBillingCheckout(
  inviteCode: string,
  prisma: PrismaClient | Prisma.TransactionClient,
  now: Date,
): Promise<HostedInviteBillingCheckoutSnapshot> {
  const invite = await prisma.hostedInvite.findUnique({
    where: {
      inviteCode,
    },
    select: {
      expiresAt: true,
      inviteCode: true,
      memberId: true,
      member: {
        select: {
          billingRef: {
            select: {
              currentBillingPhase: true,
              currentCheckoutOffer: true,
              stripeSubscriptionLookupKey: true,
            },
          },
          billingStatus: true,
          id: true,
          identity: {
            select: {
              memberId: true,
              phoneLookupKey: true,
            },
          },
          routing: true,
          suspendedAt: true,
        },
      },
    },
  });

  if (!invite) {
    throw hostedOnboardingError({
      code: "INVITE_NOT_FOUND",
      message: "That Murph invite link is no longer valid.",
      httpStatus: 404,
    });
  }

  if (invite.expiresAt <= now) {
    throw hostedOnboardingError({
      code: "INVITE_EXPIRED",
      message: "That Murph invite link has expired. Text the number again for a fresh link.",
      httpStatus: 410,
    });
  }

  return invite;
}

export async function prepareHostedInvitePhoneCode(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<{ phoneHint: string; phoneNumber: string; sendAttemptId: string }> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction(async (tx) => {
    const invite = await requireHostedInviteForAuthentication(input.inviteCode, tx, now);
    await lockHostedMemberRow(tx, invite.memberId);

    const identity = await readHostedInviteIdentityStateOrThrow(invite.memberId, tx);
    const phoneAuthTarget = resolveHostedInvitePhoneAuthTarget(identity);

    if (phoneAuthTarget.kind === "manual") {
      throw hostedOnboardingError({
        code: "SIGNUP_PHONE_UNAVAILABLE",
        message: "Enter the number that messaged Murph to continue.",
        httpStatus: 409,
      });
    }

    const retryAfterMs = readPhoneCodeRetryAfterMs({
      lastAttemptAt: maxDate(
        identity.signupPhoneCodeSentAt,
        identity.signupPhoneCodeSendAttemptStartedAt,
      ),
      now,
    });

    if (retryAfterMs > 0) {
      throw hostedOnboardingError({
        code: "PHONE_CODE_COOLDOWN",
        message: "Wait a moment before requesting another code.",
        httpStatus: 429,
        retryable: true,
        details: {
          retryAfterMs,
        },
      });
    }

    const sendAttemptId = generateHostedPhoneCodeAttemptId();
    await writeHostedMemberSignupPhoneState({
      memberId: invite.memberId,
      prisma: tx,
      signupPhoneCodeSendAttemptId: sendAttemptId,
      signupPhoneCodeSendAttemptStartedAt: now,
    });

    return {
      phoneHint: phoneAuthTarget.phoneHint,
      phoneNumber: phoneAuthTarget.phoneNumber,
      sendAttemptId,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function confirmHostedInvitePhoneCode(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
  sendAttemptId: string;
}): Promise<{ ok: true }> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction(async (tx) => {
    const invite = await requireHostedInviteForAuthentication(input.inviteCode, tx, now);
    await lockHostedMemberRow(tx, invite.memberId);

    const identity = await readHostedInviteIdentityStateOrThrow(invite.memberId, tx);
    if (identity.signupPhoneCodeSendAttemptId !== input.sendAttemptId) {
      throw hostedOnboardingError({
        code: "PHONE_CODE_ATTEMPT_INVALID",
        message: "Request a fresh verification code to continue.",
        httpStatus: 409,
        retryable: true,
      });
    }

    await writeHostedMemberSignupPhoneState({
      memberId: invite.memberId,
      prisma: tx,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: now,
    });

    return {
      ok: true,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function abortHostedInvitePhoneCode(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
  sendAttemptId: string;
}): Promise<{ ok: true }> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction(async (tx) => {
    const invite = await requireHostedInviteForAuthentication(input.inviteCode, tx, now);
    await lockHostedMemberRow(tx, invite.memberId);

    const identity = await readHostedInviteIdentityStateOrThrow(invite.memberId, tx);
    if (identity.signupPhoneCodeSendAttemptId === input.sendAttemptId) {
      await writeHostedMemberSignupPhoneState({
        memberId: invite.memberId,
        prisma: tx,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: now,
      });
    }

    return {
      ok: true,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export function requireHostedInviteMemberIdentity(
  member: Prisma.HostedInviteGetPayload<{
    include: {
      member: {
        include: {
          identity: true;
        };
      };
    };
  }>["member"],
) {
  if (member.identity) {
    return member.identity;
  }

  throw hostedOnboardingError({
    code: "HOSTED_MEMBER_IDENTITY_MISSING",
    message: "Hosted invite identity state is missing.",
    httpStatus: 500,
  });
}

function resolveHostedInvitePhoneAuthTarget(
  identity: HostedMemberIdentityState,
): HostedInvitePhoneAuthTargetWithNumber {
  const phoneNumber = identity.phoneNumber ?? identity.signupPhoneNumber;

  if (!phoneNumber) {
    return {
      kind: "manual",
    };
  }

  const maskedPhoneHint = readHostedPhoneHint(identity.maskedPhoneNumberHint);

  if (maskedPhoneHint !== "your number") {
    return {
      kind: "saved",
      phoneHint: maskedPhoneHint,
      phoneNumber,
    };
  }

  const derivedPhoneHint = readHostedPhoneHint(phoneNumber);

  if (derivedPhoneHint === "your number") {
    return {
      kind: "manual",
    };
  }

  return {
    kind: "saved",
    phoneHint: derivedPhoneHint,
    phoneNumber,
  };
}

function toHostedInviteStatusPhoneAuthTarget(
  target: HostedInvitePhoneAuthTargetWithNumber,
): HostedInvitePhoneAuthTarget {
  return target.kind === "saved"
    ? {
        kind: "saved",
        phoneHint: target.phoneHint,
      }
    : {
        kind: "manual",
      };
}

function resolveHostedInviteEmailAuthTarget(input: {
  pendingLinqParticipantContact: HostedMemberRoutingStateSnapshot["pendingLinqParticipantContact"];
  verificationMode: NonNullable<HostedInviteStatusPayload["invite"]>["verificationMode"];
}): HostedInviteEmailAuthTarget | null {
  if (
    input.verificationMode !== "invite_email"
    || input.pendingLinqParticipantContact?.kind !== "email"
  ) {
    return null;
  }

  return {
    emailAddress: input.pendingLinqParticipantContact.value,
    kind: "saved",
  };
}

function resolveHostedInviteVerificationMode(
  target: HostedInvitePhoneAuthTargetWithNumber,
): NonNullable<HostedInviteStatusPayload["invite"]>["verificationMode"] {
  return target.kind === "saved" ? "invite_phone" : "manual_phone";
}

function resolveHostedInviteMurphPhoneNumber(input: {
  routing: Awaited<ReturnType<typeof projectHostedMemberRoutingState>> | null;
  sessionMatchesInvite: boolean | undefined;
  stage: HostedInviteStatusPayload["stage"];
}): string | null {
  if (!input.sessionMatchesInvite || input.stage !== "active") {
    return null;
  }

  return normalizePhoneNumber(
    input.routing?.linqRecipientPhone
    ?? input.routing?.pendingLinqRecipientPhone
    ?? null,
  );
}

async function findHostedInviteByCode(
  inviteCode: string,
  prisma: HostedOnboardingReadClient,
) {
  return prisma.hostedInvite.findUnique({
    where: {
      inviteCode,
    },
    include: {
      member: {
        include: {
          emailAuthorization: {
            select: {
              verifiedEmailVerifiedAt: true,
            },
          },
          identity: true,
          routing: true,
        },
      },
    },
  });
}

async function readHostedInviteIdentityStateOrThrow(
  memberId: string,
  prisma: HostedOnboardingReadClient,
) {
  const identity = await readHostedMemberIdentity({
    memberId,
    prisma,
  });

  if (!identity) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_IDENTITY_MISSING",
      message: "Hosted invite identity state is missing.",
      httpStatus: 500,
    });
  }

  return identity;
}

function readPhoneCodeRetryAfterMs(input: {
  lastAttemptAt: Date | null;
  now: Date;
}): number {
  if (!input.lastAttemptAt) {
    return 0;
  }

  return Math.max(
    0,
    input.lastAttemptAt.getTime() + HOSTED_INVITE_SEND_CODE_COOLDOWN_MS - input.now.getTime(),
  );
}

function maxDate(first: Date | null, second: Date | null): Date | null {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  return first.getTime() >= second.getTime() ? first : second;
}
