import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
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
  adoptHostedRunTurnInputTx,
  acquireHostedRunTx,
  commitHostedRunTx,
  finalizeHostedRunTx,
  peekHostedRunTurnInputTx,
  readHostedRunStatus,
  recordHostedRunLog,
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
  ingressEventIds: string[];
  inputCommittedSeq?: bigint;
  inputCursorVersion?: bigint;
  status?: "acquired" | "running" | "committed_needs_finalize" | "finalizing" | "finalized" | "failed" | "superseded";
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
    ingressEventIdsJson: input.ingressEventIds,
  };
}

function asHostedRunMutationTx<T extends Record<string, unknown>>(tx: T) {
  return Object.assign(Object.create(null), tx) as Parameters<typeof commitHostedRunTx>[0]["tx"];
}

function asHostedRunStoreClient<T extends Record<string, unknown>>(client: T) {
  return Object.assign(Object.create(null), client) as Parameters<typeof readHostedRunStatus>[0]["prisma"];
}

function asHostedRunLogPrisma<T extends Record<string, unknown>>(client: T) {
  return Object.assign(Object.create(null), client) as Parameters<typeof recordHostedRunLog>[0]["prisma"];
}

describe("hosted run log handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countPendingHostedIngressEvents.mockResolvedValue(0);
    mocks.ensureHostedExecutionCursorRowTx.mockResolvedValue(buildCursorRow());
  });

  it("stores only sanitized operator messages and requires the active run token", async () => {
    const runToken = "run-token.logging";
    const run = buildRunRow({
      eventSeqs: ["10"],
      runToken,
      ingressEventIds: ["wake_10"],
    });
    const hostedRunLogCreate = vi.fn(async ({ data }: {
      data: {
        at: Date;
        component: string;
        id: string;
        level: "warn";
        message: string;
        phase: string;
        redactedJson: string;
        runId: string;
        userId: string;
      };
    }) => ({
      ...data,
      createdAt: new Date("2026-04-20T00:01:00.000Z"),
    }));
    const tx = asHostedRunMutationTx({
      hostedRun: {
        findFirst: vi.fn(async () => run),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      hostedRunLog: {
        create: hostedRunLogCreate,
      },
    });
    const prisma = asHostedRunLogPrisma({
      $transaction: async <T>(callback: (inner: typeof tx) => Promise<T>) => callback(tx),
    });

    const result = await recordHostedRunLog({
      component: "runner",
      level: "warn",
      message: "authorization: Bearer top-secret-token https://secret.example.test/path person@example.com",
      prisma,
      redacted: "Runner failed for user person@example.com with Bearer top-secret-token",
      phase: "running",
      runId: run.id,
      runToken,
      userId: run.userId,
    });

    expect(result.logged).toBe(true);
    expect(hostedRunLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        message: "Runner failed for user <redacted-email> with Bearer <redacted-secret>",
        redactedJson: "Runner failed for user <redacted-email> with Bearer <redacted-secret>",
      }),
    });

    const rejected = await recordHostedRunLog({
      component: "runner",
      level: "warn",
      message: "should not log",
      prisma,
      phase: "running",
      runId: run.id,
      runToken: "stale-token",
      userId: run.userId,
    });

    expect(rejected).toEqual({
      logged: false,
      log: null,
    });
  });

  it("returns the redacted string in status responses when present", async () => {
    const runToken = "run-token.status";
    const run = buildRunRow({
      eventSeqs: ["10"],
      runToken,
      ingressEventIds: ["wake_10"],
      status: "committed_needs_finalize",
    });
    const prisma = asHostedRunStoreClient({
      hostedRun: {
        findMany: vi.fn(async () => [run]),
      },
      hostedRunLog: {
        findMany: vi.fn(async () => [
          {
            at: new Date("2026-04-20T00:01:00.000Z"),
            component: "runner",
            createdAt: new Date("2026-04-20T00:01:01.000Z"),
            id: "log_123",
            level: "warn",
            message: "raw runner error with https://secret.example.test/path",
            phase: "running",
            redactedJson: "redacted https://secret.example.test/path person@example.com",
            runId: run.id,
            userId: run.userId,
          },
        ]),
      },
    });

    const result = await readHostedRunStatus({
      includeLogs: true,
      prisma,
      runId: run.id,
      userId: run.userId,
    });

    expect(result.logs).toEqual([
      expect.objectContaining({
        id: "log_123",
        message: "redacted <redacted-url> <redacted-email>",
      }),
    ]);
  });

  it("projects active running runs in status responses", async () => {
    const run = buildRunRow({
      eventSeqs: ["10"],
      ingressEventIds: ["wake_10"],
      runToken: "run-token.running-status",
      status: "running",
    });
    const prisma = asHostedRunStoreClient({
      hostedRun: {
        findMany: vi.fn(async () => [run]),
      },
    });

    const result = await readHostedRunStatus({
      prisma,
      runId: run.id,
      userId: run.userId,
    });

    expect(result.run).toMatchObject({
      id: run.id,
      status: "running",
    });
  });

  it("sanitizes structured redacted payloads before storage and projection", async () => {
    const runToken = "run-token.structured-redaction";
    const run = buildRunRow({
      eventSeqs: ["10"],
      runToken,
      ingressEventIds: ["wake_10"],
    });
    const hostedRunLogCreate = vi.fn(async ({ data }: {
      data: {
        at: Date;
        component: string;
        id: string;
        level: "warn";
        message: string;
        phase: string;
        redactedJson: {
          error: string;
          nested: {
            recipient: string;
          };
        };
        runId: string;
        userId: string;
      };
    }) => ({
      ...data,
      createdAt: new Date("2026-04-20T00:01:00.000Z"),
    }));
    const tx = asHostedRunMutationTx({
      hostedRun: {
        findFirst: vi.fn(async () => run),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      hostedRunLog: {
        create: hostedRunLogCreate,
      },
    });
    const prisma = asHostedRunLogPrisma({
      $transaction: async <T>(callback: (inner: typeof tx) => Promise<T>) => callback(tx),
    });

    const result = await recordHostedRunLog({
      component: "runner",
      level: "warn",
      message: "plain message",
      prisma,
      redacted: {
        error: "Bearer top-secret-token",
        nested: {
          recipient: "person@example.com",
        },
      },
      phase: "running",
      runId: run.id,
      runToken,
      userId: run.userId,
    });

    expect(hostedRunLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        redactedJson: {
          error: "Bearer <redacted-secret>",
          nested: {
            recipient: "<redacted-email>",
          },
        },
      }),
    });
    expect(result.log?.redacted).toEqual({
      error: "Bearer <redacted-secret>",
      nested: {
        recipient: "<redacted-email>",
      },
    });
  });
});

