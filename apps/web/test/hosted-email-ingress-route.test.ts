import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedExecutionWakePayloadTx: vi.fn(),
  getPrisma: vi.fn(),
  readOptionalJsonObject: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/http")>(
    "@/src/lib/http",
  );

  return {
    ...actual,
    readOptionalJsonObject: mocks.readOptionalJsonObject,
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-wake/queue", () => ({
  appendHostedExecutionWakePayloadTx: mocks.appendHostedExecutionWakePayloadTx,
}));

describe("hosted email ingress route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.getPrisma.mockReturnValue({
      $transaction: vi.fn(async (callback: (tx: { label: string }) => Promise<unknown>) =>
        callback({ label: "wake-route-tx" })),
    });
    mocks.appendHostedExecutionWakePayloadTx.mockResolvedValue({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: {
        behavior: "ordered",
        createdAt: "2026-04-17T00:00:00.000Z",
        dedupeKey: "email:raw_123",
        id: "wake_24",
        kind: "conversation.message",
        occurredAt: "2026-04-17T00:00:00.000Z",
        payloadBytes: 128,
        payloadCiphertext: "ciphertext_inline_123",
        payloadSchema: "murph.hosted-wake-execution.v1",
        quarantineCode: null,
        quarantinedAt: null,
        seq: "24",
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
      },
    });
  });

  it("parses and forwards hosted email ingress append requests", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      eventId: "evt_email",
      identityId: "assistant@example.com",
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "reply@example.com",
    });

    const { POST } = await import("../app/api/internal/hosted-run/email-ingress/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: expect.objectContaining({
        id: "wake_24",
        seq: "24",
      }),
    });
    expect(mocks.appendHostedExecutionWakePayloadTx).toHaveBeenCalledWith({
      wake: {
        eventId: "evt_email",
        kind: "conversation.message",
        message: {
          channel: "email",
          identityId: "assistant@example.com",
          rawMessageKey: "raw_123",
          selfAddress: "reply@example.com",
        },
        occurredAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
      },
      tx: expect.objectContaining({
        label: "wake-route-tx",
      }),
    });
  });
});
