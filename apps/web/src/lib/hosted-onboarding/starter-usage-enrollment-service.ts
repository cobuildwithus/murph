import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  prepareHostedCryptoDomainRootCandidates,
} from "../hosted-crypto/domain-root-store";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import {
  lockHostedUsageCreditBeneficiaryTx,
} from "../hosted-execution/usage-credit-ledger";
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { getPrisma } from "../prisma";
import { HOSTED_APP_HOME_PATH } from "./app-routes";
import { assertHostedMemberBillingStartMessagingReady } from "./billing-start-preconditions";
import {
  hasHostedPaidBillingRefEvidence,
  isHostedMemberSuspended,
} from "./entitlement";
import { hostedOnboardingError } from "./errors";
import { requireHostedInviteForBillingCheckout } from "./invite-service";
import {
  activateHostedMemberForPositiveSourceTx,
} from "./member-activation";
import {
  signalHostedMemberActivationRuntimeWakeBestEffortResult,
} from "./member-activation-runtime-wake";
import { readActiveHostedFamilySponsorship } from "./member-access";
import {
  sendHostedSignupWelcomeEmailForMemberBestEffort,
} from "./signup-welcome-email";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "./shared";
import {
  buildHostedStarterUsageSemanticSourceKey,
  type HostedStarterUsageSource,
} from "./starter-usage";
import {
  ensureHostedStarterUsageGrantTx,
  readHostedStarterUsageGrantTx,
} from "./starter-usage-grant";

export type HostedStarterUsageEnrollmentStatus =
  | "already_active"
  | "already_enrolled"
  | "enrolled";

export interface HostedStarterUsageEnrollmentInput {
  inviteCode: string;
  member: HostedStarterUsageAuthenticatedMember;
  now?: Date;
  prisma?: PrismaClient;
  source: Extract<
    HostedStarterUsageSource,
    "web_onboarding" | "companion_onboarding"
  >;
  suppressSignupWelcome?: boolean;
}

export interface HostedLinqInstantStartStarterUsageEnrollmentInput {
  admissionEventId: string;
  inviteCode: string;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}

export interface HostedStarterUsageAuthenticatedMember {
  id: string;
  suspendedAt: Date | null;
}

export interface HostedStarterUsageEnrollmentResult {
  redirectPath: string;
  status: HostedStarterUsageEnrollmentStatus;
}

export interface HostedLinqInstantStartDeferredActivationWake {
  hostedExecutionEventId: string;
  memberId: string;
}

export interface HostedLinqInstantStartStarterUsageEnrollmentResult
  extends HostedStarterUsageEnrollmentResult {
  deferredActivationWake: HostedLinqInstantStartDeferredActivationWake | null;
}

type HostedStarterUsageEnrollmentPolicy = {
  instantStartAdmission?: {
    eventId: string;
    inviteCode: string;
  };
  requireLaunchConsent: boolean;
  source: HostedStarterUsageSource;
  suppressSignupWelcome: boolean;
};

type HostedStarterUsagePostCommitEffects = {
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
  welcomeEmailMemberId: string | null;
};

type HostedStarterUsageEnrollmentWithPolicyResult = {
  deferredActivationWake: HostedLinqInstantStartDeferredActivationWake | null;
  result: HostedStarterUsageEnrollmentResult;
};

export async function ensureHostedStarterUsageEnrollment(
  input: HostedStarterUsageEnrollmentInput,
): Promise<HostedStarterUsageEnrollmentResult> {
  const enrollment = await ensureHostedStarterUsageEnrollmentWithPolicy(input, {
    requireLaunchConsent: true,
    source: input.source,
    suppressSignupWelcome: input.suppressSignupWelcome ?? false,
  });
  return enrollment.result;
}

/**
 * Trusted inbound iMessage already proves a reachable direct channel. Grant
 * starter capacity and activate the canonical member without creating Stripe
 * state. The original inbound becomes the welcome turn, so runtime signaling
 * is returned to the webhook as an explicit continuation.
 */
export async function ensureHostedLinqInstantStartStarterUsageEnrollment(
  input: HostedLinqInstantStartStarterUsageEnrollmentInput,
): Promise<HostedLinqInstantStartStarterUsageEnrollmentResult> {
  const enrollment = await ensureHostedStarterUsageEnrollmentWithPolicy({
    inviteCode: input.inviteCode,
    member: {
      id: input.memberId,
      suspendedAt: null,
    },
    ...(input.now ? { now: input.now } : {}),
    ...(input.prisma ? { prisma: input.prisma } : {}),
  }, {
    instantStartAdmission: {
      eventId: input.admissionEventId,
      inviteCode: input.inviteCode,
    },
    requireLaunchConsent: false,
    source: "linq_instant_start",
    suppressSignupWelcome: true,
  });
  return {
    ...enrollment.result,
    deferredActivationWake: enrollment.deferredActivationWake,
  };
}

