import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bindUsageReferral: vi.fn(),
  claimPendingSetup: vi.fn(),
  ensureThreadContainer: vi.fn(),
  restorePendingSetup: vi.fn(),
}));

vi.mock("@/src/lib/hosted-growth/usage-referral", () => ({
  bindArmedHostedUsageReferralToNewContainerTx: mocks.bindUsageReferral,
}));

vi.mock("@/src/lib/hosted-groups/pending-group-setup", () => ({
  claimHostedPendingGroupSetupForParticipantsTx: mocks.claimPendingSetup,
  restoreHostedPendingGroupSetupClaimTx: mocks.restorePendingSetup,
}));

vi.mock("@/src/lib/hosted-routing/thread-container-service", () => ({
  ensureHostedThreadContainerRouteTx: mocks.ensureThreadContainer,
}));

import {
  ensureHostedPreparedLinqThreadContainerRouteTx,
} from "@/src/lib/hosted-groups/prepared-thread-container";

const tx = {} as never;
const pendingSetup = {
  armedAt: new Date("2026-07-29T18:00:00.000Z"),
  channel: "linq" as const,
  expiresAt: new Date("2026-07-29T18:30:00.000Z"),
  id: "hpgs_owner",
  ownerMemberId: "member_prepared_owner",
  recipientPhoneLookupKey: "hplk_line",
};
const claimToken = {
  armedAt: pendingSetup.armedAt,
  expiresAt: pendingSetup.expiresAt,
  id: pendingSetup.id,
  ownerMemberId: pendingSetup.ownerMemberId,
  recipientPhoneLookupKey: pendingSetup.recipientPhoneLookupKey,
};

describe("ensureHostedPreparedLinqThreadContainerRouteTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bindUsageReferral.mockResolvedValue({ referralId: null });
    mocks.restorePendingSetup.mockResolvedValue(true);
    mocks.claimPendingSetup.mockResolvedValue({
      claimToken,
      kind: "claimed",
      reason: "only_candidate",
      setup: pendingSetup,
    });
    mocks.ensureThreadContainer.mockResolvedValue({
      containerMemberId: "member_group_container",
      created: true,
      demotedMailboxConsumedAt: null,
    });
  });

  it("uses the roster-matched prepared member instead of the first sender", async () => {
    await expect(ensureHostedPreparedLinqThreadContainerRouteTx({
      accountLookupKey: "hplk_line",
      fallbackOwnerMemberId: "member_first_sender",
      mailboxDedupeKey: "event_group",
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      participantMemberIds: ["member_prepared_owner", "member_first_sender"],
      recipientPhoneLookupKeys: ["hplk_line"],
      senderMemberId: "member_first_sender",
      threadId: "chat_group",
      tx,
    })).resolves.toMatchObject({
      kind: "ensured",
      ownerMemberId: "member_prepared_owner",
      ownerResolution: "pending_only_candidate",
      pendingSetupApplied: true,
    });

    expect(mocks.ensureThreadContainer).toHaveBeenCalledWith(
      expect.objectContaining({ ownerMemberId: "member_prepared_owner" }),
    );
    expect(mocks.bindUsageReferral).toHaveBeenCalledWith({
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      ownerMemberId: "member_prepared_owner",
      targetContainerMemberId: "member_group_container",
      tx,
    });
    expect(mocks.restorePendingSetup).not.toHaveBeenCalled();
  });

  it("restores the intent when a concurrent transaction already created the route", async () => {
    mocks.ensureThreadContainer.mockResolvedValue({
      containerMemberId: "member_existing_group",
      created: false,
      demotedMailboxConsumedAt: null,
    });

    await expect(ensureHostedPreparedLinqThreadContainerRouteTx({
      accountLookupKey: "hplk_line",
      fallbackOwnerMemberId: "member_first_sender",
      mailboxDedupeKey: "event_group",
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      participantMemberIds: ["member_prepared_owner", "member_first_sender"],
      recipientPhoneLookupKeys: ["hplk_line"],
      senderMemberId: "member_first_sender",
      threadId: "chat_group",
      tx,
    })).resolves.toMatchObject({
      kind: "ensured",
      pendingSetupApplied: false,
    });

    expect(mocks.restorePendingSetup).toHaveBeenCalledExactlyOnceWith({
      claimToken,
      tx,
    });
    expect(mocks.bindUsageReferral).not.toHaveBeenCalled();
  });

  it("restores the intent before rethrowing a route-admission failure", async () => {
    const routeFailure = new Error("route admission failed");
    mocks.ensureThreadContainer.mockRejectedValue(routeFailure);

    await expect(ensureHostedPreparedLinqThreadContainerRouteTx({
      accountLookupKey: "hplk_line",
      fallbackOwnerMemberId: "member_first_sender",
      mailboxDedupeKey: "event_group",
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      participantMemberIds: ["member_prepared_owner", "member_first_sender"],
      recipientPhoneLookupKeys: ["hplk_line"],
      senderMemberId: "member_first_sender",
      threadId: "chat_group",
      tx,
    })).rejects.toBe(routeFailure);

    expect(mocks.restorePendingSetup).toHaveBeenCalledExactlyOnceWith({
      claimToken,
      tx,
    });
    expect(mocks.bindUsageReferral).not.toHaveBeenCalled();
  });
});
