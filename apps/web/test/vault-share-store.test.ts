import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  isHostedRuntimeInactiveAccessError: vi.fn((error: unknown) => (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE"
  )),
  requireHostedRuntimeActiveAccessForUpdateTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  isHostedRuntimeInactiveAccessError: mocks.isHostedRuntimeInactiveAccessError,
  requireHostedRuntimeActiveAccessForUpdateTx:
    mocks.requireHostedRuntimeActiveAccessForUpdateTx,
}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
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
  share: {
    destinationMemberId: string;
    grantorMemberId: string;
    id: string;
    projectionKind: string;
  },
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
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(undefined);
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
    expect(mocks.requireHostedRuntimeActiveAccessForUpdateTx).toHaveBeenCalledWith(
      "member_grantor",
      { prisma: TX },
    );
    expect(mocks.requireHostedRuntimeActiveAccessForUpdateTx).toHaveBeenCalledWith(
      "member_referee",
      { prisma: TX },
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(3);
    // Every append runs on the single transaction client, not the base prisma client.
    for (const call of mocks.appendHostedMailboxEnvelopeTx.mock.calls) {
      expect(call[0].tx).toBe(TX);
    }
  });

  it("builds the envelope deterministically: revisioned dedupe-key eventId and record-derived occurredAt", async () => {
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
    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0].envelope;
    expect(envelope).toEqual({
      delivery: {
        grantorMemberId: "member_grantor",
        projectionKind: "sleep-times.v0",
        record: FIRST_RECORD,
        schema: "murph.vault-share.delivery.v1",
        shareId: "share_1",
      },
      eventId: expect.stringMatching(/^vault-share:share_1:2026-06-07:[A-Za-z0-9_-]{32}$/u),
      kind: "vault-share.delivery",
      occurredAt: "2026-06-07T00:00:00.000Z",
      userId: "member_referee",
    });
  });

  it("dedupes exact replay while appending corrected payload for the same record key", async () => {
    const prisma = fakePrisma();
    const seenEventIds = new Set<string>();
    mocks.appendHostedMailboxEnvelopeTx.mockImplementation(async (input) => {
      const eventId = input.envelope.eventId;
      if (seenEventIds.has(eventId)) {
        return { duplicate: true, inserted: false };
      }
      seenEventIds.add(eventId);
      return {
        inserted: true,
        item: { id: `mailbox_item_${seenEventIds.size}` },
      };
    });
    const correctedRecord = {
      ...FIRST_RECORD,
      data: {
        ...FIRST_RECORD.data,
        sleepEndAt: "2026-06-08T06:59:00.000Z",
      },
    };

    const result = await deliverHostedVaultShareRecords({
      prisma,
      records: [FIRST_RECORD, FIRST_RECORD, correctedRecord],
      share: SHARE,
    });

    const eventIds = mocks.appendHostedMailboxEnvelopeTx.mock.calls.map(
      (call) => call[0].envelope.eventId,
    );
    expect(result).toEqual({ lastAppendedMailboxItemId: "mailbox_item_2" });
    expect(eventIds[0]).toBe(eventIds[1]);
    expect(eventIds[2]).not.toBe(eventIds[0]);
    expect(eventIds[2]).toMatch(/^vault-share:share_1:2026-06-07:[A-Za-z0-9_-]{32}$/u);
  });

  it("derives profile-name revision identity from content alone, ignoring occurredAt drift", async () => {
    // Current-state kind: the same unchanged name re-offered with a different
    // occurredAt must dedupe instead of minting a fresh mailbox dedupe key, while a
    // changed name still appends a new revision.
    const prisma = fakePrisma([
      shareAuthorityRow({ ...SHARE, projectionKind: "profile-name.v0" }, "granted"),
    ]);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      inserted: true,
      item: { id: "mailbox_item_1" },
    });
    const record = (occurredAt: string, displayName: string) => ({
      data: { displayName },
      occurredAt,
      recordKey: "profile-name",
    });

    await deliverHostedVaultShareRecords({
      prisma,
      records: [
        record("2026-01-01T00:00:00.000Z", "Theo"),
        record("2026-03-15T12:34:56.000Z", "Theo"),
        record("2026-03-15T12:34:56.000Z", "Odin"),
      ],
      share: { ...SHARE, projectionKind: "profile-name.v0" },
    });

    const eventIds = mocks.appendHostedMailboxEnvelopeTx.mock.calls.map(
      (call) => call[0].envelope.eventId,
    );
    expect(eventIds[0]).toBe(eventIds[1]);
    expect(eventIds[2]).not.toBe(eventIds[0]);
    expect(eventIds[0]).toMatch(/^vault-share:share_1:profile-name:[A-Za-z0-9_-]{32}$/u);
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

  it("rechecks destination runtime authority inside the append transaction", async () => {
    const prisma = fakePrisma();
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockImplementation(
      async (memberId: string) => {
        if (memberId === "member_referee") {
          throw hostedOnboardingError({
            code: "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE",
            httpStatus: 403,
            message: "Hosted runtime mailbox access is not active.",
          });
        }
      },
    );
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
    expect(mocks.requireHostedRuntimeActiveAccessForUpdateTx).toHaveBeenCalledWith(
      "member_grantor",
      { prisma: TX },
    );
    expect(mocks.requireHostedRuntimeActiveAccessForUpdateTx).toHaveBeenCalledWith(
      "member_referee",
      { prisma: TX },
    );
    expect(TX.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("rechecks grantor runtime authority inside the append transaction", async () => {
    const prisma = fakePrisma();
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockImplementation(
      async (memberId: string) => {
        if (memberId === "member_grantor") {
          throw hostedOnboardingError({
            code: "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE",
            httpStatus: 403,
            message: "Hosted runtime mailbox access is not active.",
          });
        }
      },
    );
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
    expect(mocks.requireHostedRuntimeActiveAccessForUpdateTx).toHaveBeenCalledWith(
      "member_grantor",
      { prisma: TX },
    );
    expect(TX.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("propagates retryable grantor runtime authority failures instead of treating them as inactive", async () => {
    const prisma = fakePrisma();
    const authorityChanged = hostedOnboardingError({
      code: "HOSTED_RUNTIME_ACCESS_AUTHORITY_CHANGED",
      httpStatus: 409,
      message: "Hosted runtime access changed while validating authority. Retry the request.",
      retryable: true,
    });
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockRejectedValue(authorityChanged);

    await expect(deliverHostedVaultShareRecords({
      prisma,
      records: RECORDS,
      share: SHARE,
    })).rejects.toBe(authorityChanged);

    expect(TX.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });
});
