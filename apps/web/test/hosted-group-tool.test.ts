import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admitHostedGroupDisclosurePermissionAppendTx: vi.fn(),
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  buildMurphHostedLinqContactCardVcf: vi.fn(),
  canonicalizeHostedGroupDisclosurePermissionText: vi.fn(),
  createHostedGroupDisclosurePermissionProviderIdempotencyKey: vi.fn(),
  createHostedGroupJoinLinkForOwnedThreadContainerTx: vi.fn(),
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort: vi.fn(),
  fetchMurphHostedLinqContactCardVcfPhoto: vi.fn(),
  getHostedLinqChatHandles: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  hostedMemberFindUnique: vi.fn(),
  hostedThreadContainerParticipantUpdateMany: vi.fn(),
  hostedThreadContainerParticipantUpsert: vi.fn(),
  hostedThreadContainerFindUnique: vi.fn(),
  isHostedMemberSuspended: vi.fn(),
  leaveHostedGroupMemberTx: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  prepareHostedGroupJoinOfferPostTx: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readActiveHostedGroupDisclosureGrantsForGroup: vi.fn(),
  readActiveHostedGroupDisclosureGrantsForMember: vi.fn(),
  requestHostedGroupAssistantAsk: vi.fn(),
  requestHostedGroupMemberAssistantAsk: vi.fn(),
  readHostedGroupByRuntimeMemberId: vi.fn(),
  readHostedGroupIdByRuntimeMemberId: vi.fn(),
  readHostedGroupMembershipsForMember: vi.fn(),
  readHostedGroupUsageStatus: vi.fn(),
  readHostedGroupSharedDataByRuntimeMemberId: vi.fn(),
  recordHostedGroupJoinOfferTx: vi.fn(),
  recordHostedGroupDisclosurePermissionTx: vi.fn(),
  releaseHostedLinqContactCardShareAttempt: vi.fn(),
  reserveHostedLinqContactCardShareAttempt: vi.fn(),
  revokeHostedGroupMemberEmailShareTx: vi.fn(),
  revokeHostedGroupDisclosureGrantForMemberTx: vi.fn(),
  resolveMurphHostedLinqContactCardBackupPhoneNumber: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
  sendHostedLinqAttachmentMessage: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
  updateHostedGroupDisplayNameByRuntimeMemberIdTx: vi.fn(),
  updateHostedLinqChatAvatar: vi.fn(),
  updateHostedLinqChatDisplayName: vi.fn(),
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
  updateHostedLinqChatAvatar: mocks.updateHostedLinqChatAvatar,
  updateHostedLinqChatDisplayName: mocks.updateHostedLinqChatDisplayName,
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
  leaveHostedGroupMemberTx: mocks.leaveHostedGroupMemberTx,
  prepareHostedGroupJoinOfferPostTx: mocks.prepareHostedGroupJoinOfferPostTx,
  readHostedGroupByRuntimeMemberId: mocks.readHostedGroupByRuntimeMemberId,
  readHostedGroupIdByRuntimeMemberId: mocks.readHostedGroupIdByRuntimeMemberId,
  readHostedGroupMembershipsForMember: mocks.readHostedGroupMembershipsForMember,
  readHostedGroupSharedDataByRuntimeMemberId:
    mocks.readHostedGroupSharedDataByRuntimeMemberId,
  recordHostedGroupJoinOfferTx: mocks.recordHostedGroupJoinOfferTx,
  revokeHostedGroupMemberEmailShareTx: mocks.revokeHostedGroupMemberEmailShareTx,
  updateHostedGroupDisplayNameByRuntimeMemberIdTx:
    mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx,
}));

vi.mock("@/src/lib/hosted-groups/group-newsletter", () => ({
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort:
    mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort,
}));

vi.mock("@/src/lib/hosted-groups/group-assistant-ask", () => ({
  requestHostedGroupAssistantAsk: mocks.requestHostedGroupAssistantAsk,
  requestHostedGroupMemberAssistantAsk: mocks.requestHostedGroupMemberAssistantAsk,
}));

vi.mock("@/src/lib/hosted-groups/group-disclosure-store", () => ({
  admitHostedGroupDisclosurePermissionAppendTx:
    mocks.admitHostedGroupDisclosurePermissionAppendTx,
  canonicalizeHostedGroupDisclosurePermissionText:
    mocks.canonicalizeHostedGroupDisclosurePermissionText,
  createHostedGroupDisclosurePermissionProviderIdempotencyKey:
    mocks.createHostedGroupDisclosurePermissionProviderIdempotencyKey,
  readActiveHostedGroupDisclosureGrantsForGroup:
    mocks.readActiveHostedGroupDisclosureGrantsForGroup,
  readActiveHostedGroupDisclosureGrantsForMember:
    mocks.readActiveHostedGroupDisclosureGrantsForMember,
  recordHostedGroupDisclosurePermissionTx:
    mocks.recordHostedGroupDisclosurePermissionTx,
  revokeHostedGroupDisclosureGrantForMemberTx:
    mocks.revokeHostedGroupDisclosureGrantForMemberTx,
}));

