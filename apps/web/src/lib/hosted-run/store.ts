import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  HostedRunAcquireResponse,
  HostedRunCommitResponse,
  HostedRunEventResult,
  HostedRunExecutorKind,
  HostedRunFinalizeResponse,
  HostedRunLogLevel,
  HostedRunLogRecord,
  HostedRunLogResponse,
  HostedRunRecord,
  HostedRunStatus,
  HostedRunStatusResponse,
  HostedRunTriggerKind,
  HostedWakeSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import { parseHostedExecutionCursorSnapshotRef } from "@murphai/hosted-execution/parsers";

import { getPrisma } from "../prisma";
import {
  ensureHostedExecutionCursorRowTx,
  lockHostedExecutionCursorRowTx,
} from "../hosted-wake/store-data";
import {
  hydrateHostedWakeRecordsTx,
  projectHostedExecutionCursorRecord,
} from "../hosted-wake/store-projections";
import { countPendingHostedWakes } from "../hosted-wake/store";
import type {
  HostedExecutionCursorRow,
  HostedWakeMutationTx,
  HostedWakeRow,
  HostedWakeStoreClient,
} from "../hosted-wake/store.types";

const DEFAULT_HOSTED_RUN_EVENT_LIMIT = 64;
const HOSTED_RUN_ACTIVE_STALE_AFTER_MS = 15 * 60 * 1000;
const MAX_HOSTED_RUN_EVENT_LIMIT = 256;
const HOSTED_RUN_ACTIVE_STATUSES = new Set<HostedRunStatus>([
  "acquired",
  "running",
  "prepared",
  "finalizing",
]);
const HOSTED_RUN_FINALIZE_RESUMABLE_STATUS: HostedRunStatus = "committed_needs_finalize";
const DEFAULT_HOSTED_RUN_EXECUTOR_KIND: HostedRunExecutorKind = "cloudflare-container";

export type HostedRunStoreClient = PrismaClient | Prisma.TransactionClient;
export type HostedRunMutationTx = Prisma.TransactionClient;

export async function acquireHostedRun(input: {
  executorKind?: HostedRunExecutorKind | null;
  executorCodeDigest?: string | null;
  attestationRef?: string | null;
  signedResultRef?: string | null;
  limit?: number | null;
  now?: Date;
  prisma?: PrismaClient;
  triggerKind?: HostedRunTriggerKind | null;
  userId: string;
}): Promise<HostedRunAcquireResponse> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => acquireHostedRunTx({
    executorKind: input.executorKind,
    executorCodeDigest: input.executorCodeDigest,
    attestationRef: input.attestationRef,
    signedResultRef: input.signedResultRef,
    limit: input.limit,
    now: input.now,
    triggerKind: input.triggerKind,
    tx,
    userId: input.userId,
  }));
}

