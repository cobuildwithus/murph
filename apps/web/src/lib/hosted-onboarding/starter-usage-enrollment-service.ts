import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  HostedCryptoDomainRootCandidateRequiredError,
  lockAndReadActiveHostedDomainRootKeyIdTx,
  prepareHostedCryptoDomainRootCandidates,
  prewarmPreparedHostedCryptoDomainRootForWeb,
  type PreparedHostedCryptoDomainRootCandidates,
  unwrapHostedDomainRootForWeb,
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
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import { requireHostedInviteForBillingCheckout } from "./invite-service";
import {
  activateHostedMemberForPositiveSourceTx,
  buildHostedMemberActivationEventId,
} from "./member-activation";
import {
  type HostedMemberActivationRuntimeWakeBestEffortResult,
  signalHostedMemberActivationRuntimeWakeBestEffortResult,
} from "./member-activation-runtime-wake";
import { readActiveHostedFamilySponsorship } from "./member-access";
import {
  sendHostedSignupNotificationEmailForMemberBestEffort,
} from "./signup-notification-email";
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
  allowSignupWelcomeWithoutAssignableLinqLine: boolean;
  instantStartAdmission?: {
    eventId: string;
    inviteCode: string;
  };
  requireActivationRuntimeWake: boolean;
  requireLaunchConsent: boolean;
  source: HostedStarterUsageSource;
  suppressSignupWelcomeEmail: boolean;
  suppressSignupWelcome: boolean;
};

type HostedStarterUsagePostCommitEffects = {
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
  hostedExecutionMailboxItemId: string | null;
  signupNotificationEmailMemberId: string | null;
  welcomeEmailMemberId: string | null;
};

type HostedStarterUsageEnrollmentWithPolicyResult = {
  deferredActivationWake: HostedLinqInstantStartDeferredActivationWake | null;
  result: HostedStarterUsageEnrollmentResult;
};

const HOSTED_STARTER_USAGE_ACTIVATION_CRYPTO_DOMAINS = [
  "control",
  "ingress",
] as const;
const HOSTED_STARTER_USAGE_CRYPTO_PREPARATION_REQUIRED_CODE =
  "HOSTED_STARTER_USAGE_CRYPTO_PREPARATION_REQUIRED";
const HOSTED_STARTER_USAGE_CRYPTO_PREPARATION_ATTEMPTS = 2;

type HostedStarterUsageActivationCryptoDomain =
  typeof HOSTED_STARTER_USAGE_ACTIVATION_CRYPTO_DOMAINS[number];

type PreparedHostedStarterUsageActivationCrypto = {
  preparedCryptoDomainRoots: PreparedHostedCryptoDomainRootCandidates;
  prewarmedRootKeyIds: ReadonlyMap<
    HostedStarterUsageActivationCryptoDomain,
    string
  >;
};

