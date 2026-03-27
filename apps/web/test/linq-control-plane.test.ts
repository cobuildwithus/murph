import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  getPrisma: vi.fn(),
  verifyAndParseLinqWebhookRequest: vi.fn(),
  requireLinqMessageReceivedEvent: vi.fn(),
  store: {
    listBindingsForUser: vi.fn(),
    getBindingByRecipientPhone: vi.fn(),
    upsertBinding: vi.fn(),
    queueWebhookEventIfNew: vi.fn(),
    listEventsForUser: vi.fn(),
  },
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/linq/prisma-store", () => ({
  PrismaLinqControlPlaneStore: vi.fn(function PrismaLinqControlPlaneStore() {
    return mocks.store;
  }),
}));

vi.mock("@murph/inboxd", () => ({
  verifyAndParseLinqWebhookRequest: mocks.verifyAndParseLinqWebhookRequest,
  requireLinqMessageReceivedEvent: mocks.requireLinqMessageReceivedEvent,
}));

type LinqControlPlaneModule = typeof import("../src/lib/linq/control-plane");

let linqControlPlane: LinqControlPlaneModule;
const REMOVED_LINQ_WEBHOOK_SECRET_ALIAS = ["HEALTHY", "BOB", "LINQ", "WEBHOOK", "SECRET"].join("_");

