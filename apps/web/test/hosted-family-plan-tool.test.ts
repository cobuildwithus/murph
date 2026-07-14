import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  billingTransactionOptions: { maxWait: 5_000, timeout: 780_000 },
  consumeHostedActionApproval: vi.fn(),
  createHostedBillingPortalSession: vi.fn(),
  createHostedFamilyBillingCheckout: vi.fn(),
  ensureHostedAccountGroupForOwnerTx: vi.fn(),
  getPrisma: vi.fn(),
  issueHostedFamilyInviteFromOwnerTx: vi.fn(),
  prepareHostedFamilySeatCountChange: vi.fn(),
  isHostedThreadContainerMember: vi.fn(),
  readHostedFamilyAccessForMember: vi.fn(),
  readHostedFamilyOwnerSnapshotForMember: vi.fn(),
  requestHostedActionApproval: vi.fn(),
  removeHostedFamilyMemberTx: vi.fn(),
  revokeHostedFamilyInviteTx: vi.fn(),
  updateHostedFamilySeatCount: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/billing-portal-service", () => ({
  createHostedBillingPortalSession: mocks.createHostedBillingPortalSession,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingPublicBaseUrl: vi.fn(() => "https://app.example.test"),
}));

vi.mock("@/src/lib/action-approvals", () => ({
  consumeHostedActionApproval: mocks.consumeHostedActionApproval,
  requestHostedActionApproval: mocks.requestHostedActionApproval,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  createHostedFamilyBillingCheckout: mocks.createHostedFamilyBillingCheckout,
  ensureHostedAccountGroupForOwnerTx: mocks.ensureHostedAccountGroupForOwnerTx,
  issueHostedFamilyInviteFromOwnerTx: mocks.issueHostedFamilyInviteFromOwnerTx,
  prepareHostedFamilySeatCountChange: mocks.prepareHostedFamilySeatCountChange,
  readHostedFamilyAccessForMember: mocks.readHostedFamilyAccessForMember,
  readHostedFamilyOwnerSnapshotForMember: mocks.readHostedFamilyOwnerSnapshotForMember,
  removeHostedFamilyMemberTx: mocks.removeHostedFamilyMemberTx,
  revokeHostedFamilyInviteTx: mocks.revokeHostedFamilyInviteTx,
  updateHostedFamilySeatCount: mocks.updateHostedFamilySeatCount,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  HOSTED_BILLING_TRANSACTION_OPTIONS: mocks.billingTransactionOptions,
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: {},
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  isHostedThreadContainerMember: mocks.isHostedThreadContainerMember,
}));

import {
  handleHostedRuntimeFamilyPlanTool,
  projectHostedRuntimeFamilyPlanToolResponseForContract,
} from "@/src/lib/hosted-execution/family-plan-tool";

