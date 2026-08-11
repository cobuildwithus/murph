import { describe, expect, it, vi } from "vitest";

import {
  PrismaHostedBrowserAssertionNonceStore,
} from "@/src/lib/device-sync/prisma-store/browser-assertion-nonces";

const nonceInput = {
  nonceHash: "nonce-hash-1",
  userId: "user-123",
  method: "POST",
  path: "/api/device-sync/agents/pair",
  now: "2026-03-25T12:00:00.000Z",
  expiresAt: "2026-03-25T12:05:00.000Z",
};

function sqlOf(call: readonly unknown[]): string {
  return (call[0] as TemplateStringsArray).join("?");
}

function createStore() {
  const transaction = vi.fn();
  const queryRaw = vi.fn();
  const store = new PrismaHostedBrowserAssertionNonceStore({
    $queryRaw: queryRaw,
    $transaction: transaction,
  } as never);

  return {
    queryRaw,
    store,
    transaction,
  };
}

describe("PrismaHostedBrowserAssertionNonceStore", () => {
  it("admits with one database-clock insert statement and no transaction", async () => {
    const { queryRaw, store, transaction } = createStore();
    queryRaw.mockResolvedValueOnce([{ admitted: true }]);

    await expect(store.consumeBrowserAssertionNonce(nonceInput)).resolves.toBe(true);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const call = queryRaw.mock.calls[0]!;
    const sql = sqlOf(call);
    const returningIndex = sql.indexOf("RETURNING");
    expect(sql).toContain(
      'INSERT INTO "device_browser_assertion_nonce" AS browser_nonce',
    );
    expect(sql).toContain('ON CONFLICT ("nonce_hash") DO NOTHING');
    expect(sql).toContain('browser_nonce."expires_at" >= date_trunc(');
    expect(sql).toContain("'milliseconds'");
    expect(sql).toContain("clock_timestamp() AT TIME ZONE 'UTC'");
    expect(returningIndex).toBeGreaterThan(-1);
    expect(sql.indexOf("clock_timestamp()")).toBeGreaterThan(returningIndex);
    expect(sql.slice(0, returningIndex)).not.toContain("clock_timestamp()");
    expect(call.slice(1)).toEqual([
      nonceInput.nonceHash,
      nonceInput.userId,
      nonceInput.method,
      nonceInput.path,
      nonceInput.now,
      nonceInput.expiresAt,
    ]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["the nonce conflicts", []],
    ["the inserted nonce is already expired", [{ admitted: false }]],
  ])("returns false when %s", async (_label, rows) => {
    const { queryRaw, store, transaction } = createStore();
    queryRaw.mockResolvedValueOnce(rows);

    await expect(store.consumeBrowserAssertionNonce(nonceInput)).resolves.toBe(false);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rethrows database failures that are not nonce replays", async () => {
    const failure = new Error("database unavailable");
    const { queryRaw, store, transaction } = createStore();
    queryRaw.mockRejectedValueOnce(failure);

    await expect(store.consumeBrowserAssertionNonce(nonceInput)).rejects.toBe(failure);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
  });
});
