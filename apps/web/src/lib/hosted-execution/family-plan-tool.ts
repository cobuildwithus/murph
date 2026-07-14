import "server-only";

import {
  HOSTED_RUNTIME_FAMILY_PLAN_CONTRACT_VERSION,
} from "@murphai/hosted-execution/runtime-control";
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
  buildHostedRuntimeFamilyActionApprovalRequest,
  consumeHostedRuntimeSensitiveActionApproval,
  requestHostedRuntimeSensitiveActionApproval,
} from "./billing-family-action-approval";
import { createHostedBillingPortalSession } from "../hosted-onboarding/billing-portal-service";

import {
  createHostedFamilyBillingCheckout,
  type HostedFamilyChatInviteResult,
  ensureHostedAccountGroupForOwnerTx,
  readHostedFamilyAccessForMember,
  issueHostedFamilyInviteFromOwnerTx,
  prepareHostedFamilySeatCountChange,
  readHostedFamilyOwnerSnapshotForMember,
  removeHostedFamilyMemberTx,
  revokeHostedFamilyInviteTx,
  updateHostedFamilySeatCount,
} from "@/src/lib/hosted-onboarding/family-plan";
import {
  HOSTED_FAMILY_MAX_SEATS,
  HOSTED_FAMILY_MIN_SEATS,
  HOSTED_FAMILY_SEAT_RECURRING_AMOUNT_USD_CENTS,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  HOSTED_BILLING_TRANSACTION_OPTIONS,
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { requireHostedOnboardingPublicBaseUrl } from "@/src/lib/hosted-onboarding/runtime";
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
        input.request.invite ?? null,
      ),
    };
  }
  if (input.request.action === "cancel_invite") {
    const request = input.request;
    const snapshot = await requireHostedRuntimeFamilyOwnerSnapshot(input.memberId);
    const invite = snapshot.invites.find((row) => row.id === request.inviteId);
    if (!invite) {
      const existing = await getPrisma().hostedAccountGroupInvite.findFirst({
        select: { status: true },
        where: {
          groupId: snapshot.groupId,
          id: request.inviteId,
        },
      });
      if (existing?.status === "revoked") {
        return {
          action: "cancel_invite",
          result: {
            inviteId: request.inviteId,
            status: "unchanged",
          },
        };
      }
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_INVITE_NOT_FOUND",
        httpStatus: 404,
        message: "Pending Family invite not found.",
      });
    }
    const approvalRequest = buildHostedRuntimeFamilyActionApprovalRequest({
      action: "cancel_invite",
      inviteId: request.inviteId,
      returnContactKind: request.returnContactKind ?? null,
      status: projectHostedRuntimeFamilyPlanToolStatus(snapshot),
      targetLabel: invite.targetLabel,
    });
    if (!request.confirmed) {
      return {
        action: "cancel_invite",
        result: {
          presentation: approvalRequest.presentation,
          status: "confirmation_required",
        },
      };
    }
    const approval = await requestHostedRuntimeSensitiveActionApproval({
      memberId: input.memberId,
      prisma: getPrisma(),
      request: approvalRequest,
    });
    if (approval.status !== "approved") {
      return { action: "cancel_invite", result: approval };
    }
    const canceled = await getPrisma().$transaction(async (tx) => {
      const consumedApproval = await consumeHostedRuntimeSensitiveActionApproval({
        approval,
        memberId: input.memberId,
        prisma: tx,
        request: approvalRequest,
      });
      if (consumedApproval.status !== "approved") {
        return consumedApproval;
      }
      return await revokeHostedFamilyInviteTx({
        groupId: snapshot.groupId,
        inviteId: request.inviteId,
        ownerMemberId: input.memberId,
        tx,
      });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    if (typeof canceled !== "boolean") {
      return { action: "cancel_invite", result: canceled };
    }
    if (!canceled) {
      const existing = await getPrisma().hostedAccountGroupInvite.findFirst({
        select: { status: true },
        where: {
          groupId: snapshot.groupId,
          id: request.inviteId,
        },
      });
      if (existing?.status === "revoked") {
        return {
          action: "cancel_invite",
          result: {
            inviteId: request.inviteId,
            status: "unchanged",
          },
        };
      }
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_INVITE_NOT_FOUND",
        httpStatus: 404,
        message: "Pending Family invite not found.",
      });
    }
    return {
      action: "cancel_invite",
      result: {
        inviteId: request.inviteId,
        status: "canceled",
      },
    };
  }
  if (input.request.action === "remove_member") {
    const request = input.request;
    const snapshot = await requireHostedRuntimeFamilyOwnerSnapshot(input.memberId);
    const member = snapshot.members.find((row) =>
      row.memberId === request.memberId && !row.isOwner
    );
    if (!member) {
      const existing = await getPrisma().hostedAccountGroupMembership.findFirst({
        select: { status: true },
        where: {
          groupId: snapshot.groupId,
          memberId: request.memberId,
        },
      });
      if (existing?.status === "removed") {
        return {
          action: "remove_member",
          result: {
            memberId: request.memberId,
            status: "unchanged",
          },
        };
      }
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_MEMBER_NOT_FOUND",
        httpStatus: 404,
        message: "Active sponsored Family member not found.",
      });
    }
    const approvalRequest = buildHostedRuntimeFamilyActionApprovalRequest({
      action: "remove_member",
      memberId: request.memberId,
      returnContactKind: request.returnContactKind ?? null,
      status: projectHostedRuntimeFamilyPlanToolStatus(snapshot),
      targetLabel: member.label,
    });
    if (!request.confirmed) {
      return {
        action: "remove_member",
        result: {
          presentation: approvalRequest.presentation,
          status: "confirmation_required",
        },
      };
    }
    const approval = await requestHostedRuntimeSensitiveActionApproval({
      memberId: input.memberId,
      prisma: getPrisma(),
      request: approvalRequest,
    });
    if (approval.status !== "approved") {
      return { action: "remove_member", result: approval };
    }
    const removed = await getPrisma().$transaction(async (tx) => {
      const consumedApproval = await consumeHostedRuntimeSensitiveActionApproval({
        approval,
        memberId: input.memberId,
        prisma: tx,
        request: approvalRequest,
      });
      if (consumedApproval.status !== "approved") {
        return consumedApproval;
      }
      return await removeHostedFamilyMemberTx({
        groupId: snapshot.groupId,
        memberId: request.memberId,
        ownerMemberId: input.memberId,
        tx,
      });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    if (typeof removed !== "boolean") {
      return { action: "remove_member", result: removed };
    }
    if (!removed) {
      const existing = await getPrisma().hostedAccountGroupMembership.findFirst({
        select: { status: true },
        where: {
          groupId: snapshot.groupId,
          memberId: request.memberId,
        },
      });
      if (existing?.status === "removed") {
        return {
          action: "remove_member",
          result: {
            memberId: request.memberId,
            status: "unchanged",
          },
        };
      }
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_MEMBER_NOT_FOUND",
        httpStatus: 404,
        message: "Active sponsored Family member not found.",
      });
    }
    return {
      action: "remove_member",
      result: {
        memberId: request.memberId,
        status: "removed",
      },
    };
  }
  if (input.request.action === "change_seat_count") {
    const request = input.request;
    const prisma = getPrisma();
    const snapshot = await requireHostedRuntimeFamilyOwnerSnapshot(
      input.memberId,
      prisma,
    );
    if (!snapshot.billingActive || request.seatCount < snapshot.seats.used) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_SEAT_COUNT_UNAVAILABLE",
        httpStatus: 409,
        message: "This Family seat count is not available for the current plan state.",
      });
    }
    const preparation = await prepareHostedFamilySeatCountChange({
      groupId: snapshot.groupId,
      ownerMemberId: input.memberId,
      prisma,
      targetSeatCount: request.seatCount,
    });
    const authoritativeStatus = projectHostedRuntimeFamilyPlanToolStatusWithBilledSeatCount(
      snapshot,
      preparation.currentSeatCount,
    );
    if (preparation.currentSeatCount === request.seatCount) {
      return {
        action: "change_seat_count",
        result: {
          requestedSeatCount: request.seatCount,
          seats: authoritativeStatus.seats,
          status: "unchanged",
        },
      };
    }
    const approvalRequest = buildHostedRuntimeFamilyActionApprovalRequest({
      action: "change_seat_count",
      returnContactKind: request.returnContactKind ?? null,
      status: authoritativeStatus,
      targetSeatCount: request.seatCount,
    });
    if (!request.confirmed) {
      return {
        action: "change_seat_count",
        result: {
          presentation: approvalRequest.presentation,
          status: "confirmation_required",
        },
      };
    }
    const approval = await requestHostedRuntimeSensitiveActionApproval({
      memberId: input.memberId,
      prisma,
      request: approvalRequest,
    });
    if (approval.status !== "approved") {
      return { action: "change_seat_count", result: approval };
    }
    const consumedApproval = await consumeHostedRuntimeSensitiveActionApproval({
      approval,
      memberId: input.memberId,
      prisma,
      request: approvalRequest,
    });
    if (consumedApproval.status !== "approved") {
      return { action: "change_seat_count", result: consumedApproval };
    }
    const update = await updateHostedFamilySeatCount({
      expectedCurrentSeatCount: preparation.currentSeatCount,
      groupId: snapshot.groupId,
      ownerMemberId: input.memberId,
      prisma,
      targetSeatCount: request.seatCount,
    });
    if (update.status === "pending_payment") {
      const portal = await createHostedBillingPortalSession({
        billingScope: "family",
        memberId: input.memberId,
        prisma,
        returnUrl: new URL(
          "/settings",
          requireHostedOnboardingPublicBaseUrl(),
        ).toString(),
      });
      return {
        action: "change_seat_count",
        result: {
          requestedSeatCount: request.seatCount,
          seats: update.snapshot.seats,
          status: "browser_handoff",
          url: portal.url,
        },
      };
    }
    const applied = update.snapshot.seats.billed === request.seatCount;
    return {
      action: "change_seat_count",
      result: {
        requestedSeatCount: request.seatCount,
        seats: update.snapshot.seats,
        status: applied ? "applied" : "pending",
      },
    };
  }
  const request = input.request;

  return await getPrisma().$transaction(async (tx) => {
    const invite = await issueHostedFamilyInviteFromOwnerTx({
      ownerMemberId: input.memberId,
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
          id: invite.invite.id,
          status: invite.invite.status,
          targetLabel: invite.invite.targetLabel,
          targetPhoneHint: invite.invite.targetPhoneHint,
          telegramInviteUrl: null,
        }),
        replyText: invite.replyText,
        seats: snapshot?.seats ?? emptyHostedRuntimeFamilyPlanSeatStatus(),
      },
    };
  }, HOSTED_BILLING_TRANSACTION_OPTIONS);
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
          targetEmail: inviteRequest.targetEmail ?? null,
          targetLabel: inviteRequest.targetLabel ?? null,
          targetPhoneNumber: inviteRequest.targetPhoneNumber ?? null,
          targetTelegramUsername: inviteRequest.targetTelegramUsername ?? null,
          tx,
        });
      }, HOSTED_BILLING_TRANSACTION_OPTIONS);
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
      preparedInvite: null,
      preparedInviteReplyText: null,
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
    directPaidUpgradeMode: "settings_handoff",
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
    preparedInvite: null,
    preparedInviteReplyText: null,
    seats: snapshot?.seats ?? emptyHostedRuntimeFamilyPlanSeatStatus(),
    unavailableReason: null,
  };
}