export async function acquireHostedRunTx(input: {
  executorKind?: HostedRunExecutorKind | null;
  executorCodeDigest?: string | null;
  attestationRef?: string | null;
  signedResultRef?: string | null;
  limit?: number | null;
  now?: Date;
  triggerKind?: HostedRunTriggerKind | null;
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<HostedRunAcquireResponse> {
  const now = input.now ?? new Date();
  const limit = normalizeHostedRunAcquireLimit(input.limit);
  await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  await lockHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const cursor = await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const resumableFinalize = await findResumableFinalizeRunTx({
    tx: input.tx,
    userId: input.userId,
  });

  if (resumableFinalize) {
    const runToken = createHostedRunToken();
    const updated = await input.tx.hostedRun.update({
      where: { id: resumableFinalize.id },
      data: {
        attempt: { increment: 1 },
        runTokenHash: hashHostedRunToken(runToken),
        updatedAt: now,
      },
    });

    return {
      acquired: true,
      cursor: projectHostedExecutionCursorRecord(cursor),
      events: [],
      pendingWakeCount: await countPendingHostedWakes({ prisma: input.tx, userId: input.userId }),
      resumeFinalize: true,
      run: projectHostedRunRecord(updated),
      runToken,
    };
  }

  const activeRun = await findActiveHostedRunTx({
    tx: input.tx,
    userId: input.userId,
  });

  if (activeRun) {
    if (isHostedRunActiveStale(activeRun, now)) {
      await closeHostedRunWithoutCommitTx({
        cursor,
        errorClass: "hosted_run_stale",
        errorCode: "HOSTED_RUN_ACTIVE_STALE",
        run: activeRun,
        status: "failed",
        tx: input.tx,
        userId: input.userId,
      });
    } else {
      return {
        acquired: false,
        cursor: projectHostedExecutionCursorRecord(cursor),
        events: [],
        pendingWakeCount: await countPendingHostedWakes({ prisma: input.tx, userId: input.userId }),
        resumeFinalize: false,
        run: projectHostedRunRecord(activeRun),
      };
    }
  }

  const wakeRows = await listContiguousHostedRunWakeRowsTx({
    cursor,
    limit,
    tx: input.tx,
    userId: input.userId,
  });
  const runtimeTimerDue = isHostedRuntimeTimerDue(cursor, now);
  const triggerKind = resolveHostedRunTriggerKind({
    explicit: input.triggerKind ?? null,
    runtimeTimerDue,
    wakeCount: wakeRows.length,
  });

  if (wakeRows.length === 0 && !runtimeTimerDue && triggerKind !== "manual_repair") {
    return {
      acquired: false,
      cursor: projectHostedExecutionCursorRecord(cursor),
      events: [],
      pendingWakeCount: await countPendingHostedWakes({ prisma: input.tx, userId: input.userId }),
      resumeFinalize: false,
      run: null,
    };
  }

  const runToken = createHostedRunToken();
  const events = await hydrateHostedWakeRecordsTx({
    records: wakeRows,
    tx: input.tx,
  });
  const run = await input.tx.hostedRun.create({
    data: {
      acquiredAt: now,
      eventCount: wakeRows.length,
      eventKindsJson: toPrismaJsonArray(uniqueStrings(wakeRows.map((wake) => wake.kind))),
      eventSeqsJson: toPrismaJsonArray(wakeRows.map((wake) => wake.seq.toString())),
      executorKind: input.executorKind ?? DEFAULT_HOSTED_RUN_EXECUTOR_KIND,
      executorCodeDigest: normalizeNullableHostedRunString(input.executorCodeDigest),
      attestationRef: normalizeNullableHostedRunString(input.attestationRef),
      signedResultRef: normalizeNullableHostedRunString(input.signedResultRef),
      id: randomUUID(),
      inputCommittedSeq: cursor.committedSeq,
      inputCursorVersion: cursor.version,
      inputSnapshotRef: toNullablePrismaJson(cursor.snapshotRef),
      runTokenHash: hashHostedRunToken(runToken),
      status: "acquired",
      triggerKind,
      userId: input.userId,
      wakeIdsJson: toPrismaJsonArray(wakeRows.map((wake) => wake.id)),
    },
  });

  if (wakeRows.length > 0) {
    await input.tx.hostedWake.updateMany({
      where: {
        id: { in: wakeRows.map((wake) => wake.id) },
        userId: input.userId,
      },
      data: {
        runId: run.id,
        state: "running",
      },
    });
  }

  return {
    acquired: true,
    cursor: projectHostedExecutionCursorRecord(cursor),
    events,
    pendingWakeCount: await countPendingHostedWakes({ prisma: input.tx, userId: input.userId }),
    resumeFinalize: false,
    run: projectHostedRunRecord(run),
    runToken,
  };
}

export async function commitHostedRun(input: {
  eventResults?: HostedRunEventResult[];
  expectedCursorVersion: bigint;
  failureClass?: string | null;
  failureCode?: string | null;
  finalizeRequired?: boolean | null;
  nextRuntimeWakeAt?: string | null;
  nextRuntimeWakeReason?: string | null;
  outputCommittedSeq: bigint;
  preparedSnapshotRef?: HostedWakeSnapshotRef;
  prisma?: PrismaClient;
  redactedSummary?: unknown | null;
  runId: string;
  runToken: string;
  userId: string;
}): Promise<HostedRunCommitResponse> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => commitHostedRunTx({ ...input, tx }));
}