describe("commitHostedRunTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countPendingHostedIngressEvents.mockResolvedValue(0);
    mocks.hydrateHostedIngressEventsTx.mockResolvedValue([]);
    mocks.lockHostedExecutionCursorRowTx.mockResolvedValue(undefined);
  });

  it("commits a contiguous prefix and releases later acquired wakes when commit stops short", async () => {
    const initialCursor = buildCursorRow();
    const committedCursor = buildCursorRow({
      committedSeq: 10n,
      version: 4n,
    });
    const runToken = "run-token.partial";
    const run = buildRunRow({
      eventSeqs: ["10", "11", "12"],
      runToken,
      ingressEventIds: ["wake_10", "wake_11", "wake_12"],
    });
    const hostedExecutionCursorUpdateMany = vi.fn(async () => ({ count: 1 }));
    const hostedIngressEventUpdate = vi.fn(async ({ where, data }: {
      data: {
        completedAt: Date;
        payloadInlineCiphertext: null;
        payloadRef: null;
        quarantineCode: string | null;
        quarantinedAt: Date | null;
        runId: string;
        state: "completed" | "quarantined";
      };
      where: { id: string };
    }) => ({
      id: where.id,
      ...data,
    }));
    const hostedIngressEventUpdateMany = vi.fn(async () => ({ count: 2 }));
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
        findMany: vi.fn(async () => [
          {
            id: "wake_10",
            payloadRef: null,
            quarantineCode: null,
            quarantinedAt: null,
            seq: 10n,
          },
          {
            id: "wake_11",
            payloadRef: null,
            quarantineCode: null,
            quarantinedAt: null,
            seq: 11n,
          },
          {
            id: "wake_12",
            payloadRef: null,
            quarantineCode: null,
            quarantinedAt: null,
            seq: 12n,
          },
        ]),
        update: hostedIngressEventUpdate,
        updateMany: hostedIngressEventUpdateMany,
      },
      hostedIngressPayload: {
        deleteMany: vi.fn(),
      },
    });

    mocks.ensureHostedExecutionCursorRowTx
      .mockResolvedValueOnce(initialCursor)
      .mockResolvedValueOnce(initialCursor)
      .mockResolvedValueOnce(committedCursor);

    const result = await commitHostedRunTx({
      eventResults: [
        {
          ingressEventId: "wake_10",
          state: "completed",
        },
      ],
      expectedCursorVersion: 3n,
      finalizeRequired: false,
      outputCommittedSeq: 10n,
      runId: run.id,
      runToken,
      tx,
      userId: "member_123",
    });

    expect(result.committed).toBe(true);
    expect(result.needsFinalize).toBe(false);
    expect(result.run).toMatchObject({
      outputCommittedSeq: "10",
      outputCursorVersion: "4",
      status: "finalized",
    });
    expect(result.cursor).toMatchObject({
      committedSeq: "10",
      version: "4",
    });
    expect(hostedExecutionCursorUpdateMany).toHaveBeenCalledWith({
      data: {
        browserVaultReplicaRef: Prisma.DbNull,
        committedSeq: 10n,
        nextRuntimeWakeAt: null,
        nextRuntimeWakeReason: null,
        snapshotRef: Prisma.DbNull,
        version: { increment: 1 },
      },
      where: {
        committedSeq: 9n,
        userId: "member_123",
        version: 3n,
      },
    });
    expect(hostedIngressEventUpdate).toHaveBeenCalledWith({
      data: {
        completedAt: expect.any(Date),
        payloadInlineCiphertext: null,
        payloadRef: null,
        quarantineCode: null,
        quarantinedAt: null,
        runId: run.id,
        state: "completed",
      },
      where: { id: "wake_10" },
    });
    expect(hostedIngressEventUpdateMany).toHaveBeenCalledWith({
      data: {
        runId: null,
        state: "pending",
      },
      where: {
        id: { in: ["wake_11", "wake_12"] },
        userId: "member_123",
      },
    });
    expect(hostedRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        outputCommittedSeq: 10n,
        outputCursorVersion: 4n,
        status: "finalized",
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
      ingressEventIds: [],
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
    });
    expect(result.run).toMatchObject({
      outputCommittedSeq: "9",
      outputCursorVersion: "4",
      status: "finalized",
      triggerKind: "runtime_timer",
    });
    expect(hostedExecutionCursorUpdateMany).toHaveBeenCalledWith({
      data: {
        browserVaultReplicaRef: Prisma.DbNull,
        committedSeq: 9n,
        nextRuntimeWakeAt: null,
        nextRuntimeWakeReason: null,
        snapshotRef: Prisma.DbNull,
        version: { increment: 1 },
      },
      where: {
        committedSeq: 9n,
        userId: "member_123",
        version: 3n,
      },
    });
  });

  it("fails closed when an acquired ingress event result is missing", async () => {
    const cursor = buildCursorRow();
    const runToken = "run-token.missing-event-result";
    const run = buildRunRow({
      eventSeqs: ["10", "11"],
      runToken,
      ingressEventIds: ["wake_10", "wake_11"],
    });
    const hostedExecutionCursorUpdateMany = vi.fn();
    const hostedWakeUpdate = vi.fn();
    const hostedWakeUpdateMany = vi.fn(async () => ({ count: 2 }));
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
      eventResults: [
        {
          state: "completed",
          ingressEventId: "wake_10",
        },
      ],
      expectedCursorVersion: 3n,
      finalizeRequired: false,
      outputCommittedSeq: 11n,
      runId: run.id,
      runToken,
      tx,
      userId: run.userId,
    });

    expect(result.committed).toBe(false);
    expect(result.needsFinalize).toBe(false);
    expect(result.run).toMatchObject({
      errorCode: "HOSTED_RUN_EVENT_RESULTS_MISSING",
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
        userId: run.userId,
      },
    });
    expect(hostedRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        errorCode: "HOSTED_RUN_EVENT_RESULTS_MISSING",
      }),
      where: { id: run.id },
    }));
  });

  it("keeps committed runs in committed_needs_finalize when finalizeRequired is true", async () => {
    const initialCursor = buildCursorRow();
    const committedCursor = buildCursorRow({
      committedSeq: 9n,
      version: 4n,
    });
    const runToken = "run-token.needs-finalize";
    const run = buildRunRow({
      eventSeqs: [],
      runToken,
      triggerKind: "runtime_timer",
      ingressEventIds: [],
    });
    const hostedExecutionCursorUpdateMany = vi.fn(async () => ({ count: 1 }));
    const hostedRunUpdate = vi.fn(async ({ data }: {
      data: {
        committedAt: Date;
        nextRuntimeWakeAt: Date | null;
        nextRuntimeWakeReason: string | null;
        outputCommittedSeq: bigint;
        outputCursorVersion: bigint;
        preparedAt: Date;
        preparedSnapshotRef: unknown;
        redactedSummaryJson?: unknown;
        status: "committed_needs_finalize";
      };
      where: { id: string };
    }) => ({
      ...run,
      committedAt: data.committedAt,
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
      finalizeRequired: true,
      outputCommittedSeq: 9n,
      runId: run.id,
      runToken,
      tx,
      userId: "member_123",
    });

    expect(result.committed).toBe(true);
    expect(result.needsFinalize).toBe(true);
    expect(result.cursor).toMatchObject({
      committedSeq: "9",
      version: "4",
    });
    expect(result.run).toMatchObject({
      outputCommittedSeq: "9",
      outputCursorVersion: "4",
      status: "committed_needs_finalize",
      triggerKind: "runtime_timer",
    });
    expect(hostedRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "committed_needs_finalize",
      }),
      where: { id: run.id },
    }));
    expect(hostedExecutionCursorUpdateMany).toHaveBeenCalledWith({
      data: {
        browserVaultReplicaRef: Prisma.DbNull,
        committedSeq: 9n,
        nextRuntimeWakeAt: null,
        nextRuntimeWakeReason: null,
        snapshotRef: Prisma.DbNull,
        version: { increment: 1 },
      },
      where: {
        committedSeq: 9n,
        userId: "member_123",
        version: 3n,
      },
    });
  });

  it("sanitizes redacted summaries before commit persistence", async () => {
    const initialCursor = buildCursorRow();
    const committedCursor = buildCursorRow({
      committedSeq: 9n,
      version: 4n,
    });
    const runToken = "run-token.summary-sanitized";
    const run = buildRunRow({
      eventSeqs: [],
      runToken,
      triggerKind: "runtime_timer",
      ingressEventIds: [],
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
      redactedSummary: {
        error: "Bearer top-secret-token person@example.com",
        nested: {
          phone: "+15555551234",
        },
        url: "https://secret.example.test/path",
      },
      runId: run.id,
      runToken,
      tx,
      userId: "member_123",
    });

    expect(hostedRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        redactedSummaryJson: {
          error: "Bearer <redacted-secret> <redacted-email>",
          nested: {
            phone: "<redacted-phone>",
          },
          url: "<redacted-url>",
        },
      }),
      where: { id: run.id },
    }));
    expect(result.run?.redactedSummary).toEqual({
      error: "Bearer <redacted-secret> <redacted-email>",
      nested: {
        phone: "<redacted-phone>",
      },
      url: "<redacted-url>",
    });
  });

  it("scrubs terminal ingress payload ciphertext and spilled payload rows after commit", async () => {
    const initialCursor = buildCursorRow();
    const committedCursor = buildCursorRow({
      committedSeq: 11n,
      version: 4n,
    });
    const runToken = "run-token.scrub-terminal-payloads";
    const run = buildRunRow({
      eventSeqs: ["10", "11"],
      runToken,
      ingressEventIds: ["wake_10", "wake_11"],
    });
    const hostedExecutionCursorUpdateMany = vi.fn(async () => ({ count: 1 }));
    const hostedIngressEventFindMany = vi.fn(async () => [
      {
        id: "wake_10",
        payloadInlineCiphertext: "inline-ciphertext",
        payloadRef: null,
        quarantineCode: null,
        quarantinedAt: null,
        seq: 10n,
        userId: run.userId,
      },
      {
        id: "wake_11",
        payloadInlineCiphertext: null,
        payloadRef: "wake_11",
        quarantineCode: null,
        quarantinedAt: null,
        seq: 11n,
        userId: run.userId,
      },
    ]);
    const hostedIngressEventUpdate = vi.fn(async ({ where, data }: {
      data: {
        completedAt: Date;
        payloadInlineCiphertext: null;
        payloadRef: null;
        quarantineCode: string | null;
        quarantinedAt: Date | null;
        runId: string;
        state: "completed" | "quarantined";
      };
      where: { id: string };
    }) => ({
      id: where.id,
      ...data,
    }));
    const hostedIngressPayloadDeleteMany = vi.fn(async () => ({ count: 1 }));
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
      hostedIngressEvent: {
        findMany: hostedIngressEventFindMany,
        update: hostedIngressEventUpdate,
        updateMany: vi.fn(),
      },
      hostedIngressPayload: {
        deleteMany: hostedIngressPayloadDeleteMany,
      },
      hostedRun: {
        findFirst: vi.fn(async () => run),
        update: hostedRunUpdate,
      },
    });

    mocks.ensureHostedExecutionCursorRowTx
      .mockResolvedValueOnce(initialCursor)
      .mockResolvedValueOnce(initialCursor)
      .mockResolvedValueOnce(committedCursor);

    const result = await commitHostedRunTx({
      eventResults: [
        {
          state: "completed",
          ingressEventId: "wake_10",
        },
        {
          quarantineCode: "share_payload_rejected",
          state: "quarantined",
          ingressEventId: "wake_11",
        },
      ],
      expectedCursorVersion: 3n,
      finalizeRequired: false,
      outputCommittedSeq: 11n,
      runId: run.id,
      runToken,
      tx,
      userId: run.userId,
    });

    expect(result.committed).toBe(true);
    expect(hostedIngressEventFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["wake_10", "wake_11"] },
        userId: run.userId,
      },
    });
    expect(hostedIngressEventUpdate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        payloadInlineCiphertext: null,
        payloadRef: null,
        quarantineCode: null,
        quarantinedAt: null,
        runId: run.id,
        state: "completed",
      }),
      where: { id: "wake_10" },
    });
    expect(hostedIngressEventUpdate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        payloadInlineCiphertext: null,
        payloadRef: null,
        quarantineCode: "share_payload_rejected",
        quarantinedAt: expect.any(Date),
        runId: run.id,
        state: "quarantined",
      }),
      where: { id: "wake_11" },
    });
    expect(hostedIngressPayloadDeleteMany).toHaveBeenCalledTimes(1);
    expect(hostedIngressPayloadDeleteMany).toHaveBeenCalledWith({
      where: {
        ingressEventId: "wake_11",
        userId: run.userId,
      },
    });
  });
});

