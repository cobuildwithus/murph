import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  buildMurphHostedLinqContactCardVcf: vi.fn(),
  createHostedGroupJoinLinkForOwnedThreadContainerTx: vi.fn(),
  fetchMurphHostedLinqContactCardVcfPhoto: vi.fn(),
  getHostedLinqChatHandles: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  hostedMemberFindUnique: vi.fn(),
  hostedThreadContainerParticipantUpdateMany: vi.fn(),
  hostedThreadContainerParticipantUpsert: vi.fn(),
  hostedThreadContainerFindUnique: vi.fn(),
  isHostedMemberSuspended: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedGroupByRuntimeMemberId: vi.fn(),
  recordHostedGroupJoinOfferTx: vi.fn(),
  releaseHostedLinqContactCardShareAttempt: vi.fn(),
  reserveHostedLinqContactCardShareAttempt: vi.fn(),
  revokeHostedGroupMemberEmailShareTx: vi.fn(),
  resolveMurphHostedLinqContactCardBackupPhoneNumber: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
  sendHostedLinqAttachmentMessage: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  hasHostedRuntimeActiveAccess: mocks.hasHostedRuntimeActiveAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
  assertHostedMemberNotSuspended: (input: { suspendedAt?: Date | null }) => {
    if (input.suspendedAt instanceof Date) {
      throw new Error("suspended");
    }
  },
  isHostedMemberSuspended: mocks.isHostedMemberSuspended,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber: mocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress: mocks.lookupHostedMemberByVerifiedEmailAddress,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  getHostedLinqChatHandles: mocks.getHostedLinqChatHandles,
  isHostedLinqAttachmentSendPrepareFailure: (error: unknown) =>
    Boolean(
      error
      && typeof error === "object"
      && (error as { details?: { phase?: string } }).details?.phase === "prepare",
    ),
  sendHostedLinqAttachmentMessage: mocks.sendHostedLinqAttachmentMessage,
  sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-contact-card", () => ({
  MURPH_CONTACT_CARD_VCF_CONTENT_TYPE: "text/vcard",
  MURPH_CONTACT_CARD_VCF_FILE_NAME: "Murph.vcf",
  buildMurphHostedLinqContactCardVcf: mocks.buildMurphHostedLinqContactCardVcf,
  fetchMurphHostedLinqContactCardVcfPhoto: mocks.fetchMurphHostedLinqContactCardVcfPhoto,
  resolveMurphHostedLinqContactCardBackupPhoneNumber:
    mocks.resolveMurphHostedLinqContactCardBackupPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-contact-card-share", () => ({
  releaseHostedLinqContactCardShareAttempt: mocks.releaseHostedLinqContactCardShareAttempt,
  reserveHostedLinqContactCardShareAttempt: mocks.reserveHostedLinqContactCardShareAttempt,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedLinqRouteEgressAuthority: mocks.assertHostedLinqRouteEgressAuthority,
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  createHostedGroupJoinLinkForOwnedThreadContainerTx:
    mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx,
  readHostedGroupByRuntimeMemberId: mocks.readHostedGroupByRuntimeMemberId,
  recordHostedGroupJoinOfferTx: mocks.recordHostedGroupJoinOfferTx,
  revokeHostedGroupMemberEmailShareTx: mocks.revokeHostedGroupMemberEmailShareTx,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
  signalHostedRuntimeMaintenanceRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

const fakeTx = {
  hostedMember: { findUnique: mocks.hostedMemberFindUnique },
  hostedThreadContainer: { findUnique: mocks.hostedThreadContainerFindUnique },
};
const fakePrisma = {
  ...fakeTx,
  hostedThreadContainerParticipant: {
    updateMany: mocks.hostedThreadContainerParticipantUpdateMany,
    upsert: mocks.hostedThreadContainerParticipantUpsert,
  },
};

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    ...fakePrisma,
    $transaction: (run: (tx: typeof fakeTx) => Promise<unknown>) => run(fakeTx),
  }),
}));

