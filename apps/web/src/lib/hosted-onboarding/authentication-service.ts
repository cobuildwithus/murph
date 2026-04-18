import {
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { readHostedPhoneHint } from "./contact-privacy";
import { isHostedMemberSuspended } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import { deriveHostedPostVerificationStage } from "./lifecycle";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import { isHostedMemberActivationPending } from "./activation-progress";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import {
  syncHostedMemberTelegramRoutingBinding,
} from "./hosted-member-routing-store";
import {
  isHostedMemberMessagingSetupRequired,
} from "./messaging-state";
import { type HostedPrivyIdentity } from "./privy";
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
  identity: HostedPrivyIdentity;
  inviteCode?: string | null;
  now?: Date;
  prisma?: PrismaClient;
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
      : await ensureHostedMemberForPrivyIdentity({
          identity: input.identity,
          prisma,
          now,
        });

    if (input.identity.telegram?.telegramUserId) {
      await syncHostedMemberTelegramRoutingBinding({
        memberId: member.id,
        prisma,
        telegramUserId: input.identity.telegram.telegramUserId,
      });
    }

    const memberSnapshot = await readHostedMemberSnapshot({
      memberId: member.id,
      prisma,
    });

    if (isHostedMemberSuspended(member.suspendedAt)) {
      throw hostedOnboardingError({
        code: "HOSTED_MEMBER_SUSPENDED",
        message: "This hosted account is suspended. Contact support to restore access.",
        httpStatus: 403,
      });
    }

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
      identity: memberSnapshot?.identity ?? null,
      routing: memberSnapshot?.routing ?? null,
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
