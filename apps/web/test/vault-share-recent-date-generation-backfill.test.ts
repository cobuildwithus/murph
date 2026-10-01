import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_RECENT_DATE_PROJECTION_KINDS,
} from "@murphai/hosted-execution/vault-share";

const mocks = vi.hoisted(() => ({
  appendMaintenance: vi.fn(),
}));

vi.mock("@/src/lib/hosted-vault-share/projection-maintenance", () => ({
  appendHostedVaultShareProjectionMaintenanceTx: mocks.appendMaintenance,
}));

import {
  backfillHostedVaultShareRecentDateGenerations,
  createHostedVaultShareRecentDateBackfillStore,
} from "@/src/lib/hosted-vault-share/recent-date-generation-backfill";

const CUTOFF = new Date("2026-08-11T20:00:00.000Z");
const NOW = new Date("2026-08-11T20:01:00.000Z");

describe("hosted vault-share recent-date generation backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defines only recent-date health scopes as rollout candidates", () => {
    expect(HOSTED_VAULT_SHARE_RECENT_DATE_PROJECTION_KINDS).toContain("sleep-times.v0");
    expect(HOSTED_VAULT_SHARE_RECENT_DATE_PROJECTION_KINDS).not.toContain("profile-name.v0");
    expect(HOSTED_VAULT_SHARE_RECENT_DATE_PROJECTION_KINDS).not.toContain("time-zone.v0");
    expect(HOSTED_VAULT_SHARE_RECENT_DATE_PROJECTION_KINDS).not.toContain("group-email.v0");
    expect(HOSTED_VAULT_SHARE_RECENT_DATE_PROJECTION_KINDS).not.toContain(
      HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
    );
  });

  it("rotates materialized and orphaned pending grants with one atomic maintenance row", async () => {
    const updateMany = vi.fn(async (input: {
      data: {
        grantedAt: Date;
        id: string;
        projectionSnapshotCiphertext: null;
        projectionSourceWorkspaceVersion: null;
      };
      where: Record<string, unknown>;
    }) => {
      void input;
      return { count: 1 };
    });
    const tx = {
      hostedVaultShare: {
        findMany: vi.fn(async () => [{ id: "share_legacy_1" }, { id: "share_pending_1" }]),
        updateMany,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (operation) => await operation(tx)),
    } as unknown as PrismaClient;
    mocks.appendMaintenance.mockResolvedValue({
      lane: "system",
      laneSeq: "8",
      mailboxItemId: "mailbox_projection_1",
      memberId: "member_1",
    });

    const result = await createHostedVaultShareRecentDateBackfillStore(prisma).refreshGrantor({
      grantedBefore: CUTOFF,
      grantorMemberId: "member_1",
      now: NOW,
    });

    expect(result.refreshedGrants).toBe(2);
    expect(result.hasDeferredGrants).toBe(false);
    expect(tx.hostedVaultShare.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 26,
    }));
    expect(tx.hostedVaultShare.updateMany).toHaveBeenCalledTimes(2);
    for (const [call] of updateMany.mock.calls) {
      expect(call).toEqual({
        data: {
          grantedAt: NOW,
          id: expect.not.stringMatching(/^share_legacy_/u),
          projectionSnapshotCiphertext: null,
          projectionSourceWorkspaceVersion: null,
        },
        where: expect.objectContaining({
          destination: {
            hostedGroupRuntime: { isNot: null },
          },
          grantedAt: { lt: CUTOFF },
          grantorMemberId: "member_1",
          projectionKind: { in: [...HOSTED_VAULT_SHARE_RECENT_DATE_PROJECTION_KINDS] },
          status: "granted",
        }),
      });
    }
    const nextGrantIds = updateMany.mock.calls.map(([call]) => call.data.id);
    expect(mocks.appendMaintenance).toHaveBeenCalledWith({
      grantIds: nextGrantIds,
      memberId: "member_1",
      tx,
    });
  });

  it("processes at most 25 grants and reports a deferred grant", async () => {
    const grants = Array.from({ length: 26 }, (_, index) => ({
      id: `share_legacy_${index + 1}`,
    }));
    const updateMany = vi.fn(async (_input: { data: { id: string } }) => ({
      count: 1,
    }));
    const tx = {
      hostedVaultShare: {
        findMany: vi.fn(async () => grants),
        updateMany,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (operation) => await operation(tx)),
    } as unknown as PrismaClient;
    mocks.appendMaintenance.mockResolvedValue({
      lane: "system",
      laneSeq: "8",
      mailboxItemId: "mailbox_projection_1",
      memberId: "member_1",
    });

    const result = await createHostedVaultShareRecentDateBackfillStore(prisma).refreshGrantor({
      grantedBefore: CUTOFF,
      grantorMemberId: "member_1",
      now: NOW,
    });

    expect(result).toMatchObject({
      hasDeferredGrants: true,
      refreshedGrants: 25,
    });
    expect(tx.hostedVaultShare.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 26,
    }));
    expect(updateMany).toHaveBeenCalledTimes(25);
    expect(mocks.appendMaintenance).toHaveBeenCalledWith({
      grantIds: expect.arrayContaining(Array.from({ length: 25 }, (_, index) =>
        updateMany.mock.calls[index]?.[0].data.id)),
      memberId: "member_1",
      tx,
    });
  });

  it("is bounded, retry-safe, and leaves durable recovery when an exact signal fails", async () => {
    const refreshGrantor = vi.fn()
      .mockResolvedValueOnce({
        hasDeferredGrants: false,
        refreshedGrants: 2,
        signal: {
          lane: "system",
          laneSeq: "1",
          mailboxItemId: "mailbox_1",
          memberId: "member_1",
        },
      })
      .mockResolvedValueOnce({
        hasDeferredGrants: false,
        refreshedGrants: 1,
        signal: {
          lane: "system",
          laneSeq: "1",
          mailboxItemId: "mailbox_2",
          memberId: "member_2",
        },
      });
    const listCandidateGrantors = vi.fn()
      .mockResolvedValueOnce(["member_1", "member_2", "member_more"])
      .mockResolvedValueOnce([]);
    const signal = vi.fn()
      .mockRejectedValueOnce(new Error("synthetic signal failure"))
      .mockResolvedValueOnce(undefined);
    const store = { listCandidateGrantors, refreshGrantor };

    await expect(backfillHostedVaultShareRecentDateGenerations({
      batchSize: 2,
      grantedBefore: CUTOFF,
      mode: "apply",
      now: () => NOW,
      signal,
      store,
    })).resolves.toEqual({
      batchSize: 2,
      hasMore: true,
      maintenanceRows: 2,
      mode: "apply",
      refreshedGrants: 3,
      selectedGrantors: 2,
      signalFailures: 1,
    });
    expect(listCandidateGrantors).toHaveBeenCalledWith({
      grantedBefore: CUTOFF,
      take: 3,
    });
    expect(refreshGrantor).toHaveBeenCalledTimes(2);

    await expect(backfillHostedVaultShareRecentDateGenerations({
      batchSize: 2,
      grantedBefore: CUTOFF,
      mode: "apply",
      signal,
      store,
    })).resolves.toMatchObject({
      hasMore: false,
      maintenanceRows: 0,
      refreshedGrants: 0,
      selectedGrantors: 0,
    });
    expect(refreshGrantor).toHaveBeenCalledTimes(2);
  });

  it("reports more work when one selected grantor has deferred grants", async () => {
    const store = {
      listCandidateGrantors: vi.fn(async () => ["member_1"]),
      refreshGrantor: vi.fn(async () => ({
        hasDeferredGrants: true,
        refreshedGrants: 25,
        signal: null,
      })),
    };

    await expect(backfillHostedVaultShareRecentDateGenerations({
      batchSize: 1,
      grantedBefore: CUTOFF,
      mode: "apply",
      now: () => NOW,
      store,
    })).resolves.toMatchObject({
      hasMore: true,
      refreshedGrants: 25,
      selectedGrantors: 1,
    });
  });
});
