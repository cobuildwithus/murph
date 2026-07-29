import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  backfillHostedThreadRouteAccountProjections,
  createHostedThreadRouteAccountProjectionBackfillStore,
  readHostedThreadRouteAccountProjectionReadiness,
  type HostedThreadRouteAccountProjectionBackfillCandidate,
} from "@/src/lib/hosted-routing/thread-route-account-projection-backfill";
import {
  buildHostedThreadDeliveryRoute,
} from "@/src/lib/hosted-routing/thread-delivery-route";
import {
  parseHostedThreadRouteAccountProjectionScriptOptions,
} from "@/scripts/backfill-hosted-thread-route-account-projections";

describe("hosted thread route account projection backfill", () => {
  it("projects a legacy null route once and then replays idempotently", async () => {
    const accountLookupKey = requireValue(
      createHostedPhoneLookupKey("+15550100001"),
    );
    const candidate = buildCandidate({ accountLookupKey });
    let storedAccountLookupKey: string | null = null;
    const store = {
      applyCandidate: vi.fn(async (input: {
        accountLookupKey: string;
        candidate: HostedThreadRouteAccountProjectionBackfillCandidate;
      }) => {
        if (
          storedAccountLookupKey !== null
          || input.candidate.threadLookupKey !== candidate.threadLookupKey
        ) {
          return false;
        }
        storedAccountLookupKey = input.accountLookupKey;
        return true;
      }),
      countCandidates: vi.fn(async () => Number(storedAccountLookupKey === null)),
      listCandidates: vi.fn(async () =>
        storedAccountLookupKey === null ? [candidate] : []
      ),
    };
    const openRoute = vi.fn().mockResolvedValue(
      buildHostedThreadDeliveryRoute({
        accountLookupKey,
        channel: "linq",
        threadId: "chat_group_123",
      }),
    );

    await expect(backfillHostedThreadRouteAccountProjections({
      mode: "apply",
      openRoute,
      store,
    })).resolves.toMatchObject({
      appliedRows: 1,
      conflicts: 0,
      hasMore: false,
      invalidRows: 0,
      remainingRows: 0,
      selectedRows: 1,
      wouldApplyRows: 1,
    });
    await expect(backfillHostedThreadRouteAccountProjections({
      mode: "apply",
      openRoute,
      store,
    })).resolves.toMatchObject({
      appliedRows: 0,
      hasMore: false,
      remainingRows: 0,
      selectedRows: 0,
    });
    expect(store.applyCandidate).toHaveBeenCalledTimes(1);
    expect(storedAccountLookupKey).toBe(accountLookupKey);
  });

  it("dry-runs a valid projection without invoking the mutation owner", async () => {
    const accountLookupKey = requireValue(
      createHostedPhoneLookupKey("+15550100001"),
    );
    const candidate = buildCandidate({ accountLookupKey });
    const store = {
      applyCandidate: vi.fn(),
      countCandidates: vi.fn().mockResolvedValue(1),
      listCandidates: vi.fn().mockResolvedValue([candidate]),
    };

    await expect(backfillHostedThreadRouteAccountProjections({
      openRoute: vi.fn().mockResolvedValue(
        buildHostedThreadDeliveryRoute({
          accountLookupKey,
          channel: "linq",
          threadId: "chat_group_123",
        }),
      ),
      store,
    })).resolves.toMatchObject({
      appliedRows: 0,
      conflicts: 0,
      hasMore: true,
      invalidRows: 0,
      mode: "dry-run",
      remainingRows: 1,
      selectedRows: 1,
      wouldApplyRows: 1,
    });
    expect(store.applyCandidate).not.toHaveBeenCalled();
    expect(store.countCandidates).toHaveBeenCalledTimes(1);
  });

  it("surfaces invalid legacy authority without claiming projection readiness", async () => {
    const accountLookupKey = requireValue(
      createHostedPhoneLookupKey("+15550100001"),
    );
    const candidate = buildCandidate({ accountLookupKey });
    const store = {
      applyCandidate: vi.fn(),
      countCandidates: vi.fn().mockResolvedValue(1),
      listCandidates: vi.fn().mockResolvedValue([candidate]),
    };

    await expect(backfillHostedThreadRouteAccountProjections({
      mode: "apply",
      openRoute: vi.fn().mockResolvedValue(
        buildHostedThreadDeliveryRoute({
          accountLookupKey,
          channel: "linq",
          threadId: "different_chat",
        }),
      ),
      store,
    })).resolves.toMatchObject({
      appliedRows: 0,
      hasMore: true,
      invalidRows: 1,
      remainingRows: 1,
      selectedRows: 1,
      wouldApplyRows: 0,
    });
    await expect(readHostedThreadRouteAccountProjectionReadiness({ store }))
      .resolves.toEqual({
        complete: false,
        pendingRows: 1,
      });
    expect(store.applyCandidate).not.toHaveBeenCalled();
  });
});

