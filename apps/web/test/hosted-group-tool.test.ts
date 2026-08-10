import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  admitHostedGroupDisclosurePermissionAppendTx: vi.fn(),
  assertHostedLinqRecentInboundEngagementForRuntime: vi.fn(),
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  buildMurphHostedLinqContactCardVcf: vi.fn(),
  canonicalizeHostedGroupDisclosurePermissionText: vi.fn(),
  createHostedGroupDisclosurePermissionProviderIdempotencyKey: vi.fn(),
  createHostedGroupJoinLinkForOwnedThreadContainerTx: vi.fn(),
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort: vi.fn(),
  fetchMurphHostedLinqContactCardVcfPhoto: vi.fn(),
  finishHostedOnboardingTiming: vi.fn(),
  getHostedLinqChatHandles: vi.fn(),
  getHostedLinqChatSummary: vi.fn(),
  getHostedTelegramGroupTitle: vi.fn(),
  hasHostedMemberActivationProof: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  hostedMemberFindUnique: vi.fn(),
  hostedThreadContainerParticipantUpdateMany: vi.fn(),
  hostedThreadContainerParticipantUpsert: vi.fn(),
  hostedThreadContainerFindUnique: vi.fn(),
  isHostedMemberSuspended: vi.fn(),
  issueHostedSignupReferralLink: vi.fn(),
  leaveHostedGroupMemberTx: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  armHostedPendingGroupSetupTx: vi.fn(),
  cancelHostedPendingGroupSetupTx: vi.fn(),
  lookupHostedMemberRoutingByTelegramUserId: vi.fn(),
  prepareHostedGroupJoinOfferPostTx: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readActiveHostedGroupDisclosureGrantsForGroup: vi.fn(),
  readActiveHostedGroupDisclosureGrantsForMember: vi.fn(),
  requestHostedGroupAssistantAsk: vi.fn(),
  requestHostedGroupCurrentSenderAssistantAsk: vi.fn(),
  requestHostedGroupMemberAssistantAsk: vi.fn(),
  readHostedGroupByRuntimeMemberId: vi.fn(),
  readHostedGroupIdByRuntimeMemberId: vi.fn(),
  readHostedGroupMembershipsForMember: vi.fn(),
  readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId: vi.fn(),
  readHostedGroupFundingRecoveryStatus: vi.fn(),
  readHostedGroupSharedDataByRuntimeMemberId: vi.fn(),
  readHostedOwnerAddressBookAdvisoryNames: vi.fn(),
  readHostedPendingGroupSetup: vi.fn(),
  recordHostedGroupJoinOfferTx: vi.fn(),
  recordHostedGroupDisclosurePermissionTx: vi.fn(),
  releaseHostedLinqContactCardShareAttempt: vi.fn(),
  reserveHostedLinqContactCardShareAttempt: vi.fn(),
  shareMurphHostedLinqContactCardVcfToChat: vi.fn(),
  revokeHostedGroupMemberEmailShareTx: vi.fn(),
  revokeHostedGroupDisclosureGrantForMemberTx: vi.fn(),
  resolveMurphHostedLinqContactCardBackupPhoneNumber: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
  resolveHostedAssistantNotificationDestination: vi.fn(),
  sendHostedLinqAttachmentMessage: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
  startHostedOnboardingTiming: vi.fn(
    (step: string, baseDetails: Record<string, unknown> = {}) => ({
      baseDetails,
      startedAtMs: 0,
      step,
    }),
  ),
  updateHostedGroupDisplayNameByRuntimeMemberIdTx: vi.fn(),
  updateHostedLinqChatAvatar: vi.fn(),
  updateHostedLinqChatDisplayName: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

