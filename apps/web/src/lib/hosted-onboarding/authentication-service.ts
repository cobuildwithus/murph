import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  signalHostedPhoneCallResultNotificationRecovery,
} from "../phone-calls/reconciliation-workflow-start";
import {
  runWithFreshHostedDomainRootUnwrapCache,
  runWithHostedDomainRootUnwrapCache,
  runWithHostedDomainRootProviderCallsDisabled,
} from "../hosted-crypto/domain-root-unwrap-cache";
import {
  HostedDomainRootPreparationMismatchError,
  prepareHostedDomainRootForWeb,
  type PreparedHostedDomainRootForWeb,
} from "../hosted-crypto/domain-root-store";
import { readHostedPhoneHint } from "./contact-privacy";
import { assertHostedMemberNotSuspended } from "./entitlement";
import { deriveHostedPostVerificationStage } from "./lifecycle";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import { isHostedMemberActivationPending } from "./activation-progress";
import {
  readHostedMemberMessagingSetupState,
  readHostedMemberEmailAuthorization,
  type HostedMemberCoreState,
  syncHostedMemberVerifiedEmailAuthorization,
  updateHostedMemberPendingActivationTimeZoneIfActivationPending,
} from "./hosted-member-store";
import { createHostedMemberReplyAliasRoute } from "./hosted-email-reply-alias";
import {
  projectHostedMemberRoutingState,
  readHostedMemberRoutingState,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "./hosted-member-routing-store";
import {
  isHostedMemberMessagingSetupRequired,
} from "./messaging-state";
import {
  readHostedPrivyUserById,
  resolveHostedPrivyIdentityFromVerifiedUser,
  type HostedPrivyIdentity,
} from "./privy";
import { resolveHostedPrivyAuthMethodFromIdentity } from "./privy-auth-method";
import type { HostedPrivyAuthMethod } from "./types";
import { normalizeHostedSignupTimeZone } from "./time-zone-hint";
import {
  buildHostedInviteUrl,
  issueHostedInvite,
  requireHostedInviteMemberIdentity,
  requireHostedInviteForAuthentication,
} from "./invite-service";
import {
  assertHostedPrivyAccountDeletionNotPending,
  createHostedPrivyIdentityConflictError,
  ensureHostedMemberForPrivyIdentityResolutionTx,
  reconcileHostedPrivyIdentityOnMemberResolutionTx,
  lookupHostedMemberForPrivyAuthAttempt,
  lookupHostedMemberForPrivyPrincipal,
} from "./member-identity-service";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  generateHostedMemberId,
} from "./shared";
import { readHostedMemberIdentity } from "./hosted-member-identity-store";
import { readActiveHostedMemberAccess } from "./member-access";
import type { HostedPostVerificationStage } from "./stage";
import { hostedOnboardingError } from "./errors";

type HostedPrivyCompletionMemberResolution = {
  bindingAuthMethod: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  member: HostedMemberCoreState;
  primaryEmailBindingSynced: boolean;
};

const HOSTED_PRIVY_AUTHORITY_TIMEOUT_MS = 5_000;