export async function commitHostedRunTx(input: {
  eventResults?: HostedRunEventResult[];
  expectedCursorVersion: bigint;
  failureClass?: string | null;
  failureCode?: string | null;
  finalizeRequired?: boolean | null;
  nextRuntimeWakeAt?: string | null;
  nextRuntimeWakeReason?: string | null;
  outputCommittedSeq: bigint;
  preparedSnapshotRef?: HostedWakeSnapshotRef;
  redactedSummary?: unknown | null;
  runId: string;
  runToken: string;
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<HostedRunCommitResponse> {
  const now = new Date();
  await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  await lockHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const cursor = await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const run = await readHostedRunForMutationTx({
    allowedStatuses: ["acquired", "running", "prepared"],
    runId: input.runId,
    runToken: input.runToken,
    tx: input.tx,
    userId: input.userId,
  });

  if (!run) {
    return {
      committed: false,
      cursor: projectHostedExecutionCursorRecord(cursor),
      needsFinalize: false,
      run: null,
    };
  }

  const failureCode = normalizeHostedRunFailureCode(input.failureCode);
  if (failureCode) {
    const failedRun = await closeHostedRunWithoutCommitTx({
      cursor,
      errorClass: normalizeHostedRunFailureClass(input.failureClass) ?? "hosted_run_runtime",
      errorCode: failureCode,
      run,
      status: "failed",
      tx: input.tx,
      userId: input.userId,
    });

    return {
      committed: false,
      cursor: projectHostedExecutionCursorRecord(cursor),
      needsFinalize: false,
      run: projectHostedRunRecord(failedRun),
    };
  }

  if (input.expectedCursorVersion !== run.inputCursorVersion) {
    const failedRun = await closeHostedRunWithoutCommitTx({
      cursor,
      errorCode: "HOSTED_RUN_EXPECTED_CURSOR_VERSION_MISMATCH",
      run,
      status: "failed",
      tx: input.tx,
      userId: input.userId,
    });

    return {
      committed: false,
      cursor: projectHostedExecutionCursorRecord(cursor),
      needsFinalize: false,
      run: projectHostedRunRecord(failedRun),
    };
  }

  if (cursor.version !== run.inputCursorVersion || cursor.committedSeq !== run.inputCommittedSeq) {
    const supersededRun = await closeHostedRunWithoutCommitTx({
      cursor,
      errorCode: "HOSTED_RUN_CURSOR_CONFLICT",
      run,
      status: "superseded",
      tx: input.tx,
      userId: input.userId,
    });

    return {
      committed: false,
      cursor: projectHostedExecutionCursorRecord(cursor),
      needsFinalize: false,
      run: projectHostedRunRecord(supersededRun),
    };
  }

  if (input.outputCommittedSeq < run.inputCommittedSeq) {
    const failedRun = await closeHostedRunWithoutCommitTx({
      cursor,
      errorCode: "HOSTED_RUN_OUTPUT_SEQ_REGRESSION",
      run,
      status: "failed",
      tx: input.tx,
      userId: input.userId,
    });

    return {
      committed: false,
      cursor: projectHostedExecutionCursorRecord(cursor),
      needsFinalize: false,
      run: projectHostedRunRecord(failedRun),
    };
  }

  const acquiredSeqs = readHostedRunBigIntArray(run.eventSeqsJson, "Hosted run eventSeqsJson");
  const acquiredWakeIds = readHostedRunStringArray(run.wakeIdsJson, "Hosted run wakeIdsJson");
  const highestAcquiredSeq = acquiredSeqs.length === 0
    ? run.inputCommittedSeq
    : acquiredSeqs[acquiredSeqs.length - 1];

  if (input.outputCommittedSeq > highestAcquiredSeq) {
    const failedRun = await closeHostedRunWithoutCommitTx({
      cursor,
      errorCode: "HOSTED_RUN_OUTPUT_SEQ_OUTSIDE_ACQUIRED_RANGE",
      run,
      status: "failed",
      tx: input.tx,
      userId: input.userId,
    });

    return {
      committed: false,
      cursor: projectHostedExecutionCursorRecord(cursor),
      needsFinalize: false,
      run: projectHostedRunRecord(failedRun),
    };
  }

  const nextSnapshotRef = input.preparedSnapshotRef === undefined
    ? cursorSnapshotRefToPrismaJson(cursor.snapshotRef)
    : toNullablePrismaJson(input.preparedSnapshotRef);
  const nextRuntimeWakeAt = input.nextRuntimeWakeAt === undefined
    ? cursor.nextRuntimeWakeAt
    : normalizeHostedRunWakeAt(input.nextRuntimeWakeAt);
  const nextRuntimeWakeReason = input.nextRuntimeWakeReason === undefined
    ? cursor.nextRuntimeWakeReason
    : normalizeHostedRunWakeReason(input.nextRuntimeWakeReason);
  const updateResult = await input.tx.hostedExecutionCursor.updateMany({
    where: {
      committedSeq: run.inputCommittedSeq,
      userId: input.userId,
      version: run.inputCursorVersion,
    },
    data: {
      committedSeq: input.outputCommittedSeq,
      nextRuntimeWakeAt,
      nextRuntimeWakeReason,
      snapshotRef: nextSnapshotRef,
      version: { increment: 1 },
    },
  });

  if (updateResult.count !== 1) {
    const current = await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
    const supersededRun = await closeHostedRunWithoutCommitTx({
      cursor: current,
      errorCode: "HOSTED_RUN_CURSOR_CAS_LOST",
      run,
      status: "superseded",
      tx: input.tx,
      userId: input.userId,
    });

    return {
      committed: false,
      cursor: projectHostedExecutionCursorRecord(current),
      needsFinalize: false,
      run: projectHostedRunRecord(supersededRun),
    };
  }

  if (acquiredWakeIds.length > 0) {
    await markHostedRunWakesTerminalTx({
      eventResults: input.eventResults ?? [],
      outputCommittedSeq: input.outputCommittedSeq,
      runId: run.id,
      tx: input.tx,
      userId: input.userId,
      wakeIds: acquiredWakeIds,
    });
  }

  const current = await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const needsFinalize = input.finalizeRequired ?? true;
  const updatedRun = await input.tx.hostedRun.update({
    where: { id: run.id },
    data: {
      committedAt: now,
      nextRuntimeWakeAt,
      nextRuntimeWakeReason,
      outputCommittedSeq: input.outputCommittedSeq,
      outputCursorVersion: current.version,
      preparedAt: now,
      preparedSnapshotRef: nextSnapshotRef,
      redactedSummaryJson: input.redactedSummary === undefined
        ? undefined
        : toNullablePrismaJson(input.redactedSummary ?? null),
      status: needsFinalize ? "committed_needs_finalize" : "finalized",
      ...(needsFinalize ? {} : { finalSnapshotRef: nextSnapshotRef, finalizedAt: now }),
    },
  });

  return {
    committed: true,
    cursor: projectHostedExecutionCursorRecord(current),
    needsFinalize,
    run: projectHostedRunRecord(updatedRun),
  };
}

export async function finalizeHostedRun(input: {
  finalSnapshotRef: HostedWakeSnapshotRef;
  nextRuntimeWakeAt?: string | null;
  nextRuntimeWakeReason?: string | null;
  prisma?: PrismaClient;
  redactedSummary?: unknown | null;
  runId: string;
  runToken: string;
  userId: string;
}): Promise<HostedRunFinalizeResponse> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => finalizeHostedRunTx({ ...input, tx }));
}