vi.mock("@/src/lib/hosted-growth/signup-referral", () => ({
  issueHostedSignupReferralLink: mocks.issueHostedSignupReferralLink,
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

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  hasHostedMemberActivationProof: mocks.hasHostedMemberActivationProof,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber: mocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress: mocks.lookupHostedMemberByVerifiedEmailAddress,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  lookupHostedMemberRoutingByTelegramUserId:
    mocks.lookupHostedMemberRoutingByTelegramUserId,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  getHostedLinqChatHandles: mocks.getHostedLinqChatHandles,
  getHostedLinqChatSummary: mocks.getHostedLinqChatSummary,
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

vi.mock("@/src/lib/hosted-onboarding/logging", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/logging")
  >("@/src/lib/hosted-onboarding/logging");

  return {
    ...actual,
    finishHostedOnboardingTiming: mocks.finishHostedOnboardingTiming,
    startHostedOnboardingTiming: mocks.startHostedOnboardingTiming,
  };
});

vi.mock("@/src/lib/hosted-onboarding/telegram-client", () => ({
  getHostedTelegramGroupTitle: mocks.getHostedTelegramGroupTitle,
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
  shareMurphHostedLinqContactCardVcfToChat: mocks.shareMurphHostedLinqContactCardVcfToChat,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedLinqRouteEgressAuthority: mocks.assertHostedLinqRouteEgressAuthority,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-egress-engagement", () => ({
  assertHostedLinqRecentInboundEngagementForRuntime:
    mocks.assertHostedLinqRecentInboundEngagementForRuntime,
}));

vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  resolveHostedAssistantNotificationDestination:
    mocks.resolveHostedAssistantNotificationDestination,
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  createHostedGroupJoinLinkForOwnedThreadContainerTx:
    mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx,
  leaveHostedGroupMemberTx: mocks.leaveHostedGroupMemberTx,
  prepareHostedGroupJoinOfferPostTx: mocks.prepareHostedGroupJoinOfferPostTx,
  readHostedGroupByRuntimeMemberId: mocks.readHostedGroupByRuntimeMemberId,
  readHostedGroupIdByRuntimeMemberId: mocks.readHostedGroupIdByRuntimeMemberId,
  readHostedGroupMembershipsForMember: mocks.readHostedGroupMembershipsForMember,
  readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId:
    mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId,
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

vi.mock("@/src/lib/hosted-groups/pending-group-setup", () => ({
  armHostedPendingGroupSetupTx: mocks.armHostedPendingGroupSetupTx,
  cancelHostedPendingGroupSetupTx: mocks.cancelHostedPendingGroupSetupTx,
  readHostedPendingGroupSetup: mocks.readHostedPendingGroupSetup,
}));

vi.mock("@/src/lib/hosted-groups/group-assistant-ask", () => ({
  requestHostedGroupAssistantAsk: mocks.requestHostedGroupAssistantAsk,
  requestHostedGroupMemberAssistantAsk: mocks.requestHostedGroupMemberAssistantAsk,
}));

vi.mock("@/src/lib/hosted-groups/group-current-sender-assistant-ask", () => ({
  requestHostedGroupCurrentSenderAssistantAsk:
    mocks.requestHostedGroupCurrentSenderAssistantAsk,
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
  buildHostedGroupUsageFundingLocatorForRuntimeMember: (memberId: string) =>
    `gf1.${memberId}.signature`,
  buildHostedGroupUsageFundingUrl: (input: {
    joinCode: string;
    publicBaseUrl: string;
  }) => `${input.publicBaseUrl}/groups/fund/${input.joinCode}`,
  readHostedGroupFundingRecoveryStatus:
    mocks.readHostedGroupFundingRecoveryStatus,
}));

vi.mock("@/src/lib/hosted-address-book/projection", () => ({
  HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES: 16,
  HOSTED_ADDRESS_BOOK_LOOKUP_TIMEOUT_MS: 2_000,
  readHostedOwnerAddressBookAdvisoryNames:
    mocks.readHostedOwnerAddressBookAdvisoryNames,
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
  HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES,
  HOSTED_ADDRESS_BOOK_LOOKUP_TIMEOUT_MS,
  type HostedAddressBookAdvisoryLookupOutcome,
} from "@/src/lib/hosted-address-book/projection";
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
  normalizeHostedGroupAccessOfferProjectionScopes,
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
const DEEP_SLEEP_SCOPE = { projectionKind: "deep-sleep-days.v0" } as const;
const DEEP_SLEEP_SOURCES_SCOPE = {
  projectionKind: "deep-sleep-sources-days.v1",
} as const;
const REM_SLEEP_SCOPE = { projectionKind: "rem-sleep-days.v0" } as const;
const REM_SLEEP_SOURCES_SCOPE = {
  projectionKind: "rem-sleep-sources-days.v1",
} as const;
const WORKOUTS_SCOPE = {
  projectionKind: "workouts.v0",
} as const;
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

function addressBookLookupResult(
  names: ReadonlyMap<string, string> = new Map(),
  outcome: HostedAddressBookAdvisoryLookupOutcome =
    names.size === 0 ? "no_contact_match" : "matched",
) {
  return {
    canonicalHandleCount: 2,
    contactMatchCount: names.size,
    names,
    outcome,
    requestedHandleCount: 2,
  };
}

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
    mocks.readHostedPendingGroupSetup.mockResolvedValue(null);
    mocks.cancelHostedPendingGroupSetupTx.mockResolvedValue(false);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockReset();
    mocks.lookupHostedMemberRoutingByTelegramUserId.mockReset();
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockReset();
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockResolvedValue(
      addressBookLookupResult(),
    );
    mocks.canonicalizeHostedGroupDisclosurePermissionText.mockImplementation(
      (value: string) => value.replaceAll("\r\n", "\n").trim(),
    );
    mocks.createHostedGroupDisclosurePermissionProviderIdempotencyKey.mockReturnValue(
      "group-disclosure:provider-request-1",
    );
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.hasHostedMemberActivationProof.mockResolvedValue(true);
    mocks.issueHostedSignupReferralLink.mockResolvedValue({
      expiresAt: new Date("2026-08-06T22:30:00.000Z"),
      signupUrl: "https://www.withmurph.ai/join/signup_invite",
    });
    mocks.getHostedLinqChatSummary.mockResolvedValue({
      displayName: "Weekend Warriors",
      handles: [],
      isGroup: true,
    });
    mocks.getHostedTelegramGroupTitle.mockResolvedValue("Weekend Warriors");
    mocks.leaveHostedGroupMemberTx.mockResolvedValue({ kind: "left" });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.readHostedGroupByRuntimeMemberId.mockResolvedValue(GROUP_SUMMARY);
    mocks.readHostedGroupIdByRuntimeMemberId.mockResolvedValue("hgrp_123");
    mocks.readHostedGroupSharedDataByRuntimeMemberId.mockResolvedValue({
      members: [],
      requestedProjectionScopeKeys: ["steps-days.v0"],
      status: "ok",
    });
    mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId.mockResolvedValue({
      candidates: [],
      status: "ok",
    });
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockResolvedValue(
      addressBookLookupResult(),
    );
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
        runtimeMemberId: "member_group_runtime",
      }],
      truncated: false,
    });
    mocks.readHostedGroupFundingRecoveryStatus.mockResolvedValue({
      fundingNeeded: true,
      fundingUrl: "https://www.withmurph.ai/groups/fund/group_join_code_1234",
      includedUsageUsedPercent: 64,
      sponsorshipStatus: "sponsored",
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
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue({
      conversationShape: "thread-container",
      externalThreadRouteAuthority: {
        accountLookupKey: "hplk_group_runtime",
        channel: "linq",
        containerMemberId: "member_group_runtime",
        threadId: "chat_group_runtime",
      },
      route: {
        actorId: null,
        channel: "linq",
        delivery: { kind: "thread", target: "chat_group_runtime" },
        identityId: "identity",
        threadId: "thread",
        threadIsDirect: false,
      },
    });
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
    mocks.requestHostedGroupCurrentSenderAssistantAsk.mockResolvedValue({
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
      ask_current_sender: "participant_aware",
      ask_member: "participant_aware",
      arm_usage_referral: "participant_aware",
      cancel_usage_referral: "participant_aware",
      cancel_next_group: "personal_active",
      create_signup_referral_link: "participant_aware",
      create_join_link: "owner_active",
      leave_membership: "participant_aware",
      list_memberships: "personal_active",
      post_disclosure_request: "owner_active",
      post_join_offer: "owner_active",
      prepare_next_group: "personal_active",
      preflight_set_chat_avatar: "owner_active",
      read_chat_name: "participant_aware",
      read_chat_participants: "participant_aware",
      read_current: "participant_aware",
      read_next_group: "personal_active",
      read_participant_display_names: "participant_aware",
      revoke_disclosure_grant: "personal_active",
      read_usage: "participant_aware",
      read_usage_referral: "participant_aware",
      read_shared: "participant_aware",
      revoke_own_email_share: "participant_aware",
      set_chat_avatar: "owner_active",
      share_contact_card: "owner_active",
      update_display_name: "owner_active",
    });
  });

  it("prepares, reads, and cancels the member's next group intent", async () => {
    mocks.hostedThreadContainerFindUnique.mockResolvedValue(null);
    const expiresAt = new Date("2026-07-29T18:30:00.000Z");
    const setup = {
      armedAt: new Date("2026-07-29T18:00:00.000Z"),
      channel: "linq" as const,
      expiresAt,
      id: "hpgs_test",
      ownerMemberId: "member_group_runtime",
      recipientPhoneLookupKey: "hplk_current_line",
      setup: {
        roomContextMarkdown: "Keep this room low-key.",
        style: {
          personality: { humor: 2 },
          tone: "casual" as const,
        },
      },
    };
    mocks.armHostedPendingGroupSetupTx.mockResolvedValue(setup);
    mocks.readHostedPendingGroupSetup.mockResolvedValue(setup);
    mocks.cancelHostedPendingGroupSetupTx.mockResolvedValue(true);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "prepare_next_group",
        setup: setup.setup,
      },
    })).resolves.toEqual({
      action: "prepare_next_group",
      result: {
        expiresAt: "2026-07-29T18:30:00.000Z",
        setup: setup.setup,
        status: "prepared",
      },
    });
    expect(mocks.armHostedPendingGroupSetupTx).toHaveBeenCalledWith({
      ownerMemberId: "member_group_runtime",
      setup: setup.setup,
      tx: fakeTx,
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_next_group" },
    })).resolves.toEqual({
      action: "read_next_group",
      result: {
        expiresAt: "2026-07-29T18:30:00.000Z",
        setup: setup.setup,
        status: "prepared",
      },
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "cancel_next_group" },
    })).resolves.toEqual({
      action: "cancel_next_group",
      result: { status: "canceled" },
    });
  });

  it("does not expose next-group setup actions to an inactive runtime", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_next_group" },
    })).resolves.toEqual({
      action: "read_next_group",
      result: {
        status: "unavailable",
        unavailableReason: "runtime_inactive",
      },
    });

    expect(mocks.readHostedPendingGroupSetup).not.toHaveBeenCalled();
    expect(mocks.cancelHostedPendingGroupSetupTx).not.toHaveBeenCalled();
    expect(mocks.armHostedPendingGroupSetupTx).not.toHaveBeenCalled();
  });

  it("attributes a direct signup link to the current member", async () => {
    mocks.hostedThreadContainerFindUnique.mockResolvedValueOnce(null);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_direct",
      request: {
        action: "create_signup_referral_link",
      },
    })).resolves.toEqual({
      action: "create_signup_referral_link",
      result: {
        expiresAt: "2026-08-06T22:30:00.000Z",
        signupUrl: "https://www.withmurph.ai/join/signup_invite",
        status: "ok",
      },
    });

    expect(mocks.issueHostedSignupReferralLink).toHaveBeenCalledWith({
      referrerMemberId: "member_direct",
    });
  });

  it("attributes a group signup link to the exact accepted sender", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValueOnce({
      core: {
        id: "member_referrer",
      },
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "create_signup_referral_link",
        participant: {
          assistantInputId: `ain_${"a".repeat(32)}`,
          senderHandle: "+14045550100",
          source: "linq",
        },
      },
    })).resolves.toMatchObject({
      action: "create_signup_referral_link",
      result: {
        status: "ok",
      },
    });

    expect(mocks.hasHostedMemberActivationProof).toHaveBeenCalledWith({
      memberId: "member_referrer",
      prisma: expect.any(Object),
    });
    expect(mocks.issueHostedSignupReferralLink).toHaveBeenCalledWith({
      referrerMemberId: "member_referrer",
    });
  });

  it("serializes only the room-public usage projection", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_usage" },
    })).resolves.toEqual({
      action: "read_usage",
      result: {
        status: "ok",
        usage: {
          fundingNeeded: true,
          fundingUrl:
            "https://www.withmurph.ai/groups/fund/group_join_code_1234",
          includedUsageUsedPercent: 64,
        },
      },
    });
    expect(mocks.readHostedGroupFundingRecoveryStatus).toHaveBeenCalledWith({
      runtimeMemberId: "member_group_runtime",
    });
  });

  it("omits unavailable usage progress without hiding funding status", async () => {
    mocks.readHostedGroupFundingRecoveryStatus.mockResolvedValueOnce({
      fundingNeeded: true,
      fundingUrl: "https://www.withmurph.ai/groups/fund/group_join_code_1234",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_usage" },
    })).resolves.toEqual({
      action: "read_usage",
      result: {
        status: "ok",
        usage: {
          fundingNeeded: true,
          fundingUrl:
            "https://www.withmurph.ai/groups/fund/group_join_code_1234",
        },
      },
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

  it("does not acknowledge a personal ask when its durable mailbox handoff rejects", async () => {
    const signalError = new Error("Temporal unavailable");
    const scheduleMailboxWake = vi.fn().mockRejectedValue(signalError);
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
    })).rejects.toBe(signalError);
  });

  it("dispatches an exact current-sender ask and schedules only its personal wake", async () => {
    const scheduleMailboxWake = vi.fn();
    const origin = {
      assistantInputId: `ain_${"c".repeat(32)}`,
      kind: "accepted_input" as const,
      sessionId: "session_group",
    };
    mocks.requestHostedGroupCurrentSenderAssistantAsk.mockResolvedValue({
      mailboxWake: {
        expectedUserId: "member_sender",
        mailboxItemId: "aask_req_current_sender",
      },
      result: { status: "accepted" },
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "ask_current_sender", origin },
      scheduleMailboxWake,
    })).resolves.toEqual({
      action: "ask_current_sender",
      result: { status: "accepted" },
    });

    expect(
      mocks.requestHostedGroupCurrentSenderAssistantAsk,
    ).toHaveBeenCalledWith({
      groupRuntimeMemberId: "member_group_runtime",
      origin,
    });
    expect(scheduleMailboxWake).toHaveBeenCalledWith({
      expectedUserId: "member_sender",
      mailboxItemId: "aask_req_current_sender",
    });
  });

  it("does not acknowledge a current-sender ask when its durable mailbox handoff rejects", async () => {
    const signalError = new Error("Temporal unavailable");
    const scheduleMailboxWake = vi.fn().mockRejectedValue(signalError);
    const origin = {
      assistantInputId: `ain_${"c".repeat(32)}`,
      kind: "accepted_input" as const,
      sessionId: "session_group",
    };
    mocks.requestHostedGroupCurrentSenderAssistantAsk.mockResolvedValue({
      mailboxWake: {
        expectedUserId: "member_sender",
        mailboxItemId: "aask_req_current_sender",
      },
      result: { status: "accepted" },
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "ask_current_sender", origin },
      scheduleMailboxWake,
    })).rejects.toBe(signalError);

    expect(scheduleMailboxWake).toHaveBeenCalledWith({
      expectedUserId: "member_sender",
      mailboxItemId: "aask_req_current_sender",
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

  it("does not acknowledge a grant-bound ask when its durable mailbox handoff rejects", async () => {
    const signalError = new Error("Temporal unavailable");
    const scheduleMailboxWake = vi.fn().mockRejectedValue(signalError);
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
    })).rejects.toBe(signalError);

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
          sponsorshipUrl: expect.stringMatching(
            /^https:\/\/www\.withmurph\.ai\/groups\/fund\/gf1\./u,
          ),
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
        runtimeMemberId: "member_group_runtime",
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
      telegramSenderHandles: [],
    });
  });

  it("reads only current participant display names through the narrow store boundary", async () => {
    mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId.mockResolvedValue({
      candidates: [{
        profileDisplayName: "Alice Example",
        senderHandle: "+15551110001",
      }],
      status: "ok",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "read_participant_display_names",
        linqSenderHandles: ["+15551110001"],
      },
    })).resolves.toEqual({
      action: "read_participant_display_names",
      result: {
        participants: [{
          displayName: "Alice Example",
          displayNameSource: "profile-name",
          senderHandle: "+15551110001",
        }],
        status: "ok",
      },
    });

    expect(
      mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId,
    ).toHaveBeenCalledWith({
      linqSenderHandles: ["+15551110001"],
      runtimeMemberId: "member_group_runtime",
    });
    expect(mocks.readHostedGroupSharedDataByRuntimeMemberId).not.toHaveBeenCalled();
    expect(mocks.readHostedOwnerAddressBookAdvisoryNames).not.toHaveBeenCalled();
  });

  it("prefers profile names and uses owner contacts for exact unresolved phones", async () => {
    mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId.mockResolvedValue({
      candidates: [
        {
          profileDisplayName: "Alice Profile",
          senderHandle: "+15551110001",
        },
        {
          profileDisplayName: null,
          senderHandle: "+15552220002",
        },
        {
          profileDisplayName: null,
          senderHandle: "member@example.test",
        },
      ],
      status: "ok",
    });
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockResolvedValue(
      addressBookLookupResult(new Map([
        ["+15551110001", "Conflicting Contact"],
        ["+15552220002", "Bob Contact"],
      ])),
    );

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "read_participant_display_names",
        linqSenderHandles: [
          "+15551110001",
          "+15552220002",
          "member@example.test",
        ],
      },
    })).resolves.toEqual({
      action: "read_participant_display_names",
      result: {
        nameMissSenderHandles: ["member@example.test"],
        participants: [
          {
            displayName: "Alice Profile",
            displayNameSource: "profile-name",
            senderHandle: "+15551110001",
          },
          {
            displayName: "Bob Contact",
            displayNameSource: "unverified-owner-contact",
            senderHandle: "+15552220002",
          },
        ],
        status: "ok",
      },
    });
    expect(mocks.readHostedOwnerAddressBookAdvisoryNames).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedOwnerAddressBookAdvisoryNames).toHaveBeenCalledWith({
      containerMemberId: "member_group_runtime",
      phoneHandles: ["+15552220002"],
      prisma: expect.anything(),
    });
  });

  it("uses an owner contact label when the exact phone has no Murph member match", async () => {
    mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId.mockResolvedValue({
      candidates: [{
        profileDisplayName: null,
        senderHandle: "+15554440004",
      }],
      status: "ok",
    });
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockResolvedValue(
      addressBookLookupResult(new Map([
        ["+15554440004", "Casey Contact"],
      ])),
    );

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "read_participant_display_names",
        linqSenderHandles: ["+15554440004"],
      },
    })).resolves.toEqual({
      action: "read_participant_display_names",
      result: {
        participants: [{
          displayName: "Casey Contact",
          displayNameSource: "unverified-owner-contact",
          senderHandle: "+15554440004",
        }],
        status: "ok",
      },
    });
    expect(mocks.readHostedOwnerAddressBookAdvisoryNames)
      .toHaveBeenCalledExactlyOnceWith({
        containerMemberId: "member_group_runtime",
        phoneHandles: ["+15554440004"],
        prisma: expect.anything(),
      });
  });

  it.each([
    "disabled",
    "owner_suspended",
    "consent_unavailable",
    "projection_disabled",
  ] as const satisfies readonly HostedAddressBookAdvisoryLookupOutcome[])(
    "keeps a policy-limited empty advisory lookup operation-local when the outcome is %s",
    async (outcome) => {
      mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId.mockResolvedValue({
        candidates: [{
          profileDisplayName: null,
          senderHandle: "+15552220002",
        }],
        status: "ok",
      });
      mocks.readHostedOwnerAddressBookAdvisoryNames.mockResolvedValue(
        addressBookLookupResult(new Map(), outcome),
      );

      await expect(handleHostedRuntimeGroupTool({
        memberId: "member_group_runtime",
        request: {
          action: "read_participant_display_names",
          linqSenderHandles: ["+15552220002"],
        },
      })).resolves.toEqual({
        action: "read_participant_display_names",
        result: {
          participants: [],
          status: "ok",
        },
      });
    },
  );

  it("marks a definitive no-contact result as a name miss", async () => {
    mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId.mockResolvedValue({
      candidates: [{
        profileDisplayName: null,
        senderHandle: "+15552220002",
      }],
      status: "ok",
    });
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockResolvedValue(
      addressBookLookupResult(new Map(), "no_contact_match"),
    );

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "read_participant_display_names",
        linqSenderHandles: ["+15552220002"],
      },
    })).resolves.toEqual({
      action: "read_participant_display_names",
      result: {
        nameMissSenderHandles: ["+15552220002"],
        participants: [],
        status: "ok",
      },
    });
  });

  it("keeps an ambiguous contact-label result operation-local", async () => {
    mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId.mockResolvedValue({
      candidates: [{
        profileDisplayName: null,
        senderHandle: "+15552220002",
      }],
      status: "ok",
    });
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockResolvedValue(
      addressBookLookupResult(new Map(), "no_safe_unique_label"),
    );

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "read_participant_display_names",
        linqSenderHandles: ["+15552220002"],
      },
    })).resolves.toEqual({
      action: "read_participant_display_names",
      result: { participants: [], status: "ok" },
    });
  });

  it("does not infer a name miss for an unnamed handle in a mixed contact match", async () => {
    mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId.mockResolvedValue({
      candidates: [
        {
          profileDisplayName: null,
          senderHandle: "+15552220002",
        },
        {
          profileDisplayName: null,
          senderHandle: "+15553330003",
        },
      ],
      status: "ok",
    });
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockResolvedValue(
      addressBookLookupResult(
        new Map([["+15552220002", "Named Contact"]]),
        "matched",
      ),
    );

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "read_participant_display_names",
        linqSenderHandles: ["+15552220002", "+15553330003"],
      },
    })).resolves.toEqual({
      action: "read_participant_display_names",
      result: {
        participants: [{
          displayName: "Named Contact",
          displayNameSource: "unverified-owner-contact",
          senderHandle: "+15552220002",
        }],
        status: "ok",
      },
    });
  });

  it("emits misses only for phones admitted to the bounded contact lookup", async () => {
    const senderHandles = Array.from(
      { length: HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES + 1 },
      (_, index) => `+1555${String(index).padStart(7, "0")}`,
    );
    const overflowHandle = senderHandles.at(-1);
    if (!overflowHandle) {
      throw new Error("expected an overflow sender handle");
    }
    mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId
      .mockImplementation(async (input: { linqSenderHandles: readonly string[] }) => ({
        candidates: input.linqSenderHandles.map((senderHandle) => ({
          profileDisplayName: null,
          senderHandle,
        })),
        status: "ok" as const,
      }));
    mocks.readHostedOwnerAddressBookAdvisoryNames
      .mockResolvedValueOnce(
        addressBookLookupResult(new Map(), "no_contact_match"),
      )
      .mockResolvedValueOnce(
        addressBookLookupResult(
          new Map([[overflowHandle, "Overflow Contact"]]),
          "matched",
        ),
      );

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "read_participant_display_names",
        linqSenderHandles: senderHandles,
      },
    })).resolves.toEqual({
      action: "read_participant_display_names",
      result: {
        nameMissSenderHandles: senderHandles.slice(
          0,
          HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES,
        ),
        participants: [],
        status: "ok",
      },
    });
    expect(mocks.readHostedOwnerAddressBookAdvisoryNames)
      .toHaveBeenNthCalledWith(1, {
        containerMemberId: "member_group_runtime",
        phoneHandles: senderHandles.slice(
          0,
          HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES,
        ),
        prisma: expect.anything(),
      });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "read_participant_display_names",
        linqSenderHandles: [overflowHandle],
      },
    })).resolves.toEqual({
      action: "read_participant_display_names",
      result: {
        participants: [{
          displayName: "Overflow Contact",
          displayNameSource: "unverified-owner-contact",
          senderHandle: overflowHandle,
        }],
        status: "ok",
      },
    });
  });

  it("does not consult owner contacts when current profile membership is unavailable", async () => {
    mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId.mockResolvedValue({
      status: "unavailable",
      unavailableReason: "participant_names_authority_invalid",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "read_participant_display_names",
        linqSenderHandles: ["+15552220002"],
      },
    })).resolves.toEqual({
      action: "read_participant_display_names",
      result: {
        status: "unavailable",
        unavailableReason: "participant_names_authority_invalid",
      },
    });
    expect(mocks.readHostedOwnerAddressBookAdvisoryNames).not.toHaveBeenCalled();
  });

  it("returns unavailable when the automatic owner-contact lookup times out", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      let resolveLookup:
        ((value: ReturnType<typeof addressBookLookupResult>) => void) | undefined;
      mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId.mockResolvedValue({
        candidates: [{
          profileDisplayName: null,
          senderHandle: "+15552220002",
        }],
        status: "ok",
      });
      mocks.readHostedOwnerAddressBookAdvisoryNames.mockReturnValue(
        new Promise((resolve) => {
          resolveLookup = resolve;
        }),
      );

      const response = handleHostedRuntimeGroupTool({
        memberId: "member_group_runtime",
        request: {
          action: "read_participant_display_names",
          linqSenderHandles: ["+15552220002"],
        },
      });
      await vi.advanceTimersByTimeAsync(HOSTED_ADDRESS_BOOK_LOOKUP_TIMEOUT_MS);

      await expect(response).resolves.toEqual({
        action: "read_participant_display_names",
        result: {
          status: "unavailable",
          unavailableReason: "participant_names_unavailable",
        },
      });
      expect(info).toHaveBeenCalledExactlyOnceWith(
        "Hosted address-book advisory lookup unavailable.",
        { outcome: "deadline_exceeded" },
      );

      resolveLookup?.(addressBookLookupResult(new Map([
        ["+15552220002", "Late Contact"],
      ])));
      await Promise.resolve();
      expect(info).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      info.mockRestore();
      warn.mockRestore();
    }
  });

  it("returns unavailable when advisory consent storage fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId.mockResolvedValue({
      candidates: [{
        profileDisplayName: null,
        senderHandle: "+15552220002",
      }],
      status: "ok",
    });
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockRejectedValue(
      new Error("consent database unavailable"),
    );

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "read_participant_display_names",
        linqSenderHandles: ["+15552220002"],
      },
    })).resolves.toEqual({
      action: "read_participant_display_names",
      result: {
        status: "unavailable",
        unavailableReason: "participant_names_unavailable",
      },
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "consent database unavailable",
    );
    warn.mockRestore();
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

  it("renames the chat with a null group when the runtime has no hosted group record", async () => {
    mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx.mockResolvedValueOnce(null);

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
        status: "ok",
      },
    });

    expect(mocks.updateHostedLinqChatDisplayName).toHaveBeenCalledWith({
      chatId: "chat_group_runtime",
      displayName: "Unattached group",
    });
  });

  it("labels a hosted group created while the chat rename was in flight", async () => {
    const renamed = {
      ...groupSummaryWithOwnerEmailGrant(),
      displayName: RENAMED_GROUP_SUMMARY.displayName,
    };
    // The group does not exist when the rename starts; a concurrent
    // create_join_link commits it while the provider request is in flight.
    mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx.mockResolvedValue(null);
    mocks.updateHostedLinqChatDisplayName.mockImplementationOnce(async () => {
      mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx.mockResolvedValue(renamed);
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "update_display_name",
        linqThread: GROUP_RUNTIME_LINQ_THREAD,
        updateDisplayName: { displayName: "Weekly Health Crew" },
      },
    })).resolves.toEqual({
      action: "update_display_name",
      result: {
        group: renamed,
        status: "ok",
      },
    });

    expect(mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        displayName: "Weekly Health Crew",
        runtimeMemberId: "member_group_runtime",
      }));
  });

  it("keeps the accepted rename when storing the hosted group label fails", async () => {
    mocks.updateHostedGroupDisplayNameByRuntimeMemberIdTx
      .mockRejectedValueOnce(new Error("transaction unavailable"));

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "update_display_name",
        linqThread: GROUP_RUNTIME_LINQ_THREAD,
        updateDisplayName: { displayName: "Weekly Health Crew" },
      },
    })).resolves.toEqual({
      action: "update_display_name",
      result: {
        group: null,
        status: "ok",
      },
    });

    expect(mocks.updateHostedLinqChatDisplayName).toHaveBeenCalledWith({
      chatId: "chat_group_runtime",
      displayName: "Weekly Health Crew",
    });
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

  it("reads the current Linq group title on demand from the durable route", async () => {
    mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
      displayName: "  Weekend   Warriors  ",
      handles: [],
      isGroup: true,
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_chat_name" },
    })).resolves.toEqual({
      action: "read_chat_name",
      result: {
        displayName: "Weekend Warriors",
        status: "ok",
      },
    });

    expect(mocks.resolveHostedAssistantNotificationDestination).toHaveBeenCalledWith({
      memberId: "member_group_runtime",
    });
    expect(mocks.getHostedLinqChatSummary).toHaveBeenCalledWith({
      chatId: "chat_group_runtime",
    });
    expect(mocks.getHostedTelegramGroupTitle).not.toHaveBeenCalled();
  });

  it.each([
    {
      displayName: "departed@example.test, +15550000002, +15550000001",
      variant: "all handles",
    },
    {
      displayName: "+15550000002, +15550000001",
      variant: "active handles",
    },
    {
      displayName: "departed@example.test, +15550000002",
      variant: "non-self handles",
    },
    {
      displayName: "+15550000002",
      variant: "active non-self handles",
    },
    {
      displayName: "+15550000002, +15550000001",
      handles: [
        { handle: "stale-self@example.test", isMe: true, status: "inactive" },
        { handle: "+15550000001", isMe: true, status: " ACTIVE " },
        { handle: "+15550000002", isMe: false, status: "active" },
      ],
      variant: "active handles with an inactive stale self handle",
    },
    {
      displayName: "+15550000002",
      handles: [
        { handle: "+15550000001", isMe: true, status: "active" },
        { handle: "+15550000002", isMe: false, status: "active" },
        { handle: "stale-member@example.test", isMe: false, status: "inactive" },
      ],
      variant: "active non-self handles with an inactive stale participant",
    },
  ])("does not expose Linq's synthesized $variant title", async ({
    displayName,
    handles,
  }) => {
    mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
      displayName,
      handles: handles ?? [
        { handle: "+15550000001", isMe: true, status: "active" },
        { handle: "+15550000002", isMe: false, status: "active" },
        { handle: "departed@example.test", isMe: false, status: "left" },
      ],
      isGroup: true,
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_chat_name" },
    })).resolves.toEqual({
      action: "read_chat_name",
      result: {
        displayName: null,
        status: "none",
      },
    });
  });

  it("reads the current Telegram group title on demand from the durable route", async () => {
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValueOnce({
      conversationShape: "thread-container",
      externalThreadRouteAuthority: {
        channel: "telegram",
        containerMemberId: "member_group_runtime",
        threadId: "-42:topic:7",
      },
      route: {
        actorId: null,
        channel: "telegram",
        delivery: { kind: "thread", target: "-42:topic:7" },
        identityId: "identity",
        threadId: "thread",
        threadIsDirect: false,
      },
    });
    mocks.getHostedTelegramGroupTitle.mockResolvedValueOnce("Weekend Warriors");

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_chat_name" },
    })).resolves.toEqual({
      action: "read_chat_name",
      result: {
        displayName: "Weekend Warriors",
        status: "ok",
      },
    });

    expect(mocks.getHostedTelegramGroupTitle).toHaveBeenCalledWith({
      threadId: "-42:topic:7",
    });
    expect(mocks.getHostedLinqChatSummary).not.toHaveBeenCalled();
  });

  it("reports no current group title without inventing one", async () => {
    mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
      displayName: null,
      handles: [],
      isGroup: true,
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_chat_name" },
    })).resolves.toEqual({
      action: "read_chat_name",
      result: {
        displayName: null,
        status: "none",
      },
    });
  });

  it("reports provider failure without exposing an error payload", async () => {
    mocks.getHostedLinqChatSummary.mockRejectedValueOnce(new Error("provider down"));

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_chat_name" },
    })).resolves.toEqual({
      action: "read_chat_name",
      result: {
        displayName: null,
        status: "unavailable",
        unavailableReason: "provider_unavailable",
      },
    });
  });

  it("rejects a direct-member route before provider metadata I/O", async () => {
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValueOnce({
      conversationShape: "direct-member",
      externalThreadRouteAuthority: null,
      route: {
        actorId: "member_group_runtime",
        channel: "linq",
        delivery: { kind: "thread", target: "chat_direct_runtime" },
        identityId: "identity",
        threadId: "thread",
        threadIsDirect: true,
      },
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_chat_name" },
    })).resolves.toEqual({
      action: "read_chat_name",
      result: {
        displayName: null,
        status: "unavailable",
        unavailableReason: "group_chat_unavailable",
      },
    });

    expect(mocks.getHostedLinqChatSummary).not.toHaveBeenCalled();
    expect(mocks.getHostedTelegramGroupTitle).not.toHaveBeenCalled();
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

  it("fails closed when the exact accepted message sender cannot be resolved", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue(null);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "revoke_own_email_share",
        participant: {
          assistantInputId: `ain_${"1".repeat(32)}`,
          senderHandle: "+15550000001",
          source: "linq",
        },
      },
    })).resolves.toEqual({
      action: "revoke_own_email_share",
      result: {
        status: "unavailable",
        unavailableReason: "member_unresolved",
      },
    });

    expect(mocks.revokeHostedGroupMemberEmailShareTx).not.toHaveBeenCalled();
  });

  it("revokes only the member resolved from the exact request-bearing Linq message", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_exact_sender", suspendedAt: null },
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
        participant: {
          assistantInputId: `ain_${"2".repeat(32)}`,
          senderHandle: "+15550000002",
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
      expect.objectContaining({ phoneNumber: "+15550000002" }),
    );
    expect(mocks.revokeHostedGroupMemberEmailShareTx).toHaveBeenCalledWith(
      expect.objectContaining({
        groupRuntimeMemberId: "member_group_runtime",
        memberId: "member_exact_sender",
      }),
    );
    expect(JSON.stringify(
      mocks.revokeHostedGroupMemberEmailShareTx.mock.calls[0]?.[0],
    )).not.toContain("member_other_sender");
  });

  it("accepts the legacy self-opt-out request at the Web rollout boundary", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_legacy_sender", suspendedAt: null },
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
          senderHandle: "+15550000003",
          source: "linq",
        },
      },
    })).resolves.toMatchObject({
      action: "revoke_own_email_share",
      result: { status: "revoked" },
    });

    expect(mocks.lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: "+15550000003" }),
    );
  });

  it("resolves Telegram requester evidence through the canonical routing binding", async () => {
    mocks.lookupHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      core: { id: "member_telegram_sender", suspendedAt: null },
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "revoke_own_email_share",
        participant: {
          assistantInputId: `ain_${"3".repeat(32)}`,
          senderHandle: "telegram-user-123",
          source: "telegram",
        },
      },
    })).resolves.toMatchObject({
      action: "revoke_own_email_share",
      result: { status: "revoked" },
    });

    expect(mocks.lookupHostedMemberRoutingByTelegramUserId).toHaveBeenCalledWith(
      expect.objectContaining({ telegramUserId: "telegram-user-123" }),
    );
    expect(mocks.revokeHostedGroupMemberEmailShareTx).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "member_telegram_sender" }),
    );
  });

  it("lets the exact unsuspended sender revoke after personal paid access expires", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_sender", suspendedAt: null },
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "revoke_own_email_share",
        participant: {
          assistantInputId: `ain_${"4".repeat(32)}`,
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

    expect(mocks.revokeHostedGroupMemberEmailShareTx).toHaveBeenCalledWith(
      expect.objectContaining({
        groupRuntimeMemberId: "member_group_runtime",
        memberId: "member_sender",
      }),
    );
  });

  it("reports already_removed when the exact sender had no active email share", async () => {
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
        participant: {
          assistantInputId: `ain_${"5".repeat(32)}`,
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
          sponsorshipUrl: "https://www.withmurph.ai/groups/fund/funding_locator",
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
          sponsorshipUrl: "https://www.withmurph.ai/groups/fund/funding_locator",
        }],
        status: "ok",
        truncated: false,
      },
    });
  });

  it("filters a renamed group summary and passes a null group through", () => {
    const supportedScopeKeys = new Set([
      buildHostedVaultShareProjectionScopeKey(SLEEP_SCOPE),
    ]);

    expect(filterHostedRuntimeGroupToolResponseProjectionScopes({
      action: "update_display_name",
      result: {
        group: groupWithSelectorScopes,
        status: "ok",
      },
    }, supportedScopeKeys)).toEqual({
      action: "update_display_name",
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

    expect(filterHostedRuntimeGroupToolResponseProjectionScopes({
      action: "update_display_name",
      result: {
        group: null,
        status: "ok",
      },
    }, supportedScopeKeys)).toEqual({
      action: "update_display_name",
      result: {
        group: null,
        status: "ok",
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
      requestedVaultShareProjectionKinds: [
        "deep-sleep-days.v0",
        "rem-sleep-days.v0",
      ],
      schema: "murph.hosted-group.join-policy.v1",
    }).requestedVaultShareProjectionScopes).toEqual([
      DEEP_SLEEP_SCOPE,
      REM_SLEEP_SCOPE,
    ]);

    expect(readHostedGroupJoinPolicy({
      requestedVaultShareProjectionKinds: [
        "deep-sleep-days.v0",
        "deep-sleep-sources-days.v1",
        "rem-sleep-days.v0",
        "rem-sleep-sources-days.v1",
      ],
      schema: "murph.hosted-group.join-policy.v1",
    }).requestedVaultShareProjectionScopes).toEqual([
      DEEP_SLEEP_SCOPE,
      DEEP_SLEEP_SOURCES_SCOPE,
      REM_SLEEP_SCOPE,
      REM_SLEEP_SOURCES_SCOPE,
    ]);

    expect(normalizeHostedGroupAccessOfferProjectionScopes([
      DEEP_SLEEP_SCOPE,
      REM_SLEEP_SCOPE,
    ])).toEqual([
      DEEP_SLEEP_SOURCES_SCOPE,
      REM_SLEEP_SOURCES_SCOPE,
    ]);

    const mergedSleep = mergeHostedGroupJoinPolicy({
      existing: {
        requestedVaultShareProjectionKinds: [
          "deep-sleep-days.v0",
          "rem-sleep-days.v0",
          "activity-days.v0",
        ],
        schema: "murph.hosted-group.join-policy.v1",
      },
      requestedVaultShareProjectionScopes: [DEEP_SLEEP_SCOPE],
    }).requestedVaultShareProjectionScopes;
    expect(mergedSleep).toHaveLength(4);
    expect(mergedSleep).toEqual(expect.arrayContaining([
      DEEP_SLEEP_SCOPE,
      DEEP_SLEEP_SOURCES_SCOPE,
      REM_SLEEP_SCOPE,
      { projectionKind: "activity-days.v0" },
    ]));
    expect(mergedSleep).not.toContainEqual(REM_SLEEP_SOURCES_SCOPE);

    expect(readHostedGroupJoinPolicy({
      requestedVaultShareProjectionKinds: ["all-health-data"],
      schema: "murph.hosted-group.join-policy.v1",
    }).requestedVaultShareProjectionKinds).toEqual([]);

    expect(projectHostedVaultShareProjectionDisplays([
      { projectionKind: "time-zone.v0" },
      { projectionKind: "group-email.v0" },
      { projectionKind: "sleep-times.v0" },
      SLEEP_DURATION_SCOPE,
      DEEP_SLEEP_SCOPE,
      DEEP_SLEEP_SOURCES_SCOPE,
      REM_SLEEP_SCOPE,
      REM_SLEEP_SOURCES_SCOPE,
      { projectionKind: "activity-days.v0" },
      WORKOUTS_SCOPE,
      RUNNING_SCOPE,
      RUNNING_DISTANCE_SCOPE,
      RUNNING_SESSION_COUNT_SCOPE,
      { projectionKind: "heart-rate-zones-days.v0" },
      PROTEIN_SCOPE,
      { projectionKind: "calories-days.v0" },
      { projectionKind: "carbs-days.v0" },
      { projectionKind: "fat-days.v0" },
      { projectionKind: "fiber-days.v0" },
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
        description:
          "Shares your current time-zone name as optional group context. It does not determine score dates or prove your exact location.",
        label: "Time zone",
        projectionKind: "time-zone.v0",
        projectionScope: { projectionKind: "time-zone.v0" },
        projectionScopeKey: "time-zone.v0",
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
        description:
          "Shares 7 days of each source’s name, deep sleep minutes, and recorded time.",
        label: "Deep sleep",
        legacyProjectionScope: DEEP_SLEEP_SCOPE,
        projectionKind: "deep-sleep-sources-days.v1",
        projectionScope: DEEP_SLEEP_SOURCES_SCOPE,
        projectionScopeKey: "deep-sleep-sources-days.v1",
      },
      {
        description:
          "Shares 7 days of each source’s name, REM sleep minutes, and recorded time.",
        label: "REM sleep",
        legacyProjectionScope: REM_SLEEP_SCOPE,
        projectionKind: "rem-sleep-sources-days.v1",
        projectionScope: REM_SLEEP_SOURCES_SCOPE,
        projectionScopeKey: "rem-sleep-sources-days.v1",
      },
      {
        description: "Shares your last 7 days of active minutes.",
        label: "Activity minutes",
        projectionKind: "activity-days.v0",
        projectionScope: { projectionKind: "activity-days.v0" },
        projectionScopeKey: "activity-days.v0",
      },
      {
        description: "Shares each workout from the last 7 days, including its local start time, duration, and type. Does not share absolute timestamps, routes, location, heart rate, or provider identity.",
        label: "Workout details",
        projectionKind: "workouts.v0",
        projectionScope: WORKOUTS_SCOPE,
        projectionScopeKey: "workouts.v0",
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
          "Shares your last 7 days of daily protein totals from meals in Murph, including meals imported from connected apps.",
        label: "Daily protein",
        projectionKind: "protein-days.v0",
        projectionScope: PROTEIN_SCOPE,
        projectionScopeKey: "protein-days.v0",
      },
      {
        description:
          "Shares your last 7 days of daily calorie totals from meals in Murph, including meals imported from connected apps.",
        label: "Daily calories",
        projectionKind: "calories-days.v0",
        projectionScope: { projectionKind: "calories-days.v0" },
        projectionScopeKey: "calories-days.v0",
      },
      {
        description:
          "Shares your last 7 days of daily carbohydrate totals from meals in Murph, including meals imported from connected apps.",
        label: "Daily carbs",
        projectionKind: "carbs-days.v0",
        projectionScope: { projectionKind: "carbs-days.v0" },
        projectionScopeKey: "carbs-days.v0",
      },
      {
        description:
          "Shares your last 7 days of daily fat totals from meals in Murph, including meals imported from connected apps.",
        label: "Daily fat",
        projectionKind: "fat-days.v0",
        projectionScope: { projectionKind: "fat-days.v0" },
        projectionScopeKey: "fat-days.v0",
      },
      {
        description:
          "Shares your last 7 days of daily fiber totals from meals in Murph, including meals imported from connected apps.",
        label: "Daily fiber",
        projectionKind: "fiber-days.v0",
        projectionScope: { projectionKind: "fiber-days.v0" },
        projectionScopeKey: "fiber-days.v0",
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
        .filter((scope) => scope.projectionKind !== "deep-sleep-days.v0"
          && scope.projectionKind !== "rem-sleep-days.v0")
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
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockReset();
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockReset();
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockResolvedValue(
      addressBookLookupResult(),
    );
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
    mocks.hasHostedMemberActivationProof.mockResolvedValue(true);
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
    mocks.shareMurphHostedLinqContactCardVcfToChat.mockResolvedValue({ status: "sent" });
    mocks.sendHostedLinqChatMessage.mockImplementation(() => Promise.resolve({
      chatId: "chat_group_1",
      messageCreatedAt: new Date().toISOString(),
      messageId: "msg_offer_1",
    }));
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
        groupChatIconUrl:
          `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`,
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
      groupChatIconUrl:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`,
    });
    expect(mocks.updateHostedLinqChatAvatar).toHaveBeenCalledOnce();
    expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
      "hosted-groups.set-chat-avatar",
      { chatIdSuffix: "roup_1" },
    );
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({ step: "hosted-groups.set-chat-avatar" }),
      "provider-request-accepted",
    );
    expect(JSON.stringify(mocks.finishHostedOnboardingTiming.mock.calls))
      .not.toContain("private-media");
  });

  it("keeps queryless public Images avatars compatible during the Web-first rollout", async () => {
    const legacyIconUrl =
      "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/889a5f43-1d35-4eae-a98e-7ae69e96a800/public";

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "set_chat_avatar",
        groupChatIconUrl: legacyIconUrl,
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
      groupChatIconUrl: legacyIconUrl,
    });
  });

  it("updates a preview group avatar only through the preview Worker origin", async () => {
    const previewOrigin = "https://hosted-runner-staging.example.test";
    const previewIconUrl =
      `${previewOrigin}/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}?exp=2000000000`;
    vi.stubEnv("HOSTED_EXECUTION_CONTROL_URL", previewOrigin);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "set_chat_avatar",
        groupChatIconUrl: previewIconUrl,
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "set_chat_avatar",
      result: { status: "requested" },
    });

    expect(mocks.updateHostedLinqChatAvatar).toHaveBeenCalledWith({
      chatId: "chat_group_1",
      groupChatIconUrl: previewIconUrl,
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
        groupChatIconUrl:
          `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}?exp=2000000000`,
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

  it.each([
    {
      error: new Error("network connection lost"),
      label: "network failure",
    },
    {
      error: hostedOnboardingError({
        code: "LINQ_SEND_FAILED",
        httpStatus: 502,
        message: "Linq chat avatar update timed out.",
        retryable: true,
      }),
      label: "transport timeout",
    },
  ])("reports an unconfirmed group avatar $label as structured unavailability", async ({ error }) => {
    mocks.updateHostedLinqChatAvatar.mockRejectedValue(error);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "set_chat_avatar",
        groupChatIconUrl:
          `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}?exp=2000000000`,
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "set_chat_avatar",
      result: {
        status: "unavailable",
        unavailableReason: "provider_unavailable",
      },
    });
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({ step: "hosted-groups.set-chat-avatar" }),
      "provider-request-unconfirmed",
      {
        errorName: error.name,
        providerErrorCode: undefined,
      },
    );
    expect(mocks.updateHostedLinqChatAvatar).toHaveBeenCalledOnce();
  });

  it("preserves only validated HTTP provider diagnostics for group avatar failures", async () => {
    mocks.updateHostedLinqChatAvatar.mockRejectedValue(hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      details: {
        failureStage: "http",
        providerErrorCode: 5006,
        traceId: "must-not-propagate",
      },
      httpStatus: 502,
      message: "Linq chat avatar update failed with HTTP 400.",
    }));

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "set_chat_avatar",
        groupChatIconUrl:
          `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`,
        linqThread: LINQ_THREAD,
      },
    })).resolves.toEqual({
      action: "set_chat_avatar",
      result: {
        providerErrorCode: 5006,
        status: "unavailable",
        unavailableReason: "provider_unavailable",
      },
    });
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({ step: "hosted-groups.set-chat-avatar" }),
      "provider-request-rejected",
      {
        errorName: "HostedOnboardingError",
        providerErrorCode: 5006,
      },
    );
    expect(mocks.updateHostedLinqChatAvatar).toHaveBeenCalledOnce();
  });

  it.each([
    new Error("transport failed with private details"),
    hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: "Linq chat avatar update timed out.",
      retryable: true,
    }),
    hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      details: {
        failureStage: "http",
        providerErrorMessage: "Failed to download image",
      },
      httpStatus: 502,
      message: "Linq chat avatar update failed with HTTP 400.",
    }),
  ])("keeps non-validated avatar failures generic", async (error) => {
    mocks.updateHostedLinqChatAvatar.mockRejectedValue(error);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "set_chat_avatar",
        groupChatIconUrl:
          `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`,
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
      message: { channel: "linq", messageId: "msg_offer_1" },
      originAssistantInputId: DISCLOSURE_ORIGIN_ASSISTANT_INPUT_ID,
      permissionText: "Recent sleep timing and duration",
      postedAt: expect.any(Date),
      tx: fakeTx,
    });
  });

  it("posts the canonical snapshot with provider-owned recency chronology", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:01:00.400Z"));
    mocks.sendHostedLinqChatMessage.mockImplementationOnce(() => {
      vi.setSystemTime(new Date("2026-07-31T12:01:00.700Z"));
      return Promise.resolve({
        chatId: "chat_group_1",
        messageCreatedAt: "2026-07-31T12:01:00.000Z",
        messageId: "msg_offer_1",
      });
    });
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
        offeredAt: "2026-07-31T12:01:00.000Z",
        offerState: "posted",
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
          "Like or heart this message if these default sharing choices look right: your Murph profile name, email address, sleep duration, activity minutes, workout summaries, resting heart rate, and HRV. Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.",
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
      message: { channel: "linq", messageId: "msg_offer_1" },
      postedAt: new Date("2026-07-31T12:01:00.000Z"),
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

  it("omits recency evidence when the provider omits message chronology", async () => {
    mocks.sendHostedLinqChatMessage.mockResolvedValueOnce({
      chatId: "chat_group_1",
      messageId: "msg_offer_without_time",
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
        group: GROUP_SUMMARY,
        joinUrl: "https://www.withmurph.ai/groups/join/abc123",
        offerState: "posted",
        status: "sent",
      },
    });

    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      message: { channel: "linq", messageId: "msg_offer_without_time" },
      postedAt: expect.any(Date),
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
      tx: fakeTx,
    });
  });

  it("keeps the permissions link without promising or disclosing private outreach", async () => {
    mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx.mockResolvedValueOnce({
      group: groupSummaryWithOwnerEmailGrant(),
      joinCode: "abc123",
    });

    await handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: { projectionKinds: ["sleep-duration-days.v0"] },
        linqThread: LINQ_THREAD,
      },
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.not.stringContaining(
          "Murph may text you privately to help you join",
        ),
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.not.stringContaining(
          "Like or heart this message to share",
        ),
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Like or heart this message if these default sharing choices look right:",
        ),
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.",
        ),
      }),
    );
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
          "Like or heart this message if these default sharing choices look right: your Murph profile name and health source connection status. Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.",
      }),
    );
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      message: { channel: "linq", messageId: "msg_offer_1" },
      postedAt: expect.any(Date),
      projectionScopes: diagnosticScopes,
      tx: fakeTx,
    });
  });

  it("discloses the meal source when a nutrition scope is offered", async () => {
    const nutritionScopes = [{ projectionKind: "protein-days.v0" as const }];

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "post_join_offer",
        joinOffer: { projectionScopes: nutritionScopes },
        linqThread: LINQ_THREAD,
      },
    })).resolves.toMatchObject({
      action: "post_join_offer",
      result: { status: "sent" },
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Like or heart this message if these default sharing choices look right: your Murph profile name and daily protein (nutrition totals come from your meals in Murph, including meals imported from connected apps). Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.",
      }),
    );
  });

  it.each([
    ["deep sleep", "deep-sleep-days.v0", "deep-sleep-sources-days.v1", "deep sleep"],
    ["REM sleep", "rem-sleep-days.v0", "rem-sleep-sources-days.v1", "REM sleep"],
  ] as const)(
    "upgrades legacy %s requests and discloses each source in the native offer",
    async (_label, requestedProjectionKind, offeredProjectionKind, displayLabel) => {
      await expect(handleHostedRuntimeGroupTool({
        memberId: "member_container",
        request: {
          action: "post_join_offer",
          joinOffer: {
            projectionScopes: [{ projectionKind: requestedProjectionKind }],
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
            `Like or heart this message if these default sharing choices look right: your Murph profile name and ${displayLabel} (by-source sleep includes every available source's value and name, plus when Murph recorded that source value). Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.`,
        }),
      );
      const offeredScopes = [{ projectionKind: offeredProjectionKind }];
      expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx)
        .toHaveBeenCalledWith(expect.objectContaining({
          requestedVaultShareProjectionScopes: offeredScopes,
        }));
      expect(mocks.prepareHostedGroupJoinOfferPostTx).toHaveBeenCalledWith({
        groupId: GROUP_SUMMARY.id,
        projectionScopes: offeredScopes,
        tx: fakeTx,
      });
      expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
        groupId: GROUP_SUMMARY.id,
        message: { channel: "linq", messageId: "msg_offer_1" },
        postedAt: expect.any(Date),
        projectionScopes: offeredScopes,
        tx: fakeTx,
      });
    },
  );

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
        offerState: "existing",
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

  it("posts an explicit offer when every current member already grants every requested scope", async () => {
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
        offeredAt: expect.any(String),
        offerState: "posted",
        status: "sent",
      },
    });

    expect(mocks.prepareHostedGroupJoinOfferPostTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      projectionScopes: requestedScopes,
      tx: fakeTx,
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_group_1",
        message: expect.stringContaining(
          "your Murph profile name and steps",
        ),
      }),
    );
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      message: { channel: "linq", messageId: "msg_offer_1" },
      postedAt: expect.any(Date),
      projectionScopes: requestedScopes,
      tx: fakeTx,
    });
  });

  it("posts an explicit profile-only offer for a complete current roster", async () => {
    const fullyGrantedGroup = {
      ...GROUP_SUMMARY,
      memberCount: 1,
      members: [{
        disclosureGrants: [],
        grantedVaultShareProjectionKinds: [],
        grantedVaultShareProjectionScopes: [],
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
      request: { action: "post_join_offer", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "post_join_offer",
      result: {
        group: fullyGrantedGroup,
        joinUrl: "https://www.withmurph.ai/groups/join/abc123",
        offeredAt: expect.any(String),
        offerState: "posted",
        status: "sent",
      },
    });

    expect(mocks.prepareHostedGroupJoinOfferPostTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      projectionScopes: [],
      tx: fakeTx,
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_group_1",
        message: expect.stringContaining("your Murph profile name"),
      }),
    );
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      message: { channel: "linq", messageId: "msg_offer_1" },
      postedAt: expect.any(Date),
      projectionScopes: [],
      tx: fakeTx,
    });
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

  it.each([
    ["inside the original window", 60 * 60 * 1_000],
    ["after the original window", 25 * 60 * 60 * 1_000],
  ])("fails replayed provider chronology closed %s", async (_label, retryDelayMs) => {
    const requestedScopes = [{ projectionKind: "steps-days.v0" as const }];
    const request = {
      action: "post_join_offer" as const,
      joinOffer: { projectionScopes: requestedScopes },
      linqThread: LINQ_THREAD,
    };
    const originalCreatedAt = new Date("2026-07-31T12:01:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(originalCreatedAt);
    mocks.sendHostedLinqChatMessage.mockResolvedValue({
      chatId: "chat_group_1",
      messageCreatedAt: originalCreatedAt.toISOString(),
      messageId: "msg_offer_1",
    });
    mocks.recordHostedGroupJoinOfferTx.mockRejectedValueOnce(
      new Error("transient binding failure"),
    );

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request,
    })).resolves.toEqual({
      action: "post_join_offer",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "offer_binding_failed",
      },
    });

    vi.setSystemTime(originalCreatedAt.getTime() + retryDelayMs);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request,
    })).resolves.toEqual({
      action: "post_join_offer",
      result: {
        group: GROUP_SUMMARY,
        joinUrl: "https://www.withmurph.ai/groups/join/abc123",
        offerState: "posted",
        status: "sent",
      },
    });

    const providerCalls = mocks.sendHostedLinqChatMessage.mock.calls;
    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[0]?.[0].idempotencyKey)
      .toBe(providerCalls[1]?.[0].idempotencyKey);
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledTimes(2);
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenNthCalledWith(1, {
      groupId: GROUP_SUMMARY.id,
      message: { channel: "linq", messageId: "msg_offer_1" },
      postedAt: originalCreatedAt,
      projectionScopes: requestedScopes,
      tx: fakeTx,
    });
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenNthCalledWith(2, {
      groupId: GROUP_SUMMARY.id,
      message: { channel: "linq", messageId: "msg_offer_1" },
      postedAt: originalCreatedAt,
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
          "Like or heart this message if these default sharing choices look right: your Murph profile name, steps, and health source connection status. Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.",
      }),
    );
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      message: { channel: "linq", messageId: "msg_offer_1" },
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
          "Like or heart this message if these default sharing choices look right: your Murph profile name, running minutes, and health source connection status. Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.",
      }),
    );
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      message: { channel: "linq", messageId: "msg_offer_1" },
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
          "Like or heart this message if these default sharing choices look right: your Murph profile name. Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.",
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
          "Like or heart this message if these default sharing choices look right: your Murph profile name and email address. Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.",
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
          "Like or heart this message if these default sharing choices look right: your Murph profile name, sleep timing, activity minutes, workout summaries, resting heart rate, and HRV. Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.",
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
          "Like or heart this message if these default sharing choices look right: your Murph profile name, email address, sleep timing, activity minutes, workout summaries, resting heart rate, and HRV. Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.",
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
        offeredAt: expect.any(String),
        offerState: "posted",
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
          "Like or heart this message if these default sharing choices look right: your Murph profile name and recent running distance and session count. Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.",
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
          "Like or heart this message if these default sharing choices look right: your Murph profile name. Use https://www.withmurph.ai/groups/join/abc123 to choose different permissions.",
      }),
    );
    expect(mocks.recordHostedGroupJoinOfferTx).toHaveBeenCalledWith({
      groupId: GROUP_SUMMARY.id,
      message: { channel: "linq", messageId: "msg_offer_1" },
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
    expect(mocks.shareMurphHostedLinqContactCardVcfToChat).not.toHaveBeenCalled();
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

  it("reads the live roster when read_current reports no hosted group", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.readHostedGroupByRuntimeMemberId.mockResolvedValue(null);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_current" },
    })).resolves.toEqual({
      action: "read_current",
      result: { group: null, status: "none" },
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_chat_participants", linqThread: LINQ_THREAD },
    })).resolves.toMatchObject({
      action: "read_chat_participants",
      result: { status: "ok" },
    });

    expect(mocks.getHostedLinqChatHandles).toHaveBeenCalledWith({
      chatId: "chat_group_1",
    });
  });

  it("reconciles the SMS-admitted participant read before denying its effectful follow-up", async () => {
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
    expect(mocks.hasHostedMemberActivationProof).toHaveBeenCalledWith({
      memberId: "member_participant",
      prisma: expect.anything(),
    });
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

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "share_contact_card" },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "linq_thread_unavailable",
      },
    });

    expect(mocks.getHostedLinqChatHandles).toHaveBeenCalledTimes(1);
    expect(mocks.shareMurphHostedLinqContactCardVcfToChat).not.toHaveBeenCalled();
  });

  it("adds owner-only advisory names independently of Murph activation", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockResolvedValue(
      addressBookLookupResult(new Map([
        ["+15550000001", "Registered R."],
        ["+15550000002", "Alex R."],
      ])),
    );
    mocks.getHostedLinqChatHandles.mockResolvedValue([
      { handle: "+15557770000", isMe: true, status: "active" },
      { handle: "+15550000001", isMe: false, status: "active" },
      { handle: "+15550000002", isMe: false, status: "active" },
    ]);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockImplementation(
      async ({ phoneNumber }) => phoneNumber === "+15550000001"
        ? { core: { id: "member_participant", suspendedAt: null } }
        : null,
    );

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_chat_participants", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "read_chat_participants",
      result: {
        participants: [
          {
            handle: "+15550000001",
            hasOwnMurph: true,
            ownerAdvisoryName: "Registered R.",
          },
          {
            handle: "+15550000002",
            hasOwnMurph: false,
            ownerAdvisoryName: "Alex R.",
          },
        ],
        status: "ok",
      },
    });
    expect(mocks.readHostedOwnerAddressBookAdvisoryNames).toHaveBeenCalledWith({
      containerMemberId: "member_container",
      phoneHandles: ["+15550000001", "+15550000002"],
      prisma: expect.anything(),
    });
    expect(info).toHaveBeenCalledExactlyOnceWith(
      "Hosted address-book advisory lookup finished.",
      {
        canonicalHandleCount: 2,
        contactMatchCount: 2,
        labelMatchCount: 2,
        outcome: "matched",
        requestedHandleCount: 2,
      },
    );
    const diagnostic = JSON.stringify(info.mock.calls);
    expect(diagnostic).not.toContain("+15550000001");
    expect(diagnostic).not.toContain("Registered R.");
    expect(diagnostic).not.toContain("member_container");
    info.mockRestore();
  });

  it("keeps the truthful roster available when advisory lookup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockRejectedValue(
      new Error("sensitive provider detail"),
    );
    mocks.getHostedLinqChatHandles.mockResolvedValue([
      { handle: "+15557770000", isMe: true, status: "active" },
      { handle: "+15550000001", isMe: false, status: "active" },
      { handle: "+15550000002", isMe: false, status: "active" },
    ]);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockImplementation(
      async ({ phoneNumber }) => phoneNumber === "+15550000001"
        ? { core: { id: "member_participant", suspendedAt: null } }
        : null,
    );

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_chat_participants", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "read_chat_participants",
      result: {
        participants: [
          { handle: "+15550000001", hasOwnMurph: true },
          { handle: "+15550000002", hasOwnMurph: false },
        ],
        status: "ok",
      },
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Hosted address-book advisory lookup unavailable.",
      {
        errorName: "Error",
        outcome: "lookup_failed",
      },
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "sensitive provider detail",
    );
    warn.mockRestore();
  });

  it.each(["success", "failure"] as const)(
    "records the deadline once when advisory lookup settles late with %s",
    async (lateOutcome) => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.useFakeTimers();
      try {
        let resolveLookup:
          ((value: ReturnType<typeof addressBookLookupResult>) => void) | undefined;
        let rejectLookup: ((reason: Error) => void) | undefined;
        mocks.readHostedOwnerAddressBookAdvisoryNames.mockReturnValue(
          new Promise((resolve, reject) => {
            resolveLookup = resolve;
            rejectLookup = reject;
          }),
        );
        mocks.getHostedLinqChatHandles.mockResolvedValue([
          { handle: "+15557770000", isMe: true, status: "active" },
          { handle: "+15550000001", isMe: false, status: "active" },
          { handle: "+15550000002", isMe: false, status: "active" },
        ]);
        mocks.lookupHostedMemberIdentityByPhoneNumber.mockImplementation(
          async ({ phoneNumber }) => phoneNumber === "+15550000001"
            ? { core: { id: "member_participant", suspendedAt: null } }
            : null,
        );

        const response = handleHostedRuntimeGroupTool({
          memberId: "member_container",
          request: { action: "read_chat_participants", linqThread: LINQ_THREAD },
        });
        await vi.advanceTimersByTimeAsync(
          HOSTED_ADDRESS_BOOK_LOOKUP_TIMEOUT_MS,
        );
        await expect(response).resolves.toEqual({
          action: "read_chat_participants",
          result: {
            participants: [
              { handle: "+15550000001", hasOwnMurph: true },
              { handle: "+15550000002", hasOwnMurph: false },
            ],
            status: "ok",
          },
        });
        expect(info).toHaveBeenCalledExactlyOnceWith(
          "Hosted address-book advisory lookup unavailable.",
          { outcome: "deadline_exceeded" },
        );
        if (lateOutcome === "success") {
          resolveLookup?.(addressBookLookupResult(new Map([
            ["+15550000001", "Late R."],
          ])));
        } else {
          rejectLookup?.(new Error("sensitive late provider detail"));
        }
        await Promise.resolve();
        expect(info).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
        info.mockRestore();
        warn.mockRestore();
      }
    },
  );

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
    expect(mocks.hasHostedMemberActivationProof).toHaveBeenCalledTimes(
      HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
    );
    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
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

  it("does not confuse durable Murph activation with current access", async () => {
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);
    mocks.hasHostedMemberActivationProof.mockResolvedValue(true);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "read_chat_participants", linqThread: LINQ_THREAD },
    })).resolves.toMatchObject({
      action: "read_chat_participants",
      result: {
        participants: [
          { handle: "+15550000001", hasOwnMurph: true },
          { handle: "person@example.com", hasOwnMurph: false },
        ],
        status: "ok",
      },
    });

    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
    expect(mocks.readHostedGroupByRuntimeMemberId).not.toHaveBeenCalled();
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

  it("shares the contact card vcf into the chat through the shared helper", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "share_contact_card", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: { status: "sent" },
    });

    expect(mocks.shareMurphHostedLinqContactCardVcfToChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_group_1",
        idempotencyKeyPrefix: "group-contact-card",
        memberId: "member_container",
      }),
    );
  });

  it("authorizes a generated contact card through the direct route owner, not the group thread store", async () => {
    const contactCardImageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    mocks.hostedThreadContainerFindUnique.mockResolvedValue(null);
    mocks.assertHostedLinqRecentInboundEngagementForRuntime.mockResolvedValue({
      targetOverride: null,
      threadIsDirect: true,
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "share_contact_card",
        contactCardImageUrl,
        contactCardShareKey: "input_direct_1",
        directLinqChatId: "chat_direct_1",
      },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: { status: "sent" },
    });

    // A direct home chat can never exist in the group thread-route store, so
    // that assertion must not be the one gating this send.
    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
    expect(mocks.assertHostedLinqRecentInboundEngagementForRuntime)
      .toHaveBeenCalledWith(expect.objectContaining({
        authorityCheckOnly: true,
        memberId: "member_container",
        target: "chat_direct_1",
      }));
    expect(mocks.hostedThreadContainerFindUnique).not.toHaveBeenCalled();
    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
    expect(mocks.shareMurphHostedLinqContactCardVcfToChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_direct_1",
        idempotencyKeyPrefix: "personalized-contact-card",
        imageUrl: contactCardImageUrl,
        memberId: "member_container",
        shareKey: "input_direct_1",
      }),
    );
  });

  it.each([
    {
      label: "the direct owner rejects the chat",
      setup: () => {
        mocks.assertHostedLinqRecentInboundEngagementForRuntime
          .mockRejectedValue(new Error("route authority mismatch"));
      },
    },
    {
      label: "the resolved route is not direct",
      setup: () => {
        mocks.assertHostedLinqRecentInboundEngagementForRuntime
          .mockResolvedValue({ targetOverride: null, threadIsDirect: false });
      },
    },
  ])("refuses a generated contact card when $label", async ({ setup }) => {
    const contactCardImageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    setup();

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "share_contact_card",
        contactCardImageUrl,
        contactCardShareKey: "input_direct_1",
        directLinqChatId: "chat_direct_1",
      },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "linq_thread_unauthorized",
      },
    });

    expect(mocks.shareMurphHostedLinqContactCardVcfToChat).not.toHaveBeenCalled();
  });

  it("fails closed before group authorization when a personalized request lacks direct binding", async () => {
    const contactCardImageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "share_contact_card",
        contactCardImageUrl,
        contactCardShareKey: "input_direct_1",
        linqThread: LINQ_THREAD,
      } as never,
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "direct_attachment_route_unavailable",
      },
    });

    expect(mocks.assertHostedLinqRecentInboundEngagementForRuntime)
      .not.toHaveBeenCalled();
    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
    expect(mocks.shareMurphHostedLinqContactCardVcfToChat).not.toHaveBeenCalled();
  });

  it("rejects an untrusted generated contact-card image URL before fetching it", async () => {
    mocks.assertHostedLinqRecentInboundEngagementForRuntime.mockResolvedValue({
      targetOverride: null,
      threadIsDirect: true,
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "share_contact_card",
        contactCardImageUrl: "https://example.invalid/avatar.png",
        contactCardShareKey: "input_direct_1",
        directLinqChatId: "chat_direct_1",
      },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: {
        status: "unavailable",
        unavailableReason: "contact_card_image_url_unavailable",
      },
    });

    expect(mocks.hostedThreadContainerFindUnique).not.toHaveBeenCalled();
    expect(mocks.shareMurphHostedLinqContactCardVcfToChat).not.toHaveBeenCalled();
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
    expect(mocks.shareMurphHostedLinqContactCardVcfToChat).not.toHaveBeenCalled();
  });

  it("reports already_shared when the per-chat throttle is active", async () => {
    mocks.shareMurphHostedLinqContactCardVcfToChat.mockResolvedValue({
      status: "already_shared",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: { action: "share_contact_card", linqThread: LINQ_THREAD },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: { status: "already_shared" },
    });
  });

  it("reports an unconfirmed personalized send as unconfirmed, not as a failure", async () => {
    const contactCardImageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    mocks.hostedThreadContainerFindUnique.mockResolvedValue(null);
    mocks.assertHostedLinqRecentInboundEngagementForRuntime.mockResolvedValue({
      targetOverride: null,
      threadIsDirect: true,
    });
    mocks.shareMurphHostedLinqContactCardVcfToChat.mockResolvedValue({
      status: "unconfirmed",
    });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_container",
      request: {
        action: "share_contact_card",
        contactCardImageUrl,
        contactCardShareKey: "input_first",
        directLinqChatId: "chat_direct_1",
      },
    })).resolves.toEqual({
      action: "share_contact_card",
      result: { status: "unconfirmed" },
    });
  });

  it("maps a line_unresolved skip to structured unavailability", async () => {
    mocks.shareMurphHostedLinqContactCardVcfToChat.mockResolvedValue({
      status: "skipped",
      reason: "line_unresolved",
    });

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
  });

  it("maps a send failure to structured unavailability", async () => {
    mocks.shareMurphHostedLinqContactCardVcfToChat.mockResolvedValue({
      status: "failed",
      reason: "send_failed",
      error: new Error("upload failed"),
    });

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

  it("maps a provider_unavailable skip to structured unavailability", async () => {
    mocks.shareMurphHostedLinqContactCardVcfToChat.mockResolvedValue({
      status: "skipped",
      reason: "provider_unavailable",
    });

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
  });
});