export function projectHostedRuntimeFamilyPlanToolResponseForContract(
  response: HostedRuntimeFamilyPlanToolResponse,
  contractVersion: HostedRuntimeFamilyPlanToolRequest["contractVersion"],
): HostedRuntimeFamilyPlanToolResponse {
  if (contractVersion === HOSTED_RUNTIME_FAMILY_PLAN_CONTRACT_VERSION) {
    return response;
  }
  if (response.action === "read_status") {
    return {
      action: response.action,
      result: projectLegacyHostedRuntimeFamilyPlanStatus(response.result),
    };
  }
  if (response.action === "create_invite") {
    return {
      action: response.action,
      result: {
        invite: projectLegacyHostedRuntimeFamilyPlanInvite(response.result.invite),
        replyText: response.result.replyText,
        seats: response.result.seats,
      },
    };
  }
  if (response.action === "start_checkout") {
    return {
      action: response.action,
      result: {
        ...response.result,
        preparedInvite: response.result.preparedInvite
          ? projectLegacyHostedRuntimeFamilyPlanInvite(response.result.preparedInvite)
          : null,
      },
    };
  }
  return response;
}

function projectLegacyHostedRuntimeFamilyPlanStatus(
  status: HostedRuntimeFamilyPlanToolStatusResponse,
): HostedRuntimeFamilyPlanToolStatusResponse {
  return {
    billingActive: status.billingActive,
    billingStatus: status.billingStatus,
    members: status.members.map((member) => ({
      isOwner: member.isOwner,
      label: member.label,
      role: member.role,
      status: member.status,
    })),
    owner: status.owner,
    pendingInvites: status.pendingInvites.map(projectLegacyHostedRuntimeFamilyPlanInvite),
    seats: status.seats,
  };
}