export async function finalizeHostedRunTx(input: {
  finalSnapshotRef: HostedWakeSnapshotRef;
  nextRuntimeWakeAt?: string | null;
  nextRuntimeWakeReason?: string | null;
  redactedSummary?: unknown | null;
  runId: string;
  runToken: string;
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<HostedRunFinalizeResponse> {
  const now = new Date();
  await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  await lockHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const cursor = await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const run = await readHostedRunForMutationTx({
    allowedStatuses: [HOSTED_RUN_FINALIZE_RESUMABLE_STATUS, "finalizing"],
    runId: input.runId,
    runToken: input.runToken,
    tx: input.tx,
    userId: input.userId,
  });

  if (!run) {
    return {
      cursor: projectHostedExecutionCursorRecord(cursor),
      finalized: false,
      run: null,
    };
  }

  if (run.outputCursorVersion === null || run.outputCommittedSeq === null) {
    const failedRun = await closeHostedRunFinalizeConflictTx({
      errorCode: "HOSTED_RUN_FINALIZE_MISSING_COMMIT_STATE",
      run,
      status: "failed",
      tx: input.tx,
    });

    return {
      cursor: projectHostedExecutionCursorRecord(cursor),
      finalized: false,
      run: projectHostedRunRecord(failedRun),
    };
  }

  if (cursor.version !== run.outputCursorVersion || cursor.committedSeq !== run.outputCommittedSeq) {
    const supersededRun = await closeHostedRunFinalizeConflictTx({
      errorCode: "HOSTED_RUN_FINALIZE_CURSOR_CONFLICT",
      run,
      status: "superseded",
      tx: input.tx,
    });

    return {
      cursor: projectHostedExecutionCursorRecord(cursor),
      finalized: false,
      run: projectHostedRunRecord(supersededRun),
    };
  }

  const finalSnapshotRef = toNullablePrismaJson(input.finalSnapshotRef);
  const nextRuntimeWakeAt = input.nextRuntimeWakeAt === undefined
    ? cursor.nextRuntimeWakeAt
    : normalizeHostedRunWakeAt(input.nextRuntimeWakeAt);
  const nextRuntimeWakeReason = input.nextRuntimeWakeReason === undefined
    ? cursor.nextRuntimeWakeReason
    : normalizeHostedRunWakeReason(input.nextRuntimeWakeReason);
  const updateResult = await input.tx.hostedExecutionCursor.updateMany({
    where: {
      committedSeq: run.outputCommittedSeq,
      userId: input.userId,
      version: run.outputCursorVersion,
    },
    data: {
      nextRuntimeWakeAt,
      nextRuntimeWakeReason,
      snapshotRef: finalSnapshotRef,
      version: { increment: 1 },
    },
  });

  if (updateResult.count !== 1) {
    const current = await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
    const supersededRun = await closeHostedRunFinalizeConflictTx({
      errorCode: "HOSTED_RUN_FINALIZE_CURSOR_CAS_LOST",
      run,
      status: "superseded",
      tx: input.tx,
    });

    return {
      cursor: projectHostedExecutionCursorRecord(current),
      finalized: false,
      run: projectHostedRunRecord(supersededRun),
    };
  }

  const current = await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const updatedRun = await input.tx.hostedRun.update({
    where: { id: run.id },
    data: {
      finalSnapshotRef,
      finalizedAt: now,
      nextRuntimeWakeAt,
      nextRuntimeWakeReason,
      outputCursorVersion: current.version,
      redactedSummaryJson: input.redactedSummary === undefined
        ? undefined
        : toNullablePrismaJson(input.redactedSummary ?? null),
      status: "finalized",
    },
  });

  return {
    cursor: projectHostedExecutionCursorRecord(current),
    finalized: true,
    run: projectHostedRunRecord(updatedRun),
  };
}

export async function recordHostedRunLog(input: {
  at?: Date | null;
  component: string;
  level: HostedRunLogLevel;
  message: string;
  phase: string;
  prisma?: PrismaClient;
  redacted?: unknown | null;
  runId: string;
  runToken?: string | null;
  userId: string;
}): Promise<HostedRunLogResponse> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction(async (tx) => {
    const run = await tx.hostedRun.findFirst({
      where: {
        id: input.runId,
        userId: input.userId,
      },
    });

    if (!run) {
      return { logged: false, log: null };
    }

    if (input.runToken && !hostedRunTokenMatches(run.runTokenHash, input.runToken)) {
      return { logged: false, log: null };
    }

    const log = await tx.hostedRunLog.create({
      data: {
        at: input.at ?? new Date(),
        component: input.component,
        id: randomUUID(),
        level: input.level,
        message: input.message,
        phase: input.phase,
        redactedJson: input.redacted === undefined ? Prisma.DbNull : toNullablePrismaJson(input.redacted ?? null),
        runId: input.runId,
        userId: input.userId,
      },
    });

    return {
      logged: true,
      log: projectHostedRunLogRecord(log),
    };
  });
}

export async function readHostedRunStatus(input: {
  includeLogs?: boolean | null;
  limit?: number | null;
  prisma?: HostedRunStoreClient;
  runId?: string | null;
  userId: string;
}): Promise<HostedRunStatusResponse> {
  const prisma = input.prisma ?? getPrisma();
  const cursor = await ensureHostedExecutionCursorRowTx({ tx: prisma, userId: input.userId });
  const limit = normalizeHostedRunStatusLimit(input.limit);
  const runs = await prisma.hostedRun.findMany({
    where: {
      ...(input.runId ? { id: input.runId } : {}),
      userId: input.userId,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const run = runs[0] ?? null;
  const logs = input.includeLogs && run
    ? await prisma.hostedRunLog.findMany({
        where: {
          runId: run.id,
          userId: input.userId,
        },
        orderBy: { at: "asc" },
        take: 256,
      })
    : undefined;

  return {
    cursor: projectHostedExecutionCursorRecord(cursor),
    ...(logs === undefined ? {} : { logs: logs.map(projectHostedRunLogRecord) }),
    pendingWakeCount: await countPendingHostedWakes({ prisma, userId: input.userId }),
    run: run ? projectHostedRunRecord(run) : null,
    ...(input.runId ? {} : { runs: runs.map(projectHostedRunRecord) }),
  };
}

function isHostedRunActiveStale(
  run: Parameters<typeof projectHostedRunRecord>[0],
  now: Date,
): boolean {
  const updatedAtMs = run.updatedAt.getTime();
  return Number.isFinite(updatedAtMs)
    && now.getTime() - updatedAtMs > HOSTED_RUN_ACTIVE_STALE_AFTER_MS;
}

function normalizeHostedRunAcquireLimit(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return DEFAULT_HOSTED_RUN_EVENT_LIMIT;
  }

  if (!Number.isInteger(value) || value < 1 || value > MAX_HOSTED_RUN_EVENT_LIMIT) {
    throw new RangeError(`Hosted run acquire limit must be between 1 and ${MAX_HOSTED_RUN_EVENT_LIMIT}.`);
  }

  return value;
}

function normalizeHostedRunStatusLimit(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return 10;
  }

  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new RangeError("Hosted run status limit must be between 1 and 100.");
  }

  return value;
}

async function listContiguousHostedRunWakeRowsTx(input: {
  cursor: HostedExecutionCursorRow;
  limit: number;
  tx: HostedWakeStoreClient;
  userId: string;
}): Promise<HostedWakeRow[]> {
  const rows = await input.tx.hostedWake.findMany({
    where: {
      quarantinedAt: null,
      runId: null,
      seq: { gt: input.cursor.committedSeq },
      state: "pending",
      userId: input.userId,
    },
    orderBy: { seq: "asc" },
    take: input.limit,
  });
  const contiguous: HostedWakeRow[] = [];
  let expectedSeq = input.cursor.committedSeq + 1n;

  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      break;
    }

    contiguous.push(row);
    expectedSeq += 1n;
  }

  return contiguous;
}

