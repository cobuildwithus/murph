import { HostedBillingStatus, Prisma } from "@prisma/client";
import type { HostedMailboxItem } from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureHostedThreadContainerRouteTx,
} from "../src/lib/hosted-routing/thread-container-service";
import {
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
    preserveHostedAcceptedConversationAllowancePeriodTx: vi.fn(),
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
  vi.mocked(
    usageAllowance.preserveHostedAcceptedConversationAllowancePeriodTx,
  ).mockResolvedValue(new Date("2026-06-01T00:00:00.000Z"));
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
  omitIsGroup?: boolean;
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
        ...(input.omitIsGroup
          ? {}
          : { is_group: input.isGroup === undefined ? true : input.isGroup }),
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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createPrisma(input: {
  pendingParticipantAddition?: boolean;
  routeAccountPhone?: string;
  routeContainerMemberId?: string | null;
  routeContainerActive?: boolean;
  routeOwnerActive?: boolean;
  routeOwnerSponsored?: boolean;
  routeParticipantActive?: boolean;
  senderActive?: boolean;
} = {}) {
  const routeAccountLookupKey = createHostedPhoneLookupKey(
    input.routeAccountPhone ?? "+15550000000",
  );
  const routeContainerMemberId = input.routeContainerMemberId ?? null;
  const routeContainerActive = input.routeContainerActive ?? true;
  const routeOwnerActive = input.routeOwnerActive ?? true;
  const routeOwnerSponsored = input.routeOwnerSponsored ?? false;
  const routeParticipantActive = input.routeParticipantActive ?? false;
  const senderActive = input.senderActive ?? true;
  let pendingParticipantAddition = input.pendingParticipantAddition ?? false;
  let participantRosterAppliedOrdinal: bigint | null = null;
  let projectedParticipantMemberId = routeParticipantActive
    ? "member_active_participant_123"
    : null;
  const hostedThreadRoute = {
    findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (!routeContainerMemberId) {
        return [];
      }
      const lookupKeys = (where.threadLookupKey as { in?: string[] } | undefined)?.in ?? [];
      const threadIdentityLookupKey = where.threadIdentityLookupKey;
      const identityLookupKeys = typeof threadIdentityLookupKey === "string"
        ? [threadIdentityLookupKey]
        : (threadIdentityLookupKey as { in?: string[] } | undefined)?.in ?? [];
      const expected = createHostedExternalThreadLookupKey({
        accountLookupKey: routeAccountLookupKey,
        channel: "linq",
        threadId: "chat_group_123",
      });
      const expectedIdentity = createHostedExternalThreadIdentityLookupKey({
        channel: "linq",
        threadId: "chat_group_123",
      });
      if (
        (!expected || !lookupKeys.includes(expected))
        && (!expectedIdentity || !identityLookupKeys.includes(expectedIdentity))
      ) {
        return [];
      }
      return [
        {
          channel: "linq",
          container: {
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
          threadIdentityLookupKey: expectedIdentity,
          threadLookupKey: expected,
        },
      ];
    }),
    updateMany: vi.fn().mockImplementation(async ({ data, where }: {
      data: {
        participantRosterAppliedOrdinal?: bigint;
        pendingParticipantAddition?: boolean;
      };
      where: {
        containerMemberId?: string;
        pendingParticipantAddition?: boolean;
        threadIdentityLookupKey?: string | { in: string[] };
      };
    }) => {
      if (data.participantRosterAppliedOrdinal !== undefined) {
        if (
          routeContainerMemberId
          && where.containerMemberId === routeContainerMemberId
          && (
            typeof where.threadIdentityLookupKey === "string"
              ? where.threadIdentityLookupKey.length > 0
              : (where.threadIdentityLookupKey?.in.length ?? 0) > 0
          )
          && (
            participantRosterAppliedOrdinal === null
            || participantRosterAppliedOrdinal < data.participantRosterAppliedOrdinal
          )
        ) {
          participantRosterAppliedOrdinal = data.participantRosterAppliedOrdinal;
          return { count: 1 };
        }
        return { count: 0 };
      }
      if (
        where.pendingParticipantAddition === true
        && pendingParticipantAddition
        && data.pendingParticipantAddition === false
      ) {
        pendingParticipantAddition = false;
        return { count: 1 };
      }
      return { count: 0 };
    }),
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
        billingStatus: senderActive
          ? HostedBillingStatus.active
          : HostedBillingStatus.paused,
        suspendedAt: null,
        threadContainer: null,
      };
    }),
  };
  const hostedThreadContainerParticipant = {
    createMany: vi.fn().mockImplementation(async ({ data }: {
      data: Array<{ participantMemberId: string }>;
    }) => {
      const participant = data[0];
      if (participant && !projectedParticipantMemberId) {
        projectedParticipantMemberId = participant.participantMemberId;
        return { count: 1 };
      }
      return { count: 0 };
    }),
    findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      projectedParticipantMemberId
      && where.containerMemberId === routeContainerMemberId
      && where.removedAt === null
        ? { participantMemberId: projectedParticipantMemberId }
        : null
    ),
    updateMany: vi.fn().mockImplementation(async ({ data, where }: {
      data: { removedAt?: Date | null };
      where: {
        containerMemberId?: string;
        participantMemberId?: { notIn?: string[] };
      };
    }) => {
      const excludedMemberIds = where.participantMemberId?.notIn ?? [];
      if (
        data.removedAt instanceof Date
        && projectedParticipantMemberId
        && where.containerMemberId === routeContainerMemberId
        && !excludedMemberIds.includes(projectedParticipantMemberId)
      ) {
        projectedParticipantMemberId = null;
        return { count: 1 };
      }
      return { count: 0 };
    }),
    upsert: vi.fn().mockImplementation(async ({ create }: {
      create: { participantMemberId: string };
    }) => {
      projectedParticipantMemberId = create.participantMemberId;
      return {};
    }),
  };
  const hostedGroup = {
    findUnique: vi.fn().mockResolvedValue({ members: [] }),
  };
  const hostedWorkspace = {
    upsert: vi.fn().mockResolvedValue({}),
  };
  const hostedMailboxItem = {
    findUnique: vi.fn().mockResolvedValue({ acceptedAllowancePeriodStart: null }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ ordinal: 1n }]),
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const participantBefore = projectedParticipantMemberId;
      const participantRosterAppliedOrdinalBefore = participantRosterAppliedOrdinal;
      const pendingBefore = pendingParticipantAddition;
      try {
        return await callback(prisma);
      } catch (error) {
        projectedParticipantMemberId = participantBefore;
        participantRosterAppliedOrdinal = participantRosterAppliedOrdinalBefore;
        pendingParticipantAddition = pendingBefore;
        throw error;
      }
    }),
    hostedGroup,
    hostedMailboxItem,
    hostedMember,
    hostedMemberRouting,
    hostedThreadContainerParticipant,
    hostedThreadRoute,
    hostedWorkspace,
    readPendingParticipantAddition: () => pendingParticipantAddition,
    readProjectedParticipantMemberId: () => projectedParticipantMemberId,
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
      routes.push(data);
      return data;
    }),
    findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const lookupKeys = (where.threadLookupKey as { in?: string[] } | undefined)?.in ?? [];
      const identityLookupKeys =
        (where.threadIdentityLookupKey as { in?: string[] } | undefined)?.in ?? [];
      return routes
        .filter((route) =>
          route.channel === where.channel
          && (
            lookupKeys.includes(route.threadLookupKey)
            || identityLookupKeys.includes(route.threadIdentityLookupKey)
          ),
        )
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
    update: vi.fn().mockImplementation(async ({ data, where }: {
      data: {
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
      route.threadIdentityLookupKey = data.threadIdentityLookupKey;
      route.threadLookupKey = data.threadLookupKey;
      return route;
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
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
  const hostedMailboxItem = {
    findUnique: vi.fn().mockResolvedValue({ acceptedAllowancePeriodStart: null }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const executeRaw = vi.fn().mockResolvedValue(undefined);
  const hostedThreadContainerParticipant = {
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    findFirst: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi.fn().mockResolvedValue({}),
  };
  const prisma = {
    $executeRaw: executeRaw,
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    hostedMailboxItem,
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
    expect(prisma.hostedThreadRoute.create).toHaveBeenCalledTimes(1);

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

  it("consumes coalesced participant context on exactly one accepted group message", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    prisma.hostedThreadRoute.updateMany.mockResolvedValueOnce({ count: 1 });
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
          groupParticipantAdded: true,
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
    expect(prisma.hostedThreadRoute.updateMany).toHaveBeenCalledWith({
      data: { pendingParticipantAddition: false },
      where: expect.objectContaining({
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        pendingParticipantAddition: true,
      }),
    });
    expect(Array.from(prisma.$queryRaw.mock.calls[0]?.[0] ?? []).join("?"))
      .toContain("FOR UPDATE");
    expect(prisma.hostedThreadRoute.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mock.invocationCallOrder[0] ?? Infinity,
    );

    const secondPlan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({
        eventId: "evt_group_456",
        messageId: "msg_group_456",
      }),
      prisma: prisma as never,
    });
    expect(secondPlan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    const secondEnvelope = vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx)
      .mock.calls[1]?.[0].envelope;
    expect(secondEnvelope?.kind).toBe("conversation.message");
    if (!secondEnvelope || secondEnvelope.kind !== "conversation.message") {
      throw new Error("Expected a second conversation message envelope.");
    }
    expect(secondEnvelope.message).not.toHaveProperty("groupParticipantAdded");
    expect(prisma.hostedThreadRoute.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.updateMany).not.toHaveBeenCalled();
    expect(
      memberRoutingStore.demoteHostedMemberLinqGroupChatBindingsTx,
    ).toHaveBeenCalledWith({
      linqChatId: "chat_group_123",
      mailboxDedupeKey: "evt_group_123",
      prisma,
    });
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

  it("rolls participant context back after a late duplicate and consumes it on retry", async () => {
    const prisma = createPrisma({
      pendingParticipantAddition: true,
      routeContainerMemberId: "member_thread_container_123",
    });
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest).mockReturnValue(
      buildLinqMessageReceivedEvent({}) as never,
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

    await expect(handleHostedOnboardingLinqWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_MAILBOX_APPEND_RACE",
      httpStatus: 503,
      retryable: true,
    });

    expect(prisma.readPendingParticipantAddition()).toBe(true);
    expect(prisma.hostedThreadRoute.updateMany).toHaveBeenCalledWith({
      data: { pendingParticipantAddition: false },
      where: expect.objectContaining({
        pendingParticipantAddition: true,
      }),
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(prisma.readPendingParticipantAddition()).toBe(false);
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenNthCalledWith(2, {
      envelope: expect.objectContaining({
        message: expect.objectContaining({ groupParticipantAdded: true }),
      }),
      tx: prisma,
    });
  });

  it("preserves late-duplicate handling when no participant context was consumed", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
    });
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: true,
      inserted: false,
      item: buildHostedMailboxItem({
        id: "mailbox_existing",
        userId: "member_thread_container_123",
      }),
    });

    await expect(planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      prisma: prisma as never,
    })).resolves.toMatchObject({
      response: {
        ignored: false,
        ok: true,
        reason: "wake-appended-thread-route",
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
    expect(linqClient.getHostedLinqChatHandles).not.toHaveBeenCalled();
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
  });

  it("uses the existing Linq daily quota gate for routed thread traffic", async () => {
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
    expect(prisma.hostedThreadRoute.updateMany).not.toHaveBeenCalled();
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
    expect(prisma.hostedThreadRoute.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.createMany).not.toHaveBeenCalled();
    expect(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).not.toHaveBeenCalled();
  });

  it.each([
    { event: buildLinqMessageReceivedEvent({}), name: "explicitly grouped" },
    { event: buildLinqMessageReceivedEvent({ isGroup: null }), name: "null-attested" },
    { event: buildLinqMessageReceivedEvent({ omitIsGroup: true }), name: "unattested" },
  ])("requests a current roster without writes for $name traffic when the route owner is inactive", async ({
    event,
  }) => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
    });
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).mockResolvedValue(null);

    const plan = await planHostedOnboardingLinqWebhook({
      event,
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "current-group-roster-required",
    });
    expect(plan.currentGroupRosterRequest).toEqual({
      chatId: "chat_group_123",
      containerMemberId: "member_thread_container_123",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.updateMany).not.toHaveBeenCalled();
  });

  it("routes an owner-inactive group when a different current participant has active access", async () => {
    const prisma = createPrisma({
      pendingParticipantAddition: true,
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
    });
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
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest).mockReturnValue(
      buildLinqMessageReceivedEvent({ isGroup: false }) as never,
    );
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockImplementation(async ({ phoneNumber }) => phoneNumber === "+15552223333"
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
          } as Awaited<ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>>
        : null);
    vi.mocked(linqClient.getHostedLinqChatHandles).mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      return [
        { handle: "+15550000000", isMe: true, status: "active" },
        { handle: "+15551112222", isMe: false, status: "active" },
        { handle: "+15552223333", isMe: false, status: "active" },
      ];
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(linqClient.getHostedLinqChatHandles).toHaveBeenCalledTimes(1);
    expect(prisma.hostedThreadRoute.updateMany).toHaveBeenCalledWith({
      data: { participantRosterAppliedOrdinal: 1n },
      where: expect.objectContaining({
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({
          channel: "linq",
          threadId: "chat_group_123",
        }),
      }),
    });
    expect(prisma.hostedThreadContainerParticipant.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        containerMemberId: "member_thread_container_123",
        participantMemberId: "member_active_participant_123",
        removedAt: null,
      })],
      skipDuplicates: true,
    });
    expect(prisma.readPendingParticipantAddition()).toBe(false);
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        message: expect.objectContaining({
          groupParticipantAdded: true,
          linqMessage: expect.objectContaining({ threadIsDirect: false }),
        }),
        userId: "member_thread_container_123",
      }),
      tx: prisma,
    });
  });

  it("retries a superseded authorized roster read and appends the webhook exactly once", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
    });
    const activeParticipantPhone = "+15552223333";
    const activeRoster = [
      { handle: "+15550000000", isMe: true, status: "active" },
      { handle: activeParticipantPhone, isMe: false, status: "active" },
    ];
    const preAdditionRoster = [
      { handle: "+15550000000", isMe: true, status: "active" },
    ];
    const delayedAuthorizedRoster = createDeferred<typeof activeRoster>();
    const authorizedEvent = buildLinqMessageReceivedEvent({
      eventId: "evt_authorized_overlap",
      messageId: "msg_authorized_overlap",
      sender: activeParticipantPhone,
    });
    const overlappingEvent = buildLinqMessageReceivedEvent({
      eventId: "evt_pre_addition_overlap",
      messageId: "msg_pre_addition_overlap",
      sender: "+15554445555",
    });
    const appendedMailboxItem = buildHostedMailboxItem({
      id: "mailbox_authorized_overlap",
      userId: "member_thread_container_123",
    });

    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
      .mockReturnValueOnce(authorizedEvent as never)
      .mockReturnValueOnce(overlappingEvent as never)
      .mockReturnValueOnce(authorizedEvent as never)
      .mockReturnValueOnce(authorizedEvent as never);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ ordinal: 1n }])
      .mockResolvedValueOnce([{ ordinal: 2n }])
      .mockResolvedValueOnce([{ ordinal: 3n }]);
    vi.mocked(linqClient.getHostedLinqChatHandles)
      .mockImplementationOnce(() => delayedAuthorizedRoster.promise)
      .mockResolvedValueOnce(preAdditionRoster)
      .mockResolvedValueOnce(activeRoster);
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockImplementation(async ({ phoneNumber }) => phoneNumber === activeParticipantPhone
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
          } as Awaited<ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>>
        : null);
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockResolvedValue({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: appendedMailboxItem,
    });

    const delayedAuthorizedWebhook = handleHostedOnboardingLinqWebhook({
      prisma: prisma as never,
      rawBody: "authorized-overlap",
      signature: null,
      timestamp: null,
    });
    await vi.waitFor(() => {
      expect(linqClient.getHostedLinqChatHandles).toHaveBeenCalledTimes(1);
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma: prisma as never,
      rawBody: "pre-addition-overlap",
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "thread-container-inactive",
    });

    delayedAuthorizedRoster.resolve(activeRoster);
    await expect(delayedAuthorizedWebhook).rejects.toMatchObject({
      code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();

    await expect(handleHostedOnboardingLinqWebhook({
      prisma: prisma as never,
      rawBody: "authorized-retry",
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(linqClient.getHostedLinqChatHandles).toHaveBeenCalledTimes(3);

    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(
      appendedMailboxItem,
    );
    await expect(handleHostedOnboardingLinqWebhook({
      prisma: prisma as never,
      rawBody: "authorized-duplicate",
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      duplicate: true,
      ignored: true,
      ok: true,
      reason: "duplicate-webhook-event",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(linqClient.getHostedLinqChatHandles).toHaveBeenCalledTimes(3);
  });

  it("does not request a participant roster for an explicitly attested direct chat", async () => {
    const prisma = createPrisma({
      pendingParticipantAddition: true,
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
    });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({ isGroup: false }),
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "thread-container-inactive",
    });
    expect(prisma.hostedThreadContainerParticipant.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedThreadRoute.updateMany).not.toHaveBeenCalled();
    expect(prisma.readPendingParticipantAddition()).toBe(true);
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(plan.currentGroupRosterRequest).toBeUndefined();
  });

  it("wakes a completed duplicate after access changes without fetching a roster", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
    });
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest).mockReturnValue(
      buildLinqMessageReceivedEvent({}) as never,
    );
    vi.mocked(linqClient.getHostedLinqChatHandles).mockRejectedValue(
      new Error("duplicate recovery must not read the roster"),
    );
    vi.mocked(mailboxStore.readHostedMailboxItemByDedupeKey).mockResolvedValueOnce(
      buildHostedMailboxItem({
        id: "mailbox_existing",
        userId: "member_thread_container_123",
      }),
    );

    const response = await handleHostedOnboardingLinqWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      duplicate: true,
      ignored: true,
      reason: "duplicate-webhook-event",
    });
    expect(linqClient.getHostedLinqChatHandles).not.toHaveBeenCalled();
    expect(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.createMany).not.toHaveBeenCalled();
    expect(signalRuntime.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_thread_container_123",
      mailboxItemId: "mailbox_existing",
    });
  });

  it("denies a delayed callback from the active historical sponsor excluded by the current roster", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
      routeParticipantActive: true,
    });
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest).mockReturnValue(
      buildLinqMessageReceivedEvent({}) as never,
    );
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).mockResolvedValue({
      core: {
        billingStatus: HostedBillingStatus.active,
        createdAt: new Date("2026-06-24T00:00:00.000Z"),
        id: "member_route_participant_123",
        suspendedAt: null,
        updatedAt: new Date("2026-06-24T00:00:00.000Z"),
      },
      identity: {},
      matchedBy: "phoneNumber",
    } as Awaited<ReturnType<typeof memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber>>);
    vi.mocked(linqClient.getHostedLinqChatHandles).mockResolvedValue([
      { handle: "+15550000000", isMe: true, status: "active" },
    ]);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "thread-container-inactive",
    });
    expect(prisma.hostedThreadContainerParticipant.updateMany).toHaveBeenCalledWith({
      data: { removedAt: expect.any(Date) },
      where: expect.objectContaining({
        containerMemberId: "member_thread_container_123",
        removedAt: null,
      }),
    });
    expect(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.createMany).not.toHaveBeenCalled();
    expect(prisma.readProjectedParticipantMemberId()).toBeNull();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(signalRuntime.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("routes a bound group thread when any current participant has active access", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
      routeParticipantActive: true,
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
    expect(prisma.hostedThreadContainerParticipant.findFirst).toHaveBeenCalledWith({
      select: {
        participantMemberId: true,
      },
      where: expect.objectContaining({
        containerMemberId: "member_thread_container_123",
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

  it("returns a retryable error when the required current roster cannot be fetched", async () => {
    const prisma = createPrisma({
      routeContainerMemberId: "member_thread_container_123",
      routeOwnerActive: false,
    });
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest).mockReturnValue(
      buildLinqMessageReceivedEvent({}) as never,
    );
    vi.mocked(linqClient.getHostedLinqChatHandles).mockRejectedValue(
      new Error("linq unavailable"),
    );

    await expect(handleHostedOnboardingLinqWebhook({
      prisma: prisma as never,
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.hostedThreadContainerParticipant.createMany).not.toHaveBeenCalled();
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
    expect(prisma.hostedThreadRoute.updateMany).not.toHaveBeenCalled();
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
        expect(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).not.toHaveBeenCalled();
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
    expect(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber).not.toHaveBeenCalled();
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
      limitUsdMicros: 4_500_000n,
      memberId: "member_thread_container_123",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
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
    expect(containerCreate.data.monthlyUsageLimitUsdMicros).toBe(4_500_000n);
    expect(prisma.hostedThreadRoute.create).toHaveBeenCalledTimes(1);
    expect(readSingleWakeHandoff(plan)).toMatchObject({
      eventId: "evt_group_123",
      linqChatId: "chat_group_123",
      source: "linq",
      userId: containerCreate.data.memberId,
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenNthCalledWith(1, {
      envelope: expect.objectContaining({
        eventId: expect.stringMatching(/^member\.activated:thread-container:linq:/u),
        kind: "member.activated",
        memberChannels: {
          email: false,
          linq: true,
          telegram: false,
        },
        signupWelcome: null,
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

  it("does not fetch or persist a roster while provisioning under an active owner", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    vi.mocked(prismaModule.getPrisma).mockReturnValue(prisma as never);
    vi.mocked(linqModule.verifyAndParseHostedLinqWebhookRequest)
      .mockReturnValue(buildLinqMessageReceivedEvent({}) as never);
    mockSenderLookup(senderCore);
    mockSuccessfulGroupProvision({ prisma, senderCore });

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
    expect(linqClient.getHostedLinqChatHandles).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainerParticipant.updateMany).not.toHaveBeenCalled();
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
