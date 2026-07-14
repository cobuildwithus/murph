import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";
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
  type HostedMemberCoreState,
  syncHostedMemberVerifiedEmailAuthorization,
  updateHostedMemberPendingActivationTimeZoneIfActivationPending,
} from "./hosted-member-store";
import { createHostedMemberReplyAliasRoute } from "./hosted-email-reply-alias";
import {
  projectHostedMemberRoutingState,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "./hosted-member-routing-store";
import {
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
  type HostedMailboxAppendDispatch,
} from "./member-channel-sync";
import {
  isHostedMemberMessagingSetupRequired,
} from "./messaging-state";
import {
  syncHostedPrivyMemberIdMetadata,
  type HostedPrivyIdentity,
  type HostedPrivyUser,
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
  createHostedPrivyIdentityConflictError,
  ensureHostedMemberForPrivyIdentityResolutionTx,
  reconcileHostedPrivyIdentityOnMemberTx,
} from "./member-identity-service";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "./shared";
import { readActiveHostedMemberAccess } from "./member-access";
import type { HostedPostVerificationStage } from "./stage";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "./errors";
import {
  resolveHostedTelegramDirectAuthorizationThreadId,
  type HostedTelegramDirectAuthorization,
} from "./telegram-direct-authorization";
import { resolveHostedPrivyLinkedAccounts } from "./privy-shared";

type HostedPrivyCompletionMemberResolution = {
  bindingAuthMethod: HostedPrivyAuthMethod;
  channelSyncDispatch: HostedMailboxAppendDispatch | null;
  initialVisitEligible: boolean;
  member: HostedMemberCoreState;
  primaryBindingSynced: boolean;
};

export async function completeHostedPrivyVerification(input: {
  authMethod?: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  inviteCode?: string | null;
  now?: Date;
  prisma?: PrismaClient;
  telegramDirectAuthorization?: HostedTelegramDirectAuthorization;
  timeZone?: string | null;
  verifiedPrivyUser?: HostedPrivyUser | null;
}): Promise<{
  inviteCode: string;
  joinUrl: string;
  initialVisitEligible: boolean;
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

    const memberResolution = invite
      ? await (async (): Promise<HostedPrivyCompletionMemberResolution> => {
          const inviteIdentity = requireHostedInviteMemberIdentity(invite.member);
          const inviteRouting = invite.member.routing
            ? await projectHostedMemberRoutingState(invite.member.routing, prisma)
            : null;
          const pendingEmailContact =
            inviteRouting?.pendingLinqParticipantContact?.kind === "email"
              ? inviteRouting.pendingLinqParticipantContact
              : null;
          const inviteAuthMethod = resolveHostedInvitePrivyAuthMethod({
            authMethod,
            hasExpectedEmail: Boolean(pendingEmailContact?.lookupKey),
            hasExpectedPhone: Boolean(inviteIdentity.phoneLookupKey),
          });
          assertHostedPrivyAuthMethodSatisfied({
            authMethod: inviteAuthMethod,
            identity: input.identity,
          });
          const { channelSyncDispatch, member } = await prisma.$transaction(async (tx) => {
            const reconciledMember = await reconcileHostedPrivyIdentityOnMemberTx({
              authMethod: inviteAuthMethod,
              expectedEmailLookupKey: pendingEmailContact?.lookupKey,
              expectedPhoneHint: pendingEmailContact
                ? undefined
                : readHostedPhoneHint(inviteIdentity.maskedPhoneNumberHint),
              expectedPhoneLookupKey: pendingEmailContact
                ? undefined
                : inviteIdentity.phoneLookupKey ?? undefined,
              identity: input.identity,
              member: invite.member,
              prisma: tx,
              now,
            });
            await syncHostedPrivyPrimaryBindingTx({
              authMethod: inviteAuthMethod,
              identity: input.identity,
              memberId: reconciledMember.id,
              prisma: tx,
            });
            const channelSyncDispatch = await syncHostedPrivyTelegramBindingAndChannelsTx({
              authMethod: inviteAuthMethod,
              identity: input.identity,
              memberId: reconciledMember.id,
              now,
              prisma: tx,
              telegramDirectAuthorization: input.telegramDirectAuthorization,
              verifiedPrivyUser: input.verifiedPrivyUser ?? null,
            });
            await syncHostedMemberPendingActivationTimeZoneTx({
              memberId: reconciledMember.id,
              prisma: tx,
              timeZone,
            });
            return {
              channelSyncDispatch,
              member: reconciledMember,
            };
          }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

          return {
            bindingAuthMethod: inviteAuthMethod,
            channelSyncDispatch,
            initialVisitEligible: true,
            member,
            primaryBindingSynced:
              inviteAuthMethod === "email" || inviteAuthMethod === "telegram",
          };
        })()
      : {
          bindingAuthMethod: authMethod,
          ...(await prisma.$transaction(async (tx) => {
            const memberResolution = await ensureHostedMemberForPrivyIdentityResolutionTx({
              authMethod,
              identity: input.identity,
              prisma: tx,
              now,
            });
            await syncHostedPrivyPrimaryBindingTx({
              authMethod,
              identity: input.identity,
              memberId: memberResolution.member.id,
              prisma: tx,
            });
            const channelSyncDispatch = await syncHostedPrivyTelegramBindingAndChannelsTx({
              authMethod,
              identity: input.identity,
              memberId: memberResolution.member.id,
              now,
              prisma: tx,
              telegramDirectAuthorization: input.telegramDirectAuthorization,
              verifiedPrivyUser: input.verifiedPrivyUser ?? null,
            });
            await syncHostedMemberPendingActivationTimeZoneTx({
              memberId: memberResolution.member.id,
              prisma: tx,
              timeZone,
            });

            return {
              channelSyncDispatch,
              initialVisitEligible: memberResolution.created,
              member: memberResolution.member,
              primaryBindingSynced: authMethod === "email" || authMethod === "telegram",
            };
          }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS)),
        };
    const member = memberResolution.member;

    if (memberResolution.channelSyncDispatch) {
      await signalHostedMailboxAppendBestEffort({
        expectedUserId: member.id,
        mailboxItemId: memberResolution.channelSyncDispatch.mailboxItemId,
      });
    }

    assertHostedMemberNotSuspended(member);

    await syncHostedPrivyBindings({
      authMethod: memberResolution.bindingAuthMethod,
      identity: input.identity,
      memberId: member.id,
      primaryBindingSynced: memberResolution.primaryBindingSynced,
      prisma,
      verifiedPrivyUser: input.verifiedPrivyUser ?? null,
    });

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
      identity: messagingSetupState?.identity ?? null,
      routing: messagingSetupState?.routing ?? null,
    });

    finishHostedOnboardingTiming(timing, "completed", {
      messagingSetupRequired,
      stage,
      usedInvite,
    });

    return {
      inviteCode: activeInvite.inviteCode,
      initialVisitEligible: memberResolution.initialVisitEligible,
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
  primaryBindingSynced: boolean;
  prisma: PrismaClient;
  verifiedPrivyUser: HostedPrivyUser | null;
}): Promise<void> {
  if (
    input.identity.email?.verifiedAt &&
    !(input.authMethod === "email" && input.primaryBindingSynced)
  ) {
    const email = input.identity.email;
    const syncEmailBinding = async () => {
      const replyAlias = await createHostedMemberReplyAliasRoute({
        memberId: input.memberId,
      });
      await syncHostedMemberVerifiedEmailAuthorization({
        address: email.address,
        memberId: input.memberId,
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

  await syncHostedPrivyMemberIdMetadataBestEffort({
    memberId: input.memberId,
    privyUserId: input.identity.userId,
    verifiedPrivyUser: input.verifiedPrivyUser,
  });
}

async function syncHostedPrivySecondaryEmailBindingBestEffort(
  syncBinding: () => Promise<void>,
): Promise<void> {
  try {
    await syncBinding();
  } catch (error) {
    if (!isExpectedHostedPrivySecondaryBindingConflict(error)) {
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

async function syncHostedPrivyPrimaryBindingTx(input: {
  authMethod: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  if (input.authMethod === "email" && input.identity.email?.verifiedAt) {
    const replyAlias = await createHostedMemberReplyAliasRoute({
      memberId: input.memberId,
    });
    await syncHostedMemberVerifiedEmailAuthorization({
      address: input.identity.email.address,
      memberId: input.memberId,
      prisma: input.prisma,
      replyAliasLookupKey: replyAlias?.replyAliasLookupKey ?? null,
      verifiedAt: new Date(input.identity.email.verifiedAt * 1000),
    }).catch(mapHostedPrivyPrimaryEmailBindingError);
    return;
  }
}

async function syncHostedPrivyTelegramBindingAndChannelsTx(input: {
  authMethod: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
  telegramDirectAuthorization: HostedTelegramDirectAuthorization | undefined;
  verifiedPrivyUser: HostedPrivyUser | null;
}): Promise<HostedMailboxAppendDispatch | null> {
  const telegramUserId = input.identity.telegram?.telegramUserId;
  if (!telegramUserId) {
    return null;
  }

  const telegramThreadId = input.authMethod === "telegram"
    && input.telegramDirectAuthorization !== undefined
    ? resolveHostedTelegramDirectAuthorizationThreadId(
        input.telegramDirectAuthorization,
        telegramUserId,
      )
    : undefined;
  try {
    await upsertHostedMemberTelegramRoutingBindingTx({
      memberId: input.memberId,
      prisma: input.prisma,
      telegramThreadId,
      telegramUserId,
    });
  } catch (error) {
    if (input.authMethod === "telegram" || !isExpectedHostedPrivySecondaryBindingConflict(error)) {
      throw error;
    }

    console.warn("Hosted Privy secondary telegram binding sync failed.");
    return null;
  }

  return enqueueHostedMemberChannelsUpdatedForActiveMemberTx({
    linkedAccounts: input.verifiedPrivyUser
      ? resolveHostedPrivyLinkedAccounts(input.verifiedPrivyUser)
      : undefined,
    memberId: input.memberId,
    occurredAt: input.now.toISOString(),
    prisma: input.prisma,
    sourceType: "hosted.privy.telegram.sync",
  });
}

async function signalHostedMailboxAppendBestEffort(input: {
  expectedUserId: string;
  mailboxItemId: string;
}): Promise<void> {
  try {
    await signalHostedMailboxAppendRuntime(input);
  } catch {
    // Authentication is committed even when the best-effort runtime wake is unavailable.
  }
}

function isExpectedHostedPrivySecondaryBindingConflict(error: unknown): boolean {
  if (isHostedPrivyEmailBindingUniqueConstraintError(error)) {
    return true;
  }

  return isHostedOnboardingError(error) && error.code === "TELEGRAM_IDENTITY_CONFLICT";
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

async function syncHostedPrivyMemberIdMetadataBestEffort(input: {
  memberId: string;
  privyUserId: string;
  verifiedPrivyUser: HostedPrivyUser | null;
}): Promise<void> {
  try {
    await syncHostedPrivyMemberIdMetadata(input);
  } catch {
    console.warn("Hosted Privy member metadata sync failed.");
  }
}
