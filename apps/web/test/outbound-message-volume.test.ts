import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import { POST } from "../app/api/internal/hosted-runtime/message-volume/outbound-receipt/route";
import {
  recordHostedOutboundMessageVolumeReceipt,
} from "../src/lib/hosted-ops/outbound-message-volume";

const recordedAt = new Date("2026-08-15T19:30:00.000Z");
const dedupeKey = "a".repeat(40);
const prisma = {
  hostedOutboundMessageVolumeReceipt: {
    upsert: mocks.upsert,
  },
};

describe("hosted outbound message-volume receipts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.upsert.mockResolvedValue({ recordedAt });
  });

  it("uses one anonymous stable receipt key across retries without storing identifiers", async () => {
    await expect(recordHostedOutboundMessageVolumeReceipt({
      authenticatedUserId: "member_123",
      channel: "telegram",
      dedupeKey,
    })).resolves.toEqual({ recordedAt });
    await expect(recordHostedOutboundMessageVolumeReceipt({
      authenticatedUserId: "member_123",
      channel: "telegram",
      dedupeKey,
    })).resolves.toEqual({ recordedAt });

    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    const first = mocks.upsert.mock.calls[0]?.[0];
    const second = mocks.upsert.mock.calls[1]?.[0];
    expect(first.where.receiptLookupKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(second.where.receiptLookupKey).toBe(first.where.receiptLookupKey);
    expect(first).toEqual({
      create: {
        channel: "telegram",
        receiptLookupKey: first.where.receiptLookupKey,
      },
      select: {
        recordedAt: true,
      },
      update: {
        channel: "telegram",
      },
      where: {
        receiptLookupKey: first.where.receiptLookupKey,
      },
    });
    expect(JSON.stringify(first)).not.toContain("member_123");
    expect(JSON.stringify(first)).not.toContain(dedupeKey);
  });

  it("authenticates the runtime callback and returns only database receipt time", async () => {
    const request = new Request(
      "https://example.test/api/internal/hosted-runtime/message-volume/outbound-receipt",
      {
        body: JSON.stringify({
          channel: "email",
          dedupeKey,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      recordedAt: recordedAt.toISOString(),
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 1024 },
    );
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        channel: "email",
      }),
    }));
  });

  it("rejects unsupported channels and malformed outbox identities before storage", async () => {
    const invalidChannel = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/message-volume/outbound-receipt",
      {
        body: JSON.stringify({ channel: "linq", dedupeKey }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));
    const invalidDedupe = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/message-volume/outbound-receipt",
      {
        body: JSON.stringify({ channel: "telegram", dedupeKey: "raw-id" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(invalidChannel.status).toBe(400);
    expect(invalidDedupe.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