export async function completeHostedPrivyVerification(input: {
  authMethod?: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  inviteCode?: string | null;
  now?: Date;
  prisma?: PrismaClient;
  timeZone?: string | null;
}): Promise<{
  inviteCode: string;
  joinUrl: string;
  member: HostedMemberCoreState;
  memberId: string;
  messagingSetupRequired: boolean;
  stage: HostedPostVerificationStage;
}> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const timeZone = normalizeHostedSignupTimeZone(input.timeZone);
  const timing = startHostedOnboardingTiming("hosted-onboarding.privy.complete", {
    inviteProvided: Boolean(input.inviteCode),
  });
  let usedInvite = false;

  try {
    const invite = input.inviteCode
      ? await requireHostedInviteForAuthentication(input.inviteCode, prisma, now)
      : null;
    usedInvite = invite !== null;
    const authMethod = resolveHostedPrivyAuthMethodFromIdentity({
      authMethod: input.authMethod,
      identity: input.identity,
    });

    if (invite) {
      assertHostedMemberNotSuspended(invite.member);
    }
    await assertHostedPrivyAccountDeletionNotPending({
      prisma,
      privyUserId: input.identity.userId,
    });
    const memberResolution = await resolvePreparedHostedPrivyCompletionMember({
      authMethod,
      identity: input.identity,
      invite,
      now,
      prisma,
      timeZone,
    });
    const member = memberResolution.member;

    assertHostedMemberNotSuspended(member);
    if (memberResolution.identity.telegram?.telegramUserId) {
      await signalHostedPhoneCallResultNotificationRecovery({
        memberId: member.id,
        prisma,
      });
    }

    const messagingSetupState = await readHostedMemberMessagingSetupState({
      memberId: member.id,
      prisma,
    });

    const activeInvite = invite ?? await issueHostedInvite({
      channel: "web",
      memberId: member.id,
      prisma,
    });
    const accessActive = await readActiveHostedMemberAccess({
      memberId: member.id,
      prisma,
    });
    const activationPending = accessActive
      ? await isHostedMemberActivationPending({
          billingStatus: HostedBillingStatus.active,
          memberId: member.id,
          prisma,
        })
      : false;
    const stage = deriveHostedPostVerificationStage({
      activationPending,
      billingStatus: member.billingStatus,
      sponsoredAccessActive: accessActive,
      suspendedAt: member.suspendedAt,
    });
    const messagingSetupRequired = isHostedMemberMessagingSetupRequired({
      identity: {
        ...(messagingSetupState?.identity ?? {}),
        emailLinked: Boolean(memberResolution.identity.email?.verifiedAt),
      },
      routing: messagingSetupState?.routing ?? null,
    });

    finishHostedOnboardingTiming(timing, "completed", {
      messagingSetupRequired,
      stage,
      usedInvite,
    });

    return {
      inviteCode: activeInvite.inviteCode,
      joinUrl: buildHostedInviteUrl(activeInvite.inviteCode),
      member,
      memberId: member.id,
      messagingSetupRequired,
      stage,
    };
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      usedInvite,
    });
    throw error;
  }
}

