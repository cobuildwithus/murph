import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedFamilyBillingCheckout: vi.fn(),
  ensureHostedAccountGroupForOwnerTx: vi.fn(),
  getPrisma: vi.fn(),
  issueHostedFamilyInviteFromOwnerTx: vi.fn(),
  isHostedThreadContainerMember: vi.fn(),
  readHostedFamilyAccessForMember: vi.fn(),
  readHostedFamilyOwnerSnapshotForMember: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  revokeHostedFamilyInvite: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  createHostedFamilyBillingCheckout: mocks.createHostedFamilyBillingCheckout,
  ensureHostedAccountGroupForOwnerTx: mocks.ensureHostedAccountGroupForOwnerTx,
  issueHostedFamilyInviteFromOwnerTx: mocks.issueHostedFamilyInviteFromOwnerTx,
  readHostedFamilyAccessForMember: mocks.readHostedFamilyAccessForMember,
  readHostedFamilyOwnerSnapshotForMember: mocks.readHostedFamilyOwnerSnapshotForMember,
  revokeHostedFamilyInvite: mocks.revokeHostedFamilyInvite,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: {},
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  isHostedThreadContainerMember: mocks.isHostedThreadContainerMember,
}));

import {
  handleHostedRuntimeFamilyPlanTool,
} from "@/src/lib/hosted-execution/family-plan-tool";