import {
  HOSTED_RUNTIME_GROUP_TOOL_ACCESS_CLASSIFICATION,
  HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
  handleHostedRuntimeGroupTool,
  reconcileHostedThreadContainerParticipants,
} from "@/src/lib/hosted-groups/group-tool";
import { HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS } from "@murphai/hosted-execution/vault-share";
import {
  mergeHostedGroupJoinPolicy,
  projectHostedVaultShareProjectionDisplays,
  readHostedGroupJoinPolicy,
} from "@/src/lib/hosted-groups/join-policy";

const GROUP_SUMMARY = {
  displayName: "Sunday sleep crew",
  id: "hgrp_123",
  kind: "friends",
  memberCount: 3,
  requestedVaultShareProjectionKinds: ["sleep-times.v0" as const],
  status: "active",
};

describe("handleHostedRuntimeGroupTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.readHostedGroupByRuntimeMemberId.mockResolvedValue(GROUP_SUMMARY);
    mocks.revokeHostedGroupMemberEmailShareTx.mockResolvedValue({
      groupId: "hgrp_123",
      kind: "ok",
      revokedCount: 1,
      vaultShareCleanupSignals: [],
    });
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://www.withmurph.ai");
    mocks.hostedThreadContainerFindUnique.mockResolvedValue({
      member: { suspendedAt: null },
      ownerMemberId: "member_owner",
    });
    mocks.hostedMemberFindUnique.mockResolvedValue({ suspendedAt: null });
    mocks.hostedThreadContainerParticipantUpdateMany.mockResolvedValue({ count: 0 });
    mocks.hostedThreadContainerParticipantUpsert.mockResolvedValue({});
    mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx.mockResolvedValue({
      group: GROUP_SUMMARY,
      joinCode: "abc123",
    });
    mocks.recordHostedGroupJoinOfferTx.mockResolvedValue({
      groupId: GROUP_SUMMARY.id,
      messageIdSuffix: "offer_msg",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      projectionKinds: ["sleep-times.v0"],
    });
  });

  it("classifies group-tool actions by access authority", () => {
    expect(HOSTED_RUNTIME_GROUP_TOOL_ACCESS_CLASSIFICATION).toEqual({
      create_join_link: "owner_active",
      post_join_offer: "owner_active",
      read_chat_participants: "participant_aware",
      read_current: "participant_aware",
      revoke_own_email_share: "participant_aware",
      share_contact_card: "owner_active",
    });
  });

  it("reads the current group for the runtime member", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_current" },
    })).resolves.toEqual({
      action: "read_current",
      result: {
        group: GROUP_SUMMARY,
        status: "ok",
      },
    });

    expect(mocks.readHostedGroupByRuntimeMemberId).toHaveBeenCalledWith({
      runtimeMemberId: "member_group_runtime",
    });
  });

  it("does not read group state when runtime access is inactive", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_current" },
    })).resolves.toEqual({
      action: "read_current",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "runtime_inactive",
      },
    });

    expect(mocks.readHostedGroupByRuntimeMemberId).not.toHaveBeenCalled();
  });

  it("reports no group when the runtime member is not attached to one", async () => {
    mocks.readHostedGroupByRuntimeMemberId.mockResolvedValue(null);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_regular",
      request: { action: "read_current" },
    })).resolves.toEqual({
      action: "read_current",
      result: {
        group: null,
        status: "none",
      },
    });
  });

  it("creates a join link bound to the runtime member's thread container owner", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "create_join_link",
        joinLink: {
          displayName: "Sunday sleep crew",
          kind: "friends",
          requestedVaultShareProjectionKinds: ["sleep-times.v0"],
        },
      },
    })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: GROUP_SUMMARY,
        joinUrl: "https://www.withmurph.ai/groups/join/abc123",
        status: "ok",
      },
    });

    expect(mocks.hostedThreadContainerFindUnique).toHaveBeenCalledWith({
      where: { memberId: "member_group_runtime" },
      select: {
        member: {
          select: { suspendedAt: true },
        },
        ownerMemberId: true,
      },
    });
    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledWith({
      memberId: "member_owner",
      prisma: fakeTx,
    });
    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).toHaveBeenCalledWith(
      expect.objectContaining({
        actorMemberId: "member_owner",
        containerMemberId: "member_group_runtime",
        displayName: "Sunday sleep crew",
        kind: "friends",
        requestedVaultShareProjectionKinds: ["sleep-times.v0"],
      }),
    );
  });

  it("does not mint a join link when the owner lacks active access even if participant-aware access is active", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "create_join_link" },
    })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "owner_unavailable",
      },
    });

    expect(mocks.hasHostedRuntimeActiveAccess).not.toHaveBeenCalled();
    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).not.toHaveBeenCalled();
  });

  it("does not mint a join link when the synthetic group runtime member is suspended", async () => {
    mocks.hostedThreadContainerFindUnique.mockResolvedValue({
      member: { suspendedAt: new Date("2026-07-06T12:00:00Z") },
      ownerMemberId: "member_owner",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "create_join_link" },
    })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "runtime_inactive",
      },
    });

    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).not.toHaveBeenCalled();
  });

  it("reports join links unavailable without a public base url", async () => {
    mocks.resolveHostedPublicBaseUrl.mockReturnValue(null);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "create_join_link" },
    })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "join_links_unavailable",
      },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).not.toHaveBeenCalled();
  });

  it("rejects join-link creation when the runtime member is not a thread container", async () => {
    mocks.hostedThreadContainerFindUnique.mockResolvedValue(null);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_regular",
      request: { action: "create_join_link" },
    })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "not_group_runtime",
      },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).not.toHaveBeenCalled();
  });

  it("rejects join-link creation when the container owner has no active access", async () => {
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "create_join_link" },
    })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "owner_unavailable",
      },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).not.toHaveBeenCalled();
  });

  it("fails closed for unauthenticated email sender self-opt-out", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "revoke_own_email_share",
        selfOptOut: {
          senderHandle: "spoofed-member@example.test",
          source: "email",
        },
      },
    })).resolves.toEqual({
      action: "revoke_own_email_share",
      result: {
        status: "unavailable",
        unavailableReason: "member_unresolved",
      },
    });

    expect(mocks.lookupHostedMemberByVerifiedEmailAddress).not.toHaveBeenCalled();
    expect(mocks.revokeHostedGroupMemberEmailShareTx).not.toHaveBeenCalled();
  });

  it("revokes only the current authenticated linq sender's group newsletter email share", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_sender", suspendedAt: null },
    });
    mocks.revokeHostedGroupMemberEmailShareTx.mockResolvedValue({
      groupId: "hgrp_123",
      kind: "ok",
      revokedCount: 1,
      vaultShareCleanupSignals: [
        { mailboxItemId: "hmi_revoke_1", memberId: "member_group_runtime" },
      ],
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "revoke_own_email_share",
        selfOptOut: {
          senderHandle: "+15550000001",
          source: "linq",
        },
      },
    })).resolves.toEqual({
      action: "revoke_own_email_share",
      result: {
        revokedCount: 1,
        status: "revoked",
      },
    });

    expect(mocks.lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: "+15550000001" }),
    );
    expect(mocks.revokeHostedGroupMemberEmailShareTx).toHaveBeenCalledWith(
      expect.objectContaining({
        groupRuntimeMemberId: "member_group_runtime",
        memberId: "member_sender",
      }),
    );
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_group_runtime",
      mailboxItemId: "hmi_revoke_1",
    });
  });

  it("fails closed when the resolved opt-out sender no longer has active access", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_sender", suspendedAt: null },
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "revoke_own_email_share",
        selfOptOut: {
          senderHandle: "+15550000001",
          source: "linq",
        },
      },
    })).resolves.toEqual({
      action: "revoke_own_email_share",
      result: {
        status: "unavailable",
        unavailableReason: "member_unavailable",
      },
    });

    expect(mocks.revokeHostedGroupMemberEmailShareTx).not.toHaveBeenCalled();
  });

  it("reports already_removed when the current sender had no active email share", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_sender", suspendedAt: null },
    });
    mocks.revokeHostedGroupMemberEmailShareTx.mockResolvedValue({
      groupId: "hgrp_123",
      kind: "ok",
      revokedCount: 0,
      vaultShareCleanupSignals: [],
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "revoke_own_email_share",
        selfOptOut: {
          senderHandle: "+15550000001",
          source: "linq",
        },
      },
    })).resolves.toEqual({
      action: "revoke_own_email_share",
      result: {
        revokedCount: 0,
        status: "already_removed",
      },
    });
  });

  it("fails closed when email-share revocation has no injected sender", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "revoke_own_email_share" },
    })).resolves.toEqual({
      action: "revoke_own_email_share",
      result: {
        status: "unavailable",
        unavailableReason: "sender_unavailable",
      },
    });

    expect(mocks.revokeHostedGroupMemberEmailShareTx).not.toHaveBeenCalled();
  });
});

