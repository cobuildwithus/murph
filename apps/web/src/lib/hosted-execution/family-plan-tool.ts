import "server-only";

import type {
  HostedRuntimeFamilyPlanCreateInviteRequest,
  HostedRuntimeFamilyPlanToolInvite,
  HostedRuntimeFamilyPlanToolRequest,
  HostedRuntimeFamilyPlanToolResponse,
  HostedRuntimeFamilyPlanToolSeatStatus,
  HostedRuntimeFamilyPlanToolStartCheckoutResponse,
  HostedRuntimeFamilyPlanToolStatusResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  createHostedFamilyBillingCheckout,
  type HostedFamilyChatInviteResult,
  ensureHostedAccountGroupForOwnerTx,
  hasActiveHostedFamilyAccess,
  issueHostedFamilyInviteFromOwnerTx,
  readHostedFamilyOwnerSnapshotForMember,
} from "@/src/lib/hosted-onboarding/family-plan";
import {
  HOSTED_FAMILY_MAX_SEATS,
  HOSTED_FAMILY_MIN_SEATS,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

export async function handleHostedRuntimeFamilyPlanTool(input: {
  memberId: string;
  request: HostedRuntimeFamilyPlanToolRequest;
}): Promise<HostedRuntimeFamilyPlanToolResponse> {
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
        input.request.invite ?? null,
      ),
    };
  }
  const request = input.request;

  return await getPrisma().$transaction(async (tx) => {
    const invite = await issueHostedFamilyInviteFromOwnerTx({
      ownerMemberId: input.memberId,
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
          status: invite.invite.status,
          targetLabel: invite.invite.targetLabel,
          targetPhoneHint: invite.invite.targetPhoneHint,
          telegramInviteUrl: null,
        }),
        replyText: invite.replyText,
        seats: snapshot?.seats ?? emptyHostedRuntimeFamilyPlanSeatStatus(),
      },
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function startHostedRuntimeFamilyPlanCheckout(
  memberId: string,
  inviteRequest: HostedRuntimeFamilyPlanCreateInviteRequest | null,
): Promise<HostedRuntimeFamilyPlanToolStartCheckoutResponse> {
  const prisma = getPrisma();
  const ownerSnapshot = await readHostedFamilyOwnerSnapshotForMember({
    memberId,
    prisma,
  });
  if (ownerSnapshot?.billingActive) {
    if (inviteRequest) {
      const prepared = await prisma.$transaction(async (tx) => {
        return await issueHostedFamilyInviteFromOwnerTx({
          ownerMemberId: memberId,
          targetLabel: inviteRequest.targetLabel ?? null,
          targetPhoneNumber: inviteRequest.targetPhoneNumber ?? null,
          targetTelegramUsername: inviteRequest.targetTelegramUsername ?? null,
          tx,
        });
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
      const refreshedSnapshot = await readHostedFamilyOwnerSnapshotForMember({
        memberId,
        prisma,
      });

      return {
        alreadyActive: true,
        billingActive: true,
        billingStatus: refreshedSnapshot?.billingStatus ?? ownerSnapshot.billingStatus,
        checkoutUrl: null,
        owner: true,
        preparedInvite: projectPreparedHostedRuntimeFamilyPlanToolInvite(
          prepared,
          refreshedSnapshot,
        ),
        preparedInviteReplyText: prepared.replyText,
        seats: refreshedSnapshot?.seats ?? ownerSnapshot.seats,
        unavailableReason: null,
      };
    }

    return {
      alreadyActive: true,
      billingActive: true,
      billingStatus: ownerSnapshot.billingStatus,
      checkoutUrl: null,
      owner: true,
      preparedInvite: null,
      preparedInviteReplyText: null,
      seats: ownerSnapshot.seats,
      unavailableReason: null,
    };
  }

  if (!ownerSnapshot && await hasActiveHostedFamilyAccess({
    memberId,
    prisma,
  })) {
    return {
      alreadyActive: false,
      billingActive: false,
      billingStatus: "none",
      checkoutUrl: null,
      owner: false,
      preparedInvite: null,
      preparedInviteReplyText: null,
      seats: emptyHostedRuntimeFamilyPlanSeatStatus(),
      unavailableReason: "already_sponsored",
    };
  }

  const preparation = await prisma.$transaction(async (tx) => {
    const group = await ensureHostedAccountGroupForOwnerTx({
      ownerMemberId: memberId,
      tx,
    });
    const preparedInvite = inviteRequest
      ? await issueHostedFamilyInviteFromOwnerTx({
          ownerMemberId: memberId,
          targetLabel: inviteRequest.targetLabel ?? null,
          targetPhoneNumber: inviteRequest.targetPhoneNumber ?? null,
          targetTelegramUsername: inviteRequest.targetTelegramUsername ?? null,
          tx,
        })
      : null;

    return {
      group,
      preparedInvite,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  const checkout = await createHostedFamilyBillingCheckout({
    groupId: preparation.group.id,
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
    billingStatus: snapshot?.billingStatus ?? preparation.group.billingStatus,
    checkoutUrl: checkout.url,
    owner: true,
    preparedInvite: preparation.preparedInvite
      ? projectPreparedHostedRuntimeFamilyPlanToolInvite(
          preparation.preparedInvite,
          snapshot,
        )
      : null,
    preparedInviteReplyText: preparation.preparedInvite?.replyText ?? null,
    seats: snapshot?.seats ?? emptyHostedRuntimeFamilyPlanSeatStatus(),
    unavailableReason: null,
  };
}

async function readHostedRuntimeFamilyPlanToolStatus(
  memberId: string,
): Promise<HostedRuntimeFamilyPlanToolStatusResponse> {
  const snapshot = await readHostedFamilyOwnerSnapshotForMember({
    memberId,
  });
  if (!snapshot) {
    return {
      billingActive: false,
      billingStatus: "none",
      members: [],
      owner: false,
      pendingInvites: [],
      seats: emptyHostedRuntimeFamilyPlanSeatStatus(),
    };
  }

  return {
    billingActive: snapshot.billingActive,
    billingStatus: snapshot.billingStatus,
    members: snapshot.members.map((member) => ({
      isOwner: member.isOwner,
      label: member.label,
      role: member.role,
      status: member.status,
    })),
    owner: true,
    pendingInvites: snapshot.invites.map(projectHostedRuntimeFamilyPlanToolInvite),
    seats: snapshot.seats,
  };
}

function projectHostedRuntimeFamilyPlanToolInvite(input: {
  acceptUrl: string | null;
  expiresAt: Date;
  status: string;
  targetLabel: string | null;
  targetPhoneHint: string | null;
  telegramInviteUrl: string | null;
}): HostedRuntimeFamilyPlanToolInvite {
  return {
    acceptUrl: input.acceptUrl,
    expiresAt: input.expiresAt.toISOString(),
    status: input.status,
    targetLabel: input.targetLabel,
    targetPhoneHint: input.targetPhoneHint,
    telegramInviteUrl: input.telegramInviteUrl,
  };
}

function projectPreparedHostedRuntimeFamilyPlanToolInvite(
  prepared: HostedFamilyChatInviteResult,
  snapshot: { invites: Array<{
    acceptUrl: string | null;
    expiresAt: Date;
    id: string;
    status: string;
    targetLabel: string | null;
    targetPhoneHint: string | null;
    telegramInviteUrl: string | null;
  }> } | null | undefined,
): HostedRuntimeFamilyPlanToolInvite {
  const snapshotInvite = snapshot?.invites.find(
    (row) => row.id === prepared.invite.id,
  );
  return projectHostedRuntimeFamilyPlanToolInvite(snapshotInvite ?? {
    acceptUrl: null,
    expiresAt: prepared.invite.expiresAt,
    status: prepared.invite.status,
    targetLabel: prepared.invite.targetLabel,
    targetPhoneHint: prepared.invite.targetPhoneHint,
    telegramInviteUrl: null,
  });
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