function projectLegacyHostedRuntimeFamilyPlanInvite(
  invite: HostedRuntimeFamilyPlanToolInvite,
): HostedRuntimeFamilyPlanToolInvite {
  return {
    acceptUrl: invite.acceptUrl,
    expiresAt: invite.expiresAt,
    status: invite.status,
    targetLabel: invite.targetLabel,
    targetPhoneHint: invite.targetPhoneHint,
    telegramInviteUrl: invite.telegramInviteUrl,
  };
}

function projectHostedRuntimeFamilyPlanToolStatusWithBilledSeatCount(
  snapshot: NonNullable<Awaited<ReturnType<typeof readHostedFamilyOwnerSnapshotForMember>>>,
  billedSeatCount: number,
): HostedRuntimeFamilyPlanToolStatusResponse {
  const status = projectHostedRuntimeFamilyPlanToolStatus(snapshot);
  return {
    ...status,
    pricing: {
      ...status.pricing,
      currency: "USD",
      currentRecurringAmountUsdCents:
        billedSeatCount * HOSTED_FAMILY_SEAT_RECURRING_AMOUNT_USD_CENTS,
      interval: "month",
      recurringAmountUsdCentsPerSeat:
        HOSTED_FAMILY_SEAT_RECURRING_AMOUNT_USD_CENTS,
      seatDecreaseTiming: "immediate_without_proration",
      seatIncreaseTiming: "immediate_with_proration_and_immediate_invoice",
    },
    seats: {
      ...status.seats,
      billed: billedSeatCount,
      remaining: Math.max(0, billedSeatCount - status.seats.used),
    },
  };
}

