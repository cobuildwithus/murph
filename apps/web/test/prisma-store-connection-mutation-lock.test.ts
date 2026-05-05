import { describe, expect, it } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

describe("PrismaDeviceSyncControlPlaneStore connection mutation locks", () => {
  it("takes the advisory lock inside the transaction before running the callback", async () => {
    const lockCalls: Array<{ strings: readonly string[]; values: unknown[] }> = [];
    const tx = {
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        lockCalls.push({
          strings: [...strings],
          values,
        });
        return 0;
      },
    };

    const store = new PrismaDeviceSyncControlPlaneStore({
      prisma: {
        $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
      } as never,
      codec: {
        keyVersion: "v1",
        encrypt: (value: string) => value,
        decrypt: (value: string) => value,
      },
    });

    const result = await store.withConnectionMutationLock("dsc_123", async (transaction) => {
      expect(transaction).toBe(tx);
      expect(lockCalls).toHaveLength(1);
      return "locked";
    });

    expect(result).toBe("locked");
    expect(lockCalls).toEqual([
      {
        strings: ["select pg_advisory_xact_lock(hashtext(", "))"],
        values: ["dsc_123"],
      },
    ]);
  });
});
