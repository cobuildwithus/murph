import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bindUsageReferral: vi.fn(),
  claimPendingSetup: vi.fn(),
  consumePendingSetup: vi.fn(),
  ensureThreadContainer: vi.fn(),
  upsertPreferences: vi.fn(),
}));

vi.mock("@/src/lib/hosted-growth/usage-referral", () => ({
  bindArmedHostedUsageReferralToNewContainerTx: mocks.bindUsageReferral,
}));

vi.mock("@/src/lib/hosted-groups/pending-group-setup", () => ({
  claimHostedPendingGroupSetupForParticipantsTx: mocks.claimPendingSetup,
  consumeHostedPendingGroupSetupClaimTx: mocks.consumePendingSetup,
}));

vi.mock("@/src/lib/hosted-onboarding/member-preferences", () => ({
  upsertHostedMemberAssistantPreferencesTx: mocks.upsertPreferences,
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
  setup: {
    roomContextMarkdown: "Keep this room low-key.",
    style: {
      personality: { humor: 2 },
      tone: "casual" as const,
    },
  },
};
const preparedPendingSetupClaim = {
  id: pendingSetup.id,
  ownerMemberId: pendingSetup.ownerMemberId,
  payloadEncrypted: "prepared-pending-ciphertext",
  payloadRootKeyId: "root_pending",
  recipientPhoneLookupKey: pendingSetup.recipientPhoneLookupKey,
};
describe("ensureHostedPreparedLinqThreadContainerRouteTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bindUsageReferral.mockResolvedValue({ referralId: null });
    mocks.consumePendingSetup.mockResolvedValue(true);
    mocks.claimPendingSetup.mockResolvedValue({
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
      linqService: "iMessage",
      mailboxDedupeKey: "event_group",
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      participantMemberIds: ["member_prepared_owner"],
      preparedPendingSetupClaim,
      recipientPhoneLookupKeys: ["hplk_recovered_line", "hplk_line"],
      requiredPendingSetupCandidateId: pendingSetup.id,
      senderMemberId: "member_first_sender",
      threadId: "chat_group",
      tx,
    })).resolves.toMatchObject({
      kind: "ensured",
      ownerMemberId: "member_prepared_owner",
      ownerResolution: "pending_only_candidate",
      pendingSetupApplied: true,
    });

    expect(mocks.claimPendingSetup).toHaveBeenCalledExactlyOnceWith({
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      participantMemberIds: ["member_prepared_owner"],
      preparedClaim: preparedPendingSetupClaim,
      recipientPhoneLookupKeys: ["hplk_recovered_line", "hplk_line"],
      requiredCandidateId: pendingSetup.id,
      senderMemberId: "member_first_sender",
      tx,
    });
    expect(mocks.ensureThreadContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        initialGroupRoomModelMarkdown:
          "## Explicit setup\n\nKeep this room low-key.",
        ownerMemberId: "member_prepared_owner",
      }),
    );
    expect(mocks.upsertPreferences).toHaveBeenCalledExactlyOnceWith({
      memberId: "member_group_container",
      occurredAt: "2026-07-29T18:01:00.000Z",
      preferences: pendingSetup.setup.style,
      prisma: tx,
    });
    expect(mocks.bindUsageReferral).toHaveBeenCalledWith({
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      ownerMemberId: "member_prepared_owner",
      targetChannel: "linq",
      targetLinqService: "iMessage",
      targetContainerMemberId: "member_group_container",
      tx,
    });
    expect(mocks.consumePendingSetup).toHaveBeenCalledExactlyOnceWith({
      id: pendingSetup.id,
      ownerMemberId: pendingSetup.ownerMemberId,
      tx,
    });
  });

  it("leaves the intent untouched when another transaction already created the route", async () => {
    mocks.ensureThreadContainer.mockResolvedValue({
      containerMemberId: "member_existing_group",
      created: false,
      demotedMailboxConsumedAt: null,
    });

    await expect(ensureHostedPreparedLinqThreadContainerRouteTx({
      accountLookupKey: "hplk_line",
      fallbackOwnerMemberId: "member_first_sender",
      linqService: "iMessage",
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

    expect(mocks.consumePendingSetup).not.toHaveBeenCalled();
    expect(mocks.upsertPreferences).not.toHaveBeenCalled();
    expect(mocks.bindUsageReferral).not.toHaveBeenCalled();
  });

  it("leaves the intent for transaction rollback on route-admission failure", async () => {
    const routeFailure = new Error("route admission failed");
    mocks.ensureThreadContainer.mockRejectedValue(routeFailure);

    await expect(ensureHostedPreparedLinqThreadContainerRouteTx({
      accountLookupKey: "hplk_line",
      fallbackOwnerMemberId: "member_first_sender",
      linqService: "iMessage",
      mailboxDedupeKey: "event_group",
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      participantMemberIds: ["member_prepared_owner", "member_first_sender"],
      recipientPhoneLookupKeys: ["hplk_line"],
      senderMemberId: "member_first_sender",
      threadId: "chat_group",
      tx,
    })).rejects.toBe(routeFailure);

    expect(mocks.consumePendingSetup).not.toHaveBeenCalled();
    expect(mocks.upsertPreferences).not.toHaveBeenCalled();
    expect(mocks.bindUsageReferral).not.toHaveBeenCalled();
  });

  it("keeps ownership-only preparation free of style or room-model side effects", async () => {
    mocks.claimPendingSetup.mockResolvedValue({
      kind: "claimed",
      reason: "only_candidate",
      setup: {
        ...pendingSetup,
        setup: {},
      },
    });

    await expect(ensureHostedPreparedLinqThreadContainerRouteTx({
      accountLookupKey: "hplk_line",
      fallbackOwnerMemberId: "member_first_sender",
      linqService: "iMessage",
      mailboxDedupeKey: "event_group",
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      participantMemberIds: ["member_prepared_owner"],
      recipientPhoneLookupKeys: ["hplk_line"],
      senderMemberId: "member_first_sender",
      threadId: "chat_group",
      tx,
    })).resolves.toMatchObject({
      ownerMemberId: "member_prepared_owner",
      pendingSetupApplied: true,
    });

    expect(mocks.ensureThreadContainer).toHaveBeenCalledWith(
      expect.not.objectContaining({
        initialGroupRoomModelMarkdown: expect.anything(),
      }),
    );
    expect(mocks.upsertPreferences).not.toHaveBeenCalled();
  });

  it("does not apply the fallback owner when the recipient line is unmanaged", async () => {
    mocks.claimPendingSetup.mockResolvedValue({
      kind: "none",
      reason: "recipient_line_unmanaged",
    });

    await expect(ensureHostedPreparedLinqThreadContainerRouteTx({
      accountLookupKey: "hplk_unknown_line",
      fallbackOwnerMemberId: "member_first_sender",
      linqService: "iMessage",
      mailboxDedupeKey: "event_group",
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      participantMemberIds: ["member_first_sender"],
      recipientPhoneLookupKeys: ["hplk_unknown_line"],
      senderMemberId: "member_first_sender",
      threadId: "chat_group",
      tx,
    })).resolves.toEqual({
      kind: "owner_unavailable",
      pendingSetupResolution: "recipient_line_unmanaged",
    });

    expect(mocks.ensureThreadContainer).not.toHaveBeenCalled();
    expect(mocks.upsertPreferences).not.toHaveBeenCalled();
    expect(mocks.bindUsageReferral).not.toHaveBeenCalled();
  });

  it("keeps a recovery-pinned setup route-free when its exact claim is unavailable", async () => {
    mocks.claimPendingSetup.mockResolvedValue({
      kind: "none",
      reason: "claim_raced",
    });

    await expect(ensureHostedPreparedLinqThreadContainerRouteTx({
      accountLookupKey: "hplk_recovered_line",
      fallbackOwnerMemberId: "member_first_sender",
      linqService: "iMessage",
      mailboxDedupeKey: "event_group",
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      participantMemberIds: ["member_prepared_owner"],
      recipientPhoneLookupKeys: ["hplk_recovered_line", "hplk_line"],
      requiredPendingSetupCandidateId: pendingSetup.id,
      senderMemberId: "member_first_sender",
      threadId: "chat_group",
      tx,
    })).resolves.toEqual({
      kind: "owner_unavailable",
      pendingSetupResolution: "claim_raced",
    });

    expect(mocks.ensureThreadContainer).not.toHaveBeenCalled();
    expect(mocks.upsertPreferences).not.toHaveBeenCalled();
    expect(mocks.bindUsageReferral).not.toHaveBeenCalled();
  });
});
