import { describe, expect, it, vi } from "vitest";

import { PrismaHostedWebhookTraceStore } from "@/src/lib/device-sync/prisma-store/webhook-traces";

const MINIMIZED_HOSTED_WEBHOOK_TRACE_ACCOUNT_SENTINEL = "_minimized_";

function createPrismaStub() {
  return {
    deviceWebhookTrace: {
      create: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe("PrismaHostedWebhookTraceStore", () => {
  it("claims traces without a provider-account blind-index key and stores a minimized sentinel", async () => {
    const prisma = createPrismaStub();
    const store = new PrismaHostedWebhookTraceStore({
      prisma: prisma as never,
    });

    await expect(
      store.claimWebhookTrace({
        eventType: "sleep.updated",
        externalAccountId: "external-account-123",
        claimToken: "claim-token",
        processingExpiresAt: "2026-04-12T00:05:00.000Z",
        provider: "oura",
        receivedAt: "2026-04-12T00:00:00.000Z",
        traceId: "trace-1",
      }),
    ).resolves.toBe("claimed");

    expect(prisma.deviceWebhookTrace.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "sleep.updated",
        processingExpiresAt: new Date("2026-04-12T00:05:00.000Z"),
        provider: "oura",
        providerAccountBlindIndex: MINIMIZED_HOSTED_WEBHOOK_TRACE_ACCOUNT_SENTINEL,
        receivedAt: new Date("2026-04-12T00:00:00.000Z"),
        status: "processing",
        traceId: "trace-1",
      }),
    });
  });
});
