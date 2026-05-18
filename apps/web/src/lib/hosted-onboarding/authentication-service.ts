import {
  HostedBillingStatus,
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
  syncHostedMemberTelegramRoutingBinding,
} from "./hosted-member-routing-store";
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
  ensureHostedMemberForPrivyIdentity,
  reconcileHostedPrivyIdentityOnMember,
} from "./member-identity-service";
import type { HostedPostVerificationStage } from "./stage";

export async function completeHostedPrivyVerification(input: {
  authMethod?: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  inviteCode?: string | null;
  now?: Date;
  prisma?: PrismaClient;
  timeZone?: string | null;
  verifiedPrivyUser?: HostedPrivyUser | null;
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

    const member = invite
      ? await (async () => {
          const inviteIdentity = requireHostedInviteMemberIdentity(invite.member);
          const inviteRouting = invite.member.routing
            ? await projectHostedMemberRoutingState(invite.member.routing, prisma)
            : null;
          const pendingEmailContact =
            inviteRouting?.pendingLinqParticipantContact?.kind === "email"
              ? inviteRouting.pendingLinqParticipantContact
              : null;
          return reconcileHostedPrivyIdentityOnMember({
            authMethod,
            expectedEmailLookupKey: pendingEmailContact?.lookupKey,
            expectedPhoneHint: pendingEmailContact
              ? undefined
              : readHostedPhoneHint(inviteIdentity.maskedPhoneNumberHint),
            expectedPhoneLookupKey: pendingEmailContact
              ? undefined
              : inviteIdentity.phoneLookupKey ?? undefined,
            identity: input.identity,
            member: invite.member,
            prisma,
            now,
          });
        })()
      : await ensureHostedMemberForPrivyIdentity({
          authMethod,
          identity: input.identity,
          prisma,
          now,
        });

    assertHostedMemberNotSuspended(member);

    await syncHostedPrivyBindings({
      authMethod,
      identity: input.identity,
      memberId: member.id,
      prisma,
      verifiedPrivyUser: input.verifiedPrivyUser ?? null,
    });
    await syncHostedMemberPendingActivationTimeZone({
      billingStatus: member.billingStatus,
      memberId: member.id,
      prisma,
      timeZone: input.timeZone ?? null,
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
    const activationPending = member.billingStatus === "active"
      ? await isHostedMemberActivationPending({
          billingStatus: member.billingStatus,
          memberId: member.id,
          prisma,
        })
      : false;
    const stage = deriveHostedPostVerificationStage({
      activationPending,
      billingStatus: member.billingStatus,
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

async function syncHostedMemberPendingActivationTimeZone(input: {
  billingStatus: HostedBillingStatus;
  memberId: string;
  prisma: PrismaClient;
  timeZone: string | null;
}): Promise<void> {
  const timeZone = normalizeHostedSignupTimeZone(input.timeZone);

  if (!timeZone || input.billingStatus === HostedBillingStatus.active) {
    return;
  }

  await updateHostedMemberPendingActivationTimeZoneIfActivationPending({
    memberId: input.memberId,
    pendingActivationTimeZone: timeZone,
    prisma: input.prisma,
  });
}

async function syncHostedPrivyBindings(input: {
  authMethod: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  memberId: string;
  prisma: PrismaClient;
  verifiedPrivyUser: HostedPrivyUser | null;
}): Promise<void> {
  if (input.identity.email?.verifiedAt) {
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
      await syncEmailBinding();
    } else {
      await syncHostedPrivySecondaryBindingBestEffort("email", syncEmailBinding);
    }
  }

  if (input.identity.telegram?.telegramUserId) {
    const telegramUserId = input.identity.telegram.telegramUserId;
    const syncTelegramBinding = () => syncHostedMemberTelegramRoutingBinding({
      memberId: input.memberId,
      prisma: input.prisma,
      telegramUserId,
    });

    if (input.authMethod === "telegram") {
      await syncTelegramBinding();
    } else {
      await syncHostedPrivySecondaryBindingBestEffort("telegram", syncTelegramBinding);
    }
  }

  await syncHostedPrivyMemberIdMetadataBestEffort({
    memberId: input.memberId,
    privyUserId: input.identity.userId,
    verifiedPrivyUser: input.verifiedPrivyUser,
  });
}

async function syncHostedPrivySecondaryBindingBestEffort(
  binding: "email" | "telegram",
  syncBinding: () => Promise<void>,
): Promise<void> {
  try {
    await syncBinding();
  } catch {
    console.warn(`Hosted Privy secondary ${binding} binding sync failed.`);
  }
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