async function resolvePreparedHostedPrivyCompletionMember(input: {
  authMethod: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  invite: Awaited<ReturnType<typeof requireHostedInviteForAuthentication>> | null;
  now: Date;
  prisma: PrismaClient;
  timeZone: string | null;
}): Promise<HostedPrivyCompletionMemberResolution> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const runAttempt = async (): Promise<HostedPrivyCompletionMemberResolution> => {
      const invitePreparation = input.invite
        ? await prepareHostedInvitePrivyReconciliation({
            authMethod: input.authMethod,
            identity: input.identity,
            invite: input.invite,
            prisma: input.prisma,
          })
        : null;
      const existingMember = input.invite?.member ?? await resolveHostedPrivyMemberBeforeTx({
        authMethod: input.authMethod,
        identity: input.identity,
        prisma: input.prisma,
      });
      const preparedMemberId = existingMember?.id ?? generateHostedMemberId();
      const { liveIdentity, preparedRoot } = await settleHostedPrivyPreparation({
        existingMemberId: existingMember?.id ?? null,
        identity: input.identity,
        memberId: preparedMemberId,
        prisma: input.prisma,
      });

      if (input.invite) {
        if (!invitePreparation) {
          throw new Error("Hosted invite Privy preparation is missing.");
        }
        const reconciliation = await input.prisma.$transaction(
          (tx) => runWithHostedDomainRootProviderCallsDisabled(() =>
            runWithHostedDomainRootUnwrapCache(async () => {
            const reconciled = await reconcileHostedPrivyIdentityOnMemberResolutionTx({
              allowVerifiedEmailRebinding: true,
              authMethod: invitePreparation.authMethod,
              expectedEmailLookupKey: invitePreparation.pendingEmailLookupKey,
              expectedPhoneHint: invitePreparation.pendingEmailLookupKey
                ? undefined
                : readHostedPhoneHint(invitePreparation.identity.maskedPhoneNumberHint),
              expectedPhoneLookupKey: invitePreparation.pendingEmailLookupKey
                ? undefined
                : invitePreparation.identity.phoneLookupKey ?? undefined,
              identity: input.identity,
              member: input.invite!.member,
              now: input.now,
              preparedControlRoot: preparedRoot,
              preparedLiveIdentity: liveIdentity,
              prisma: tx,
            });
            await syncHostedPrivyTransactionalBindingsTx({
              authMethod: invitePreparation.authMethod,
              identity: reconciled.identity,
              memberId: reconciled.member.id,
              preparedControlRoot: preparedRoot,
              prisma: tx,
            });
            await syncHostedMemberPendingActivationTimeZoneTx({
              memberId: reconciled.member.id,
              prisma: tx,
              timeZone: input.timeZone,
            });
            return reconciled;
            })
          ),
          HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
        );
        const completion: HostedPrivyCompletionMemberResolution = {
          bindingAuthMethod: invitePreparation.authMethod,
          identity: reconciliation.identity,
          member: reconciliation.member,
          primaryEmailBindingSynced: invitePreparation.authMethod === "email",
        };
        await syncHostedPrivyBindings({
          authMethod: completion.bindingAuthMethod,
          identity: completion.identity,
          memberId: completion.member.id,
          preparedControlRoot: preparedRoot,
          primaryEmailBindingSynced: completion.primaryEmailBindingSynced,
          prisma: input.prisma,
        });
        return completion;
      }

      const completion: HostedPrivyCompletionMemberResolution = {
        bindingAuthMethod: input.authMethod,
        ...(await input.prisma.$transaction(
          (tx) => runWithHostedDomainRootProviderCallsDisabled(() =>
            runWithHostedDomainRootUnwrapCache(async () => {
            const memberResolution = await ensureHostedMemberForPrivyIdentityResolutionTx({
              allowVerifiedEmailRebinding: true,
              authMethod: input.authMethod,
              identity: input.identity,
              now: input.now,
              preparedControlRoot: preparedRoot,
              preparedLiveIdentity: liveIdentity,
              preparedNewMemberId: preparedMemberId,
              prisma: tx,
            });
            await syncHostedPrivyTransactionalBindingsTx({
              authMethod: input.authMethod,
              identity: memberResolution.identity,
              memberId: memberResolution.member.id,
              preparedControlRoot: preparedRoot,
              prisma: tx,
            });
            await syncHostedMemberPendingActivationTimeZoneTx({
              memberId: memberResolution.member.id,
              prisma: tx,
              timeZone: input.timeZone,
            });
            return {
              identity: memberResolution.identity,
              member: memberResolution.member,
              primaryEmailBindingSynced: input.authMethod === "email",
            };
            })
          ),
          HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
        )),
      };
      await syncHostedPrivyBindings({
        authMethod: completion.bindingAuthMethod,
        identity: completion.identity,
        memberId: completion.member.id,
        preparedControlRoot: preparedRoot,
        primaryEmailBindingSynced: completion.primaryEmailBindingSynced,
        prisma: input.prisma,
      });
      return completion;
    };

    try {
      return await (attempt === 0
        ? runWithHostedDomainRootUnwrapCache(runAttempt)
        : runWithFreshHostedDomainRootUnwrapCache(runAttempt));
    } catch (error) {
      if (error instanceof HostedDomainRootPreparationMismatchError && attempt === 0) {
        continue;
      }
      throw error;
    }
  }
  throw new HostedDomainRootPreparationMismatchError();
}

async function resolveHostedPrivyMemberBeforeTx(input: {
  authMethod: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  prisma: PrismaClient;
}): Promise<HostedMemberCoreState | null> {
  const byPrincipal = await lookupHostedMemberForPrivyPrincipal({
    identity: input.identity,
    prisma: input.prisma,
  });
  return byPrincipal ?? (await lookupHostedMemberForPrivyAuthAttempt({
    authMethod: input.authMethod,
    identity: input.identity,
    prisma: input.prisma,
  }))?.core ?? null;
}