export async function ensureHostedStarterUsageEnrollment(
  input: HostedStarterUsageEnrollmentInput,
): Promise<HostedStarterUsageEnrollmentResult> {
  const suppressSignupWelcome = input.suppressSignupWelcome ?? false;
  const companionOnboarding = input.source === "companion_onboarding";
  const enrollment = await ensureHostedStarterUsageEnrollmentWithPolicy(input, {
    allowSignupWelcomeWithoutAssignableLinqLine: companionOnboarding,
    requireActivationRuntimeWake: companionOnboarding,
    requireLaunchConsent: true,
    source: input.source,
    suppressSignupWelcome,
    suppressSignupWelcomeEmail:
      suppressSignupWelcome || companionOnboarding,
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
    allowSignupWelcomeWithoutAssignableLinqLine: false,
    instantStartAdmission: {
      eventId: input.admissionEventId,
      inviteCode: input.inviteCode,
    },
    requireActivationRuntimeWake: false,
    requireLaunchConsent: false,
    source: "linq_instant_start",
    suppressSignupWelcomeEmail: true,
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

export async function retryPendingHostedStarterUsageActivationRuntimeWake(
  input: {
    memberId: string;
    prisma?: PrismaClient;
  },
): Promise<HostedMemberActivationRuntimeWakeBestEffortResult | null> {
  const prisma = input.prisma ?? getPrisma();
  const hostedExecutionEventId = buildHostedMemberActivationEventId({
    memberId: input.memberId,
    sourceEventId: buildHostedStarterUsageSemanticSourceKey(input.memberId),
    sourceType: "hosted.starter_usage.enrolled",
  });
  const activation = await prisma.hostedMailboxItem.findUnique({
    select: {
      consumedAt: true,
      id: true,
    },
    where: {
      userId_dedupeKey: {
        dedupeKey: hostedExecutionEventId,
        userId: input.memberId,
      },
    },
  });
  if (!activation || activation.consumedAt) {
    return null;
  }

  return signalHostedMemberActivationRuntimeWakeBestEffortResult({
    hostedExecutionEventId,
    mailboxItemId: activation.id,
    memberId: input.memberId,
    prisma,
    source: "starter-usage.activation.retry",
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

  const semanticSourceKey = buildHostedStarterUsageSemanticSourceKey(
    invite.member.id,
  );
  const commitPreparedEnrollment = (
    preparedActivationCrypto: PreparedHostedStarterUsageActivationCrypto,
  ) => prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
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
        await revalidateHostedStarterUsageActivationCryptoTx({
          prepared: preparedActivationCrypto,
          tx,
          userId: invite.member.id,
        });
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
            allowSignupWelcomeWithoutAssignableLinqLine:
              policy.allowSignupWelcomeWithoutAssignableLinqLine,
            dispatchContext: {
              eventCreatedAt: existingGrant?.effectiveAt ?? now,
              occurredAt: (existingGrant?.effectiveAt ?? now).toISOString(),
              sourceEventId: semanticSourceKey,
              sourceType: "hosted.starter_usage.enrolled",
            },
            memberId: invite.member.id,
            preparedCryptoDomainRoots:
              preparedActivationCrypto.preparedCryptoDomainRoots,
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
      const shouldWakeActivationRuntime = Boolean(
        activation
        && (
          activation.activated
          || (
            policy.requireActivationRuntimeWake
            && activation.hostedExecutionMailboxItemId
          )
        ),
      );
      return {
        effects: {
          activatedMemberId: shouldWakeActivationRuntime
            ? invite.member.id
            : null,
          hostedExecutionEventId: shouldWakeActivationRuntime
            ? activation?.hostedExecutionEventId ?? null
            : null,
          hostedExecutionMailboxItemId: shouldWakeActivationRuntime
            ? activation?.hostedExecutionMailboxItemId ?? null
            : null,
          signupNotificationEmailMemberId:
            activation?.activated ? invite.member.id : null,
          welcomeEmailMemberId:
            activation?.activated && !policy.suppressSignupWelcomeEmail
              ? invite.member.id
              : null,
        } satisfies HostedStarterUsagePostCommitEffects,
        result: buildHostedStarterUsageEnrollmentResult(status),
      };
    },
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );

  const outcome = await (async () => {
    for (
      let attempt = 0;
      attempt < HOSTED_STARTER_USAGE_CRYPTO_PREPARATION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await runWithHostedDomainRootUnwrapCache(async () => {
          const preparedActivationCrypto =
            await prepareHostedStarterUsageActivationCrypto({
              prisma,
              userId: invite.member.id,
            });
          return commitPreparedEnrollment(preparedActivationCrypto);
        });
      } catch (error) {
        const preparationError =
          normalizeHostedStarterUsageCryptoPreparationError(error);
        if (!preparationError) {
          throw error;
        }
        if (
          attempt + 1
          < HOSTED_STARTER_USAGE_CRYPTO_PREPARATION_ATTEMPTS
        ) {
          continue;
        }
        throw preparationError;
      }
    }

    throw new Error(
      "Hosted Starter usage crypto preparation retry exhausted unexpectedly.",
    );
  })();

  const deferredActivationWake = policy.instantStartAdmission
    ? buildHostedLinqInstantStartDeferredActivationWake(outcome.effects)
    : null;
  const postCommit = await runHostedStarterUsagePostCommitEffects({
    ...outcome.effects,
    ...(deferredActivationWake
      ? {
          activatedMemberId: null,
          hostedExecutionEventId: null,
        }
      : {}),
    prisma,
  });
  if (
    policy.requireActivationRuntimeWake
    && postCommit.activationRuntimeWake
    && !postCommit.activationRuntimeWake.accepted
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_STARTER_USAGE_RUNTIME_WAKE_REQUIRED",
      httpStatus: 503,
      message: "Hosted Starter usage activation is waiting for runtime recovery.",
      retryable: true,
    });
  }

  return {
    deferredActivationWake,
    result: outcome.result,
  };
}

