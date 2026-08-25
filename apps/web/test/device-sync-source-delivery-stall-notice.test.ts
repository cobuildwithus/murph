import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeWithPreparedCryptoTx: vi.fn(),
  getPrisma: vi.fn(),
  hasHostedLinqInboundWithinDays: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  findDeviceConnectionSource: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  readHostedSourceNoDataOutreachPolicy: vi.fn(),
  resolveHostedAssistantNotificationDestination: vi.fn(),
  runWithPreparedHostedMailboxItemAppendCrypto: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeWithPreparedCryptoTx:
    mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
  runWithPreparedHostedMailboxItemAppendCrypto:
    mocks.runWithPreparedHostedMailboxItemAppendCrypto,
}));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  hasHostedRuntimeActiveAccess: mocks.hasHostedRuntimeActiveAccess,
}));
vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", () => ({
  hasHostedLinqInboundWithinDays: mocks.hasHostedLinqInboundWithinDays,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  resolveHostedAssistantNotificationDestination:
    mocks.resolveHostedAssistantNotificationDestination,
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/device-sync/source-no-data-outreach-policy", () => ({
  readHostedSourceNoDataOutreachPolicy:
    mocks.readHostedSourceNoDataOutreachPolicy,
}));

import {
  buildHostedSourceDeliveryStallNoticeKey,
  materializeHostedSourceDeliveryStallNotice,
  resolveHostedSourceDeliveryStallNoticeCandidate,
} from "@/src/lib/device-sync/source-delivery-stall-notice";

const BASE_INPUT = {
  connectionId: "connection-1",
  lastDataAt: "2026-08-20T00:00:00.000Z",
  lifecycleEpoch: 4,
  now: "2026-08-25T00:00:00.000Z",
  sourceId: "dcs_abcdefghijklmnop",
  sourceInstanceKey: "source-1",
  sourceProviderSlug: "garmin",
  status: "connected" as const,
};

const MAILBOX_ITEM = {
  consumedAt: null,
  id: "mailbox-1",
  lane: "system",
  laneSeq: "7",
  userId: "member-1",
};

const DIRECT_LINQ_DESTINATION = {
  conversationShape: "direct-member",
  externalThreadRouteAuthority: null,
  route: {
    actorId: null,
    channel: "linq",
    delivery: { kind: "thread", target: "direct-thread" },
    identityId: "identity-1",
    threadId: "thread-1",
    threadIsDirect: true,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  const tx = {
    deviceConnectionSource: {
      findUnique: vi.fn().mockResolvedValue({
        id: BASE_INPUT.sourceId,
        connection: { status: "active", userId: "member-1" },
        lastDataAt: new Date(BASE_INPUT.lastDataAt),
        lifecycleEpoch: BASE_INPUT.lifecycleEpoch,
        sourceProviderSlug: BASE_INPUT.sourceProviderSlug,
        status: BASE_INPUT.status,
      }),
    },
  };
  tx.deviceConnectionSource.findUnique = mocks.findDeviceConnectionSource;
  mocks.getPrisma.mockReturnValue({
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  });
  mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
  mocks.findDeviceConnectionSource.mockResolvedValue({
    connection: { status: "active", userId: "member-1" },
    id: BASE_INPUT.sourceId,
    lastDataAt: new Date(BASE_INPUT.lastDataAt),
    lifecycleEpoch: BASE_INPUT.lifecycleEpoch,
    sourceProviderSlug: BASE_INPUT.sourceProviderSlug,
    status: BASE_INPUT.status,
  });
  mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
  mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(true);
  mocks.readHostedSourceNoDataOutreachPolicy.mockResolvedValue({
    afterDays: 5,
    enabled: true,
    setting: "default",
    silentHours: 120,
  });
  mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue(
    DIRECT_LINQ_DESTINATION,
  );
  mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx.mockResolvedValue({
    item: MAILBOX_ITEM,
  });
  mocks.runWithPreparedHostedMailboxItemAppendCrypto.mockImplementation(
    (input: { append: (prepared: Record<string, never>) => Promise<unknown> }) =>
      input.append({}),
  );
  mocks.signalHostedMailboxAppendRuntime.mockResolvedValue(undefined);
});

