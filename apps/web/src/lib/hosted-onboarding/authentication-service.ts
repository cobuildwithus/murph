import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

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
  isHostedMemberMessagingSetupRequired,
} from "./messaging-state";
import {
  syncHostedPrivyMemberIdMetadata,
  type HostedPrivyIdentity,
  type HostedPrivyUser,
} from "./privy";
import type { HostedPrivyAuthenticationProof } from "./privy-auth-intent";
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
} from "./errors";

type HostedPrivyCompletionMemberResolution = {
  initialVisitEligible: boolean;
  member: HostedMemberCoreState;
};

export async function completeHostedPrivyVerification(input: {
  authProof: HostedPrivyAuthenticationProof;
  inviteCode?: string | null;
  now?: Date;
  prisma?: PrismaClient;
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
    const identity = buildHostedPrivyIdentityFromAuthenticationProof(input.authProof);
    const invite = input.inviteCode
      ? await requireHostedInviteForAuthentication(input.inviteCode, prisma, now)
      : null;
    usedInvite = invite !== null;
    const authMethod = input.authProof.method;

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
          assertHostedInvitePrivyAuthMethod({
            authMethod,
            hasExpectedEmail: Boolean(pendingEmailContact?.lookupKey),
            hasExpectedPhone: Boolean(inviteIdentity.phoneLookupKey),
          });
          const member = await prisma.$transaction(async (tx) => {
            const reconciledMember = await reconcileHostedPrivyIdentityOnMemberTx({
              authMethod,
              expectedEmailLookupKey: pendingEmailContact?.lookupKey,
              expectedPhoneHint: pendingEmailContact
                ? undefined
                : readHostedPhoneHint(inviteIdentity.maskedPhoneNumberHint),
              expectedPhoneLookupKey: pendingEmailContact
                ? undefined
                : inviteIdentity.phoneLookupKey ?? undefined,
              identity,
              member: invite.member,
              prisma: tx,
              now,
            });
            await syncHostedPrivyPrimaryBindingTx({
              authMethod,
              identity,
              memberId: reconciledMember.id,
              prisma: tx,
            });
            await syncHostedMemberPendingActivationTimeZoneTx({
              memberId: reconciledMember.id,
              prisma: tx,
              timeZone,
            });
            return reconciledMember;
          }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

          return {
            initialVisitEligible: true,
            member,
          };
        })()
      : {
          ...(await prisma.$transaction(async (tx) => {
            const memberResolution = await ensureHostedMemberForPrivyIdentityResolutionTx({
              authMethod,
              identity,
              prisma: tx,
              now,
            });
            await syncHostedPrivyPrimaryBindingTx({
              authMethod,
              identity,
              memberId: memberResolution.member.id,
              prisma: tx,
            });
            await syncHostedMemberPendingActivationTimeZoneTx({
              memberId: memberResolution.member.id,
              prisma: tx,
              timeZone,
            });

            return {
              initialVisitEligible: memberResolution.created,
              member: memberResolution.member,
            };
          }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS)),
        };
    const member = memberResolution.member;

    assertHostedMemberNotSuspended(member);

    await syncHostedPrivyMemberIdMetadataBestEffort({
      memberId: member.id,
      privyUserId: input.authProof.privyUserId,
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

function assertHostedInvitePrivyAuthMethod(input: {
  authMethod: HostedPrivyAuthMethod;
  hasExpectedEmail: boolean;
  hasExpectedPhone: boolean;
}): void {
  const expectedMethod = input.hasExpectedEmail
    ? "email"
    : input.hasExpectedPhone
      ? "phone"
      : null;

  if (expectedMethod !== null && input.authMethod !== expectedMethod) {
    throw hostedOnboardingError({
      code: "HOSTED_INVITE_AUTH_METHOD_MISMATCH",
      message: "Use the sign-in method requested by this invite.",
      httpStatus: 403,
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

  if (input.authMethod === "telegram" && input.identity.telegram?.telegramUserId) {
    await upsertHostedMemberTelegramRoutingBindingTx({
      memberId: input.memberId,
      prisma: input.prisma,
      telegramUserId: input.identity.telegram.telegramUserId,
    });
  }
}

function buildHostedPrivyIdentityFromAuthenticationProof(
  proof: HostedPrivyAuthenticationProof,
): HostedPrivyIdentity {
  if (proof.method === "email") {
    return {
      email: proof.credential,
      phone: null,
      telegram: null,
      userId: proof.privyUserId,
    };
  }

  if (proof.method === "phone") {
    return {
      email: null,
      phone: proof.credential,
      telegram: null,
      userId: proof.privyUserId,
    };
  }

  return {
    email: null,
    phone: null,
    telegram: proof.credential,
    userId: proof.privyUserId,
  };
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