async function readHostedRuntimeFamilyPlanToolStatus(
  memberId: string,
): Promise<HostedRuntimeFamilyPlanToolStatusResponse> {
  const snapshot = await readHostedFamilyOwnerSnapshotForMember({
    memberId,
  });
  if (!snapshot) {
    return projectHostedRuntimeFamilyPlanToolStatus(null);
  }

  return projectHostedRuntimeFamilyPlanToolStatus(snapshot);
}

function projectHostedRuntimeFamilyPlanToolStatus(
  snapshot: Awaited<ReturnType<typeof readHostedFamilyOwnerSnapshotForMember>>,
): HostedRuntimeFamilyPlanToolStatusResponse {
  const seats = snapshot?.seats ?? emptyHostedRuntimeFamilyPlanSeatStatus();
  return {
    billingActive: snapshot?.billingActive ?? false,
    billingStatus: snapshot?.billingStatus ?? "none",
    members: snapshot?.members.map((member) => ({
      isOwner: member.isOwner,
      label: member.label,
      memberId: member.memberId,
      role: member.role,
      status: member.status,
    })) ?? [],
    owner: snapshot !== null,
    pendingInvites:
      snapshot?.invites.map(projectHostedRuntimeFamilyPlanToolInvite) ?? [],
    pricing: {
      currency: "USD",
      currentRecurringAmountUsdCents: snapshot?.billingActive
        ? seats.billed * HOSTED_FAMILY_SEAT_RECURRING_AMOUNT_USD_CENTS
        : 0,
      interval: "month",
      recurringAmountUsdCentsPerSeat:
        HOSTED_FAMILY_SEAT_RECURRING_AMOUNT_USD_CENTS,
      seatDecreaseTiming: "immediate_without_proration",
      seatIncreaseTiming: "immediate_with_proration_and_immediate_invoice",
    },
    seats,
  };
}

function projectHostedRuntimeFamilyPlanToolInvite(input: {
  acceptUrl: string | null;
  expiresAt: Date;
  id: string;
  status: string;
  targetLabel: string | null;
  targetPhoneHint: string | null;
  telegramInviteUrl: string | null;
}): HostedRuntimeFamilyPlanToolInvite {
  return {
    acceptUrl: input.acceptUrl,
    expiresAt: input.expiresAt.toISOString(),
    inviteId: input.id,
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
    id: prepared.invite.id,
    status: prepared.invite.status,
    targetLabel: prepared.invite.targetLabel,
    targetPhoneHint: prepared.invite.targetPhoneHint,
    telegramInviteUrl: null,
  });
}

async function requireHostedRuntimeFamilyOwnerSnapshot(
  memberId: string,
  prisma = getPrisma(),
) {
  const snapshot = await readHostedFamilyOwnerSnapshotForMember({
    memberId,
    prisma,
  });
  if (!snapshot) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_OWNER_NOT_FOUND",
      httpStatus: 403,
      message: "Only the Family plan owner can manage Family members and seats.",
    });
  }
  return snapshot;
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
