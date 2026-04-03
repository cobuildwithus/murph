import { describe, expect, it } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

type MutableBrowserAssertionNonce = {
  nonceHash: string;
  userId: string;
  method: string;
  path: string;
  createdAt: Date;
  expiresAt: Date;
};

function createStore(seed: MutableBrowserAssertionNonce[] = []) {
  const nonces = new Map<string, MutableBrowserAssertionNonce>(
    seed.map((record) => [
      record.nonceHash,
      {
        ...record,
      },
    ]),
  );

  const deviceBrowserAssertionNonce = {
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      let count = 0;

      for (const [nonceHash, record] of nonces.entries()) {
        if (!matchesExpiryWhere(record, where)) {
          continue;
        }

        nonces.delete(nonceHash);
        count += 1;
      }

      return { count };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const record = normalizeNonceRecord(data);

      if (nonces.has(record.nonceHash)) {
        const error = new Error("Unique constraint failed.");
        (error as Error & { code: string }).code = "P2002";
        throw error;
      }

      nonces.set(record.nonceHash, record);
      return cloneNonce(record);
    },
  };

  const tx = {
    deviceBrowserAssertionNonce,
  };

  const prisma = {
    deviceBrowserAssertionNonce,
    $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
  };

  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma: prisma as never,
    codec: {
      keyVersion: "v1",
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    },
  });

  return {
    nonces,
    store,
  };
}

describe("PrismaDeviceSyncControlPlaneStore browser assertion nonces", () => {
  it("consumes a fresh nonce once and rejects a replay", async () => {
    const { store } = createStore();

    await expect(
      store.consumeBrowserAssertionNonce({
        nonceHash: "nonce-hash-1",
        userId: "user-123",
        method: "POST",
        path: "/api/device-sync/agents/pair",
        now: "2026-03-25T12:00:00.000Z",
        expiresAt: "2026-03-25T12:05:00.000Z",
      }),
    ).resolves.toBe(true);

    await expect(
      store.consumeBrowserAssertionNonce({
        nonceHash: "nonce-hash-1",
        userId: "user-123",
        method: "POST",
        path: "/api/device-sync/agents/pair",
        now: "2026-03-25T12:00:10.000Z",
        expiresAt: "2026-03-25T12:05:00.000Z",
      }),
    ).resolves.toBe(false);
  });

  it("drops expired nonce rows before accepting a fresh record for the same hash", async () => {
    const { nonces, store } = createStore([
      {
        nonceHash: "nonce-hash-expired",
        userId: "user-123",
        method: "POST",
        path: "/api/device-sync/agents/pair",
        createdAt: new Date("2026-03-25T11:50:00.000Z"),
        expiresAt: new Date("2026-03-25T11:55:00.000Z"),
      },
    ]);

    await expect(
      store.consumeBrowserAssertionNonce({
        nonceHash: "nonce-hash-expired",
        userId: "user-123",
        method: "POST",
        path: "/api/device-sync/agents/pair",
        now: "2026-03-25T12:00:00.000Z",
        expiresAt: "2026-03-25T12:05:00.000Z",
      }),
    ).resolves.toBe(true);

    expect(nonces.get("nonce-hash-expired")).toMatchObject({
      userId: "user-123",
      method: "POST",
      path: "/api/device-sync/agents/pair",
    });
    expect(nonces.get("nonce-hash-expired")?.expiresAt.toISOString()).toBe("2026-03-25T12:05:00.000Z");
  });
});

function matchesExpiryWhere(
  record: MutableBrowserAssertionNonce,
  where: Record<string, unknown>,
): boolean {
  if (!isRecord(where.expiresAt)) {
    return true;
  }

  if (!(where.expiresAt.lte instanceof Date)) {
    return true;
  }

  return record.expiresAt <= where.expiresAt.lte;
}

function normalizeNonceRecord(data: Record<string, unknown>): MutableBrowserAssertionNonce {
  if (
    typeof data.nonceHash !== "string" ||
    typeof data.userId !== "string" ||
    typeof data.method !== "string" ||
    typeof data.path !== "string" ||
    !(data.createdAt instanceof Date) ||
    !(data.expiresAt instanceof Date)
  ) {
    throw new TypeError("Invalid browser assertion nonce record.");
  }

  return {
    nonceHash: data.nonceHash,
    userId: data.userId,
    method: data.method,
    path: data.path,
    createdAt: new Date(data.createdAt),
    expiresAt: new Date(data.expiresAt),
  };
}

function cloneNonce(record: MutableBrowserAssertionNonce): MutableBrowserAssertionNonce {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    expiresAt: new Date(record.expiresAt),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
