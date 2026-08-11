import { HostedBillingStatus, Prisma } from "@prisma/client";
import {
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  createHostedMailboxAssistantInputId,
  readHostedConversationAssistantIdentifierSecret,
} from "@murphai/hosted-execution/assistant-identifiers";
import type { HostedMailboxItem } from "@murphai/hosted-execution/runtime-control";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureHostedThreadContainerRouteTx,
  refreshHostedThreadContainerDeliveryRouteTx,
} from "../src/lib/hosted-routing/thread-container-service";
import {
  buildHostedThreadDeliveryRoute,
  openHostedThreadDeliveryRoute,
  sealHostedThreadDeliveryRoute,
} from "../src/lib/hosted-routing/thread-delivery-route";
import {
  appendHostedLinqThreadRouteParticipantContextTx,
  appendHostedLinqThreadRouteReactionContextTx,
  consumeHostedLinqThreadRoutePendingContextTx,
  markHostedLinqThreadRouteParticipantAdditionPendingTx,
  readHostedThreadRouteByThreadIdentity,
} from "../src/lib/hosted-routing/thread-route-store";
import {
  createHostedEmailLookupKey,
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
  createHostedLinqMessageLookupKey,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
  readHostedPhoneHint,
} from "../src/lib/hosted-onboarding/contact-privacy";
import {
  encryptHostedLinqLinePhoneNumber,
} from "../src/lib/hosted-onboarding/linq-line-phone-codec";
import type {
  HostedLinqMessageReceivedEvent,
} from "../src/lib/hosted-onboarding/linq";
import {
  buildHostedLinqGroupLineRecoveryEffectId,
  buildHostedLinqGroupLineRecoverySourceRef,
} from "../src/lib/hosted-onboarding/linq-group-line-recovery";
import { buildHostedLinqGroupSetupMessage } from "../src/lib/hosted-onboarding/linq-group-setup";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "../src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  planHostedLinqMessageEditedWebhook,
  planHostedOnboardingLinqWebhook as planHostedOnboardingLinqWebhookWithoutPreparedCrypto,
  shouldPrepareHostedLinqThreadContainerCrypto,
} from "../src/lib/hosted-onboarding/webhook-provider-linq";
import {
  resolveHostedOnboardingLinqMessageContext,
} from "../src/lib/hosted-onboarding/webhook-provider-linq-shared";
import {
  handleHostedOnboardingLinqWebhook,
} from "../src/lib/hosted-onboarding/webhook-service";

const secureBoxMocks = vi.hoisted(() => ({
  openHostedUserSecureBoxString: vi.fn(),
  sealHostedUserSecureBoxString: vi.fn(),
}));
const usageReferralMocks = vi.hoisted(() => ({
  bindArmedHostedUsageReferralToNewContainerTx: vi.fn(async () => ({
    referralIds: [],
  })),
  observeHostedUsageReferralInboundTx: vi.fn(async (): Promise<{
    isBoundReferralTarget: boolean;
    qualificationCandidateReferralIds: string[];
  }> => ({
    isBoundReferralTarget: false,
    qualificationCandidateReferralIds: [],
  })),
  reconcileHostedUsageReferralRewardAfterCommit: vi.fn(async () => null),
}));
const preparedThreadMocks = vi.hoisted(() => ({
  ensureHostedPreparedLinqThreadContainerRouteTx: vi.fn(),
}));
const pendingGroupSetupMocks = vi.hoisted(() => ({
  readHostedPendingGroupSetup: vi.fn(),
  readHostedPendingGroupSetupCandidatesForParticipantsTx: vi.fn(),
}));

vi.mock("../src/lib/hosted-routing/thread-route-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lib/hosted-routing/thread-route-store")
  >();
  return {
    ...actual,
    requiresHostedThreadDeliveryRouteRefresh:
      actual.requiresHostedThreadDeliveryRouteRefresh,
  };
});

vi.mock("../src/lib/hosted-growth/usage-referral", () => ({
  bindArmedHostedUsageReferralToNewContainerTx:
    usageReferralMocks.bindArmedHostedUsageReferralToNewContainerTx,
  observeHostedUsageReferralInboundTx:
    usageReferralMocks.observeHostedUsageReferralInboundTx,
  reconcileHostedUsageReferralRewardAfterCommit:
    usageReferralMocks.reconcileHostedUsageReferralRewardAfterCommit,
}));

vi.mock("../src/lib/hosted-groups/prepared-thread-container", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lib/hosted-groups/prepared-thread-container")
  >();
  preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx
    .mockImplementation(actual.ensureHostedPreparedLinqThreadContainerRouteTx);
  return {
    ...actual,
    ensureHostedPreparedLinqThreadContainerRouteTx:
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
  };
});

vi.mock("../src/lib/hosted-groups/pending-group-setup", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lib/hosted-groups/pending-group-setup")
  >();
  pendingGroupSetupMocks.readHostedPendingGroupSetup.mockResolvedValue(null);
  pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx
    .mockResolvedValue([]);
  return {
    ...actual,
    readHostedPendingGroupSetup:
      pendingGroupSetupMocks.readHostedPendingGroupSetup,
    readHostedPendingGroupSetupCandidatesForParticipantsTx:
      pendingGroupSetupMocks
        .readHostedPendingGroupSetupCandidatesForParticipantsTx,
  };
});

vi.mock("../src/lib/hosted-crypto/secure-box", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lib/hosted-crypto/secure-box")
  >();
  secureBoxMocks.openHostedUserSecureBoxString.mockImplementation(
    actual.openHostedUserSecureBoxString,
  );
  secureBoxMocks.sealHostedUserSecureBoxString.mockImplementation(
    actual.sealHostedUserSecureBoxString,
  );
  return {
    ...actual,
    openHostedUserSecureBoxString:
      secureBoxMocks.openHostedUserSecureBoxString,
    sealHostedUserSecureBoxString:
      secureBoxMocks.sealHostedUserSecureBoxString,
  };
});

vi.mock("../src/lib/hosted-mailbox/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-mailbox/store")>();
  return {
    ...actual,
    appendHostedMailboxEnvelopeTx: vi.fn(),
    appendHostedMailboxEnvelopeWithSourceMessageTx: vi.fn(),
    readHostedMailboxItemByDedupeKey: vi.fn(),
    readHostedMailboxSourceConversationEntriesTx: vi.fn(),
  };
});

vi.mock("../src/lib/hosted-execution/usage-allowance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-execution/usage-allowance")>();
  return {
    ...actual,
    checkHostedAiUsageGate: vi.fn(),
  };
});

vi.mock("../src/lib/hosted-onboarding/linq-daily-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-onboarding/linq-daily-state")>();
  return {
    ...actual,
    incrementHostedLinqInboundDailyState: vi.fn(),
    incrementHostedLinqOutboundDailyState: vi.fn(),
  };
});

vi.mock("../src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-crypto/domain-root-store")>();
  return {
    ...actual,
    prepareHostedCryptoDomainRootCandidates: vi.fn(async () => new Map()),
    prewarmPreparedHostedCryptoDomainRootForWeb: vi.fn(async () => undefined),
    provisionPreparedHostedCryptoDomainRootsTx: vi.fn(async () => undefined),
    provisionHostedCryptoDomainRootsForUserTx: vi.fn(),
    unwrapHostedDomainRootForWeb: vi.fn(async () => ({
      envelope: { rootKeyId: "root-control-active" },
      rootKey: new Uint8Array(32),
    })),
  };
});

vi.mock("../src/lib/hosted-onboarding/hosted-member-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-onboarding/hosted-member-store")>();
  return {
    ...actual,
    createHostedMember: vi.fn(),
    readHostedMemberCoreState: vi.fn(),
  };
});

vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lib/hosted-onboarding/hosted-member-identity-store")
  >();
  return {
    ...actual,
    lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  };
});

vi.mock("../src/lib/hosted-onboarding/hosted-member-routing-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lib/hosted-onboarding/hosted-member-routing-store")
  >();
  return {
    ...actual,
    demoteHostedMemberLinqGroupChatBindingsTx: vi.fn(),
    lookupHostedMemberCoreByPendingLinqParticipantContact: vi.fn(),
    readHostedMemberRoutingState: vi.fn(),
  };
});

vi.mock("../src/lib/prisma", () => ({
  getPrisma: vi.fn(),
}));

vi.mock("../src/lib/hosted-onboarding/linq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-onboarding/linq")>();
  return {
    ...actual,
    sendHostedLinqReadReceipt: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    verifyAndParseHostedLinqWebhookRequest: vi.fn(),
  };
});

vi.mock("../src/lib/hosted-onboarding/linq-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-onboarding/linq-client")>();
  return {
    ...actual,
    getHostedLinqChatHandles: vi.fn(),
    getHostedLinqChatSummary: vi.fn(),
  };
});

vi.mock("../src/lib/hosted-orchestration/signal-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-orchestration/signal-runtime")>();
  return {
    ...actual,
    signalHostedMailboxAppendRuntime: vi.fn().mockResolvedValue({
      signalAccepted: true,
      workflowId: "workflow_group_123",
    }),
    signalHostedRuntimeMaintenanceRuntime: vi.fn(),
  };
});

vi.mock("../src/lib/hosted-runtime-latency/store", () => ({
  recordHostedIngressAcceptedFromMailboxItem: vi.fn().mockResolvedValue(undefined),
  recordHostedIngressTemporalSignalAccepted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: vi.fn(() => null),
}));

const mailboxStore = await import("../src/lib/hosted-mailbox/store");
const memberIdentityStore = await import("../src/lib/hosted-onboarding/hosted-member-identity-store");
const memberRoutingStore = await import("../src/lib/hosted-onboarding/hosted-member-routing-store");
const usageAllowance = await import("../src/lib/hosted-execution/usage-allowance");
const linqDailyState = await import("../src/lib/hosted-onboarding/linq-daily-state");
const domainRootStore = await import("../src/lib/hosted-crypto/domain-root-store");
const hostedMemberStore = await import("../src/lib/hosted-onboarding/hosted-member-store");
const prismaModule = await import("../src/lib/prisma");
const linqModule = await import("../src/lib/hosted-onboarding/linq");
const linqClient = await import("../src/lib/hosted-onboarding/linq-client");
const signalRuntime = await import("../src/lib/hosted-orchestration/signal-runtime");

const TEST_KEYRING_ENTRIES = {
  v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
  v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  pendingGroupSetupMocks.readHostedPendingGroupSetup.mockReset();
  pendingGroupSetupMocks.readHostedPendingGroupSetup.mockResolvedValue(null);
  pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx
    .mockReset();
  pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx
    .mockResolvedValue([]);
  // Group setup links are built from the hosted onboarding public base URL, and
  // the environment read is memoized on globalThis.
  vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://join.example.test");
  clearHostedOnboardingEnvCache();
  usageReferralMocks.bindArmedHostedUsageReferralToNewContainerTx
    .mockResolvedValue({ referralIds: [] });
  usageReferralMocks.observeHostedUsageReferralInboundTx.mockResolvedValue({
    isBoundReferralTarget: false,
    qualificationCandidateReferralIds: [],
  });
  usageReferralMocks.reconcileHostedUsageReferralRewardAfterCommit
    .mockResolvedValue(null);
  vi.mocked(prismaModule.getPrisma).mockReset();
  vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest).mockReset();
  vi.mocked(linqClient.getHostedLinqChatHandles).mockReset();
  vi.mocked(linqClient.getHostedLinqChatHandles).mockResolvedValue([]);
  vi.mocked(linqClient.getHostedLinqChatSummary).mockReset();
  vi.mocked(memberRoutingStore.demoteHostedMemberLinqGroupChatBindingsTx).mockReset();
  vi.mocked(memberRoutingStore.demoteHostedMemberLinqGroupChatBindingsTx).mockResolvedValue({
    mailboxConsumedAt: null,
  });
  vi.mocked(memberRoutingStore.readHostedMemberRoutingState).mockReset();
  vi.mocked(
    memberRoutingStore.lookupHostedMemberCoreByPendingLinqParticipantContact,
  ).mockReset();
  vi.mocked(
    memberRoutingStore.lookupHostedMemberCoreByPendingLinqParticipantContact,
  ).mockResolvedValue(null);
  vi.mocked(linqClient.getHostedLinqChatSummary).mockResolvedValue({
    handles: [],
    isGroup: null,
  });
  vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockReset();
  vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockReset();
  vi.mocked(mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx).mockReset();
  vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx).mockReset();
  vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockReset();
  vi.mocked(usageAllowance.checkHostedAiUsageGate).mockReset();
  vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValue(null);
  vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValue({
    dedupeConflict: false,
    duplicate: false,
    inserted: true,
    item: buildHostedMailboxItem({
      id: "mailbox_group_123",
      userId: "member_thread_container_123",
    }),
  });
  vi.mocked(mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx)
    .mockImplementation(async ({ envelope, tx }) =>
      mailboxStore.appendHostedMailboxEnvelopeTx({ envelope, tx })
    );
  vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
    .mockResolvedValue([]);
  vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValue({
    dayUtc: new Date("2026-06-24T00:00:00.000Z"),
    inboundCount: 1,
    memberId: "member_thread_container_123",
    outboundCount: 0,
    quotaReplySentAt: null,
  } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
  vi.mocked(linqModule.sendHostedLinqReadReceipt).mockResolvedValue({
    ok: true,
    status: 200,
  });
  vi.mocked(signalRuntime.signalHostedMailboxAppendRuntime).mockResolvedValue({
    signalAccepted: true,
    workflowId: "workflow_group_123",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  clearHostedOnboardingEnvCache();
});

function buildLinqMessageReceivedEvent(input: {
  chatId?: string;
  createdAt?: string;
  eventId?: string;
  isFromMe?: boolean;
  isGroup?: boolean | null;
  messageId?: string;
  parts?: HostedLinqMessageReceivedEvent["data"]["message"]["parts"];
  recipient?: string;
  sender?: string;
  service?: string;
  text?: string;
}) {
  const recipient = input.recipient ?? "+15550000000";
  const service = input.service ?? "iMessage";
  return {
    api_version: "2026-01-01",
    created_at: input.createdAt ?? "2026-06-24T12:00:00.000Z",
    data: {
      chat: {
        id: input.chatId ?? "chat_group_123",
        ...(input.isGroup === null ? {} : { is_group: input.isGroup ?? true }),
        owner_handle: {
          handle: recipient,
          id: "owner_handle_123",
          is_me: true,
          service,
        },
      },
      chat_id: input.chatId ?? "chat_group_123",
      direction: input.isFromMe ? "outbound" : "inbound",
      from: input.sender ?? "+15551112222",
      is_from_me: input.isFromMe ?? false,
      message: {
        id: input.messageId ?? "msg_group_123",
        parts: input.parts ?? (input.text === ""
          ? []
          : [
              {
                type: "text",
                value: input.text ?? "How did we sleep?",
              },
            ]),
      },
      preferred_service: service,
      recipient_phone: recipient,
      received_at: input.createdAt ?? "2026-06-24T12:00:00.000Z",
      sender_handle: {
        handle: input.sender ?? "+15551112222",
        id: "sender_handle_123",
        is_me: false,
        service,
      },
      service,
    },
    event_id: input.eventId ?? "evt_group_123",
    event_type: "message.received",
  };
}

function buildLinqMessageEditedEvent(input: {
  chatId?: string;
  createdAt?: string;
  direction?: "inbound" | "outbound";
  editedAt?: string;
  eventId?: string;
  messageId?: string;
  partIndex?: number;
  sender?: string;
  text?: string;
} = {}) {
  const sender = input.sender ?? "+15551112222";
  return {
    api_version: "v3",
    created_at: input.createdAt ?? "2026-06-24T12:01:00.000Z",
    data: {
      chat: {
        id: input.chatId ?? "chat_group_123",
      },
      direction: input.direction ?? "inbound",
      edited_at: input.editedAt ?? "2026-06-24T12:01:00.000Z",
      id: input.messageId ?? "msg_group_123",
      part: {
        index: input.partIndex ?? 0,
        text: input.text ?? "Corrected question",
      },
      sender_handle: {
        handle: sender,
        id: "sender_handle_edit_123",
        is_me: false,
        service: "iMessage",
      },
    },
    event_id: input.eventId ?? "evt_group_edit_123",
    event_type: "message.edited",
    webhook_version: "2026-02-03",
  } as const;
}

function buildAcceptedGroupLinqOriginalWake(input: {
  senderMemberId?: string | null;
} = {}) {
  return buildHostedExecutionLinqConversationMessageWake({
    accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
    contactKind: "phone",
    contactLookupKey: requireTestPhoneLookupKey("+15551112222"),
    eventId: "evt_group_original_123",
    linqMessage: {
      chatId: "chat_group_123",
      from: "+15551112222",
      isFromMe: false,
      messageId: "msg_group_123",
      parts: [{ type: "text", value: "Original question" }],
      replyToMessageId: "msg_prior_123",
      service: "iMessage",
      threadIsDirect: false,
    },
    phoneLookupKey: requireTestPhoneLookupKey("+15551112222"),
    routeAuthority: {
      accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
      channel: "linq",
      containerMemberId: "member_thread_container_123",
      threadId: "chat_group_123",
    },
    ...(input.senderMemberId === null
      ? {}
      : {
          senderMemberId:
            input.senderMemberId ?? "member_active_participant_123",
        }),
    occurredAt: "2026-06-24T12:00:00.000Z",
    userId: "member_thread_container_123",
  });
}

function buildAcceptedDirectLinqOriginalWake() {
  return buildHostedExecutionLinqConversationMessageWake({
    accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
    contactKind: "phone",
    contactLookupKey: requireTestPhoneLookupKey("+15551112222"),
    eventId: "evt_direct_original_123",
    linqMessage: {
      chatId: "chat_group_123",
      from: "+15551112222",
      isFromMe: false,
      messageId: "msg_group_123",
      parts: [{ type: "text", value: "Original question" }],
      service: "iMessage",
      threadIsDirect: true,
    },
    phoneLookupKey: requireTestPhoneLookupKey("+15551112222"),
    occurredAt: "2026-06-24T12:00:00.000Z",
    userId: "member_direct_123",
  });
}

function createAcceptedEditSourceInputId(
  originalWake: ReturnType<typeof buildAcceptedGroupLinqOriginalWake>,
): string {
  return createHostedMailboxAssistantInputId({
    dedupeKey: originalWake.eventId,
    eventId: originalWake.eventId,
    lane: "conversation",
    secret: readHostedConversationAssistantIdentifierSecret(originalWake),
    userId: originalWake.userId,
  });
}

function createPrisma(input: {
  existingMemberConsentStatus?: "granted" | "revoked";
  pendingGroupReactionContextEncrypted?: string | null;
  pendingParticipantAddition?: boolean;
  routeAccountLookupKeyProjection?: string | null;
  routeAccountPhone?: string;
  routeContainerMemberId?: string | null;
  routeDeliveryRouteEncrypted?: string | null;
  routeContainerActive?: boolean;
  routeOwnerActive?: boolean;
  routeOwnerSponsored?: boolean;
  routeOwnerTrialEndsAt?: Date;
  routeParticipantAccessRequiresRosterRefresh?: boolean;
  routeParticipantActive?: boolean;
  routeParticipantConsentStatus?: "granted" | "revoked";
  routeParticipantHandleLookupKey?: string;
  routeParticipantHasProjection?: boolean;
  routeParticipantRemoved?: boolean;
} = {}) {
  const routeAccountLookupKey = createHostedPhoneLookupKey(
    input.routeAccountPhone ?? "+15550000000",
  );
  const routeContainerMemberId = input.routeContainerMemberId ?? null;
  const routeContainerActive = input.routeContainerActive ?? true;
  const routeOwnerActive = input.routeOwnerActive ?? true;
  const routeOwnerSponsored = input.routeOwnerSponsored ?? false;
  const routeOwnerBillingRef = input.routeOwnerTrialEndsAt
    ? {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: input.routeOwnerTrialEndsAt,
        currentTrialStartedAt: new Date("2001-01-01T00:00:00.000Z"),
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: new Date("2001-01-01T00:00:00.000Z"),
        stripeSubscriptionLookupKey: "subscription_lookup_route_owner_trial",
      }
    : null;
  const routeParticipantAccessRequiresRosterRefresh =
    input.routeParticipantAccessRequiresRosterRefresh ?? false;
  const routeParticipantActive = input.routeParticipantActive ?? false;
  const routeParticipantConsentStatus =
    input.routeParticipantConsentStatus ?? "granted";
  const routeParticipantHasProjection = input.routeParticipantHasProjection ?? true;
  const routeParticipantRemoved = input.routeParticipantRemoved ?? false;
  let routeParticipantLeaseRefreshed = false;
  let accountLookupKeyProjection = Object.hasOwn(
    input,
    "routeAccountLookupKeyProjection",
  )
    ? input.routeAccountLookupKeyProjection ?? null
    : routeContainerMemberId
      ? routeAccountLookupKey
      : null;
  let deliveryRouteEncrypted = input.routeDeliveryRouteEncrypted ?? null;
  let pendingGroupReactionContextEncrypted =
    input.pendingGroupReactionContextEncrypted ?? null;
  let pendingParticipantAddition = input.pendingParticipantAddition ?? false;
  const hostedThreadRoute = {
    findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (!routeContainerMemberId) {
        return [];
      }
      const lookupKeys = (where.threadLookupKey as { in?: string[] } | undefined)?.in ?? [];
      const identityLookupKeys =
        (where.threadIdentityLookupKey as { in?: string[] } | undefined)?.in ?? [];
      const expected = createHostedExternalThreadLookupKey({
        accountLookupKey: routeAccountLookupKey,
        channel: "linq",
        threadId: "chat_group_123",
      });
      const expectedIdentity = createHostedExternalThreadIdentityLookupKey({
        channel: "linq",
        threadId: "chat_group_123",
      });
      const lookupMatches = where.threadLookupKey === undefined
        || (expected !== null && lookupKeys.includes(expected));
      const identityMatches = where.threadIdentityLookupKey === undefined
        || (expectedIdentity !== null && identityLookupKeys.includes(expectedIdentity));
      if (!lookupMatches || !identityMatches) {
        return [];
      }
      return [
        {
          channel: "linq",
          container: {
            ownerMemberId: "member_owner_123",
            // Container members are synthetic (`not_started` own billing);
            // container access derives solely from suspension + the owner.
            member: {
              billingStatus: HostedBillingStatus.not_started,
              createdAt: new Date("2026-06-24T00:00:00.000Z"),
              id: routeContainerMemberId,
              suspendedAt: routeContainerActive
                ? null
                : new Date("2026-06-24T00:00:00.000Z"),
              updatedAt: new Date("2026-06-24T00:00:00.000Z"),
            },
            owner: {
              accountGroupMemberships: routeOwnerSponsored
                ? [
                    {
                      group: {
                        billingStatus: HostedBillingStatus.active,
                        suspendedAt: null,
                      },
                      status: "active",
                    },
                  ]
                : [],
              billingRef: routeOwnerBillingRef,
              billingStatus: routeOwnerSponsored
                ? HostedBillingStatus.not_started
                : routeOwnerActive
                  ? HostedBillingStatus.active
                  : HostedBillingStatus.paused,
              createdAt: new Date("2026-06-24T00:00:00.000Z"),
              id: "member_owner_123",
              suspendedAt: null,
              updatedAt: new Date("2026-06-24T00:00:00.000Z"),
            },
          },
          containerMemberId: routeContainerMemberId,
          deliveryRouteEncrypted,
          pendingGroupReactionContextEncrypted,
          pendingParticipantAddition,
          threadIdentityLookupKey: expectedIdentity,
          threadLookupKey: expected,
        },
      ];
    }),
    findFirst: vi.fn().mockImplementation(async ({ where }: {
      where: {
        channel?: string;
        containerMemberId?: string;
        threadIdentityLookupKey?: { in?: string[] };
      };
    }) => {
      const expected = createHostedExternalThreadLookupKey({
        accountLookupKey: routeAccountLookupKey,
        channel: "linq",
        threadId: "chat_group_123",
      });
      const expectedIdentity = createHostedExternalThreadIdentityLookupKey({
        channel: "linq",
        threadId: "chat_group_123",
      });
      const identityLookupKeys = where.threadIdentityLookupKey?.in ?? [];
      if (
        !routeContainerMemberId
        || where.channel !== "linq"
        || where.containerMemberId !== routeContainerMemberId
        || !expected
        || !expectedIdentity
        || !identityLookupKeys.includes(expectedIdentity)
      ) {
        return null;
      }
      return {
        containerMemberId: routeContainerMemberId,
        pendingGroupReactionContextEncrypted,
        pendingParticipantAddition,
        threadIdentityLookupKey: expectedIdentity,
        threadLookupKey: expected,
      };
    }),
    update: vi.fn().mockImplementation(async ({ data, where }: {
      data: {
        accountLookupKey?: string;
        deliveryRouteEncrypted?: string;
        pendingGroupReactionContextEncrypted?: string | null;
        threadIdentityLookupKey?: string;
        threadLookupKey?: string;
      };
      where: {
        channel_threadIdentityLookupKey: {
          channel: string;
          threadIdentityLookupKey: string;
        };
      };
    }) => {
      const expectedIdentity = createHostedExternalThreadIdentityLookupKey({
        channel: "linq",
        threadId: "chat_group_123",
      });
      if (
        !routeContainerMemberId
        || where.channel_threadIdentityLookupKey.channel !== "linq"
        || where.channel_threadIdentityLookupKey.threadIdentityLookupKey !== expectedIdentity
      ) {
        throw new Error("Expected the canonical hosted thread route update.");
      }
      if (data.deliveryRouteEncrypted !== undefined) {
        deliveryRouteEncrypted = data.deliveryRouteEncrypted;
      }
      if (data.accountLookupKey !== undefined) {
        accountLookupKeyProjection = data.accountLookupKey;
      }
      if (Object.hasOwn(data, "pendingGroupReactionContextEncrypted")) {
        pendingGroupReactionContextEncrypted =
          data.pendingGroupReactionContextEncrypted ?? null;
      }
      return {
        channel: "linq",
        containerMemberId: routeContainerMemberId,
        deliveryRouteEncrypted,
        pendingGroupReactionContextEncrypted,
        pendingParticipantAddition,
        threadIdentityLookupKey: expectedIdentity,
        threadLookupKey: data.threadLookupKey ?? null,
      };
    }),
    updateMany: vi.fn().mockImplementation(async ({ data, where }: {
      data: {
        pendingGroupReactionContextEncrypted?: string | null;
        pendingParticipantAddition?: boolean;
      };
      where: {
        channel?: string;
        containerMemberId?: string;
        pendingParticipantAddition?: boolean;
        threadIdentityLookupKey?: string | { in?: string[] };
        threadLookupKey?: string;
      };
    }) => {
      const expected = createHostedExternalThreadLookupKey({
        accountLookupKey: routeAccountLookupKey,
        channel: "linq",
        threadId: "chat_group_123",
      });
      const expectedIdentity = createHostedExternalThreadIdentityLookupKey({
        channel: "linq",
        threadId: "chat_group_123",
      });
      const identityMatches = where.threadIdentityLookupKey === undefined
        || (typeof where.threadIdentityLookupKey === "string"
          ? where.threadIdentityLookupKey === expectedIdentity
          : expectedIdentity !== null
            && (where.threadIdentityLookupKey.in ?? []).includes(expectedIdentity));
      if (
        !routeContainerMemberId
        || where.containerMemberId !== routeContainerMemberId
        || (where.channel !== undefined && where.channel !== "linq")
        || !identityMatches
        || (where.threadLookupKey !== undefined && where.threadLookupKey !== expected)
        || (where.pendingParticipantAddition === true && !pendingParticipantAddition)
      ) {
        return { count: 0 };
      }
      if (data.pendingParticipantAddition !== undefined) {
        pendingParticipantAddition = data.pendingParticipantAddition;
      }
      if (Object.hasOwn(data, "pendingGroupReactionContextEncrypted")) {
        pendingGroupReactionContextEncrypted =
          data.pendingGroupReactionContextEncrypted ?? null;
      }
      return { count: 1 };
    }),
  };
  const hostedThreadContainer = {
    findUnique: vi.fn().mockResolvedValue(null),
  };
  const hostedMemberRouting = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  };
  const hostedMember = {
    findFirst: vi.fn().mockImplementation(async ({ where }: {
      where: { id?: string };
    }) =>
      routeParticipantActive && where.id === "member_active_participant_123"
        ? { id: "member_active_participant_123" }
        : null
    ),
    findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (routeContainerMemberId && where.id === routeContainerMemberId) {
        return {
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          suspendedAt: routeContainerActive
            ? null
            : new Date("2026-06-24T00:00:00.000Z"),
          threadContainer: {
            owner: {
              accountGroupMemberships: routeOwnerSponsored
                ? [
                    {
                      group: {
                        billingStatus: HostedBillingStatus.active,
                        suspendedAt: null,
                      },
                      status: "active",
                    },
                  ]
                : [],
              billingRef: routeOwnerBillingRef,
              billingStatus: routeOwnerSponsored
                ? HostedBillingStatus.not_started
                : routeOwnerActive
                  ? HostedBillingStatus.active
                  : HostedBillingStatus.paused,
              suspendedAt: null,
            },
          },
        };
      }

      return {
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.active,
        consentGrants:
          where.id === "member_active_participant_123"
            ? [{
                scope: "launch.health-data",
                status: routeParticipantConsentStatus,
              }]
            : input.existingMemberConsentStatus
              ? [{
                  scope: "launch.health-data",
                  status: input.existingMemberConsentStatus,
                }]
              : [],
        suspendedAt: null,
        threadContainer: null,
      };
    }),
  };
  const hostedThreadContainerParticipant = {
    findUnique: vi.fn().mockImplementation(async ({ where }: {
      where: {
        containerMemberId_participantMemberId: {
          containerMemberId: string;
          participantMemberId: string;
        };
      };
    }) => {
      const identity = where.containerMemberId_participantMemberId;
      if (
        !routeParticipantHasProjection
        || identity.containerMemberId !== routeContainerMemberId
        || identity.participantMemberId !== "member_active_participant_123"
      ) {
        return null;
      }
      return {
        handleLookupKey: input.routeParticipantHandleLookupKey
          ?? requireTestPhoneLookupKey("+15551112222"),
        removedAt: routeParticipantRemoved
          ? new Date("2026-06-24T12:00:30.000Z")
          : null,
      };
    }),
    findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      routeParticipantActive
      && (
        !routeParticipantAccessRequiresRosterRefresh
        || routeParticipantLeaseRefreshed
      )
      && where.containerMemberId === routeContainerMemberId
      && where.removedAt === null
        ? {
            handleLookupKey: requireTestPhoneLookupKey("+15551112222"),
            participantMemberId: "member_active_participant_123",
          }
        : null
    ),
    findMany: vi.fn().mockImplementation(async ({ select }: {
      select?: { participant?: unknown };
    }) => {
      if (select?.participant) {
        const participantLeaseActive =
          routeParticipantActive
          && (
            !routeParticipantAccessRequiresRosterRefresh
            || routeParticipantLeaseRefreshed
          )
          && (!routeParticipantRemoved || routeParticipantLeaseRefreshed);
        return participantLeaseActive
          ? [{
              participant: {
                accountGroupMemberships: [],
                billingRef: null,
                billingStatus: HostedBillingStatus.active,
                suspendedAt: null,
              },
            }]
          : [];
      }

      return routeParticipantActive
        && routeParticipantHasProjection
        && !routeParticipantRemoved
        ? [{
            handleLookupKey: input.routeParticipantHandleLookupKey
              ?? createHostedPhoneLookupKey("+15552223333"),
            participantMemberId: "member_active_participant_123",
          }]
        : [];
    }),
    updateMany: vi.fn().mockImplementation(async ({ where }: {
      where: { participantMemberId?: string };
    }) => {
      if (
        routeParticipantHasProjection
        && !routeParticipantRemoved
        && where.participantMemberId === "member_active_participant_123"
      ) {
        routeParticipantLeaseRefreshed = true;
        return { count: 1 };
      }
      return { count: 0 };
    }),
    upsert: vi.fn().mockImplementation(async ({ create }: {
      create: { participantMemberId: string };
    }) => {
      if (create.participantMemberId === "member_active_participant_123") {
        routeParticipantLeaseRefreshed = true;
      }
      return create;
    }),
  };
  const hostedWorkspace = {
    upsert: vi.fn().mockResolvedValue({}),
  };
  const hostedMailboxItem = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  // Inbound webhooks always land on a Murph-managed line, so the route account
  // phone is backed by one healthy, assignable managed line here.
  const routeAccountPhone = input.routeAccountPhone ?? "+15550000000";
  const hostedLinqLine = {
    findMany: vi.fn().mockImplementation(async ({ select, where }: {
      select: Record<string, boolean>;
      where: { phoneNumberLookupKey?: { in?: string[] } };
    }) => {
      const lookupKeys = where.phoneNumberLookupKey?.in ?? null;
      if (
        !routeAccountLookupKey
        || (lookupKeys && !lookupKeys.includes(routeAccountLookupKey))
      ) {
        return [];
      }
      const line = {
        configuredAt: new Date("2026-06-24T00:00:00.000Z"),
        egressPolicy: "enabled",
        healthStatus: "healthy",
        phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(routeAccountPhone),
        phoneNumberHint: readHostedPhoneHint(routeAccountPhone),
        phoneNumberLookupKey: routeAccountLookupKey,
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      };
      return [
        Object.fromEntries(
          Object.entries(line).filter(([key]) => select[key] === true),
        ),
      ];
    }),
  };
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    const pendingBefore = pendingParticipantAddition;
    const accountLookupKeyBefore = accountLookupKeyProjection;
    const deliveryRouteBefore = deliveryRouteEncrypted;
    const reactionContextBefore = pendingGroupReactionContextEncrypted;
    try {
      return await callback(prisma);
    } catch (error) {
      accountLookupKeyProjection = accountLookupKeyBefore;
      deliveryRouteEncrypted = deliveryRouteBefore;
      pendingParticipantAddition = pendingBefore;
      pendingGroupReactionContextEncrypted = reactionContextBefore;
      throw error;
    }
  });
  const prisma = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: transaction,
    hostedLinqLine,
    hostedMailboxItem,
    hostedMember,
    hostedMemberRouting,
    hostedThreadContainer,
    hostedThreadContainerParticipant,
    hostedThreadRoute,
    hostedWorkspace,
    readAccountLookupKeyProjection: () => accountLookupKeyProjection,
    readDeliveryRouteEncrypted: () => deliveryRouteEncrypted,
    readPendingGroupReactionContextEncrypted: () =>
      pendingGroupReactionContextEncrypted,
    readPendingParticipantAddition: () => pendingParticipantAddition,
    setPendingGroupReactionContextEncrypted: (value: string | null) => {
      pendingGroupReactionContextEncrypted = value;
    },
  };
  return prisma;
}

