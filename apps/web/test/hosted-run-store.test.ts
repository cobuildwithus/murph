import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countPendingHostedIngressEvents: vi.fn(),
  ensureHostedExecutionCursorRowTx: vi.fn(),
  hydrateHostedIngressEventsTx: vi.fn(),
  lockHostedExecutionCursorRowTx: vi.fn(),
  projectHostedExecutionCursorRecord: vi.fn((cursor: CursorRow) => ({
    committedSeq: cursor.committedSeq.toString(),
    nextRuntimeWakeAt: cursor.nextRuntimeWakeAt?.toISOString() ?? null,
    nextRuntimeWakeReason: cursor.nextRuntimeWakeReason,
    nextSeq: cursor.nextSeq.toString(),
    snapshotRef: null,
    userId: cursor.userId,
    version: cursor.version.toString(),
  })),
}));

vi.mock("@/src/lib/hosted-ingress/store-data", () => ({
  ensureHostedExecutionCursorRowTx: mocks.ensureHostedExecutionCursorRowTx,
  lockHostedExecutionCursorRowTx: mocks.lockHostedExecutionCursorRowTx,
}));

vi.mock("@/src/lib/hosted-ingress/store-projections", () => ({
  hydrateHostedIngressEventsTx: mocks.hydrateHostedIngressEventsTx,
  projectHostedExecutionCursorRecord: mocks.projectHostedExecutionCursorRecord,
}));

vi.mock("@/src/lib/hosted-ingress/store", () => ({
  countPendingHostedIngressEvents: mocks.countPendingHostedIngressEvents,
}));

import {
  acquireHostedRunTx,
  commitHostedRunTx,
  finalizeHostedRunTx,
  releaseHostedRunFinalizeTx,
} from "@/src/lib/hosted-run/store";

type CursorRow = {
  committedSeq: bigint;
  createdAt: Date;
  nextRuntimeWakeAt: Date | null;
  nextRuntimeWakeReason: string | null;
  nextSeq: bigint;
  snapshotRef: null;
  updatedAt: Date;
  userId: string;
  version: bigint;
};

function buildCursorRow(overrides: Partial<CursorRow> = {}): CursorRow {
  const now = new Date("2026-04-20T00:00:00.000Z");

  return {
    committedSeq: 9n,
    createdAt: now,
    nextRuntimeWakeAt: null,
    nextRuntimeWakeReason: null,
    nextSeq: 13n,
    snapshotRef: null,
    updatedAt: now,
    userId: "member_123",
    version: 3n,
    ...overrides,
  };
}

function hashRunToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function buildRunRow(input: {
  eventSeqs: string[];
  runToken: string;
  wakeIds: string[];
  inputCommittedSeq?: bigint;
  inputCursorVersion?: bigint;
  status?: "acquired" | "committed_needs_finalize" | "finalizing" | "finalized" | "failed" | "superseded";
  triggerKind?: "external_ingress" | "runtime_timer" | "manual_repair" | "retry_finalize";
}) {
  const now = new Date("2026-04-20T00:00:00.000Z");

  return {
    acquiredAt: now,
    attempt: 1,
    attestationRef: null,
    committedAt: null,
    createdAt: now,
    errorClass: null,
    errorCode: null,
    eventCount: input.eventSeqs.length,
    eventKindsJson: input.eventSeqs.length === 0 ? [] : ["conversation.message"],
    eventSeqsJson: input.eventSeqs,
    executorCodeDigest: null,
    executorKind: "cloudflare-container",
    failedAt: null,
    finalSnapshotRef: null,
    finalizedAt: null,
    id: "run_123",
    inputCommittedSeq: input.inputCommittedSeq ?? 9n,
    inputCursorVersion: input.inputCursorVersion ?? 3n,
    inputSnapshotRef: null,
    nextRuntimeWakeAt: null,
    nextRuntimeWakeReason: null,
    outputCommittedSeq: null,
    outputCursorVersion: null,
    preparedAt: null,
    preparedSnapshotRef: null,
    redactedSummaryJson: null,
    runTokenHash: hashRunToken(input.runToken),
    signedResultRef: null,
    startedAt: null,
    status: input.status ?? "acquired",
    triggerKind: input.triggerKind ?? "external_ingress",
    updatedAt: now,
    userId: "member_123",
    wakeIdsJson: input.wakeIds,
  };
}