describe("hosted thread route account projection store", () => {
  it("fences writes to the exact still-unprojected route authority", async () => {
    const accountLookupKey = requireValue(
      createHostedPhoneLookupKey("+15550100001"),
    );
    const candidate = buildCandidate({ accountLookupKey });
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([candidate]);
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const store = createHostedThreadRouteAccountProjectionBackfillStore({
      hostedThreadRoute: {
        count,
        findMany,
        updateMany,
      },
    } as never);
    const candidateWhere = {
      accountLookupKey: null,
      channel: {
        in: ["linq", "telegram"],
      },
    };

    await expect(store.listCandidates({ take: 51 })).resolves.toEqual([candidate]);
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [
        { channel: "asc" },
        { threadIdentityLookupKey: "asc" },
      ],
      select: {
        channel: true,
        containerMemberId: true,
        deliveryRouteEncrypted: true,
        threadIdentityLookupKey: true,
        threadLookupKey: true,
        updatedAt: true,
      },
      take: 51,
      where: candidateWhere,
    });
    await expect(store.countCandidates()).resolves.toBe(1);
    expect(count).toHaveBeenCalledWith({ where: candidateWhere });

    await expect(store.applyCandidate({
      accountLookupKey,
      candidate,
    })).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        accountLookupKey,
      },
      where: {
        accountLookupKey: null,
        channel: candidate.channel,
        containerMemberId: candidate.containerMemberId,
        deliveryRouteEncrypted: candidate.deliveryRouteEncrypted,
        threadIdentityLookupKey: candidate.threadIdentityLookupKey,
        threadLookupKey: candidate.threadLookupKey,
        updatedAt: candidate.updatedAt,
      },
    });
    await expect(store.applyCandidate({
      accountLookupKey,
      candidate,
    })).resolves.toBe(false);
  });
});

describe("hosted thread route account projection migration", () => {
  it("is an additive nullable projection with a query index", () => {
    const migration = readFileSync(new URL(
      "../prisma/migrations/20260729170000_hosted_thread_route_account_lookup_key/migration.sql",
      import.meta.url,
    ), "utf8");

    expect(migration).toContain(
      'ADD COLUMN "account_lookup_key" TEXT;',
    );
    expect(migration).toContain(
      'ON "hosted_thread_route"("channel", "account_lookup_key");',
    );
    expect(migration).not.toMatch(/\bDROP\b|\bNOT NULL\b|\bALTER COLUMN\b/u);
  });
});

describe("thread route projection script options", () => {
  it("defaults to dry-run and supports bounded apply and readiness modes", () => {
    expect(parseHostedThreadRouteAccountProjectionScriptOptions([])).toEqual({
      batchSize: undefined,
      check: false,
      help: false,
      mode: "dry-run",
    });
    expect(parseHostedThreadRouteAccountProjectionScriptOptions([
      "--apply",
      "--batch-size",
      "25",
    ])).toEqual({
      batchSize: 25,
      check: false,
      help: false,
      mode: "apply",
    });
    expect(parseHostedThreadRouteAccountProjectionScriptOptions(["--check"]))
      .toEqual({
        batchSize: undefined,
        check: true,
        help: false,
        mode: "dry-run",
      });
  });

  it("rejects unsafe or ambiguous option combinations", () => {
    expect(() => parseHostedThreadRouteAccountProjectionScriptOptions([
      "--apply",
      "--check",
    ])).toThrow("cannot be combined");
    expect(() => parseHostedThreadRouteAccountProjectionScriptOptions([
      "--batch-size",
      "101",
    ])).toThrow("1 through 100");
  });
});

function buildCandidate(input: {
  accountLookupKey: string;
}): HostedThreadRouteAccountProjectionBackfillCandidate {
  const threadIdentityLookupKey = requireValue(
    createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_123",
    }),
  );
  const threadLookupKey = requireValue(
    createHostedExternalThreadLookupKey({
      accountLookupKey: input.accountLookupKey,
      channel: "linq",
      threadId: "chat_group_123",
    }),
  );
  return {
    channel: "linq",
    containerMemberId: "member_thread_container_123",
    deliveryRouteEncrypted: "encrypted-route",
    threadIdentityLookupKey,
    threadLookupKey,
    updatedAt: new Date("2026-07-29T12:00:00.000Z"),
  };
}

function requireValue(value: string | null): string {
  if (!value) {
    throw new Error("Expected a blinded lookup key.");
  }
  return value;
}