export async function runHostedLinqInstantStartDeferredActivationWakeBestEffort(
  input: {
    continuation: HostedLinqInstantStartDeferredActivationWake;
    prisma?: PrismaClient;
  },
): Promise<void> {
  await signalHostedMemberActivationRuntimeWakeBestEffortResult({
    hostedExecutionEventId: input.continuation.hostedExecutionEventId,
    memberId: input.continuation.memberId,
    ...(input.prisma ? { prisma: input.prisma } : {}),
    source: "starter-usage.activation",
  });
}

async function ensureHostedStarterUsageEnrollmentWithPolicy(
  input: Pick<
    HostedStarterUsageEnrollmentInput,
    "inviteCode" | "member" | "now" | "prisma"
  >,
  policy: HostedStarterUsageEnrollmentPolicy,
): Promise<HostedStarterUsageEnrollmentWithPolicyResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const invite = await requireHostedInviteForBillingCheckout(
    input.inviteCode,
    prisma,
    now,
  );

  if (invite.member.id !== input.member.id) {
    throw hostedOnboardingError({
      code: "AUTH_INVITE_MISMATCH",
      message: "That invite belongs to a different hosted member.",
      httpStatus: 403,
    });
  }
  if (
    isHostedMemberSuspended(input.member.suspendedAt)
    || isHostedMemberSuspended(invite.member.suspendedAt)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  if (policy.requireLaunchConsent) {
    await assertHostedLaunchRequiredConsentGranted({
      memberId: invite.member.id,
      prisma,
    });
  }
  if (!policy.instantStartAdmission) {
    await assertHostedMemberBillingStartMessagingReady({
      identity: invite.member.identity,
      prisma,
      routing: invite.member.routing,
    });
  }

  const preparedCryptoDomainRoots =
    await prepareHostedCryptoDomainRootCandidates({
      prisma,
      userId: invite.member.id,
    });
  const semanticSourceKey = buildHostedStarterUsageSemanticSourceKey(
    invite.member.id,
  );

  const outcome = await prisma.$transaction(
    (tx: Prisma.TransactionClient) => runWithHostedDomainRootUnwrapCache(async () => {
      const lockedBeneficiary = await lockHostedUsageCreditBeneficiaryTx({
        beneficiaryMemberId: invite.member.id,
        tx,
      });
      const member = await tx.hostedMember.findUnique({
        where: { id: invite.member.id },
        select: {
          billingStatus: true,
          billingRef: {
            select: {
              currentBillingPhase: true,
              currentCheckoutOffer: true,
              stripeSubscriptionLookupKey: true,
            },
          },
          id: true,
          suspendedAt: true,
        },
      });
      if (!member || isHostedMemberSuspended(member.suspendedAt)) {
        throw hostedOnboardingError({
          code: "HOSTED_MEMBER_SUSPENDED",
          message: "This hosted account is suspended. Contact support to restore access.",
          httpStatus: 403,
        });
      }

      const existingGrant = await readHostedStarterUsageGrantTx({
        memberId: invite.member.id,
        tx,
      });
      const hasPaidSubscription = hasHostedPaidBillingRefEvidence(
        member.billingRef,
      );
      const hasFamilySponsorship = !existingGrant && !hasPaidSubscription
        && await readActiveHostedFamilySponsorship({
          memberId: invite.member.id,
          prisma: tx,
        });

      if (
        !existingGrant
        && member.billingStatus !== HostedBillingStatus.not_started
        && !hasPaidSubscription
        && !hasFamilySponsorship
      ) {
        throw hostedOnboardingError({
          code: "HOSTED_STARTER_USAGE_ENROLLMENT_BLOCKED",
          message:
            "This hosted account already has billing history. Open Settings to restore or change access.",
          httpStatus: 409,
        });
      }

      const instantStartInviteId = policy.instantStartAdmission
        ? await requireHostedLinqInstantStartAdmissionTx({
            eventId: policy.instantStartAdmission.eventId,
            inviteCode: policy.instantStartAdmission.inviteCode,
            memberId: invite.member.id,
            now,
            tx,
          })
        : null;

      const shouldEnsureStarterGrant =
        !hasPaidSubscription && !hasFamilySponsorship;
      if (shouldEnsureStarterGrant) {
        await ensureHostedStarterUsageGrantTx({
          effectiveAt: now,
          existingGrant,
          lockedBeneficiary,
          memberId: invite.member.id,
          source: policy.source,
          tx,
        });
      }

      const activation = shouldEnsureStarterGrant
        ? await activateHostedMemberForPositiveSourceTx({
            dispatchContext: {
              eventCreatedAt: existingGrant?.effectiveAt ?? now,
              occurredAt: (existingGrant?.effectiveAt ?? now).toISOString(),
              sourceEventId: semanticSourceKey,
              sourceType: "hosted.starter_usage.enrolled",
            },
            memberId: invite.member.id,
            preparedCryptoDomainRoots,
            prisma: tx,
            skipIfPreviouslyActivated: true,
            suppressSignupWelcome: policy.suppressSignupWelcome,
          })
        : null;

      if (instantStartInviteId && policy.instantStartAdmission) {
        await clearHostedLinqInstantStartAdmissionTx({
          eventId: policy.instantStartAdmission.eventId,
          inviteId: instantStartInviteId,
          required: true,
          tx,
        });
      }

      const status: HostedStarterUsageEnrollmentStatus =
        hasPaidSubscription || hasFamilySponsorship
        ? "already_active"
        : existingGrant
          ? "already_enrolled"
          : "enrolled";
      return {
        effects: {
          activatedMemberId: activation?.activated
            ? invite.member.id
            : null,
          hostedExecutionEventId:
            activation?.activated
              ? activation.hostedExecutionEventId
              : null,
          welcomeEmailMemberId:
            activation?.activated && !policy.suppressSignupWelcome
              ? invite.member.id
              : null,
        } satisfies HostedStarterUsagePostCommitEffects,
        result: buildHostedStarterUsageEnrollmentResult(status),
      };
    }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );

  const deferredActivationWake = policy.instantStartAdmission
    ? buildHostedLinqInstantStartDeferredActivationWake(outcome.effects)
    : null;
  await runHostedStarterUsagePostCommitEffects({
    ...outcome.effects,
    ...(deferredActivationWake
      ? {
          activatedMemberId: null,
          hostedExecutionEventId: null,
        }
      : {}),
    prisma,
  });

  return {
    deferredActivationWake,
    result: outcome.result,
  };
}

async function requireHostedLinqInstantStartAdmissionTx(input: {
  eventId: string;
  inviteCode: string;
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<string> {
  const invite = await input.tx.hostedInvite.findUnique({
    select: { id: true },
    where: {
      expiresAt: { gt: input.now },
      instantStartAdmissionEventId: input.eventId,
      inviteCode: input.inviteCode,
      memberId: input.memberId,
      sentAt: null,
    },
  });
  if (invite) {
    return invite.id;
  }

  throw hostedOnboardingError({
    code: "HOSTED_LINQ_INSTANT_START_ADMISSION_REVOKED",
    httpStatus: 409,
    message: "This instant-start admission is no longer active.",
    retryable: false,
  });
}

async function clearHostedLinqInstantStartAdmissionTx(input: {
  eventId: string;
  inviteId: string;
  required: boolean;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const cleared = await input.tx.hostedInvite.updateMany({
    data: { instantStartAdmissionEventId: null },
    where: {
      id: input.inviteId,
      instantStartAdmissionEventId: input.eventId,
    },
  });
  if (input.required && cleared.count !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_INSTANT_START_ADMISSION_REVOKED",
      httpStatus: 409,
      message: "This instant-start admission is no longer active.",
      retryable: false,
    });
  }
}

async function runHostedStarterUsagePostCommitEffects(
  input: HostedStarterUsagePostCommitEffects & { prisma: PrismaClient },
): Promise<void> {
  if (input.activatedMemberId && input.hostedExecutionEventId) {
    await signalHostedMemberActivationRuntimeWakeBestEffortResult({
      hostedExecutionEventId: input.hostedExecutionEventId,
      memberId: input.activatedMemberId,
      prisma: input.prisma,
      source: "starter-usage.activation",
    });
  }
  if (input.welcomeEmailMemberId) {
    await sendHostedSignupWelcomeEmailForMemberBestEffort({
      memberId: input.welcomeEmailMemberId,
      prisma: input.prisma,
    });
  }
}

function buildHostedLinqInstantStartDeferredActivationWake(
  effects: HostedStarterUsagePostCommitEffects,
): HostedLinqInstantStartDeferredActivationWake | null {
  if (!effects.activatedMemberId || !effects.hostedExecutionEventId) {
    return null;
  }
  return {
    hostedExecutionEventId: effects.hostedExecutionEventId,
    memberId: effects.activatedMemberId,
  };
}

function buildHostedStarterUsageEnrollmentResult(
  status: HostedStarterUsageEnrollmentStatus,
): HostedStarterUsageEnrollmentResult {
  return {
    redirectPath: HOSTED_APP_HOME_PATH,
    status,
  };
}
