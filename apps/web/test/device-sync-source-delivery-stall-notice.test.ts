import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeWithPreparedCryptoTx: vi.fn(),
  getPrisma: vi.fn(),
  hasHostedLinqInboundWithinDays: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
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

import {
  buildHostedSourceDeliveryStallNoticeKey,
  materializeHostedSourceDeliveryStallNotice,
  resolveHostedSourceDeliveryStallNoticeCandidate,
} from "@/src/lib/device-sync/source-delivery-stall-notice";

const BASE_INPUT = {
  connectionId: "connection-1",
  lastDataAt: "2026-08-20T00:00:00.000Z",
  lifecycleEpoch: 4,
  now: "2026-08-23T00:00:00.000Z",
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
        connection: { status: "active", userId: "member-1" },
        lastDataAt: new Date(BASE_INPUT.lastDataAt),
        lifecycleEpoch: BASE_INPUT.lifecycleEpoch,
        sourceProviderSlug: BASE_INPUT.sourceProviderSlug,
        status: BASE_INPUT.status,
      }),
    },
  };
  mocks.getPrisma.mockReturnValue({
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  });
  mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
  mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
  mocks.hasHostedLinqInboundWithinDays.mockResolvedValue(true);
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
      sourceInstanceKey: "source-1",
      sourceProviderSlug: "garmin",
    });
    expect(resolveHostedSourceDeliveryStallNoticeCandidate({
      ...BASE_INPUT,
      now: "2026-08-22T23:59:59.999Z",
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
    expect(appendInput?.envelope).toMatchObject({
      kind: "assistant.notification.requested",
      notification: {
        deliveryDispatchMode: "queue-only",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: expect.stringMatching(/Garmin Connect/u),
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

  it("re-signals an existing live episode without appending another notice", async () => {
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

    expect(mocks.runWithPreparedHostedMailboxItemAppendCrypto).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx).not.toHaveBeenCalled();
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
});