async function findActiveHostedRunTx(input: {
  tx: HostedRunMutationTx;
  userId: string;
}) {
  const candidates = await input.tx.hostedRun.findMany({
    where: {
      status: { in: Array.from(HOSTED_RUN_ACTIVE_STATUSES) },
      userId: input.userId,
    },
    orderBy: { createdAt: "asc" },
    take: 1,
  });

  return candidates[0] ?? null;
}

async function findResumableFinalizeRunTx(input: {
  tx: HostedRunMutationTx;
  userId: string;
}) {
  const candidates = await input.tx.hostedRun.findMany({
    where: {
      status: HOSTED_RUN_FINALIZE_RESUMABLE_STATUS,
      userId: input.userId,
    },
    orderBy: { committedAt: "asc" },
    take: 1,
  });

  return candidates[0] ?? null;
}

async function readHostedRunForMutationTx(input: {
  allowedStatuses: HostedRunStatus[];
  runId: string;
  runToken: string;
  tx: HostedRunMutationTx;
  userId: string;
}) {
  const run = await input.tx.hostedRun.findFirst({
    where: {
      id: input.runId,
      status: { in: input.allowedStatuses },
      userId: input.userId,
    },
  });

  if (!run) {
    return null;
  }

  return hostedRunTokenMatches(run.runTokenHash, input.runToken) ? run : null;
}