describe("hosted run turn input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countPendingHostedIngressEvents.mockResolvedValue(0);
    mocks.hydrateHostedIngressEventsTx.mockImplementation(async ({ records }) =>
      records.map((record: { id: string; kind: string; seq: bigint }) => ({
        behavior: "ordered",
        createdAt: "2026-04-20T00:00:00.000Z",
        id: record.id,
        kind: record.kind,
        occurredAt: "2026-04-20T00:00:00.000Z",
        payloadCiphertext: "ciphertext",
        payloadSchema: "murph.hosted-ingress-execution.v1",
        seq: record.seq.toString(),
        updatedAt: "2026-04-20T00:00:00.000Z",
        userId: "member_123",
      }))
    );
    mocks.lockHostedExecutionCursorRowTx.mockResolvedValue(undefined);
    mocks.ensureHostedExecutionCursorRowTx.mockResolvedValue(buildCursorRow());
  });

  it("peeks pending contiguous ingress after the active run high-water", async () => {
    const runToken = "run-token.turn-input";
    const run = buildRunRow({
      eventSeqs: ["10"],
      ingressEventIds: ["wake_10"],
      runToken,
      status: "running",
    });
    const pendingRows = [
      {
        id: "wake_11",
        kind: "conversation.message",
        seq: 11n,
      },
      {
        id: "wake_12",
        kind: "conversation.message",
        seq: 12n,
      },
    ];
    const hostedIngressEventFindMany = vi.fn(async () => pendingRows);
    const tx = asHostedRunMutationTx({
      hostedRun: {
        findFirst: vi.fn(async () => run),
      },
      hostedIngressEvent: {
        findMany: hostedIngressEventFindMany,
      },
    });

    const result = await peekHostedRunTurnInputTx({
      runId: run.id,
      runToken,
      tx,
      userId: run.userId,
    });

    expect(result.events.map((event) => event.id)).toEqual(["wake_11", "wake_12"]);
    expect(hostedIngressEventFindMany).toHaveBeenCalledWith({
      orderBy: { seq: "asc" },
      take: 64,
      where: {
        quarantinedAt: null,
        runId: null,
        seq: { gt: 10n },
        state: "pending",
        userId: run.userId,
      },
    });
  });

  it("adopts only the requested contiguous prefix into the active run projection", async () => {
    const runToken = "run-token.turn-input-adopt";
    const run = buildRunRow({
      eventSeqs: ["10"],
      ingressEventIds: ["wake_10"],
      runToken,
      status: "running",
    });
    const pendingRows = [
      {
        id: "wake_11",
        kind: "conversation.message",
        seq: 11n,
      },
    ];
    const updatedRun = {
      ...run,
      eventCount: 2,
      eventSeqsJson: ["10", "11"],
      ingressEventIdsJson: ["wake_10", "wake_11"],
    };
    const hostedIngressEventUpdateMany = vi.fn(async () => ({ count: 1 }));
    const hostedRunUpdate = vi.fn(async () => updatedRun);
    const tx = asHostedRunMutationTx({
      hostedRun: {
        findFirst: vi.fn(async () => run),
        update: hostedRunUpdate,
      },
      hostedIngressEvent: {
        findMany: vi.fn(async () => pendingRows),
        updateMany: hostedIngressEventUpdateMany,
      },
    });

    const result = await adoptHostedRunTurnInputTx({
      ingressEventIds: ["wake_11"],
      runId: run.id,
      runToken,
      tx,
      userId: run.userId,
    });

    expect(result.adopted).toBe(true);
    expect(result.events.map((event) => event.id)).toEqual(["wake_11"]);
    expect(result.run?.ingressEventIds).toEqual(["wake_10", "wake_11"]);
    expect(hostedIngressEventUpdateMany).toHaveBeenCalledWith({
      data: {
        runId: run.id,
        state: "running",
      },
      where: {
        id: { in: ["wake_11"] },
        quarantinedAt: null,
        runId: null,
        state: "pending",
        userId: run.userId,
      },
    });
    expect(hostedRunUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventCount: 2,
        eventSeqsJson: ["10", "11"],
        ingressEventIdsJson: ["wake_10", "wake_11"],
      }),
      where: { id: run.id },
    });
  });

  it("does not adopt past a non-matching first pending event", async () => {
    const runToken = "run-token.turn-input-mismatch";
    const run = buildRunRow({
      eventSeqs: ["10"],
      ingressEventIds: ["wake_10"],
      runToken,
      status: "running",
    });
    const hostedIngressEventUpdateMany = vi.fn();
    const hostedRunUpdate = vi.fn();
    const tx = asHostedRunMutationTx({
      hostedRun: {
        findFirst: vi.fn(async () => run),
        update: hostedRunUpdate,
      },
      hostedIngressEvent: {
        findMany: vi.fn(async () => [
          {
            id: "wake_11",
            kind: "assistant.notification.requested",
            seq: 11n,
          },
        ]),
        updateMany: hostedIngressEventUpdateMany,
      },
    });

    const result = await adoptHostedRunTurnInputTx({
      ingressEventIds: ["wake_12"],
      runId: run.id,
      runToken,
      tx,
      userId: run.userId,
    });

    expect(result).toMatchObject({
      adopted: false,
      events: [],
      run: expect.objectContaining({
        ingressEventIds: ["wake_10"],
      }),
    });
    expect(hostedIngressEventUpdateMany).not.toHaveBeenCalled();
    expect(hostedRunUpdate).not.toHaveBeenCalled();
  });
});