function createStatefulThreadRoutePrisma() {
  type LinqLineFixture = {
    activeMemberLimit: number | null;
    assignmentWeight: number;
    configuredAt: Date | null;
    egressPolicy: string;
    healthStatus: string;
    maxNewConversationsPerDay: number | null;
    phoneNumberEncrypted: string | null;
    phoneNumberHint: string;
    phoneNumberLookupKey: string;
    proactiveConversationCount: number | null;
    proactiveConversationDayUtc: Date | null;
    providerReputationStatus: string | null;
    providerServiceStatus: string | null;
  };
  const linqLines = new Map<string, LinqLineFixture>();
  const linqDeliveries = new Map<string, {
    acceptedAt: Date | null;
    attemptedAt: Date;
    deliveredAt: Date | null;
    groupJoinOutreachId: string | null;
    groupJoinReplyOccurredAt: Date | null;
    id: string;
    idempotencyKey: string;
    lastProviderEventId: string | null;
    lastReceiptAt: Date | null;
    messageLookupKey: string | null;
    phoneNumberLookupKey: string | null;
    sourceRef: string | null;
    status: string;
    targetKind: string | null;
    template: string | null;
  }>();
  const ownerState = {
    accountGroupMemberships: [] as Array<{
      group: { billingStatus: HostedBillingStatus; suspendedAt: Date | null };
      status: string;
    }>,
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2026-06-24T00:00:00.000Z"),
    id: "member_owner_123",
    suspendedAt: null,
    updatedAt: new Date("2026-06-24T00:00:00.000Z"),
  };
  const routes: Array<{
    accountLookupKey: string | null;
    channel: string;
    containerMemberId: string;
    deliveryRouteEncrypted: string | null;
    pendingGroupReactionContextEncrypted: string | null;
    pendingParticipantAddition: boolean;
    threadIdentityLookupKey: string;
    threadLookupKey: string;
  }> = [];
  const containers = new Map<string, {
    monthlyUsageLimitUsdMicros: bigint;
    ownerMemberId: string;
  }>();
  const hostedThreadContainer = {
    create: vi.fn().mockImplementation(async ({ data }: {
      data: {
        memberId: string;
        monthlyUsageLimitUsdMicros: bigint;
        ownerMemberId: string;
      };
    }) => {
      containers.set(data.memberId, {
        monthlyUsageLimitUsdMicros: data.monthlyUsageLimitUsdMicros,
        ownerMemberId: data.ownerMemberId,
      });
      return data;
    }),
    findUnique: vi.fn().mockImplementation(async ({ where }: {
      where: {
        memberId: string;
      };
    }) => {
      return containers.has(where.memberId)
        ? {
            memberId: where.memberId,
          }
        : null;
    }),
  };
  const hostedThreadRoute = {
    create: vi.fn().mockImplementation(async ({ data }: {
      data: {
        accountLookupKey: string;
        channel: string;
        containerMemberId: string;
        deliveryRouteEncrypted: string;
        threadIdentityLookupKey: string;
        threadLookupKey: string;
      };
    }) => {
      const duplicateIdentity = routes.some((route) =>
        route.channel === data.channel
        && route.threadIdentityLookupKey === data.threadIdentityLookupKey,
      );
      if (duplicateIdentity) {
        throw new Prisma.PrismaClientKnownRequestError(
          "Unique constraint failed on the fields: (`channel`,`threadIdentityLookupKey`)",
          {
            clientVersion: "test",
            code: "P2002",
            meta: { target: ["channel", "threadIdentityLookupKey"] },
          },
        );
      }
      routes.push({
        ...data,
        pendingGroupReactionContextEncrypted: null,
        pendingParticipantAddition: false,
      });
      return data;
    }),
    findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const lookupKeys = (where.threadLookupKey as { in?: string[] } | undefined)?.in ?? [];
      const identityLookupKeys =
        (where.threadIdentityLookupKey as { in?: string[] } | undefined)?.in ?? [];
      return routes
        .filter((route) => {
          const lookupMatches = where.threadLookupKey === undefined
            || lookupKeys.includes(route.threadLookupKey);
          const identityMatches = where.threadIdentityLookupKey === undefined
            || identityLookupKeys.includes(route.threadIdentityLookupKey);
          return route.channel === where.channel && lookupMatches && identityMatches;
        })
        .map((route) => ({
          accountLookupKey: route.accountLookupKey,
          channel: route.channel,
          container: {
            member: {
              ...ownerState,
              id: route.containerMemberId,
            },
            owner: {
              ...ownerState,
              id: containers.get(route.containerMemberId)?.ownerMemberId ?? ownerState.id,
            },
            ownerMemberId: containers.get(route.containerMemberId)?.ownerMemberId
              ?? ownerState.id,
          },
          containerMemberId: route.containerMemberId,
          deliveryRouteEncrypted: route.deliveryRouteEncrypted,
          threadIdentityLookupKey: route.threadIdentityLookupKey,
          threadLookupKey: route.threadLookupKey,
        }));
    }),
    findUnique: vi.fn().mockImplementation(async ({ where }: {
      where: {
        channel_threadIdentityLookupKey: {
          channel: string;
          threadIdentityLookupKey: string;
        };
      };
    }) => {
      const route = routes.find((candidate) =>
        candidate.channel === where.channel_threadIdentityLookupKey.channel
        && candidate.threadIdentityLookupKey
          === where.channel_threadIdentityLookupKey.threadIdentityLookupKey,
      );
      if (!route) {
        return null;
      }

      return {
        container: {
          ownerMemberId: containers.get(route.containerMemberId)?.ownerMemberId ?? ownerState.id,
        },
        containerMemberId: route.containerMemberId,
      };
    }),
    findFirst: vi.fn().mockImplementation(async ({ where }: {
      where: {
        channel?: string;
        containerMemberId?: string;
        threadIdentityLookupKey?: { in?: string[] };
      };
    }) => {
      const identityLookupKeys = where.threadIdentityLookupKey?.in ?? [];
      const route = routes.find((candidate) =>
        candidate.channel === where.channel
        && candidate.containerMemberId === where.containerMemberId
        && identityLookupKeys.includes(candidate.threadIdentityLookupKey),
      );
      return route
        ? {
            containerMemberId: route.containerMemberId,
            pendingGroupReactionContextEncrypted:
              route.pendingGroupReactionContextEncrypted,
            pendingParticipantAddition: route.pendingParticipantAddition,
            threadIdentityLookupKey: route.threadIdentityLookupKey,
            threadLookupKey: route.threadLookupKey,
          }
        : null;
    }),
    update: vi.fn().mockImplementation(async ({ data, where }: {
      data: {
        accountLookupKey?: string;
        deliveryRouteEncrypted?: string;
        pendingGroupReactionContextEncrypted?: string | null;
        threadIdentityLookupKey: string;
        threadLookupKey: string;
      };
      where: {
        channel_threadIdentityLookupKey: {
          channel: string;
          threadIdentityLookupKey: string;
        };
      };
    }) => {
      const route = routes.find((candidate) =>
        candidate.channel === where.channel_threadIdentityLookupKey.channel
        && candidate.threadIdentityLookupKey
          === where.channel_threadIdentityLookupKey.threadIdentityLookupKey,
      );
      if (!route) {
        throw new Error("Expected existing route.");
      }
      if (Object.hasOwn(data, "pendingGroupReactionContextEncrypted")) {
        route.pendingGroupReactionContextEncrypted =
          data.pendingGroupReactionContextEncrypted ?? null;
      }
      if (data.accountLookupKey !== undefined) {
        route.accountLookupKey = data.accountLookupKey;
      }
      if (data.deliveryRouteEncrypted !== undefined) {
        route.deliveryRouteEncrypted = data.deliveryRouteEncrypted;
      }
      route.threadIdentityLookupKey = data.threadIdentityLookupKey;
      route.threadLookupKey = data.threadLookupKey;
      return route;
    }),
    updateMany: vi.fn().mockImplementation(async ({ data, where }: {
      data: {
        pendingGroupReactionContextEncrypted?: string | null;
        pendingParticipantAddition?: boolean;
      };
      where: {
        channel?: string;
        containerMemberId?: string;
        threadIdentityLookupKey?: string | { in?: string[] };
        threadLookupKey?: string;
      };
    }) => {
      const route = routes.find((candidate) => {
        const identityMatches = where.threadIdentityLookupKey === undefined
          || (typeof where.threadIdentityLookupKey === "string"
            ? candidate.threadIdentityLookupKey === where.threadIdentityLookupKey
            : (where.threadIdentityLookupKey.in ?? [])
                .includes(candidate.threadIdentityLookupKey));
        return candidate.channel === where.channel
          && candidate.containerMemberId === where.containerMemberId
          && identityMatches
          && (where.threadLookupKey === undefined
            || candidate.threadLookupKey === where.threadLookupKey);
      });
      if (!route) {
        return { count: 0 };
      }
      if (data.pendingParticipantAddition !== undefined) {
        route.pendingParticipantAddition = data.pendingParticipantAddition;
      }
      if (Object.hasOwn(data, "pendingGroupReactionContextEncrypted")) {
        route.pendingGroupReactionContextEncrypted =
          data.pendingGroupReactionContextEncrypted ?? null;
      }
      return { count: 1 };
    }),
  };
  const hostedMemberRouting = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  };
  const hostedLinqLine = {
    findMany: vi.fn().mockImplementation(async ({ select, where }: {
      select: Record<string, boolean>;
      where: {
        configuredAt?: { not: null };
        egressPolicy?: string;
        healthStatus?: string | { in?: string[] };
        phoneNumberEncrypted?: { not: null };
        phoneNumberLookupKey?: { in?: string[] };
      };
    }) => {
      const lookupKeys = where.phoneNumberLookupKey?.in ?? null;
      const rows = [...linqLines.values()].filter((line) => {
        if (lookupKeys && !lookupKeys.includes(line.phoneNumberLookupKey)) {
          return false;
        }
        if (where.configuredAt?.not === null && line.configuredAt === null) {
          return false;
        }
        if (
          where.phoneNumberEncrypted?.not === null
          && line.phoneNumberEncrypted === null
        ) {
          return false;
        }
        if (where.egressPolicy !== undefined && line.egressPolicy !== where.egressPolicy) {
          return false;
        }
        if (typeof where.healthStatus === "string") {
          return line.healthStatus === where.healthStatus;
        }
        if (where.healthStatus?.in) {
          return where.healthStatus.in.includes(line.healthStatus);
        }
        return true;
      });

      return rows.map((line) =>
        Object.fromEntries(
          Object.entries(line).filter(([key]) => select[key] === true),
        )
      );
    }),
    findFirst: vi.fn().mockImplementation(async ({ where }: {
      where: {
        configuredAt?: { not: null };
        egressPolicy?: string;
        healthStatus?: { in?: string[] };
        phoneNumberEncrypted?: { not: null };
        phoneNumberLookupKey?: { in?: string[] };
      };
    }) => {
      const lookupKeys = where.phoneNumberLookupKey?.in ?? null;
      const matched = [...linqLines.values()].find((line) =>
        (!lookupKeys || lookupKeys.includes(line.phoneNumberLookupKey))
        && (where.configuredAt?.not !== null || line.configuredAt !== null)
        && (
          where.phoneNumberEncrypted?.not !== null
          || line.phoneNumberEncrypted !== null
        )
        && (where.egressPolicy === undefined || line.egressPolicy === where.egressPolicy)
        && (
          !where.healthStatus?.in
          || where.healthStatus.in.includes(line.healthStatus)
        )
      );
      return matched
        ? { phoneNumberLookupKey: matched.phoneNumberLookupKey }
        : null;
    }),
    updateMany: vi.fn().mockImplementation(async ({ data, where }: {
      data: {
        proactiveConversationCount?: { increment: number } | number;
        proactiveConversationDayUtc?: Date;
      };
      where: {
        OR?: Array<{
          proactiveConversationDayUtc?: null | { not: Date };
        }>;
        phoneNumberLookupKey: string;
        proactiveConversationCount?: { lt: number };
        proactiveConversationDayUtc?: Date;
      };
    }) => {
      const line = linqLines.get(where.phoneNumberLookupKey);
      if (!line) {
        return { count: 0 };
      }
      const sameDay =
        where.proactiveConversationDayUtc === undefined
        || line.proactiveConversationDayUtc?.getTime()
          === where.proactiveConversationDayUtc.getTime();
      const underLimit =
        where.proactiveConversationCount === undefined
        || (line.proactiveConversationCount ?? 0)
          < where.proactiveConversationCount.lt;
      const dayStartAllowed = Boolean(where.OR?.some((predicate) =>
        predicate.proactiveConversationDayUtc === null
          ? line.proactiveConversationDayUtc === null
          : predicate.proactiveConversationDayUtc?.not
            && line.proactiveConversationDayUtc?.getTime()
              !== predicate.proactiveConversationDayUtc.not.getTime()
      ));
      if (
        where.OR === undefined
          ? !(sameDay && underLimit)
          : !dayStartAllowed
      ) {
        return { count: 0 };
      }
      if (typeof data.proactiveConversationCount === "number") {
        line.proactiveConversationCount = data.proactiveConversationCount;
      } else if (data.proactiveConversationCount?.increment) {
        line.proactiveConversationCount =
          (line.proactiveConversationCount ?? 0)
          + data.proactiveConversationCount.increment;
      }
      if (data.proactiveConversationDayUtc) {
        line.proactiveConversationDayUtc = data.proactiveConversationDayUtc;
      }
      return { count: 1 };
    }),
  };
  const hostedLinqDelivery = {
    findMany: vi.fn().mockImplementation(async ({ where }: {
      where: { idempotencyKey: { in: string[] } };
    }) =>
      [...linqDeliveries.values()].filter((delivery) =>
        where.idempotencyKey.in.includes(delivery.idempotencyKey)
      )
    ),
    findUnique: vi.fn().mockImplementation(async ({ where }: {
      where: { idempotencyKey: string };
    }) => linqDeliveries.get(where.idempotencyKey) ?? null),
  };
  const hostedMemberEmailAuthorization = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const hostedMemberIdentity = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  // Unified access read (readActiveHostedMemberAccess). Members are active by
  // default; thread-container members derive access from their (active) owner.
  // Tests for inactive members override this mock.
  const hostedMember = {
    findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => ({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: containers.has(where.id)
        ? {
            owner: {
              accountGroupMemberships: [],
              billingStatus: HostedBillingStatus.active,
              suspendedAt: null,
            },
          }
        : null,
    })),
  };
  const hostedWorkspace = {
    upsert: vi.fn().mockResolvedValue({}),
  };
  const executeRaw = vi.fn().mockResolvedValue(undefined);
  const hostedThreadContainerParticipant = {
    findFirst: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi.fn().mockResolvedValue({}),
  };
  const prisma = {
    $executeRaw: executeRaw,
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    hostedLinqLine,
    hostedLinqDelivery,
    hostedLinqFirstContactAdmissionDecision: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    hostedMember,
    hostedMemberEmailAuthorization,
    hostedMemberIdentity,
    hostedMemberRouting,
    hostedThreadContainer,
    hostedThreadContainerParticipant,
    hostedThreadRoute,
    hostedWorkspace,
    seedActiveManagedLinqLine(phoneNumber: string, overrides: Partial<{
      egressPolicy: string;
      healthStatus: string;
      maxNewConversationsPerDay: number | null;
      proactiveConversationCount: number | null;
      proactiveConversationDayUtc: Date | null;
      providerReputationStatus: string | null;
      providerServiceStatus: string | null;
    }> = {}) {
      const lookupKey = createHostedPhoneLookupKey(phoneNumber);
      if (!lookupKey) {
        throw new Error("Expected a managed Linq line lookup key.");
      }
      linqLines.set(lookupKey, {
        activeMemberLimit: null,
        assignmentWeight: 100,
        configuredAt: new Date("2026-06-24T00:00:00.000Z"),
        egressPolicy: overrides.egressPolicy ?? "enabled",
        healthStatus: overrides.healthStatus ?? "healthy",
        maxNewConversationsPerDay:
          overrides.maxNewConversationsPerDay ?? null,
        phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(phoneNumber),
        phoneNumberHint: readHostedPhoneHint(phoneNumber),
        phoneNumberLookupKey: lookupKey,
        proactiveConversationCount:
          overrides.proactiveConversationCount ?? null,
        proactiveConversationDayUtc:
          overrides.proactiveConversationDayUtc ?? null,
        providerReputationStatus:
          overrides.providerReputationStatus ?? "HEALTHY",
        providerServiceStatus: overrides.providerServiceStatus ?? "ACTIVE",
      });
    },
    seedLinqDelivery(input: {
      acceptedAt?: Date | null;
      attemptedAt?: Date;
      deliveredAt?: Date | null;
      id: string;
      idempotencyKey: string;
      lastProviderEventId?: string | null;
      lastReceiptAt?: Date | null;
      messageLookupKey?: string | null;
      phoneNumberLookupKey?: string | null;
      sourceRef?: string | null;
      status?: string;
      targetKind?: string | null;
      template?: string | null;
    }) {
      linqDeliveries.set(input.idempotencyKey, {
        acceptedAt: input.acceptedAt ?? null,
        attemptedAt:
          input.attemptedAt ?? new Date("2026-06-24T12:00:00.000Z"),
        deliveredAt: input.deliveredAt ?? null,
        groupJoinOutreachId: null,
        groupJoinReplyOccurredAt: null,
        id: input.id,
        idempotencyKey: input.idempotencyKey,
        lastProviderEventId: input.lastProviderEventId ?? null,
        lastReceiptAt: input.lastReceiptAt ?? null,
        messageLookupKey: input.messageLookupKey ?? null,
        phoneNumberLookupKey: input.phoneNumberLookupKey ?? null,
        sourceRef: input.sourceRef ?? null,
        status: input.status ?? "attempted",
        targetKind: input.targetKind ?? null,
        template: input.template ?? null,
      });
    },
    seedThreadRoute(input: {
      accountLookupKey?: string | null;
      channel: string;
      containerMemberId: string;
      ownerMemberId: string;
      deliveryRouteEncrypted?: string | null;
      pendingGroupReactionContextEncrypted?: string | null;
      threadIdentityLookupKey: string;
      threadLookupKey: string;
    }) {
      containers.set(input.containerMemberId, {
        monthlyUsageLimitUsdMicros: 4_500_000n,
        ownerMemberId: input.ownerMemberId,
      });
      routes.push({
        accountLookupKey: input.accountLookupKey ?? null,
        channel: input.channel,
        containerMemberId: input.containerMemberId,
        deliveryRouteEncrypted: input.deliveryRouteEncrypted ?? null,
        pendingGroupReactionContextEncrypted:
          input.pendingGroupReactionContextEncrypted ?? null,
        pendingParticipantAddition: false,
        threadIdentityLookupKey: input.threadIdentityLookupKey,
        threadLookupKey: input.threadLookupKey,
      });
    },
    seedThreadContainer(input: {
      memberId: string;
      ownerMemberId: string;
    }) {
      containers.set(input.memberId, {
        monthlyUsageLimitUsdMicros: 4_500_000n,
        ownerMemberId: input.ownerMemberId,
      });
    },
    readDeliveryRouteEncrypted(containerMemberId: string) {
      return routes.find((route) =>
        route.containerMemberId === containerMemberId
      )?.deliveryRouteEncrypted ?? null;
    },
    readAccountLookupKeyProjection(containerMemberId: string) {
      return routes.find((route) =>
        route.containerMemberId === containerMemberId
      )?.accountLookupKey ?? null;
    },
    readPendingGroupReactionContextEncrypted(containerMemberId: string) {
      return routes.find((route) =>
        route.containerMemberId === containerMemberId
      )?.pendingGroupReactionContextEncrypted ?? null;
    },
  };
  return prisma;
}

/** Narrows the stateful route fixture at the transaction boundary it models. */
function assertThreadContainerRouteTransactionClient(
  value: unknown,
): asserts value is Parameters<typeof ensureHostedThreadContainerRouteTx>[0]["prisma"] {
  if (
    typeof value !== "object"
    || value === null
    || !("$queryRaw" in value)
    || !("hostedMember" in value)
    || !("hostedThreadContainer" in value)
    || !("hostedThreadRoute" in value)
  ) {
    throw new TypeError("Expected a thread-container route transaction client.");
  }
}

async function prepareThreadDeliveryRouteForTest(input: {
  accountLookupKey: string;
  channel: "linq" | "telegram";
  containerMemberId: string;
  observedDeliveryRouteEncrypted?: string | null;
  prisma: Prisma.TransactionClient;
  threadId: string;
}) {
  const deliveryRoute = buildHostedThreadDeliveryRoute(input);
  const observedDeliveryRouteEncrypted =
    input.observedDeliveryRouteEncrypted !== undefined
      ? input.observedDeliveryRouteEncrypted
      : readFixtureDeliveryRouteEncrypted({
          containerMemberId: input.containerMemberId,
          prisma: input.prisma,
        });
  return {
    containerMemberId: input.containerMemberId,
    deliveryRoute,
    deliveryRouteEncrypted: encodeThreadDeliveryRouteForTest({
      containerMemberId: input.containerMemberId,
      deliveryRoute,
    }),
    observedDeliveryRouteEncrypted,
  };
}

