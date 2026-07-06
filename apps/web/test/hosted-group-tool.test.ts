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
  releaseHostedLinqContactCardShareAttempt: vi.fn(),
  reserveHostedLinqContactCardShareAttempt: vi.fn(),
  resolveMurphHostedLinqContactCardBackupPhoneNumber: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
  sendHostedLinqAttachmentMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  hasHostedRuntimeActiveAccess: mocks.hasHostedRuntimeActiveAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
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
  handleHostedRuntimeGroupTool,
  reconcileHostedThreadContainerParticipants,
} from "@/src/lib/hosted-groups/group-tool";
import {
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
} from "@murphai/hosted-execution/runtime-control";
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
    mocks.readHostedGroupByRuntimeMemberId.mockResolvedValue(GROUP_SUMMARY);
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://www.withmurph.ai");
    mocks.hostedThreadContainerFindUnique.mockResolvedValue({
      ownerMemberId: "member_owner",
    });
    mocks.hostedMemberFindUnique.mockResolvedValue({ suspendedAt: null });
    mocks.hostedThreadContainerParticipantUpdateMany.mockResolvedValue({ count: 0 });
    mocks.hostedThreadContainerParticipantUpsert.mockResolvedValue({});
    mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx.mockResolvedValue({
      group: GROUP_SUMMARY,
      joinCode: "abc123",
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
      select: { ownerMemberId: true },
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

  it("does not mint a join link when runtime access is inactive", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);

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

  it("rejects join-link creation when the container owner is suspended", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue({ suspendedAt: new Date() });

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
});

describe("hosted group join policy", () => {
  it("keeps optional health sharing on the closed projection registry", () => {
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
      "sleep-times.v0",
      "activity-days.v0",
      "heart-rate-zones-days.v0",
    ])).toEqual([
      {
        description:
          "Allows this group to receive your recent sleep start and end times as bounded shared records.",
        label: "Recent sleep timing",
        projectionKind: "sleep-times.v0",
      },
      {
        description:
          "Allows this group to receive your recent daily active-minute totals as bounded shared records.",
        label: "Recent activity minutes",
        projectionKind: "activity-days.v0",
      },
      {
        description:
          "Allows this group to receive your recent daily workout heart-rate zone minutes as bounded shared records.",
        label: "Recent heart-rate zones",
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

  it("reconciles every resolved member even when the returned participant list is capped", async () => {
    const activeHandles = Array.from(
      { length: HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX + 1 },
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
      HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
    );
    expect(mocks.hostedThreadContainerParticipantUpsert).toHaveBeenCalledTimes(
      HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX + 1,
    );
    const updateWhere = mocks.hostedThreadContainerParticipantUpdateMany.mock.calls[0]?.[0]?.where;
    expect(updateWhere?.participantMemberId?.notIn).toHaveLength(
      HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX + 1,
    );
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