describe("hosted runtime Family plan tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({
      $transaction: vi.fn((callback) => callback({ label: "tx" })),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: "active",
          suspendedAt: null,
        }),
      },
    });
    mocks.ensureHostedAccountGroupForOwnerTx.mockResolvedValue({
      billingStatus: "not_started",
      id: "hbag_family",
      ownerMemberId: "member_owner",
    });
    mocks.createHostedFamilyBillingCheckout.mockResolvedValue({
      alreadyActive: false,
      url: "https://checkout.stripe.test/family",
    });
    mocks.readHostedFamilyAccessForMember.mockResolvedValue(null);
    mocks.issueHostedFamilyInviteFromOwnerTx.mockResolvedValue({
      group: {
        id: "hbag_family",
      },
      invite: {
        expiresAt: new Date("2026-06-25T00:00:00.000Z"),
        id: "hbagi_adam",
        planCode: "pulse",
        status: "pending",
        targetLabel: "Adam",
        targetPhoneHint: null,
      },
      replyText: "Done. I prepared a Murph Family invite for Adam.",
    });
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(null);
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(null);
    mocks.isHostedThreadContainerMember.mockResolvedValue(false);
  });

  it("rejects Family account operations for a synthetic group container", async () => {
    mocks.isHostedThreadContainerMember.mockResolvedValue(true);

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_group_container",
      request: {
        action: "start_checkout",
      },
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_PERSONAL_MEMBER_REQUIRED",
      httpStatus: 403,
    });

    expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
    expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
    expect(mocks.readHostedFamilyOwnerSnapshotForMember).not.toHaveBeenCalled();
  });

  it.each([[true, "revoked"], [false, "nothing_pending"]] as const)(
    "revokes the exact invite as the signed owner and reports %s",
    async (revoked, status) => {
      mocks.revokeHostedFamilyInvite.mockResolvedValueOnce(revoked);
      await expect(handleHostedRuntimeFamilyPlanTool({
        memberId: "member_owner",
        request: { action: "revoke_invite", inviteId: "invite_maya" },
      })).resolves.toEqual({ action: "revoke_invite", result: { status } });
      expect(mocks.revokeHostedFamilyInvite).toHaveBeenCalledWith({
        inviteId: "invite_maya", ownerMemberId: "member_owner",
      });
    },
  );

  it("refuses to revoke a Family invite from a group container", async () => {
    mocks.isHostedThreadContainerMember.mockResolvedValue(true);
    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_group_container",
      request: { action: "revoke_invite", inviteId: "invite_maya" },
    })).rejects.toMatchObject({ httpStatus: 403 });
    expect(mocks.revokeHostedFamilyInvite).not.toHaveBeenCalled();
  });

  it("includes exact pending invite IDs only when the runner requests them", async () => {
    const pending = {
      id: "invite_maya", planCode: "pulse", status: "pending", targetLabel: "Maya",
      acceptUrl: null, expiresAt: new Date("2028-06-25T00:00:00.000Z"),
      targetPhoneHint: null, telegramInviteUrl: null,
    };
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
      billingActive: true, billingStatus: "active", members: [],
      invites: [pending, { ...pending, id: "invite_leo", status: "revoked" }],
    });
    const read = (includeInviteIds?: boolean) => handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner", request: { action: "read_status" }, includeInviteIds,
    });
    const legacy = await read();
    const current = await read(true);
    expect(legacy).toMatchObject({ result: { pendingInvites: [{ status: "pending" }, { status: "revoked" }] } });
    expect(JSON.stringify(legacy)).not.toContain("inviteId");
    expect(current).toMatchObject({ result: { pendingInvites: [{ inviteId: "invite_maya" }, { status: "revoked" }] } });
    expect(JSON.stringify(current)).not.toContain("invite_leo");
  });

  it("starts checkout for an owner without an active Family plan", async () => {
    mocks.readHostedFamilyOwnerSnapshotForMember
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        billingActive: false,
        billingStatus: "not_started",
        plans: {
          edge: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
          pulse: { active: 1, billed: 2, invited: 0, remaining: 1, used: 1 },
        },
        seats: {
          active: 1,
          billed: 2,
          invited: 0,
          max: 6,
          min: 2,
          remaining: 1,
          used: 1,
        },
      });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "start_checkout",
      },
    })).resolves.toEqual({
      action: "start_checkout",
      result: {
        alreadyActive: false,
        billingActive: false,
        billingStatus: "not_started",
        checkoutUrl: "https://checkout.stripe.test/family",
        owner: true,
        plans: {
          edge: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
          pulse: { active: 1, billed: 2, invited: 0, remaining: 1, used: 1 },
        },
        seats: {
          active: 1,
          billed: 2,
          invited: 0,
          max: 6,
          min: 2,
          remaining: 1,
          used: 1,
        },
        unavailableReason: null,
      },
    });

    expect(mocks.readHostedFamilyAccessForMember).toHaveBeenCalledWith({
      memberId: "member_owner",
      prisma: expect.any(Object),
    });
    expect(mocks.ensureHostedAccountGroupForOwnerTx).toHaveBeenCalledWith({
      ownerMemberId: "member_owner",
      tx: {
        label: "tx",
      },
    });
    expect(mocks.createHostedFamilyBillingCheckout).toHaveBeenCalledWith({
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: expect.any(Object),
    });
    expect(mocks.issueHostedFamilyInviteFromOwnerTx).not.toHaveBeenCalled();
  });

  it("returns authoritative active-trial conversion terms and forwards fresh consent", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      stripeCustomerId: "cus_trial",
      stripeSubscriptionId: "sub_trial",
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: { action: "read_status" },
    })).resolves.toMatchObject({
      action: "read_status",
      result: {
        activeTrialConversion: {
          includedPulseSeats: 2,
          monthlyAmountUsdCents: 1_400,
          perSeatMonthlyAmountUsdCents: 700,
          trialEndsImmediately: true,
        },
      },
    });

    await handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "start_checkout",
        confirmedTrialConversion: true,
      },
    });

    expect(mocks.createHostedFamilyBillingCheckout).toHaveBeenCalledWith({
      confirmedTrialConversion: true,
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: expect.any(Object),
    });
  });

  it("does not create checkout when the owner already has active Family billing", async () => {
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValueOnce({
      billingActive: true,
      billingStatus: "active",
      seats: {
        active: 2,
        billed: 4,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 2,
        used: 2,
      },
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "start_checkout",
      },
    })).resolves.toMatchObject({
      action: "start_checkout",
      result: {
        alreadyActive: true,
        checkoutUrl: null,
      },
    });

    expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
    expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
    expect(mocks.issueHostedFamilyInviteFromOwnerTx).not.toHaveBeenCalled();
  });

  it("creates an email-bound invite from structured runtime input", async () => {
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValueOnce({
      billingActive: true,
      billingStatus: "active",
      invites: [
        {
          acceptUrl: "https://local.withmurph.ai/family/accept/family_token",
          expiresAt: new Date("2026-06-25T00:00:00.000Z"),
          id: "hbagi_adam",
          planCode: "pulse",
          status: "pending",
          targetLabel: "Adam",
          targetPhoneHint: null,
          telegramInviteUrl: null,
        },
      ],
      seats: {
        active: 2,
        billed: 4,
        invited: 1,
        max: 6,
        min: 2,
        remaining: 1,
        used: 3,
      },
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "create_invite",
        invite: {
          targetEmail: "adam@example.com",
          targetLabel: "Adam",
          targetPhoneNumber: null,
          targetTelegramUsername: null,
        },
      },
    })).resolves.toMatchObject({
      action: "create_invite",
      result: {
        invite: {
          acceptUrl: "https://local.withmurph.ai/family/accept/family_token",
          status: "pending",
          targetLabel: "Adam",
        },
      },
    });

    expect(mocks.issueHostedFamilyInviteFromOwnerTx).toHaveBeenCalledWith({
      ownerMemberId: "member_owner",
      planCode: "pulse",
      targetEmail: "adam@example.com",
      targetLabel: "Adam",
      targetPhoneNumber: null,
      targetTelegramUsername: null,
      tx: {
        label: "tx",
      },
    });
  });

  it("does not create checkout for a member already sponsored by another Family plan", async () => {
    mocks.readHostedFamilyAccessForMember.mockResolvedValueOnce({
      groupId: "hbag_other_family",
      status: "active",
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_child",
      request: {
        action: "start_checkout",
      },
    })).resolves.toMatchObject({
      action: "start_checkout",
      result: {
        checkoutUrl: null,
        owner: false,
        unavailableReason: "already_sponsored",
      },
    });

    expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
    expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
  });

  it("does not create checkout for a sponsored member with an inactive owner group", async () => {
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValueOnce({
      billingActive: false,
      billingStatus: "not_started",
      seats: {
        active: 1,
        billed: 0,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 0,
        used: 1,
      },
    });
    mocks.readHostedFamilyAccessForMember.mockResolvedValueOnce({
      groupId: "hbag_other_family",
      status: "active",
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_child",
      request: {
        action: "start_checkout",
      },
    })).resolves.toMatchObject({
      action: "start_checkout",
      result: {
        billingStatus: "not_started",
        checkoutUrl: null,
        owner: false,
        unavailableReason: "already_sponsored",
      },
    });

    expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
    expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
  });
});