describe("hosted group join policy", () => {
  it("keeps email and optional health sharing on the closed projection registry", () => {
    expect(readHostedGroupJoinPolicy({
      requestedVaultShareProjectionKinds: ["sleep-times.v0", "activity-days.v0"],
      schema: "murph.hosted-group.join-policy.v1",
    })).toEqual({
      requestedVaultShareProjectionKinds: ["sleep-times.v0", "activity-days.v0"],
      schema: "murph.hosted-group.join-policy.v1",
    });

    expect(mergeHostedGroupJoinPolicy({
      existing: {
        requestedVaultShareProjectionKinds: ["sleep-times.v0"],
        schema: "murph.hosted-group.join-policy.v1",
      },
      requestedVaultShareProjectionKinds: ["activity-days.v0", "sleep-times.v0"],
    }).requestedVaultShareProjectionKinds).toEqual([
      "sleep-times.v0",
      "activity-days.v0",
    ]);

    expect(readHostedGroupJoinPolicy({
      requestedVaultShareProjectionKinds: ["all-health-data"],
      schema: "murph.hosted-group.join-policy.v1",
    }).requestedVaultShareProjectionKinds).toEqual([]);

    expect(projectHostedVaultShareProjectionDisplays([
      "group-email.v0",
      "sleep-times.v0",
      "activity-days.v0",
      "heart-rate-zones-days.v0",
    ])).toEqual([
      {
        description:
          "Share your email so this group's Murph can send the newsletter. Your email is visible to the group.",
        label: "Email address",
        projectionKind: "group-email.v0",
      },
      {
        description:
          "Lets this group see your 7 most recent days of sleep start and end times.",
        label: "Sleep timing",
        projectionKind: "sleep-times.v0",
      },
      {
        description:
          "Lets this group see your 7 most recent days of daily active minutes.",
        label: "Activity minutes",
        projectionKind: "activity-days.v0",
      },
      {
        description:
          "Lets this group see your 7 most recent days of workout heart-rate zone minutes.",
        label: "Heart-rate zones",
        projectionKind: "heart-rate-zones-days.v0",
      },
    ]);

    expect(projectHostedVaultShareProjectionDisplays(
      HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
    ).map((entry) => entry.projectionKind)).toEqual([
      ...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
    ]);
  });
});

