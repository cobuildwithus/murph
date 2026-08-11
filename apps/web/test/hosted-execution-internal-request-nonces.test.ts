import { describe, expect, it, vi } from "vitest";

import {
  PrismaHostedCallbackRequestNonceStore,
} from "@/src/lib/hosted-execution/internal-request-nonces";

const nonceInput = {
  expiresAt: "2026-08-09T12:46:00.000Z",
  method: "POST",
  nonceHash: "nonce_hash_exact_duplicate",
  now: "2026-08-09T12:45:00.000Z",
  path: "/api/internal/hosted-runtime/log",
  search: "?attempt=1",
  userId: "member_nonce_store",
};

function sqlOf(call: readonly unknown[]): string {
  return (call[0] as TemplateStringsArray).join("?");
}

function createStoreHarness() {
  const create = vi.fn();
  const deleteMany = vi.fn();
  const queryRaw = vi.fn();
  const transaction = vi.fn();
  const prisma = {
    $queryRaw: queryRaw,
    $transaction: transaction,
    hostedWebInternalRequestNonce: {
      create,
      deleteMany,
    },
  };

  return {
    create,
    deleteMany,
    queryRaw,
    store: new PrismaHostedCallbackRequestNonceStore(prisma as never),
    transaction,
  };
}

describe("hosted callback request nonce store", () => {
  it("admits with one database-clock insert statement and no transaction", async () => {
    const harness = createStoreHarness();
    harness.queryRaw.mockResolvedValueOnce([{ admitted: true }]);

    await expect(
      harness.store.consumeHostedCallbackRequestNonce(nonceInput),
    ).resolves.toBe(true);

    expect(harness.queryRaw).toHaveBeenCalledTimes(1);
    const call = harness.queryRaw.mock.calls[0]!;
    const sql = sqlOf(call);
    const returningIndex = sql.indexOf("RETURNING");
    expect(sql).toContain(
      'INSERT INTO "hosted_web_internal_request_nonce" AS request_nonce',
    );
    expect(sql).toContain('ON CONFLICT ("nonce_hash") DO NOTHING');
    expect(sql).toContain(
      'request_nonce."expires_at" >= date_trunc(',
    );
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
      nonceInput.search,
      nonceInput.now,
      nonceInput.expiresAt,
    ]);
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.deleteMany).not.toHaveBeenCalled();
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["the nonce conflicts", []],
    ["the inserted nonce is already expired", [{ admitted: false }]],
  ])("returns false when %s", async (_label, rows) => {
    const harness = createStoreHarness();
    harness.queryRaw.mockResolvedValueOnce(rows);

    await expect(
      harness.store.consumeHostedCallbackRequestNonce(nonceInput),
    ).resolves.toBe(false);

    expect(harness.queryRaw).toHaveBeenCalledTimes(1);
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.deleteMany).not.toHaveBeenCalled();
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it("propagates database failures", async () => {
    const harness = createStoreHarness();
    const failure = new Error("database unavailable");
    harness.queryRaw.mockRejectedValueOnce(failure);

    await expect(
      harness.store.consumeHostedCallbackRequestNonce(nonceInput),
    ).rejects.toBe(failure);

    expect(harness.queryRaw).toHaveBeenCalledTimes(1);
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.deleteMany).not.toHaveBeenCalled();
    expect(harness.transaction).not.toHaveBeenCalled();
  });
});