function asHostedRunMutationTx<T extends Record<string, unknown>>(tx: T) {
  return Object.assign(Object.create(null), tx) as Parameters<typeof commitHostedRunTx>[0]["tx"];
}

describe("commitHostedRunTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countPendingHostedIngressEvents.mockResolvedValue(0);
    mocks.hydrateHostedIngressEventsTx.mockResolvedValue([]);
    mocks.lockHostedExecutionCursorRowTx.mockResolvedValue(undefined);
  });

  it("fails closed and releases acquired wakes when commit stops short of the highest acquired seq", async () => {
    const cursor = buildCursorRow();
    const runToken = "run-token.partial";
    const run = buildRunRow({
      eventSeqs: ["10", "11", "12"],
      runToken,
      wakeIds: ["wake_10", "wake_11", "wake_12"],
    });
    const hostedExecutionCursorUpdateMany = vi.fn();
    const hostedWakeUpdate = vi.fn();
    const hostedWakeUpdateMany = vi.fn(async () => ({ count: 3 }));
    const hostedRunUpdate = vi.fn(async ({ data }: {
      data: {
        errorClass: string;
        errorCode: string;
        failedAt: Date;
        status: "failed";
        updatedAt: Date;
      };
      where: { id: string };
    }) => ({
      ...run,
      errorClass: data.errorClass,
      errorCode: data.errorCode,
      failedAt: data.failedAt,
      status: data.status,
      updatedAt: data.updatedAt,
    }));
    const tx = asHostedRunMutationTx({
      hostedExecutionCursor: {
        updateMany: hostedExecutionCursorUpdateMany,
      },
      hostedRun: {
        findFirst: vi.fn(async () => run),
        update: hostedRunUpdate,
      },
      hostedIngressEvent: {
        update: hostedWakeUpdate,
        updateMany: hostedWakeUpdateMany,
      },
    });

    mocks.ensureHostedExecutionCursorRowTx.mockResolvedValue(cursor);

    const result = await commitHostedRunTx({
      expectedCursorVersion: 3n,
      outputCommittedSeq: 10n,
      runId: run.id,
      runToken,
      tx,
      userId: "member_123",
    });

    expect(result.committed).toBe(false);
    expect(result.needsFinalize).toBe(false);
    expect(result.run).toMatchObject({
      errorCode: "HOSTED_RUN_PARTIAL_COMMIT_UNSUPPORTED",
      inputCommittedSeq: "9",
      status: "failed",
    });
    expect(hostedExecutionCursorUpdateMany).not.toHaveBeenCalled();
    expect(hostedWakeUpdate).not.toHaveBeenCalled();
    expect(hostedWakeUpdateMany).toHaveBeenCalledWith({
      data: {
        runId: null,
        state: "pending",
      },
      where: {
        runId: run.id,
        seq: { gt: 9n },
        state: "running",
        userId: "member_123",
      },
    });
    expect(hostedRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        errorCode: "HOSTED_RUN_PARTIAL_COMMIT_UNSUPPORTED",
      }),
      where: { id: run.id },
    }));
  });

  it("still commits zero-event runtime-timer runs when outputCommittedSeq matches the input cursor", async () => {
    const initialCursor = buildCursorRow();
    const committedCursor = buildCursorRow({
      committedSeq: 9n,
      version: 4n,
    });
    const runToken = "run-token.timer";
    const run = buildRunRow({
      eventSeqs: [],
      runToken,
      triggerKind: "runtime_timer",
      wakeIds: [],
    });
    const hostedExecutionCursorUpdateMany = vi.fn(async () => ({ count: 1 }));
    const hostedRunUpdate = vi.fn(async ({ data }: {
      data: {
        committedAt: Date;
        finalSnapshotRef: unknown;
        finalizedAt: Date;
        nextRuntimeWakeAt: Date | null;
        nextRuntimeWakeReason: string | null;
        outputCommittedSeq: bigint;
        outputCursorVersion: bigint;
        preparedAt: Date;
        preparedSnapshotRef: unknown;
        redactedSummaryJson?: unknown;
        status: "finalized";
      };
      where: { id: string };
    }) => ({
      ...run,
      committedAt: data.committedAt,
      finalSnapshotRef: null,
      finalizedAt: data.finalizedAt,
      nextRuntimeWakeAt: data.nextRuntimeWakeAt,
      nextRuntimeWakeReason: data.nextRuntimeWakeReason,
      outputCommittedSeq: data.outputCommittedSeq,
      outputCursorVersion: data.outputCursorVersion,
      preparedAt: data.preparedAt,
      preparedSnapshotRef: null,
      redactedSummaryJson: data.redactedSummaryJson ?? null,
      status: data.status,
    }));
    const tx = asHostedRunMutationTx({
      hostedExecutionCursor: {
        updateMany: hostedExecutionCursorUpdateMany,
      },
      hostedRun: {
        findFirst: vi.fn(async () => run),
        update: hostedRunUpdate,
      },
      hostedIngressEvent: {
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    mocks.ensureHostedExecutionCursorRowTx
      .mockResolvedValueOnce(initialCursor)
      .mockResolvedValueOnce(initialCursor)
      .mockResolvedValueOnce(committedCursor);

    const result = await commitHostedRunTx({
      expectedCursorVersion: 3n,
      finalizeRequired: false,
      outputCommittedSeq: 9n,
      runId: run.id,
      runToken,
      tx,
      userId: "member_123",
    });

    expect(result.committed).toBe(true);
    expect(result.needsFinalize).toBe(false);
    expect(result.cursor).toMatchObject({
      committedSeq: "9",
      version: "4",
    });
    expect(result.run).toMatchObject({
      outputCommittedSeq: "9",
      outputCursorVersion: "4",
      status: "finalized",
      triggerKind: "runtime_timer",
    });
    expect(hostedExecutionCursorUpdateMany).toHaveBeenCalledWith({
      data: {
        committedSeq: 9n,
        nextRuntimeWakeAt: null,
        nextRuntimeWakeReason: null,
        snapshotRef: expect.anything(),
        version: { increment: 1 },
      },
      where: {
        committedSeq: 9n,
        userId: "member_123",
        version: 3n,
      },
    });
  });
});

describe("acquireHostedRunTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countPendingHostedIngressEvents.mockResolvedValue(0);
    mocks.hydrateHostedIngressEventsTx.mockResolvedValue([]);
    mocks.lockHostedExecutionCursorRowTx.mockResolvedValue(undefined);
  });

  it("claims resumable finalize runs by moving them to finalizing with a fresh token", async () => {
    const cursor = buildCursorRow();
    const resumableRun = buildRunRow({
      eventSeqs: [],
      runToken: "stale-token",
      status: "committed_needs_finalize",
      triggerKind: "retry_finalize",
      wakeIds: [],
    });
    const claimedRun = {
      ...resumableRun,
      attempt: 2,
      status: "finalizing" as const,
      updatedAt: new Date("2026-04-20T00:05:00.000Z"),
    };
    const hostedRunFindMany = vi.fn(async () => [resumableRun]);
    const hostedRunUpdateMany = vi.fn(async () => ({ count: 1 }));
    const hostedRunFindFirst = vi.fn(async () => claimedRun);
    const tx = asHostedRunMutationTx({
      hostedRun: {
        findFirst: hostedRunFindFirst,
        findMany: hostedRunFindMany,
        updateMany: hostedRunUpdateMany,
      },
      hostedIngressEvent: {
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    mocks.ensureHostedExecutionCursorRowTx.mockResolvedValue(cursor);

    const result = await acquireHostedRunTx({
      now: new Date("2026-04-20T00:05:00.000Z"),
      tx,
      userId: "member_123",
    });

    expect(result.acquired).toBe(true);
    expect(result.resumeFinalize).toBe(true);
    expect(result.events).toEqual([]);
    expect(result.pendingWakeCount).toBe(0);
    expect(result.run).toMatchObject({
      id: resumableRun.id,
      status: "finalizing",
      triggerKind: "retry_finalize",
    });
    expect(result.runToken).toEqual(expect.any(String));
    if (!result.runToken) {
      throw new Error("Expected resumable finalize claim to return a run token.");
    }
    expect(hostedRunUpdateMany).toHaveBeenCalledWith({
      data: {
        attempt: { increment: 1 },
        runTokenHash: hashRunToken(result.runToken),
        status: "finalizing",
        updatedAt: new Date("2026-04-20T00:05:00.000Z"),
      },
      where: {
        id: resumableRun.id,
        status: "committed_needs_finalize",
        userId: "member_123",
      },
    });
  });

  it("resets stale finalizing runs back to resumable and reclaims them instead of failing", async () => {
    const cursor = buildCursorRow();
    const staleFinalizingRun = buildRunRow({
      eventSeqs: [],
      runToken: "stale-finalizing-token",
      status: "finalizing",
      triggerKind: "retry_finalize",
      wakeIds: [],
    });
    const resetRun = {
      ...staleFinalizingRun,
      status: "committed_needs_finalize" as const,
    };
    const claimedRun = {
      ...staleFinalizingRun,
      attempt: 2,
      status: "finalizing" as const,
      updatedAt: new Date("2026-04-20T00:20:00.000Z"),
    };
    const hostedRunFindMany = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([staleFinalizingRun])
      .mockResolvedValueOnce([resetRun]);
    const hostedRunUpdate = vi.fn(async ({ data }: {
      data: { status: "committed_needs_finalize" };
      where: { id: string };
    }) => ({
      ...staleFinalizingRun,
      status: data.status,
    }));
    const hostedRunUpdateMany = vi.fn(async () => ({ count: 1 }));
    const hostedRunFindFirst = vi.fn(async () => claimedRun);
    const hostedWakeUpdateMany = vi.fn();
    const tx = asHostedRunMutationTx({
      hostedRun: {
        findFirst: hostedRunFindFirst,
        findMany: hostedRunFindMany,
        update: hostedRunUpdate,
        updateMany: hostedRunUpdateMany,
      },
      hostedIngressEvent: {
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: hostedWakeUpdateMany,
      },
    });

    mocks.ensureHostedExecutionCursorRowTx.mockResolvedValue(cursor);

    const result = await acquireHostedRunTx({
      now: new Date("2026-04-20T00:20:00.000Z"),
      tx,
      userId: "member_123",
    });

    expect(result.acquired).toBe(true);
    expect(result.resumeFinalize).toBe(true);
    expect(result.run).toMatchObject({
      id: staleFinalizingRun.id,
      status: "finalizing",
    });
    if (!result.runToken) {
      throw new Error("Expected stale finalize recovery to return a run token.");
    }
    expect(hostedRunUpdate).toHaveBeenCalledWith({
      data: {
        status: "committed_needs_finalize",
      },
      where: { id: staleFinalizingRun.id },
    });
    expect(hostedRunUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        runTokenHash: hashRunToken(result.runToken),
        status: "finalizing",
      }),
      where: expect.objectContaining({
        id: staleFinalizingRun.id,
        status: "committed_needs_finalize",
      }),
    }));
    expect(hostedWakeUpdateMany).not.toHaveBeenCalled();
    expect(hostedRunUpdate.mock.invocationCallOrder[0]).toBeLessThan(hostedRunUpdateMany.mock.invocationCallOrder[0]);
  });
});

