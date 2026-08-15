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
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
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
  it("claims a fresh bounded batch in one transaction and two set queries", async () => {
    const prisma = createPrismaStub();
    const inputs = Array.from({ length: 8 }, (_, index) => createClaimInput(index));
    prisma.deviceWebhookTrace.findMany.mockResolvedValue(inputs.map((input) => ({
      claimToken: input.claimToken,
      processingExpiresAt: new Date(input.processingExpiresAt),
      provider: input.provider,
      status: "processing",
      traceId: input.traceId,
    })));
    const store = new PrismaHostedWebhookTraceStore({ prisma: prisma as never });

    await expect(store.claimWebhookTraceBatch(inputs)).resolves.toEqual(
      Array.from({ length: 8 }, () => "claimed"),
    );

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.deviceWebhookTrace.createMany).toHaveBeenCalledOnce();
    expect(prisma.deviceWebhookTrace.createMany.mock.calls[0]?.[0].data).toHaveLength(8);
    expect(prisma.deviceWebhookTrace.findMany).toHaveBeenCalledOnce();
    expect(prisma.deviceWebhookTrace.updateMany).not.toHaveBeenCalled();
  });

  it("collapses same-input trace duplicates so only the first owns the claim", async () => {
    const prisma = createPrismaStub();
    const first = createClaimInput(1);
    const duplicate = { ...first, claimToken: "claim-duplicate" };
    prisma.deviceWebhookTrace.findMany.mockResolvedValue([{
      claimToken: first.claimToken,
      processingExpiresAt: new Date(first.processingExpiresAt),
      provider: first.provider,
      status: "processing",
      traceId: first.traceId,
    }]);
    const store = new PrismaHostedWebhookTraceStore({ prisma: prisma as never });

    await expect(store.claimWebhookTraceBatch([first, duplicate])).resolves.toEqual([
      "claimed",
      "processing",
    ]);
    expect(prisma.deviceWebhookTrace.createMany.mock.calls[0]?.[0].data).toHaveLength(1);
  });

  it("classifies processed and active rows while conditionally taking over stale claims", async () => {
    const prisma = createPrismaStub();
    const processed = createClaimInput(1);
    const active = createClaimInput(2);
    const stale = createClaimInput(3);
    prisma.deviceWebhookTrace.findMany.mockResolvedValue([
      {
        claimToken: null,
        processingExpiresAt: null,
        provider: processed.provider,
        status: "processed",
        traceId: processed.traceId,
      },
      {
        claimToken: "another-active-claim",
        processingExpiresAt: new Date("2026-04-12T00:03:00.000Z"),
        provider: active.provider,
        status: "processing",
        traceId: active.traceId,
      },
      {
        claimToken: "expired-claim",
        processingExpiresAt: new Date("2026-04-11T23:59:00.000Z"),
        provider: stale.provider,
        status: "processing",
        traceId: stale.traceId,
      },
    ]);
    prisma.deviceWebhookTrace.updateMany.mockResolvedValueOnce({ count: 1 });
    const store = new PrismaHostedWebhookTraceStore({ prisma: prisma as never });

    await expect(store.claimWebhookTraceBatch([processed, active, stale])).resolves.toEqual([
      "processed",
      "processing",
      "claimed",
    ]);
    expect(prisma.deviceWebhookTrace.updateMany).toHaveBeenCalledOnce();
    expect(prisma.deviceWebhookTrace.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          traceId: stale.traceId,
          OR: expect.arrayContaining([
            { processingExpiresAt: { lte: new Date(stale.claimedAt) } },
          ]),
        }),
      }),
    );
  });

  it("claims traces without a provider-account blind-index key and stores a minimized sentinel", async () => {
    const prisma = createPrismaStub();
    const store = new PrismaHostedWebhookTraceStore({
      prisma: prisma as never,
    });

    await expect(
      store.claimWebhookTrace({
        eventType: "sleep.updated",
        externalAccountId: "external-account-123",
        claimedAt: "2026-04-12T00:00:00.000Z",
        claimToken: "claim-token",
        processingExpiresAt: "2026-04-12T00:05:00.000Z",
        provider: "oura",
        receivedAt: "2026-04-12T00:00:00.000Z",
        traceId: "trace-1",
      }),
    ).resolves.toBe("claimed");

    expect(prisma.deviceWebhookTrace.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "sleep.updated",
        processingExpiresAt: new Date("2026-04-12T00:05:00.000Z"),
        provider: "oura",
        providerAccountBlindIndex: MINIMIZED_HOSTED_WEBHOOK_TRACE_ACCOUNT_SENTINEL,
        receivedAt: new Date("2026-04-12T00:00:00.000Z"),
        status: "processing",
        traceId: "trace-1",
      }),
      skipDuplicates: true,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
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
        claimedAt: "2026-04-12T00:00:00.000Z",
        claimToken: "claim-token",
        processingExpiresAt: "2026-04-12T00:05:00.000Z",
        provider: "oura",
        receivedAt: "2026-04-12T00:00:00.000Z",
        traceId: "trace-1",
      }),
    ).resolves.toBe("claimed");

    expect(prisma.deviceWebhookTrace.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: "oura",
        providerAccountBlindIndex: expect.stringMatching(/^hbdi_/u),
        traceId: "trace-1",
      }),
      skipDuplicates: true,
    });
    expect(prisma.deviceWebhookTrace.createMany.mock.calls[0]?.[0].data.providerAccountBlindIndex)
      .not.toBe(MINIMIZED_HOSTED_WEBHOOK_TRACE_ACCOUNT_SENTINEL);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns processing for an active duplicate exact trace", async () => {
    const prisma = createPrismaStub();
    prisma.deviceWebhookTrace.createMany.mockResolvedValueOnce({ count: 0 });
    prisma.deviceWebhookTrace.findUnique.mockResolvedValueOnce({
      status: "processing",
      processingExpiresAt: new Date("2026-04-12T00:03:00.000Z"),
    });
    const store = new PrismaHostedWebhookTraceStore({
      prisma: prisma as never,
      providerAccountBlindIndexKey: Buffer.alloc(32, 7),
    });

    await expect(
      store.claimWebhookTrace({
        eventType: "sleep.updated",
        externalAccountId: "external-account-123",
        claimedAt: "2026-04-12T00:00:00.000Z",
        claimToken: "claim-token",
        processingExpiresAt: "2026-04-12T00:05:00.000Z",
        provider: "oura",
        receivedAt: "2026-04-12T00:00:00.000Z",
        traceId: "trace-1",
      }),
    ).resolves.toBe("processing");

    expect(prisma.deviceWebhookTrace.createMany).toHaveBeenCalledOnce();
    expect(prisma.deviceWebhookTrace.findUnique).toHaveBeenCalledOnce();
    expect(prisma.deviceWebhookTrace.updateMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("compares trace leases with claim time rather than the frozen receipt time", async () => {
    const prisma = createPrismaStub();
    prisma.deviceWebhookTrace.createMany.mockResolvedValue({ count: 0 });
    prisma.deviceWebhookTrace.findUnique.mockResolvedValue({
      status: "processing",
      processingExpiresAt: new Date("2026-04-12T12:03:00.000Z"),
    });
    prisma.deviceWebhookTrace.updateMany.mockResolvedValue({ count: 1 });
    const store = new PrismaHostedWebhookTraceStore({ prisma: prisma as never });

    await expect(store.claimWebhookTrace({
      claimedAt: "2026-04-12T12:04:00.000Z",
      claimToken: "claim-new",
      eventType: "sleep.updated",
      externalAccountId: "external-account-123",
      processingExpiresAt: "2026-04-12T12:09:00.000Z",
      provider: "oura",
      receivedAt: "2026-04-12T11:00:00.000Z",
      traceId: "trace-delayed",
    })).resolves.toBe("claimed");
    expect(prisma.deviceWebhookTrace.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { processingExpiresAt: { lte: new Date("2026-04-12T12:04:00.000Z") } },
          ]),
        }),
      }),
    );

    prisma.deviceWebhookTrace.updateMany.mockClear();
    await expect(store.claimWebhookTrace({
      claimedAt: "2026-04-12T12:02:00.000Z",
      claimToken: "claim-still-active",
      eventType: "sleep.updated",
      externalAccountId: "external-account-123",
      processingExpiresAt: "2026-04-12T12:07:00.000Z",
      provider: "oura",
      receivedAt: "2026-04-12T13:00:00.000Z",
      traceId: "trace-active",
    })).resolves.toBe("processing");
    expect(prisma.deviceWebhookTrace.updateMany).not.toHaveBeenCalled();
  });
});

function createClaimInput(index: number) {
  return {
    claimedAt: "2026-04-12T00:00:00.000Z",
    claimToken: `claim-${index}`,
    eventType: "sleep.updated",
    externalAccountId: `external-account-${index}`,
    processingExpiresAt: "2026-04-12T00:05:00.000Z",
    provider: "oura",
    receivedAt: "2026-04-12T00:00:00.000Z",
    traceId: `trace-${index}`,
  };
}