describe("handleHostedRuntimeGroupTool chat-scoped actions", () => {
  const LINQ_THREAD = {
    authority: {
      accountLookupKey: "hplk_account",
      channel: "linq" as const,
      containerMemberId: "member_container",
      threadId: "chat_group_1",
    },
    chatId: "chat_group_1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedLinqRouteEgressAuthority.mockResolvedValue({});
    mocks.buildMurphHostedLinqContactCardVcf.mockReturnValue("BEGIN:VCARD\r\nEND:VCARD\r\n");
    mocks.fetchMurphHostedLinqContactCardVcfPhoto.mockResolvedValue(null);
    mocks.getHostedLinqChatHandles.mockResolvedValue([
      { handle: "+15557770000", isMe: true, status: "active" },
      { handle: "+15550000001", isMe: false, status: "active" },
      { handle: "person@example.com", isMe: false, status: null },
      { handle: "+15550000002", isMe: false, status: "left" },
    ]);
    mocks.hostedThreadContainerFindUnique.mockResolvedValue({
      member: { suspendedAt: null },
      ownerMemberId: "member_owner",
    });
    mocks.isHostedMemberSuspended.mockReturnValue(false);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_participant", suspendedAt: null },
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue(null);
    mocks.releaseHostedLinqContactCardShareAttempt.mockResolvedValue(undefined);
    mocks.reserveHostedLinqContactCardShareAttempt.mockResolvedValue({
      action: "share",
      attemptedAt: new Date("2026-07-02T12:00:00Z"),
    });
    mocks.resolveMurphHostedLinqContactCardBackupPhoneNumber.mockResolvedValue("+15558880000");
    mocks.sendHostedLinqAttachmentMessage.mockResolvedValue({
      chatId: "chat_group_1",
      messageId: "msg_1",
    });
    mocks.sendHostedLinqChatMessage.mockResolvedValue({
      chatId: "chat_group_1",
      messageId: "msg_offer_1",
    });
  });

  it("fails closed when the runtime supplied no linq thread context", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_chat_participants" },
    })).resolves.toEqual({
      action: "read_chat_participants",
      result: {
        participants: null,
        status: "unavailable",
        unavailableReason: "linq_thread_unavailable",
      },
    });

    expect(mocks.getHostedLinqChatHandles).not.toHaveBeenCalled();
    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
  });

  it("posts a newsletter react-to-join offer whose disclosed scope matches the stored snapshot", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: {
          displayName: "Sunday Sleep Crew",
          messageTemplate:
            "React here and you're in. Reacting shares {{share_scope}} with this group; customize at {{join_url}}.",
          projectionKinds: [
            "group-email.v0",
            "sleep-times.v0",
            "activity-days.v0",
            "workout-days.v0",
            "resting-heart-rate-days.v0",
            "hrv-days.v0",
          ],
        },
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "post_join_offer",
      result: {
        group: GROUP_SUMMARY,
        joinUrl: "https://www.withmurph.ai/groups/join/abc123",
        status: "sent",
      },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).toHaveBeenCalledWith(
      expect.objectContaining({
        actorMemberId: "member_owner",
        containerMemberId: "member_container",
        displayName: "Sunday Sleep Crew",
        requestedVaultShareProjectionKinds: [
          "group-email.v0",
          "sleep-times.v0",
          "activity-days.v0",
          "workout-days.v0",
          "resting-heart-rate-days.v0",
          "hrv-days.v0",
        ],
        tx: fakeTx,
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_group_1",
        idempotencyKey: expect.stringMatching(/^group-join-offer:hgrp_123:/u),
        message:
          "React here and you're in. Reacting shares your Murph profile name, email address, sleep timing, activity minutes, workout summaries, resting heart rate, and HRV with this group; customize at https://www.withmurph.ai/groups/join/abc123.",
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.not.stringContaining("Like this message to join this Murph group."),
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.not.stringContaining("\u2014"),
      }),
    );
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      messageId: "msg_offer_1",
      postedAt: expect.any(Date),
      projectionKinds: [
        "group-email.v0",
        "sleep-times.v0",
        "activity-days.v0",
        "workout-days.v0",
        "resting-heart-rate-days.v0",
        "hrv-days.v0",
      ],
      tx: fakeTx,
    });
    expect(mocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

  it("renders profile-only share scope when no optional kinds are requested", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: {
          messageTemplate: "Joining shares {{share_scope}}. Customize: {{join_url}}.",
          projectionKinds: [],
        },
        linqThread: LINQ_THREAD,
      },
    })).resolves.toMatchObject({
      action: "post_join_offer",
      result: { status: "sent" },
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Joining shares your Murph profile name. Customize: https://www.withmurph.ai/groups/join/abc123.",
      }),
    );
  });

  it("renders email-only share scope as a two-item list", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: {
          messageTemplate: "Joining shares {{share_scope}}. Customize: {{join_url}}.",
          projectionKinds: ["group-email.v0"],
        },
        linqThread: LINQ_THREAD,
      },
    })).resolves.toMatchObject({
      action: "post_join_offer",
      result: { status: "sent" },
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Joining shares your Murph profile name and email address. Customize: https://www.withmurph.ai/groups/join/abc123.",
      }),
    );
  });

  it("renders multi-kind health share scope labels without lowercasing HRV", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: {
          messageTemplate: "Scope: {{share_scope}}. Customize: {{join_url}}.",
          projectionKinds: [
            "sleep-times.v0",
            "activity-days.v0",
            "workout-days.v0",
            "resting-heart-rate-days.v0",
            "hrv-days.v0",
          ],
        },
        linqThread: LINQ_THREAD,
      },
    })).resolves.toMatchObject({
      action: "post_join_offer",
      result: { status: "sent" },
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Scope: your Murph profile name, sleep timing, activity minutes, workout summaries, resting heart rate, and HRV. Customize: https://www.withmurph.ai/groups/join/abc123.",
      }),
    );
  });

  it("rejects a newsletter default-scope offer without the customize link", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: {
          messageTemplate:
            "React to this message if you want to join. Joining shares {{share_scope}}.",
          projectionKinds: [
            "group-email.v0",
            "sleep-times.v0",
            "activity-days.v0",
            "workout-days.v0",
            "resting-heart-rate-days.v0",
            "hrv-days.v0",
          ],
        },
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "post_join_offer",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "join_offer_message_template_unavailable",
      },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.recordHostedGroupJoinOfferTx).not.toHaveBeenCalled();
  });

  it("does not create or send a join offer without the required message template", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "post_join_offer", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "post_join_offer",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "join_offer_message_template_unavailable",
      },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.recordHostedGroupJoinOfferTx).not.toHaveBeenCalled();
  });

  it("does not bind an offer when the provider omits the sent message id", async () => {
    mocks.sendHostedLinqChatMessage.mockResolvedValue({
      chatId: "chat_group_1",
      messageId: null,
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: {
          messageTemplate:
            "Like this to join. It shares {{share_scope}} with the group. Join page: {{join_url}}.",
        },
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "post_join_offer",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "provider_message_unavailable",
      },
    });

    expect(mocks.recordHostedGroupJoinOfferTx).not.toHaveBeenCalled();
  });

  it("rejects an authority that does not match the bound runtime member", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_other",
      request: { action: "share_contact_card", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "linq_thread_unauthorized",
      },
    });

    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

  it("rejects when the thread-route authority assertion fails", async () => {
    mocks.assertHostedLinqRouteEgressAuthority.mockRejectedValue(new Error("unauthorized"));

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_chat_participants", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "read_chat_participants",
      result: {
        participants: null,
        status: "unavailable",
        unavailableReason: "linq_thread_unauthorized",
      },
    });

    expect(mocks.getHostedLinqChatHandles).not.toHaveBeenCalled();
  });

  it("keeps read_chat_participants participant-aware when the generic runtime gate is inactive", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_chat_participants", linqThread: LINQ_THREAD },
    })).resolves.toMatchObject({
      action: "read_chat_participants",
      result: {
        status: "ok",
      },
    });

    expect(mocks.hasHostedRuntimeActiveAccess).not.toHaveBeenCalled();
    expect(mocks.hostedThreadContainerFindUnique).not.toHaveBeenCalled();
  });

  it("classifies chat participants by Murph membership and skips the line and departed handles", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_chat_participants", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "read_chat_participants",
      result: {
        participants: [
          { handle: "+15550000001", hasOwnMurph: true },
          { handle: "person@example.com", hasOwnMurph: false },
        ],
        status: "ok",
      },
    });

    expect(mocks.assertHostedLinqRouteEgressAuthority).toHaveBeenCalledWith(
      expect.objectContaining({ authority: LINQ_THREAD.authority }),
    );
    expect(mocks.lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalledTimes(1);
    expect(mocks.lookupHostedMemberByVerifiedEmailAddress).toHaveBeenCalledWith(
      expect.objectContaining({ address: "person@example.com" }),
    );
    expect(mocks.hostedThreadContainerParticipantUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          containerMemberId: "member_container",
          handleLookupKey: expect.stringMatching(/^hbidx:phone:/),
          participantMemberId: "member_participant",
          removedAt: null,
        }),
        update: expect.objectContaining({
          handleLookupKey: expect.stringMatching(/^hbidx:phone:/),
          removedAt: null,
        }),
        where: {
          containerMemberId_participantMemberId: {
            containerMemberId: "member_container",
            participantMemberId: "member_participant",
          },
        },
      }),
    );
    expect(mocks.hostedThreadContainerParticipantUpdateMany).toHaveBeenCalledWith({
      data: {
        removedAt: expect.any(Date),
      },
      where: {
        containerMemberId: "member_container",
        participantMemberId: { notIn: ["member_participant"] },
        removedAt: null,
      },
    });
  });

  it("bounds read_chat_participants lookups and reconcile writes to the roster cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const activeHandles = Array.from(
      { length: HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX + 1 },
      (_, index) => ({
        handle: `+1555001${index.toString().padStart(4, "0")}`,
        isMe: false,
        status: "active",
      }),
    );
    mocks.getHostedLinqChatHandles.mockResolvedValue([
      { handle: "+15557770000", isMe: true, status: "active" },
      ...activeHandles,
    ]);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockImplementation(async ({ phoneNumber }) => ({
      core: { id: `member_${phoneNumber.slice(-4)}`, suspendedAt: null },
    }));

    const response = await handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_chat_participants", linqThread: LINQ_THREAD },
    });

    expect(response).toMatchObject({
      action: "read_chat_participants",
      result: { status: "ok" },
    });
    if (response.action !== "read_chat_participants" || response.result.status !== "ok") {
      throw new Error("Expected ok participants response.");
    }
    expect(response.result.participants).toHaveLength(
      HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
    );
    expect(mocks.lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalledTimes(
      HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
    );
    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledTimes(
      HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
    );
    expect(mocks.hostedThreadContainerParticipantUpsert).toHaveBeenCalledTimes(
      HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
    );
    expect(mocks.hostedThreadContainerParticipantUpdateMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Hosted thread-container participant reconcile capped.",
      expect.objectContaining({
        cap: HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
        reason: "roster_exceeds_cap",
        rosterSize: HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX + 1,
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      "Hosted thread-container participant reconcile skipped.",
      expect.objectContaining({
        reason: "roster_exceeds_cap",
      }),
    );
    warn.mockRestore();
  });

  it("bounds at-creation reconcile lookups and upserts to the roster cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const activeHandles = Array.from(
      { length: HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX + 1 },
      (_, index) => ({
        handle: `+1555011${index.toString().padStart(4, "0")}`,
        isMe: false,
        status: "active",
      }),
    );
    mocks.getHostedLinqChatHandles.mockResolvedValue([
      { handle: "+15557770000", isMe: true, status: "active" },
      ...activeHandles,
    ]);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockImplementation(async ({ phoneNumber }) => ({
      core: { id: `member_${phoneNumber.slice(-4)}`, suspendedAt: null },
    }));

    await reconcileHostedThreadContainerParticipants({
      chatId: "chat_group_1",
      containerMemberId: "member_container",
      prisma: fakePrisma as never,
    });

    expect(mocks.getHostedLinqChatHandles).toHaveBeenCalledWith({
      chatId: "chat_group_1",
    });
    expect(mocks.lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalledTimes(
      HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
    );
    expect(mocks.hostedThreadContainerParticipantUpsert).toHaveBeenCalledTimes(
      HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
    );
    expect(mocks.hostedThreadContainerParticipantUpdateMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Hosted thread-container participant reconcile capped.",
      expect.objectContaining({
        cap: HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
        reason: "roster_exceeds_cap",
        rosterSize: HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX + 1,
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      "Hosted thread-container participant reconcile skipped.",
      expect.objectContaining({
        reason: "roster_exceeds_cap",
      }),
    );
    warn.mockRestore();
  });

  it("treats an unrecognized empty roster as provider trouble, not an empty room", async () => {
    mocks.getHostedLinqChatHandles.mockResolvedValue([]);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_chat_participants", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "read_chat_participants",
      result: {
        participants: null,
        status: "unavailable",
        unavailableReason: "provider_unavailable",
      },
    });
  });

  it("reports provider trouble as unavailable instead of throwing", async () => {
    mocks.getHostedLinqChatHandles.mockRejectedValue(new Error("linq down"));

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_chat_participants", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "read_chat_participants",
      result: {
        participants: null,
        status: "unavailable",
        unavailableReason: "provider_unavailable",
      },
    });
  });

  it("soft-removes prior roster members when a successful roster pass sees none", async () => {
    await reconcileHostedThreadContainerParticipants({
      chatId: "chat_group_1",
      containerMemberId: "member_container",
      handles: [
        { handle: "+15550000001", isMe: false, status: "left" },
      ],
      prisma: fakePrisma as never,
      resolvedParticipants: [],
    });

    expect(mocks.hostedThreadContainerParticipantUpsert).not.toHaveBeenCalled();
    expect(mocks.hostedThreadContainerParticipantUpdateMany).toHaveBeenCalledWith({
      data: {
        removedAt: expect.any(Date),
      },
      where: {
        containerMemberId: "member_container",
        removedAt: null,
      },
    });
  });

  it("keeps the existing roster projection when the provider fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getHostedLinqChatHandles.mockRejectedValueOnce(new Error("linq unavailable"));

    await reconcileHostedThreadContainerParticipants({
      chatId: "chat_group_1",
      containerMemberId: "member_container",
      prisma: fakePrisma as never,
    });

    expect(mocks.hostedThreadContainerParticipantUpsert).not.toHaveBeenCalled();
    expect(mocks.hostedThreadContainerParticipantUpdateMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Hosted thread-container participant reconcile skipped.",
      expect.objectContaining({
        reason: "reconcile_failed",
      }),
    );
    warn.mockRestore();
  });

  it("sends the contact card vcf into the chat using the line's own handle", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "share_contact_card", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: { status: "sent" },
    });

    expect(mocks.buildMurphHostedLinqContactCardVcf).toHaveBeenCalledWith({
      backupPhoneNumber: "+15558880000",
      phoneNumber: "+15557770000",
      photo: null,
    });
    expect(mocks.resolveMurphHostedLinqContactCardBackupPhoneNumber).toHaveBeenCalledWith(
      expect.objectContaining({ excludePhoneNumber: "+15557770000" }),
    );
    expect(mocks.sendHostedLinqAttachmentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_group_1",
        contentType: "text/vcard",
        fileName: "Murph.vcf",
        idempotencyKey: expect.stringMatching(
          /^group-contact-card:chat_group_1:\d{4}-\d{2}-\d{2}$/u,
        ),
      }),
    );
    expect(mocks.reserveHostedLinqContactCardShareAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_group_1",
        memberId: "member_container",
      }),
    );
  });

  it("does not share the contact card when the owner lacks active access even if participant-aware access is active", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "share_contact_card", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "owner_unavailable",
      },
    });

    expect(mocks.hasHostedRuntimeActiveAccess).not.toHaveBeenCalled();
    expect(mocks.reserveHostedLinqContactCardShareAttempt).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

  it("reports already_shared when the per-chat throttle is active", async () => {
    mocks.reserveHostedLinqContactCardShareAttempt.mockResolvedValue({
      action: "skip",
      reason: "recent_attempt",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "share_contact_card", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: { status: "already_shared" },
    });

    expect(mocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

  it("does not reserve or send when the line handle is missing from the roster", async () => {
    mocks.getHostedLinqChatHandles.mockResolvedValue([
      { handle: "+15550000001", isMe: false, status: "active" },
    ]);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "share_contact_card", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "line_unresolved",
      },
    });

    expect(mocks.reserveHostedLinqContactCardShareAttempt).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

  it("keeps the reservation for an ambiguous message-send failure", async () => {
    mocks.sendHostedLinqAttachmentMessage.mockRejectedValue(new Error("send maybe delivered"));

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "share_contact_card", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "send_failed",
      },
    });

    expect(mocks.releaseHostedLinqContactCardShareAttempt).not.toHaveBeenCalled();
  });

  it("releases the reservation when the failure provably happened before the send", async () => {
    const prepareFailure = Object.assign(new Error("upload failed"), {
      details: { phase: "prepare" },
    });
    mocks.sendHostedLinqAttachmentMessage.mockRejectedValue(prepareFailure);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "share_contact_card", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "send_failed",
      },
    });

    expect(mocks.releaseHostedLinqContactCardShareAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptedAt: new Date("2026-07-02T12:00:00Z"),
        chatId: "chat_group_1",
        memberId: "member_container",
      }),
    );
  });

  it("reports membership lookup trouble as structured unavailability", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockRejectedValue(new Error("identity store down"));

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_chat_participants", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "read_chat_participants",
      result: {
        participants: null,
        status: "unavailable",
        unavailableReason: "membership_lookup_unavailable",
      },
    });
  });

  it("treats an empty roster on share as provider trouble rather than a missing line", async () => {
    mocks.getHostedLinqChatHandles.mockResolvedValue([]);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "share_contact_card", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "provider_unavailable",
      },
    });

    expect(mocks.reserveHostedLinqContactCardShareAttempt).not.toHaveBeenCalled();
  });
});
