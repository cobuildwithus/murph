import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureHostedGroupStructureForThreadContainerTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  ensureHostedGroupStructureForThreadContainerTx:
    mocks.ensureHostedGroupStructureForThreadContainerTx,
}));

import {
  parseHostedGroupMaterializationScriptOptions,
  runHostedGroupMaterializationCommand,
} from "@/scripts/backfill-hosted-group-materialization";

function createBackfillPrismaStub(candidateIds: readonly string[]) {
  const materializedIds = new Set<string>();
  let inFlightTransactions = 0;
  let maxInFlightTransactions = 0;
  const count = vi.fn(async () =>
    candidateIds.filter((id) => !materializedIds.has(id)).length);
  const findMany = vi.fn(async (input: { take: number }) =>
    candidateIds
      .filter((id) => !materializedIds.has(id))
      .slice(0, input.take)
      .map((memberId) => ({ memberId })));
  const transaction = vi.fn(async (
    callback: (tx: object) => Promise<unknown>,
  ) => {
    inFlightTransactions += 1;
    maxInFlightTransactions = Math.max(
      maxInFlightTransactions,
      inFlightTransactions,
    );
    try {
      return await callback({});
    } finally {
      inFlightTransactions -= 1;
    }
  });

  return {
    count,
    findMany,
    materializedIds,
    maxInFlightTransactions: () => maxInFlightTransactions,
    prisma: {
      $transaction: transaction,
      hostedThreadContainer: { count, findMany },
    } as never,
    transaction,
  };
}

describe("hosted group materialization command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is bounded, serial, resumable, and idempotent across apply batches", async () => {
    const fixture = createBackfillPrismaStub([
      "container_a",
      "container_b",
      "container_c",
    ]);
    mocks.ensureHostedGroupStructureForThreadContainerTx.mockImplementation(
      async ({ containerMemberId }: { containerMemberId: string }) => {
        const created = !fixture.materializedIds.has(containerMemberId);
        fixture.materializedIds.add(containerMemberId);
        return { created, groupId: `group_${containerMemberId}` };
      },
    );
    const options = parseHostedGroupMaterializationScriptOptions([
      "--apply",
      "--batch-size",
      "2",
    ]);

    await expect(runHostedGroupMaterializationCommand({
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      options,
      prisma: fixture.prisma,
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
    expect(fixture.materializedIds).toEqual(
      new Set(["container_a", "container_b"]),
    );

    await expect(runHostedGroupMaterializationCommand({
      options,
      prisma: fixture.prisma,
    })).resolves.toMatchObject({
      failedRows: 0,
      hasMore: false,
      materializedRows: 1,
      remainingRows: 0,
      selectedRows: 1,
    });
    await expect(runHostedGroupMaterializationCommand({
      options,
      prisma: fixture.prisma,
    })).resolves.toMatchObject({
      hasMore: false,
      materializedRows: 0,
      remainingRows: 0,
      selectedRows: 0,
    });
    expect(fixture.transaction).toHaveBeenCalledTimes(3);
    expect(fixture.maxInFlightTransactions()).toBe(1);
  });

  it("continues after one row failure and retries it on the next run", async () => {
    const fixture = createBackfillPrismaStub([
      "container_a",
      "container_b",
      "container_c",
    ]);
    let failContainerAOnce = true;
    mocks.ensureHostedGroupStructureForThreadContainerTx.mockImplementation(
      async ({ containerMemberId }: { containerMemberId: string }) => {
        if (containerMemberId === "container_a" && failContainerAOnce) {
          failContainerAOnce = false;
          throw new Error("transient test failure");
        }
        fixture.materializedIds.add(containerMemberId);
        return { created: true, groupId: `group_${containerMemberId}` };
      },
    );
    const options = parseHostedGroupMaterializationScriptOptions([
      "--apply",
      "--batch-size",
      "2",
    ]);

    await expect(runHostedGroupMaterializationCommand({
      options,
      prisma: fixture.prisma,
    })).resolves.toMatchObject({
      failedRows: 1,
      hasMore: true,
      materializedRows: 1,
      remainingRows: 2,
      selectedRows: 2,
    });
    await expect(runHostedGroupMaterializationCommand({
      options,
      prisma: fixture.prisma,
    })).resolves.toMatchObject({
      failedRows: 0,
      hasMore: false,
      materializedRows: 2,
      remainingRows: 0,
      selectedRows: 2,
    });
  });

  it("converges when another writer materialized a selected row first", async () => {
    const fixture = createBackfillPrismaStub(["container_a"]);
    mocks.ensureHostedGroupStructureForThreadContainerTx.mockImplementation(
      async ({ containerMemberId }: { containerMemberId: string }) => {
        fixture.materializedIds.add(containerMemberId);
        return { created: false, groupId: "group_existing" };
      },
    );

    await expect(runHostedGroupMaterializationCommand({
      options: parseHostedGroupMaterializationScriptOptions(["--apply"]),
      prisma: fixture.prisma,
    })).resolves.toMatchObject({
      alreadyMaterializedRows: 1,
      failedRows: 0,
      materializedRows: 0,
      remainingRows: 0,
    });
  });

  it("dry-runs with the production predicate and without opening a transaction", async () => {
    const fixture = createBackfillPrismaStub(["container_a"]);

    await expect(runHostedGroupMaterializationCommand({
      options: parseHostedGroupMaterializationScriptOptions([]),
      prisma: fixture.prisma,
    })).resolves.toEqual({
      alreadyMaterializedRows: 0,
      batchSize: 50,
      failedRows: 0,
      hasMore: true,
      materializedRows: 0,
      mode: "dry-run",
      remainingRows: 1,
      selectedRows: 1,
      wouldMaterializeRows: 1,
    });
    expect(fixture.findMany).toHaveBeenCalledWith({
      orderBy: { memberId: "asc" },
      select: { memberId: true },
      take: 51,
      where: {
        member: { hostedGroupRuntime: { is: null } },
        routes: { some: {} },
      },
    });
    expect(fixture.transaction).not.toHaveBeenCalled();
  });

  it("reports exact readiness from the same production predicate", async () => {
    const fixture = createBackfillPrismaStub([]);

    await expect(runHostedGroupMaterializationCommand({
      options: parseHostedGroupMaterializationScriptOptions(["--check"]),
      prisma: fixture.prisma,
    })).resolves.toEqual({
      complete: true,
      pendingRows: 0,
    });
    expect(fixture.count).toHaveBeenCalledWith({
      where: {
        member: { hostedGroupRuntime: { is: null } },
        routes: { some: {} },
      },
    });
    expect(fixture.findMany).not.toHaveBeenCalled();
  });
});

describe("hosted group materialization script options", () => {
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
  });

  it("rejects unbounded or ambiguous options", () => {
    expect(() => parseHostedGroupMaterializationScriptOptions([
      "--batch-size",
      "101",
    ])).toThrow("integer from 1 through 100");
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