describe("hosted source delivery-stall notice identity", () => {
  it("derives a candidate only for an eligible provider silence episode", () => {
    expect(resolveHostedSourceDeliveryStallNoticeCandidate(BASE_INPUT)).toEqual({
      connectionId: "connection-1",
      lastDataAt: "2026-08-20T00:00:00.000Z",
      lifecycleEpoch: 4,
      sourceId: "dcs_abcdefghijklmnop",
      sourceInstanceKey: "source-1",
      sourceProviderSlug: "garmin",
    });
    expect(resolveHostedSourceDeliveryStallNoticeCandidate({
      ...BASE_INPUT,
      now: "2026-08-24T23:59:59.999Z",
    })).toBeNull();
    expect(resolveHostedSourceDeliveryStallNoticeCandidate({
      ...BASE_INPUT,
      sourceProviderSlug: "oura",
    })).toBeNull();
    expect(resolveHostedSourceDeliveryStallNoticeCandidate({
      ...BASE_INPUT,
      status: "disconnected",
    })).toBeNull();
  });

  it("keeps one key per silence episode and rotates it for a new delivery or lifecycle", () => {
    const candidate = resolveHostedSourceDeliveryStallNoticeCandidate(BASE_INPUT);
    expect(candidate).not.toBeNull();
    if (!candidate) {
      return;
    }
    const key = buildHostedSourceDeliveryStallNoticeKey(candidate);
    expect(buildHostedSourceDeliveryStallNoticeKey(candidate)).toBe(key);
    expect(buildHostedSourceDeliveryStallNoticeKey({
      ...candidate,
      lastDataAt: "2026-08-20T01:00:00.000Z",
    })).not.toBe(key);
    expect(buildHostedSourceDeliveryStallNoticeKey({
      ...candidate,
      lifecycleEpoch: 5,
    })).not.toBe(key);
  });
});

describe("hosted source delivery-stall notice materialization", () => {
  it("queues exact direct-thread copy through the existing durable mailbox", async () => {
    const candidate = resolveHostedSourceDeliveryStallNoticeCandidate(BASE_INPUT);
    expect(candidate).not.toBeNull();
    if (!candidate) {
      return;
    }

    await materializeHostedSourceDeliveryStallNotice({
      candidate,
      now: BASE_INPUT.now,
      userId: "member-1",
    });

    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx).toHaveBeenCalledOnce();
    const appendInput = mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx.mock.calls[0]?.[0];
    const notificationKey = buildHostedSourceDeliveryStallNoticeKey(candidate);
    expect(appendInput?.envelope).toMatchObject({
      eventId: `assistant.notification.requested:${notificationKey}`,
      kind: "assistant.notification.requested",
      notification: {
        deliveryDedupeToken: notificationKey,
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: notificationKey,
        responsePolicy: {
          kind: "require_send_exact_text",
          text: expect.stringMatching(
            /Garmin Connect.*wait 5–30 days or stop these check-ins/su,
          ),
        },
        route: DIRECT_LINQ_DESTINATION.route,
      },
      userId: "member-1",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member-1",
      knownCheckpoint: {
        lane: "system",
        laneSeq: "7",
        userId: "member-1",
      },
      mailboxItemId: "mailbox-1",
      prisma: expect.any(Object),
    });
  });

  it("revalidates and re-signals an existing live episode without inserting another notice", async () => {
    const candidate = resolveHostedSourceDeliveryStallNoticeCandidate(BASE_INPUT);
    expect(candidate).not.toBeNull();
    if (!candidate) {
      return;
    }
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(MAILBOX_ITEM);

    await materializeHostedSourceDeliveryStallNotice({
      candidate,
      now: BASE_INPUT.now,
      userId: "member-1",
    });

    expect(mocks.runWithPreparedHostedMailboxItemAppendCrypto).toHaveBeenCalledOnce();
    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx).toHaveBeenCalledOnce();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledOnce();
  });

  it("suppresses members without active access before appending", async () => {
    const candidate = resolveHostedSourceDeliveryStallNoticeCandidate(BASE_INPUT);
    expect(candidate).not.toBeNull();
    if (!candidate) {
      return;
    }
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);

    await materializeHostedSourceDeliveryStallNotice({
      candidate,
      now: BASE_INPUT.now,
      userId: "member-1",
    });

    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "the member requested a longer wait",
      prepare: () => mocks.readHostedSourceNoDataOutreachPolicy.mockResolvedValue({
        afterDays: 10,
        enabled: true,
        setting: "custom",
        silentHours: 240,
      }),
    },
    {
      name: "the member disabled no-data checks",
      prepare: () => mocks.readHostedSourceNoDataOutreachPolicy.mockResolvedValue({
        enabled: false,
        setting: "off",
      }),
    },
    {
      name: "recent Linq activity is absent",
      prepare: () => mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(false),
    },
    {
      name: "the current route is not a direct member thread",
      prepare: () => mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue({
        ...DIRECT_LINQ_DESTINATION,
        conversationShape: "group",
      }),
    },
    {
      name: "the source received data after candidate selection",
      prepare: () => mocks.findDeviceConnectionSource.mockResolvedValue({
        connection: { status: "active", userId: "member-1" },
        id: BASE_INPUT.sourceId,
        lastDataAt: new Date("2026-08-22T23:00:00.000Z"),
        lifecycleEpoch: BASE_INPUT.lifecycleEpoch,
        sourceProviderSlug: BASE_INPUT.sourceProviderSlug,
        status: BASE_INPUT.status,
      }),
    },
  ])("suppresses the notice when $name", async ({ prepare }) => {
    const candidate = resolveHostedSourceDeliveryStallNoticeCandidate(BASE_INPUT);
    expect(candidate).not.toBeNull();
    if (!candidate) {
      return;
    }
    prepare();

    await materializeHostedSourceDeliveryStallNotice({
      candidate,
      now: BASE_INPUT.now,
      userId: "member-1",
    });

    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });
});
