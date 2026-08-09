import { describe, expect, it, vi } from "vitest";

import {
  PrismaHostedBrowserAssertionNonceStore,
} from "@/src/lib/device-sync/prisma-store/browser-assertion-nonces";

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
      cloneNonce(record),
    ]),
  );
  const transaction = vi.fn();
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const record = normalizeNonceRecord(data);

    if (nonces.has(record.nonceHash)) {
      const error = new Error("Unique constraint failed.");
      (error as Error & { code: string }).code = "P2002";
      throw error;
    }

    nonces.set(record.nonceHash, record);
    return cloneNonce(record);
  });
  const store = new PrismaHostedBrowserAssertionNonceStore({
    deviceBrowserAssertionNonce: { create },
    $transaction: transaction,
  } as never);

  return {
    create,
    nonces,
    store,
    transaction,
  };
}

describe("PrismaHostedBrowserAssertionNonceStore", () => {
  it("consumes a fresh nonce once and rejects a replay with direct inserts", async () => {
    const { create, store, transaction } = createStore();
    const input = {
      nonceHash: "nonce-hash-1",
      userId: "user-123",
      method: "POST",
      path: "/api/device-sync/agents/pair",
      now: "2026-03-25T12:00:00.000Z",
      expiresAt: "2026-03-25T12:05:00.000Z",
    };

    await expect(store.consumeBrowserAssertionNonce(input)).resolves.toBe(true);
    await expect(store.consumeBrowserAssertionNonce(input)).resolves.toBe(false);

    expect(create).toHaveBeenCalledTimes(2);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("leaves expired-row reclamation to the hourly retention owner", async () => {
    const expired = {
      nonceHash: "nonce-hash-expired",
      userId: "user-123",
      method: "POST",
      path: "/api/device-sync/agents/pair",
      createdAt: new Date("2026-03-25T11:50:00.000Z"),
      expiresAt: new Date("2026-03-25T11:55:00.000Z"),
    };
    const { nonces, store, transaction } = createStore([expired]);

    await expect(store.consumeBrowserAssertionNonce({
      nonceHash: expired.nonceHash,
      userId: expired.userId,
      method: expired.method,
      path: expired.path,
      now: "2026-03-25T12:00:00.000Z",
      expiresAt: "2026-03-25T12:05:00.000Z",
    })).resolves.toBe(false);

    expect(nonces.get(expired.nonceHash)?.expiresAt.toISOString()).toBe(
      expired.expiresAt.toISOString(),
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rethrows database failures that are not nonce replays", async () => {
    const failure = new Error("database unavailable");
    const create = vi.fn().mockRejectedValue(failure);
    const transaction = vi.fn();
    const store = new PrismaHostedBrowserAssertionNonceStore({
      deviceBrowserAssertionNonce: { create },
      $transaction: transaction,
    } as never);

    await expect(store.consumeBrowserAssertionNonce({
      nonceHash: "nonce-hash-error",
      userId: "user-123",
      method: "POST",
      path: "/api/device-sync/agents/pair",
      now: "2026-03-25T12:00:00.000Z",
      expiresAt: "2026-03-25T12:05:00.000Z",
    })).rejects.toBe(failure);
    expect(transaction).not.toHaveBeenCalled();
  });
});

function normalizeNonceRecord(
  data: Record<string, unknown>,
): MutableBrowserAssertionNonce {
  if (
    typeof data.nonceHash !== "string"
    || typeof data.userId !== "string"
    || typeof data.method !== "string"
    || typeof data.path !== "string"
    || !(data.createdAt instanceof Date)
    || !(data.expiresAt instanceof Date)
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

function cloneNonce(
  record: MutableBrowserAssertionNonce,
): MutableBrowserAssertionNonce {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    expiresAt: new Date(record.expiresAt),
  };
}