function readFixtureDeliveryRouteEncrypted(input: {
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
}): string | null {
  if (
    "readDeliveryRouteEncrypted" in input.prisma
    && typeof input.prisma.readDeliveryRouteEncrypted === "function"
  ) {
    const value = input.prisma.readDeliveryRouteEncrypted(
      input.containerMemberId,
    );
    return typeof value === "string" ? value : null;
  }
  return null;
}

async function prepareThreadContainerCreationForTest(input: {
  accountLookupKey: string;
  channel: "linq" | "telegram";
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
  threadId: string;
}) {
  return {
    ...(await prepareThreadDeliveryRouteForTest(input)),
    cryptoDomainRoots: new Map(),
  };
}

async function planHostedOnboardingLinqWebhook(
  input: Parameters<typeof planHostedOnboardingLinqWebhookWithoutPreparedCrypto>[0],
) {
  const context = resolveHostedOnboardingLinqMessageContext(input.event);
  const accountLookupKey = createHostedPhoneLookupKey(
    context.recipientPhoneNumber,
  );
  if (!accountLookupKey) {
    return planHostedOnboardingLinqWebhookWithoutPreparedCrypto(input);
  }
  const preparedThreadContainerCreation =
    await prepareThreadContainerCreationForTest({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_123",
      prisma: input.prisma,
      threadId: context.summary.chatId,
    });
  return planHostedOnboardingLinqWebhookWithoutPreparedCrypto({
    preparedThreadContainerCreation,
    preparedThreadDeliveryRoute: preparedThreadContainerCreation,
    ...input,
  });
}

function encodeThreadDeliveryRouteForTest(input: {
  containerMemberId: string;
  deliveryRoute: ReturnType<typeof buildHostedThreadDeliveryRoute>;
}): string {
  return `hsb-test:${Buffer.from(JSON.stringify({
    lane: "hosted-member-private-field",
    scope: "hosted-thread-route:delivery-route:v1",
    userId: input.containerMemberId,
    value: JSON.stringify(input.deliveryRoute),
  }), "utf8").toString("base64url")}`;
}

function buildHostedMailboxItem(input: {
  id: string;
  userId: string;
}): HostedMailboxItem {
  const now = "2026-06-24T12:00:00.000Z";

  return {
    createdAt: now,
    dedupeKey: "evt_group_123",
    expiresAt: null,
    id: input.id,
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: now,
    payloadBytes: 123,
    payloadInlineCiphertext: null,
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: now,
    userId: input.userId,
  };
}

function readSingleWakeHandoff(
  plan: Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>>,
) {
  const wakeHandoffs = plan.wakeHandoffs ?? [];
  expect(wakeHandoffs).toHaveLength(1);
  const wakeHandoff = wakeHandoffs[0];
  if (!wakeHandoff) {
    throw new Error("Expected a wake handoff.");
  }
  return wakeHandoff;
}

async function markRoutedParticipantAdditionPending(
  prisma: ReturnType<typeof createPrisma>,
): Promise<void> {
  await markHostedLinqThreadRouteParticipantAdditionPendingTx({
    containerMemberId: "member_thread_container_123",
    prisma: prisma as never,
    threadId: "chat_group_123",
  });
}

async function appendRoutedReactionContext(
  prisma: ReturnType<typeof createPrisma>,
  text: string,
): Promise<void> {
  const accountLookupKey = requireTestPhoneLookupKey("+15550000000");
  await expect(
    prisma.$transaction((transaction) =>
      appendHostedLinqThreadRouteReactionContextTx({
        accountLookupKey,
        containerMemberId: "member_thread_container_123",
        prisma: transaction as never,
        text,
        threadId: "chat_group_123",
      }),
    ),
  ).resolves.toBe("appended");
}

function requireTestPhoneLookupKey(phoneNumber: string): string {
  const lookupKey = createHostedPhoneLookupKey(phoneNumber);
  if (!lookupKey) {
    throw new Error("Expected a Linq account lookup key.");
  }
  return lookupKey;
}

function rejectWhenAborted<T>(signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return Promise.reject(new Error("Expected a bounded crypto signal."));
  }
  return new Promise<T>((_resolve, reject) => {
    const rejectWithReason = () => reject(signal.reason);
    if (signal.aborted) {
      rejectWithReason();
      return;
    }
    signal.addEventListener("abort", rejectWithReason, { once: true });
  });
}

describe("Linq message edit correction planning", () => {
  it("appends an immutable correction for an active group participant", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantActive: true,
    });
    const originalWake = buildAcceptedGroupLinqOriginalWake();
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([{
        contentAvailable: true,
        itemId: "mailbox_group_original_123",
        userId: originalWake.userId,
        wake: originalWake,
      }]);

    const plan = await planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent(),
      now: new Date("2026-06-24T12:01:01.000Z"),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-message-edit",
    });
    expect(plan.desiredSideEffects).toEqual([]);
    expect(plan.wakeHandoffs).toEqual([
      expect.objectContaining({
        eventId: "evt_group_edit_123",
        mailboxItemId: "mailbox_group_123",
        userId: "member_thread_container_123",
      }),
    ]);
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      envelope: expect.objectContaining({
        eventId: "evt_group_edit_123",
        kind: "conversation.message",
        message: expect.objectContaining({
          channel: "linq",
          linqMessage: expect.objectContaining({
            chatId: "chat_group_123",
            editedSourceInputId:
              createAcceptedEditSourceInputId(originalWake),
            editedTextPartIndex: 0,
            messageId: "msg_group_123",
            parts: [{ type: "text", value: "Corrected question" }],
            replyToMessageId: "msg_prior_123",
          }),
          senderMemberId: "member_active_participant_123",
        }),
        occurredAt: "2026-06-24T12:01:00.000Z",
        userId: "member_thread_container_123",
      }),
      sourceMessageLookupKey: createHostedLinqMessageLookupKey("msg_group_123"),
    }));
  });

  it("accepts a group correction from an unattributed route-authorized sender", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantHasProjection: false,
    });
    const originalWake = buildAcceptedGroupLinqOriginalWake({
      senderMemberId: null,
    });
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([{
        contentAvailable: true,
        itemId: "mailbox_group_original_123",
        userId: originalWake.userId,
        wake: originalWake,
      }]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent(),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: false,
        reason: "wake-appended-message-edit",
      },
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).toHaveBeenCalledOnce();
  });

  it("rejects an unattributed correction when its exact sender has withdrawn", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantActive: true,
      routeParticipantConsentStatus: "revoked",
    });
    const originalWake = buildAcceptedGroupLinqOriginalWake({
      senderMemberId: null,
    });
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockResolvedValueOnce({
        core: {
          billingStatus: HostedBillingStatus.active,
          createdAt: new Date("2026-06-24T00:00:00.000Z"),
          id: "member_active_participant_123",
          suspendedAt: null,
          updatedAt: new Date("2026-06-24T00:00:00.000Z"),
        },
        identity: {},
        matchedBy: "phoneNumber",
      } as Awaited<
        ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>
      >);
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([{
        contentAvailable: true,
        itemId: "mailbox_group_original_123",
        userId: originalWake.userId,
        wake: originalWake,
      }]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent(),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: true,
        reason: "message-edit-group-route-inactive",
      },
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).not.toHaveBeenCalled();
  });

  it("accepts a group correction when optional participant projection is absent", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantHasProjection: false,
    });
    const originalWake = buildAcceptedGroupLinqOriginalWake();
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([{
        contentAvailable: true,
        itemId: "mailbox_group_original_123",
        userId: originalWake.userId,
        wake: originalWake,
      }]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent(),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: false,
        reason: "wake-appended-message-edit",
      },
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).toHaveBeenCalledOnce();
  });

  it("keeps owner-backed group edit authority independent of personal billing", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantActive: false,
    });
    const originalWake = buildAcceptedGroupLinqOriginalWake();
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([{
        contentAvailable: true,
        itemId: "mailbox_group_original_123",
        userId: originalWake.userId,
        wake: originalWake,
      }]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent(),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: false,
        reason: "wake-appended-message-edit",
      },
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).toHaveBeenCalledOnce();
  });

  it("appends a direct correction only while the bound home route is active", async () => {
    const prisma = createPrisma();
    const originalWake = buildAcceptedDirectLinqOriginalWake();
    const sourceEntry = {
      contentAvailable: true,
      itemId: "mailbox_direct_original_123",
      userId: originalWake.userId,
      wake: originalWake,
    };
    vi.mocked(memberRoutingStore.readHostedMemberRoutingState)
      .mockResolvedValueOnce({
        linqChatId: "chat_group_123",
        linqHomeLineAssignedAt: new Date("2026-06-24T11:00:00.000Z"),
        linqParticipantContact: {
          kind: "phone",
          lookupKey: requireTestPhoneLookupKey("+15551112222"),
        },
        linqRecipientPhone: "+15550000000",
        memberId: originalWake.userId,
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        telegramThreadId: null,
        telegramUserId: null,
        telegramUserLookupKey: null,
      } as Awaited<
        ReturnType<typeof memberRoutingStore.readHostedMemberRoutingState>
      >)
      .mockResolvedValueOnce({
        linqChatId: "chat_rebound_elsewhere",
        linqHomeLineAssignedAt: new Date("2026-06-24T11:00:00.000Z"),
        linqParticipantContact: {
          kind: "phone",
          lookupKey: requireTestPhoneLookupKey("+15551112222"),
        },
        linqRecipientPhone: "+15550000000",
        memberId: originalWake.userId,
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        telegramThreadId: null,
        telegramUserId: null,
        telegramUserLookupKey: null,
      } as Awaited<
        ReturnType<typeof memberRoutingStore.readHostedMemberRoutingState>
      >);
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([sourceEntry])
      .mockResolvedValueOnce([sourceEntry]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent(),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: false,
        reason: "wake-appended-message-edit",
      },
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).toHaveBeenCalledOnce();

    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx)
      .mockClear();
    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent({
        eventId: "evt_direct_edit_after_rebind",
      }),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: true,
        reason: "message-edit-direct-route-inactive",
      },
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).not.toHaveBeenCalled();
  });

  it("rejects a group correction after participant authority is revoked", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantRemoved: true,
    });
    const originalWake = buildAcceptedGroupLinqOriginalWake();
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([{
        contentAvailable: true,
        itemId: "mailbox_group_original_123",
        userId: originalWake.userId,
        wake: originalWake,
      }]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent(),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: true,
        reason: "message-edit-group-route-inactive",
      },
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).not.toHaveBeenCalled();
  });

  it("rejects a group correction when durable participant attribution conflicts", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantHandleLookupKey:
        requireTestPhoneLookupKey("+15552223333"),
    });
    const originalWake = buildAcceptedGroupLinqOriginalWake();
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([{
        contentAvailable: true,
        itemId: "mailbox_group_original_123",
        userId: originalWake.userId,
        wake: originalWake,
      }]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent(),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: true,
        reason: "message-edit-group-route-inactive",
      },
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).not.toHaveBeenCalled();
  });

  it("fails closed for stale revisions and sender authority mismatches", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantActive: true,
    });
    const originalWake = buildAcceptedGroupLinqOriginalWake();
    const laterCorrectionWake = {
      ...originalWake,
      eventId: "evt_group_edit_later",
      message: {
        ...originalWake.message,
        linqMessage: {
          ...originalWake.message.linqMessage,
          editedTextPartIndex: 0,
          parts: [{ type: "text" as const, value: "Later correction" }],
        },
      },
      occurredAt: "2026-06-24T12:02:00.000Z",
    };
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([
        {
          contentAvailable: true,
          itemId: "mailbox_group_original_123",
          userId: originalWake.userId,
          wake: originalWake,
        },
        {
          contentAvailable: true,
          itemId: "mailbox_group_edit_later",
          userId: originalWake.userId,
          wake: laterCorrectionWake,
        },
      ]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent(),
      now: new Date("2026-06-24T12:02:01.000Z"),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: true,
        reason: "message-edit-revision-stale",
      },
    });

    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([{
        contentAvailable: true,
        itemId: "mailbox_group_original_123",
        userId: originalWake.userId,
        wake: originalWake,
      }]);
    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent({
        eventId: "evt_group_edit_wrong_sender",
        sender: "+15559990000",
      }),
      now: new Date("2026-06-24T12:01:01.000Z"),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: true,
        reason: "message-edit-authority-mismatch",
      },
    });

    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).not.toHaveBeenCalled();
  });

  it("keeps the provider text-part index independent of compacted mailbox parts", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantActive: true,
    });
    const originalWake = buildAcceptedGroupLinqOriginalWake();
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([{
        contentAvailable: true,
        itemId: "mailbox_group_original_123",
        userId: originalWake.userId,
        wake: originalWake,
      }]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent({ partIndex: 4 }),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: false,
        reason: "wake-appended-message-edit",
      },
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      envelope: expect.objectContaining({
        message: expect.objectContaining({
          linqMessage: expect.objectContaining({
            editedTextPartIndex: 4,
          }),
        }),
      }),
    }));
  });

  it("rejects a sixth provider edit", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantActive: true,
    });
    const originalWake = buildAcceptedGroupLinqOriginalWake();
    const acceptedCorrections = Array.from({ length: 5 }, (_, index) => ({
      contentAvailable: true,
      itemId: `mailbox_group_edit_${index}`,
      userId: originalWake.userId,
      wake: buildHostedExecutionLinqConversationMessageWake({
        accountLookupKey: originalWake.message.accountLookupKey,
        contactKind: originalWake.message.contactKind,
        contactLookupKey: originalWake.message.contactLookupKey,
        eventId: `evt_group_edit_${index}`,
        linqMessage: {
          ...originalWake.message.linqMessage,
          editedTextPartIndex: 0,
          parts: [{ type: "text", value: `Correction ${index}` }],
        },
        occurredAt: `2026-06-24T12:0${index + 1}:00.000Z`,
        phoneLookupKey: originalWake.message.phoneLookupKey,
        routeAuthority: originalWake.message.routeAuthority,
        senderMemberId: originalWake.message.senderMemberId,
        userId: originalWake.userId,
      }),
    }));
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([{
        contentAvailable: true,
        itemId: "mailbox_group_original_123",
        userId: originalWake.userId,
        wake: originalWake,
      }, ...acceptedCorrections]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent({
        editedAt: "2026-06-24T12:07:00.000Z",
        eventId: "evt_group_edit_sixth",
      }),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: true,
        reason: "message-edit-limit-reached",
      },
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).not.toHaveBeenCalled();
  });

  it("uses provider retry for a recent missing original but ignores outbound edits", async () => {
    const prisma = createPrisma();

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent(),
      now: new Date("2026-06-24T12:10:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_MESSAGE_EDIT_SOURCE_PENDING",
      retryable: true,
    });

    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockClear();
    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent({ direction: "outbound" }),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: true,
        reason: "outbound-message-edit",
      },
    });
    expect(
      mailboxStore.readHostedMailboxSourceConversationEntriesTx,
    ).not.toHaveBeenCalled();
  });

  it("replays the already accepted correction without another append", async () => {
    const prisma = createPrisma();
    const originalWake = buildAcceptedGroupLinqOriginalWake();
    const acceptedCorrectionWake = buildHostedExecutionLinqConversationMessageWake({
      accountLookupKey: originalWake.message.accountLookupKey,
      contactKind: originalWake.message.contactKind,
      contactLookupKey: originalWake.message.contactLookupKey,
      eventId: "evt_group_edit_123",
      linqMessage: {
        ...originalWake.message.linqMessage,
        editedSourceInputId: createAcceptedEditSourceInputId(originalWake),
        editedTextPartIndex: 0,
        parts: [{ type: "text", value: "Corrected question" }],
      },
      occurredAt: "2026-06-24T12:01:00.000Z",
      phoneLookupKey: originalWake.message.phoneLookupKey,
      routeAuthority: originalWake.message.routeAuthority,
      senderMemberId: originalWake.message.senderMemberId,
      userId: originalWake.userId,
    });
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([
        {
          contentAvailable: true,
          itemId: "mailbox_group_original_123",
          userId: originalWake.userId,
          wake: originalWake,
        },
        {
          contentAvailable: true,
          itemId: "mailbox_group_edit_accepted",
          userId: originalWake.userId,
          wake: acceptedCorrectionWake,
        },
      ]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent(),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        duplicate: true,
        ignored: true,
        reason: "duplicate-message-edit",
      },
      wakeHandoffs: [{
        eventId: "evt_group_edit_123",
        mailboxItemId: "mailbox_group_edit_accepted",
        userId: "member_thread_container_123",
      }],
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).not.toHaveBeenCalled();
  });

  it("rejects a changed replay that reuses an accepted edit event id", async () => {
    const prisma = createPrisma();
    const originalWake = buildAcceptedGroupLinqOriginalWake();
    const conflictingCorrectionWake =
      buildHostedExecutionLinqConversationMessageWake({
        accountLookupKey: originalWake.message.accountLookupKey,
        contactKind: originalWake.message.contactKind,
        contactLookupKey: originalWake.message.contactLookupKey,
        eventId: "evt_group_edit_123",
        linqMessage: {
          ...originalWake.message.linqMessage,
          editedSourceInputId: createAcceptedEditSourceInputId(originalWake),
          editedTextPartIndex: 0,
          parts: [{ type: "text", value: "Different accepted content" }],
        },
        occurredAt: "2026-06-24T12:01:00.000Z",
        phoneLookupKey: originalWake.message.phoneLookupKey,
        routeAuthority: originalWake.message.routeAuthority,
        senderMemberId: originalWake.message.senderMemberId,
        userId: originalWake.userId,
      });
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([
        {
          contentAvailable: true,
          itemId: "mailbox_group_original_123",
          userId: originalWake.userId,
          wake: originalWake,
        },
        {
          contentAvailable: true,
          itemId: "mailbox_group_edit_conflict",
          userId: originalWake.userId,
          wake: conflictingCorrectionWake,
        },
      ]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent(),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        duplicate: true,
        ignored: true,
        reason: "message-edit-event-conflict",
      },
      wakeHandoffs: [{
        eventId: "evt_group_edit_123",
        mailboxItemId: "mailbox_group_edit_conflict",
      }],
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).not.toHaveBeenCalled();
  });

  it("rejects distinct edits with the same provider revision timestamp", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantActive: true,
    });
    const originalWake = buildAcceptedGroupLinqOriginalWake();
    const equalTimestampCorrectionWake =
      buildHostedExecutionLinqConversationMessageWake({
        accountLookupKey: originalWake.message.accountLookupKey,
        contactKind: originalWake.message.contactKind,
        contactLookupKey: originalWake.message.contactLookupKey,
        eventId: "evt_group_edit_equal_existing",
        linqMessage: {
          ...originalWake.message.linqMessage,
          editedSourceInputId: createAcceptedEditSourceInputId(originalWake),
          editedTextPartIndex: 0,
          parts: [{ type: "text", value: "Already accepted correction" }],
        },
        occurredAt: "2026-06-24T12:01:00.000Z",
        phoneLookupKey: originalWake.message.phoneLookupKey,
        routeAuthority: originalWake.message.routeAuthority,
        senderMemberId: originalWake.message.senderMemberId,
        userId: originalWake.userId,
      });
    vi.mocked(mailboxStore.readHostedMailboxSourceConversationEntriesTx)
      .mockResolvedValueOnce([
        {
          contentAvailable: true,
          itemId: "mailbox_group_original_123",
          userId: originalWake.userId,
          wake: originalWake,
        },
        {
          contentAvailable: true,
          itemId: "mailbox_group_edit_equal_existing",
          userId: originalWake.userId,
          wake: equalTimestampCorrectionWake,
        },
      ]);

    await expect(planHostedLinqMessageEditedWebhook({
      event: buildLinqMessageEditedEvent({
        eventId: "evt_group_edit_equal_requested",
      }),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: true,
        reason: "message-edit-revision-ambiguous",
      },
    });
    expect(
      mailboxStore.appendHostedMailboxEnvelopeWithSourceMessageTx,
    ).not.toHaveBeenCalled();
  });
});

async function runRoutedMessageTransaction(
  prisma: ReturnType<typeof createPrisma>,
  event: ReturnType<typeof buildLinqMessageReceivedEvent>,
): Promise<unknown> {
  return prisma.$transaction((transaction) => planHostedOnboardingLinqWebhook({
    event,
    prisma: transaction as never,
  }));
}

function readAppendedConversationWake(index: number) {
  const envelope = vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx)
    .mock.calls[index]?.[0].envelope;
  expect(envelope?.kind).toBe("conversation.message");
  if (!envelope || envelope.kind !== "conversation.message") {
    throw new Error("Expected a conversation message envelope.");
  }
  return envelope;
}

function readAppendedConversationMessage(index: number) {
  return readAppendedConversationWake(index).message;
}

function configureHostedContactPrivacyKeyringForTest(input: {
  currentVersion: string;
  entries: Record<string, string>;
}): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousCurrentVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.entries)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", previousCurrentVersion);
    clearHostedOnboardingEnvCache();
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