async function closeHostedRunFinalizeConflictTx(input: {
  errorCode: string;
  run: Parameters<typeof projectHostedRunRecord>[0];
  status: Extract<HostedRunStatus, "failed" | "superseded">;
  tx: HostedRunMutationTx;
}): Promise<Parameters<typeof projectHostedRunRecord>[0]> {
  const now = new Date();

  return input.tx.hostedRun.update({
    where: { id: input.run.id },
    data: {
      errorClass: "hosted_run_finalize",
      errorCode: input.errorCode,
      failedAt: input.status === "failed" ? now : input.run.failedAt,
      status: input.status,
      updatedAt: now,
    },
  });
}

async function closeHostedRunWithoutCommitTx(input: {
  cursor: HostedExecutionCursorRow;
  errorClass?: string | null;
  errorCode: string;
  run: Parameters<typeof projectHostedRunRecord>[0];
  status: Extract<HostedRunStatus, "failed" | "superseded">;
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<Parameters<typeof projectHostedRunRecord>[0]> {
  const now = new Date();

  await input.tx.hostedWake.updateMany({
    where: {
      runId: input.run.id,
      seq: { gt: input.cursor.committedSeq },
      state: "running",
      userId: input.userId,
    },
    data: {
      runId: null,
      state: "pending",
    },
  });

  return input.tx.hostedRun.update({
    where: { id: input.run.id },
    data: {
      errorClass: input.errorClass ?? "hosted_run_commit",
      errorCode: input.errorCode,
      failedAt: input.status === "failed" ? now : input.run.failedAt,
      status: input.status,
      updatedAt: now,
    },
  });
}

async function markHostedRunWakesTerminalTx(input: {
  eventResults: HostedRunEventResult[];
  outputCommittedSeq: bigint;
  runId: string;
  tx: HostedWakeMutationTx;
  userId: string;
  wakeIds: string[];
}): Promise<void> {
  const resultByWakeId = new Map(input.eventResults.map((result) => [result.wakeId, result]));
  const wakes = await input.tx.hostedWake.findMany({
    where: {
      id: { in: input.wakeIds },
      userId: input.userId,
    },
  });

  for (const wake of wakes) {
    if (wake.seq > input.outputCommittedSeq) {
      continue;
    }

    const result = resultByWakeId.get(wake.id);
    const state = result?.state ?? (wake.quarantinedAt ? "quarantined" : "completed");

    await input.tx.hostedWake.update({
      where: { id: wake.id },
      data: {
        completedAt: new Date(),
        quarantineCode: state === "quarantined"
          ? normalizeHostedRunWakeQuarantineCode(result?.quarantineCode ?? wake.quarantineCode)
          : wake.quarantineCode,
        quarantinedAt: state === "quarantined" ? wake.quarantinedAt ?? new Date() : wake.quarantinedAt,
        runId: input.runId,
        state,
      },
    });
  }
}

function resolveHostedRunTriggerKind(input: {
  explicit: HostedRunTriggerKind | null;
  runtimeTimerDue: boolean;
  wakeCount: number;
}): HostedRunTriggerKind {
  if (input.explicit) {
    return input.explicit;
  }

  if (input.wakeCount > 0) {
    return "external_ingress";
  }

  return input.runtimeTimerDue ? "runtime_timer" : "manual_repair";
}

function isHostedRuntimeTimerDue(cursor: HostedExecutionCursorRow, now: Date): boolean {
  return Boolean(cursor.nextRuntimeWakeAt && cursor.nextRuntimeWakeAt.getTime() <= now.getTime());
}

function normalizeHostedRunWakeAt(value: string | null): Date | null {
  if (value === null) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Hosted run nextRuntimeWakeAt must be a valid ISO-8601 timestamp or null.");
  }

  return parsed;
}

function normalizeHostedRunWakeReason(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeHostedRunFailureClass(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized.slice(0, 128) : null;
}

function normalizeNullableHostedRunString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeHostedRunFailureCode(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized.slice(0, 128) : null;
}

function normalizeHostedRunWakeQuarantineCode(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : "hosted_run_quarantined";
}

function createHostedRunToken(): string {
  return `${randomUUID()}.${randomUUID()}`;
}

function hashHostedRunToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function hostedRunTokenMatches(hash: string, token: string): boolean {
  return hashHostedRunToken(token) === hash;
}

function cursorSnapshotRefToPrismaJson(value: HostedExecutionCursorRow["snapshotRef"]): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null) {
    return Prisma.DbNull;
  }

  return toNullablePrismaJson(parseHostedExecutionCursorSnapshotRef(value));
}

function toNullablePrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) {
    return Prisma.DbNull;
  }

  return toPrismaJson(value);
}

function toPrismaJsonArray(values: string[]): Prisma.InputJsonArray {
  return values.map((value) => value) satisfies Prisma.InputJsonArray;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new TypeError("Hosted run JSON value must be serializable.");
  }

  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function readHostedRunStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`${label} must be an array of strings.`);
  }

  return value;
}

function readHostedRunBigIntArray(value: unknown, label: string): bigint[] {
  return readHostedRunStringArray(value, label).map((entry) => BigInt(entry));
}

function projectHostedRunRecord(record: {
  acquiredAt: Date;
  attempt: number;
  committedAt: Date | null;
  createdAt: Date;
  errorClass: string | null;
  errorCode: string | null;
  eventCount: number;
  eventKindsJson: unknown;
  eventSeqsJson: unknown;
  executorCodeDigest: string | null;
  executorKind: string;
  attestationRef: string | null;
  signedResultRef: string | null;
  failedAt: Date | null;
  finalSnapshotRef: unknown;
  finalizedAt: Date | null;
  id: string;
  inputCommittedSeq: bigint;
  inputCursorVersion: bigint;
  inputSnapshotRef: unknown;
  nextRuntimeWakeAt: Date | null;
  nextRuntimeWakeReason: string | null;
  outputCommittedSeq: bigint | null;
  outputCursorVersion: bigint | null;
  preparedAt: Date | null;
  preparedSnapshotRef: unknown;
  redactedSummaryJson: unknown;
  startedAt: Date | null;
  status: string;
  triggerKind: string;
  updatedAt: Date;
  userId: string;
  wakeIdsJson: unknown;
}): HostedRunRecord {
  return {
    acquiredAt: record.acquiredAt.toISOString(),
    attempt: record.attempt,
    committedAt: record.committedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    errorClass: record.errorClass,
    errorCode: record.errorCode,
    eventCount: record.eventCount,
    eventKinds: readHostedRunStringArray(record.eventKindsJson, "Hosted run eventKindsJson"),
    eventSeqs: readHostedRunStringArray(record.eventSeqsJson, "Hosted run eventSeqsJson"),
    executorKind: parseHostedRunExecutorKindForProjection(record.executorKind),
    executorCodeDigest: record.executorCodeDigest,
    attestationRef: record.attestationRef,
    signedResultRef: record.signedResultRef,
    failedAt: record.failedAt?.toISOString() ?? null,
    finalSnapshotRef: parseHostedRunSnapshotRef(record.finalSnapshotRef),
    finalizedAt: record.finalizedAt?.toISOString() ?? null,
    id: record.id,
    inputCommittedSeq: record.inputCommittedSeq.toString(),
    inputCursorVersion: record.inputCursorVersion.toString(),
    inputSnapshotRef: parseHostedRunSnapshotRef(record.inputSnapshotRef),
    nextRuntimeWakeAt: record.nextRuntimeWakeAt?.toISOString() ?? null,
    nextRuntimeWakeReason: record.nextRuntimeWakeReason,
    outputCommittedSeq: record.outputCommittedSeq?.toString() ?? null,
    outputCursorVersion: record.outputCursorVersion?.toString() ?? null,
    preparedAt: record.preparedAt?.toISOString() ?? null,
    preparedSnapshotRef: parseHostedRunSnapshotRef(record.preparedSnapshotRef),
    redactedSummary: record.redactedSummaryJson ?? null,
    startedAt: record.startedAt?.toISOString() ?? null,
    status: parseHostedRunStatusForProjection(record.status),
    triggerKind: parseHostedRunTriggerKindForProjection(record.triggerKind),
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
    wakeIds: readHostedRunStringArray(record.wakeIdsJson, "Hosted run wakeIdsJson"),
  };
}

