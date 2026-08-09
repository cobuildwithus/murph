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

function createStoreHarness() {
  const create = vi.fn();
  const deleteMany = vi.fn();
  const transaction = vi.fn();
  const prisma = {
    $transaction: transaction,
    hostedWebInternalRequestNonce: {
      create,
      deleteMany,
    },
  };

  return {
    create,
    deleteMany,
    store: new PrismaHostedCallbackRequestNonceStore(prisma as never),
    transaction,
  };
}

describe("hosted callback request nonce store", () => {
  it("admits with one insert and no transaction or retention work", async () => {
    const harness = createStoreHarness();
    harness.create.mockResolvedValueOnce({});

    await expect(
      harness.store.consumeHostedCallbackRequestNonce(nonceInput),
    ).resolves.toBe(true);

    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.create).toHaveBeenCalledWith({
      data: {
        createdAt: new Date(nonceInput.now),
        expiresAt: new Date(nonceInput.expiresAt),
        method: nonceInput.method,
        nonceHash: nonceInput.nonceHash,
        path: nonceInput.path,
        search: nonceInput.search,
        userId: nonceInput.userId,
      },
    });
    expect(harness.deleteMany).not.toHaveBeenCalled();
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it("returns false only when the nonce primary key reports a unique violation", async () => {
    const harness = createStoreHarness();
    harness.create.mockRejectedValueOnce(
      Object.assign(new Error("duplicate nonce"), { code: "P2002" }),
    );

    await expect(
      harness.store.consumeHostedCallbackRequestNonce(nonceInput),
    ).resolves.toBe(false);

    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.deleteMany).not.toHaveBeenCalled();
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["ordinary database failure", new Error("database unavailable")],
    [
      "non-unique Prisma failure",
      Object.assign(new Error("foreign key failure"), { code: "P2003" }),
    ],
  ])("propagates %s", async (_label, failure) => {
    const harness = createStoreHarness();
    harness.create.mockRejectedValueOnce(failure);

    await expect(
      harness.store.consumeHostedCallbackRequestNonce(nonceInput),
    ).rejects.toBe(failure);

    expect(harness.deleteMany).not.toHaveBeenCalled();
    expect(harness.transaction).not.toHaveBeenCalled();
  });
});