async function prepareHostedStarterUsageActivationCrypto(input: {
  prisma: PrismaClient;
  userId: string;
}): Promise<PreparedHostedStarterUsageActivationCrypto> {
  const preparedCryptoDomainRoots =
    await prepareHostedCryptoDomainRootCandidates({
      prisma: input.prisma,
      userId: input.userId,
    });
  let firstPrewarmError: unknown;
  let hasPrewarmError = false;
  const settled = await Promise.allSettled(
    HOSTED_STARTER_USAGE_ACTIVATION_CRYPTO_DOMAINS.map(async (domain) => {
      try {
        const candidate = preparedCryptoDomainRoots.get(domain);
        if (candidate) {
          await prewarmPreparedHostedCryptoDomainRootForWeb({
            domain,
            prepared: preparedCryptoDomainRoots,
            userId: input.userId,
          });
          return [domain, candidate.rootKeyId] as const;
        }

        const root = await unwrapHostedDomainRootForWeb({
          domain,
          prisma: input.prisma,
          retainFailureInScopedCache: true,
          userId: input.userId,
        });
        try {
          return [domain, root.envelope.rootKeyId] as const;
        } finally {
          root.rootKey.fill(0);
        }
      } catch (error) {
        if (!hasPrewarmError) {
          firstPrewarmError = error;
          hasPrewarmError = true;
        }
        throw error;
      }
    }),
  );
  if (hasPrewarmError) {
    throw firstPrewarmError;
  }
  const prewarmedRootKeyIds = new Map<
    HostedStarterUsageActivationCryptoDomain,
    string
  >();
  for (const outcome of settled) {
    // Rejections are handled above after every sibling has settled.
    if (outcome.status === "rejected") {
      continue;
    }
    const [domain, rootKeyId] = outcome.value;
    prewarmedRootKeyIds.set(domain, rootKeyId);
  }

  return {
    preparedCryptoDomainRoots,
    prewarmedRootKeyIds,
  };
}

/**
 * These authority locks remain held through activation. An existing root must
 * retain the exact identity prewarmed before BEGIN; a candidate root must stay
 * absent so activation can insert that exact envelope without a provider path.
 */
async function revalidateHostedStarterUsageActivationCryptoTx(input: {
  prepared: PreparedHostedStarterUsageActivationCrypto;
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  for (const domain of HOSTED_STARTER_USAGE_ACTIVATION_CRYPTO_DOMAINS) {
    const expectedRootKeyId = input.prepared.prewarmedRootKeyIds.get(domain);
    if (!expectedRootKeyId) {
      throw new TypeError(
        `Hosted Starter usage activation is missing prepared ${domain} root identity.`,
      );
    }

    const activeRootKeyId = await lockAndReadActiveHostedDomainRootKeyIdTx({
      domain,
      tx: input.tx,
      userId: input.userId,
    });
    const expectedCandidate =
      input.prepared.preparedCryptoDomainRoots.has(domain);
    const matches = expectedCandidate
      ? activeRootKeyId === null
      : activeRootKeyId === expectedRootKeyId;
    if (!matches) {
      throw hostedStarterUsageCryptoPreparationRequired({
        domain,
        reason: expectedCandidate
          ? "candidate-lost-race"
          : "active-root-changed",
      });
    }
  }
}

function normalizeHostedStarterUsageCryptoPreparationError(
  error: unknown,
): ReturnType<typeof hostedOnboardingError> | null {
  if (
    isHostedOnboardingError(error)
    && error.code === HOSTED_STARTER_USAGE_CRYPTO_PREPARATION_REQUIRED_CODE
  ) {
    return error;
  }
  if (error instanceof HostedCryptoDomainRootCandidateRequiredError) {
    return hostedStarterUsageCryptoPreparationRequired({
      domain: error.domain,
      reason: "candidate-required",
    });
  }
  return null;
}

function hostedStarterUsageCryptoPreparationRequired(input: {
  domain: string;
  reason:
    | "active-root-changed"
    | "candidate-lost-race"
    | "candidate-required";
}) {
  return hostedOnboardingError({
    code: HOSTED_STARTER_USAGE_CRYPTO_PREPARATION_REQUIRED_CODE,
    details: input,
    httpStatus: 503,
    message: "Hosted Starter usage crypto preparation is stale.",
    retryable: true,
  });
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
): Promise<{
  activationRuntimeWake: HostedMemberActivationRuntimeWakeBestEffortResult | null;
}> {
  let activationRuntimeWake: HostedMemberActivationRuntimeWakeBestEffortResult | null = null;
  if (input.activatedMemberId && input.hostedExecutionEventId) {
    activationRuntimeWake =
      await signalHostedMemberActivationRuntimeWakeBestEffortResult({
        hostedExecutionEventId: input.hostedExecutionEventId,
        mailboxItemId: input.hostedExecutionMailboxItemId,
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
  if (input.signupNotificationEmailMemberId) {
    await sendHostedSignupNotificationEmailForMemberBestEffort({
      memberId: input.signupNotificationEmailMemberId,
      prisma: input.prisma,
    });
  }
  return { activationRuntimeWake };
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
