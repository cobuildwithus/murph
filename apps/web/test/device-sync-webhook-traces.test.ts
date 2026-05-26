import { describe, expect, it, vi } from "vitest";

import { PrismaHostedWebhookTraceStore } from "@/src/lib/device-sync/prisma-store/webhook-traces";

const MINIMIZED_HOSTED_WEBHOOK_TRACE_ACCOUNT_SENTINEL = "_minimized_";

function createPrismaStub() {
  const prisma = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    $transaction: vi.fn(),
    deviceWebhookTrace: {
      create: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) =>
    callback(prisma)
  );
  return prisma;
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
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it("claims traces with a purgeable provider-account blind index when a key is configured", async () => {
    const prisma = createPrismaStub();
    const store = new PrismaHostedWebhookTraceStore({
      prisma: prisma as never,
      providerAccountBlindIndexKey: Buffer.alloc(32, 7),
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
        provider: "oura",
        providerAccountBlindIndex: expect.stringMatching(/^hbdi_/u),
        traceId: "trace-1",
      }),
    });
    expect(prisma.deviceWebhookTrace.create.mock.calls[0]?.[0].data.providerAccountBlindIndex)
      .not.toBe(MINIMIZED_HOSTED_WEBHOOK_TRACE_ACCOUNT_SENTINEL);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.deviceWebhookTrace.create.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("returns processing without touching trace rows when the provider-account lock is busy", async () => {
    const prisma = createPrismaStub();
    prisma.$queryRaw.mockResolvedValue([{ acquired: false }]);
    const store = new PrismaHostedWebhookTraceStore({
      prisma: prisma as never,
      providerAccountBlindIndexKey: Buffer.alloc(32, 7),
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
    ).resolves.toBe("processing");

    expect(prisma.deviceWebhookTrace.findUnique).not.toHaveBeenCalled();
    expect(prisma.deviceWebhookTrace.create).not.toHaveBeenCalled();
    expect(prisma.deviceWebhookTrace.updateMany).not.toHaveBeenCalled();
  });
});
