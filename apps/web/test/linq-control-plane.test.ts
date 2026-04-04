import { createHmac } from "node:crypto";

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe as baseDescribe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  assertBrowserMutationOrigin: vi.fn(),
  createHostedDeviceSyncControlPlaneContext: vi.fn(),
  fetch: vi.fn(),
  hostedDeviceSyncAgentSessionService: vi.fn(),
  getPrisma: vi.fn(),
  requireAuthenticatedHostedUser: vi.fn(),
  verifyAndParseLinqWebhookRequest: vi.fn(),
  parseCanonicalLinqMessageReceivedEvent: vi.fn(),
  store: {
    listBindingsForUser: vi.fn(),
    getBindingByRecipientPhone: vi.fn(),
    upsertBinding: vi.fn(),
    queueWebhookEventIfNew: vi.fn(),
    listEventsForUser: vi.fn(),
  },
  hostedWebhookReceipt: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/src/lib/device-sync/auth", () => ({
  assertBrowserMutationOrigin: mocks.assertBrowserMutationOrigin,
  requireAuthenticatedHostedUser: mocks.requireAuthenticatedHostedUser,
}));

vi.mock("@/src/lib/device-sync/control-plane-context", () => ({
  createHostedDeviceSyncControlPlaneContext: mocks.createHostedDeviceSyncControlPlaneContext,
}));

vi.mock("@/src/lib/device-sync/agent-session-service", () => ({
  HostedDeviceSyncAgentSessionService: mocks.hostedDeviceSyncAgentSessionService,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/linq/prisma-store", () => ({
  PrismaLinqControlPlaneStore: vi.fn(function PrismaLinqControlPlaneStore() {
    return mocks.store;
  }),
}));

vi.mock("@murphai/messaging-ingress/linq-webhook", async () => {
  const actual = await vi.importActual<typeof import("@murphai/messaging-ingress/linq-webhook")>("@murphai/messaging-ingress/linq-webhook");

  return {
    ...actual,
    verifyAndParseLinqWebhookRequest: mocks.verifyAndParseLinqWebhookRequest,
    parseCanonicalLinqMessageReceivedEvent: mocks.parseCanonicalLinqMessageReceivedEvent,
  };
});

type LinqControlPlaneModule = typeof import("../src/lib/linq/control-plane");
type MessagingIngressLinqModule = typeof import("@murphai/messaging-ingress/linq-webhook");

let linqControlPlane: LinqControlPlaneModule;
let inboxd: Pick<
  MessagingIngressLinqModule,
  "parseCanonicalLinqMessageReceivedEvent" | "verifyAndParseLinqWebhookRequest"
>;
const REMOVED_LINQ_WEBHOOK_SECRET_ALIAS = ["HEALTHY", "BOB", "LINQ", "WEBHOOK", "SECRET"].join("_");
const describe = baseDescribe.sequential;