describe("finalizeHostedRunTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countPendingHostedIngressEvents.mockResolvedValue(0);
    mocks.hydrateHostedIngressEventsTx.mockResolvedValue([]);
    mocks.lockHostedExecutionCursorRowTx.mockResolvedValue(undefined);
  });

  it("only finalizes runs that have already been claimed into finalizing", async () => {
    const cursor = buildCursorRow();
    const hostedRunFindFirst = vi.fn(async () => null);
    const tx = asHostedRunMutationTx({
      hostedRun: {
        findFirst: hostedRunFindFirst,
      },
      hostedIngressEvent: {
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    mocks.ensureHostedExecutionCursorRowTx.mockResolvedValue(cursor);

    const result = await finalizeHostedRunTx({
      finalSnapshotRef: {
        hash: "hash-finalized",
        key: "snapshot/finalized",
        size: 128,
        updatedAt: "2026-04-20T00:21:00.000Z",
      },
      runId: "run_123",
      runToken: "stale-token",
      tx,
      userId: "member_123",
    });

    expect(result.finalized).toBe(false);
    expect(result.run).toBeNull();
    expect(hostedRunFindFirst).toHaveBeenCalledWith({
      where: {
        id: "run_123",
        status: { in: ["finalizing"] },
        userId: "member_123",
      },
    });
  });
});

describe("releaseHostedRunFinalizeTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countPendingHostedIngressEvents.mockResolvedValue(0);
    mocks.hydrateHostedIngressEventsTx.mockResolvedValue([]);
    mocks.lockHostedExecutionCursorRowTx.mockResolvedValue(undefined);
  });

  it("moves a claimed finalizing run back to committed_needs_finalize for retry", async () => {
    const cursor = buildCursorRow();
    const runToken = "run-token.finalize-release";
    const run = buildRunRow({
      eventSeqs: ["10"],
      runToken,
      status: "finalizing",
      wakeIds: ["wake_10"],
    });
    const hostedRunUpdate = vi.fn(async ({ data }: {
      data: {
        errorClass: string;
        errorCode: string;
        status: "committed_needs_finalize";
        updatedAt: Date;
      };
      where: { id: string };
    }) => ({
      ...run,
      errorClass: data.errorClass,
      errorCode: data.errorCode,
      status: data.status,
      updatedAt: data.updatedAt,
    }));
    const tx = asHostedRunMutationTx({
      hostedRun: {
        findFirst: vi.fn(async () => run),
        update: hostedRunUpdate,
      },
      hostedIngressEvent: {
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    mocks.ensureHostedExecutionCursorRowTx.mockResolvedValue(cursor);

    const result = await releaseHostedRunFinalizeTx({
      failureCode: "HOSTED_RUN_FINALIZE_BACKPRESSURED",
      runId: run.id,
      runToken,
      tx,
      userId: "member_123",
    });

    expect(result.released).toBe(true);
    expect(result.run).toMatchObject({
      errorClass: "hosted_run_finalize_retryable",
      errorCode: "HOSTED_RUN_FINALIZE_BACKPRESSURED",
      status: "committed_needs_finalize",
    });
    expect(hostedRunUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        errorClass: "hosted_run_finalize_retryable",
        errorCode: "HOSTED_RUN_FINALIZE_BACKPRESSURED",
        status: "committed_needs_finalize",
      }),
      where: { id: run.id },
    });
  });

  it("fails closed when the finalizing token no longer matches", async () => {
    const cursor = buildCursorRow();
    const tx = asHostedRunMutationTx({
      hostedRun: {
        findFirst: vi.fn(async () => null),
      },
      hostedIngressEvent: {
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    mocks.ensureHostedExecutionCursorRowTx.mockResolvedValue(cursor);

    const result = await releaseHostedRunFinalizeTx({
      runId: "run_123",
      runToken: "stale-token",
      tx,
      userId: "member_123",
    });

    expect(result.released).toBe(false);
    expect(result.run).toBeNull();
  });
});