function projectHostedRunLogRecord(record: {
  at: Date;
  component: string;
  createdAt: Date;
  id: string;
  level: string;
  message: string;
  phase: string;
  redactedJson: unknown;
  runId: string;
  userId: string;
}): HostedRunLogRecord {
  return {
    at: record.at.toISOString(),
    component: record.component,
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    level: parseHostedRunLogLevelForProjection(record.level),
    message: record.message,
    phase: record.phase,
    redacted: record.redactedJson ?? null,
    runId: record.runId,
    userId: record.userId,
  };
}

function parseHostedRunSnapshotRef(value: unknown): HostedWakeSnapshotRef {
  return parseHostedExecutionCursorSnapshotRef(value === undefined ? null : value);
}

function parseHostedRunExecutorKindForProjection(value: string): HostedRunExecutorKind {
  switch (value) {
    case "cloudflare-container":
    case "tee":
    case "local-replay":
      return value;
    default:
      throw new TypeError(`Hosted run executorKind is invalid: ${value}`);
  }
}

function parseHostedRunStatusForProjection(value: string): HostedRunStatus {
  switch (value) {
    case "acquired":
    case "running":
    case "prepared":
    case "committed_needs_finalize":
    case "finalizing":
    case "finalized":
    case "failed":
    case "superseded":
      return value;
    default:
      throw new TypeError(`Hosted run status is invalid: ${value}`);
  }
}

function parseHostedRunTriggerKindForProjection(value: string): HostedRunTriggerKind {
  switch (value) {
    case "external_ingress":
    case "runtime_timer":
    case "manual_repair":
    case "retry_finalize":
      return value;
    default:
      throw new TypeError(`Hosted run triggerKind is invalid: ${value}`);
  }
}

function parseHostedRunLogLevelForProjection(value: string): HostedRunLogLevel {
  switch (value) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value;
    default:
      throw new TypeError(`Hosted run log level is invalid: ${value}`);
  }
}
