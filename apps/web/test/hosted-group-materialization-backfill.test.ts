import { describe, expect, it, vi } from "vitest";

import {
  backfillHostedGroupMaterialization,
  createHostedGroupMaterializationBackfillStore,
  readHostedGroupMaterializationReadiness,
  type HostedGroupMaterializationBackfillStore,
} from "@/src/lib/hosted-groups/group-materialization-backfill";
import {
  parseHostedGroupMaterializationScriptOptions,
} from "@/scripts/backfill-hosted-group-materialization";

describe("hosted group materialization backfill", () => {
  it("is bounded, resumable, and idempotent across repeated apply batches", async () => {
    const candidates = ["container_a", "container_b", "container_c"];
    const materialized = new Set<string>();
    const store: HostedGroupMaterializationBackfillStore = {
      countCandidateContainerMemberIds: vi.fn(async () =>
        candidates.filter((id) => !materialized.has(id)).length),
      listCandidateContainerMemberIds: vi.fn(async ({ take }) =>
        candidates.filter((id) => !materialized.has(id)).slice(0, take)),
      materializeCandidate: vi.fn(async ({ containerMemberId }) => {
        const created = !materialized.has(containerMemberId);
        materialized.add(containerMemberId);
        return { created };
      }),
    };

    await expect(backfillHostedGroupMaterialization({
      batchSize: 2,
      mode: "apply",
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      store,
    })).resolves.toEqual({
      alreadyMaterializedRows: 0,
      batchSize: 2,
      failedRows: 0,
      hasMore: true,
      materializedRows: 2,
      mode: "apply",
      remainingRows: 1,
      selectedRows: 2,
      wouldMaterializeRows: 2,
    });
    expect(materialized).toEqual(new Set(["container_a", "container_b"]));

    await expect(backfillHostedGroupMaterialization({
      batchSize: 2,
      mode: "apply",
      now: () => new Date("2026-08-25T12:01:00.000Z"),
      store,
    })).resolves.toEqual({
      alreadyMaterializedRows: 0,
      batchSize: 2,
      failedRows: 0,
      hasMore: false,
      materializedRows: 1,
      mode: "apply",
      remainingRows: 0,
      selectedRows: 1,
      wouldMaterializeRows: 1,
    });

    await expect(backfillHostedGroupMaterialization({
      batchSize: 2,
      mode: "apply",
      store,
    })).resolves.toMatchObject({
      hasMore: false,
      materializedRows: 0,
      remainingRows: 0,
      selectedRows: 0,
    });
    expect(store.materializeCandidate).toHaveBeenCalledTimes(3);
  });

  it("continues the bounded batch after a row failure and retries it on the next run", async () => {
    const candidates = ["container_a", "container_b", "container_c"];
    const materialized = new Set<string>();
    let failContainerAOnce = true;
    const store: HostedGroupMaterializationBackfillStore = {
      countCandidateContainerMemberIds: vi.fn(async () =>
        candidates.filter((id) => !materialized.has(id)).length),
      listCandidateContainerMemberIds: vi.fn(async ({ take }) =>
        candidates.filter((id) => !materialized.has(id)).slice(0, take)),
      materializeCandidate: vi.fn(async ({ containerMemberId }) => {
        if (containerMemberId === "container_a" && failContainerAOnce) {
          failContainerAOnce = false;
          throw new Error("transient test failure");
        }
        const created = !materialized.has(containerMemberId);
        materialized.add(containerMemberId);
        return { created };
      }),
    };

    await expect(backfillHostedGroupMaterialization({
      batchSize: 2,
      mode: "apply",
      store,
    })).resolves.toMatchObject({
      failedRows: 1,
      hasMore: true,
      materializedRows: 1,
      remainingRows: 2,
      selectedRows: 2,
    });
    expect(materialized).toEqual(new Set(["container_b"]));

    await expect(backfillHostedGroupMaterialization({
      batchSize: 2,
      mode: "apply",
      store,
    })).resolves.toMatchObject({
      failedRows: 0,
      hasMore: false,
      materializedRows: 2,
      remainingRows: 0,
      selectedRows: 2,
    });
    expect(materialized).toEqual(
      new Set(["container_a", "container_b", "container_c"]),
    );
  });

  it("dry-runs without invoking the structural mutation owner", async () => {
    const store: HostedGroupMaterializationBackfillStore = {
      countCandidateContainerMemberIds: vi.fn(async () => 1),
      listCandidateContainerMemberIds: vi.fn(async () => ["container_a"]),
      materializeCandidate: vi.fn(),
    };

    await expect(backfillHostedGroupMaterialization({
      store,
    })).resolves.toMatchObject({
      materializedRows: 0,
      mode: "dry-run",
      remainingRows: 1,
      selectedRows: 1,
      wouldMaterializeRows: 1,
    });
    expect(store.materializeCandidate).not.toHaveBeenCalled();
  });

  it("reports readiness from the same missing-group candidate query", async () => {
    const store: HostedGroupMaterializationBackfillStore = {
      countCandidateContainerMemberIds: vi.fn(async () => 0),
      listCandidateContainerMemberIds: vi.fn(),
      materializeCandidate: vi.fn(),
    };

    await expect(readHostedGroupMaterializationReadiness({ store }))
      .resolves.toEqual({
        complete: true,
        pendingRows: 0,
      });
    expect(store.countCandidateContainerMemberIds).toHaveBeenCalledOnce();
  });

  it("rejects an unbounded batch size", async () => {
    await expect(backfillHostedGroupMaterialization({
      batchSize: 101,
      store: {
        countCandidateContainerMemberIds: vi.fn(),
        listCandidateContainerMemberIds: vi.fn(),
        materializeCandidate: vi.fn(),
      },
    })).rejects.toThrow(/between 1 and 100/u);
  });
});