describe("HostedLinqControlPlane", () => {
  beforeAll(async () => {
    linqControlPlane = await import("../src/lib/linq/control-plane");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LINQ_WEBHOOK_SECRET;
    delete process.env[REMOVED_LINQ_WEBHOOK_SECRET_ALIAS];
    mocks.getPrisma.mockReturnValue({});
    mocks.store.getBindingByRecipientPhone.mockResolvedValue(null);
  });

  it("requires LINQ_WEBHOOK_SECRET and ignores the removed branded alias", async () => {
    process.env[REMOVED_LINQ_WEBHOOK_SECRET_ALIAS] = "linq-secret";

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );

    await expect(controlPlane.handleWebhook()).rejects.toMatchObject({
      code: "LINQ_WEBHOOK_SECRET_MISSING",
      httpStatus: 500,
    });
    expect(mocks.verifyAndParseLinqWebhookRequest).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
  });

  it("handles public webhook ingestion without constructing the hosted device-sync auth control plane", async () => {
    process.env.LINQ_WEBHOOK_SECRET = "linq-secret";
    const event = {
      api_version: "v3",
      event_id: "evt_123",
      created_at: "2026-03-25T10:00:00.000Z",
      event_type: "message.received",
      trace_id: "trace_123",
      data: {
        chat_id: "chat_123",
        recipient_phone: "+15557654321",
        message: {
          id: "msg_123",
        },
      },
    };

    mocks.verifyAndParseLinqWebhookRequest.mockReturnValue(event);
    mocks.requireLinqMessageReceivedEvent.mockReturnValue(event);

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );

    await expect(controlPlane.handleWebhook()).resolves.toMatchObject({
      accepted: true,
      routed: false,
      ignored: true,
      reason: "unpaired_recipient_phone",
      recipientPhone: "+15557654321",
      eventId: "evt_123",
    });
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
    expect(mocks.verifyAndParseLinqWebhookRequest).toHaveBeenCalledTimes(1);
    expect(mocks.store.getBindingByRecipientPhone).toHaveBeenCalledWith("+15557654321");
  });

  it("reuses the hosted device-sync browser auth flow for binding reads", async () => {
    const authControlPlane = {
      requireAuthenticatedUser: vi.fn().mockResolvedValue({
        id: "user-123",
      }),
    };

    mocks.createHostedDeviceSyncControlPlane.mockReturnValue(authControlPlane);
    mocks.store.listBindingsForUser.mockResolvedValue([
      {
        id: "linqb_123",
        userId: "user-123",
        recipientPhone: "+15557654321",
        label: "Primary SMS",
        createdAt: "2026-03-25T10:00:00.000Z",
        updatedAt: "2026-03-25T10:00:00.000Z",
      },
    ]);

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/bindings"),
    );

    await expect(controlPlane.listBindings()).resolves.toEqual({
      bindings: [
        {
          id: "linqb_123",
          userId: "user-123",
          recipientPhone: "+15557654321",
          label: "Primary SMS",
          createdAt: "2026-03-25T10:00:00.000Z",
          updatedAt: "2026-03-25T10:00:00.000Z",
        },
      ],
    });
    expect(authControlPlane.requireAuthenticatedUser).toHaveBeenCalledTimes(1);
    expect(mocks.createHostedDeviceSyncControlPlane).toHaveBeenCalledTimes(1);
    expect(mocks.store.listBindingsForUser).toHaveBeenCalledWith("user-123");
  });

  it("queues only sparse routing fields for hosted webhook events", async () => {
    process.env.LINQ_WEBHOOK_SECRET = "linq-secret";
    const event = {
      api_version: "v3",
      event_id: "evt_sparse_123",
      created_at: "2026-03-25T10:00:00.000Z",
      event_type: "message.received",
      trace_id: "trace_sparse_123",
      data: {
        chat_id: "chat_123",
        from: "+15550001111",
        recipient_phone: "+15557654321",
        received_at: "2026-03-25T10:00:05.000Z",
        is_from_me: false,
        message: {
          id: "msg_123",
          parts: [
            {
              type: "text",
              value: "private message body",
            },
            {
              type: "media",
              url: "https://cdn.example.test/private.png",
              attachment_id: "att_private_123",
            },
          ],
        },
      },
    };

    mocks.verifyAndParseLinqWebhookRequest.mockReturnValue(event);
    mocks.requireLinqMessageReceivedEvent.mockReturnValue(event);
    mocks.store.getBindingByRecipientPhone.mockResolvedValue({
      id: "linqb_123",
      userId: "user-123",
      recipientPhone: "+15557654321",
      label: "Primary",
      createdAt: "2026-03-25T09:00:00.000Z",
      updatedAt: "2026-03-25T09:00:00.000Z",
    });
    mocks.store.queueWebhookEventIfNew.mockResolvedValue({
      inserted: true,
      event: {
        id: 7,
        userId: "user-123",
        bindingId: "linqb_123",
        recipientPhone: "+15557654321",
        eventId: "evt_sparse_123",
        traceId: "trace_sparse_123",
        eventType: "message.received",
        chatId: "chat_123",
        messageId: "msg_123",
        occurredAt: "2026-03-25T10:00:05.000Z",
        receivedAt: "2026-03-25T10:00:06.000Z",
        createdAt: "2026-03-25T10:00:06.000Z",
      },
    });

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );

    await expect(controlPlane.handleWebhook()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      routed: true,
      bindingId: "linqb_123",
      recipientPhone: "+15557654321",
      eventId: "evt_sparse_123",
      queueId: 7,
    });

    expect(mocks.store.queueWebhookEventIfNew).toHaveBeenCalledTimes(1);
    const queuedInput = mocks.store.queueWebhookEventIfNew.mock.calls[0]?.[0];
    expect(queuedInput).toEqual({
      userId: "user-123",
      bindingId: "linqb_123",
      recipientPhone: "+15557654321",
      eventId: "evt_sparse_123",
      traceId: "trace_sparse_123",
      eventType: "message.received",
      chatId: "chat_123",
      messageId: "msg_123",
      occurredAt: "2026-03-25T10:00:05.000Z",
      receivedAt: expect.any(String),
    });
    expect(JSON.stringify(queuedInput)).not.toContain("private message body");
    expect(JSON.stringify(queuedInput)).not.toContain("https://cdn.example.test/private.png");
    expect(JSON.stringify(queuedInput)).not.toContain("att_private_123");
  });
});
