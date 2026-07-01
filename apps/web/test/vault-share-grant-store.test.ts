import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

import {
  grantHostedVaultShareTx,
  revokeHostedVaultSharesTx,
  revokeOutgoingHostedVaultSharesForMemberDeletionTx,
} from "@/src/lib/hosted-vault-share/share-grant-store";

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

    expect(tx.hostedVaultShare.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        destinationMemberId: "member_referee",
        grantorMemberId: "member_grantor",
        projectionKind: { in: ["sleep-times.v0"] },
        source: "hosted-group",
        status: "granted",
      },
    }));
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

describe("grantHostedVaultShareTx", () => {
  it("rotates the share id when a revoked tuple is granted again", async () => {
    const tx = {
      hostedVaultShare: {
        create: vi.fn(),
        findUnique: vi.fn(async () => ({ id: "share_old", status: "revoked" })),
        update: vi.fn(async () => undefined),
      },
    } as unknown as Prisma.TransactionClient & {
      hostedVaultShare: {
        create: ReturnType<typeof vi.fn>;
        findUnique: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
    };
    const now = new Date("2026-07-02T00:00:00.000Z");

    await expect(grantHostedVaultShareTx({
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      now,
      projectionKind: "sleep-times.v0",
      source: "hosted-group",
      tx,
    })).resolves.toEqual({ status: "granted" });

    expect(tx.hostedVaultShare.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        grantedAt: now,
        id: expect.stringMatching(/^hbvs_/u),
        revokedAt: null,
        source: "hosted-group",
        status: "granted",
      }),
      where: {
        grantorMemberId_projectionKind_destinationMemberId: {
          destinationMemberId: "member_referee",
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
        },
      },
    });
    const updateArg = tx.hostedVaultShare.update.mock.calls[0]?.[0];
    expect(updateArg.data.id).not.toBe("share_old");
  });

  it("leaves an active grant from another source unchanged", async () => {
    const tx = {
      hostedVaultShare: {
        create: vi.fn(),
        findUnique: vi.fn(async () => ({
          id: "share_direct",
          source: "operator-direct",
          status: "granted",
        })),
        update: vi.fn(async () => undefined),
      },
    } as unknown as Prisma.TransactionClient & {
      hostedVaultShare: {
        create: ReturnType<typeof vi.fn>;
        findUnique: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
    };

    await expect(grantHostedVaultShareTx({
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      now: new Date("2026-07-02T00:00:00.000Z"),
      projectionKind: "sleep-times.v0",
      source: "hosted-group",
      tx,
    })).resolves.toEqual({ status: "foreign-active-grant" });

    expect(tx.hostedVaultShare.create).not.toHaveBeenCalled();
    expect(tx.hostedVaultShare.update).not.toHaveBeenCalled();
  });

  it("keeps an existing active grant from the same source idempotent", async () => {
    const tx = {
      hostedVaultShare: {
        create: vi.fn(),
        findUnique: vi.fn(async () => ({
          id: "share_group",
          source: "hosted-group",
          status: "granted",
        })),
        update: vi.fn(async () => undefined),
      },
    } as unknown as Prisma.TransactionClient & {
      hostedVaultShare: {
        create: ReturnType<typeof vi.fn>;
        findUnique: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
    };

    await expect(grantHostedVaultShareTx({
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      now: new Date("2026-07-02T00:00:00.000Z"),
      projectionKind: "sleep-times.v0",
      source: "hosted-group",
      tx,
    })).resolves.toEqual({ status: "already-granted" });

    expect(tx.hostedVaultShare.create).not.toHaveBeenCalled();
    expect(tx.hostedVaultShare.update).not.toHaveBeenCalled();
  });
});

describe("revokeOutgoingHostedVaultSharesForMemberDeletionTx", () => {
  it("revokes outgoing shares only for surviving destinations and returns cleanup signals", async () => {
    const tx = buildTx();
    tx.hostedVaultShare.findMany.mockResolvedValue([{
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      id: "share_1",
      projectionKind: "sleep-times.v0",
    }]);
    const now = new Date("2026-07-01T00:00:00.000Z");

    await expect(revokeOutgoingHostedVaultSharesForMemberDeletionTx({
      grantorMemberIds: ["member_grantor", "member_owned_runtime"],
      now,
      source: "hosted-account.delete",
      tx,
    })).resolves.toEqual({
      cleanupSignals: [{
        mailboxItemId: "mailbox_item_1",
        memberId: "member_referee",
      }],
      revokedCount: 1,
    });

    expect(tx.hostedVaultShare.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        destinationMemberId: { notIn: ["member_grantor", "member_owned_runtime"] },
        grantorMemberId: { in: ["member_grantor", "member_owned_runtime"] },
        status: "granted",
      },
    }));
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith(expect.objectContaining({
      envelope: expect.objectContaining({
        kind: "vault-share.revoke",
        userId: "member_referee",
      }),
      tx,
    }));
  });
});