describe("hosted runtime Family plan tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback) => callback({ label: "tx" }));
    mocks.getPrisma.mockReturnValue({
      $transaction: mocks.transaction,
      hostedAccountGroupInvite: { findFirst: vi.fn() },
      hostedAccountGroupMembership: { findFirst: vi.fn() },
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
    mocks.createHostedBillingPortalSession.mockResolvedValue({
      url: "https://stripe.example.test/family-portal",
    });
    mocks.readHostedFamilyAccessForMember.mockResolvedValue(null);
    mocks.prepareHostedFamilySeatCountChange.mockResolvedValue({
      currentSeatCount: 3,
      liveMutationRevision: 7,
    });
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
    mocks.removeHostedFamilyMemberTx.mockResolvedValue(true);
    mocks.revokeHostedFamilyInviteTx.mockResolvedValue(true);
    const approved = {
      approvalGeneration: "a".repeat(64),
      approvalId: `haa_${"b".repeat(32)}`,
      status: "approved" as const,
    };
    mocks.requestHostedActionApproval.mockResolvedValue(approved);
    mocks.consumeHostedActionApproval.mockResolvedValue(approved);
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

  it("starts checkout for an owner without an active Family plan", async () => {
    mocks.readHostedFamilyOwnerSnapshotForMember
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        billingActive: false,
        billingStatus: "not_started",
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
        preparedInvite: null,
        preparedInviteReplyText: null,
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
      directPaidUpgradeMode: "settings_handoff",
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: expect.any(Object),
    });
    expect(mocks.issueHostedFamilyInviteFromOwnerTx).not.toHaveBeenCalled();
  });

  it("does not prepare an invite while starting checkout before billing is active", async () => {
    mocks.readHostedFamilyOwnerSnapshotForMember
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
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
        preparedInvite: null,
        preparedInviteReplyText: null,
        seats: {
          active: 1,
          billed: 0,
          invited: 0,
          max: 6,
          min: 2,
          remaining: 0,
          used: 1,
        },
        unavailableReason: null,
      },
    });

    expect(mocks.createHostedFamilyBillingCheckout).toHaveBeenCalledWith({
      directPaidUpgradeMode: "settings_handoff",
      groupId: "hbag_family",
      ownerMemberId: "member_owner",
      prisma: expect.any(Object),
    });
    expect(mocks.issueHostedFamilyInviteFromOwnerTx).not.toHaveBeenCalled();
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
        preparedInvite: null,
      },
    });

    expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
    expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
  });

  it("creates an invite from start_checkout when Family billing is already active", async () => {
    mocks.readHostedFamilyOwnerSnapshotForMember
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        billingActive: true,
        billingStatus: "active",
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
        alreadyActive: true,
        billingActive: true,
        billingStatus: "active",
        checkoutUrl: null,
        owner: true,
        preparedInvite: {
          acceptUrl: "https://local.withmurph.ai/family/accept/family_token",
          expiresAt: "2026-06-25T00:00:00.000Z",
          inviteId: "hbagi_adam",
          status: "pending",
          targetLabel: "Adam",
          targetPhoneHint: null,
          telegramInviteUrl: "https://t.me/murphdevbot?start=family_token",
        },
        preparedInviteReplyText: "Done. I prepared a Murph Family invite for Adam.",
        seats: {
          active: 2,
          billed: 4,
          invited: 1,
          max: 6,
          min: 2,
          remaining: 1,
          used: 3,
        },
        unavailableReason: null,
      },
    });

    expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
    expect(mocks.issueHostedFamilyInviteFromOwnerTx).toHaveBeenCalledWith({
      ownerMemberId: "member_owner",
      targetEmail: null,
      targetLabel: "Adam",
      targetPhoneNumber: null,
      targetTelegramUsername: "adam_username",
      tx: {
        label: "tx",
      },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      mocks.billingTransactionOptions,
    );
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
      targetEmail: "adam@example.com",
      targetLabel: "Adam",
      targetPhoneNumber: null,
      targetTelegramUsername: null,
      tx: {
        label: "tx",
      },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      mocks.billingTransactionOptions,
    );
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
        preparedInvite: null,
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
        preparedInvite: null,
        unavailableReason: "already_sponsored",
      },
    });

    expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
    expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
  });

  it("returns canonical Family seat pricing, total, and timing semantics", async () => {
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValueOnce({
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [],
      members: [],
      seats: {
        active: 2,
        billed: 3,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 1,
        used: 2,
      },
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: { action: "read_status" },
    })).resolves.toMatchObject({
      action: "read_status",
      result: {
        pricing: {
          currency: "USD",
          currentRecurringAmountUsdCents: 2_100,
          interval: "month",
          recurringAmountUsdCentsPerSeat: 700,
          seatDecreaseTiming: "immediate_without_proration",
          seatIncreaseTiming: "immediate_with_proration_and_immediate_invoice",
        },
      },
    });
  });

  it("previews canonical Family mutation terms without approval or mutation", async () => {
    const snapshot = {
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [{
        acceptUrl: "https://app.example/family/invite/accept",
        expiresAt: new Date("2026-07-17T00:00:00.000Z"),
        id: "invite_pending",
        status: "pending",
        targetLabel: "Family invitee",
        targetPhoneHint: null,
        telegramInviteUrl: null,
      }],
      members: [{
        isOwner: false,
        joinedAt: new Date("2026-07-01T00:00:00.000Z"),
        label: "Family member",
        memberId: "member_sponsored",
        role: "member",
        status: "active",
      }],
      seats: {
        active: 2,
        billed: 3,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 1,
        used: 2,
      },
    };
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(snapshot);

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "change_seat_count",
        confirmed: false,
        seatCount: 4,
      },
    })).resolves.toMatchObject({
      action: "change_seat_count",
      result: {
        presentation: {
          body: expect.stringContaining(
            "3 seats ($21.00 USD per month) to 4 seats ($28.00 USD per month)",
          ),
        },
        status: "confirmation_required",
      },
    });
    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "remove_member",
        confirmed: false,
        memberId: "member_sponsored",
      },
    })).resolves.toMatchObject({
      result: {
        presentation: {
          body: expect.stringContaining(
            "This does not delete their Murph account or private data.",
          ),
        },
        status: "confirmation_required",
      },
    });
    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "cancel_invite",
        confirmed: false,
        inviteId: "invite_pending",
      },
    })).resolves.toMatchObject({
      result: {
        presentation: {
          body: expect.stringContaining(
            "Its acceptance link will stop working. Family seat billing is unchanged.",
          ),
        },
        status: "confirmation_required",
      },
    });
    expect(mocks.requestHostedActionApproval).not.toHaveBeenCalled();
    expect(mocks.consumeHostedActionApproval).not.toHaveBeenCalled();
    expect(mocks.updateHostedFamilySeatCount).not.toHaveBeenCalled();
    expect(mocks.removeHostedFamilyMemberTx).not.toHaveBeenCalled();
    expect(mocks.revokeHostedFamilyInviteTx).not.toHaveBeenCalled();
  });

  it("cancels owner-bound pending invites and reports retries as unchanged", async () => {
    const prisma = mocks.getPrisma();
    const ownerSnapshot = {
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [{
        acceptUrl: "https://app.example/family/invite/accept",
        expiresAt: new Date("2026-07-17T00:00:00.000Z"),
        id: "invite_pending",
        status: "pending",
        targetLabel: "Family member",
        targetPhoneHint: null,
        telegramInviteUrl: null,
      }],
      members: [],
      seats: {
        active: 2,
        billed: 3,
        invited: 1,
        max: 6,
        min: 2,
        remaining: 0,
        used: 3,
      },
    };
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(ownerSnapshot);

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "cancel_invite",
        confirmed: true,
        inviteId: "invite_pending",
      },
    })).resolves.toEqual({
      action: "cancel_invite",
      result: { inviteId: "invite_pending", status: "canceled" },
    });
    expect(mocks.consumeHostedActionApproval.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.revokeHostedFamilyInviteTx.mock.invocationCallOrder[0] ?? 0);

    mocks.revokeHostedFamilyInviteTx.mockResolvedValueOnce(false);
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValueOnce({
      ...ownerSnapshot,
      invites: [],
    });
    prisma.hostedAccountGroupInvite.findFirst.mockResolvedValueOnce({
      status: "revoked",
    });
    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "cancel_invite",
        confirmed: true,
        inviteId: "invite_pending",
      },
    })).resolves.toMatchObject({ result: { status: "unchanged" } });
  });

  it("consumes exact approval before revoking the selected member sponsorship", async () => {
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [],
      members: [{
        isOwner: false,
        joinedAt: new Date("2026-07-01T00:00:00.000Z"),
        label: "Family member",
        memberId: "member_sponsored",
        role: "member",
        status: "active",
      }],
      seats: {
        active: 2,
        billed: 3,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 1,
        used: 2,
      },
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "remove_member",
        confirmed: true,
        memberId: "member_sponsored",
      },
    })).resolves.toEqual({
      action: "remove_member",
      result: { memberId: "member_sponsored", status: "removed" },
    });

    expect(mocks.requestHostedActionApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_owner",
        request: expect.objectContaining({
          actionKind: "family.plan.remove-member.v1",
        }),
      }),
    );
    expect(mocks.consumeHostedActionApproval.mock.invocationCallOrder[0])
      .toBeLessThan(
        mocks.removeHostedFamilyMemberTx.mock.invocationCallOrder[0] ?? 0,
      );
    expect(mocks.removeHostedFamilyMemberTx).toHaveBeenCalledWith({
      expectedJoinedAt: new Date("2026-07-01T00:00:00.000Z"),
      groupId: "hbag_family",
      memberId: "member_sponsored",
      ownerMemberId: "member_owner",
      tx: { label: "tx" },
    });
  });

  it("returns pending immediately from the mutation snapshot without polling webhook state", async () => {
    const initial = {
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [],
      members: [],
      seats: {
        active: 2,
        billed: 3,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 1,
        used: 2,
      },
    };
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(initial);
    mocks.updateHostedFamilySeatCount.mockResolvedValue({
      snapshot: initial,
      status: "applied",
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "change_seat_count",
        confirmed: true,
        seatCount: 4,
      },
    })).resolves.toEqual({
      action: "change_seat_count",
      result: {
        requestedSeatCount: 4,
        seats: initial.seats,
        status: "pending",
      },
    });
    expect(mocks.updateHostedFamilySeatCount).toHaveBeenCalledWith(expect.objectContaining({
      expectedCurrentSeatCount: 3,
      targetSeatCount: 4,
    }));
    expect(mocks.readHostedFamilyOwnerSnapshotForMember).toHaveBeenCalledTimes(1);
  });

  it("returns a Family billing handoff when an increased seat needs payment confirmation", async () => {
    const snapshot = {
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [],
      members: [],
      seats: {
        active: 2,
        billed: 2,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 0,
        used: 2,
      },
    };
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(snapshot);
    mocks.prepareHostedFamilySeatCountChange.mockResolvedValue({
      currentSeatCount: 2,
      liveMutationRevision: 7,
    });
    mocks.updateHostedFamilySeatCount.mockResolvedValue({
      snapshot,
      status: "pending_payment",
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "change_seat_count",
        confirmed: true,
        seatCount: 3,
      },
    })).resolves.toEqual({
      action: "change_seat_count",
      result: {
        requestedSeatCount: 3,
        seats: snapshot.seats,
        status: "browser_handoff",
        url: "https://stripe.example.test/family-portal",
      },
    });

    expect(mocks.createHostedBillingPortalSession).toHaveBeenCalledWith({
      billingScope: "family",
      memberId: "member_owner",
      prisma: expect.any(Object),
      returnUrl: "https://app.example.test/settings",
    });
  });

  it("returns applied when the mutation snapshot already contains the target seat count", async () => {
    const initial = {
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [],
      members: [],
      seats: {
        active: 2,
        billed: 3,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 1,
        used: 2,
      },
    };
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(initial);
    mocks.updateHostedFamilySeatCount.mockResolvedValue({
      snapshot: {
        ...initial,
        seats: {
          ...initial.seats,
          billed: 4,
          remaining: 2,
        },
      },
      status: "applied",
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "change_seat_count",
        confirmed: true,
        seatCount: 4,
      },
    })).resolves.toMatchObject({
      action: "change_seat_count",
      result: {
        requestedSeatCount: 4,
        seats: {
          billed: 4,
        },
        status: "applied",
      },
    });
    expect(mocks.readHostedFamilyOwnerSnapshotForMember).toHaveBeenCalledTimes(1);
  });

  it("requires a fresh exact approval when Family seat state changes", async () => {
    const source = {
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [],
      members: [],
      seats: {
        active: 2,
        billed: 3,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 1,
        used: 2,
      },
    };
    mocks.requestHostedActionApproval.mockResolvedValue({
      approvalId: `haa_${"c".repeat(32)}`,
      approvalUrl: "https://withmurph.ai/approve/seats",
      expiresAt: "2026-07-10T16:15:00.000Z",
      status: "pending",
    });
    mocks.readHostedFamilyOwnerSnapshotForMember
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce({
        ...source,
        seats: { ...source.seats, billed: 2, remaining: 0 },
      });
    mocks.prepareHostedFamilySeatCountChange
      .mockResolvedValueOnce({ currentSeatCount: 3, liveMutationRevision: 7 })
      .mockResolvedValueOnce({ currentSeatCount: 2, liveMutationRevision: 8 });

    for (let index = 0; index < 2; index += 1) {
      await expect(handleHostedRuntimeFamilyPlanTool({
        memberId: "member_owner",
        request: {
          action: "change_seat_count",
          confirmed: true,
          returnContactKind: "telegram",
          seatCount: 4,
        },
      })).resolves.toMatchObject({ result: { status: "approval_required" } });
    }

    const firstRequest = mocks.requestHostedActionApproval.mock.calls[0]?.[0].request;
    const secondRequest = mocks.requestHostedActionApproval.mock.calls[1]?.[0].request;
    expect(firstRequest.actionFingerprint).not.toBe(secondRequest.actionFingerprint);
    expect(firstRequest.presentation.body).toContain("$21.00 USD per month");
    expect(firstRequest.presentation.body).toContain("$28.00 USD per month");
    expect(firstRequest.returnContactKind).toBe("telegram");
    expect(mocks.consumeHostedActionApproval).not.toHaveBeenCalled();
    expect(mocks.updateHostedFamilySeatCount).not.toHaveBeenCalled();
  });

  it("returns an already-applied seat count unchanged without replaying approval", async () => {
    const snapshot = {
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [],
      members: [],
      seats: {
        active: 2,
        billed: 4,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 2,
        used: 2,
      },
    };
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValueOnce(snapshot);
    mocks.prepareHostedFamilySeatCountChange.mockResolvedValueOnce({
      currentSeatCount: 4,
      liveMutationRevision: 8,
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "change_seat_count",
        confirmed: true,
        seatCount: 4,
      },
    })).resolves.toEqual({
      action: "change_seat_count",
      result: {
        requestedSeatCount: 4,
        seats: snapshot.seats,
        status: "unchanged",
      },
    });
    expect(mocks.requestHostedActionApproval).not.toHaveBeenCalled();
    expect(mocks.updateHostedFamilySeatCount).not.toHaveBeenCalled();
  });

  it("uses live Stripe seats for an immediate reversal while the local projection lags", async () => {
    const snapshot = {
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [],
      members: [],
      seats: {
        active: 2,
        billed: 2,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 0,
        used: 2,
      },
    };
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValueOnce(snapshot);
    mocks.prepareHostedFamilySeatCountChange.mockResolvedValueOnce({
      currentSeatCount: 3,
      liveMutationRevision: 7,
    });
    mocks.updateHostedFamilySeatCount.mockResolvedValueOnce({
      snapshot,
      status: "applied",
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "change_seat_count",
        confirmed: true,
        seatCount: 2,
      },
    })).resolves.toMatchObject({
      result: {
        requestedSeatCount: 2,
        status: "applied",
      },
    });
    const approvalRequest = mocks.requestHostedActionApproval.mock.calls[0]?.[0].request;
    expect(approvalRequest.presentation.body).toContain(
      "3 seats ($21.00 USD per month) to 2 seats ($14.00 USD per month)",
    );
    expect(mocks.updateHostedFamilySeatCount).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedCurrentSeatCount: 3,
        expectedMutationRevision: 7,
        targetSeatCount: 2,
      }),
    );
  });

  it("projects exact legacy Family responses for unversioned warm runners", () => {
    const response = {
      action: "read_status" as const,
      result: {
        billingActive: true,
        billingStatus: "active",
        members: [{
          isOwner: false,
          label: "Family member",
          memberId: "member_sponsored",
          role: "member",
          status: "active",
        }],
        owner: true,
        pendingInvites: [{
          acceptUrl: null,
          expiresAt: "2026-07-20T00:00:00.000Z",
          inviteId: "invite_pending",
          status: "pending",
          targetLabel: "Family invitee",
          targetPhoneHint: null,
          telegramInviteUrl: null,
        }],
        pricing: {
          currency: "USD" as const,
          currentRecurringAmountUsdCents: 2_100,
          interval: "month" as const,
          recurringAmountUsdCentsPerSeat: 700,
          seatDecreaseTiming: "immediate_without_proration" as const,
          seatIncreaseTiming: "immediate_with_proration_and_immediate_invoice" as const,
        },
        seats: {
          active: 2,
          billed: 3,
          invited: 1,
          max: 6,
          min: 2,
          remaining: 0,
          used: 3,
        },
      },
    };

    expect(projectHostedRuntimeFamilyPlanToolResponseForContract(
      response,
      undefined,
    )).toEqual({
      action: "read_status",
      result: {
        billingActive: true,
        billingStatus: "active",
        members: [{
          isOwner: false,
          label: "Family member",
          role: "member",
          status: "active",
        }],
        owner: true,
        pendingInvites: [{
          acceptUrl: null,
          expiresAt: "2026-07-20T00:00:00.000Z",
          status: "pending",
          targetLabel: "Family invitee",
          targetPhoneHint: null,
          telegramInviteUrl: null,
        }],
        seats: response.result.seats,
      },
    });
    expect(projectHostedRuntimeFamilyPlanToolResponseForContract(
      response,
      2,
    )).toBe(response);

    const invite = response.result.pendingInvites[0];
    if (!invite) {
      throw new TypeError("Expected a projected invite fixture.");
    }
    expect(projectHostedRuntimeFamilyPlanToolResponseForContract({
      action: "create_invite",
      result: {
        invite,
        replyText: "Invite ready.",
        seats: response.result.seats,
      },
    }, undefined)).not.toHaveProperty("result.invite.inviteId");
    expect(projectHostedRuntimeFamilyPlanToolResponseForContract({
      action: "start_checkout",
      result: {
        alreadyActive: false,
        billingActive: false,
        billingStatus: "not_started",
        checkoutUrl: "https://checkout.stripe.test/family",
        owner: true,
        preparedInvite: invite,
        preparedInviteReplyText: "Invite ready.",
        seats: response.result.seats,
        unavailableReason: null,
      },
    }, undefined)).not.toHaveProperty("result.preparedInvite.inviteId");
  });

  it("reports an already removed owner-bound member as unchanged", async () => {
    const prisma = mocks.getPrisma();
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [],
      members: [],
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
    mocks.removeHostedFamilyMemberTx.mockResolvedValueOnce(false);
    prisma.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      status: "removed",
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "remove_member",
        confirmed: true,
        memberId: "member_removed",
      },
    })).resolves.toEqual({
      action: "remove_member",
      result: { memberId: "member_removed", status: "unchanged" },
    });
  });

  it("requires fresh approval after a member rejoins", async () => {
    const prisma = mocks.getPrisma();
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [],
      members: [{
        isOwner: false,
        joinedAt: new Date("2026-07-01T00:00:00.000Z"),
        label: "Family member",
        memberId: "member_sponsored",
        role: "member",
        status: "active",
      }],
      seats: {
        active: 2,
        billed: 3,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 1,
        used: 2,
      },
    });
    mocks.removeHostedFamilyMemberTx.mockResolvedValueOnce(false);
    prisma.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce({
      status: "active",
    });

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "remove_member",
        confirmed: true,
        memberId: "member_sponsored",
      },
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_CHANGED",
      httpStatus: 409,
    });
    expect(mocks.removeHostedFamilyMemberTx).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedJoinedAt: new Date("2026-07-01T00:00:00.000Z"),
      }),
    );
  });

  it("fails closed for a member id outside the owner group", async () => {
    const prisma = mocks.getPrisma();
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
      billingActive: true,
      billingStatus: "active",
      groupId: "hbag_family",
      invites: [],
      members: [],
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
    mocks.removeHostedFamilyMemberTx.mockResolvedValueOnce(false);
    prisma.hostedAccountGroupMembership.findFirst.mockResolvedValueOnce(null);

    await expect(handleHostedRuntimeFamilyPlanTool({
      memberId: "member_owner",
      request: {
        action: "remove_member",
        confirmed: true,
        memberId: "member_unknown",
      },
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_NOT_FOUND",
    });
  });
});