describe("Linq explicit external-thread routing", () => {
  it("locks and rejects a suspended owner before creating a thread container", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_owner_123",
      suspendedAt: new Date("2026-06-24T00:01:00.000Z"),
      updatedAt: new Date("2026-06-24T00:01:00.000Z"),
    });

    await expect(
      ensureHostedThreadContainerRouteTx({
        accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
        channel: "linq",
        occurredAt: new Date("2026-06-24T00:02:00.000Z"),
        ownerMemberId: "member_owner_123",
        prisma: prisma as unknown as Prisma.TransactionClient,
        threadId: "chat_suspended_123",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
    });

    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(hostedMemberStore.createHostedMember).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(prisma.hostedThreadRoute.create).not.toHaveBeenCalled();
  });

  it("keeps an active owner eligible when a retained trial timestamp has passed", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-06-14T00:00:00.000Z"),
      id: "member_owner_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-25T12:00:00.000Z"),
    });
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: new Date("2026-06-25T12:00:00.000Z"),
        currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
        stripeSubscriptionLookupKey: "subscription_lookup_expired_owner",
      },
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: null,
    });
    assertThreadContainerRouteTransactionClient(prisma);
    const accountLookupKey = requireTestPhoneLookupKey("+15550000000");
    const preparedCreation = await prepareThreadContainerCreationForTest({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_expired_trial",
      prisma,
      threadId: "chat_expired_trial_123",
    });

    await expect(
      ensureHostedThreadContainerRouteTx({
        accountLookupKey,
        channel: "linq",
        occurredAt: new Date("2026-06-24T12:00:00.000Z"),
        ownerMemberId: "member_owner_123",
        preparedCreation,
        prisma,
        threadId: "chat_expired_trial_123",
      }),
    ).resolves.toMatchObject({
      created: true,
    });

    expect(hostedMemberStore.createHostedMember).toHaveBeenCalledOnce();
    expect(prisma.hostedThreadContainer.create).toHaveBeenCalledOnce();
    expect(prisma.hostedThreadRoute.create).toHaveBeenCalledOnce();
  });

  it("rejects thread containers as owners of nested thread containers", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedThreadContainer({
      memberId: "member_thread_container_parent",
      ownerMemberId: "member_owner_123",
    });
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_thread_container_parent",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    });

    await expect(
      ensureHostedThreadContainerRouteTx({
        accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
        channel: "linq",
        occurredAt: new Date("2026-06-24T00:00:00.000Z"),
        ownerMemberId: "member_thread_container_parent",
        prisma: prisma as unknown as Prisma.TransactionClient,
        threadId: "chat_nested_123",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_OWNER_MUST_NOT_BE_CONTAINER",
    });

    expect(hostedMemberStore.createHostedMember).not.toHaveBeenCalled();
    expect(domainRootStore.provisionHostedCryptoDomainRootsForUserTx).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(prisma.hostedThreadRoute.create).not.toHaveBeenCalled();
  });

  it("reuses a prior lookup-key route during privacy key rotation", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    const restoreV1 = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: TEST_KEYRING_ENTRIES,
    });
    const priorAccountLookupKey = createHostedPhoneLookupKey("+15550000000");
    const priorThreadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: priorAccountLookupKey,
      channel: "linq",
      threadId: "chat_group_123",
    });
    const priorThreadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_123",
    });
    restoreV1();
    const restoreV2 = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: TEST_KEYRING_ENTRIES,
    });

    try {
      const currentAccountLookupKey = createHostedPhoneLookupKey("+15550000000");
      const currentThreadLookupKey = createHostedExternalThreadLookupKey({
        accountLookupKey: currentAccountLookupKey,
        channel: "linq",
        threadId: "chat_group_123",
      });
      const currentThreadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
        channel: "linq",
        threadId: "chat_group_123",
      });
      if (
        !priorAccountLookupKey
        || !priorThreadLookupKey
        || !priorThreadIdentityLookupKey
        || !currentAccountLookupKey
        || !currentThreadLookupKey
        || !currentThreadIdentityLookupKey
      ) {
        throw new Error("Expected rotated test lookup keys.");
      }
      prisma.seedThreadRoute({
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        ownerMemberId: "member_owner_123",
        pendingGroupReactionContextEncrypted: "encrypted pending reaction context",
        threadIdentityLookupKey: priorThreadIdentityLookupKey,
        threadLookupKey: priorThreadLookupKey,
      });
      vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue({
        billingStatus: HostedBillingStatus.active,
        createdAt: new Date("2026-06-24T00:00:00.000Z"),
        id: "member_owner_123",
        suspendedAt: null,
        updatedAt: new Date("2026-06-24T00:00:00.000Z"),
      });
      const preparedDeliveryRoute = await prepareThreadDeliveryRouteForTest({
        accountLookupKey: currentAccountLookupKey,
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        prisma: prisma as unknown as Prisma.TransactionClient,
        threadId: "chat_group_123",
      });

      await expect(
        ensureHostedThreadContainerRouteTx({
          accountLookupKey: currentAccountLookupKey,
          accountLookupKeys: createHostedPhoneLookupKeyReadCandidates("+15550000000"),
          channel: "linq",
          occurredAt: new Date("2026-06-24T00:00:00.000Z"),
          ownerMemberId: "member_owner_123",
          preparedDeliveryRoute,
          prisma: prisma as unknown as Prisma.TransactionClient,
          threadId: "chat_group_123",
        }),
      ).resolves.toMatchObject({
        activationMailboxItemId: null,
        containerMemberId: "member_thread_container_123",
        created: false,
      });

      expect(hostedMemberStore.createHostedMember).not.toHaveBeenCalled();
      expect(domainRootStore.provisionHostedCryptoDomainRootsForUserTx).not.toHaveBeenCalled();
      expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
      expect(prisma.hostedThreadRoute.create).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.hostedThreadRoute.findMany.mock.invocationCallOrder[0]!,
      );
      expect(prisma.hostedThreadRoute.update).toHaveBeenCalledWith({
        data: {
          accountLookupKey: currentAccountLookupKey,
          deliveryRouteEncrypted: expect.stringMatching(/^hsb-test:/u),
          pendingGroupReactionContextEncrypted: null,
          threadIdentityLookupKey: currentThreadIdentityLookupKey,
          threadLookupKey: currentThreadLookupKey,
        },
        where: {
          channel_threadIdentityLookupKey: {
            channel: "linq",
            threadIdentityLookupKey: priorThreadIdentityLookupKey,
          },
        },
      });
      await expect(
        readHostedThreadRouteByThreadIdentity({
          channel: "linq",
          prisma: prisma as unknown as Prisma.TransactionClient,
          threadId: "chat_group_123",
        }),
      ).resolves.toMatchObject({
        containerMemberId: "member_thread_container_123",
      });
    } finally {
      restoreV2();
    }
  });

  it("repairs owned legacy delivery material in place with the binding account identity", async () => {
    const accountLookupKey = requireTestPhoneLookupKey("+15550000000");
    const prisma = createPrisma({
      routeAccountPhone: "+15550000000",
      routeContainerMemberId: "member_thread_container_123",
      routeDeliveryRouteEncrypted: null,
    });
    const route = await readHostedThreadRouteByThreadIdentity({
      channel: "linq",
      prisma: prisma as never,
      threadId: "chat_group_123",
    });
    if (!route) {
      throw new Error("Expected a bound Linq thread route.");
    }
    const preparedDeliveryRoute = await prepareThreadDeliveryRouteForTest({
      accountLookupKey,
      channel: "linq",
      containerMemberId: route.containerMemberId,
      prisma: prisma as never,
      threadId: "chat_group_123",
    });

    const refreshed = await refreshHostedThreadContainerDeliveryRouteTx({
      accountLookupKey,
      accountLookupKeys: createHostedPhoneLookupKeyReadCandidates("+15550000000"),
      preparedDeliveryRoute,
      prisma: prisma as never,
      route,
      threadId: "chat_group_123",
    });

    expect(refreshed.deliveryRoute).toEqual({
      accountLookupKey,
      channel: "linq",
      schema: "murph.hosted-thread-delivery-route.v1",
      threadId: "chat_group_123",
    });
    expect(prisma.hostedThreadContainer.findUnique).not.toHaveBeenCalled();
    expect(hostedMemberStore.createHostedMember).not.toHaveBeenCalled();
    const encrypted = prisma.readDeliveryRouteEncrypted();
    expect(encrypted).toMatch(/^hsb-test:/u);
    expect(prisma.readAccountLookupKeyProjection()).toBe(accountLookupKey);
    await expect(openHostedThreadDeliveryRoute({
      channel: "linq",
      containerMemberId: "member_thread_container_123",
      encrypted,
      prisma: prisma as never,
    })).resolves.toEqual(refreshed.deliveryRoute);
  });

  it("repairs non-empty corrupt delivery material on owning-line Linq ingress", async () => {
    const accountLookupKey = requireTestPhoneLookupKey("+15550000000");
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_123",
    });
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey,
      channel: "linq",
      threadId: "chat_group_123",
    });
    if (!threadIdentityLookupKey || !threadLookupKey) {
      throw new Error("Expected current Linq thread route lookup keys.");
    }
    const prisma = createPrisma({
      pendingGroupReactionContextEncrypted: "same-authority-reaction-context",
      routeAccountPhone: "+15550000000",
      routeContainerMemberId: "member_thread_container_123",
      routeDeliveryRouteEncrypted: "corrupt-delivery-route",
    });
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });
    const preparedThreadDeliveryRoute = await prepareThreadDeliveryRouteForTest({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_123",
      prisma: prisma as never,
      threadId: "chat_group_123",
    });
    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      preparedThreadDeliveryRoute,
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(prisma.hostedThreadRoute.update).toHaveBeenCalledWith({
      data: {
        accountLookupKey,
        deliveryRouteEncrypted: expect.stringMatching(/^hsb-test:/u),
        threadIdentityLookupKey,
        threadLookupKey,
      },
      where: {
        channel_threadIdentityLookupKey: {
          channel: "linq",
          threadIdentityLookupKey,
        },
      },
    });
    const encrypted = prisma.readDeliveryRouteEncrypted();
    await expect(openHostedThreadDeliveryRoute({
      channel: "linq",
      containerMemberId: "member_thread_container_123",
      encrypted,
      prisma: prisma as never,
    })).resolves.toEqual({
      accountLookupKey,
      channel: "linq",
      schema: "murph.hosted-thread-delivery-route.v1",
      threadId: "chat_group_123",
    });
  });

  it("repairs legacy delivery material without clearing same-authority reaction context", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    const accountLookupKey = requireTestPhoneLookupKey("+15550000000");
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey,
      channel: "linq",
      threadId: "chat_group_123",
    });
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_123",
    });
    if (!threadLookupKey || !threadIdentityLookupKey) {
      throw new Error("Expected route lookup keys.");
    }
    prisma.seedThreadRoute({
      channel: "linq",
      containerMemberId: "member_thread_container_123",
      deliveryRouteEncrypted: null,
      ownerMemberId: "member_owner_123",
      pendingGroupReactionContextEncrypted: "encrypted pending reaction context",
      threadIdentityLookupKey,
      threadLookupKey,
    });
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_owner_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    });
    const preparedDeliveryRoute = await prepareThreadDeliveryRouteForTest({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_123",
      prisma: prisma as never,
      threadId: "chat_group_123",
    });

    await ensureHostedThreadContainerRouteTx({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_123",
      occurredAt: new Date("2026-06-24T00:00:00.000Z"),
      ownerMemberId: "member_owner_123",
      preparedDeliveryRoute,
      prisma: prisma as never,
      threadId: "chat_group_123",
    });

    expect(prisma.hostedThreadRoute.update).toHaveBeenCalledWith({
      data: {
        accountLookupKey,
        deliveryRouteEncrypted: expect.stringMatching(/^hsb-test:/u),
        threadIdentityLookupKey,
        threadLookupKey,
      },
      where: {
        channel_threadIdentityLookupKey: {
          channel: "linq",
          threadIdentityLookupKey,
        },
      },
    });
    expect(prisma.readDeliveryRouteEncrypted("member_thread_container_123"))
      .toMatch(/^hsb-test:/u);
    expect(prisma.readPendingGroupReactionContextEncrypted(
      "member_thread_container_123",
    )).toBe("encrypted pending reaction context");
  });

  it("requests fresh preparation when a route wins after container preparation", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    const accountLookupKey = requireTestPhoneLookupKey("+15550000000");
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey,
      channel: "linq",
      threadId: "chat_group_123",
    });
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_123",
    });
    if (!threadLookupKey || !threadIdentityLookupKey) {
      throw new Error("Expected route lookup keys.");
    }
    const winningDeliveryRoute = await prepareThreadDeliveryRouteForTest({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_winner",
      prisma: prisma as never,
      threadId: "chat_group_123",
    });
    prisma.seedThreadRoute({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_winner",
      deliveryRouteEncrypted: winningDeliveryRoute.deliveryRouteEncrypted,
      ownerMemberId: "member_owner_123",
      threadIdentityLookupKey,
      threadLookupKey,
    });
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_owner_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    });
    const stalePreparedCreation = await prepareThreadContainerCreationForTest({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_loser",
      prisma: prisma as never,
      threadId: "chat_group_123",
    });

    await expect(
      ensureHostedThreadContainerRouteTx({
        accountLookupKey,
        channel: "linq",
        occurredAt: new Date("2026-06-24T00:00:00.000Z"),
        ownerMemberId: "member_owner_123",
        preparedCreation: stalePreparedCreation,
        prisma: prisma as never,
        threadId: "chat_group_123",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
      retryable: true,
    });

    expect(hostedMemberStore.createHostedMember).not.toHaveBeenCalled();
    expect(domainRootStore.provisionPreparedHostedCryptoDomainRootsTx).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(prisma.hostedThreadRoute.create).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("creates and reuses a route container before routing Linq ingress", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    const owner = {
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_owner_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue(owner);
    vi.mocked(hostedMemberStore.createHostedMember).mockResolvedValue({
      ...owner,
      id: "member_thread_container_123",
    });
    vi.mocked(domainRootStore.provisionPreparedHostedCryptoDomainRootsTx)
      .mockResolvedValue(undefined);
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_activation_123",
        userId: "member_thread_container_123",
      }),
    });
    const accountLookupKey = requireTestPhoneLookupKey("+15550000000");
    const preparedCreation = await prepareThreadContainerCreationForTest({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_123",
      prisma: prisma as unknown as Prisma.TransactionClient,
      threadId: "chat_group_123",
    });

    await expect(
      ensureHostedThreadContainerRouteTx({
        accountLookupKey,
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        occurredAt: new Date("2026-06-24T00:00:00.000Z"),
        ownerMemberId: "member_owner_123",
        preparedCreation,
        prisma: prisma as unknown as Prisma.TransactionClient,
        threadId: "chat_group_123",
      }),
    ).resolves.toMatchObject({
      activationMailboxItemId: "mailbox_activation_123",
      containerMemberId: "member_thread_container_123",
      created: true,
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);

    await expect(
      ensureHostedThreadContainerRouteTx({
        accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        occurredAt: new Date("2026-06-24T00:01:00.000Z"),
        ownerMemberId: "member_owner_123",
        prisma: prisma as unknown as Prisma.TransactionClient,
        threadId: "chat_group_123",
      }),
    ).resolves.toMatchObject({
      activationMailboxItemId: null,
      containerMemberId: "member_thread_container_123",
      created: false,
    });
    expect(hostedMemberStore.createHostedMember).toHaveBeenCalledTimes(1);
    expect(domainRootStore.provisionPreparedHostedCryptoDomainRootsTx).toHaveBeenCalledTimes(1);
    expect(domainRootStore.provisionHostedCryptoDomainRootsForUserTx).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.hostedThreadContainer.create).toHaveBeenCalledTimes(1);
    expect(prisma.hostedThreadContainer.create).toHaveBeenCalledWith({
      data: {
        memberId: "member_thread_container_123",
        monthlyUsageLimitUsdMicros: 7_500_000n,
        ownerMemberId: "member_owner_123",
      },
    });
    expect(prisma.hostedThreadRoute.create).toHaveBeenCalledTimes(1);
    expect(prisma.hostedThreadRoute.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
        deliveryRouteEncrypted: expect.stringMatching(/^hsb-test:/u),
      }),
    });
    expect(prisma.hostedThreadRoute.update).not.toHaveBeenCalled();
    expect(prisma.readDeliveryRouteEncrypted("member_thread_container_123"))
      .toMatch(/^hsb-test:/u);

    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_group_123",
        userId: "member_thread_container_123",
      }),
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(readSingleWakeHandoff(plan)).toMatchObject({
      eventId: "evt_group_123",
      mailboxItemId: "mailbox_group_123",
      source: "linq",
      userId: "member_thread_container_123",
    });
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.updateMany).not.toHaveBeenCalled();
  });

  it("routes a bound Linq group thread into the container runtime", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    const latestReactionContext =
      "A participant added a heart reaction on: How did we sleep?";
    const earlierReactionContext =
      "A participant added a like reaction on: Earlier context";
    await markRoutedParticipantAdditionPending(prisma);
    await markRoutedParticipantAdditionPending(prisma);
    await appendRoutedReactionContext(
      prisma,
      earlierReactionContext,
    );
    await appendRoutedReactionContext(prisma, latestReactionContext);
    expect(prisma.readPendingParticipantAddition()).toBe(true);
    expect(prisma.readPendingGroupReactionContextEncrypted()).not.toBeNull();
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_group_123",
        userId: "member_thread_container_123",
      }),
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(readSingleWakeHandoff(plan)).toMatchObject({
      eventId: "evt_group_123",
      linqChatId: "chat_group_123",
      mailboxItemId: "mailbox_group_123",
      source: "linq",
      userId: "member_thread_container_123",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "evt_group_123",
        kind: "conversation.message",
        message: expect.objectContaining({
          accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
          channel: "linq",
          linqMessage: expect.objectContaining({
            chatId: "chat_group_123",
            from: "+15551112222",
            messageId: "msg_group_123",
            threadIsDirect: false,
          }),
          routeAuthority: expect.objectContaining({
            accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
            channel: "linq",
            containerMemberId: "member_thread_container_123",
            threadId: "chat_group_123",
          }),
        }),
        userId: "member_thread_container_123",
      }),
      tx: prisma,
    });
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.updateMany).not.toHaveBeenCalled();
    expect(
      memberRoutingStore.demoteHostedMemberLinqGroupChatBindingsTx,
    ).toHaveBeenCalledWith({
      linqChatId: "chat_group_123",
      mailboxDedupeKey: "evt_group_123",
      prisma,
    });

    expect(readAppendedConversationMessage(0)).toMatchObject({
      groupParticipantAdded: true,
      groupReactionContext: [
        earlierReactionContext,
        latestReactionContext,
      ].join("\n"),
      linqMessage: expect.objectContaining({
        messageId: "msg_group_123",
      }),
    });
    await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        eventId: "evt_group_456",
        messageId: "msg_group_456",
      }),
      prisma: prisma as never,
    });
    expect(readAppendedConversationMessage(1)).not.toHaveProperty(
      "groupParticipantAdded",
    );
    expect(readAppendedConversationMessage(1)).not.toHaveProperty(
      "groupReactionContext",
    );
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
    expect(prisma.readPendingParticipantAddition()).toBe(false);
  });

  it("keeps the newest ten reaction contexts in insertion order", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    const reactionContexts = Array.from(
      { length: 11 },
      (_, index) => `Participant +15551234567 added reaction ${index + 1}`,
    );
    for (const reactionContext of reactionContexts) {
      await appendRoutedReactionContext(prisma, reactionContext);
    }

    await expect(
      prisma.$transaction((transaction) =>
        consumeHostedLinqThreadRoutePendingContextTx({
          accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          threadId: "chat_group_123",
        }),
      ),
    ).resolves.toEqual({
      groupParticipantAdded: false,
      groupReactionContext: reactionContexts.slice(-10).join("\n"),
    });
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
  });

  it("appends to a legacy single-reaction ciphertext", async () => {
    const legacyReactionContext =
      "A participant added a like reaction on: Legacy context";
    const newReactionContext =
      "Participant +15551234567 added a laugh reaction on: New context";
    const prisma = createPrisma({
      pendingGroupReactionContextEncrypted: "legacy ciphertext",
      routeContainerMemberId: "member_thread_container_123",
    });
    secureBoxMocks.openHostedUserSecureBoxString.mockResolvedValueOnce(
      legacyReactionContext,
    );
    await appendRoutedReactionContext(prisma, newReactionContext);

    await expect(
      prisma.$transaction((transaction) =>
        consumeHostedLinqThreadRoutePendingContextTx({
          accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          threadId: "chat_group_123",
        }),
      ),
    ).resolves.toEqual({
      groupParticipantAdded: false,
      groupReactionContext: [
        legacyReactionContext,
        newReactionContext,
      ].join("\n"),
    });
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
  });

  it("keeps reaction context account-bound without delaying participant context", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    const reactionContext =
      "A participant added a heart reaction on: How did we sleep?";
    const correctAccountLookupKey = requireTestPhoneLookupKey("+15550000000");
    const wrongAccountLookupKey = requireTestPhoneLookupKey("+15559999999");
    await markRoutedParticipantAdditionPending(prisma);
    await appendRoutedReactionContext(prisma, reactionContext);

    await expect(
      prisma.$transaction((transaction) =>
        consumeHostedLinqThreadRoutePendingContextTx({
          accountLookupKey: wrongAccountLookupKey,
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          threadId: "chat_group_123",
        }),
      ),
    ).resolves.toEqual({
      groupParticipantAdded: true,
      groupReactionContext: null,
    });
    expect(prisma.readPendingParticipantAddition()).toBe(false);
    expect(prisma.readPendingGroupReactionContextEncrypted()).not.toBeNull();

    await expect(
      prisma.$transaction((transaction) =>
        consumeHostedLinqThreadRoutePendingContextTx({
          accountLookupKey: correctAccountLookupKey,
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          threadId: "chat_group_123",
        }),
      ),
    ).resolves.toEqual({
      groupParticipantAdded: false,
      groupReactionContext: reactionContext,
    });
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
  });

  it("stores participant-event context on the routed chat and releases it only to the matching account", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    const participantContext =
      "Participant +15551234567 (address-book name: Taylor R.) was removed from the group.";
    await expect(
      prisma.$transaction((transaction) =>
        appendHostedLinqThreadRouteParticipantContextTx({
          containerMemberId: "member_thread_container_123",
          excludedAccountLookupKeys: createHostedPhoneLookupKeyReadCandidates(
            "+15551234567",
          ),
          prisma: transaction as never,
          text: participantContext,
          threadId: "chat_group_123",
        }),
      ),
    ).resolves.toBe("appended");

    await expect(
      prisma.$transaction((transaction) =>
        consumeHostedLinqThreadRoutePendingContextTx({
          accountLookupKey: requireTestPhoneLookupKey("+15559999999"),
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          threadId: "chat_group_123",
        }),
      ),
    ).resolves.toEqual({
      groupParticipantAdded: false,
      groupReactionContext: null,
    });
    expect(prisma.readPendingGroupReactionContextEncrypted()).not.toBeNull();

    await expect(
      prisma.$transaction((transaction) =>
        consumeHostedLinqThreadRoutePendingContextTx({
          accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          threadId: "chat_group_123",
        }),
      ),
    ).resolves.toEqual({
      groupParticipantAdded: false,
      groupReactionContext: participantContext,
    });
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
  });

  it("does not stage the routed Linq account as a changed participant", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });

    await expect(
      prisma.$transaction((transaction) =>
        appendHostedLinqThreadRouteParticipantContextTx({
          containerMemberId: "member_thread_container_123",
          excludedAccountLookupKeys: createHostedPhoneLookupKeyReadCandidates(
            "+15550000000",
          ),
          prisma: transaction as never,
          text: "Participant +15550000000 was added to the group.",
          threadId: "chat_group_123",
        }),
      ),
    ).resolves.toBe("route_unavailable");
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
  });

  it("rechecks account and active access before appending reaction context", async () => {
    const wrongAccountPrisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    await expect(
      wrongAccountPrisma.$transaction((transaction) =>
        appendHostedLinqThreadRouteReactionContextTx({
          accountLookupKey: requireTestPhoneLookupKey("+15559999999"),
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          text: "A participant liked: group message",
          threadId: "chat_group_123",
        }),
      ),
    ).resolves.toBe("route_unavailable");
    expect(wrongAccountPrisma.readPendingGroupReactionContextEncrypted()).toBeNull();

    const inactivePrisma = createPrisma({
      routeContainerActive: false,
      routeContainerMemberId: "member_thread_container_123",
    });
    await expect(
      inactivePrisma.$transaction((transaction) =>
        appendHostedLinqThreadRouteReactionContextTx({
          accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          text: "A participant liked: group message",
          threadId: "chat_group_123",
        }),
      ),
    ).resolves.toBe("route_unavailable");
    expect(inactivePrisma.readPendingGroupReactionContextEncrypted()).toBeNull();
  });

  it("enforces the per-reaction storage bound", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });

    await appendRoutedReactionContext(prisma, "x".repeat(512));
    const encryptedAtLimit = prisma.readPendingGroupReactionContextEncrypted();
    expect(encryptedAtLimit).not.toBeNull();
    await expect(
      prisma.$transaction((transaction) =>
        appendHostedLinqThreadRouteReactionContextTx({
          accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          text: "x".repeat(513),
          threadId: "chat_group_123",
        }),
      ),
    ).rejects.toThrow(/reaction context text is invalid/u);
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBe(
      encryptedAtLimit,
    );
  });

  it("bounds reaction encryption while preserving the empty route snapshot", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    secureBoxMocks.sealHostedUserSecureBoxString.mockImplementationOnce(
      ({ signal }) => rejectWhenAborted(signal),
    );

    await expect(
      prisma.$transaction((transaction) =>
        appendHostedLinqThreadRouteReactionContextTx({
          accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          text: "A participant liked: group message",
          threadId: "chat_group_123",
        }),
      ),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
  });

  it("preserves queued reactions when append cannot decrypt them", async () => {
    const encryptedContext = "encrypted queued reactions";
    const prisma = createPrisma({
      pendingGroupReactionContextEncrypted: encryptedContext,
      routeContainerMemberId: "member_thread_container_123",
    });
    secureBoxMocks.openHostedUserSecureBoxString.mockRejectedValueOnce(
      new Error("decrypt unavailable"),
    );

    await expect(
      prisma.$transaction((transaction) =>
        appendHostedLinqThreadRouteReactionContextTx({
          accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          text: "A participant liked: group message",
          threadId: "chat_group_123",
        }),
      ),
    ).rejects.toThrow("decrypt unavailable");
    expect(secureBoxMocks.sealHostedUserSecureBoxString).not.toHaveBeenCalled();
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBe(
      encryptedContext,
    );
  });

  it("drops corrupt optional reaction context without blocking the next message", async () => {
    const prisma = createPrisma({
      pendingGroupReactionContextEncrypted: "invalid ciphertext",
      pendingParticipantAddition: true,
      routeContainerMemberId: "member_thread_container_123",
    });

    await expect(
      prisma.$transaction((transaction) =>
        consumeHostedLinqThreadRoutePendingContextTx({
          accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          threadId: "chat_group_123",
        }),
      ),
    ).resolves.toEqual({
      groupParticipantAdded: true,
      groupReactionContext: null,
    });
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
    expect(prisma.readPendingParticipantAddition()).toBe(false);
  });

  it("drops malformed reaction lists without blocking the next message", async () => {
    const prisma = createPrisma({
      pendingGroupReactionContextEncrypted: "encrypted malformed list",
      routeContainerMemberId: "member_thread_container_123",
    });
    secureBoxMocks.openHostedUserSecureBoxString.mockResolvedValueOnce(
      '["valid",42]',
    );

    await expect(
      prisma.$transaction((transaction) =>
        consumeHostedLinqThreadRoutePendingContextTx({
          accountLookupKey: requireTestPhoneLookupKey("+15550000000"),
          containerMemberId: "member_thread_container_123",
          prisma: transaction as never,
          threadId: "chat_group_123",
        }),
      ),
    ).resolves.toEqual({
      groupParticipantAdded: false,
      groupReactionContext: null,
    });
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
  });

  it("bounds reaction decryption without blocking the ordinary message", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    await appendRoutedReactionContext(
      prisma,
      "A participant liked: group message",
    );
    secureBoxMocks.openHostedUserSecureBoxString.mockImplementationOnce(
      ({ signal }) => rejectWhenAborted(signal),
    );

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      reason: "wake-appended-thread-route",
    });
    expect(readAppendedConversationMessage(0)).not.toHaveProperty(
      "groupReactionContext",
    );
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
  });

  it("preserves consumed state without waking the container during route handoff", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    const consumedAt = new Date("2026-06-24T12:00:03.000Z");
    vi.mocked(memberRoutingStore.demoteHostedMemberLinqGroupChatBindingsTx)
      .mockResolvedValueOnce({ mailboxConsumedAt: consumedAt });
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_group_consumed_123",
        userId: "member_thread_container_123",
      }),
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "already-consumed-before-thread-route",
    });
    expect(plan.wakeHandoffs ?? []).toEqual([]);
    expect(linqDailyState.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(prisma.hostedMailboxItem.updateMany).toHaveBeenCalledWith({
      data: { consumedAt },
      where: {
        consumedAt: null,
        id: "mailbox_group_consumed_123",
        userId: "member_thread_container_123",
      },
    });
  });

  it("authorizes routed thread traffic when the owner is family-sponsored", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerSponsored: true,
    });
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_sponsored_owner_123",
        userId: "member_thread_container_123",
      }),
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(readSingleWakeHandoff(plan)).toMatchObject({
      eventId: "evt_group_123",
      mailboxItemId: "mailbox_sponsored_owner_123",
      source: "linq",
      userId: "member_thread_container_123",
    });
  });

  it("routes traffic when only a retained trial timestamp has expired", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerTrialEndsAt: new Date("2001-01-08T00:00:00.000Z"),
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        createdAt: "2001-01-07T12:00:00.000Z",
      }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
  });

  it("routes a bound Linq group thread even when the delivering line differs", async () => {
    const prisma = createPrisma({
      routeAccountPhone: "+15550000000",
      routeContainerMemberId: "member_thread_container_123",
    });
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_group_other_line_123",
        userId: "member_thread_container_123",
      }),
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        recipient: "+15559999999",
      }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(readSingleWakeHandoff(plan)).toMatchObject({
      eventId: "evt_group_123",
      linqChatId: "chat_group_123",
      mailboxItemId: "mailbox_group_other_line_123",
      source: "linq",
      userId: "member_thread_container_123",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        message: expect.objectContaining({
          accountLookupKey: createHostedPhoneLookupKey("+15559999999"),
          routeAuthority: {
            accountLookupKey: createHostedPhoneLookupKey("+15559999999"),
            channel: "linq",
            containerMemberId: "member_thread_container_123",
            threadId: "chat_group_123",
          },
        }),
      }),
      tx: prisma,
    });
    expect(prisma.hostedThreadRoute.update).not.toHaveBeenCalled();
    expect(prisma.readDeliveryRouteEncrypted()).toBeNull();
  });

  it("keeps the original Linq binding identity when another line delivers", async () => {
    const originalAccountLookupKey = requireTestPhoneLookupKey("+15550000000");
    const routeDeliveryRouteEncrypted = await sealHostedThreadDeliveryRoute({
      containerMemberId: "member_thread_container_123",
      route: buildHostedThreadDeliveryRoute({
        accountLookupKey: originalAccountLookupKey,
        channel: "linq",
        threadId: "chat_group_123",
      }),
    });
    const prisma = createPrisma({
      routeAccountPhone: "+15550000000",
      routeContainerMemberId: "member_thread_container_123",
      routeDeliveryRouteEncrypted,
    });
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_group_canonical_line_123",
        userId: "member_thread_container_123",
      }),
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        recipient: "+15559999999",
      }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        message: expect.objectContaining({
          accountLookupKey: originalAccountLookupKey,
          routeAuthority: {
            accountLookupKey: originalAccountLookupKey,
            channel: "linq",
            containerMemberId: "member_thread_container_123",
            threadId: "chat_group_123",
          },
        }),
      }),
      tx: prisma,
    });
    expect(prisma.hostedThreadRoute.update).not.toHaveBeenCalled();
    expect(prisma.readDeliveryRouteEncrypted()).toBe(routeDeliveryRouteEncrypted);
    expect(prisma.readAccountLookupKeyProjection()).toBe(originalAccountLookupKey);
  });

  it.each([
    {
      description: "provider directness is omitted",
      isGroup: null,
    },
    {
      description: "the provider reports a direct chat",
      isGroup: false,
    },
  ] as const)("keeps a routed Linq thread non-direct when $description", async ({ isGroup }) => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    await markRoutedParticipantAdditionPending(prisma);
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_routed_directness_123",
        userId: "member_thread_container_123",
      }),
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        isGroup,
      }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        message: expect.objectContaining({
          linqMessage: expect.objectContaining({
            chatId: "chat_group_123",
            threadIsDirect: false,
          }),
        }),
      }),
      tx: prisma,
    });

    const firstMessage = readAppendedConversationMessage(0);
    if (isGroup === false) {
      expect(firstMessage).not.toHaveProperty("groupParticipantAdded");
      expect(prisma.readPendingParticipantAddition()).toBe(true);
      await planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent({
          eventId: "evt_group_after_direct",
          messageId: "msg_group_after_direct",
        }),
        prisma: prisma as never,
      });
      expect(readAppendedConversationMessage(1)).toMatchObject({
        groupParticipantAdded: true,
      });
    } else {
      expect(firstMessage).toMatchObject({
        groupParticipantAdded: true,
      });
    }
    expect(prisma.readPendingParticipantAddition()).toBe(false);
  });

  it("uses the existing Linq daily quota gate for routed thread traffic", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    await markRoutedParticipantAdditionPending(prisma);
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: linqDailyState.HOSTED_LINQ_GROUP_DAILY_TEXT_LIMIT + 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-daily-quota-reply",
    });
    expect(plan.desiredSideEffects).toHaveLength(1);
    expect(plan.desiredSideEffects[0]?.payload).toMatchObject({
      chatId: "chat_group_123",
      dailyTextLimit: linqDailyState.HOSTED_LINQ_GROUP_DAILY_TEXT_LIMIT,
      memberId: "member_thread_container_123",
      routeAuthority: {
        accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        threadId: "chat_group_123",
      },
      template: "daily_quota",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.readPendingParticipantAddition()).toBe(true);

    await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        eventId: "evt_group_after_quota",
        messageId: "msg_group_after_quota",
      }),
      prisma: prisma as never,
    });
    expect(readAppendedConversationMessage(0)).toMatchObject({
      groupParticipantAdded: true,
    });
    expect(prisma.readPendingParticipantAddition()).toBe(false);
  });

  it("admits routed thread traffic past the direct-chat daily limit up to the group limit", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: linqDailyState.HOSTED_LINQ_DAILY_TEXT_LIMIT + 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_group_over_direct_limit_123",
        userId: "member_thread_container_123",
      }),
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(plan.desiredSideEffects).toHaveLength(0);
  });

  it("appends routed thread traffic even when the AI usage gate would deny", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockRejectedValueOnce(
      new Error("webhook usage gate should not run"),
    );
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_group_usage_denied_123",
        userId: "member_thread_container_123",
      }),
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(plan.desiredSideEffects).toHaveLength(0);
    expect(usageAllowance.checkHostedAiUsageGate).not.toHaveBeenCalled();
    expect(readSingleWakeHandoff(plan)).toMatchObject({
      eventId: "evt_group_123",
      linqChatId: "chat_group_123",
      mailboxItemId: "mailbox_group_usage_denied_123",
      source: "linq",
      userId: "member_thread_container_123",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "evt_group_123",
        kind: "conversation.message",
        message: expect.objectContaining({
          accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
          channel: "linq",
          linqMessage: expect.objectContaining({
            chatId: "chat_group_123",
            messageId: "msg_group_123",
          }),
          routeAuthority: {
            accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
            channel: "linq",
            containerMemberId: "member_thread_container_123",
            threadId: "chat_group_123",
          },
        }),
        userId: "member_thread_container_123",
      }),
      tx: prisma,
    });
  });

  it("still routes nothing for unbound Linq group threads when the sender is not a member", async () => {
    const prisma = createPrisma();
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockResolvedValue(null);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    // An unknown sender on a healthy managed line is offered group setup, but
    // an unbound group thread must still never reach personal routing.
    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-group-setup",
    });
    expect(memberRoutingStore.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(hostedMemberStore.createHostedMember).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  async function expectPreparedOwnerAdmission(input: {
    senderKind: "unknown-phone" | "unverified-email" | "inactive-member";
  }): Promise<void> {
    const { senderKind } = input;
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    if (senderKind === "inactive-member") {
      const readActiveMember =
        prisma.hostedMember.findUnique.getMockImplementation()!;
      vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
        .mockResolvedValue({
          core: {
            billingStatus: HostedBillingStatus.paused,
            createdAt: new Date("2026-07-29T16:00:00.000Z"),
            id: "member_inactive_sender",
            suspendedAt: null,
            updatedAt: new Date("2026-07-29T16:00:00.000Z"),
          },
          identity: {},
          matchedBy: "phoneNumber",
        } as Awaited<
          ReturnType<
            typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber
          >
        >);
      prisma.hostedMember.findUnique.mockImplementation(async (input: {
        where: { id: string };
      }) =>
        input.where.id === "member_inactive_sender"
          ? {
              accountGroupMemberships: [],
              billingStatus: HostedBillingStatus.paused,
              suspendedAt: null,
              threadContainer: null,
            }
          : readActiveMember(input)
      );
    } else {
      vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
        .mockResolvedValue(null);
    }
    if (senderKind === "unverified-email") {
      prisma.hostedMemberEmailAuthorization.findMany.mockResolvedValue([]);
    }
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-07-29T17:00:00.000Z"),
      id: "member_prepared_owner",
      suspendedAt: null,
      updatedAt: new Date("2026-07-29T17:00:00.000Z"),
    });
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValue({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_prepared_container",
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });

    preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx
      .mockImplementationOnce(async (input) => {
        const threadLookupKey = createHostedExternalThreadLookupKey({
          accountLookupKey: input.accountLookupKey,
          channel: "linq",
          threadId: input.threadId,
        });
        const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
          channel: "linq",
          threadId: input.threadId,
        });
        if (!threadLookupKey || !threadIdentityLookupKey) {
          throw new Error("Expected route lookup keys.");
        }
        prisma.seedThreadRoute({
          channel: "linq",
          containerMemberId: "member_prepared_container",
          ownerMemberId: "member_prepared_owner",
          threadIdentityLookupKey,
          threadLookupKey,
        });
        return {
          ensure: {
            activationEventId: "member.activated:prepared",
            activationMailboxItemId: "mailbox_activation_prepared",
            containerMemberId: "member_prepared_container",
            created: true,
            demotedMailboxConsumedAt: null,
          },
          kind: "ensured",
          ownerMemberId: "member_prepared_owner",
          ownerResolution: "pending_only_candidate",
          pendingSetupApplied: true,
          pendingSetupResolution: "only_candidate",
        } as never;
      });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        ...(senderKind === "unverified-email"
          ? { sender: "participant@example.com" }
          : {}),
      }),
      pendingGroupParticipantMemberIds: ["member_prepared_owner"],
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      fallbackOwnerMemberId: null,
      participantMemberIds: ["member_prepared_owner"],
      senderMemberId: null,
    }));
    expect(readSingleWakeHandoff(plan)).toMatchObject({
      userId: "member_prepared_container",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "conversation.message",
        message: expect.objectContaining({
          linqMessage: expect.objectContaining({
            from: senderKind === "unverified-email"
              ? "participant@example.com"
              : "+15551112222",
          }),
        }),
        userId: "member_prepared_container",
      }),
      tx: prisma,
    });
  }

  it.each([
    {
      senderKind: "unknown-phone",
      title: "an unknown phone participant speaks first",
    },
    {
      senderKind: "unverified-email",
      title: "an unverified email participant speaks first",
    },
    {
      senderKind: "inactive-member",
      title: "an inactive member speaks first",
    },
  ] as const)(
    "allows a uniquely prepared roster member to own the group when $title",
    expectPreparedOwnerAdmission,
  );

  it("ignores routed thread traffic when the container is inactive", async () => {
    const prisma = createPrisma({
      routeContainerActive: false,
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantActive: true,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "thread-container-inactive",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.findMany).not.toHaveBeenCalled();
  });

  it("classifies an echoed own message on an inactive routed thread without side effects", async () => {
    const prisma = createPrisma({
      routeContainerActive: false,
      routeContainerMemberId: "member_thread_container_123",
      routeParticipantActive: true,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({ isFromMe: true }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "thread-container-inactive",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.findMany).not.toHaveBeenCalled();
  });

  it("ignores routed thread traffic when the route owner is inactive", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "thread-container-inactive",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("routes a bound group thread when any current participant has active access", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
      routeParticipantActive: true,
    });
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).mockResolvedValueOnce({
      core: {
        billingStatus: HostedBillingStatus.active,
        createdAt: new Date("2026-06-24T00:00:00.000Z"),
        id: "member_active_participant_123",
        suspendedAt: null,
        updatedAt: new Date("2026-06-24T00:00:00.000Z"),
      },
      identity: {},
      matchedBy: "phoneNumber",
    } as Awaited<ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>>);
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(null);
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_active_participant_123",
        userId: "member_thread_container_123",
      }),
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(prisma.hostedThreadContainerParticipant.updateMany).toHaveBeenCalledWith({
      data: { lastSeenAt: new Date("2026-06-24T12:00:00.000Z") },
      where: {
        containerMemberId: "member_thread_container_123",
        lastSeenAt: { lt: new Date("2026-06-24T12:00:00.000Z") },
        participantMemberId: "member_active_participant_123",
        removedAt: null,
      },
    });
    expect(prisma.hostedThreadContainerParticipant.findMany).toHaveBeenCalledWith({
      select: {
        participant: {
          select: expect.any(Object),
        },
      },
      where: expect.objectContaining({
        containerMemberId: "member_thread_container_123",
        lastSeenAt: { gte: expect.any(Date) },
        removedAt: null,
      }),
    });
    expect(usageAllowance.checkHostedAiUsageGate).not.toHaveBeenCalled();
    expect(readSingleWakeHandoff(plan)).toMatchObject({
      eventId: "evt_group_123",
      mailboxItemId: "mailbox_active_participant_123",
      source: "linq",
      userId: "member_thread_container_123",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "conversation.message",
        userId: "member_thread_container_123",
      }),
      tx: prisma,
    });
  });

  it("does not append a bound group message from an explicitly withdrawn sender", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: true,
      routeParticipantActive: true,
      routeParticipantConsentStatus: "revoked",
    });
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockResolvedValueOnce({
        core: {
          billingStatus: HostedBillingStatus.active,
          createdAt: new Date("2026-06-24T00:00:00.000Z"),
          id: "member_active_participant_123",
          suspendedAt: null,
          updatedAt: new Date("2026-06-24T00:00:00.000Z"),
        },
        identity: {},
        matchedBy: "phoneNumber",
      } as Awaited<
        ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>
      >);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "health-data-consent-withdrawn",
    });
    expect(
      prisma.hostedThreadContainerParticipant.updateMany,
    ).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("stops a recognized direct sender immediately after explicit withdrawal", async () => {
    const prisma = createPrisma({
      existingMemberConsentStatus: "revoked",
    });
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockResolvedValueOnce({
        core: {
          billingStatus: HostedBillingStatus.active,
          createdAt: new Date("2026-06-24T00:00:00.000Z"),
          id: "member_direct_123",
          suspendedAt: null,
          updatedAt: new Date("2026-06-24T00:00:00.000Z"),
        },
        identity: {},
        matchedBy: "phoneNumber",
      } as Awaited<
        ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>
      >);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({ isGroup: false }),
      prisma: prisma as never,
    });

    expect(plan.response).toEqual({
      ok: true,
      reason: "sent-health-data-consent-withdrawn-notice",
    });
    expect(plan.desiredSideEffects).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          memberId: "member_direct_123",
          noticeCode: "health_data_consent_withdrawn",
        }),
      }),
    ]);
    expect(linqDailyState.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.updateMany).not.toHaveBeenCalled();
  });

  it("does not let another quiet participant authorize an unverified sender", async () => {
    const restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: TEST_KEYRING_ENTRIES,
    });
    try {
      const previousLookupKey =
        createHostedPhoneLookupKeyReadCandidates("+15552223333")[1];
      if (!previousLookupKey) {
        throw new Error("Expected a prior-version participant lookup key.");
      }
      const prisma = createPrisma({
        routeContainerMemberId: "member_thread_container_123",
        routeOwnerActive: false,
        routeParticipantAccessRequiresRosterRefresh: true,
        routeParticipantActive: true,
        routeParticipantHandleLookupKey: previousLookupKey,
      });
      vi.mocked(linqClient.getHostedLinqChatHandles).mockResolvedValue([
        { handle: "+15550000000", isMe: true, status: "active" },
        { handle: "+15551112222", isMe: false, status: "active" },
        ...Array.from({ length: 40 }, (_, index) => ({
          handle: `+15553${index.toString().padStart(6, "0")}`,
          isMe: false,
          status: "active",
        })),
        { handle: "+15552223333", isMe: false, status: "active" },
      ]);
      vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
        .mockImplementation(async ({ phoneNumber }) =>
          phoneNumber === "+15552223333"
            ? {
                core: {
                  billingStatus: HostedBillingStatus.active,
                  createdAt: new Date("2026-06-24T00:00:00.000Z"),
                  id: "member_active_participant_123",
                  suspendedAt: null,
                  updatedAt: new Date("2026-06-24T00:00:00.000Z"),
                },
                identity: {},
                matchedBy: "phoneNumber",
              } as Awaited<
                ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>
              >
            : null
        );

      const plan = await planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent({}),
        prisma: prisma as never,
      });

      expect(plan.response).toMatchObject({
        ignored: true,
        ok: true,
        reason: "thread-container-inactive",
      });
      expect(linqClient.getHostedLinqChatHandles).not.toHaveBeenCalled();
      expect(prisma.hostedThreadContainerParticipant.findMany).toHaveBeenCalledWith({
        select: {
          participant: {
            select: expect.any(Object),
          },
        },
        where: expect.objectContaining({
          containerMemberId: "member_thread_container_123",
        }),
      });
      expect(prisma.hostedThreadContainerParticipant.updateMany).not.toHaveBeenCalled();
      expect(prisma.hostedThreadContainerParticipant.upsert).not.toHaveBeenCalled();
    } finally {
      restoreKeyring();
    }
  });

  it.each([
    {
      label: "admits a verified active sender beyond the capped roster projection",
      routeParticipantHasProjection: false,
      routeParticipantRemoved: false,
    },
    {
      label: "reinstates a verified active sender who rejoined after removal",
      routeParticipantHasProjection: true,
      routeParticipantRemoved: true,
    },
  ])("$label", async ({
    routeParticipantHasProjection,
    routeParticipantRemoved,
  }) => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
      routeParticipantAccessRequiresRosterRefresh: true,
      routeParticipantActive: true,
      routeParticipantHasProjection,
      routeParticipantRemoved,
    });
    vi.mocked(linqClient.getHostedLinqChatHandles).mockResolvedValue([
      { handle: "+15550000000", isMe: true, status: "active" },
      ...Array.from({ length: 40 }, (_, index) => ({
        handle: `+15553${index.toString().padStart(6, "0")}`,
        isMe: false,
        status: "active",
      })),
      { handle: "+15552223333", isMe: false, status: "active" },
    ]);
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockImplementation(async ({ phoneNumber }) =>
        phoneNumber === "+15552223333"
          ? {
              core: {
                billingStatus: HostedBillingStatus.active,
                createdAt: new Date("2026-06-24T00:00:00.000Z"),
                id: "member_active_participant_123",
                suspendedAt: null,
                updatedAt: new Date("2026-06-24T00:00:00.000Z"),
              },
              identity: {},
              matchedBy: "phoneNumber",
            } as Awaited<
              ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>
            >
          : null
      );
    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({ sender: "+15552223333" }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(prisma.hostedThreadContainerParticipant.upsert).toHaveBeenCalledWith({
      create: {
        containerMemberId: "member_thread_container_123",
        firstSeenAt: expect.any(Date),
        handleLookupKey: createHostedPhoneLookupKey("+15552223333"),
        lastSeenAt: expect.any(Date),
        participantMemberId: "member_active_participant_123",
        removedAt: null,
      },
      update: {
        handleLookupKey: createHostedPhoneLookupKey("+15552223333"),
        lastSeenAt: expect.any(Date),
        removedAt: null,
      },
      where: {
        containerMemberId_participantMemberId: {
          containerMemberId: "member_thread_container_123",
          participantMemberId: "member_active_participant_123",
        },
      },
    });
  });

  it("fails closed when authoritative roster recovery is unavailable", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
      routeParticipantAccessRequiresRosterRefresh: true,
      routeParticipantActive: true,
    });
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockResolvedValue(null);
    vi.mocked(linqClient.getHostedLinqChatHandles)
      .mockRejectedValue(new Error("provider unavailable"));

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "thread-container-inactive",
    });
    expect(prisma.hostedThreadContainerParticipant.updateMany).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("does not renew a roster handle that now belongs to a different member", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
      routeParticipantAccessRequiresRosterRefresh: true,
      routeParticipantActive: true,
    });
    vi.mocked(linqClient.getHostedLinqChatHandles).mockResolvedValue([
      { handle: "+15550000000", isMe: true, status: "active" },
      { handle: "+15552223333", isMe: false, status: "active" },
    ]);
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockImplementation(async ({ phoneNumber }) =>
        phoneNumber === "+15552223333"
          ? {
              core: {
                billingStatus: HostedBillingStatus.active,
                createdAt: new Date("2026-06-24T00:00:00.000Z"),
                id: "member_different_participant_123",
                suspendedAt: null,
                updatedAt: new Date("2026-06-24T00:00:00.000Z"),
              },
              identity: {},
              matchedBy: "phoneNumber",
            } as Awaited<
              ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>
            >
          : null
      );

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "thread-container-inactive",
    });
    expect(prisma.hostedThreadContainerParticipant.updateMany).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("fails closed for an inactive routed direct thread instead of normal Linq routing", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        isGroup: false,
      }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "thread-container-inactive",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.updateMany).not.toHaveBeenCalled();
  });

  it("dedupes routed thread webhooks against the container mailbox", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    const reactionContext =
      "A participant added a like reaction on: Existing message";
    await markRoutedParticipantAdditionPending(prisma);
    await appendRoutedReactionContext(prisma, reactionContext);
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(
      buildHostedMailboxItem({
        id: "mailbox_existing",
        userId: "member_thread_container_123",
      }),
    );

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      duplicate: true,
      ignored: true,
      ok: true,
      reason: "duplicate-webhook-event",
    });
    const wakeHandoff = readSingleWakeHandoff(plan);
    expect(wakeHandoff).toMatchObject({
      eventId: "evt_group_123",
      mailboxItemId: "mailbox_existing",
      source: "linq",
      userId: "member_thread_container_123",
    });
    expect(wakeHandoff).not.toHaveProperty("wakeMailboxCheckpoint");
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.readPendingGroupReactionContextEncrypted()).not.toBeNull();
    expect(prisma.readPendingParticipantAddition()).toBe(true);

    await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        eventId: "evt_group_after_duplicate",
        messageId: "msg_group_after_duplicate",
      }),
      prisma: prisma as never,
    });
    expect(readAppendedConversationMessage(0)).toMatchObject({
      groupParticipantAdded: true,
      groupReactionContext: reactionContext,
    });
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
    expect(prisma.readPendingParticipantAddition()).toBe(false);
  });

  it("rolls pending group context back when routed mailbox append fails", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    const reactionContext =
      "A participant added a laugh reaction on: Existing message";
    const secondReactionContext =
      "Participant +15551234567 added a like reaction on: Later message";
    await markRoutedParticipantAdditionPending(prisma);
    await appendRoutedReactionContext(prisma, reactionContext);
    await appendRoutedReactionContext(prisma, secondReactionContext);
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockRejectedValueOnce(
      new Error("mailbox append failed"),
    );

    await expect(runRoutedMessageTransaction(
      prisma,
      buildLinqMessageReceivedEvent({}),
    )).rejects.toThrow("mailbox append failed");
    expect(prisma.readPendingGroupReactionContextEncrypted()).not.toBeNull();
    expect(prisma.readPendingParticipantAddition()).toBe(true);

    await runRoutedMessageTransaction(prisma, buildLinqMessageReceivedEvent({
      eventId: "evt_group_after_append_failure",
      messageId: "msg_group_after_append_failure",
    }));
    expect(readAppendedConversationMessage(1)).toMatchObject({
      groupParticipantAdded: true,
      groupReactionContext: [
        reactionContext,
        secondReactionContext,
      ].join("\n"),
    });
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
    expect(prisma.readPendingParticipantAddition()).toBe(false);
  });

  it("rolls pending group context back after a routed mailbox dedupe race", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    const reactionContext =
      "A participant added a question reaction on: Existing message";
    await markRoutedParticipantAdditionPending(prisma);
    await appendRoutedReactionContext(prisma, reactionContext);
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: true,
      inserted: false,
      item: buildHostedMailboxItem({
        id: "mailbox_existing",
        userId: "member_thread_container_123",
      }),
    });

    await expect(runRoutedMessageTransaction(
      prisma,
      buildLinqMessageReceivedEvent({}),
    )).rejects.toMatchObject({
      code: "LINQ_MAILBOX_APPEND_RACE",
      httpStatus: 503,
      retryable: true,
    });
    expect(prisma.readPendingGroupReactionContextEncrypted()).not.toBeNull();
    expect(prisma.readPendingParticipantAddition()).toBe(true);

    await runRoutedMessageTransaction(prisma, buildLinqMessageReceivedEvent({
      eventId: "evt_group_after_race",
      messageId: "msg_group_after_race",
    }));
    expect(readAppendedConversationMessage(1)).toMatchObject({
      groupParticipantAdded: true,
      groupReactionContext: reactionContext,
    });
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBeNull();
    expect(prisma.readPendingParticipantAddition()).toBe(false);
  });

  it("rolls unreadable reaction context back after a mailbox dedupe race", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    await appendRoutedReactionContext(
      prisma,
      "A participant added a like reaction on: Existing message",
    );
    const encryptedContext = prisma.readPendingGroupReactionContextEncrypted();
    expect(encryptedContext).not.toBeNull();
    secureBoxMocks.openHostedUserSecureBoxString.mockRejectedValueOnce(
      new Error("decrypt unavailable"),
    );
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: true,
      inserted: false,
      item: buildHostedMailboxItem({
        id: "mailbox_existing",
        userId: "member_thread_container_123",
      }),
    });

    await expect(runRoutedMessageTransaction(
      prisma,
      buildLinqMessageReceivedEvent({}),
    )).rejects.toMatchObject({
      code: "LINQ_MAILBOX_APPEND_RACE",
      retryable: true,
    });
    expect(prisma.readPendingGroupReactionContextEncrypted()).toBe(
      encryptedContext,
    );
  });
});

