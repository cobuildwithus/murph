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

vi.mock("@healthybob/inboxd", () => ({
  verifyAndParseLinqWebhookRequest: mocks.verifyAndParseLinqWebhookRequest,
  requireLinqMessageReceivedEvent: mocks.requireLinqMessageReceivedEvent,
}));

type LinqControlPlaneModule = typeof import("../src/lib/linq/control-plane");

let linqControlPlane: LinqControlPlaneModule;

describe("HostedLinqControlPlane", () => {
  beforeAll(async () => {
    linqControlPlane = await import("../src/lib/linq/control-plane");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LINQ_WEBHOOK_SECRET;
    delete process.env.HEALTHYBOB_LINQ_WEBHOOK_SECRET;
    mocks.getPrisma.mockReturnValue({});
    mocks.store.getBindingByRecipientPhone.mockResolvedValue(null);
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
});
