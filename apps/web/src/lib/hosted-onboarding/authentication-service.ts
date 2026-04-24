import {
  type PrismaClient,
} from "@prisma/client";

import { type HostedAuthenticationIntent } from "./authentication-intent";
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
  syncHostedMemberVerifiedEmailAuthorization,
} from "./hosted-member-store";
import {
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
import {
  buildHostedInviteUrl,
  issueHostedInvite,
  requireHostedInviteMemberIdentity,
  requireHostedInviteForAuthentication,
} from "./invite-service";
import {
  ensureHostedMemberForPrivyIdentity,
  requireExistingHostedMemberForPrivyIdentity,
  reconcileHostedPrivyIdentityOnMember,
} from "./member-identity-service";
import type { HostedPostVerificationStage } from "./stage";

export async function completeHostedPrivyVerification(input: {
  identity: HostedPrivyIdentity;
  inviteCode?: string | null;
  intent?: HostedAuthenticationIntent;
  now?: Date;
  prisma?: PrismaClient;
  verifiedPrivyUser?: HostedPrivyUser | null;
}): Promise<{
  inviteCode: string;
  joinUrl: string;
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

    if (invite) {
      assertHostedMemberNotSuspended(invite.member);
    }

    const member = invite
      ? await (async () => {
          const inviteIdentity = requireHostedInviteMemberIdentity(invite.member);
          return reconcileHostedPrivyIdentityOnMember({
            expectedPhoneHint: readHostedPhoneHint(inviteIdentity.maskedPhoneNumberHint),
            expectedPhoneLookupKey: inviteIdentity.phoneLookupKey ?? undefined,
            identity: input.identity,
            member: invite.member,
            prisma,
            now,
          });
        })()
      : input.intent === "signin"
        ? await requireExistingHostedMemberForPrivyIdentity({
            identity: input.identity,
            now,
            prisma,
          })
        : await ensureHostedMemberForPrivyIdentity({
            identity: input.identity,
            prisma,
            now,
          });

    assertHostedMemberNotSuspended(member);

    await syncHostedPrivyBindings({
      identity: input.identity,
      memberId: member.id,
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

async function syncHostedPrivyBindings(input: {
  identity: HostedPrivyIdentity;
  memberId: string;
  prisma: PrismaClient;
  verifiedPrivyUser: HostedPrivyUser | null;
}): Promise<void> {
  if (input.identity.email?.verifiedAt) {
    await syncHostedMemberVerifiedEmailAuthorization({
      address: input.identity.email.address,
      memberId: input.memberId,
      prisma: input.prisma,
      verifiedAt: new Date(input.identity.email.verifiedAt * 1000),
    });
  }

  if (input.identity.telegram?.telegramUserId) {
    await syncHostedMemberTelegramRoutingBinding({
      memberId: input.memberId,
      prisma: input.prisma,
      telegramUserId: input.identity.telegram.telegramUserId,
    });
  }

  await syncHostedPrivyMemberIdMetadataBestEffort({
    memberId: input.memberId,
    privyUserId: input.identity.userId,
    verifiedPrivyUser: input.verifiedPrivyUser,
  });
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