describe("Linq group chat auto-provision", () => {
  const senderCore = {
    billingStatus: HostedBillingStatus.active as HostedBillingStatus,
    createdAt: new Date("2026-06-24T00:00:00.000Z"),
    id: "member_owner_123",
    suspendedAt: null as Date | null,
    updatedAt: new Date("2026-06-24T00:00:00.000Z"),
  };

  function mockSenderLookup(core: typeof senderCore | null): void {
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).mockResolvedValue(
      core
        ? {
            core,
            identity: {},
            matchedBy: "phoneNumber",
          } as Awaited<
            ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>
          >
        : null,
    );
  }

  function mockHomeLinqRoute(linqRecipientPhone: string | null): void {
    vi.mocked(memberRoutingStore.readHostedMemberRoutingState).mockResolvedValue(
      linqRecipientPhone
        ? {
            linqChatId: "chat_home_123",
            linqRecipientPhone,
          } as Awaited<ReturnType<typeof memberRoutingStore.readHostedMemberRoutingState>>
        : null,
    );
  }

  function expectManagedLineAuthorityLookup(
    prisma: ReturnType<typeof createStatefulThreadRoutePrisma>,
    phoneNumber: string,
  ): void {
    expect(prisma.hostedLinqLine.findMany).toHaveBeenCalledWith({
      select: {
        configuredAt: true,
        egressPolicy: true,
        healthStatus: true,
        phoneNumberEncrypted: true,
        phoneNumberLookupKey: true,
        providerReputationStatus: true,
        providerServiceStatus: true,
      },
      where: {
        phoneNumberLookupKey: {
          in: createHostedPhoneLookupKeyReadCandidates(phoneNumber),
        },
      },
    });
  }

  function mockAllowedThreadUsage(): void {
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValue({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });
  }

  function seedExistingGroupRoute(
    prisma: ReturnType<typeof createStatefulThreadRoutePrisma>,
  ): void {
    const accountLookupKey = createHostedPhoneLookupKey("+15550000000");
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey,
      channel: "linq",
      threadId: "chat_group_123",
    });
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_123",
    });
    if (!accountLookupKey || !threadLookupKey || !threadIdentityLookupKey) {
      throw new Error("Expected test route lookup keys.");
    }
    prisma.seedThreadRoute({
      channel: "linq",
      containerMemberId: "member_thread_container_123",
      ownerMemberId: "member_owner_123",
      threadIdentityLookupKey,
      threadLookupKey,
    });
  }

  function mockSuccessfulGroupProvision(input: {
    prisma: ReturnType<typeof createStatefulThreadRoutePrisma>;
    senderCore: typeof senderCore;
  }): void {
    input.prisma.seedActiveManagedLinqLine("+15550000000");
    input.prisma.hostedMember.findUnique.mockImplementation(async () => ({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: null,
    }));
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue(input.senderCore);
    vi.mocked(hostedMemberStore.createHostedMember).mockImplementation(async (createInput) => ({
      ...input.senderCore,
      id: createInput.memberId,
    }));
    vi.mocked(domainRootStore.provisionPreparedHostedCryptoDomainRootsTx)
      .mockResolvedValue(undefined);
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValue(null);
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockImplementation(
      async ({ envelope }) => ({
        dedupeConflict: false,
        duplicate: false,
        inserted: true,
        item: buildHostedMailboxItem({
          id: envelope.kind === "member.activated"
            ? "mailbox_activation_123"
            : "mailbox_group_123",
          userId: envelope.userId,
        }),
      }),
    );
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValue({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    mockAllowedThreadUsage();
  }

  it("offers setup without logging an unknown group sender email", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const prisma = createStatefulThreadRoutePrisma();
    const senderEmail = "incident-sender@example.com";
    const recipientPhone = "+15550000000";
    const chatId = "chat_private_incident_123";
    const messageId = "message_private_incident_123";
    const messageText = "Private incident message with secret-token-value";
    prisma.seedActiveManagedLinqLine(recipientPhone);

    try {
      const plan = await planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent({
          chatId,
          messageId,
          recipient: recipientPhone,
          sender: senderEmail,
          text: messageText,
        }),
        prisma: prisma as never,
      });

      expect(plan.response).toMatchObject({
        joinUrl: expect.stringContaining("/groups/start"),
        ok: true,
        reason: "sent-group-setup",
      });
      expect(plan.desiredSideEffects.map(({ payload }) => payload.template))
        .toEqual([
          "group_setup",
          "group_email_recovery",
        ]);
      expect(prisma.hostedMemberEmailAuthorization.findMany).toHaveBeenCalledTimes(1);
      expect(
        memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber,
      ).not.toHaveBeenCalled();

      const plannerDetails = info.mock.calls.find(
        ([message]) => message === "Hosted Linq webhook planner decision.",
      )?.[1];
      expect(plannerDetails).toMatchObject({
        existingMemberActive: false,
        existingMemberMatch: "none",
        linqChatPresent: true,
        linqContactKind: "email",
        linqRecipientPhonePresent: true,
        ok: true,
        reason: "sender-identity-unresolved",
        responseReason: "sent-group-setup",
        routeStage: "new-group-setup-planned",
      });

      const serializedDetails = JSON.stringify(plannerDetails);
      for (const privateValue of [
        senderEmail,
        recipientPhone,
        chatId,
        messageId,
        messageText,
        "secret-token-value",
      ]) {
        expect(serializedDetails).not.toContain(privateValue);
      }
    } finally {
      info.mockRestore();
    }
  });

  it("offers one group setup link for an unknown phone sender", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup(null);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-group-setup",
    });
    expect(plan.desiredSideEffects.map(({ payload }) => payload.template))
      .toEqual(["group_setup"]);
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
  });

  it("screens an unknown group sender through first-contact admission before offering setup", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup(null);

    try {
      const plan = await planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent({}),
        prisma: prisma as never,
        requireFirstContactAdmission: true,
      });

      // A setup link is still a reply to a stranger, so the group planner hands
      // the service layer the same admission request the direct planner does
      // instead of answering on a second, looser policy.
      expect(plan.response).toMatchObject({
        ignored: true,
        ok: true,
        reason: "first-contact-admission-required",
      });
      expect(plan.firstContactAdmissionRequest).toMatchObject({
        eventId: "evt_group_123",
        participantContactKind: "phone",
        partTypes: ["text"],
        service: "imessage",
        text: "How did we sleep?",
      });
      expect(plan.firstContactAdmissionParticipantContact).toMatchObject({
        kind: "phone",
        value: "+15551112222",
      });
      expect(plan.desiredSideEffects).toEqual([]);
      expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();

      const plannerDetails = info.mock.calls.find(
        ([message]) => message === "Hosted Linq webhook planner decision.",
      )?.[1];
      expect(plannerDetails).toMatchObject({
        existingMemberActive: false,
        existingMemberMatch: "none",
        reason: "first-contact-admission-required",
        routeStage: "first-contact-admission-required",
      });
    } finally {
      info.mockRestore();
    }
  });

  it("offers the group setup link once first-contact admission allows the unknown sender", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup(null);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      firstContactAdmissionDecision: {
        confidence: 0.9,
        kind: "allow",
        source: "model",
      },
      prisma: prisma as never,
      requireFirstContactAdmission: true,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-group-setup",
    });
    expect(plan.desiredSideEffects.map(({ payload }) => payload.template))
      .toEqual(["group_setup"]);
    expect(plan.firstContactAdmissionRequest).toBeUndefined();
  });

  it("plans one setup and private recovery link per day for an allowed unknown email sender", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");

    const planUnknownEmailSender = (input: { createdAt: string; eventId: string }) =>
      planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent({
          createdAt: input.createdAt,
          eventId: input.eventId,
          sender: "group-stranger@example.com",
        }),
        // The contact already cleared admission, so later messages are planned
        // on the stored allow instead of a fresh classifier decision.
        firstContactAdmissionDecision: {
          confidence: 0.9,
          kind: "allow",
          source: "model",
        },
        prisma: prisma as never,
        requireFirstContactAdmission: true,
      });

    const firstOfDay = await planUnknownEmailSender({
      createdAt: "2026-06-24T12:00:00.000Z",
      eventId: "evt_group_email_day1_first",
    });
    const laterSameDay = await planUnknownEmailSender({
      createdAt: "2026-06-24T18:00:00.000Z",
      eventId: "evt_group_email_day1_second",
    });
    const nextDay = await planUnknownEmailSender({
      createdAt: "2026-06-25T09:00:00.000Z",
      eventId: "evt_group_email_day2_first",
    });

    for (const plan of [firstOfDay, laterSameDay, nextDay]) {
      expect(plan.response).toMatchObject({
        ok: true,
        reason: "sent-group-setup",
      });
      expect(plan.desiredSideEffects.map(({ payload }) => payload.template))
        .toEqual(["group_setup", "group_email_recovery"]);
    }

    const effectIds = (plan: typeof firstOfDay) =>
      plan.desiredSideEffects.map(({ effectId }) => effectId);
    // Same day dedupes to the one offer already delivered; the next day earns
    // a fresh in-group link and a fresh private recovery link.
    expect(effectIds(laterSameDay)).toEqual(effectIds(firstOfDay));
    expect(effectIds(nextDay)).toHaveLength(2);
    for (const effectId of effectIds(nextDay)) {
      expect(effectIds(firstOfDay)).not.toContain(effectId);
    }
  });

  it("offers the group setup link without an admission request when enforcement is off", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup(null);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
      requireFirstContactAdmission: false,
    });

    // The gate is opt-in: with enforcement off the unknown sender is answered
    // without asking the classifier.
    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-group-setup",
    });
    expect(plan.desiredSideEffects.map(({ payload }) => payload.template))
      .toEqual(["group_setup"]);
    expect(plan.firstContactAdmissionRequest).toBeUndefined();
  });

  it("offers group setup to a known but inactive member without a first-contact admission request", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup({
      ...senderCore,
      billingStatus: HostedBillingStatus.paused,
    });
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.paused,
      suspendedAt: null,
      threadContainer: null,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
      requireFirstContactAdmission: true,
    });

    // Admission screens strangers. A resolved member whose access lapsed is
    // already known, so gating them would spend classifier budget re-deciding
    // an identity the database can answer.
    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-group-setup",
    });
    expect(plan.desiredSideEffects.map(({ payload }) => payload.template))
      .toEqual(["group_setup"]);
    expect(plan.firstContactAdmissionRequest).toBeUndefined();
  });

  it("keeps one exact group/day room body when sender resolution changes", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup(null);

    const unresolvedPlan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        eventId: "evt_group_unresolved_first",
        messageId: "msg_group_unresolved_first",
      }),
      prisma: prisma as never,
    });

    mockSenderLookup({
      ...senderCore,
      billingStatus: HostedBillingStatus.paused,
    });
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.paused,
      suspendedAt: null,
      threadContainer: null,
    });
    const inactivePlan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        eventId: "evt_group_inactive_later",
        messageId: "msg_group_inactive_later",
      }),
      prisma: prisma as never,
    });

    const unresolvedEffect = unresolvedPlan.desiredSideEffects.find(
      ({ payload }) => payload.template === "group_setup",
    );
    const inactiveEffect = inactivePlan.desiredSideEffects.find(
      ({ payload }) => payload.template === "group_setup",
    );

    expect(unresolvedEffect?.effectId).toBe(inactiveEffect?.effectId);
    expect(unresolvedEffect?.payload).not.toHaveProperty("groupSetupReason");
    expect(inactiveEffect?.payload).not.toHaveProperty("groupSetupReason");
    expect(buildHostedLinqGroupSetupMessage({
      seed: unresolvedEffect?.effectId ?? "",
    })).toBe(buildHostedLinqGroupSetupMessage({
      seed: inactiveEffect?.effectId ?? "different",
    }));
  });

  it("does not screen an unknown group sender on a line it could not answer on", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000", {
      healthStatus: "degraded",
      providerReputationStatus: "AT_RISK",
    });
    mockSenderLookup(null);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
      requireFirstContactAdmission: true,
    });

    // The gate sits after the assignable-line check, so strangers on lines we
    // could never reply from stay ignored instead of consuming classifier
    // budget on a message that has no answer.
    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat-line-unavailable",
    });
    expect(plan.firstContactAdmissionRequest).toBeUndefined();
    expect(plan.desiredSideEffects).toEqual([]);
  });

  it("does not answer a standalone SMS opt-out command in an unknown group", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup(null);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        service: "sms",
        text: "STOP",
      }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(plan.desiredSideEffects).toEqual([]);
  });

  it("provisions normally after private email recovery links the sender", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    vi.mocked(
      memberRoutingStore.lookupHostedMemberCoreByPendingLinqParticipantContact,
    ).mockResolvedValue(senderCore);
    mockSuccessfulGroupProvision({ prisma, senderCore });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        sender: "incident-sender@example.com",
      }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(prisma.hostedThreadContainer.create).toHaveBeenCalledTimes(1);
    expect(
      memberRoutingStore.lookupHostedMemberCoreByPendingLinqParticipantContact,
    ).toHaveBeenCalledWith({
      contact: expect.objectContaining({
        kind: "email",
        value: "incident-sender@example.com",
      }),
      linqChatId: "chat_group_123",
      prisma,
      recipientPhone: "+15550000000",
    });
  });

  it("prepares new-container crypto for an active pending-contact sender", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    vi.mocked(
      memberRoutingStore.lookupHostedMemberCoreByPendingLinqParticipantContact,
    ).mockResolvedValue(senderCore);

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({
        sender: "pending-sender@example.test",
      }),
      participantMemberIds: [],
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(
      memberRoutingStore.lookupHostedMemberCoreByPendingLinqParticipantContact,
    ).toHaveBeenCalledExactlyOnceWith({
      contact: expect.objectContaining({
        kind: "email",
        value: "pending-sender@example.test",
      }),
      linqChatId: "chat_group_123",
      prisma,
      recipientPhone: "+15550000000",
    });
  });

  it("does not let stale pending-contact preparation grant container authority", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    vi.mocked(
      memberRoutingStore.lookupHostedMemberCoreByPendingLinqParticipantContact,
    )
      .mockResolvedValueOnce(senderCore)
      .mockResolvedValue(null);
    mockSuccessfulGroupProvision({ prisma, senderCore });
    const event = buildLinqMessageReceivedEvent({
      sender: "pending-sender@example.test",
    });

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event,
      participantMemberIds: [],
      prisma: prisma as never,
    })).resolves.toBe(true);

    const accountLookupKey = createHostedPhoneLookupKey("+15550000000");
    if (!accountLookupKey) {
      throw new Error("Expected a Linq account lookup key.");
    }
    const preparedThreadContainerCreation =
      await prepareThreadContainerCreationForTest({
        accountLookupKey,
        channel: "linq",
        containerMemberId: "member_stale_prepared_container",
        prisma: prisma as never,
        threadId: "chat_group_123",
      });
    const plan = await planHostedOnboardingLinqWebhookWithoutPreparedCrypto({
      event,
      pendingGroupParticipantMemberIds: [],
      preparedThreadContainerCreation,
      preparedThreadDeliveryRoute: preparedThreadContainerCreation,
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-group-setup",
    });
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(
      memberRoutingStore.lookupHostedMemberCoreByPendingLinqParticipantContact,
    ).toHaveBeenCalledTimes(2);
  });

  it("does not prepare new-container crypto for an inactive pending-contact sender", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.canceled,
      suspendedAt: null,
      threadContainer: null,
    });
    vi.mocked(
      memberRoutingStore.lookupHostedMemberCoreByPendingLinqParticipantContact,
    ).mockResolvedValue({
      ...senderCore,
      billingStatus: HostedBillingStatus.canceled,
    });

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({
        sender: "pending-sender@example.test",
      }),
      participantMemberIds: [],
      prisma: prisma as never,
    })).resolves.toBe(false);
  });

  it("does not prepare new-container crypto for a sender who withdrew health-data consent", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx
      .mockResolvedValue([{
        armedAt: new Date("2026-06-24T00:00:00.000Z"),
        id: "hpgs_withdrawn_sender",
        ownerMemberId: "member_other_live_setup",
        recipientPhoneLookupKey: requireTestPhoneLookupKey("+15550000000"),
      }]);
    prisma.hostedMemberIdentity.findMany.mockResolvedValue([
      { memberId: senderCore.id },
    ]);
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      consentGrants: [{
        scope: "launch.health-data",
        status: "revoked",
      }],
      suspendedAt: null,
      threadContainer: null,
    });

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({}),
      participantMemberIds: ["member_other_live_setup"],
      prisma: prisma as never,
    })).resolves.toBe(false);

    expect(
      pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx,
    ).not.toHaveBeenCalled();
  });

  it("uses another roster member's live setup when the sender is billing-inactive", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    const setupOwnerMemberId = "member_other_live_setup";
    pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx
      .mockResolvedValue([{
        armedAt: new Date("2026-06-24T00:00:00.000Z"),
        id: "hpgs_other_live_owner",
        ownerMemberId: setupOwnerMemberId,
        recipientPhoneLookupKey: requireTestPhoneLookupKey("+15550000000"),
      }]);
    prisma.hostedMemberIdentity.findMany.mockResolvedValue([
      { memberId: senderCore.id },
    ]);
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.canceled,
      consentGrants: [],
      suspendedAt: null,
      threadContainer: null,
    });

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({}),
      participantMemberIds: [setupOwnerMemberId],
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(
      pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx,
    ).toHaveBeenCalled();
  });

  it("keeps another roster member's live setup for a contentless inactive-sender message", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    const setupOwnerMemberId = "member_other_contentless_setup";
    pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx
      .mockResolvedValue([{
        armedAt: new Date("2026-06-24T00:00:00.000Z"),
        id: "hpgs_other_contentless_owner",
        ownerMemberId: setupOwnerMemberId,
        recipientPhoneLookupKey: requireTestPhoneLookupKey("+15550000000"),
      }]);
    prisma.hostedMemberIdentity.findMany.mockResolvedValue([
      { memberId: senderCore.id },
    ]);
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.canceled,
      consentGrants: [],
      suspendedAt: null,
      threadContainer: null,
    });

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({
        parts: [{ type: "imessage_app" }],
      }),
      participantMemberIds: [setupOwnerMemberId],
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(
      pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx,
    ).toHaveBeenCalled();
  });

  it("does not prepare new-container crypto for a suspended sender", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    prisma.hostedMemberIdentity.findMany.mockResolvedValue([{
      member: {
        suspendedAt: new Date("2026-06-24T00:00:00.000Z"),
      },
      memberId: senderCore.id,
    }]);

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({}),
      participantMemberIds: ["member_other_live_setup"],
      prisma: prisma as never,
    })).resolves.toBe(false);

    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(
      pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx,
    ).not.toHaveBeenCalled();
  });

  it("does not prepare new-container crypto while group roster authority is unavailable", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    prisma.hostedMemberIdentity.findMany.mockResolvedValue([
      { memberId: senderCore.id },
    ]);

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({}),
      participantMemberIds: [senderCore.id],
      pendingGroupRosterUnavailable: true,
      prisma: prisma as never,
    })).resolves.toBe(false);

    expect(prisma.hostedMemberIdentity.findMany).not.toHaveBeenCalled();
    expect(
      pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx,
    ).not.toHaveBeenCalled();
  });

  it("does not prepare new-container crypto without recipient line authority", async () => {
    const prisma = createStatefulThreadRoutePrisma();

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({
        recipient: "not-a-phone",
      }),
      participantMemberIds: [senderCore.id],
      prisma: prisma as never,
    })).resolves.toBe(false);

    expect(prisma.hostedLinqLine.findMany).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.findMany).not.toHaveBeenCalled();
  });

  it("does not prepare new-container crypto for a roster member without a live setup", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({}),
      participantMemberIds: ["member_roster_only"],
      prisma: prisma as never,
    })).resolves.toBe(false);

    expect(
      pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx,
    ).toHaveBeenCalled();
  });

  it("prepares new-container crypto for a roster member with a live setup", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    const recipientPhoneLookupKey = requireTestPhoneLookupKey("+15550000000");
    pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx
      .mockResolvedValue([{
        armedAt: new Date("2026-06-24T00:00:00.000Z"),
        id: "hpgs_roster_live",
        ownerMemberId: "member_roster_setup",
        recipientPhoneLookupKey,
      }]);

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({}),
      participantMemberIds: ["member_roster_setup"],
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(memberRoutingStore.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_roster_setup",
      prisma,
      retainFailureInScopedCache: true,
    });
  });

  it("does not prepare new-container crypto on a hard-blocked incoming line", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000", {
      healthStatus: "unhealthy",
      providerReputationStatus: "CRITICAL",
    });
    prisma.hostedMemberIdentity.findMany.mockResolvedValue([
      { memberId: senderCore.id },
    ]);

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({}),
      participantMemberIds: [senderCore.id],
      prisma: prisma as never,
    })).resolves.toBe(false);

    expect(prisma.hostedMemberIdentity.findMany).not.toHaveBeenCalled();
  });

  it("prepares new-container crypto for an active sender on their AT_RISK line", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000", {
      healthStatus: "degraded",
      providerReputationStatus: "AT_RISK",
    });
    prisma.hostedMemberIdentity.findMany.mockResolvedValue([
      { memberId: senderCore.id },
    ]);
    mockHomeLinqRoute("+15550000000");

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({}),
      participantMemberIds: [],
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(memberRoutingStore.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: senderCore.id,
      prisma,
      retainFailureInScopedCache: true,
    });
  });

  it("prewarms recovered pending-setup authority for an active sender", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    prisma.hostedMemberIdentity.findMany.mockResolvedValue([
      { memberId: senderCore.id },
    ]);
    pendingGroupSetupMocks.readHostedPendingGroupSetupCandidatesForParticipantsTx
      .mockResolvedValue([{
        armedAt: new Date("2026-06-24T00:00:00.000Z"),
        id: "hpgs_active_sender",
        ownerMemberId: senderCore.id,
        recipientPhoneLookupKey: requireTestPhoneLookupKey("+15550000000"),
      }]);

    await expect(shouldPrepareHostedLinqThreadContainerCrypto({
      event: buildLinqMessageReceivedEvent({}),
      participantMemberIds: [],
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(memberRoutingStore.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: senderCore.id,
      prisma,
      retainFailureInScopedCache: true,
    });
  });

  it.each([
    {
      description: "echoed own messages",
      eventInput: { isFromMe: true },
      linqContactKind: "phone",
      linqRecipientPhonePresent: true,
      reason: "own-message",
    },
    {
      description: "messages without parts",
      eventInput: { text: "" },
      linqContactKind: "phone",
      linqRecipientPhonePresent: true,
      reason: "empty-message-parts",
    },
    {
      description: "messages without a resolvable sender contact",
      eventInput: { sender: "not-a-contact" },
      linqContactKind: "none",
      linqRecipientPhonePresent: true,
      reason: "sender-contact-unresolved",
    },
    {
      description: "messages without recipient line authority",
      eventInput: { recipient: "not-a-phone" },
      linqContactKind: "phone",
      linqRecipientPhonePresent: false,
      reason: "recipient-line-authority-unresolved",
    },
  ] as const)("logs the new-group admission guard for $description", async ({
    eventInput,
    linqContactKind,
    linqRecipientPhonePresent,
    reason,
  }) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const prisma = createStatefulThreadRoutePrisma();

    try {
      const plan = await planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent(eventInput),
        prisma: prisma as never,
      });

      expect(plan.response).toMatchObject({
        ignored: true,
        ok: true,
        reason: "group-chat",
      });
      expect(
        memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber,
      ).not.toHaveBeenCalled();

      const plannerDetails = info.mock.calls.find(
        ([message]) => message === "Hosted Linq webhook planner decision.",
      )?.[1];
      expect(plannerDetails).toMatchObject({
        existingMemberMatch: "none",
        linqContactKind,
        linqRecipientPhonePresent,
        reason,
        responseReason: "group-chat",
        routeStage: "new-group-admission-ignored",
      });
    } finally {
      info.mockRestore();
    }
  });

  it("logs the local inbound allowlist rejection before sender or line authority lookup", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const previousAllowedInbound =
      process.env.HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS;
    process.env.HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS =
      "+15559999999";
    clearHostedOnboardingEnvCache();
    const prisma = createStatefulThreadRoutePrisma();

    try {
      const plan = await planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent({}),
        prisma: prisma as never,
      });

      expect(plan.response).toMatchObject({
        ignored: true,
        ok: true,
        reason: "group-chat",
      });
      expect(
        memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber,
      ).not.toHaveBeenCalled();
      expect(prisma.hostedLinqLine.findFirst).not.toHaveBeenCalled();

      const plannerDetails = info.mock.calls.find(
        ([message]) => message === "Hosted Linq webhook planner decision.",
      )?.[1];
      expect(plannerDetails).toMatchObject({
        existingMemberMatch: "none",
        reason: "local-inbound-not-allowlisted",
        responseReason: "group-chat",
        routeStage: "new-group-admission-ignored",
      });
    } finally {
      restoreEnvValue(
        "HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS",
        previousAllowedInbound,
      );
      clearHostedOnboardingEnvCache();
      info.mockRestore();
    }
  });

  it.each([
    {
      description: "reported direct",
      webhookIsGroup: false,
    },
    {
      description: "omitted",
      webhookIsGroup: null,
    },
  ] as const)(
    "routes an existing durable thread as group when webhook directness is $description",
    async ({ webhookIsGroup }) => {
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const prisma = createStatefulThreadRoutePrisma();
      seedExistingGroupRoute(prisma);
      mockAllowedThreadUsage();
      vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
      vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
        .mockReturnValue(buildLinqMessageReceivedEvent({ isGroup: webhookIsGroup }) as never);
      vi.mocked(linqClient.getHostedLinqChatSummary)
        .mockRejectedValue(new Error("Linq chat read unavailable"));
      vi.mocked(linqClient.getHostedLinqChatHandles).mockResolvedValue([]);

      try {
        const response = await handleHostedOnboardingLinqWebhook({
          rawBody: "{}",
          signature: null,
          timestamp: null,
        });

        expect(response).toMatchObject({
          ignored: false,
          ok: true,
          reason: "wake-appended-thread-route",
        });
        expect(linqClient.getHostedLinqChatSummary).not.toHaveBeenCalled();
        expect(
          memberRoutingStore.demoteHostedMemberLinqGroupChatBindingsTx,
        ).toHaveBeenCalledWith({
          linqChatId: "chat_group_123",
          mailboxDedupeKey: "evt_group_123",
          prisma,
        });
        expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
          envelope: expect.objectContaining({
            message: expect.objectContaining({
              linqMessage: expect.objectContaining({
                chatId: "chat_group_123",
                threadIsDirect: false,
              }),
            }),
          }),
          tx: prisma,
        });
        expect(prisma.hostedLinqLine.findFirst).not.toHaveBeenCalled();
        expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
        expect(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalledWith({
          phoneNumber: "+15551112222",
          prisma,
        });
        expect(prisma.hostedThreadContainerParticipant.updateMany).not.toHaveBeenCalled();
        expect(info).toHaveBeenCalledWith(
          "Hosted onboarding diagnostic: hosted-onboarding.webhook.linq.chat-classification.",
          {
            diagnostic: "hosted-onboarding.webhook.linq.chat-classification",
            outcome: "thread-route-group",
          },
        );
      } finally {
        info.mockRestore();
      }
    },
  );

  it("renews only the authenticated sender's existing roster lease on routed inbound", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    seedExistingGroupRoute(prisma);
    mockSenderLookup(senderCore);
    mockAllowedThreadUsage();
    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest).mockReturnValue(
      buildLinqMessageReceivedEvent({
        createdAt: "2026-07-25T12:00:00.000Z",
        isGroup: true,
      }) as never,
    );
    vi.mocked(linqClient.getHostedLinqChatHandles).mockResolvedValue([]);

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });

    expect(prisma.hostedThreadContainerParticipant.updateMany).toHaveBeenCalledWith({
      data: { lastSeenAt: new Date("2026-07-25T12:00:00.000Z") },
      where: {
        containerMemberId: "member_thread_container_123",
        lastSeenAt: { lt: new Date("2026-07-25T12:00:00.000Z") },
        participantMemberId: "member_owner_123",
        removedAt: null,
      },
    });
    expect(prisma.hostedThreadContainerParticipant.upsert).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        message: expect.objectContaining({
          senderMemberId: "member_owner_123",
        }),
      }),
      tx: prisma,
    });
  });

  it("fails closed as group when the pre-read route disappears before planning", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    seedExistingGroupRoute(prisma);
    const seededFindMany = prisma.hostedThreadRoute.findMany.getMockImplementation();
    if (!seededFindMany) {
      throw new Error("Expected the stateful route lookup implementation.");
    }
    let routeReadCount = 0;
    prisma.hostedThreadRoute.findMany.mockImplementation(async (args: never) => {
      routeReadCount += 1;
      return routeReadCount === 1 ? seededFindMany(args) : [];
    });
    mockSenderLookup(null);
    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
      .mockReturnValue(buildLinqMessageReceivedEvent({ isGroup: false }) as never);
    vi.mocked(linqClient.getHostedLinqChatSummary)
      .mockRejectedValue(new Error("Linq chat read unavailable"));

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    });

    // No managed line is seeded here, so group planning stops at the line read.
    // The group-specific ignore reason is what proves the disappeared route did
    // not fall back to personal direct planning.
    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat-line-unavailable",
    });
    expect(linqClient.getHostedLinqChatSummary).not.toHaveBeenCalled();
    expect(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(hostedMemberStore.createHostedMember).not.toHaveBeenCalled();
    expect(linqDailyState.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(signalRuntime.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("uses a route created after the pre-read instead of personal direct planning", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    seedExistingGroupRoute(prisma);
    const seededFindMany = prisma.hostedThreadRoute.findMany.getMockImplementation();
    if (!seededFindMany) {
      throw new Error("Expected the stateful route lookup implementation.");
    }
    let routeReadCount = 0;
    prisma.hostedThreadRoute.findMany.mockImplementation(async (args: never) => {
      routeReadCount += 1;
      return routeReadCount === 1 ? [] : seededFindMany(args);
    });
    mockAllowedThreadUsage();
    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
      .mockReturnValue(buildLinqMessageReceivedEvent({ isGroup: false }) as never);
    vi.mocked(linqClient.getHostedLinqChatSummary).mockResolvedValue({
      handles: [],
      isGroup: false,
    });
    vi.mocked(linqClient.getHostedLinqChatHandles).mockResolvedValue([]);

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(linqClient.getHostedLinqChatSummary).toHaveBeenCalledWith({
      chatId: "chat_group_123",
      timeoutMs: 1_500,
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        message: expect.objectContaining({
          linqMessage: expect.objectContaining({
            chatId: "chat_group_123",
            threadIsDirect: false,
          }),
        }),
      }),
      tx: prisma,
    });
    expect(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalledWith({
      phoneNumber: "+15551112222",
      prisma,
    });
    expect(prisma.hostedThreadContainerParticipant.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    {
      description: "incorrectly says direct",
      service: "iMessage",
      webhookIsGroup: false,
    },
    {
      description: "omits group directness",
      service: "iMessage",
      webhookIsGroup: null,
    },
    {
      description: "incorrectly says direct",
      service: "sms",
      webhookIsGroup: false,
    },
    {
      description: "omits group directness",
      service: "RCS",
      webhookIsGroup: null,
    },
  ] as const)("uses canonical chat metadata when a $service webhook $description", async ({
    service,
    webhookIsGroup,
  }) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const prisma = createStatefulThreadRoutePrisma();
    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
      .mockReturnValue(buildLinqMessageReceivedEvent({
        isGroup: webhookIsGroup,
        service,
      }) as never);
    mockSenderLookup(senderCore);
    prisma.hostedMemberIdentity.findMany.mockResolvedValue([
      { memberId: senderCore.id },
    ]);
    mockSuccessfulGroupProvision({ prisma, senderCore });
    vi.mocked(linqClient.getHostedLinqChatSummary).mockResolvedValue({
      handles: [],
      isGroup: true,
    });
    vi.mocked(linqClient.getHostedLinqChatHandles).mockResolvedValue([]);

    try {
      const response = await handleHostedOnboardingLinqWebhook({
        rawBody: "{}",
        signature: null,
        timestamp: null,
      });

      expect(response).toMatchObject({
        ignored: false,
        ok: true,
        reason: "wake-appended-thread-route",
      });
      expect(linqClient.getHostedLinqChatSummary).toHaveBeenCalledWith({
        chatId: "chat_group_123",
        timeoutMs: 1_500,
      });
      expect(
        memberRoutingStore.demoteHostedMemberLinqGroupChatBindingsTx,
      ).toHaveBeenCalledWith({
        enforceProviderDispatchFence: true,
        linqChatId: "chat_group_123",
        mailboxDedupeKey: "evt_group_123",
        prisma,
      });
      expect(prisma.hostedThreadContainer.create).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(memberRoutingStore.demoteHostedMemberLinqGroupChatBindingsTx)
          .mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.hostedThreadRoute.create.mock.invocationCallOrder[0]!);
      expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenLastCalledWith({
        envelope: expect.objectContaining({
          kind: "conversation.message",
          message: expect.objectContaining({
            linqMessage: expect.objectContaining({
              chatId: "chat_group_123",
              threadIsDirect: false,
            }),
          }),
        }),
        tx: prisma,
      });
      expect(info).toHaveBeenCalledWith(
        "Hosted onboarding diagnostic: hosted-onboarding.webhook.linq.chat-classification.",
        {
          diagnostic: "hosted-onboarding.webhook.linq.chat-classification",
          outcome: "canonical-group",
        },
      );
    } finally {
      info.mockRestore();
    }
  });

  it.each([
    {
      kind: "direct-paid",
      senderAccess: {
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.active,
      },
    },
    {
      kind: "active-trial",
      senderAccess: {
        accountGroupMemberships: [],
        billingRef: {
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "pulse_trial_7d",
          currentTrialEndsAt: new Date("2100-06-24T00:00:00.000Z"),
          currentTrialStartedAt: new Date("2026-06-24T00:00:00.000Z"),
          pulseTrialPolicyVersion: "pulse-trial-2026-07-15-v3",
          pulseTrialRedeemedAt: new Date("2026-06-24T00:00:00.000Z"),
          stripeSubscriptionLookupKey: "subscription_lookup_active_trial",
        },
        billingStatus: HostedBillingStatus.active,
      },
    },
    {
      kind: "family-sponsored",
      senderAccess: {
        accountGroupMemberships: [
          {
            group: {
              billingStatus: HostedBillingStatus.active,
              suspendedAt: null,
            },
            status: "active",
          },
        ],
        billingStatus: HostedBillingStatus.not_started,
      },
    },
  ])("provisions a thread container on a managed non-home line for the $kind member", async ({ senderAccess }) => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup(senderCore);
    prisma.hostedMember.findUnique.mockImplementation(async () => ({
      ...senderAccess,
      suspendedAt: null,
      threadContainer: null,
    }));
    mockHomeLinqRoute("+15559999999");
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue(senderCore);
    vi.mocked(hostedMemberStore.createHostedMember).mockImplementation(async (input) => ({
      ...senderCore,
      id: input.memberId,
    }));
    vi.mocked(domainRootStore.provisionPreparedHostedCryptoDomainRootsTx)
      .mockResolvedValue(undefined);
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValue(null);
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockImplementation(
      async ({ envelope }) => ({
        dedupeConflict: false,
        duplicate: false,
        inserted: true,
        item: buildHostedMailboxItem({
          id: envelope.kind === "member.activated"
            ? "mailbox_activation_123"
            : "mailbox_group_123",
          userId: envelope.userId,
        }),
      }),
    );
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValue({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_thread_container_123",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValue({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 7_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      planResetAt: null,
      remainingUsdMicros: 7_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(memberRoutingStore.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expectManagedLineAuthorityLookup(prisma, "+15550000000");
    expect(prisma.hostedThreadContainer.create).toHaveBeenCalledTimes(1);
    const containerCreate =
      prisma.hostedThreadContainer.create.mock.calls[0]![0] as {
        data: {
          memberId: string;
          monthlyUsageLimitUsdMicros: bigint;
          ownerMemberId: string;
        };
      };
    expect(containerCreate.data.ownerMemberId).toBe("member_owner_123");
    expect(containerCreate.data.monthlyUsageLimitUsdMicros).toBe(7_500_000n);
    expect(usageReferralMocks.bindArmedHostedUsageReferralToNewContainerTx)
      .toHaveBeenCalledExactlyOnceWith({
        occurredAt: new Date("2026-06-24T12:00:00.000Z"),
        ownerMemberId: "member_owner_123",
        targetChannel: "linq",
        targetLinqService: "iMessage",
        targetContainerMemberId: containerCreate.data.memberId,
        tx: prisma,
      });
    expect(usageReferralMocks.observeHostedUsageReferralInboundTx)
      .toHaveBeenCalledExactlyOnceWith({
        containerMemberId: containerCreate.data.memberId,
        eventKey: createHostedLinqMessageLookupKey("msg_group_123"),
        occurredAt: new Date("2026-06-24T12:00:00.000Z"),
        senderMemberId: null,
        senderSubjectKey: createHostedPhoneLookupKey("+15551112222"),
        tx: prisma,
      });
    expect(prisma.hostedThreadRoute.create).toHaveBeenCalledTimes(1);
    expect(readSingleWakeHandoff(plan)).toMatchObject({
      eventId: "evt_group_123",
      linqChatId: "chat_group_123",
      source: "linq",
      userId: containerCreate.data.memberId,
    });
    expect(plan.postCommitGroupRosterReconciles).toEqual([{
      chatId: "chat_group_123",
      containerMemberId: containerCreate.data.memberId,
    }]);
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenNthCalledWith(1, {
      envelope: expect.objectContaining({
        kind: "member.activated",
        userId: containerCreate.data.memberId,
      }),
      tx: prisma,
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenNthCalledWith(2, {
      envelope: expect.objectContaining({
        kind: "conversation.message",
        message: expect.objectContaining({
          channel: "linq",
          linqMessage: expect.objectContaining({
            chatId: "chat_group_123",
            from: "+15551112222",
            threadIsDirect: false,
          }),
        }),
        userId: containerCreate.data.memberId,
      }),
      tx: prisma,
    });
  });

  it("provisions a thread container on the sender's exact assigned AT_RISK line", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    mockSenderLookup(senderCore);
    mockSuccessfulGroupProvision({ prisma, senderCore });
    prisma.seedActiveManagedLinqLine("+15550000000", {
      healthStatus: "degraded",
      providerReputationStatus: "AT_RISK",
    });
    mockHomeLinqRoute("+15550000000");

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      pendingGroupParticipantMemberIds: ["member_other_prepared_owner"],
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(memberRoutingStore.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_owner_123",
      prisma,
    });
    expect(
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      fallbackOwnerMemberId: "member_owner_123",
      participantMemberIds: ["member_owner_123"],
      senderMemberId: "member_owner_123",
    }));
    expect(prisma.hostedThreadContainer.create).toHaveBeenCalledTimes(1);
    expect(plan.desiredSideEffects).toEqual([]);
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
  });

  it("does not let a pending owner bypass hard-blocked line recovery authority", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000", {
      healthStatus: "unhealthy",
      providerReputationStatus: "CRITICAL",
    });
    prisma.seedActiveManagedLinqLine("+15550000042", {
      healthStatus: "healthy",
      providerReputationStatus: "HEALTHY",
    });
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockResolvedValue(null);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      pendingGroupParticipantMemberIds: ["member_prepared_owner"],
      pendingGroupRosterUnavailable: true,
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat-line-unavailable",
    });
    expect(plan.desiredSideEffects).toEqual([]);
    expect(
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
    ).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it.each([
    {
      description: "absent",
      homeRecipientPhone: null,
    },
    {
      description: "different",
      homeRecipientPhone: "+15559990000",
    },
  ] as const)(
    "keeps an AT_RISK group line unavailable when sender route authority is $description",
    async ({ homeRecipientPhone }) => {
      const prisma = createStatefulThreadRoutePrisma();
      prisma.seedActiveManagedLinqLine("+15550000000", {
        healthStatus: "degraded",
        providerReputationStatus: "AT_RISK",
      });
      mockSenderLookup(senderCore);
      mockHomeLinqRoute(homeRecipientPhone);
      prisma.hostedMember.findUnique.mockResolvedValue({
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
        threadContainer: null,
      });

      const plan = await planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent({}),
        prisma: prisma as never,
      });

      expect(plan.response).toMatchObject({
        ignored: true,
        ok: true,
        reason: "group-chat-line-unavailable",
      });
      expect(plan.desiredSideEffects).toEqual([]);
      expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
      expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
      expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
    },
  );

  it("privately recovers a hard-blocked assigned group line from a healthy line", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000", {
      healthStatus: "unhealthy",
      providerReputationStatus: "CRITICAL",
    });
    prisma.seedActiveManagedLinqLine("+15550000042", {
      healthStatus: "healthy",
      providerReputationStatus: "HEALTHY",
    });
    mockSenderLookup(senderCore);
    mockHomeLinqRoute("+15550000000");
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: null,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-group-line-recovery",
    });
    expect(plan.response.ignored).toBeUndefined();
    expect(plan.desiredSideEffects).toHaveLength(1);
    expect(plan.desiredSideEffects[0]).toMatchObject({
      payload: {
        assignedRecipientPhone: null,
        incomingRecipientPhone: "+15550000000",
        memberId: "member_owner_123",
        participantContact: {
          kind: "phone",
          value: "+15551112222",
        },
        sourceEventId: "evt_group_123",
        template: "group_line_recovery",
        threadId: "chat_group_123",
      },
    });
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
  });

  it("carries the exact live setup across its persisted group-line recovery", async () => {
    const originalRecipientPhone = "+15550000000";
    const recoveredRecipientPhone = "+15550000042";
    const setupArmedAt = new Date("2026-06-24T11:59:00.000Z");
    const firstSpeakerCore = {
      ...senderCore,
      id: "member_recovery_first_speaker",
    };
    const prisma = createStatefulThreadRoutePrisma();
    mockSenderLookup(firstSpeakerCore);
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockResolvedValueOnce({
        core: senderCore,
        identity: {},
        matchedBy: "phoneNumber",
      } as Awaited<
        ReturnType<
          typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber
        >
      >);
    mockSuccessfulGroupProvision({ prisma, senderCore });
    prisma.seedActiveManagedLinqLine(originalRecipientPhone, {
      healthStatus: "unhealthy",
      providerReputationStatus: "CRITICAL",
    });
    prisma.seedActiveManagedLinqLine(recoveredRecipientPhone, {
      healthStatus: "healthy",
      providerReputationStatus: "HEALTHY",
    });
    mockHomeLinqRoute(originalRecipientPhone);
    const originalRecipientPhoneLookupKey =
      createHostedPhoneLookupKey(originalRecipientPhone);
    const recoveredRecipientPhoneLookupKey =
      createHostedPhoneLookupKey(recoveredRecipientPhone);
    if (!originalRecipientPhoneLookupKey || !recoveredRecipientPhoneLookupKey) {
      throw new Error("Expected recovery line authority keys.");
    }
    pendingGroupSetupMocks.readHostedPendingGroupSetup.mockResolvedValue({
      armedAt: setupArmedAt,
      channel: "linq",
      expiresAt: new Date("2026-06-24T12:29:00.000Z"),
      id: "hpgs_recovered_group",
      ownerMemberId: senderCore.id,
      recipientPhoneLookupKey: originalRecipientPhoneLookupKey,
      setup: {
        roomContextMarkdown: "Keep the original prepared context.",
        style: {
          personality: { humor: 2 },
          tone: "casual",
        },
      },
    });
    pendingGroupSetupMocks
      .readHostedPendingGroupSetupCandidatesForParticipantsTx
      .mockResolvedValue([{
        armedAt: setupArmedAt,
        id: "hpgs_recovered_group",
        ownerMemberId: senderCore.id,
        recipientPhoneLookupKey: originalRecipientPhoneLookupKey,
      }]);

    const recoveryPlan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        createdAt: "2026-06-24T12:00:00.000Z",
        eventId: "evt_group_recovery_original",
        recipient: originalRecipientPhone,
      }),
      prisma: prisma as never,
    });
    const recoveryEffect = recoveryPlan.desiredSideEffects[0];
    if (!recoveryEffect) {
      throw new Error("Expected a planned group-line recovery effect.");
    }
    const recoveryDeliveryLookupKey =
      createHostedLinqDeliveryIdempotencyLookupKey(recoveryEffect.effectId);
    if (!recoveryDeliveryLookupKey) {
      throw new Error("Expected recovery delivery authority keys.");
    }
    prisma.seedLinqDelivery({
      attemptedAt: new Date("2026-06-24T12:00:00.500Z"),
      id: "hld_group_recovery_setup_bridge",
      idempotencyKey: recoveryDeliveryLookupKey,
      phoneNumberLookupKey: recoveredRecipientPhoneLookupKey,
      sourceRef: buildHostedLinqGroupLineRecoverySourceRef({
        effectId: recoveryEffect.effectId,
        sourceEventId: "evt_group_recovery_original",
      }),
      status: "attempted",
      targetKind: "participant",
      template: "group_line_recovery",
    });
    preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx
      .mockImplementationOnce(async (input) => {
        const threadLookupKey = createHostedExternalThreadLookupKey({
          accountLookupKey: input.accountLookupKey,
          channel: "linq",
          threadId: input.threadId,
        });
        const threadIdentityLookupKey =
          createHostedExternalThreadIdentityLookupKey({
            channel: "linq",
            threadId: input.threadId,
          });
        if (!threadLookupKey || !threadIdentityLookupKey) {
          throw new Error("Expected recovered group route keys.");
        }
        prisma.seedThreadRoute({
          accountLookupKey: input.accountLookupKey,
          channel: "linq",
          containerMemberId: "member_recovered_group_container",
          ownerMemberId: senderCore.id,
          threadIdentityLookupKey,
          threadLookupKey,
        });
        return {
          ensure: {
            activationEventId: "member.activated:recovered-group",
            activationMailboxItemId: "mailbox_activation_recovered_group",
            containerMemberId: "member_recovered_group_container",
            created: true,
            demotedMailboxConsumedAt: null,
          },
          kind: "ensured",
          ownerMemberId: senderCore.id,
          ownerResolution: "pending_only_candidate",
          pendingSetupApplied: true,
          pendingSetupResolution: "only_candidate",
        } as never;
      });

    const retryEvent = buildLinqMessageReceivedEvent({
      createdAt: "2026-06-24T12:01:00.000Z",
      eventId: "evt_group_recovery_retry",
      messageId: "msg_group_recovery_retry",
      recipient: recoveredRecipientPhone,
      sender: "+15551113333",
      text: "Did the new number work?",
    });
    await expect(planHostedOnboardingLinqWebhook({
      event: retryEvent,
      pendingGroupParticipantMemberIds: [
        senderCore.id,
        firstSpeakerCore.id,
      ],
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_GROUP_LINE_RECOVERY_IN_FLIGHT",
      httpStatus: 503,
      retryable: true,
    });
    expect(
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
    ).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();

    prisma.seedLinqDelivery({
      acceptedAt: new Date("2026-06-24T12:00:01.000Z"),
      attemptedAt: new Date("2026-06-24T12:00:00.500Z"),
      id: "hld_group_recovery_setup_bridge",
      idempotencyKey: recoveryDeliveryLookupKey,
      messageLookupKey: "hbid:linq-message:recovery-setup-bridge",
      phoneNumberLookupKey: recoveredRecipientPhoneLookupKey,
      sourceRef: buildHostedLinqGroupLineRecoverySourceRef({
        effectId: recoveryEffect.effectId,
        sourceEventId: "evt_group_recovery_original",
      }),
      status: "accepted",
      targetKind: "participant",
      template: "group_line_recovery",
    });
    const retryPlan = await planHostedOnboardingLinqWebhook({
      event: retryEvent,
      pendingGroupParticipantMemberIds: [
        senderCore.id,
        firstSpeakerCore.id,
      ],
      prisma: prisma as never,
    });

    expect(recoveryPlan.response).toMatchObject({
      ok: true,
      reason: "sent-group-line-recovery",
    });
    expect(recoveryEffect.effectId).toBe(
      buildHostedLinqGroupLineRecoveryEffectId({
        incomingRecipientPhone: originalRecipientPhone,
        memberId: senderCore.id,
        pendingGroupSetupId: "hpgs_recovered_group",
        threadId: "chat_group_123",
      }),
    );
    expect(retryPlan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
    ).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      accountLookupKey: recoveredRecipientPhoneLookupKey,
      fallbackOwnerMemberId: firstSpeakerCore.id,
      participantMemberIds: [senderCore.id],
      recipientPhoneLookupKeys: expect.arrayContaining([
        recoveredRecipientPhoneLookupKey,
        originalRecipientPhoneLookupKey,
      ]),
      requiredPendingSetupCandidateId: "hpgs_recovered_group",
      senderMemberId: firstSpeakerCore.id,
      threadId: "chat_group_123",
    }));
    expect(prisma.readAccountLookupKeyProjection(
      "member_recovered_group_container",
    )).toBe(recoveredRecipientPhoneLookupKey);
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "evt_group_recovery_retry",
        message: expect.objectContaining({
          linqMessage: expect.objectContaining({
            messageId: "msg_group_recovery_retry",
          }),
        }),
        userId: "member_recovered_group_container",
      }),
      tx: prisma,
    });
  });

  it.each(["SMS", "RCS"] as const)(
    "keeps hard-blocked %s group recovery silent",
    async (service) => {
      const prisma = createStatefulThreadRoutePrisma();
      prisma.seedActiveManagedLinqLine("+15550000000", {
        healthStatus: "unhealthy",
        providerReputationStatus: "CRITICAL",
      });
      prisma.seedActiveManagedLinqLine("+15550000042", {
        healthStatus: "healthy",
        providerReputationStatus: "HEALTHY",
      });
      mockSenderLookup(senderCore);
      mockHomeLinqRoute("+15550000000");
      prisma.hostedMember.findUnique.mockResolvedValue({
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
        threadContainer: null,
      });

      const plan = await planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent({ service }),
        prisma: prisma as never,
      });

      expect(plan.response).toMatchObject({
        ignored: true,
        ok: true,
        reason: "group-chat-line-unavailable",
      });
      expect(plan.desiredSideEffects).toEqual([]);
      expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
      expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
      expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
    },
  );

  it("defers recovery sender capacity claims to transport", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000", {
      healthStatus: "unhealthy",
      providerReputationStatus: "CRITICAL",
    });
    prisma.seedActiveManagedLinqLine("+15550000041", {
      healthStatus: "healthy",
      providerReputationStatus: "HEALTHY",
    });
    prisma.seedActiveManagedLinqLine("+15550000042", {
      healthStatus: "healthy",
      providerReputationStatus: "HEALTHY",
    });
    const lostLineLookupKey = createHostedPhoneLookupKey("+15550000041");
    const selectedLineLookupKey = createHostedPhoneLookupKey("+15550000042");
    if (!lostLineLookupKey || !selectedLineLookupKey) {
      throw new Error("Expected recovery line lookup keys.");
    }
    const originalUpdateMany =
      prisma.hostedLinqLine.updateMany.getMockImplementation();
    if (!originalUpdateMany) {
      throw new Error("Expected recovery line update fixture.");
    }
    prisma.hostedLinqLine.updateMany.mockImplementation(async (args: never) => {
      const input = args as { where: { phoneNumberLookupKey: string } };
      if (input.where.phoneNumberLookupKey === lostLineLookupKey) {
        return { count: 0 };
      }
      return originalUpdateMany(args);
    });
    mockSenderLookup(senderCore);
    mockHomeLinqRoute("+15550000000");
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: null,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-group-line-recovery",
    });
    expect(plan.desiredSideEffects[0]).toMatchObject({
      payload: {
        assignedRecipientPhone: null,
        incomingRecipientPhone: "+15550000000",
        template: "group_line_recovery",
      },
    });
    expect(lostLineLookupKey).not.toBe(selectedLineLookupKey);
    expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
  });

  it("defers capped healthy recovery senders to transport", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    const dayUtc = new Date("2026-06-24T00:00:00.000Z");
    prisma.seedActiveManagedLinqLine("+15550000000", {
      healthStatus: "unhealthy",
      providerReputationStatus: "CRITICAL",
    });
    for (const phoneNumber of ["+15550000042", "+15550000043"]) {
      prisma.seedActiveManagedLinqLine(phoneNumber, {
        healthStatus: "healthy",
        maxNewConversationsPerDay: 1,
        proactiveConversationCount: 1,
        proactiveConversationDayUtc: dayUtc,
        providerReputationStatus: "HEALTHY",
      });
    }
    mockSenderLookup(senderCore);
    mockHomeLinqRoute("+15550000000");
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: null,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-group-line-recovery",
    });
    expect(plan.response.ignored).toBeUndefined();
    expect(plan.desiredSideEffects[0]).toMatchObject({
      payload: {
        assignedRecipientPhone: null,
        incomingRecipientPhone: "+15550000000",
        template: "group_line_recovery",
      },
    });
    expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
  });

  it("defers missing healthy recovery senders to transport", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000", {
      healthStatus: "unhealthy",
      providerReputationStatus: "CRITICAL",
    });
    mockSenderLookup(senderCore);
    mockHomeLinqRoute("+15550000000");
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: null,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-group-line-recovery",
    });
    expect(plan.response.ignored).toBeUndefined();
    expect(plan.desiredSideEffects[0]).toMatchObject({
      payload: {
        assignedRecipientPhone: null,
        incomingRecipientPhone: "+15550000000",
        template: "group_line_recovery",
      },
    });
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
  });

  it("does not inspect pinned recovery sender health during planning", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000", {
      healthStatus: "unhealthy",
      providerReputationStatus: "CRITICAL",
    });
    prisma.seedActiveManagedLinqLine("+15550000042", {
      healthStatus: "healthy",
      providerReputationStatus: "HEALTHY",
    });
    prisma.seedActiveManagedLinqLine("+15550000043", {
      healthStatus: "unhealthy",
      providerReputationStatus: "CRITICAL",
    });
    const effectId = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: "+15550000000",
      memberId: "member_owner_123",
      threadId: "chat_group_123",
    });
    const idempotencyLookupKey =
      createHostedLinqDeliveryIdempotencyLookupKey(effectId);
    const pinnedLineLookupKey = createHostedPhoneLookupKey("+15550000043");
    if (!idempotencyLookupKey || !pinnedLineLookupKey) {
      throw new Error("Expected recovery delivery lookup keys.");
    }
    prisma.seedLinqDelivery({
      id: "hld_group_recovery_unhealthy_retry",
      idempotencyKey: idempotencyLookupKey,
      phoneNumberLookupKey: pinnedLineLookupKey,
    });
    mockSenderLookup(senderCore);
    mockHomeLinqRoute("+15550000000");
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: null,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-group-line-recovery",
    });
    expect(plan.response.ignored).toBeUndefined();
    expect(plan.desiredSideEffects[0]).toMatchObject({
      payload: {
        assignedRecipientPhone: null,
        incomingRecipientPhone: "+15550000000",
        template: "group_line_recovery",
      },
    });
    expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
  });

  it("does not recover structurally unavailable group lines", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000", {
      egressPolicy: "disabled",
      healthStatus: "unhealthy",
      providerReputationStatus: "CRITICAL",
    });
    prisma.seedActiveManagedLinqLine("+15550000042", {
      healthStatus: "healthy",
      providerReputationStatus: "HEALTHY",
    });
    mockSenderLookup(senderCore);
    mockHomeLinqRoute("+15550000000");
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: null,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat-line-unavailable",
    });
    expect(plan.desiredSideEffects).toEqual([]);
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
  });

  it("does not inspect pinned healthy recovery sender during planning", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000", {
      healthStatus: "unhealthy",
      providerReputationStatus: "CRITICAL",
    });
    prisma.seedActiveManagedLinqLine("+15550000042", {
      healthStatus: "healthy",
      providerReputationStatus: "HEALTHY",
    });
    prisma.seedActiveManagedLinqLine("+15550000043", {
      healthStatus: "healthy",
      providerReputationStatus: "HEALTHY",
    });
    const effectId = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: "+15550000000",
      memberId: "member_owner_123",
      threadId: "chat_group_123",
    });
    const idempotencyLookupKey =
      createHostedLinqDeliveryIdempotencyLookupKey(effectId);
    const pinnedLineLookupKey = createHostedPhoneLookupKey("+15550000043");
    if (!idempotencyLookupKey || !pinnedLineLookupKey) {
      throw new Error("Expected recovery delivery lookup keys.");
    }
    prisma.seedLinqDelivery({
      id: "hld_group_recovery_retry",
      idempotencyKey: idempotencyLookupKey,
      phoneNumberLookupKey: pinnedLineLookupKey,
    });
    mockSenderLookup(senderCore);
    mockHomeLinqRoute("+15550000000");
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: null,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "sent-group-line-recovery",
    });
    expect(plan.desiredSideEffects[0]).toMatchObject({
      payload: {
        assignedRecipientPhone: null,
        incomingRecipientPhone: "+15550000000",
        template: "group_line_recovery",
      },
    });
    expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
  });

  it("admits a first group message from an active pending-contact-only sender", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    let transactionOpen = false;
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionOpen = true;
      try {
        return await callback(prisma);
      } finally {
        transactionOpen = false;
      }
    });
    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
      .mockReturnValue(buildLinqMessageReceivedEvent({
        sender: "pending-sender@example.test",
      }) as never);
    vi.mocked(
      memberRoutingStore.lookupHostedMemberCoreByPendingLinqParticipantContact,
    ).mockResolvedValue(senderCore);
    vi.mocked(domainRootStore.prepareHostedCryptoDomainRootCandidates)
      .mockImplementationOnce(async () => {
        expect(transactionOpen).toBe(false);
        return new Map();
      });
    mockSuccessfulGroupProvision({ prisma, senderCore });
    vi.mocked(linqClient.getHostedLinqChatSummary).mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      return {
        handles: [
          { handle: "+15550000000", isMe: true, status: "active" },
          {
            handle: "pending-sender@example.test",
            isMe: false,
            status: "active",
          },
        ],
        isGroup: true,
      };
    });

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(domainRootStore.prepareHostedCryptoDomainRootCandidates)
      .toHaveBeenCalledTimes(1);
    expect(prisma.hostedThreadContainer.create).toHaveBeenCalledTimes(1);
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "member.activated",
      }),
      tx: prisma,
    });
    expect(
      memberRoutingStore.lookupHostedMemberCoreByPendingLinqParticipantContact,
    ).toHaveBeenCalledTimes(2);
  });

  it("skips container crypto for a withdrawn sender through the webhook entry point", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
      .mockReturnValue(buildLinqMessageReceivedEvent({}) as never);
    mockSenderLookup(senderCore);
    prisma.hostedMemberIdentity.findMany.mockResolvedValue([
      {
        memberId: senderCore.id,
        phoneLookupKey: createHostedPhoneLookupKey("+15551112222"),
      },
    ]);
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      consentGrants: [{
        scope: "launch.health-data",
        status: "revoked",
      }],
      suspendedAt: null,
      threadContainer: null,
    });
    vi.mocked(linqClient.getHostedLinqChatSummary).mockResolvedValue({
      handles: [
        { handle: "+15550000000", isMe: true, status: "active" },
        { handle: "+15551112222", isMe: false, status: "active" },
      ],
      isGroup: true,
    });

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(
      domainRootStore.prepareHostedCryptoDomainRootCandidates,
    ).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("skips container crypto for a degraded line through the webhook entry point", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000", {
      healthStatus: "degraded",
      providerReputationStatus: "HEALTHY",
    });
    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
      .mockReturnValue(buildLinqMessageReceivedEvent({}) as never);
    mockSenderLookup(senderCore);
    prisma.hostedMemberIdentity.findMany.mockResolvedValue([
      {
        memberId: senderCore.id,
        phoneLookupKey: createHostedPhoneLookupKey("+15551112222"),
      },
    ]);
    vi.mocked(linqClient.getHostedLinqChatSummary).mockResolvedValue({
      handles: [
        { handle: "+15550000000", isMe: true, status: "active" },
        { handle: "+15551112222", isMe: false, status: "active" },
      ],
      isGroup: true,
    });

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat-line-unavailable",
    });
    expect(
      domainRootStore.prepareHostedCryptoDomainRootCandidates,
    ).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("reconciles a new group roster after the provisioning transaction commits", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    let transactionOpen = false;
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionOpen = true;
      try {
        return await callback(prisma);
      } finally {
        transactionOpen = false;
      }
    });
    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
      .mockReturnValue(buildLinqMessageReceivedEvent({}) as never);
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockImplementation(async ({ phoneNumber }) => phoneNumber === "+15551112222"
        ? {
            core: senderCore,
            identity: {},
            matchedBy: "phoneNumber",
          } as Awaited<
            ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>
          >
        : null);
    prisma.hostedMemberIdentity.findMany.mockImplementation(async ({ select, where }: {
      select: {
        member?: { select: { suspendedAt: boolean } };
        memberId: boolean;
        phoneLookupKey?: boolean;
      };
      where: { phoneLookupKey: { in: string[] } };
    }) => {
      const lookupKey = createHostedPhoneLookupKey("+15551112222");
      if (select.phoneLookupKey === true) {
        expect(select).toEqual({ memberId: true, phoneLookupKey: true });
        return lookupKey && where.phoneLookupKey.in.includes(lookupKey)
          ? [{ memberId: "member_owner_123", phoneLookupKey: lookupKey }]
          : [];
      }
      expect(select).toEqual({
        member: { select: { suspendedAt: true } },
        memberId: true,
      });
      return lookupKey && where.phoneLookupKey.in.includes(lookupKey)
        ? [{ member: { suspendedAt: null }, memberId: "member_owner_123" }]
        : [];
    });
    prisma.hostedMemberEmailAuthorization.findMany.mockImplementation(
      async ({ select, where }: {
        select: { memberId: boolean; verifiedEmailLookupKey: boolean };
        where: {
          verifiedEmailLookupKey: { in: string[] };
          verifiedEmailVerifiedAt: { not: null };
        };
      }) => {
        expect(select).toEqual({
          memberId: true,
          verifiedEmailLookupKey: true,
        });
        expect(where.verifiedEmailVerifiedAt).toEqual({ not: null });
        const lookupKey = createHostedEmailLookupKey("participant@example.com");
        return lookupKey && where.verifiedEmailLookupKey.in.includes(lookupKey)
          ? [{
              memberId: "member_participant_123",
              verifiedEmailLookupKey: lookupKey,
            }]
          : [];
      },
    );
    mockSuccessfulGroupProvision({ prisma, senderCore });
    usageReferralMocks.observeHostedUsageReferralInboundTx.mockResolvedValue({
      isBoundReferralTarget: true,
      qualificationCandidateReferralIds: [
        "usage_referral_1",
        "usage_referral_2",
      ],
    });
    vi.mocked(linqClient.getHostedLinqChatHandles).mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      return [
        { handle: "+15550000000", isMe: true, status: "active" },
        { handle: "+15551112222", isMe: false, status: "active" },
        { handle: "participant@example.com", isMe: false, status: "active" },
      ];
    });
    vi.mocked(linqClient.getHostedLinqChatSummary).mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      return {
        handles: [
          { handle: "+15550000000", isMe: true, status: "active" },
          { handle: "+15551112222", isMe: false, status: "active" },
          { handle: "participant@example.com", isMe: false, status: "active" },
        ],
        isGroup: true,
      };
    });

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    });

    const containerCreate = prisma.hostedThreadContainer.create.mock.calls[0]![0] as {
      data: { memberId: string };
    };
    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(prismaModule.getPrisma).toHaveBeenCalledTimes(2);
    expect(linqClient.getHostedLinqChatHandles).not.toHaveBeenCalled();
    expect(linqClient.getHostedLinqChatSummary).toHaveBeenCalledWith({
      chatId: "chat_group_123",
      timeoutMs: 1_500,
    });
    expect(
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      participantMemberIds: [
        "member_owner_123",
        "member_participant_123",
      ],
      senderMemberId: "member_owner_123",
    }));
    expect(
      usageReferralMocks.reconcileHostedUsageReferralRewardAfterCommit,
    ).toHaveBeenCalledTimes(2);
    expect(
      usageReferralMocks.reconcileHostedUsageReferralRewardAfterCommit,
    ).toHaveBeenNthCalledWith(1, {
      prisma,
      referralId: "usage_referral_1",
    });
    expect(
      usageReferralMocks.reconcileHostedUsageReferralRewardAfterCommit,
    ).toHaveBeenNthCalledWith(2, {
      prisma,
      referralId: "usage_referral_2",
    });
    const rosterPhoneReads = prisma.hostedMemberIdentity.findMany.mock.calls
      .filter(([query]) => query.select?.phoneLookupKey === true);
    expect(rosterPhoneReads).toHaveLength(1);
    expect(prisma.hostedMemberIdentity.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedMemberEmailAuthorization.findMany).toHaveBeenCalledTimes(1);
    const participantReconciles = prisma.$executeRaw.mock.calls
      .map(([query]) => query as Prisma.Sql)
      .filter((query) => typeof query.sql === "string" && query.sql.includes(
        "WITH input_participant(participant_member_id, handle_lookup_key)",
      ));
    expect(participantReconciles).toHaveLength(1);
    expect(participantReconciles[0]?.sql).toContain(
      "ON CONFLICT (container_member_id, participant_member_id)",
    );
    expect(participantReconciles[0]?.sql).toContain(
      "UPDATE hosted_thread_container_participant AS participant",
    );
    expect(participantReconciles[0]?.values).toEqual(expect.arrayContaining([
      containerCreate.data.memberId,
      "member_owner_123",
      "member_participant_123",
      true,
    ]));
    expect(prisma.hostedThreadContainerParticipant.upsert).not.toHaveBeenCalled();
    const legacyRosterRemovalWrites =
      prisma.hostedThreadContainerParticipant.updateMany.mock.calls
        .filter(([query]) => query.data?.removedAt instanceof Date);
    expect(legacyRosterRemovalWrites).toHaveLength(0);
    expect(signalRuntime.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: containerCreate.data.memberId,
      knownCheckpoint: {
        lane: "conversation",
        laneSeq: "1",
        userId: containerCreate.data.memberId,
      },
      mailboxItemId: "mailbox_group_123",
    });
  });

  it("limits oversized-roster setup matching to the authenticated sender", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    let transactionOpen = false;
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionOpen = true;
      try {
        return await callback(prisma);
      } finally {
        transactionOpen = false;
      }
    });
    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
      .mockReturnValue(buildLinqMessageReceivedEvent({}) as never);
    mockSenderLookup(senderCore);
    prisma.hostedMemberIdentity.findMany.mockImplementation(async ({ select, where }: {
      select: {
        member?: { select: { suspendedAt: boolean } };
        memberId: boolean;
        phoneLookupKey?: boolean;
      };
      where: { phoneLookupKey: { in: string[] } };
    }) => {
      const lookupKey = createHostedPhoneLookupKey("+15551112222");
      if (select.phoneLookupKey === true) {
        return lookupKey && where.phoneLookupKey.in.includes(lookupKey)
          ? [{ memberId: senderCore.id, phoneLookupKey: lookupKey }]
          : [];
      }
      return lookupKey && where.phoneLookupKey.in.includes(lookupKey)
        ? [{ member: { suspendedAt: null }, memberId: senderCore.id }]
        : [];
    });
    mockSuccessfulGroupProvision({ prisma, senderCore });
    vi.mocked(linqClient.getHostedLinqChatSummary).mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      return {
        handles: [
          { handle: "+15550000000", isMe: true, status: "active" },
          ...Array.from({ length: 33 }, (_, index) => ({
            handle: `+1555${String(index).padStart(7, "0")}`,
            isMe: false,
            status: "active",
          })),
        ],
        isGroup: true,
      };
    });
    vi.mocked(linqClient.getHostedLinqChatHandles).mockResolvedValue([
      { handle: "+15550000000", isMe: true, status: "active" },
      { handle: "+15551112222", isMe: false, status: "active" },
    ]);

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      participantMemberIds: ["member_owner_123"],
      senderMemberId: "member_owner_123",
    }));
    const rosterPhoneReads = prisma.hostedMemberIdentity.findMany.mock.calls
      .filter(([query]) => query.select?.phoneLookupKey === true);
    expect(rosterPhoneReads).toHaveLength(1);
    expect(rosterPhoneReads[0]?.[0]).toEqual({
      select: {
        memberId: true,
        phoneLookupKey: true,
      },
      where: {
        phoneLookupKey: { in: expect.any(Array) },
      },
    });
    expect(prisma.hostedMemberIdentity.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedMemberEmailAuthorization.findMany).not.toHaveBeenCalled();
    const participantReconciles = prisma.$executeRaw.mock.calls
      .map(([query]) => query as Prisma.Sql)
      .filter((query) => typeof query.sql === "string" && query.sql.includes(
        "WITH input_participant(participant_member_id, handle_lookup_key)",
      ));
    expect(participantReconciles).toHaveLength(1);
    expect(participantReconciles[0]?.values).toContain(false);
  });

  it("retries the first group message when roster authority is unavailable", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    let transactionOpen = false;
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionOpen = true;
      try {
        return await callback(prisma);
      } finally {
        transactionOpen = false;
      }
    });
    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
      .mockReturnValue(buildLinqMessageReceivedEvent({}) as never);
    mockSenderLookup(senderCore);
    mockSuccessfulGroupProvision({ prisma, senderCore });
    vi.mocked(linqClient.getHostedLinqChatSummary)
      .mockRejectedValue(new Error("linq unavailable"));
    vi.mocked(linqClient.getHostedLinqChatHandles).mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      throw new Error("linq unavailable");
    });

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PENDING_GROUP_ROSTER_UNAVAILABLE",
      httpStatus: 502,
      retryable: true,
    });

    expect(
      domainRootStore.prepareHostedCryptoDomainRootCandidates,
    ).not.toHaveBeenCalled();
    expect(
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
    ).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(signalRuntime.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("retries an unregistered first group message when roster authority is unavailable", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
      .mockReturnValue(buildLinqMessageReceivedEvent({}) as never);
    const preparedOwner = {
      ...senderCore,
      id: "member_prepared_owner",
    };
    mockSuccessfulGroupProvision({ prisma, senderCore: preparedOwner });
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockImplementation(async ({ phoneNumber }) =>
        phoneNumber === "+15552223333"
          ? {
              core: preparedOwner,
              identity: {},
              matchedBy: "phoneNumber",
            } as Awaited<
              ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>
            >
          : null
      );
    prisma.hostedMemberIdentity.findMany.mockResolvedValue([
      {
        memberId: preparedOwner.id,
        phoneLookupKey: createHostedPhoneLookupKey("+15552223333"),
      },
    ]);
    vi.mocked(linqClient.getHostedLinqChatSummary)
      .mockRejectedValueOnce(new Error("linq roster unavailable"))
      .mockResolvedValueOnce({
        handles: [
          { handle: "+15550000000", isMe: true, status: "active" },
          { handle: "+15551112222", isMe: false, status: "active" },
          { handle: "+15552223333", isMe: false, status: "active" },
        ],
        isGroup: true,
      });
    preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx
      .mockImplementationOnce(async (input) => {
        const threadLookupKey = createHostedExternalThreadLookupKey({
          accountLookupKey: input.accountLookupKey,
          channel: "linq",
          threadId: input.threadId,
        });
        const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
          channel: "linq",
          threadId: input.threadId,
        });
        if (!threadLookupKey || !threadIdentityLookupKey) {
          throw new Error("Expected route lookup keys.");
        }
        prisma.seedThreadRoute({
          channel: "linq",
          containerMemberId: "member_prepared_container",
          ownerMemberId: preparedOwner.id,
          threadIdentityLookupKey,
          threadLookupKey,
        });
        return {
          ensure: {
            activationEventId: "member.activated:prepared",
            activationMailboxItemId: "mailbox_activation_prepared",
            containerMemberId: "member_prepared_container",
            created: true,
            demotedMailboxConsumedAt: null,
          },
          kind: "ensured",
          ownerMemberId: preparedOwner.id,
          ownerResolution: "pending_only_candidate",
          pendingSetupApplied: true,
          pendingSetupResolution: "only_candidate",
        } as never;
      });

    const request = {
      rawBody: "{}",
      signature: null,
      timestamp: null,
    } as const;

    await expect(handleHostedOnboardingLinqWebhook(request)).rejects.toMatchObject({
      code: "HOSTED_LINQ_PENDING_GROUP_ROSTER_UNAVAILABLE",
      httpStatus: 502,
      retryable: true,
    });
    expect(
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
    ).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();

    const replay = await handleHostedOnboardingLinqWebhook(request);

    expect(replay).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
    ).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      fallbackOwnerMemberId: null,
      participantMemberIds: [preparedOwner.id],
      senderMemberId: null,
    }));
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "evt_group_123",
        kind: "conversation.message",
        message: expect.objectContaining({
          linqMessage: expect.objectContaining({
            messageId: "msg_group_123",
          }),
        }),
        userId: "member_prepared_container",
      }),
      tx: prisma,
    });
  });

  it("dedupes a replay after managed-line provisioning without re-provisioning", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    mockSenderLookup(senderCore);
    mockSuccessfulGroupProvision({ prisma, senderCore });

    const firstPlan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValue(
      buildHostedMailboxItem({
        id: "mailbox_group_123",
        userId: readSingleWakeHandoff(firstPlan).userId,
      }),
    );

    const replayPlan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(replayPlan.response).toMatchObject({
      duplicate: true,
      ignored: true,
      ok: true,
      reason: "duplicate-webhook-event",
    });
    expect(prisma.hostedThreadContainer.create).toHaveBeenCalledTimes(1);
    expect(prisma.hostedThreadRoute.create).toHaveBeenCalledTimes(1);
    expect(prisma.hostedLinqLine.findMany).toHaveBeenCalledTimes(1);
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
  });

  it("ignores group messages from senders without hosted member identity when no managed line owns the recipient", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    mockSenderLookup(null);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    // Unknown senders are only offered group setup on a line Murph manages;
    // no seeded line means the group stays silent instead of replying.
    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat-line-unavailable",
    });
    expect(plan.desiredSideEffects).toEqual([]);
    expect(
      memberRoutingStore.demoteHostedMemberLinqGroupChatBindingsTx,
    ).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("offers group setup without provisioning for members without active access", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup({
      ...senderCore,
      billingStatus: HostedBillingStatus.paused,
    });
    // The sender gate is the unified access read: paused own billing and no
    // sponsoring family group means no access.
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.paused,
      suspendedAt: null,
      threadContainer: null,
    });

    try {
      const plan = await planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent({}),
        prisma: prisma as never,
      });

      // A member whose access lapsed receives the canonical setup link without
      // exposing the private access reason or provisioning the group.
      expect(plan.response).toMatchObject({
        ok: true,
        reason: "sent-group-setup",
      });
      expect(plan.desiredSideEffects.map(({ payload }) => payload.template))
        .toEqual(["group_setup"]);
      expect(memberRoutingStore.readHostedMemberRoutingState).not.toHaveBeenCalled();
      expect(prisma.hostedLinqLine.findFirst).not.toHaveBeenCalled();
      expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
      expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();

      const plannerDetails = info.mock.calls.find(
        ([message]) => message === "Hosted Linq webhook planner decision.",
      )?.[1];
      expect(plannerDetails).toMatchObject({
        existingMemberMatch: "phone-identity",
        reason: "sender-inactive",
        responseReason: "sent-group-setup",
        routeStage: "new-group-setup-planned",
      });
    } finally {
      info.mockRestore();
    }
  });

  it("does not expose a group sender's withdrawal status in the thread", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    mockSenderLookup(senderCore);
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      consentGrants: [{
        scope: "launch.health-data",
        status: "revoked",
      }],
      suspendedAt: null,
      threadContainer: null,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(plan.desiredSideEffects).toEqual([]);
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("stays silent for a withdrawn group sender even when a managed line is available", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup(senderCore);
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      consentGrants: [{
        scope: "launch.health-data",
        status: "revoked",
      }],
      suspendedAt: null,
      threadContainer: null,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    // A member whose access lapsed for billing is offered group setup, but an
    // explicit withdrawal has to stop outreach instead: an assignable line is
    // the case where the setup offer would otherwise be sent.
    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(plan.desiredSideEffects).toEqual([]);
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("does not let a retained trial timestamp expire a delayed group message", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    mockSenderLookup(senderCore);
    mockSuccessfulGroupProvision({ prisma, senderCore });
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: new Date("2026-06-25T12:00:00.000Z"),
        currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
        stripeSubscriptionLookupKey: "subscription_lookup_expired_trial",
      },
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: null,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(plan.desiredSideEffects.map(({ payload }) => payload.template))
      .not.toContain("group_setup");
    expect(prisma.hostedThreadContainer.create).toHaveBeenCalledOnce();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
  });

  it("ignores group messages from suspended members without answering", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup({
      ...senderCore,
      suspendedAt: new Date("2026-06-24T00:00:00.000Z"),
    });

    try {
      const plan = await planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent({}),
        prisma: prisma as never,
      });

      // Suspension outranks group setup recovery: a suspended sender must not
      // receive any outbound message, matching the direct-thread planner.
      expect(plan.response).toMatchObject({
        ignored: true,
        ok: true,
        reason: "group-chat",
      });
      expect(plan.desiredSideEffects).toEqual([]);
      expect(prisma.hostedLinqLine.findFirst).not.toHaveBeenCalled();
      expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
      expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();

      const plannerDetails = info.mock.calls.find(
        ([message]) => message === "Hosted Linq webhook planner decision.",
      )?.[1];
      expect(plannerDetails).toMatchObject({
        reason: "suspended-member",
        routeStage: "new-group-admission-ignored",
      });
    } finally {
      info.mockRestore();
    }
  });

  it("logs provisioning unavailability when owner access disappears during route creation", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup(senderCore);
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: null,
    });
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue(null);

    try {
      const plan = await planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent({}),
        prisma: prisma as never,
      });

      expect(plan.response).toMatchObject({
        ignored: true,
        ok: true,
        reason: "group-chat",
      });
      expectManagedLineAuthorityLookup(prisma, "+15550000000");
      expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
      expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();

      const plannerDetails = info.mock.calls.find(
        ([message]) => message === "Hosted Linq webhook planner decision.",
      )?.[1];
      expect(plannerDetails).toMatchObject({
        existingMemberMatch: "phone-identity",
        reason: "provision-unavailable",
        responseReason: "group-chat",
        routeStage: "new-group-admission-ignored",
      });
    } finally {
      info.mockRestore();
    }
  });

  it("ignores group messages received on an unknown unmanaged recipient", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    mockSenderLookup(senderCore);

    try {
      const plan = await planHostedOnboardingLinqWebhook({
        event: buildLinqMessageReceivedEvent({
          recipient: "+15558889999",
        }),
        prisma: prisma as never,
      });

      expect(plan.response).toMatchObject({
        ignored: true,
        ok: true,
        reason: "group-chat-line-unavailable",
      });
      expectManagedLineAuthorityLookup(prisma, "+15558889999");
      expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
      expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();

      const plannerDetails = info.mock.calls.find(
        ([message]) => message === "Hosted Linq webhook planner decision.",
      )?.[1];
      expect(plannerDetails).toMatchObject({
        existingMemberMatch: "phone-identity",
        reason: "recipient-line-unmanaged",
        responseReason: "group-chat-line-unavailable",
        routeStage: "new-group-admission-ignored",
      });
    } finally {
      info.mockRestore();
    }
  });

  it("ignores echoed own messages in unbound group threads without provisioning", async () => {
    const prisma = createStatefulThreadRoutePrisma();

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({ isFromMe: true }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });
});