vi.mock("@/src/lib/hosted-groups/group-usage-funding", () => ({
  readHostedGroupUsageStatus: mocks.readHostedGroupUsageStatus,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
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
  buildHostedGroupJoinOfferProviderIdempotencyKey,
  HOSTED_RUNTIME_GROUP_TOOL_ACCESS_CLASSIFICATION,
  HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
  handleHostedRuntimeGroupTool,
  reconcileHostedThreadContainerParticipants,
} from "@/src/lib/hosted-groups/group-tool";
import {
  filterHostedRuntimeGroupToolResponseProjectionScopes,
} from "@/src/lib/hosted-groups/group-tool-scope-filter";
import {
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  buildHostedVaultShareActivityDistanceProjectionScope,
  buildHostedVaultShareActivityMinutesProjectionScope,
  buildHostedVaultShareActivitySessionCountProjectionScope,
  buildHostedVaultShareProjectionScopeKey,
} from "@murphai/hosted-execution/vault-share";
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
  members: [],
  requestedVaultShareProjectionKinds: ["sleep-times.v0" as const],
  status: "active",
};
const RENAMED_GROUP_SUMMARY = {
  ...GROUP_SUMMARY,
  displayName: "Weekly Health Crew",
};
const SLEEP_SCOPE = { projectionKind: "sleep-times.v0" } as const;
const SLEEP_DURATION_SCOPE = { projectionKind: "sleep-duration-days.v0" } as const;
const PROTEIN_SCOPE = { projectionKind: "protein-days.v0" } as const;
const RUNNING_SCOPE = buildHostedVaultShareActivityMinutesProjectionScope({
  activityKind: "running",
});
const RUNNING_DISTANCE_SCOPE = buildHostedVaultShareActivityDistanceProjectionScope({
  activityKind: "running",
});
const RUNNING_SESSION_COUNT_SCOPE = buildHostedVaultShareActivitySessionCountProjectionScope({
  activityKind: "running",
});
const GROUP_RUNTIME_LINQ_THREAD = {
  authority: {
    accountLookupKey: "hplk_group_runtime",
    channel: "linq" as const,
    containerMemberId: "member_group_runtime",
    threadId: "chat_group_runtime",
  },
  chatId: "chat_group_runtime",
};
const NEWSLETTER_DEFAULT_SCOPES = [
  { projectionKind: "group-email.v0" },
  { projectionKind: "sleep-duration-days.v0" },
  { projectionKind: "activity-days.v0" },
  { projectionKind: "workout-days.v0" },
  { projectionKind: "resting-heart-rate-days.v0" },
  { projectionKind: "hrv-days.v0" },
] as const;
const DISCLOSURE_ORIGIN_ASSISTANT_INPUT_ID = `ain_${"d".repeat(32)}`;

function groupSummaryWithOwnerEmailGrant() {
  return {
    ...GROUP_SUMMARY,
    members: [{
      grantedVaultShareProjectionKinds: ["profile-name.v0" as const, "group-email.v0" as const],
      handle: null,
      memberId: "member_owner",
      role: "owner",
    }],
  };
}

describe("handleHostedRuntimeGroupTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canonicalizeHostedGroupDisclosurePermissionText.mockImplementation(
      (value: string) => value.replaceAll("\r\n", "\n").trim(),
    );
    mocks.createHostedGroupDisclosurePermissionProviderIdempotencyKey.mockReturnValue(
      "group-disclosure:provider-request-1",
    );
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.leaveHostedGroupMemberTx.mockResolvedValue({ kind: "left" });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.readHostedGroupByRuntimeMemberId.mockResolvedValue(GROUP_SUMMARY);
    mocks.readHostedGroupIdByRuntimeMemberId.mockResolvedValue("hgrp_123");
    mocks.readHostedGroupSharedDataByRuntimeMemberId.mockResolvedValue({
      members: [],
      requestedProjectionScopeKeys: ["steps-days.v0"],
      status: "ok",
    });
    mocks.readHostedGroupMembershipsForMember.mockResolvedValue({
      memberships: [{
        displayName: "Fun-loving runners",
        grantedVaultShareProjectionScopes: [
          { projectionKind: "profile-name.v0" },
          { projectionKind: "group-email.v0" },
        ],
        kind: "friends",
        memberCount: 7,
        membershipId: "membership_runners",
        ownerJoinCode: null,
        requestedVaultShareProjectionScopes: [
          { projectionKind: "group-email.v0" },
          { projectionKind: "hrv-days.v0" },
        ],
        role: "member",
      }],
      truncated: false,
    });
    mocks.readHostedGroupUsageStatus.mockResolvedValue({
      capacityState: "low",
      fundingUrl: "https://www.withmurph.ai/groups/fund/group_join_code_1234",
      periodEnd: "2026-08-01T00:00:00.000Z",
      remainingPercent: 20,
    });
    mocks.revokeHostedGroupMemberEmailShareTx.mockResolvedValue({
      groupId: "hgrp_123",
      kind: "ok",
      revokedCount: 1,
    });
    mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx
      .mockResolvedValue(RENAMED_GROUP_SUMMARY);
    mocks.updateHostedLinqChatDisplayName.mockResolvedValue(undefined);
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
    mocks.prepareHostedGroupJoinOfferPostTx.mockResolvedValue({
      joinCode: "abc123",
      kind: "post",
    });
    mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort.mockResolvedValue(
      undefined,
    );
    mocks.recordHostedGroupJoinOfferTx.mockResolvedValue({
      groupId: GROUP_SUMMARY.id,
      messageIdSuffix: "offer_msg",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      projectionKinds: ["sleep-times.v0"],
    });
    mocks.admitHostedGroupDisclosurePermissionAppendTx.mockResolvedValue({
      kind: "accepted",
    });
    mocks.recordHostedGroupDisclosurePermissionTx.mockResolvedValue({
      kind: "recorded",
    });
    mocks.readActiveHostedGroupDisclosureGrantsForMember.mockResolvedValue([]);
    mocks.readActiveHostedGroupDisclosureGrantsForGroup.mockResolvedValue([]);
    mocks.revokeHostedGroupDisclosureGrantForMemberTx.mockResolvedValue({
      kind: "revoked",
      revokedAt: new Date("2026-07-16T12:00:00Z"),
    });
    mocks.requestHostedGroupAssistantAsk.mockResolvedValue({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "not_configured" },
    });
    mocks.requestHostedGroupMemberAssistantAsk.mockResolvedValue({
      mailboxWake: null,
      result: { status: "unavailable", unavailableReason: "not_configured" },
    });
  });

  it("classifies group-tool actions by access authority", () => {
    expect(HOSTED_RUNTIME_GROUP_TOOL_ACCESS_CLASSIFICATION).toEqual({
      ask: "personal_active",
      ask_member: "participant_aware",
      create_join_link: "owner_active",
      leave_membership: "participant_aware",
      list_memberships: "personal_active",
      post_disclosure_request: "owner_active",
      post_join_offer: "owner_active",
      preflight_set_chat_avatar: "owner_active",
      read_chat_participants: "participant_aware",
      read_current: "participant_aware",
      revoke_disclosure_grant: "personal_active",
      read_usage: "participant_aware",
      read_shared: "participant_aware",
      revoke_own_email_share: "participant_aware",
      set_chat_avatar: "owner_active",
      share_contact_card: "owner_active",
      update_display_name: "owner_active",
    });
  });

  it("returns currency-free quantified usage and the first-party group funding link", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_usage" },
    })).resolves.toEqual({
      action: "read_usage",
      result: {
        status: "ok",
        usage: {
          capacityState: "low",
          fundingUrl:
            "https://www.withmurph.ai/groups/fund/group_join_code_1234",
          periodEnd: "2026-08-01T00:00:00.000Z",
          remainingPercent: 20,
        },
      },
    });
    expect(mocks.readHostedGroupUsageStatus).toHaveBeenCalledWith({
      runtimeMemberId: "member_group_runtime",
    });
  });

  it("dispatches a personal ask and schedules only its committed mailbox wake", async () => {
    const scheduleMailboxWake = vi.fn();
    mocks.requestHostedGroupAssistantAsk.mockResolvedValue({
      mailboxWake: {
        expectedUserId: "member_group_runtime",
        mailboxItemId: "aask_req_one",
      },
      result: { status: "accepted", targetLabel: "100 Club" },
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_self",
      request: {
        action: "ask",
        groupLabel: "100 Club",
        originAssistantInputId: `ain_${"a".repeat(32)}`,
        originSessionId: "session_private",
        question: "What is today's workout?",
      },
      scheduleMailboxWake,
    })).resolves.toEqual({
      action: "ask",
      result: { status: "accepted", targetLabel: "100 Club" },
    });

    expect(mocks.requestHostedGroupAssistantAsk).toHaveBeenCalledWith({
      groupLabel: "100 Club",
      memberId: "member_self",
      originAssistantInputId: `ain_${"a".repeat(32)}`,
      originSessionId: "session_private",
      question: "What is today's workout?",
    });
    expect(scheduleMailboxWake).toHaveBeenCalledWith({
      expectedUserId: "member_group_runtime",
      mailboxItemId: "aask_req_one",
    });
  });

  it("dispatches a grant-bound group ask and schedules only its committed private wake", async () => {
    const scheduleMailboxWake = vi.fn();
    mocks.requestHostedGroupMemberAssistantAsk.mockResolvedValue({
      mailboxWake: {
        expectedUserId: "member_grantor",
        mailboxItemId: "aask_req_disclosure_one",
      },
      result: { status: "accepted" },
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "ask_member",
        grantId: "grant_sleep",
        origin: {
          assistantInputId: `ain_${"b".repeat(32)}`,
          kind: "accepted_input",
          sessionId: "session_group",
        },
        question: "How has the grantor been sleeping lately?",
      },
      scheduleMailboxWake,
    })).resolves.toEqual({
      action: "ask_member",
      result: { status: "accepted" },
    });

    expect(mocks.requestHostedGroupMemberAssistantAsk).toHaveBeenCalledWith({
      grantId: "grant_sleep",
      memberId: "member_group_runtime",
      origin: {
        assistantInputId: `ain_${"b".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_group",
      },
      question: "How has the grantor been sleeping lately?",
    });
    expect(scheduleMailboxWake).toHaveBeenCalledWith({
      expectedUserId: "member_grantor",
      mailboxItemId: "aask_req_disclosure_one",
    });
  });

  it("revokes grants only for the signed personal member", async () => {
    mocks.hostedThreadContainerFindUnique.mockResolvedValue(null);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_self",
      request: {
        action: "revoke_disclosure_grant",
        grantId: "grant_sleep",
      },
    })).resolves.toEqual({
      action: "revoke_disclosure_grant",
      result: { status: "revoked" },
    });

    expect(mocks.revokeHostedGroupDisclosureGrantForMemberTx).toHaveBeenCalledWith({
      grantId: "grant_sleep",
      memberId: "member_self",
      now: expect.any(Date),
      tx: fakeTx,
    });
  });

  it("keeps grant management unavailable to group runtimes", async () => {
    for (const request of [
      { action: "list_memberships" as const },
      { action: "revoke_disclosure_grant" as const, grantId: "grant_sleep" },
    ]) {
      const response = await handleHostedRuntimeGroupTool({
        memberId: "member_group_runtime",
        request,
      });
      expect(response.result).toMatchObject({
        status: "unavailable",
        unavailableReason: "personal_runtime_required",
      });
    }
    expect(mocks.readActiveHostedGroupDisclosureGrantsForMember).not.toHaveBeenCalled();
    expect(mocks.revokeHostedGroupDisclosureGrantForMemberTx).not.toHaveBeenCalled();
  });

  it("lists the current member's group grants without exposing a member-held invite link", async () => {
    mocks.hostedThreadContainerFindUnique.mockResolvedValue(null);
    mocks.readActiveHostedGroupDisclosureGrantsForMember.mockResolvedValue([{
      grantId: "grant_sleep",
      groupLabel: "Fun-loving runners",
      permissionText: "Recent sleep timing and duration",
    }]);
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_self",
      request: { action: "list_memberships" },
    })).resolves.toEqual({
      action: "list_memberships",
      result: {
        disclosureGrants: [{
          grantId: "grant_sleep",
          groupLabel: "Fun-loving runners",
          permissionText: "Recent sleep timing and duration",
        }],
        memberships: [{
          displayName: "Fun-loving runners",
          grantedVaultShareProjectionScopes: [
            { projectionKind: "profile-name.v0" },
            { projectionKind: "group-email.v0" },
          ],
          kind: "friends",
          memberCount: 7,
          membershipId: "membership_runners",
          permissionsUrl: null,
          requestedVaultShareProjectionScopes: [
            { projectionKind: "group-email.v0" },
            { projectionKind: "hrv-days.v0" },
          ],
          role: "member",
        }],
        status: "ok",
        truncated: false,
      },
    });

    expect(mocks.readHostedGroupMembershipsForMember).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "member_self" }),
    );
    expect(mocks.readActiveHostedGroupDisclosureGrantsForMember).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "member_self" }),
    );
  });

  it("returns an existing join link as a permissions URL only to the group owner", async () => {
    mocks.hostedThreadContainerFindUnique.mockResolvedValue(null);
    mocks.readHostedGroupMembershipsForMember.mockResolvedValue({
      memberships: [{
        displayName: "Fun-loving runners",
        grantedVaultShareProjectionScopes: [{ projectionKind: "profile-name.v0" }],
        kind: "friends",
        memberCount: 7,
        membershipId: "membership_runners_owner",
        ownerJoinCode: "join_runners",
        requestedVaultShareProjectionScopes: [{ projectionKind: "hrv-days.v0" }],
        role: "owner",
      }],
      truncated: false,
    });

    const response = await handleHostedRuntimeGroupTool({
      memberId: "member_owner",
      request: { action: "list_memberships" },
    });

    expect(response.action).toBe("list_memberships");
    expect(response.result).toMatchObject({
      memberships: [{
        permissionsUrl: "https://www.withmurph.ai/groups/join/join_runners",
        role: "owner",
      }],
      status: "ok",
    });
  });

  it("fails personal membership reads closed for an inactive runtime", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_self",
      request: { action: "list_memberships" },
    })).resolves.toEqual({
      action: "list_memberships",
      result: {
        memberships: null,
        status: "unavailable",
        unavailableReason: "runtime_inactive",
      },
    });
    expect(mocks.readHostedGroupMembershipsForMember).not.toHaveBeenCalled();
  });

  it("leaves only the callback member's selected membership", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_self",
      request: {
        action: "leave_membership",
        membershipId: "membership_runners",
      },
    })).resolves.toEqual({
      action: "leave_membership",
      result: { status: "left" },
    });

    expect(mocks.leaveHostedGroupMemberTx).toHaveBeenCalledWith({
      memberId: "member_self",
      membershipId: "membership_runners",
      now: expect.any(Date),
      tx: fakeTx,
    });
    expect(mocks.hasHostedRuntimeActiveAccess).not.toHaveBeenCalled();
  });

  it.each(["already_left", "owner_cannot_leave"] as const)(
    "returns the %s membership leave outcome",
    async (kind) => {
      mocks.leaveHostedGroupMemberTx.mockResolvedValueOnce({ kind });

      await expect(handleHostedRuntimeGroupTool({
        memberId: "member_self",
        request: {
          action: "leave_membership",
          membershipId: "membership_runners",
        },
      })).resolves.toEqual({
        action: "leave_membership",
        result: { status: kind },
      });
    },
  );

  it("attaches active grants only to their current roster member", async () => {
    const currentGroup = {
      ...GROUP_SUMMARY,
      members: [{
        grantedVaultShareProjectionKinds: [],
        grantedVaultShareProjectionScopes: [],
        handle: "+15550000001",
        memberId: "member_grantor",
        role: "member",
      }, {
        grantedVaultShareProjectionKinds: [],
        grantedVaultShareProjectionScopes: [],
        handle: "+15550000002",
        memberId: "member_without_grant",
        role: "member",
      }],
    };
    mocks.readHostedGroupByRuntimeMemberId.mockResolvedValue(currentGroup);
    mocks.readActiveHostedGroupDisclosureGrantsForGroup.mockResolvedValue([{
      grantId: "grant_calendar",
      groupLabel: "Sunday sleep crew",
      memberId: "member_grantor",
      permissionText: "Calendar availability for coordinating a call",
    }]);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_current" },
    })).resolves.toEqual({
      action: "read_current",
      result: {
        group: {
          ...currentGroup,
          members: [{
            ...currentGroup.members[0],
            disclosureGrants: [{
              grantId: "grant_calendar",
              permissionText: "Calendar availability for coordinating a call",
            }],
          }, {
            ...currentGroup.members[1],
            disclosureGrants: [],
          }],
        },
        status: "ok",
      },
    });

    expect(mocks.readHostedGroupByRuntimeMemberId).toHaveBeenCalledWith({
      runtimeMemberId: "member_group_runtime",
    });
    expect(mocks.readActiveHostedGroupDisclosureGrantsForGroup).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
    });
  });

  it("reads current consent-filtered shared data for the runtime member", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "read_shared",
        linqSenderHandles: ["+15551110001", "member@example.test"],
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      },
    })).resolves.toEqual({
      action: "read_shared",
      result: {
        members: [],
        requestedProjectionScopeKeys: ["steps-days.v0"],
        status: "ok",
      },
    });

    expect(mocks.readHostedGroupSharedDataByRuntimeMemberId).toHaveBeenCalledWith({
      linqSenderHandles: ["+15551110001", "member@example.test"],
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
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

  it("updates the current hosted group display name for the active group runtime", async () => {
    mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx.mockResolvedValueOnce({
      ...groupSummaryWithOwnerEmailGrant(),
      displayName: RENAMED_GROUP_SUMMARY.displayName,
    });
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "update_display_name",
        linqThread: GROUP_RUNTIME_LINQ_THREAD,
        updateDisplayName: {
          displayName: "  Weekly   Health Crew  ",
        },
      },
    })).resolves.toEqual({
      action: "update_display_name",
      result: {
        group: {
          ...groupSummaryWithOwnerEmailGrant(),
          displayName: RENAMED_GROUP_SUMMARY.displayName,
        },
        status: "ok",
      },
    });

    expect(mocks.assertHostedLinqRouteEgressAuthority).toHaveBeenCalledWith(
      expect.objectContaining({ authority: GROUP_RUNTIME_LINQ_THREAD.authority }),
    );
    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledWith(expect.objectContaining({
      memberId: "member_owner",
    }));
    expect(mocks.readHostedGroupIdByRuntimeMemberId).toHaveBeenCalledWith({
      runtimeMemberId: "member_group_runtime",
    });
    expect(mocks.readHostedGroupByRuntimeMemberId).not.toHaveBeenCalled();
    expect(mocks.updateHostedLinqChatDisplayName).toHaveBeenCalledWith({
      chatId: "chat_group_runtime",
      displayName: "Weekly Health Crew",
    });
    expect(mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        displayName: "Weekly Health Crew",
        runtimeMemberId: "member_group_runtime",
        tx: fakeTx,
      }));
    expect(mocks.readActiveHostedGroupDisclosureGrantsForGroup)
      .not.toHaveBeenCalled();
    expect(
      mocks.updateHostedLinqChatDisplayName.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx.mock.invocationCallOrder[0],
    );
  });

  it("does not update the group display name when runtime access is inactive", async () => {
    mocks.hostedThreadContainerFindUnique.mockResolvedValue({
      member: { suspendedAt: new Date("2026-07-06T12:00:00Z") },
      ownerMemberId: "member_owner",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "update_display_name",
        linqThread: GROUP_RUNTIME_LINQ_THREAD,
        updateDisplayName: { displayName: "Blocked name" },
      },
    })).resolves.toEqual({
      action: "update_display_name",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "runtime_inactive",
      },
    });

    expect(mocks.updateHostedLinqChatDisplayName).not.toHaveBeenCalled();
    expect(mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx).not.toHaveBeenCalled();
  });

  it("reports group_not_found when the active runtime has no hosted group to rename", async () => {
    mocks.readHostedGroupIdByRuntimeMemberId.mockResolvedValue(null);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "update_display_name",
        linqThread: GROUP_RUNTIME_LINQ_THREAD,
        updateDisplayName: { displayName: "Unattached group" },
      },
    })).resolves.toEqual({
      action: "update_display_name",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "group_not_found",
      },
    });

    expect(mocks.updateHostedLinqChatDisplayName).not.toHaveBeenCalled();
    expect(mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx).not.toHaveBeenCalled();
  });

  it("does not update the hosted group display name when the provider rejects the chat rename", async () => {
    mocks.updateHostedLinqChatDisplayName.mockRejectedValue(new Error("linq down"));

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "update_display_name",
        linqThread: GROUP_RUNTIME_LINQ_THREAD,
        updateDisplayName: { displayName: "Provider blocked name" },
      },
    })).resolves.toEqual({
      action: "update_display_name",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "provider_unavailable",
      },
    });

    expect(mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx).not.toHaveBeenCalled();
  });

  it("creates a join link bound to the runtime member's thread container owner", async () => {
    mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx.mockResolvedValueOnce({
      group: groupSummaryWithOwnerEmailGrant(),
      joinCode: "abc123",
    });
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
        group: groupSummaryWithOwnerEmailGrant(),
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
        requestedVaultShareProjectionScopes: [SLEEP_SCOPE],
      }),
    );
    expect(mocks.readActiveHostedGroupDisclosureGrantsForGroup)
      .not.toHaveBeenCalled();
    expect(mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort)
      .toHaveBeenCalledWith({
        groupId: GROUP_SUMMARY.id,
        memberId: "member_owner",
        prisma: expect.any(Object),
      });
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

describe("filterHostedRuntimeGroupToolResponseProjectionScopes", () => {
  const groupWithSelectorScopes = {
    ...GROUP_SUMMARY,
    members: [{
      disclosureGrants: [],
      grantedVaultShareProjectionKinds: [
        "sleep-times.v0" as const,
        RUNNING_DISTANCE_SCOPE.projectionKind,
      ],
      grantedVaultShareProjectionScopes: [SLEEP_SCOPE, RUNNING_DISTANCE_SCOPE],
      handle: null,
      memberId: "member_runner",
      role: "member",
    }],
    requestedVaultShareProjectionKinds: [
      "sleep-times.v0" as const,
      RUNNING_DISTANCE_SCOPE.projectionKind,
    ],
    requestedVaultShareProjectionScopes: [SLEEP_SCOPE, RUNNING_DISTANCE_SCOPE],
  };

  it("hides unsupported selector scopes from legacy group-tool callers", () => {
    const filtered = filterHostedRuntimeGroupToolResponseProjectionScopes({
      action: "read_current",
      result: {
        group: groupWithSelectorScopes,
        status: "ok",
      },
    }, new Set([buildHostedVaultShareProjectionScopeKey(SLEEP_SCOPE)]));

    expect(filtered).toEqual({
      action: "read_current",
      result: {
        group: {
          ...groupWithSelectorScopes,
          members: [{
            ...groupWithSelectorScopes.members[0],
            grantedVaultShareProjectionKinds: ["sleep-times.v0"],
            grantedVaultShareProjectionScopes: [SLEEP_SCOPE],
          }],
          requestedVaultShareProjectionKinds: ["sleep-times.v0"],
          requestedVaultShareProjectionScopes: [SLEEP_SCOPE],
        },
        status: "ok",
      },
    });
  });

  it("filters requested and granted scopes in personal membership results", () => {
    const filtered = filterHostedRuntimeGroupToolResponseProjectionScopes({
      action: "list_memberships",
      result: {
        disclosureGrants: [],
        memberships: [{
          displayName: "Sunday runners",
          grantedVaultShareProjectionScopes: [
            { projectionKind: "profile-name.v0" },
            RUNNING_DISTANCE_SCOPE,
          ],
          kind: "friends",
          memberCount: 4,
          membershipId: "membership_runners",
          permissionsUrl: "https://www.withmurph.ai/groups/join/abc123",
          requestedVaultShareProjectionScopes: [SLEEP_SCOPE, RUNNING_DISTANCE_SCOPE],
          role: "member",
        }],
        status: "ok",
        truncated: false,
      },
    }, new Set([
      buildHostedVaultShareProjectionScopeKey({ projectionKind: "profile-name.v0" }),
      buildHostedVaultShareProjectionScopeKey(SLEEP_SCOPE),
    ]));

    expect(filtered).toEqual({
      action: "list_memberships",
      result: {
        disclosureGrants: [],
        memberships: [{
          displayName: "Sunday runners",
          grantedVaultShareProjectionScopes: [{ projectionKind: "profile-name.v0" }],
          kind: "friends",
          memberCount: 4,
          membershipId: "membership_runners",
          permissionsUrl: "https://www.withmurph.ai/groups/join/abc123",
          requestedVaultShareProjectionScopes: [SLEEP_SCOPE],
          role: "member",
        }],
        status: "ok",
        truncated: false,
      },
    });
  });

  it("keeps selector scopes for current group-tool callers", () => {
    const filtered = filterHostedRuntimeGroupToolResponseProjectionScopes({
      action: "create_join_link",
      result: {
        group: groupWithSelectorScopes,
        joinUrl: "https://www.withmurph.ai/groups/join/abc123",
        status: "ok",
      },
    }, new Set([
      buildHostedVaultShareProjectionScopeKey(SLEEP_SCOPE),
      buildHostedVaultShareProjectionScopeKey(RUNNING_DISTANCE_SCOPE),
    ]));

    expect(filtered).toEqual({
      action: "create_join_link",
      result: {
        group: groupWithSelectorScopes,
        joinUrl: "https://www.withmurph.ai/groups/join/abc123",
        status: "ok",
      },
    });
  });
});

describe("hosted group join policy", () => {
  it("keeps email and optional health sharing on the closed projection registry", () => {
    expect(readHostedGroupJoinPolicy({
      requestedVaultShareProjectionKinds: ["sleep-times.v0", "activity-days.v0"],
      schema: "murph.hosted-group.join-policy.v1",
    })).toEqual({
      requestedVaultShareProjectionKinds: ["sleep-times.v0", "activity-days.v0"],
      requestedVaultShareProjectionScopes: [
        { projectionKind: "sleep-times.v0" },
        { projectionKind: "activity-days.v0" },
      ],
      schema: "murph.hosted-group.join-policy.v1",
    });

    expect(mergeHostedGroupJoinPolicy({
      existing: {
        requestedVaultShareProjectionKinds: ["sleep-times.v0"],
        schema: "murph.hosted-group.join-policy.v1",
      },
      requestedVaultShareProjectionScopes: [
        { projectionKind: "activity-days.v0" },
        { projectionKind: "sleep-times.v0" },
      ],
    }).requestedVaultShareProjectionScopes).toEqual([
      { projectionKind: "sleep-times.v0" },
      { projectionKind: "activity-days.v0" },
    ]);

    expect(readHostedGroupJoinPolicy({
      requestedVaultShareProjectionKinds: ["all-health-data"],
      schema: "murph.hosted-group.join-policy.v1",
    }).requestedVaultShareProjectionKinds).toEqual([]);

    expect(projectHostedVaultShareProjectionDisplays([
      { projectionKind: "group-email.v0" },
      { projectionKind: "sleep-times.v0" },
      SLEEP_DURATION_SCOPE,
      { projectionKind: "activity-days.v0" },
      RUNNING_SCOPE,
      RUNNING_DISTANCE_SCOPE,
      RUNNING_SESSION_COUNT_SCOPE,
      { projectionKind: "heart-rate-zones-days.v0" },
      PROTEIN_SCOPE,
    ])).toEqual([
      {
        description:
          "Shares your email so the group's Murph can send the newsletter. Visible to the group.",
        label: "Email address",
        projectionKind: "group-email.v0",
        projectionScope: { projectionKind: "group-email.v0" },
        projectionScopeKey: "group-email.v0",
      },
      {
        description: "Shares your last 7 days of sleep start and end times.",
        label: "Sleep timing",
        projectionKind: "sleep-times.v0",
        projectionScope: { projectionKind: "sleep-times.v0" },
        projectionScopeKey: "sleep-times.v0",
      },
      {
        description: "Shares your last 7 days of total sleep duration.",
        label: "Sleep duration",
        projectionKind: "sleep-duration-days.v0",
        projectionScope: SLEEP_DURATION_SCOPE,
        projectionScopeKey: "sleep-duration-days.v0",
      },
      {
        description: "Shares your last 7 days of active minutes.",
        label: "Activity minutes",
        projectionKind: "activity-days.v0",
        projectionScope: { projectionKind: "activity-days.v0" },
        projectionScopeKey: "activity-days.v0",
      },
      {
        description: "Shares your last 7 days of heart-rate zone minutes.",
        label: "Heart-rate zones",
        projectionKind: "heart-rate-zones-days.v0",
        projectionScope: { projectionKind: "heart-rate-zones-days.v0" },
        projectionScopeKey: "heart-rate-zones-days.v0",
      },
      {
        description:
          "Shares your last 7 days of daily protein totals from meals you logged with Murph.",
        label: "Daily protein",
        projectionKind: "protein-days.v0",
        projectionScope: PROTEIN_SCOPE,
        projectionScopeKey: "protein-days.v0",
      },
      {
        description: "Shares your last 7 days of running minutes.",
        label: "Running minutes",
        projectionKind: "activity-minutes-days.v1",
        projectionScope: RUNNING_SCOPE,
        projectionScopeKey: buildHostedVaultShareProjectionScopeKey(RUNNING_SCOPE),
      },
      {
        description: "Shares daily running distance and session count.",
        label: "Recent running distance and session count",
        projectionKind: "activity-distance-days.v1",
        projectionScope: RUNNING_DISTANCE_SCOPE,
        projectionScopeKey: buildHostedVaultShareProjectionScopeKey(RUNNING_DISTANCE_SCOPE),
      },
      {
        description: "Shares daily running session count.",
        label: "Recent running session count",
        projectionKind: "activity-session-count-days.v1",
        projectionScope: RUNNING_SESSION_COUNT_SCOPE,
        projectionScopeKey: buildHostedVaultShareProjectionScopeKey(RUNNING_SESSION_COUNT_SCOPE),
      },
    ]);

    expect(HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES)
      .toContainEqual(PROTEIN_SCOPE);
    expect(projectHostedVaultShareProjectionDisplays(
      HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
    ).map((entry) => entry.projectionScopeKey)).toEqual([
      ...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES
        .map((scope) => buildHostedVaultShareProjectionScopeKey(scope)),
    ]);

    expect(projectHostedVaultShareProjectionDisplays([
      { projectionKind: "device-sync-status.v0" },
    ])).toEqual([
      {
        description:
          "Shares which health sources are connected. No health values.",
        label: "Health source connection status",
        projectionKind: "device-sync-status.v0",
        projectionScope: { projectionKind: "device-sync-status.v0" },
        projectionScopeKey: "device-sync-status.v0",
      },
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
    mocks.canonicalizeHostedGroupDisclosurePermissionText.mockImplementation(
      (value: string) => value.replaceAll("\r\n", "\n").trim(),
    );
    mocks.createHostedGroupDisclosurePermissionProviderIdempotencyKey.mockReturnValue(
      "group-disclosure:provider-request-1",
    );
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
    mocks.readHostedGroupIdByRuntimeMemberId.mockResolvedValue(GROUP_SUMMARY.id);
    mocks.admitHostedGroupDisclosurePermissionAppendTx.mockResolvedValue({
      kind: "accepted",
    });
    mocks.recordHostedGroupDisclosurePermissionTx.mockResolvedValue({
      kind: "recorded",
    });
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
    mocks.updateHostedLinqChatAvatar.mockResolvedValue(undefined);
    mocks.updateHostedLinqChatDisplayName.mockResolvedValue(undefined);
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

  it("updates the current authorized iMessage group avatar", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "set_chat_avatar",
        groupChatIconUrl: "https://imagedelivery.net/account/avatar/public",
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "set_chat_avatar",
      result: { status: "requested" },
    });

    expect(mocks.assertHostedLinqRouteEgressAuthority).toHaveBeenCalledWith(
      expect.objectContaining({ authority: LINQ_THREAD.authority }),
    );
    expect(mocks.updateHostedLinqChatAvatar).toHaveBeenCalledWith({
      chatId: "chat_group_1",
      groupChatIconUrl: "https://imagedelivery.net/account/avatar/public",
    });
  });

  it("rejects external HTTPS group avatar URLs before calling Linq", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "set_chat_avatar",
        groupChatIconUrl: "https://example.com/avatar.png",
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "set_chat_avatar",
      result: {
        status: "unavailable",
        unavailableReason: "group_chat_icon_url_unavailable",
      },
    });

    expect(mocks.updateHostedLinqChatAvatar).not.toHaveBeenCalled();
  });

  it("preflights group avatar access without updating Linq", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "preflight_set_chat_avatar",
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "preflight_set_chat_avatar",
      result: { status: "ok" },
    });

    expect(mocks.assertHostedLinqRouteEgressAuthority).toHaveBeenCalledWith(
      expect.objectContaining({ authority: LINQ_THREAD.authority }),
    );
    expect(mocks.updateHostedLinqChatAvatar).not.toHaveBeenCalled();
  });

  it("does not update the group avatar when the owner lacks active access", async () => {
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "set_chat_avatar",
        groupChatIconUrl: "https://imagedelivery.net/account/avatar/public",
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "set_chat_avatar",
      result: {
        status: "unavailable",
        unavailableReason: "owner_unavailable",
      },
    });

    expect(mocks.updateHostedLinqChatAvatar).not.toHaveBeenCalled();
  });

  it("reports group avatar provider failures as structured unavailability", async () => {
    mocks.updateHostedLinqChatAvatar.mockRejectedValue(new Error("linq down"));

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "set_chat_avatar",
        groupChatIconUrl: "https://imagedelivery.net/account/avatar/public",
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "set_chat_avatar",
      result: {
        status: "unavailable",
        unavailableReason: "provider_unavailable",
      },
    });
  });

  it("does not send a fresh disclosure request when permission history is full", async () => {
    mocks.admitHostedGroupDisclosurePermissionAppendTx.mockResolvedValueOnce({
      kind: "limit_reached",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_disclosure_request",
        linqThread: LINQ_THREAD,
        originAssistantInputId: DISCLOSURE_ORIGIN_ASSISTANT_INPUT_ID,
        permissionText: "Recent sleep timing and duration",
      },
    })).resolves.toEqual({
      action: "post_disclosure_request",
      result: {
        status: "unavailable",
        unavailableReason: "permission_history_limit_reached",
      },
    });

    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.recordHostedGroupDisclosurePermissionTx).not.toHaveBeenCalled();
  });

  it("reports a binding-time permission history race after the inert provider send", async () => {
    mocks.recordHostedGroupDisclosurePermissionTx.mockResolvedValueOnce({
      kind: "limit_reached",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_disclosure_request",
        linqThread: LINQ_THREAD,
        originAssistantInputId: DISCLOSURE_ORIGIN_ASSISTANT_INPUT_ID,
        permissionText: "Recent sleep timing and duration",
      },
    })).resolves.toEqual({
      action: "post_disclosure_request",
      result: {
        status: "unavailable",
        unavailableReason: "permission_history_limit_reached",
      },
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedGroupDisclosurePermissionTx).toHaveBeenCalledTimes(1);
  });

  it("rechecks the current Linq route immediately before sending disclosure consent", async () => {
    mocks.assertHostedLinqRouteEgressAuthority
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("stale route"));

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_disclosure_request",
        linqThread: LINQ_THREAD,
        originAssistantInputId: DISCLOSURE_ORIGIN_ASSISTANT_INPUT_ID,
        permissionText: "Recent sleep timing and duration",
      },
    })).resolves.toEqual({
      action: "post_disclosure_request",
      result: {
        status: "unavailable",
        unavailableReason: "linq_thread_unauthorized",
      },
    });

    expect(mocks.assertHostedLinqRouteEgressAuthority).toHaveBeenCalledTimes(2);
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.recordHostedGroupDisclosurePermissionTx).not.toHaveBeenCalled();
  });

  it("posts and binds fixed exact-permission disclosure consent copy", async () => {
    const request = {
      memberId: "member_container",
      request: {
        action: "post_disclosure_request",
        linqThread: LINQ_THREAD,
        originAssistantInputId: DISCLOSURE_ORIGIN_ASSISTANT_INPUT_ID,
        permissionText: "  Recent sleep timing and duration  ",
      },
    } as const;
    await expect(handleHostedRuntimeGroupTool(request)).resolves.toEqual({
      action: "post_disclosure_request",
      result: { status: "sent" },
    });
    await expect(handleHostedRuntimeGroupTool(request)).resolves.toEqual({
      action: "post_disclosure_request",
      result: { status: "sent" },
    });

    expect(mocks.assertHostedLinqRouteEgressAuthority).toHaveBeenCalledWith(
      expect.objectContaining({ authority: LINQ_THREAD.authority }),
    );
    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "member_owner" }),
    );
    expect(
      mocks.createHostedGroupDisclosurePermissionProviderIdempotencyKey,
    ).toHaveBeenCalledWith({
      consentMessage: [
        "Like this message to let this group ask your Murph for:",
        "",
        "Recent sleep timing and duration",
        "",
        "Only this exact permission is granted. Before an answer from your Murph is shared here, a separate outgoing reviewer checks it against this permission. Incoming questions do not go through a separate reviewer. You can revoke this permission at any time.",
      ].join("\n"),
      groupId: GROUP_SUMMARY.id,
      originAssistantInputId: DISCLOSURE_ORIGIN_ASSISTANT_INPUT_ID,
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith({
      chatId: "chat_group_1",
      idempotencyKey: "group-disclosure:provider-request-1",
      message: [
        "Like this message to let this group ask your Murph for:",
        "",
        "Recent sleep timing and duration",
        "",
        "Only this exact permission is granted. Before an answer from your Murph is shared here, a separate outgoing reviewer checks it against this permission. Incoming questions do not go through a separate reviewer. You can revoke this permission at any time.",
      ].join("\n"),
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);
    expect(mocks.recordHostedGroupDisclosurePermissionTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      messageId: "msg_offer_1",
      originAssistantInputId: DISCLOSURE_ORIGIN_ASSISTANT_INPUT_ID,
      permissionText: "Recent sleep timing and duration",
      postedAt: expect.any(Date),
      tx: fakeTx,
    });
  });

  it("ignores arbitrary legacy copy and posts a canonical offer matching the stored snapshot", async () => {
    mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx.mockResolvedValueOnce({
      group: groupSummaryWithOwnerEmailGrant(),
      joinCode: "abc123",
    });
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: {
          displayName: "Sunday Sleep Crew",
          messageTemplate: "Share every secret with everyone forever.",
          projectionKinds: [
            "group-email.v0",
            "sleep-duration-days.v0",
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
        group: groupSummaryWithOwnerEmailGrant(),
        joinUrl: "https://www.withmurph.ai/groups/join/abc123",
        status: "sent",
      },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).toHaveBeenCalledWith(
      expect.objectContaining({
        actorMemberId: "member_owner",
        containerMemberId: "member_container",
        displayName: "Sunday Sleep Crew",
        requestedVaultShareProjectionScopes: NEWSLETTER_DEFAULT_SCOPES,
        tx: fakeTx,
      }),
    );
    expect(mocks.readActiveHostedGroupDisclosureGrantsForGroup)
      .not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_group_1",
        idempotencyKey: expect.stringMatching(/^group-join-offer:v2:[a-f0-9]{40}$/u),
        message:
          "Like or heart this message to share the following with this group: your Murph profile name, email address, sleep duration, activity minutes, workout summaries, resting heart rate, and HRV. To choose different permissions, use https://www.withmurph.ai/groups/join/abc123.",
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.not.stringContaining("Share every secret"),
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
      projectionScopes: NEWSLETTER_DEFAULT_SCOPES,
      tx: fakeTx,
    });
    expect(mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort)
      .toHaveBeenCalledWith({
        groupId: GROUP_SUMMARY.id,
        memberId: "member_owner",
        prisma: expect.any(Object),
      });
    expect(mocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

  it("uses the diagnostic disclosure for the exact frozen offer snapshot", async () => {
    const diagnosticScopes = [{ projectionKind: "device-sync-status.v0" as const }];

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: { projectionScopes: diagnosticScopes },
        linqThread: LINQ_THREAD,
      },
    })).resolves.toMatchObject({
      action: "post_join_offer",
      result: { status: "sent" },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedVaultShareProjectionScopes: diagnosticScopes,
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Like or heart this message to share the following with this group: your Murph profile name and health source connection status. To choose different permissions, use https://www.withmurph.ai/groups/join/abc123.",
      }),
    );
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      messageId: "msg_offer_1",
      postedAt: expect.any(Date),
      projectionScopes: diagnosticScopes,
      tx: fakeTx,
    });
  });

  it("reuses an active covering offer without another provider send", async () => {
    const requestedScopes = [{ projectionKind: "steps-days.v0" as const }];
    mocks.prepareHostedGroupJoinOfferPostTx.mockResolvedValueOnce({
      kind: "active_offer",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: { projectionScopes: requestedScopes },
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

    expect(mocks.assertHostedLinqRouteEgressAuthority).toHaveBeenCalled();
    expect(
      mocks.assertHostedLinqRouteEgressAuthority.mock.invocationCallOrder[0]
        ?? Number.NEGATIVE_INFINITY,
    )
      .toBeLessThan(
        mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx
          .mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
    expect(mocks.prepareHostedGroupJoinOfferPostTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      projectionScopes: requestedScopes,
      tx: fakeTx,
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.recordHostedGroupJoinOfferTx).not.toHaveBeenCalled();
  });

  it("does not post an offer when every current member already grants every requested scope", async () => {
    const requestedScopes = [{ projectionKind: "steps-days.v0" as const }];
    const fullyGrantedGroup = {
      ...GROUP_SUMMARY,
      memberCount: 1,
      members: [{
        disclosureGrants: [],
        grantedVaultShareProjectionKinds: ["steps-days.v0" as const],
        grantedVaultShareProjectionScopes: requestedScopes,
        handle: null,
        memberId: "member_owner",
        role: "owner",
      }],
    };
    mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx.mockResolvedValueOnce({
      group: fullyGrantedGroup,
      joinCode: "abc123",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: { projectionScopes: requestedScopes },
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "post_join_offer",
      result: {
        group: fullyGrantedGroup,
        joinUrl: "https://www.withmurph.ai/groups/join/abc123",
        status: "sent",
      },
    });

    expect(mocks.prepareHostedGroupJoinOfferPostTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.recordHostedGroupJoinOfferTx).not.toHaveBeenCalled();
  });

  it("fails closed before provider work when active-offer state is unavailable", async () => {
    mocks.prepareHostedGroupJoinOfferPostTx.mockResolvedValueOnce({
      kind: "unavailable",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: {
          projectionScopes: [{ projectionKind: "steps-days.v0" }],
        },
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "post_join_offer",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "active_offer_state_unavailable",
      },
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.recordHostedGroupJoinOfferTx).not.toHaveBeenCalled();
  });

  it("reuses one provider key and message binding across an unresolved retry", async () => {
    const requestedScopes = [{ projectionKind: "steps-days.v0" as const }];
    const request = {
      action: "post_join_offer" as const,
      joinOffer: { projectionScopes: requestedScopes },
      linqThread: LINQ_THREAD,
    };

    await handleHostedRuntimeGroupTool({ memberId: "member_container", request });
    await handleHostedRuntimeGroupTool({ memberId: "member_container", request });

    const providerCalls = mocks.sendHostedLinqChatMessage.mock.calls;
    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[0]?.[0].idempotencyKey)
      .toBe(providerCalls[1]?.[0].idempotencyKey);
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledTimes(2);
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenNthCalledWith(1, {
      groupId: GROUP_SUMMARY.id,
      messageId: "msg_offer_1",
      postedAt: expect.any(Date),
      projectionScopes: requestedScopes,
      tx: fakeTx,
    });
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenNthCalledWith(2, {
      groupId: GROUP_SUMMARY.id,
      messageId: "msg_offer_1",
      postedAt: expect.any(Date),
      projectionScopes: requestedScopes,
      tx: fakeTx,
    });
  });

  it("changes the hashed provider key when the join-code generation changes", () => {
    const base = {
      groupId: "hgrp_private_identifier",
      joinCode: "private_join_code",
      projectionScopes: [{ projectionKind: "steps-days.v0" as const }],
    };
    const first = buildHostedGroupJoinOfferProviderIdempotencyKey(base);
    const next = buildHostedGroupJoinOfferProviderIdempotencyKey({
      ...base,
      joinCode: "next_private_join_code",
    });

    expect(next).not.toBe(first);
    expect(next).toMatch(/^group-join-offer:v2:[a-f0-9]{40}$/u);
    expect(next).not.toContain("hgrp_private_identifier");
    expect(next).not.toContain("private_join_code");
    expect(next).not.toContain("steps-days.v0");
  });

  it("orders a scoring metric before diagnostics in the canonical frozen offer", async () => {
    const requestedScopes = [
      { projectionKind: "device-sync-status.v0" as const },
      { projectionKind: "steps-days.v0" as const },
    ];
    const canonicalScopes = [
      { projectionKind: "steps-days.v0" as const },
      { projectionKind: "device-sync-status.v0" as const },
    ];

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: { projectionScopes: requestedScopes },
        linqThread: LINQ_THREAD,
      },
    })).resolves.toMatchObject({
      action: "post_join_offer",
      result: { status: "sent" },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedVaultShareProjectionScopes: canonicalScopes,
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Like or heart this message to share the following with this group: your Murph profile name, steps, and health source connection status. To choose different permissions, use https://www.withmurph.ai/groups/join/abc123.",
      }),
    );
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      messageId: "msg_offer_1",
      postedAt: expect.any(Date),
      projectionScopes: canonicalScopes,
      tx: fakeTx,
    });
  });

  it("orders a selector scoring metric before diagnostics in the canonical frozen offer", async () => {
    const diagnosticScope = { projectionKind: "device-sync-status.v0" as const };
    const requestedScopes = [diagnosticScope, RUNNING_SCOPE];
    const canonicalScopes = [RUNNING_SCOPE, diagnosticScope];

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: { projectionScopes: requestedScopes },
        linqThread: LINQ_THREAD,
      },
    })).resolves.toMatchObject({
      action: "post_join_offer",
      result: { status: "sent" },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedVaultShareProjectionScopes: canonicalScopes,
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Like or heart this message to share the following with this group: your Murph profile name, running minutes, and health source connection status. To choose different permissions, use https://www.withmurph.ai/groups/join/abc123.",
      }),
    );
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      messageId: "msg_offer_1",
      postedAt: expect.any(Date),
      projectionScopes: canonicalScopes,
      tx: fakeTx,
    });
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
          "Like or heart this message to share the following with this group: your Murph profile name. To choose different permissions, use https://www.withmurph.ai/groups/join/abc123.",
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
          "Like or heart this message to share the following with this group: your Murph profile name and email address. To choose different permissions, use https://www.withmurph.ai/groups/join/abc123.",
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
          "Like or heart this message to share the following with this group: your Murph profile name, sleep timing, activity minutes, workout summaries, resting heart rate, and HRV. To choose different permissions, use https://www.withmurph.ai/groups/join/abc123.",
      }),
    );
  });

  it("does not let a legacy template omit the canonical permissions link", async () => {
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
    })).resolves.toMatchObject({
      action: "post_join_offer",
      result: { status: "sent" },
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Like or heart this message to share the following with this group: your Murph profile name, email address, sleep timing, activity minutes, workout summaries, resting heart rate, and HRV. To choose different permissions, use https://www.withmurph.ai/groups/join/abc123.",
      }),
    );
  });

  it("discloses session count in distance-scope join offer copy", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: {
          messageTemplate:
            "Like this to join. It shares {{share_scope}} with the group. Join page: {{join_url}}.",
          projectionScopes: [RUNNING_DISTANCE_SCOPE],
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
        requestedVaultShareProjectionScopes: [RUNNING_DISTANCE_SCOPE],
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Like or heart this message to share the following with this group: your Murph profile name and recent running distance and session count. To choose different permissions, use https://www.withmurph.ai/groups/join/abc123.",
      }),
    );
  });

  it("posts the canonical profile-only offer when the legacy template is missing", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "post_join_offer", linqThread: LINQ_THREAD },
    })).resolves.toMatchObject({
      action: "post_join_offer",
      result: { status: "sent" },
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Like or heart this message to share the following with this group: your Murph profile name. To choose different permissions, use https://www.withmurph.ai/groups/join/abc123.",
      }),
    );
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      messageId: "msg_offer_1",
      postedAt: expect.any(Date),
      projectionScopes: [],
      tx: fakeTx,
    });
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
        // Keyed to the reservation instant so retries of one reservation
        // dedupe while a later requested re-share is a distinct send.
        idempotencyKey: `group-contact-card:chat_group_1:${new Date("2026-07-02T12:00:00Z").getTime()}`,
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