async function settleHostedPrivyPreparation(input: {
  existingMemberId: string | null;
  identity: HostedPrivyIdentity;
  memberId: string;
  prisma: PrismaClient;
}): Promise<{
  liveIdentity: HostedPrivyIdentity;
  preparedRoot: PreparedHostedDomainRootForWeb;
}> {
  let hasFirstFailure = false;
  let firstFailure: unknown;
  const observe = async <T>(pending: Promise<T>): Promise<T> => {
    try {
      return await pending;
    } catch (error) {
      if (!hasFirstFailure) {
        hasFirstFailure = true;
        firstFailure = error;
      }
      throw error;
    }
  };
  const liveIdentity = observe(
    readHostedPrivyUserById(input.identity.userId, {
      maxRetries: 0,
      timeout: HOSTED_PRIVY_AUTHORITY_TIMEOUT_MS,
    }).then(resolveHostedPrivyIdentityFromVerifiedUser),
  );
  const preparedRoot = observe(prepareHostedDomainRootForWeb({
    domain: "control",
    prisma: input.prisma,
    reason: "hosted-onboarding.privy-identity",
    userId: input.memberId,
  }));
  const preloads = input.existingMemberId
    ? [
        observe(readHostedMemberIdentity({
          memberId: input.existingMemberId,
          prisma: input.prisma,
        })),
        observe(readHostedMemberEmailAuthorization({
          memberId: input.existingMemberId,
          prisma: input.prisma,
        })),
        observe(readHostedMemberRoutingState({
          memberId: input.existingMemberId,
          prisma: input.prisma,
          retainFailureInScopedCache: true,
        })),
      ]
    : [];
  const settled = await Promise.allSettled([liveIdentity, preparedRoot, ...preloads]);
  if (hasFirstFailure) {
    throw firstFailure;
  }
  if (settled[0].status !== "fulfilled" || settled[1].status !== "fulfilled") {
    throw new Error("Hosted Privy preparation did not settle successfully.");
  }
  return {
    liveIdentity: settled[0].value,
    preparedRoot: settled[1].value,
  };
}

async function prepareHostedInvitePrivyReconciliation(input: {
  authMethod: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  invite: NonNullable<
    Awaited<ReturnType<typeof requireHostedInviteForAuthentication>>
  >;
  prisma: PrismaClient;
}): Promise<{
  authMethod: HostedPrivyAuthMethod;
  identity: ReturnType<typeof requireHostedInviteMemberIdentity>;
  pendingEmailLookupKey: string | undefined;
}> {
  const identity = requireHostedInviteMemberIdentity(input.invite.member);
  const routing = input.invite.member.routing
    ? await projectHostedMemberRoutingState(input.invite.member.routing, input.prisma)
    : null;
  const pendingEmailLookupKey =
    routing?.pendingLinqParticipantContact?.kind === "email"
      ? routing.pendingLinqParticipantContact.lookupKey
      : undefined;
  const authMethod = resolveHostedInvitePrivyAuthMethod({
    authMethod: input.authMethod,
    hasExpectedEmail: Boolean(pendingEmailLookupKey),
    hasExpectedPhone: Boolean(identity.phoneLookupKey),
  });
  assertHostedPrivyAuthMethodSatisfied({
    authMethod,
    identity: input.identity,
  });
  return {
    authMethod,
    identity,
    pendingEmailLookupKey,
  };
}

async function syncHostedMemberPendingActivationTimeZoneTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  timeZone: string | null;
}): Promise<void> {
  if (!input.timeZone) {
    return;
  }

  await updateHostedMemberPendingActivationTimeZoneIfActivationPending({
    memberId: input.memberId,
    pendingActivationTimeZone: input.timeZone,
    prisma: input.prisma,
  });
}

async function syncHostedPrivyBindings(input: {
  authMethod: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  memberId: string;
  preparedControlRoot: PreparedHostedDomainRootForWeb;
  primaryEmailBindingSynced: boolean;
  prisma: PrismaClient;
}): Promise<void> {
  if (
    input.identity.email?.verifiedAt &&
    !(input.authMethod === "email" && input.primaryEmailBindingSynced)
  ) {
    const email = input.identity.email;
    const syncEmailBinding = async () => {
      const replyAlias = await createHostedMemberReplyAliasRoute({
        memberId: input.memberId,
      });
      await syncHostedMemberVerifiedEmailAuthorization({
        address: email.address,
        memberId: input.memberId,
        preparedControlRoot: input.preparedControlRoot,
        prisma: input.prisma,
        replyAliasLookupKey: replyAlias?.replyAliasLookupKey ?? null,
        verifiedAt: new Date(email.verifiedAt! * 1000),
      });
    };

    if (input.authMethod === "email") {
      await syncEmailBinding().catch(mapHostedPrivyPrimaryEmailBindingError);
    } else {
      await syncHostedPrivySecondaryEmailBindingBestEffort(syncEmailBinding);
    }
  }
}

