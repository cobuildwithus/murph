import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedFamilyBillingCheckout: vi.fn(),
  ensureHostedAccountGroupForOwnerTx: vi.fn(),
  getPrisma: vi.fn(),
  hasActiveHostedFamilyAccess: vi.fn(),
  issueHostedFamilyInviteFromOwnerTx: vi.fn(),
  readHostedFamilyOwnerSnapshotForMember: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  createHostedFamilyBillingCheckout: mocks.createHostedFamilyBillingCheckout,
  ensureHostedAccountGroupForOwnerTx: mocks.ensureHostedAccountGroupForOwnerTx,
  hasActiveHostedFamilyAccess: mocks.hasActiveHostedFamilyAccess,
  HOSTED_FAMILY_MAX_SEATS: 4,
  issueHostedFamilyInviteFromOwnerTx: mocks.issueHostedFamilyInviteFromOwnerTx,
  readHostedFamilyOwnerSnapshotForMember: mocks.readHostedFamilyOwnerSnapshotForMember,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: {},
}));

import {
  handleHostedRuntimeFamilyPlanTool,
} from "@/src/lib/hosted-execution/family-plan-tool";

describe("hosted runtime Family plan tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({
      $transaction: vi.fn((callback) => callback({ label: "tx" })),
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
    mocks.hasActiveHostedFamilyAccess.mockResolvedValue(false);
    mocks.issueHostedFamilyInviteFromOwnerTx.mockResolvedValue({
      group: {
        id: "hbag_family",
      },
      invite: {
        expiresAt: new Date("2026-06-25T00:00:00.000Z"),
        id: "hbagi_adam",
        status: "pending",
        targetLabel: "Adam",
        targetPhoneHint: null,
      },
      replyText: "Done. I prepared a Murph Family invite for Adam.",
    });
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(null);
  });

  it("starts checkout for an owner without an active Family plan", async () => {
    mocks.readHostedFamilyOwnerSnapshotForMember
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        billingActive: false,
        billingStatus: "not_started",
        seats: {
          active: 1,
          invited: 0,
          max: 4,
          remaining: 3,
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
        preparedInvite: null,
        preparedInviteReplyText: null,
        seats: {
          active: 1,
          invited: 0,
          max: 4,
          remaining: 3,
          used: 1,
        },
        unavailableReason: null,
      },
    });

    expect(mocks.hasActiveHostedFamilyAccess).toHaveBeenCalledWith({
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

  it("prepares an invite while starting checkout when the owner supplied an invite target", async () => {
    mocks.readHostedFamilyOwnerSnapshotForMember
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        billingActive: false,
        billingStatus: "not_started",
        invites: [
          {
            acceptUrl: "https://local.withmurph.ai/family/accept/family_token",
            expiresAt: new Date("2026-06-25T00:00:00.000Z"),
            id: "hbagi_adam",
            status: "pending",
            targetLabel: "Adam",
            targetPhoneHint: null,
            telegramInviteUrl: "https://t.me/murphdevbot?start=family_token",
          },
        ],
        seats: {
          active: 1,
          invited: 1,
          max: 4,
          remaining: 2,
          used: 2,
        },
      });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "start_checkout",
        invite: {
          targetLabel: "Adam",
          targetPhoneNumber: null,
          targetTelegramUsername: "adam_username",
        },
      },
    })).resolves.toEqual({
      action: "start_checkout",
      result: {
        alreadyActive: false,
        billingActive: false,
        billingStatus: "not_started",
        checkoutUrl: "https://checkout.stripe.test/family",
        owner: true,
        preparedInvite: {
          acceptUrl: "https://local.withmurph.ai/family/accept/family_token",
          expiresAt: "2026-06-25T00:00:00.000Z",
          status: "pending",
          targetLabel: "Adam",
          targetPhoneHint: null,
          telegramInviteUrl: "https://t.me/murphdevbot?start=family_token",
        },
        preparedInviteReplyText: "Done. I prepared a Murph Family invite for Adam.",
        seats: {
          active: 1,
          invited: 1,
          max: 4,
          remaining: 2,
          used: 2,
        },
        unavailableReason: null,
      },
    });

    expect(mocks.issueHostedFamilyInviteFromOwnerTx).toHaveBeenCalledWith({
      ownerMemberId: "member_owner",
      targetLabel: "Adam",
      targetPhoneNumber: null,
      targetTelegramUsername: "adam_username",
      tx: {
        label: "tx",
      },
    });
  });

  it("does not create checkout when the owner already has active Family billing", async () => {
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValueOnce({
      billingActive: true,
      billingStatus: "active",
      seats: {
        active: 2,
        invited: 0,
        max: 4,
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
        preparedInvite: null,
      },
    });

    expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
    expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
  });

  it("does not create checkout for a member already sponsored by another Family plan", async () => {
    mocks.hasActiveHostedFamilyAccess.mockResolvedValueOnce(true);

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
        preparedInvite: null,
        unavailableReason: "already_sponsored",
      },
    });

    expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
    expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
  });
});
