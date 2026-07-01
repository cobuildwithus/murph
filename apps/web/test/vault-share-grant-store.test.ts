import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

import { revokeHostedVaultSharesTx } from "@/src/lib/hosted-vault-share/share-grant-store";

function buildTx(): Prisma.TransactionClient & {
  hostedVaultShare: {
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
} {
  return {
    hostedVaultShare: {
      findMany: vi.fn(async () => [{
        destinationMemberId: "member_referee",
        grantorMemberId: "member_grantor",
        id: "share_1",
        projectionKind: "sleep-times.v0",
      }]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  } as unknown as Prisma.TransactionClient & {
    hostedVaultShare: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
}

describe("revokeHostedVaultSharesTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      inserted: true,
      item: { id: "mailbox_item_1" },
    });
  });

  it("revokes active grants and appends destination cleanup wakes in the same transaction", async () => {
    const tx = buildTx();
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(revokeHostedVaultSharesTx({
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      now,
      projectionKinds: ["sleep-times.v0"],
      source: "hosted-group",
      tx,
    })).resolves.toBe(1);

    expect(tx.hostedVaultShare.updateMany).toHaveBeenCalledWith({
      data: {
        revokedAt: now,
        source: "hosted-group",
        status: "revoked",
      },
      where: {
        id: { in: ["share_1"] },
        status: "granted",
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
      tx,
    });
  });

  it("does not append cleanup when no active grant matched", async () => {
    const tx = buildTx();
    tx.hostedVaultShare.findMany.mockResolvedValue([]);

    await expect(revokeHostedVaultSharesTx({
      destinationMemberId: "member_referee",
      now: new Date("2026-07-01T00:00:00.000Z"),
      projectionKinds: ["sleep-times.v0"],
      source: "hosted-group",
      tx,
    })).resolves.toBe(0);

    expect(tx.hostedVaultShare.updateMany).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });
});