async function syncHostedPrivySecondaryEmailBindingBestEffort(
  syncBinding: () => Promise<void>,
): Promise<void> {
  try {
    await syncBinding();
  } catch (error) {
    if (!isHostedPrivyEmailBindingUniqueConstraintError(error)) {
      throw error;
    }

    console.warn("Hosted Privy secondary email binding sync failed.");
  }
}

function resolveHostedInvitePrivyAuthMethod(input: {
  authMethod: HostedPrivyAuthMethod;
  hasExpectedEmail: boolean;
  hasExpectedPhone: boolean;
}): HostedPrivyAuthMethod {
  if (input.hasExpectedEmail) {
    return "email";
  }

  if (input.hasExpectedPhone) {
    return "phone";
  }

  return input.authMethod;
}

function assertHostedPrivyAuthMethodSatisfied(input: {
  authMethod: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
}): void {
  if (input.authMethod === "phone" && !input.identity.phone) {
    throw hostedOnboardingError({
      code: "PRIVY_PHONE_REQUIRED",
      message: "Finish phone verification before continuing.",
      httpStatus: 400,
    });
  }

  if (input.authMethod === "email" && !input.identity.email?.verifiedAt) {
    throw hostedOnboardingError({
      code: "PRIVY_EMAIL_REQUIRED",
      message: "Finish email verification before continuing.",
      httpStatus: 400,
    });
  }

  if (input.authMethod === "telegram" && !input.identity.telegram?.telegramUserId) {
    throw hostedOnboardingError({
      code: "PRIVY_TELEGRAM_REQUIRED",
      message: "Finish Telegram verification before continuing.",
      httpStatus: 400,
    });
  }
}

async function syncHostedPrivyTransactionalBindingsTx(input: {
  authMethod: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  memberId: string;
  preparedControlRoot: PreparedHostedDomainRootForWeb;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  if (input.authMethod === "email" && input.identity.email?.verifiedAt) {
    const replyAlias = await createHostedMemberReplyAliasRoute({
      memberId: input.memberId,
    });
    await syncHostedMemberVerifiedEmailAuthorization({
      address: input.identity.email.address,
      memberId: input.memberId,
      preparedControlRoot: input.preparedControlRoot,
      prisma: input.prisma,
      replyAliasLookupKey: replyAlias?.replyAliasLookupKey ?? null,
      verifiedAt: new Date(input.identity.email.verifiedAt * 1000),
    }).catch(mapHostedPrivyPrimaryEmailBindingError);
  }

  if (input.identity.telegram?.telegramUserId) {
    await upsertHostedMemberTelegramRoutingBindingTx({
      memberId: input.memberId,
      prisma: input.prisma,
      telegramUserId: input.identity.telegram.telegramUserId,
    });
  }
}

function mapHostedPrivyPrimaryEmailBindingError(error: unknown): never {
  if (isHostedPrivyEmailBindingUniqueConstraintError(error)) {
    throw createHostedPrivyIdentityConflictError();
  }

  throw error;
}

function isHostedPrivyEmailBindingUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.some(isHostedPrivyEmailBindingUniqueConstraintTarget);
  }

  return isHostedPrivyEmailBindingUniqueConstraintTarget(target);
}

function isHostedPrivyEmailBindingUniqueConstraintTarget(value: unknown): boolean {
  return typeof value === "string" && (
    value === "verifiedEmailLookupKey"
    || value === "verified_email_lookup_key"
    || value === "directPublicSenderLookupKey"
    || value === "direct_public_sender_lookup_key"
    || value.includes("verifiedEmailLookupKey")
    || value.includes("verified_email_lookup_key")
    || value.includes("directPublicSenderLookupKey")
    || value.includes("direct_public_sender_lookup_key")
  );
}