describe("acquireHostedRunTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countPendingHostedIngressEvents.mockResolvedValue(0);
    mocks.hydrateHostedIngressEventsTx.mockResolvedValue([]);
    mocks.lockHostedExecutionCursorRowTx.mockResolvedValue(undefined);
  });

  it("returns no work when there are no wakes and no runtime timer unless repair was requested explicitly", async () => {
    const cursor = buildCursorRow();
    const hostedRunCreate = vi.fn();
    const tx = asHostedRunMutationTx({
      hostedRun: {
        create: hostedRunCreate,
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
      hostedIngressEvent: {
        findMany: vi.fn(async () => []),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    mocks.ensureHostedExecutionCursorRowTx.mockResolvedValue(cursor);

    const result = await acquireHostedRunTx({
      tx,
      userId: "member_123",
    });

    expect(result).toMatchObject({
      acquired: false,
      events: [],
      pendingIngressEventCount: 0,
      resumeFinalize: false,
      run: null,
    });
    expect(hostedRunCreate).not.toHaveBeenCalled();
  });

  it("creates an explicit manual repair run even when there are no wakes and no runtime timer", async () => {
    const cursor = buildCursorRow();
    const manualRepairRun = buildRunRow({
      eventSeqs: [],
      ingressEventIds: [],
      runToken: "manual-repair-run-token",
      triggerKind: "manual_repair",
    });
    const hostedRunCreate = vi.fn(async () => manualRepairRun);
    const hostedIngressEventUpdateMany = vi.fn();
    const tx = asHostedRunMutationTx({
      hostedRun: {
        create: hostedRunCreate,
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
      hostedIngressEvent: {
        findMany: vi.fn(async () => []),
        update: vi.fn(),
        updateMany: hostedIngressEventUpdateMany,
      },
    });

    mocks.ensureHostedExecutionCursorRowTx.mockResolvedValue(cursor);

    const result = await acquireHostedRunTx({
      triggerKind: "manual_repair",
      tx,
      userId: "member_123",
    });

    expect(result).toMatchObject({
      acquired: true,
      events: [],
      pendingIngressEventCount: 0,
      resumeFinalize: false,
      run: expect.objectContaining({
        eventCount: 0,
        id: manualRepairRun.id,
        inputCommittedSeq: "9",
        inputCursorVersion: "3",
        triggerKind: "manual_repair",
        userId: "member_123",
      }),
      runToken: expect.any(String),
    });
    expect(hostedRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventCount: 0,
        ingressEventIdsJson: [],
        triggerKind: "manual_repair",
      }),
    });
    expect(hostedIngressEventUpdateMany).not.toHaveBeenCalled();
  });

  it("claims resumable finalize runs by moving them to finalizing with a fresh token", async () => {
    const cursor = buildCursorRow();
    const resumableRun = buildRunRow({
      eventSeqs: [],
      runToken: "stale-token",
      status: "committed_needs_finalize",
      triggerKind: "retry_finalize",
      ingressEventIds: [],
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
    expect(result.pendingIngressEventCount).toBe(0);
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
      ingressEventIds: [],
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

  it("sanitizes redacted summaries before finalize persistence", async () => {
    const cursor = buildCursorRow({
      committedSeq: 11n,
      version: 4n,
    });
    const finalizedCursor = buildCursorRow({
      committedSeq: 11n,
      version: 5n,
    });
    const runToken = "run-token.finalize-summary-sanitized";
    const run = {
      ...buildRunRow({
        eventSeqs: [],
        runToken,
        status: "finalizing",
        triggerKind: "runtime_timer",
        ingressEventIds: [],
      }),
      outputCommittedSeq: 11n,
      outputCursorVersion: 4n,
    };
    const hostedExecutionCursorUpdateMany = vi.fn(async () => ({ count: 1 }));
    const hostedRunUpdate = vi.fn(async ({ data }: {
      data: {
        finalSnapshotRef: unknown;
        finalizedAt: Date;
        nextRuntimeWakeAt: Date | null;
        nextRuntimeWakeReason: string | null;
        outputCursorVersion: bigint;
        redactedSummaryJson?: unknown;
        status: "finalized";
      };
      where: { id: string };
    }) => ({
      ...run,
      finalSnapshotRef: data.finalSnapshotRef,
      finalizedAt: data.finalizedAt,
      nextRuntimeWakeAt: data.nextRuntimeWakeAt,
      nextRuntimeWakeReason: data.nextRuntimeWakeReason,
      outputCursorVersion: data.outputCursorVersion,
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
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    mocks.ensureHostedExecutionCursorRowTx
      .mockResolvedValueOnce(cursor)
      .mockResolvedValueOnce(cursor)
      .mockResolvedValueOnce(finalizedCursor);

    const result = await finalizeHostedRunTx({
      finalSnapshotRef: {
        hash: "hash-finalized",
        key: "snapshot/finalized",
        size: 128,
        updatedAt: "2026-04-20T00:21:00.000Z",
      },
      redactedSummary: {
        email: "person@example.com",
        nested: {
          path: "/tmp/private/output.json",
        },
      },
      runId: run.id,
      runToken,
      tx,
      userId: "member_123",
    });

    expect(hostedExecutionCursorUpdateMany).toHaveBeenCalledWith({
      data: {
        browserVaultReplicaRef: Prisma.DbNull,
        nextRuntimeWakeAt: null,
        nextRuntimeWakeReason: null,
        snapshotRef: {
          hash: "hash-finalized",
          key: "snapshot/finalized",
          size: 128,
          updatedAt: "2026-04-20T00:21:00.000Z",
        },
        version: { increment: 1 },
      },
      where: {
        committedSeq: 11n,
        userId: "member_123",
        version: 4n,
      },
    });
    expect(hostedRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        redactedSummaryJson: {
          email: "<redacted-email>",
          nested: {
            path: "<redacted-path>",
          },
        },
      }),
      where: { id: run.id },
    }));
    expect(result.run?.redactedSummary).toEqual({
      email: "<redacted-email>",
      nested: {
        path: "<redacted-path>",
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
      ingressEventIds: ["wake_10"],
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