describe("hosted group materialization backfill store", () => {
  it("selects only routed thread containers without canonical group state", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([
      { memberId: "container_candidate" },
    ]);
    const store = createHostedGroupMaterializationBackfillStore({
      $transaction: vi.fn(),
      hostedThreadContainer: { count, findMany },
    } as never);
    const where = {
      member: {
        hostedGroupRuntime: { is: null },
      },
      routes: { some: {} },
    };

    await expect(store.listCandidateContainerMemberIds({ take: 51 }))
      .resolves.toEqual(["container_candidate"]);
    expect(findMany).toHaveBeenCalledWith({
      orderBy: { memberId: "asc" },
      select: { memberId: true },
      take: 51,
      where,
    });
    await expect(store.countCandidateContainerMemberIds()).resolves.toBe(1);
    expect(count).toHaveBeenCalledWith({ where });
  });
});

describe("hosted group materialization backfill script options", () => {
  it("defaults to dry-run and supports one bounded apply batch", () => {
    expect(parseHostedGroupMaterializationScriptOptions([])).toEqual({
      batchSize: undefined,
      check: false,
      help: false,
      mode: "dry-run",
    });
    expect(parseHostedGroupMaterializationScriptOptions([
      "--apply",
      "--batch-size",
      "25",
    ])).toEqual({
      batchSize: 25,
      check: false,
      help: false,
      mode: "apply",
    });
    expect(parseHostedGroupMaterializationScriptOptions(["--check"]))
      .toEqual({
        batchSize: undefined,
        check: true,
        help: false,
        mode: "dry-run",
      });
  });

  it("rejects ambiguous check combinations", () => {
    expect(() => parseHostedGroupMaterializationScriptOptions([
      "--apply",
      "--check",
    ])).toThrow("cannot be combined");
    expect(() => parseHostedGroupMaterializationScriptOptions([
      "--check",
      "--batch-size",
      "1",
    ])).toThrow("not used with --check");
  });
});
