import { HostedBillingStatus, Prisma } from "@prisma/client";
import type { HostedMailboxItem } from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  appendHostedLinqThreadRouteReactionContextTx,
  consumeHostedLinqThreadRoutePendingContextTx,
  markHostedLinqThreadRouteParticipantAdditionPendingTx,
  readHostedThreadRouteByThreadIdentity,
} from "../src/lib/hosted-routing/thread-route-store";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "../src/lib/hosted-onboarding/contact-privacy";
import {
  planHostedOnboardingLinqWebhook,
} from "../src/lib/hosted-onboarding/webhook-provider-linq";
import {
  handleHostedOnboardingLinqWebhook,
} from "../src/lib/hosted-onboarding/webhook-service";

const secureBoxMocks = vi.hoisted(() => ({
  openHostedUserSecureBoxString: vi.fn(),
  sealHostedUserSecureBoxString: vi.fn(),
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
    readHostedMailboxItemByDedupeKey: vi.fn(),
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
    provisionHostedCryptoDomainRootsForUserTx: vi.fn(),
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
  vi.mocked(prismaModule.getPrisma).mockReset();
  vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest).mockReset();
  vi.mocked(linqClient.getHostedLinqChatHandles).mockReset();
  vi.mocked(linqClient.getHostedLinqChatHandles).mockResolvedValue([]);
  vi.mocked(linqClient.getHostedLinqChatSummary).mockReset();
  vi.mocked(memberRoutingStore.demoteHostedMemberLinqGroupChatBindingsTx).mockReset();
  vi.mocked(memberRoutingStore.demoteHostedMemberLinqGroupChatBindingsTx).mockResolvedValue({
    mailboxConsumedAt: null,
  });
  vi.mocked(linqClient.getHostedLinqChatSummary).mockResolvedValue({
    handles: [],
    isGroup: null,
  });
  vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockReset();
  vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockReset();
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

function buildLinqMessageReceivedEvent(input: {
  chatId?: string;
  eventId?: string;
  isFromMe?: boolean;
  isGroup?: boolean | null;
  messageId?: string;
  recipient?: string;
  sender?: string;
  service?: string;
  text?: string;
}) {
  const recipient = input.recipient ?? "+15550000000";
  const service = input.service ?? "iMessage";
  return {
    api_version: "2026-01-01",
    created_at: "2026-06-24T12:00:00.000Z",
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
        parts: input.text === ""
          ? []
          : [
              {
                type: "text",
                value: input.text ?? "How did we sleep?",
              },
            ],
      },
      preferred_service: service,
      recipient_phone: recipient,
      received_at: "2026-06-24T12:00:00.000Z",
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

function createPrisma(input: {
  pendingGroupReactionContextEncrypted?: string | null;
  pendingParticipantAddition?: boolean;
  routeAccountPhone?: string;
  routeContainerMemberId?: string | null;
  routeDeliveryRouteEncrypted?: string | null;
  routeContainerActive?: boolean;
  routeOwnerActive?: boolean;
  routeOwnerSponsored?: boolean;
  routeParticipantAccessRequiresRosterRefresh?: boolean;
  routeParticipantActive?: boolean;
  routeParticipantHandleLookupKey?: string;
} = {}) {
  const routeAccountLookupKey = createHostedPhoneLookupKey(
    input.routeAccountPhone ?? "+15550000000",
  );
  const routeContainerMemberId = input.routeContainerMemberId ?? null;
  const routeContainerActive = input.routeContainerActive ?? true;
  const routeOwnerActive = input.routeOwnerActive ?? true;
  const routeOwnerSponsored = input.routeOwnerSponsored ?? false;
  const routeParticipantAccessRequiresRosterRefresh =
    input.routeParticipantAccessRequiresRosterRefresh ?? false;
  const routeParticipantActive = input.routeParticipantActive ?? false;
  let routeParticipantLeaseRefreshed = false;
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
        suspendedAt: null,
        threadContainer: null,
      };
    }),
  };
  const hostedThreadContainerParticipant = {
    findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      routeParticipantActive
      && (
        !routeParticipantAccessRequiresRosterRefresh
        || routeParticipantLeaseRefreshed
      )
      && where.containerMemberId === routeContainerMemberId
      && where.removedAt === null
        ? { participantMemberId: "member_active_participant_123" }
        : null
    ),
    findMany: vi.fn().mockImplementation(async () =>
      routeParticipantActive
        ? [{
            handleLookupKey: input.routeParticipantHandleLookupKey
              ?? createHostedPhoneLookupKey("+15552223333"),
            participantMemberId: "member_active_participant_123",
          }]
        : []
    ),
    updateMany: vi.fn().mockImplementation(async ({ where }: {
      where: { participantMemberId?: string };
    }) => {
      if (where.participantMemberId === "member_active_participant_123") {
        routeParticipantLeaseRefreshed = true;
      }
      return { count: 1 };
    }),
  };
  const hostedWorkspace = {
    upsert: vi.fn().mockResolvedValue({}),
  };
  const hostedMailboxItem = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    const pendingBefore = pendingParticipantAddition;
    const deliveryRouteBefore = deliveryRouteEncrypted;
    const reactionContextBefore = pendingGroupReactionContextEncrypted;
    try {
      return await callback(prisma);
    } catch (error) {
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
    hostedMailboxItem,
    hostedMember,
    hostedMemberRouting,
    hostedThreadContainer,
    hostedThreadContainerParticipant,
    hostedThreadRoute,
    hostedWorkspace,
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
    hostedMember,
    hostedMemberRouting,
    hostedThreadContainer,
    hostedThreadContainerParticipant,
    hostedThreadRoute,
    hostedWorkspace,
    seedThreadRoute(input: {
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
    readPendingGroupReactionContextEncrypted(containerMemberId: string) {
      return routes.find((route) =>
        route.containerMemberId === containerMemberId
      )?.pendingGroupReactionContextEncrypted ?? null;
    },
  };
  return prisma;
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

async function runRoutedMessageTransaction(
  prisma: ReturnType<typeof createPrisma>,
  event: ReturnType<typeof buildLinqMessageReceivedEvent>,
): Promise<unknown> {
  return prisma.$transaction((transaction) => planHostedOnboardingLinqWebhook({
    event,
    prisma: transaction as never,
  }));
}

function readAppendedConversationMessage(index: number) {
  const envelope = vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx)
    .mock.calls[index]?.[0].envelope;
  expect(envelope?.kind).toBe("conversation.message");
  if (!envelope || envelope.kind !== "conversation.message") {
    throw new Error("Expected a conversation message envelope.");
  }
  return envelope.message;
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

      await expect(
        ensureHostedThreadContainerRouteTx({
          accountLookupKey: currentAccountLookupKey,
          accountLookupKeys: createHostedPhoneLookupKeyReadCandidates("+15550000000"),
          channel: "linq",
          occurredAt: new Date("2026-06-24T00:00:00.000Z"),
          ownerMemberId: "member_owner_123",
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
      expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.hostedThreadRoute.findMany.mock.invocationCallOrder[0]!,
      );
      expect(prisma.hostedThreadRoute.update).toHaveBeenCalledWith({
        data: {
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

    const refreshed = await refreshHostedThreadContainerDeliveryRouteTx({
      accountLookupKey,
      accountLookupKeys: createHostedPhoneLookupKeyReadCandidates("+15550000000"),
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
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(prisma.hostedThreadRoute.update).toHaveBeenCalledWith({
      data: {
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

    await ensureHostedThreadContainerRouteTx({
      accountLookupKey,
      channel: "linq",
      containerMemberId: "member_thread_container_123",
      occurredAt: new Date("2026-06-24T00:00:00.000Z"),
      ownerMemberId: "member_owner_123",
      prisma: prisma as never,
      threadId: "chat_group_123",
    });

    expect(prisma.hostedThreadRoute.update).toHaveBeenCalledWith({
      data: {
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
    vi.mocked(domainRootStore.provisionHostedCryptoDomainRootsForUserTx)
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

    await expect(
      ensureHostedThreadContainerRouteTx({
        accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        occurredAt: new Date("2026-06-24T00:00:00.000Z"),
        ownerMemberId: "member_owner_123",
        prisma: prisma as unknown as Prisma.TransactionClient,
        threadId: "chat_group_123",
      }),
    ).resolves.toMatchObject({
      activationMailboxItemId: "mailbox_activation_123",
      containerMemberId: "member_thread_container_123",
      created: true,
    });

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
    expect(domainRootStore.provisionHostedCryptoDomainRootsForUserTx).toHaveBeenCalledTimes(1);
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

  it("still ignores unbound Linq group threads when the sender is not a member", async () => {
    const prisma = createPrisma();
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockResolvedValue(null);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(memberRoutingStore.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(hostedMemberStore.createHostedMember).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

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
    expect(prisma.hostedThreadContainerParticipant.findFirst).not.toHaveBeenCalled();
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
    expect(prisma.hostedThreadContainerParticipant.findFirst).not.toHaveBeenCalled();
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
    expect(prisma.hostedThreadContainerParticipant.findFirst).toHaveBeenCalledWith({
      select: {
        participantMemberId: true,
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

  it("refreshes a quiet active participant from the authoritative roster before denying traffic", async () => {
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
        ignored: false,
        ok: true,
        reason: "wake-appended-thread-route",
      });
      expect(linqClient.getHostedLinqChatHandles).toHaveBeenCalledWith({
        chatId: "chat_group_123",
        timeoutMs: 1_500,
      });
      expect(prisma.hostedThreadContainerParticipant.findMany).toHaveBeenCalledWith({
        orderBy: { lastSeenAt: "desc" },
        select: {
          handleLookupKey: true,
          participantMemberId: true,
        },
        where: expect.objectContaining({
          containerMemberId: "member_thread_container_123",
          participant: expect.any(Object),
          removedAt: null,
        }),
      });
      expect(prisma.hostedThreadContainerParticipant.updateMany).toHaveBeenCalledWith({
        data: { lastSeenAt: expect.any(Date) },
        where: {
          containerMemberId: "member_thread_container_123",
          lastSeenAt: { lt: expect.any(Date) },
          participantMemberId: "member_active_participant_123",
          removedAt: null,
        },
      });
    } finally {
      restoreKeyring();
    }
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

  function mockAllowedThreadUsage(): void {
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValue({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
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
    input.prisma.hostedMember.findUnique.mockImplementation(async () => ({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
      threadContainer: null,
    }));
    mockHomeLinqRoute("+15550000000");
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue(input.senderCore);
    vi.mocked(hostedMemberStore.createHostedMember).mockImplementation(async (createInput) => ({
      ...input.senderCore,
      id: createInput.memberId,
    }));
    vi.mocked(domainRootStore.provisionHostedCryptoDomainRootsForUserTx)
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

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
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
  ])("provisions a thread container and routes the first group message from the home-line $kind member", async ({ senderAccess }) => {
    const prisma = createStatefulThreadRoutePrisma();
    mockSenderLookup(senderCore);
    prisma.hostedMember.findUnique.mockImplementation(async () => ({
      ...senderAccess,
      suspendedAt: null,
      threadContainer: null,
    }));
    mockHomeLinqRoute("+15550000000");
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue(senderCore);
    vi.mocked(hostedMemberStore.createHostedMember).mockImplementation(async (input) => ({
      ...senderCore,
      id: input.memberId,
    }));
    vi.mocked(domainRootStore.provisionHostedCryptoDomainRootsForUserTx)
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
      .mockImplementation(async ({ phoneNumber }) => {
        if (phoneNumber === "+15551112222") {
          return {
            core: senderCore,
            identity: {},
            matchedBy: "phoneNumber",
          } as Awaited<
            ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>
          >;
        }
        if (phoneNumber === "+15552223333") {
          return {
            core: {
              ...senderCore,
              id: "member_participant_123",
            },
            identity: {},
            matchedBy: "phoneNumber",
          } as Awaited<
            ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>
          >;
        }
        return null;
      });
    mockSuccessfulGroupProvision({ prisma, senderCore });
    vi.mocked(linqClient.getHostedLinqChatHandles).mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      return [
        { handle: "+15550000000", isMe: true, status: "active" },
        { handle: "+15551112222", isMe: false, status: "active" },
        { handle: "+15552223333", isMe: false, status: "active" },
      ];
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
    expect(linqClient.getHostedLinqChatHandles).toHaveBeenCalledWith({
      chatId: "chat_group_123",
    });
    expect(linqClient.getHostedLinqChatSummary).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          containerMemberId: containerCreate.data.memberId,
          participantMemberId: "member_participant_123",
          removedAt: null,
        }),
        where: {
          containerMemberId_participantMemberId: {
            containerMemberId: containerCreate.data.memberId,
            participantMemberId: "member_participant_123",
          },
        },
      }),
    );
    expect(prisma.hostedThreadContainerParticipant.updateMany).toHaveBeenCalledWith({
      data: {
        removedAt: expect.any(Date),
      },
      where: {
        containerMemberId: containerCreate.data.memberId,
        participantMemberId: {
          notIn: ["member_owner_123", "member_participant_123"],
        },
        removedAt: null,
      },
    });
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

  it("still provisions and hands off the first group message when roster fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
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
    vi.mocked(linqClient.getHostedLinqChatHandles).mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      throw new Error("linq unavailable");
    });

    try {
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
      expect(prisma.hostedThreadContainerParticipant.upsert).not.toHaveBeenCalled();
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
      expect(warn).toHaveBeenCalledWith(
        "Hosted thread-container participant reconcile skipped.",
        expect.objectContaining({
          reason: "reconcile_failed",
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("does not auto-provision group threads from a pending (uncommitted) route", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    mockSenderLookup(senderCore);
    // Ops re-invite in flight: pending chat on the group's line, no committed
    // home route. Group auto-provisioning must fail closed until promotion.
    vi.mocked(memberRoutingStore.readHostedMemberRoutingState).mockResolvedValue({
      linqChatId: null,
      linqRecipientPhone: null,
      pendingLinqChatId: "chat_pending_123",
      pendingLinqRecipientPhone: "+15550000000",
    } as Awaited<ReturnType<typeof memberRoutingStore.readHostedMemberRoutingState>>);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    // The authority gate ran (not an earlier bail) and failed closed.
    expect(memberRoutingStore.readHostedMemberRoutingState).toHaveBeenCalledTimes(1);
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("ignores group messages from senders without hosted member identity", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    mockSenderLookup(null);

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
      memberRoutingStore.demoteHostedMemberLinqGroupChatBindingsTx,
    ).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("ignores group messages from members without active access", async () => {
    const prisma = createStatefulThreadRoutePrisma();
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

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(memberRoutingStore.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("ignores group messages from suspended members", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    mockSenderLookup({
      ...senderCore,
      suspendedAt: new Date("2026-06-24T00:00:00.000Z"),
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
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("ignores group messages when the recipient line is not the sender's home line", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    mockSenderLookup(senderCore);
    mockHomeLinqRoute("+15559999999");

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("ignores group messages when the sender has no home Linq route yet", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    mockSenderLookup(senderCore);
    mockHomeLinqRoute(null);

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
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
  it("routes a concurrent-loser first group message into the winner's container", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    const senderCore = {
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-06-24T00:00:00.000Z"),
      id: "member_owner_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-24T00:00:00.000Z"),
    };
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
    if (!threadLookupKey || !threadIdentityLookupKey) {
      throw new Error("Expected test lookup keys.");
    }
    // Another active member on the same pooled line already won the provisioning
    // race and committed this route while our webhook was in flight.
    prisma.seedThreadRoute({
      channel: "linq",
      containerMemberId: "member_thread_container_999",
      ownerMemberId: "member_winner_456",
      threadIdentityLookupKey,
      threadLookupKey,
    });
    // The planner's initial route lookup ran before the winner committed, so
    // it misses; every later read observes the committed route.
    const statefulFindMany = prisma.hostedThreadRoute.findMany.getMockImplementation()!;
    let findManyCalls = 0;
    prisma.hostedThreadRoute.findMany.mockImplementation(async (args: never) => {
      findManyCalls += 1;
      if (findManyCalls <= 1) {
        return [];
      }
      return statefulFindMany(args);
    });
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).mockResolvedValue({
      core: senderCore,
      identity: {},
      matchedBy: "phoneNumber",
    } as Awaited<ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>>);
    vi.mocked(memberRoutingStore.readHostedMemberRoutingState).mockResolvedValue({
      linqChatId: "chat_home_123",
      linqRecipientPhone: "+15550000000",
    } as Awaited<ReturnType<typeof memberRoutingStore.readHostedMemberRoutingState>>);
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue(senderCore);
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValue(null);
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: buildHostedMailboxItem({
        id: "mailbox_group_race_123",
        userId: "member_thread_container_999",
      }),
    });
    vi.mocked(linqDailyState.incrementHostedLinqInboundDailyState).mockResolvedValueOnce({
      dayUtc: new Date("2026-06-24T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_thread_container_999",
      outboundCount: 0,
      quotaReplySentAt: null,
    } as Awaited<ReturnType<typeof linqDailyState.incrementHostedLinqInboundDailyState>>);
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValueOnce({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_999",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
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
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(readSingleWakeHandoff(plan)).toMatchObject({
      eventId: "evt_group_123",
      source: "linq",
      userId: "member_thread_container_999",
    });
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(prisma.hostedThreadRoute.create).not.toHaveBeenCalled();
  });
});
