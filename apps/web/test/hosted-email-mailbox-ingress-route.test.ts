import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  getPrisma: vi.fn(),
  readOptionalJsonObject: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
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

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

describe("hosted email mailbox ingress route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.getPrisma.mockReturnValue({
      $transaction: vi.fn(async (callback: (tx: { label: string }) => Promise<unknown>) =>
        callback({ label: "mailbox-route-tx" })),
    });
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: {
        createdAt: "2026-04-17T00:00:00.000Z",
        dedupeKey: "email:raw_123",
        expiresAt: null,
        id: "mailbox_item_24",
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: "24",
        occurredAt: "2026-04-17T00:00:00.000Z",
        payloadBytes: 128,
        payloadInlineCiphertext: "ciphertext_inline_123",
        payloadRef: null,
        payloadSchema: "murph.hosted-mailbox-item.v1",
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
      },
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
  });

  it("appends hosted email conversation messages and signals the runtime", async () => {
    mocks.readOptionalJsonObject.mockResolvedValue({
      attachmentSummaries: [
        {
          contentType: "text/plain",
          fileName: "notes.txt",
          sizeBytes: 42,
        },
      ],
      cc: ["helper@example.test"],
      eventId: "evt_email",
      from: "Sender <sender@example.test>",
      identityId: "assistant@example.test",
      messageId: "<message-123@example.test>",
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "reply@example.test",
      subject: "Hosted email",
      textPreview: "Please look at this update.",
      threadKey: "<thread-root@example.test>",
      threadTarget: "hostedmail:opaque-thread-target",
      to: ["reply@example.test"],
    });

    const { POST } = await import("../app/api/internal/hosted-mailbox/email-ingress/route");
    const response = await POST(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: expect.objectContaining({
        id: "mailbox_item_24",
        lane: "conversation",
        laneSeq: "24",
      }),
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: {
        eventId: "evt_email",
        kind: "conversation.message",
        message: {
          attachmentSummaries: [
            {
              contentType: "text/plain",
              fileName: "notes.txt",
              sizeBytes: 42,
            },
          ],
          channel: "email",
          cc: ["helper@example.test"],
          from: "Sender <sender@example.test>",
          identityId: "assistant@example.test",
          messageId: "<message-123@example.test>",
          rawMessageKey: "raw_123",
          selfAddress: "reply@example.test",
          subject: "Hosted email",
          textPreview: "Please look at this update.",
          threadKey: "<thread-root@example.test>",
          threadTarget: "hostedmail:opaque-thread-target",
          to: ["reply@example.test"],
        },
        occurredAt: "2026-04-17T00:00:00.000Z",
        userId: "member_123",
      },
      tx: expect.objectContaining({
        label: "mailbox-route-tx",
      }),
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_item_24",
    });
  });

  it("rejects oversized callback bodies before signature verification", async () => {
    const { POST } = await import("../app/api/internal/hosted-mailbox/email-ingress/route");
    const response = await POST(new Request("https://example.test", {
      body: "x".repeat(16 * 1024 + 1),
      method: "POST",
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: expect.objectContaining({
        code: "HOSTED_EMAIL_INGRESS_CALLBACK_BODY_TOO_LARGE",
      }),
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("keeps the canonical append committed when the Temporal signal fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.readOptionalJsonObject.mockResolvedValue({
      eventId: "evt_email",
      identityId: "assistant@example.test",
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "reply@example.test",
    });
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );

    try {
      const { POST } = await import("../app/api/internal/hosted-mailbox/email-ingress/route");
      const response = await POST(new Request("https://example.test", { method: "POST" }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        item: expect.objectContaining({
          id: "mailbox_item_24",
        }),
      }));
      expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
        expectedUserId: "member_123",
        mailboxItemId: "mailbox_item_24",
      });
      expect(consoleWarn).toHaveBeenCalledWith(
        "Hosted email ingress Temporal signal failed after mailbox append.",
        expect.objectContaining({
          errorName: "Error",
          mailboxItemIdPresent: true,
        }),
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