describe("HostedLinqControlPlane", () => {
  beforeAll(async () => {
    linqControlPlane = await import("../src/lib/linq/control-plane");
    inboxd = await vi.importActual<MessagingIngressLinqModule>("@murphai/messaging-ingress/linq-webhook");
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LINQ_API_BASE_URL = "https://linq.example.test/api/partner/v3";
    process.env.LINQ_API_TOKEN = "linq-token";
    process.env.LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS = String(5 * 60_000);
    delete process.env.LINQ_WEBHOOK_SECRET;
    delete process.env[REMOVED_LINQ_WEBHOOK_SECRET_ALIAS];
    mocks.hostedWebhookReceipt.create.mockResolvedValue({});
    mocks.hostedWebhookReceipt.findUnique.mockResolvedValue(null);
    mocks.hostedWebhookReceipt.updateMany.mockResolvedValue({ count: 1 });
    mocks.assertBrowserMutationOrigin.mockReset();
    mocks.createHostedDeviceSyncControlPlaneContext.mockReturnValue({
      allowedReturnOrigins: ["https://example.test"],
      codec: {},
      env: {
        allowedReturnOrigins: ["https://example.test"],
      },
      registry: {},
      store: {},
    });
    mocks.getPrisma.mockReturnValue({
      hostedWebhookReceipt: mocks.hostedWebhookReceipt,
    });
    mocks.hostedDeviceSyncAgentSessionService.mockImplementation(() => ({
      createAgentSession: vi.fn(),
      requireAgentSession: vi.fn(),
    }));
    mocks.requireAuthenticatedHostedUser.mockResolvedValue({
      id: "user-123",
    });
    mocks.store.getBindingByRecipientPhone.mockResolvedValue(null);
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        phone_numbers: [
          {
            phone_number: "+15557654321",
          },
        ],
      }),
    });
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
    expect(mocks.createHostedDeviceSyncControlPlaneContext).not.toHaveBeenCalled();
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
        recipient_phone: "15557654321",
        message: {
          id: "msg_123",
        },
      },
    };

    mocks.verifyAndParseLinqWebhookRequest.mockReturnValue(event);
    mocks.parseCanonicalLinqMessageReceivedEvent.mockReturnValue(event);

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
      recipientPhone: "*** 4321",
      eventId: "evt_123",
    });
    expect(mocks.createHostedDeviceSyncControlPlaneContext).not.toHaveBeenCalled();
    expect(mocks.verifyAndParseLinqWebhookRequest).toHaveBeenCalledTimes(1);
    expect(mocks.store.getBindingByRecipientPhone).toHaveBeenCalledWith("+15557654321");
    expect(mocks.hostedWebhookReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: "evt_123",
          source: "linq-control-plane",
        }),
      }),
    );
  });

  it("reuses the hosted device-sync browser auth flow for binding reads", async () => {
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
    expect(mocks.requireAuthenticatedHostedUser).toHaveBeenCalledTimes(1);
    expect(mocks.createHostedDeviceSyncControlPlaneContext).toHaveBeenCalledTimes(1);
    expect(mocks.store.listBindingsForUser).toHaveBeenCalledWith("user-123");
  });

  it("verifies browser binding claims against the configured Linq account inventory", async () => {
    mocks.store.upsertBinding.mockResolvedValue({
      id: "linqb_123",
      userId: "user-123",
      recipientPhone: "+15557654321",
      label: "Primary",
      createdAt: "2026-03-25T10:00:00.000Z",
      updatedAt: "2026-03-25T10:00:00.000Z",
    });

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/bindings", {
        method: "POST",
      }),
    );

    await expect(controlPlane.upsertBinding({
      recipientPhone: "+1 (555) 765-4321",
      label: "Primary",
    })).resolves.toEqual({
      binding: {
        id: "linqb_123",
        userId: "user-123",
        recipientPhone: "+15557654321",
        label: "Primary",
        createdAt: "2026-03-25T10:00:00.000Z",
        updatedAt: "2026-03-25T10:00:00.000Z",
      },
    });

    expect(mocks.fetch).toHaveBeenCalledWith(
      new URL("phone_numbers", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        headers: {
          authorization: "Bearer linq-token",
        },
        method: "GET",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.store.upsertBinding).toHaveBeenCalledWith({
      userId: "user-123",
      recipientPhone: "+15557654321",
      label: "Primary",
    });
    expect(mocks.assertBrowserMutationOrigin).toHaveBeenCalledTimes(1);
  });

  it("rejects binding claims for recipient phones the configured Linq account does not control", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        phone_numbers: [
          {
            phone_number: "+15550001111",
          },
        ],
      }),
    });

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/bindings", {
        method: "POST",
      }),
    );

    await expect(controlPlane.upsertBinding({
      recipientPhone: "+15557654321",
    })).rejects.toMatchObject({
      code: "LINQ_BINDING_RECIPIENT_UNVERIFIED",
      httpStatus: 403,
    });
    expect(mocks.store.upsertBinding).not.toHaveBeenCalled();
  });

  it("fails hosted recipient verification when LINQ_API_TOKEN is missing", async () => {
    delete process.env.LINQ_API_TOKEN;

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/bindings", {
        method: "POST",
      }),
    );

    await expect(controlPlane.upsertBinding({
      recipientPhone: "+15557654321",
    })).rejects.toMatchObject({
      code: "LINQ_API_TOKEN_REQUIRED",
      httpStatus: 500,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.store.upsertBinding).not.toHaveBeenCalled();
  });

  it("fails hosted recipient verification when the Linq phone-number probe returns a non-OK response", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "",
    });

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/bindings", {
        method: "POST",
      }),
    );

    await expect(controlPlane.upsertBinding({
      recipientPhone: "+15557654321",
    })).rejects.toMatchObject({
      code: "LINQ_BINDING_PROBE_FAILED",
      httpStatus: 502,
      message: "Linq recipient verification failed with HTTP 503.",
      retryable: true,
    });
    expect(mocks.store.upsertBinding).not.toHaveBeenCalled();
  });

  it("treats hosted Linq phone-number rate limits as retryable probe failures", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => "",
    });

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/bindings", {
        method: "POST",
      }),
    );

    await expect(controlPlane.upsertBinding({
      recipientPhone: "+15557654321",
    })).rejects.toMatchObject({
      code: "LINQ_BINDING_PROBE_FAILED",
      httpStatus: 502,
      message: "Linq recipient verification failed with HTTP 429.",
      retryable: true,
    });
    expect(mocks.store.upsertBinding).not.toHaveBeenCalled();
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
        recipient_phone: "15557654321",
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
    mocks.parseCanonicalLinqMessageReceivedEvent.mockReturnValue(event);
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
    expect(mocks.hostedWebhookReceipt.updateMany).toHaveBeenCalled();
  });

  it("persists ignored non-message Linq webhooks behind the hosted receipt barrier", async () => {
    process.env.LINQ_WEBHOOK_SECRET = "linq-secret";
    const event = {
      api_version: "v3",
      event_id: "evt_ignored_123",
      created_at: "2026-03-25T10:00:00.000Z",
      event_type: "message.delivered",
      trace_id: "trace_ignored_123",
      data: {
        chat_id: "chat_123",
      },
    };

    mocks.verifyAndParseLinqWebhookRequest.mockReturnValue(event);

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );

    await expect(controlPlane.handleWebhook()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      ignored: true,
      routed: false,
      eventId: "evt_ignored_123",
      eventType: "message.delivered",
    });
    expect(mocks.hostedWebhookReceipt.create).toHaveBeenCalledTimes(1);
    expect(mocks.hostedWebhookReceipt.updateMany).toHaveBeenCalled();
    const receiptUpdate = mocks.hostedWebhookReceipt.updateMany.mock.calls[0]?.[0];
    expect(receiptUpdate).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            receiptState: expect.objectContaining({
              response: expect.objectContaining({
                accepted: true,
                duplicate: false,
                eventId: "evt_ignored_123",
                eventType: "message.delivered",
                ignored: true,
                routed: false,
              }),
            }),
          }),
        }),
      }),
    );
    expect(mocks.store.queueWebhookEventIfNew).not.toHaveBeenCalled();
  });

  it("rejects malformed signed message.received payloads with the hosted payload error surface", async () => {
    process.env.LINQ_WEBHOOK_SECRET = "linq-secret";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-25T10:00:00.000Z"));
    const payload = JSON.stringify({
      ...buildLinqControlPlaneWebhookPayload({
        data: {
          direction: "sideways",
        },
        eventId: "evt_invalid_payload",
      }),
    });
    const timestamp = "1711360800";
    mocks.verifyAndParseLinqWebhookRequest.mockImplementation(
      inboxd.verifyAndParseLinqWebhookRequest,
    );
    mocks.parseCanonicalLinqMessageReceivedEvent.mockImplementation(
      inboxd.parseCanonicalLinqMessageReceivedEvent,
    );

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/webhook", {
        method: "POST",
        body: payload,
        headers: {
          "x-webhook-signature": signLinqWebhook("linq-secret", payload, timestamp),
          "x-webhook-timestamp": timestamp,
        },
      }),
    );

    await expect(controlPlane.handleWebhook()).rejects.toMatchObject({
      code: "LINQ_PAYLOAD_INVALID",
      httpStatus: 400,
      message: "Linq message.received direction must be \"inbound\" or \"outbound\".",
    });
    expect(mocks.store.getBindingByRecipientPhone).not.toHaveBeenCalled();
    expect(mocks.store.queueWebhookEventIfNew).not.toHaveBeenCalled();
    expect(mocks.hostedWebhookReceipt.create).toHaveBeenCalledTimes(1);
  });

  it("rejects stale signed webhook timestamps before any receipt or queue write", async () => {
    process.env.LINQ_WEBHOOK_SECRET = "linq-secret";
    process.env.LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS = "60000";
    vi.useFakeTimers();
    const payload = JSON.stringify({
      ...buildLinqControlPlaneWebhookPayload({
        eventId: "evt_stale",
      }),
    });
    const timestamp = "1711360800";
    mocks.verifyAndParseLinqWebhookRequest.mockImplementation(
      inboxd.verifyAndParseLinqWebhookRequest,
    );
    vi.setSystemTime(new Date("2024-03-25T10:10:00.000Z"));

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/webhook", {
        method: "POST",
        body: payload,
        headers: {
          "x-webhook-signature": signLinqWebhook("linq-secret", payload, timestamp),
          "x-webhook-timestamp": timestamp,
        },
      }),
    );

    await expect(controlPlane.handleWebhook()).rejects.toMatchObject({
      message: "Linq webhook timestamp is outside the allowed tolerance window.",
    });
    expect(mocks.hostedWebhookReceipt.create).not.toHaveBeenCalled();
    expect(mocks.store.getBindingByRecipientPhone).not.toHaveBeenCalled();
    expect(mocks.store.queueWebhookEventIfNew).not.toHaveBeenCalled();
  });

  it("fails hosted recipient verification when the Linq phone-number probe times out", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener(
          "abort",
          () => reject(signal.reason ?? new Error("aborted")),
          { once: true },
        );
      }),
    );

    const controlPlane = new linqControlPlane.HostedLinqControlPlane(
      new Request("https://example.test/api/linq/bindings", {
        method: "POST",
      }),
    );

    const result = controlPlane.upsertBinding({
      recipientPhone: "+15557654321",
    });
    const expectation = expect(result).rejects.toMatchObject({
      code: "LINQ_BINDING_PROBE_FAILED",
      httpStatus: 502,
      message: "Linq recipient verification timed out.",
      retryable: true,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    await expectation;
  });
});

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return `sha256=${signature}`;
}

function buildLinqControlPlaneWebhookPayload(input: {
  data?: Record<string, unknown>;
  eventId?: string;
} = {}): Record<string, unknown> {
  return {
    api_version: "v3",
    created_at: "2026-03-25T10:00:00.000Z",
    webhook_version: "2026-02-03",
    data: {
      chat: {
        id: "chat_123",
        owner_handle: {
          handle: "+15557654321",
          id: "handle_owner_123",
          is_me: true,
          service: "SMS",
        },
      },
      direction: "inbound",
      id: "msg_123",
      parts: [],
      sender_handle: {
        handle: "+15550001111",
        id: "handle_sender_123",
        service: "SMS",
      },
      service: "SMS",
      ...(input.data ?? {}),
    },
    event_id: input.eventId ?? "evt_123",
    event_type: "message.received",
  };
}
