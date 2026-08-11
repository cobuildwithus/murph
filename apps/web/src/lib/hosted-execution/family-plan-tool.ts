import "server-only";

import type {
  HostedFamilyPlanCode,
  HostedRuntimeFamilyPlanToolInvite,
  HostedRuntimeFamilyPlanToolRequest,
  HostedRuntimeFamilyPlanToolResponse,
  HostedRuntimeFamilyPlanToolSeatStatus,
  HostedRuntimeFamilyPlanToolStartCheckoutResponse,
  HostedRuntimeFamilyPlanToolStatusResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  createHostedFamilyBillingCheckout,
  ensureHostedAccountGroupForOwnerTx,
  readHostedFamilyAccessForMember,
  issueHostedFamilyInviteFromOwnerTx,
  readHostedFamilyOwnerSnapshotForMember,
} from "@/src/lib/hosted-onboarding/family-plan";
import {
  HOSTED_FAMILY_PLAN_DISPLAY,
  HOSTED_FAMILY_MAX_SEATS,
  HOSTED_FAMILY_MIN_SEATS,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  readHostedMemberStripeBillingRef,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { isHostedThreadContainerMember } from "@/src/lib/hosted-onboarding/member-access";
import { getPrisma } from "@/src/lib/prisma";

export async function handleHostedRuntimeFamilyPlanTool(input: {
  memberId: string;
  request: HostedRuntimeFamilyPlanToolRequest;
}): Promise<HostedRuntimeFamilyPlanToolResponse> {
  if (await isHostedThreadContainerMember({ memberId: input.memberId })) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_PERSONAL_MEMBER_REQUIRED",
      httpStatus: 403,
      message: "Murph Family is available only in a private Murph account.",
    });
  }

  if (input.request.action === "read_status") {
    return {
      action: "read_status",
      result: await readHostedRuntimeFamilyPlanToolStatus(input.memberId),
    };
  }
  if (input.request.action === "start_checkout") {
    return {
      action: "start_checkout",
      result: await startHostedRuntimeFamilyPlanCheckout(
        input.memberId,
        input.request.confirmedTrialConversion,
      ),
    };
  }
  const request = input.request;

  return await getPrisma().$transaction(async (tx) => {
    const invite = await issueHostedFamilyInviteFromOwnerTx({
      ownerMemberId: input.memberId,
      planCode: request.invite.planCode ?? "pulse",
      targetEmail: request.invite.targetEmail ?? null,
      targetLabel: request.invite.targetLabel ?? null,
      targetPhoneNumber: request.invite.targetPhoneNumber ?? null,
      targetTelegramUsername: request.invite.targetTelegramUsername ?? null,
      tx,
    });
    const snapshot = await readHostedFamilyOwnerSnapshotForMember({
      memberId: input.memberId,
      prisma: tx,
    });
    const snapshotInvite = snapshot?.invites.find((row) => row.id === invite.invite.id);

    return {
      action: "create_invite",
      result: {
        invite: projectHostedRuntimeFamilyPlanToolInvite(snapshotInvite ?? {
          acceptUrl: null,
          expiresAt: invite.invite.expiresAt,
          planCode: invite.invite.planCode,
          status: invite.invite.status,
          targetLabel: invite.invite.targetLabel,
          targetPhoneHint: invite.invite.targetPhoneHint,
          telegramInviteUrl: null,
        }),
        plans: snapshot?.plans ?? emptyHostedRuntimeFamilyPlanPlans(),
        replyText: invite.replyText,
        seats: snapshot?.seats ?? emptyHostedRuntimeFamilyPlanSeatStatus(),
      },
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function startHostedRuntimeFamilyPlanCheckout(
  memberId: string,
  confirmedTrialConversion?: true,
): Promise<HostedRuntimeFamilyPlanToolStartCheckoutResponse> {
  const prisma = getPrisma();
  const ownerSnapshot = await readHostedFamilyOwnerSnapshotForMember({
    memberId,
    prisma,
  });
  if (ownerSnapshot?.billingActive) {
    return {
      alreadyActive: true,
      billingActive: true,
      billingStatus: ownerSnapshot.billingStatus,
      checkoutUrl: null,
      owner: true,
      plans: ownerSnapshot.plans,
      seats: ownerSnapshot.seats,
      unavailableReason: null,
    };
  }

  if (await readHostedFamilyAccessForMember({
    memberId,
    prisma,
  })) {
    return {
      alreadyActive: false,
      billingActive: false,
      billingStatus: ownerSnapshot?.billingStatus ?? "none",
      checkoutUrl: null,
      owner: false,
      plans: emptyHostedRuntimeFamilyPlanPlans(),
      seats: emptyHostedRuntimeFamilyPlanSeatStatus(),
      unavailableReason: "already_sponsored",
    };
  }

  const group = await prisma.$transaction(async (tx) => {
    return await ensureHostedAccountGroupForOwnerTx({
      ownerMemberId: memberId,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  const checkout = await createHostedFamilyBillingCheckout({
    ...(confirmedTrialConversion
      ? { confirmedTrialConversion: true }
      : {}),
    groupId: group.id,
    ownerMemberId: memberId,
    prisma,
  });
  const snapshot = await readHostedFamilyOwnerSnapshotForMember({
    memberId,
    prisma,
  });

  return {
    alreadyActive: checkout.alreadyActive,
    billingActive: snapshot?.billingActive ?? checkout.alreadyActive,
    billingStatus: snapshot?.billingStatus ?? group.billingStatus,
    checkoutUrl: checkout.url,
    owner: true,
    plans: snapshot?.plans ?? emptyHostedRuntimeFamilyPlanPlans(),
    seats: snapshot?.seats ?? emptyHostedRuntimeFamilyPlanSeatStatus(),
    unavailableReason: null,
  };
}

async function readHostedRuntimeFamilyPlanToolStatus(
  memberId: string,
): Promise<HostedRuntimeFamilyPlanToolStatusResponse> {
  const prisma = getPrisma();
  const [snapshot, directBillingRef, familyAccess, member] = await Promise.all([
    readHostedFamilyOwnerSnapshotForMember({ memberId, prisma }),
    readHostedMemberStripeBillingRef({ memberId, prisma }),
    readHostedFamilyAccessForMember({ memberId, prisma }),
    prisma.hostedMember.findUnique({
      select: { billingStatus: true, suspendedAt: true },
      where: { id: memberId },
    }),
  ]);
  const activeTrialConversion =
    !snapshot?.billingActive
    && !familyAccess
    && member?.billingStatus === "active"
    && !member.suspendedAt
    && parseHostedBillingPhase(directBillingRef?.currentBillingPhase) === "trial"
    && parseHostedBillingPlanCode(directBillingRef?.currentBillingPlanCode)
      === "launch_monthly"
    && Boolean(directBillingRef?.stripeCustomerId)
    && Boolean(directBillingRef?.stripeSubscriptionId)
      ? {
          includedPulseSeats: HOSTED_FAMILY_PLAN_DISPLAY.minSeats,
          monthlyAmountUsdCents:
            HOSTED_FAMILY_PLAN_DISPLAY.minSeats
            * HOSTED_FAMILY_PLAN_DISPLAY.recurringAmountUsdCentsPerSeat,
          perSeatMonthlyAmountUsdCents:
            HOSTED_FAMILY_PLAN_DISPLAY.recurringAmountUsdCentsPerSeat,
          trialEndsImmediately: true as const,
        }
      : null;
  if (!snapshot) {
    return {
      activeTrialConversion,
      billingActive: false,
      billingStatus: "none",
      members: [],
      owner: false,
      pendingInvites: [],
      plans: emptyHostedRuntimeFamilyPlanPlans(),
      seats: emptyHostedRuntimeFamilyPlanSeatStatus(),
    };
  }

  return {
    activeTrialConversion,
    billingActive: snapshot.billingActive,
    billingStatus: snapshot.billingStatus,
    members: snapshot.members.map((member) => ({
      isOwner: member.isOwner,
      label: member.label,
      planCode: member.planCode,
      role: member.role,
      status: member.status,
    })),
    owner: true,
    pendingInvites: snapshot.invites.map(projectHostedRuntimeFamilyPlanToolInvite),
    plans: snapshot.plans,
    seats: snapshot.seats,
  };
}

function projectHostedRuntimeFamilyPlanToolInvite(input: {
  acceptUrl: string | null;
  expiresAt: Date;
  planCode: HostedFamilyPlanCode;
  status: string;
  targetLabel: string | null;
  targetPhoneHint: string | null;
  telegramInviteUrl: string | null;
}): HostedRuntimeFamilyPlanToolInvite {
  return {
    acceptUrl: input.acceptUrl,
    expiresAt: input.expiresAt.toISOString(),
    planCode: input.planCode,
    status: input.status,
    targetLabel: input.targetLabel,
    targetPhoneHint: input.targetPhoneHint,
    telegramInviteUrl: input.telegramInviteUrl,
  };
}

function emptyHostedRuntimeFamilyPlanPlans() {
  return {
    edge: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
    max: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
    pulse: {
      active: 0,
      billed: HOSTED_FAMILY_MIN_SEATS,
      invited: 0,
      remaining: HOSTED_FAMILY_MIN_SEATS,
      used: 0,
    },
  };
}

function emptyHostedRuntimeFamilyPlanSeatStatus(): HostedRuntimeFamilyPlanToolSeatStatus {
  return {
    active: 0,
    billed: HOSTED_FAMILY_MIN_SEATS,
    invited: 0,
    max: HOSTED_FAMILY_MAX_SEATS,
    min: HOSTED_FAMILY_MIN_SEATS,
    remaining: HOSTED_FAMILY_MIN_SEATS,
    used: 0,
  };
}
