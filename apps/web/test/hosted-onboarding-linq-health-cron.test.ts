import { afterEach, describe, expect, it, vi } from "vitest";

const cronMocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireVercelCronRequest: vi.fn(),
  syncHostedLinqChatHealthInventory: vi.fn(),
  syncHostedLinqPhoneNumberInventory: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: cronMocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-chat-health-inventory", () => ({
  syncHostedLinqChatHealthInventory:
    cronMocks.syncHostedLinqChatHealthInventory,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-phone-number-inventory", () => ({
  HOSTED_LINQ_PHONE_NUMBER_INVENTORY_SYNC_LIMIT: 250,
  syncHostedLinqPhoneNumberInventory:
    cronMocks.syncHostedLinqPhoneNumberInventory,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: cronMocks.getPrisma,
}));

import { GET } from "../app/api/internal/hosted-onboarding/linq/health/cron/route";

afterEach(() => {
  for (const mock of Object.values(cronMocks)) {
    mock.mockReset();
  }
});

describe("hosted Linq health cron route", () => {
  it("authenticates, refreshes both bounded inventories, and returns counts", async () => {
    const prisma = {};
    cronMocks.getPrisma.mockReturnValue(prisma);
    cronMocks.syncHostedLinqPhoneNumberInventory.mockResolvedValue({
      syncedCount: 3,
    });
    cronMocks.syncHostedLinqChatHealthInventory.mockResolvedValue({
      skippedCount: 2,
      syncedCount: 5,
    });
    const request = new Request(
      "https://example.test/api/internal/hosted-onboarding/linq/health/cron",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      chatHealthSkippedCount: 2,
      chatHealthSyncedCount: 5,
      lineHealthSyncedCount: 3,
    });
    expect(cronMocks.requireVercelCronRequest).toHaveBeenCalledWith(request);
    expect(cronMocks.syncHostedLinqPhoneNumberInventory).toHaveBeenCalledWith({
      maxLines: 250,
      observedAt: expect.any(Date),
      prisma,
      signal: request.signal,
    });
    expect(cronMocks.syncHostedLinqChatHealthInventory).toHaveBeenCalledWith({
      observedAt: expect.any(Date),
      prisma,
      signal: request.signal,
    });
    expect(
      cronMocks.syncHostedLinqPhoneNumberInventory.mock.invocationCallOrder[0],
    ).toBeLessThan(
      cronMocks.syncHostedLinqChatHealthInventory.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
