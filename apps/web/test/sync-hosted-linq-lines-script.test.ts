import { describe, expect, it, vi } from "vitest";

import {
  syncHostedLinqLinesFromEnvironment,
} from "../scripts/sync-hosted-linq-lines";

describe("syncHostedLinqLinesFromEnvironment", () => {
  it("commits configured env lines before attempting provider inventory sync", async () => {
    const events: string[] = [];
    const tx = {};
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
        events.push("transaction:start");
        await callback(tx);
        events.push("transaction:commit");
      }),
    } as never;
    const syncConfiguredLines = vi.fn(async () => {
      events.push("configured");
    });
    const syncProviderInventory = vi.fn(async () => {
      events.push("provider");
      throw new Error("provider unavailable");
    });

    await expect(
      syncHostedLinqLinesFromEnvironment({
        environment: {
          linqConversationPhoneNumbers: ["+15550100001"],
          linqMaxActiveMembersPerConversationPhone: 250,
        } as never,
        observedAt: new Date("2026-06-30T12:00:00.000Z"),
        prisma,
        syncConfiguredLines,
        syncProviderInventory,
      }),
    ).rejects.toThrow("provider unavailable");

    expect(events).toEqual([
      "transaction:start",
      "configured",
      "transaction:commit",
      "provider",
    ]);
    expect(syncConfiguredLines).toHaveBeenCalledWith({
      activeMemberLimit: 250,
      observedAt: new Date("2026-06-30T12:00:00.000Z"),
      phoneNumbers: ["+15550100001"],
      prisma: tx,
    });
  });
});
