import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

import { deliverHostedVaultShareRecords } from "@/src/lib/hosted-mailbox/vault-share-store";

const SHARE = {
  destinationMemberId: "member_referee",
  grantorMemberId: "member_grantor",
  id: "share_1",
  projectionKind: "sleep-times.v0" as const,
};

function nightRecord(date: string, nextDate: string): {
  data: { date: string; sleepEndAt: string; sleepStartAt: string };
  occurredAt: string;
  recordKey: string;
} {
  return {
    data: {
      date,
      sleepEndAt: `${nextDate}T06:31:00.000Z`,
      sleepStartAt: `${date}T22:04:00.000Z`,
    },
    occurredAt: `${date}T00:00:00.000Z`,
    recordKey: date,
  };
}

const FIRST_RECORD = nightRecord("2026-06-07", "2026-06-08");
const RECORDS = [
  FIRST_RECORD,
  nightRecord("2026-06-08", "2026-06-09"),
  nightRecord("2026-06-09", "2026-06-10"),
];

const TX = {
  $queryRaw: vi.fn(),
  tag: "tx",
};

function shareAuthorityRow(
  share: typeof SHARE,
  status: "granted" | "revoked" = "granted",
): {
  destinationMemberId: string;
  grantorMemberId: string;
  id: string;
  projectionKind: string;
  status: string;
} {
  return {
    destinationMemberId: share.destinationMemberId,
    grantorMemberId: share.grantorMemberId,
    id: share.id,
    projectionKind: share.projectionKind,
    status,
  };
}

function fakePrisma(
  shareRows: readonly ReturnType<typeof shareAuthorityRow>[] = [shareAuthorityRow(SHARE)],
): PrismaClient {
  TX.$queryRaw.mockResolvedValue(shareRows);
  return {
    $transaction: vi.fn(async (fn: (tx: typeof TX) => Promise<unknown>) => {
      return fn(TX);
    }),
  } as unknown as PrismaClient;
}

describe("deliverHostedVaultShareRecords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends every record in one transaction and reports the last inserted item id", async () => {
    const prisma = fakePrisma();
    mocks.appendHostedMailboxEnvelopeTx
      .mockResolvedValueOnce({ inserted: true, item: { id: "mailbox_item_1" } })
      // Re-offered records dedupe (inserted: false) and must not clobber or report an id.
      .mockResolvedValueOnce({ duplicate: true, inserted: false })
      .mockResolvedValueOnce({ inserted: true, item: { id: "mailbox_item_3" } });

    const result = await deliverHostedVaultShareRecords({
      prisma,
      records: RECORDS,
      share: SHARE,
    });

    expect(result).toEqual({ lastAppendedMailboxItemId: "mailbox_item_3" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(3);
    // Every append runs on the single transaction client, not the base prisma client.
    for (const call of mocks.appendHostedMailboxEnvelopeTx.mock.calls) {
      expect(call[0].tx).toBe(TX);
    }
  });

  it("builds the envelope deterministically: dedupe-key eventId and record-derived occurredAt", async () => {
    const prisma = fakePrisma();
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      inserted: true,
      item: { id: "mailbox_item_1" },
    });

    await deliverHostedVaultShareRecords({
      prisma,
      records: [FIRST_RECORD],
      share: SHARE,
    });

    // The store passes no occurredAt: the builder derives it from the parsed record, so
    // the plaintext occurred_at mailbox column can only ever hold the night-date midnight.
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: {
        delivery: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          record: FIRST_RECORD,
          schema: "murph.vault-share.delivery.v1",
          shareId: "share_1",
        },
        eventId: "vault-share:share_1:2026-06-07",
        kind: "vault-share.delivery",
        occurredAt: "2026-06-07T00:00:00.000Z",
        userId: "member_referee",
      },
      tx: TX,
    });
  });

  it("reports a null item id when every record is a dedupe duplicate", async () => {
    const prisma = fakePrisma();
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      duplicate: true,
      inserted: false,
    });

    const result = await deliverHostedVaultShareRecords({
      prisma,
      records: RECORDS,
      share: SHARE,
    });

    // Null is the route's signal-skip contract: a fully re-delivered offer wakes nobody.
    expect(result).toEqual({ lastAppendedMailboxItemId: null });
  });

  it("rechecks the durable share authority before appending records", async () => {
    const prisma = fakePrisma([shareAuthorityRow(SHARE, "revoked")]);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      inserted: true,
      item: { id: "mailbox_item_1" },
    });

    const result = await deliverHostedVaultShareRecords({
      prisma,
      records: RECORDS,
      share: SHARE,
    });

    expect(result).toEqual({ lastAppendedMailboxItemId: null });
    expect(TX.$queryRaw).toHaveBeenCalledTimes(1);
    expect(Array.from(TX.$queryRaw.mock.calls[0]?.[0] ?? []).join("?"))
      .toContain("FOR UPDATE");
    expect(TX.$queryRaw.mock.calls[0]?.[1]).toBe("share_1");
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });
});