describe("Linq group chat concurrent provisioning race", () => {
  it("requires fresh preparation when ensure discovers a winner after the transaction route read", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    const recipient = "+15550000000";
    prisma.seedActiveManagedLinqLine(recipient);
    const accountLookupKey = requireTestPhoneLookupKey(recipient);
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey,
      channel: "linq",
      threadId: "chat_group_123",
    });
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_123",
    });
    if (!threadLookupKey || !threadIdentityLookupKey) {
      throw new Error("Expected Linq thread route lookup keys.");
    }
    const winnerDeliveryRoute = await prepareThreadDeliveryRouteForTest({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_winner",
      prisma: prisma as never,
      threadId: "chat_group_123",
    });
    prisma.seedThreadRoute({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_winner",
      deliveryRouteEncrypted: winnerDeliveryRoute.deliveryRouteEncrypted,
      ownerMemberId: "member_winner_456",
      threadIdentityLookupKey,
      threadLookupKey,
    });
    const statefulFindMany =
      prisma.hostedThreadRoute.findMany.getMockImplementation()!;
    let findManyCalls = 0;
    prisma.hostedThreadRoute.findMany.mockImplementation(async (args: never) => {
      findManyCalls += 1;
      return findManyCalls === 1 ? [] : statefulFindMany(args);
    });
    const losingPreparation = await prepareThreadContainerCreationForTest({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_loser",
      prisma: prisma as never,
      threadId: "chat_group_123",
    });
    preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx
      .mockResolvedValueOnce({
        ensure: {
          activationEventId: null,
          activationMailboxItemId: null,
          containerMemberId: "member_thread_container_winner",
          created: false,
          demotedMailboxConsumedAt: null,
        },
        kind: "ensured",
      });
    vi.mocked(
      memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber,
    ).mockResolvedValue(null);

    await expect(planHostedOnboardingLinqWebhookWithoutPreparedCrypto({
      event: buildLinqMessageReceivedEvent({
        eventId: "evt_group_late_winner_123",
        messageId: "msg_group_late_winner_123",
        recipient,
        sender: "+15551112222",
      }),
      pendingGroupParticipantMemberIds: ["member_winner_456"],
      preparedThreadContainerCreation: losingPreparation,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
      retryable: true,
    });

    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it.each([
    {
      description: "same-line unknown sender",
      recipient: "+15550000000",
      sender: "+15551112222",
    },
    {
      description: "cross-line unknown sender",
      recipient: "+15559999999",
      sender: "+15551112222",
    },
    {
      description: "cross-line unverified-email sender",
      recipient: "+15559999999",
      sender: "unverified-sender@example.com",
    },
  ] as const)(
    "converges a $description on the winner's canonical route",
    async ({ recipient, sender }) => {
      const prisma = createStatefulThreadRoutePrisma();
      prisma.seedActiveManagedLinqLine(recipient);
      const originalAccountLookupKey =
        requireTestPhoneLookupKey("+15550000000");
      const routeDeliveryRouteEncrypted = await sealHostedThreadDeliveryRoute({
        containerMemberId: "member_thread_container_999",
        route: buildHostedThreadDeliveryRoute({
          accountLookupKey: originalAccountLookupKey,
          channel: "linq",
          threadId: "chat_group_123",
        }),
      });
      const threadLookupKey = createHostedExternalThreadLookupKey({
        accountLookupKey: originalAccountLookupKey,
        channel: "linq",
        threadId: "chat_group_123",
      });
      const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
        channel: "linq",
        threadId: "chat_group_123",
      });
      if (!threadLookupKey || !threadIdentityLookupKey) {
        throw new Error("Expected test route lookup keys.");
      }
      prisma.seedThreadRoute({
        accountLookupKey: originalAccountLookupKey,
        channel: "linq",
        containerMemberId: "member_thread_container_999",
        deliveryRouteEncrypted: routeDeliveryRouteEncrypted,
        ownerMemberId: "member_winner_456",
        threadIdentityLookupKey,
        threadLookupKey,
      });

      // The first lookup ran before the winner committed. Every later read,
      // including the canonical delivery-route refresh, sees the winner.
      const statefulFindMany =
        prisma.hostedThreadRoute.findMany.getMockImplementation()!;
      let findManyCalls = 0;
      prisma.hostedThreadRoute.findMany.mockImplementation(async (args: never) => {
        findManyCalls += 1;
        return findManyCalls === 1 ? [] : statefulFindMany(args);
      });

      vi.mocked(
        memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber,
      ).mockResolvedValue(null);
      const existingMailboxItem = buildHostedMailboxItem({
        id: "mailbox_group_race_123",
        userId: "member_thread_container_999",
      });
      vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingMailboxItem)
        .mockResolvedValueOnce(null);
      vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx)
        .mockResolvedValueOnce({
          dedupeConflict: false,
          duplicate: false,
          inserted: true,
          item: existingMailboxItem,
        })
        .mockResolvedValueOnce({
          dedupeConflict: false,
          duplicate: false,
          inserted: true,
          item: buildHostedMailboxItem({
            id: "mailbox_group_after_race_123",
            userId: "member_thread_container_999",
          }),
        });
      vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState)
        .mockResolvedValue({
          dayUtc: new Date("2026-06-24T00:00:00.000Z"),
          inboundCount: 1,
          memberId: "member_thread_container_999",
          outboundCount: 0,
          quotaReplySentAt: null,
        } as Awaited<
          ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>
        >);
      vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValue({
        allowed: true,
        allowanceSource: "thread_container",
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 4_500_000n,
        memberId: "member_thread_container_999",
        periodEnd: new Date("2026-07-01T00:00:00.000Z"),
        periodStart: new Date("2026-06-01T00:00:00.000Z"),
        planResetAt: null,
        remainingUsdMicros: 4_500_000n,
        spentUsdMicros: 0n,
        usageCreditBalanceUsdMicros: 0n,
        usageCreditLedgerVersion: 0n,
      });
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx
        .mockResolvedValueOnce({
          kind: "owner_unavailable",
          pendingSetupResolution: "claim_raced",
        });

      const loserEvent = buildLinqMessageReceivedEvent({
        eventId: "evt_group_race_loser_123",
        messageId: "msg_group_race_loser_123",
        recipient,
        sender,
      });
      await expect(planHostedOnboardingLinqWebhook({
        event: loserEvent,
        pendingGroupParticipantMemberIds: ["member_winner_456"],
        prisma: prisma as never,
      })).rejects.toMatchObject({
        code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
        retryable: true,
      });
      expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
      const winnerDeliveryRoute = await prepareThreadDeliveryRouteForTest({
        accountLookupKey: requireTestPhoneLookupKey(recipient),
        channel: "linq",
        containerMemberId: "member_thread_container_999",
        prisma: prisma as never,
        threadId: "chat_group_123",
      });
      const firstPlan = await planHostedOnboardingLinqWebhookWithoutPreparedCrypto({
        event: loserEvent,
        pendingGroupParticipantMemberIds: ["member_winner_456"],
        preparedThreadDeliveryRoute: winnerDeliveryRoute,
        prisma: prisma as never,
      });
      const replayPlan = await planHostedOnboardingLinqWebhookWithoutPreparedCrypto({
        event: loserEvent,
        preparedThreadDeliveryRoute: winnerDeliveryRoute,
        prisma: prisma as never,
      });
      const laterPlan = await planHostedOnboardingLinqWebhookWithoutPreparedCrypto({
        event: buildLinqMessageReceivedEvent({
          eventId: "evt_group_after_race_123",
          messageId: "msg_group_after_race_123",
          recipient,
          sender,
        }),
        preparedThreadDeliveryRoute: winnerDeliveryRoute,
        prisma: prisma as never,
      });

      expect(firstPlan.response).toMatchObject({
        ignored: false,
        ok: true,
        reason: "wake-appended-thread-route",
      });
      expect(replayPlan.response).toMatchObject({
        duplicate: true,
        ignored: true,
        ok: true,
        reason: "duplicate-webhook-event",
      });
      expect(laterPlan.response).toMatchObject({
        ignored: false,
        ok: true,
        reason: "wake-appended-thread-route",
      });
      expect(readSingleWakeHandoff(firstPlan)).toMatchObject({
        eventId: "evt_group_race_loser_123",
        source: "linq",
        userId: "member_thread_container_999",
      });
      expect(firstPlan.linqReadReceiptRouteAuthority).toEqual({
        accountLookupKey: originalAccountLookupKey,
        channel: "linq",
        containerMemberId: "member_thread_container_999",
        threadId: "chat_group_123",
      });
      expect(laterPlan.linqReadReceiptRouteAuthority).toEqual(
        firstPlan.linqReadReceiptRouteAuthority,
      );

      const firstWake = readAppendedConversationWake(0);
      const laterWake = readAppendedConversationWake(1);
      expect(firstWake.message).toMatchObject({
        accountLookupKey: originalAccountLookupKey,
        linqMessage: {
          messageId: "msg_group_race_loser_123",
        },
        routeAuthority: firstPlan.linqReadReceiptRouteAuthority,
      });
      expect(laterWake.message).toMatchObject({
        accountLookupKey: originalAccountLookupKey,
        linqMessage: {
          messageId: "msg_group_after_race_123",
        },
        routeAuthority: firstPlan.linqReadReceiptRouteAuthority,
      });
      expect(readHostedConversationAssistantIdentifierSecret(firstWake)).toBe(
        originalAccountLookupKey,
      );
      expect(readHostedConversationAssistantIdentifierSecret(laterWake)).toBe(
        originalAccountLookupKey,
      );
      expect(
        preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
      ).toHaveBeenCalledTimes(1);
      expect(
        preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
      ).toHaveBeenCalledWith(expect.objectContaining({
        fallbackOwnerMemberId: null,
        senderMemberId: null,
      }));
      expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
      expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
      expect(prisma.hostedThreadRoute.create).not.toHaveBeenCalled();
      expect(prisma.hostedThreadRoute.update).not.toHaveBeenCalled();
      expect(
        prisma.readAccountLookupKeyProjection("member_thread_container_999"),
      ).toBe(originalAccountLookupKey);
    },
  );
});
