import { createHash, randomUUID } from "node:crypto";

import { Prisma, type HostedRun, type PrismaClient } from "@prisma/client";
import type {
  HostedRunAcquireResponse,
  HostedRunCommitResponse,
  HostedRunEventResult,
  HostedRunExecutorKind,
  HostedRunFinalizeResponse,
  HostedRunLogLevel,
  HostedRunLogRecord,
  HostedRunLogResponse,
  HostedRunReleaseFinalizeResponse,
  HostedRunRecord,
  HostedRunStatus,
  HostedRunStatusResponse,
  HostedRunTurnInputAdoptResponse,
  HostedRunTurnInputPeekResponse,
  HostedRunTriggerKind,
  HostedIngressSnapshotRef,
  HostedBrowserVaultReplicaCursorRef,
} from "@murphai/hosted-execution/contracts";
import { normalizeHostedExecutionOperatorMessage } from "@murphai/hosted-execution";
import {
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionCursorSnapshotRef,
} from "@murphai/hosted-execution/parsers";

import { sanitizeJsonLogString } from "../http";
import { getPrisma } from "../prisma";
import {
  ensureHostedExecutionCursorRowTx,
  lockHostedExecutionCursorRowTx,
} from "../hosted-ingress/store-data";
import {
  hydrateHostedIngressEventsTx,
  projectHostedExecutionCursorRecord,
} from "../hosted-ingress/store-projections";
import { countPendingHostedIngressEvents } from "../hosted-ingress/store";
import type {
  HostedExecutionCursorRow,
  HostedIngressMutationTx,
  HostedIngressEventRow,
  HostedIngressStoreClient,
} from "../hosted-ingress/store.types";

const DEFAULT_HOSTED_RUN_EVENT_LIMIT = 64;
const HOSTED_RUN_ACTIVE_STALE_AFTER_MS = 15 * 60 * 1000;
const MAX_HOSTED_RUN_EVENT_LIMIT = 256;
const HOSTED_RUN_FINALIZING_STATUS: HostedRunStatus = "finalizing";
const HOSTED_RUN_ACTIVE_STATUSES = new Set<HostedRunStatus>([
  "acquired",
  "running",
  HOSTED_RUN_FINALIZING_STATUS,
]);
const HOSTED_RUN_FINALIZE_RESUMABLE_STATUS: HostedRunStatus = "committed_needs_finalize";
const DEFAULT_HOSTED_RUN_EXECUTOR_KIND: HostedRunExecutorKind = "cloudflare-container";

export type HostedRunStoreClient = PrismaClient | Prisma.TransactionClient;
export type HostedRunMutationTx = Prisma.TransactionClient;
type HostedRunRow = HostedRun;

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

export async function peekHostedRunTurnInput(input: {
  afterSeq?: bigint | null;
  limit?: number | null;
  prisma?: PrismaClient;
  runId: string;
  runToken: string;
  userId: string;
}): Promise<HostedRunTurnInputPeekResponse> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => peekHostedRunTurnInputTx({
    afterSeq: input.afterSeq,
    limit: input.limit,
    runId: input.runId,
    runToken: input.runToken,
    tx,
    userId: input.userId,
  }));
}

export async function adoptHostedRunTurnInput(input: {
  afterSeq?: bigint | null;
  ingressEventIds: string[];
  prisma?: PrismaClient;
  runId: string;
  runToken: string;
  userId: string;
}): Promise<HostedRunTurnInputAdoptResponse> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => adoptHostedRunTurnInputTx({
    afterSeq: input.afterSeq,
    ingressEventIds: input.ingressEventIds,
    runId: input.runId,
    runToken: input.runToken,
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
  const resumableFinalize = await claimResumableFinalizeRunTx({
    now,
    tx: input.tx,
    userId: input.userId,
  });

  if (resumableFinalize) {
    return buildHostedRunAcquireResponseTx({
      acquired: true,
      events: [],
      resumeFinalize: true,
      run: resumableFinalize.run,
      runToken: resumableFinalize.runToken,
      tx: input.tx,
      userId: input.userId,
      cursor,
    });
  }

  const activeRun = await findActiveHostedRunTx({
    tx: input.tx,
    userId: input.userId,
  });

  if (activeRun) {
    if (isHostedRunActiveStale(activeRun, now)) {
      if (activeRun.status === HOSTED_RUN_FINALIZING_STATUS) {
        await resetHostedRunFinalizeForRetryTx({
          run: activeRun,
          tx: input.tx,
        });

        const resumedFinalize = await claimResumableFinalizeRunTx({
          now,
          tx: input.tx,
          userId: input.userId,
        });

        if (resumedFinalize) {
          return buildHostedRunAcquireResponseTx({
            acquired: true,
            events: [],
            resumeFinalize: true,
            run: resumedFinalize.run,
            runToken: resumedFinalize.runToken,
            tx: input.tx,
            userId: input.userId,
            cursor,
          });
        }
      } else {
        await closeHostedRunWithoutCommitTx({
          cursor,
          errorClass: "hosted_run_stale",
          errorCode: "HOSTED_RUN_ACTIVE_STALE",
          run: activeRun,
          status: "failed",
          tx: input.tx,
          userId: input.userId,
        });
      }
    } else {
      return buildHostedRunAcquireResponseTx({
        acquired: false,
        events: [],
        resumeFinalize: false,
        run: activeRun,
        tx: input.tx,
        userId: input.userId,
        cursor,
      });
    }
  }

  const activeRunAfterRecovery = await findActiveHostedRunTx({
    tx: input.tx,
    userId: input.userId,
  });

  if (activeRunAfterRecovery) {
    return buildHostedRunAcquireResponseTx({
      acquired: false,
      events: [],
      resumeFinalize: false,
      run: activeRunAfterRecovery,
      tx: input.tx,
      userId: input.userId,
      cursor,
    });
  }

  const wakeRows = await listContiguousHostedRunWakeRowsTx({
    cursor,
    limit,
    tx: input.tx,
    userId: input.userId,
  });
  const runtimeTimerDue = isHostedRuntimeTimerDue(cursor, now);

  if (wakeRows.length === 0 && !runtimeTimerDue && input.triggerKind !== "manual_repair") {
    return buildHostedRunAcquireResponseTx({
      acquired: false,
      events: [],
      resumeFinalize: false,
      run: null,
      tx: input.tx,
      userId: input.userId,
      cursor,
    });
  }

  const triggerKind = resolveHostedRunTriggerKind({
    explicit: input.triggerKind ?? null,
    runtimeTimerDue,
    wakeCount: wakeRows.length,
  });

  const runToken = createHostedRunToken();
  const events = await hydrateHostedIngressEventsTx({
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
      ingressEventIdsJson: toPrismaJsonArray(wakeRows.map((wake) => wake.id)),
    },
  });

  if (wakeRows.length > 0) {
    await input.tx.hostedIngressEvent.updateMany({
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

  return buildHostedRunAcquireResponseTx({
    acquired: true,
    events,
    resumeFinalize: false,
    run,
    runToken,
    tx: input.tx,
    userId: input.userId,
    cursor,
  });
}

export async function peekHostedRunTurnInputTx(input: {
  afterSeq?: bigint | null;
  limit?: number | null;
  runId: string;
  runToken: string;
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<HostedRunTurnInputPeekResponse> {
  await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  await lockHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const run = await readHostedRunForMutationTx({
    allowedStatuses: ["acquired", "running"],
    runId: input.runId,
    runToken: input.runToken,
    tx: input.tx,
    userId: input.userId,
  });

  if (!run) {
    return {
      events: [],
      run: null,
    };
  }

  const afterSeq = resolveHostedRunTurnInputPeekAfterSeq({
    afterSeq: input.afterSeq ?? null,
    run,
  });
  const rows = await listContiguousHostedRunWakeRowsAfterSeqTx({
    afterSeq,
    limit: normalizeHostedRunTurnInputLimit(input.limit),
    tx: input.tx,
    userId: input.userId,
  });

  return {
    events: await hydrateHostedIngressEventsTx({
      records: rows,
      tx: input.tx,
    }),
    run: projectHostedRunRecord(run),
  };
}

export async function adoptHostedRunTurnInputTx(input: {
  afterSeq?: bigint | null;
  ingressEventIds: string[];
  runId: string;
  runToken: string;
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<HostedRunTurnInputAdoptResponse> {
  await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  await lockHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const run = await readHostedRunForMutationTx({
    allowedStatuses: ["acquired", "running"],
    runId: input.runId,
    runToken: input.runToken,
    tx: input.tx,
    userId: input.userId,
  });

  if (!run) {
    return {
      adopted: false,
      events: [],
      run: null,
    };
  }

  if (input.ingressEventIds.length === 0) {
    return {
      adopted: false,
      events: [],
      run: projectHostedRunRecord(run),
    };
  }

  const rows = await listContiguousHostedRunWakeRowsAfterSeqTx({
    afterSeq: highestHostedRunClaimedSeq(run),
    limit: input.ingressEventIds.length,
    tx: input.tx,
    userId: input.userId,
  });
  const requestedIdsMatchPrefix =
    rows.length === input.ingressEventIds.length
    && rows.every((row, index) => row.id === input.ingressEventIds[index]);

  if (!requestedIdsMatchPrefix) {
    return {
      adopted: false,
      events: [],
      run: projectHostedRunRecord(run),
    };
  }

  const updateResult = await input.tx.hostedIngressEvent.updateMany({
    where: {
      id: { in: input.ingressEventIds },
      quarantinedAt: null,
      runId: null,
      state: "pending",
      userId: input.userId,
    },
    data: {
      runId: run.id,
      state: "running",
    },
  });

  if (updateResult.count !== input.ingressEventIds.length) {
    return {
      adopted: false,
      events: [],
      run: projectHostedRunRecord(run),
    };
  }

  const updatedRun = await input.tx.hostedRun.update({
    where: { id: run.id },
    data: appendHostedRunIngressProjection(run, rows),
  });

  return {
    adopted: true,
    events: await hydrateHostedIngressEventsTx({
      records: rows,
      tx: input.tx,
    }),
    run: projectHostedRunRecord(updatedRun),
  };
}

export async function commitHostedRun(input: {
  eventResults?: HostedRunEventResult[];
  expectedCursorVersion: bigint;
  failureClass?: string | null;
  failureCode?: string | null;
  finalizeRequired: boolean;
  nextRuntimeWakeAt?: string | null;
  nextRuntimeWakeReason?: string | null;
  outputCommittedSeq: bigint;
  browserVaultReplicaRef?: HostedBrowserVaultReplicaCursorRef;
  preparedSnapshotRef?: HostedIngressSnapshotRef;
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
  finalizeRequired: boolean;
  nextRuntimeWakeAt?: string | null;
  nextRuntimeWakeReason?: string | null;
  outputCommittedSeq: bigint;
  browserVaultReplicaRef?: HostedBrowserVaultReplicaCursorRef;
  preparedSnapshotRef?: HostedIngressSnapshotRef;
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
    allowedStatuses: ["acquired", "running"],
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
  const acquiredIngressEventIds = readHostedRunStringArray(
    run.ingressEventIdsJson,
    "Hosted run ingressEventIdsJson",
  );
  const committedIngressEventIds = acquiredIngressEventIds.filter((_, index) =>
    index < acquiredSeqs.length && acquiredSeqs[index] <= input.outputCommittedSeq
  );
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

  const eventResultsValidationError = validateHostedRunEventResults({
    eventResults: input.eventResults ?? [],
    expectedIngressEventIds: committedIngressEventIds,
  });

  if (eventResultsValidationError) {
    const failedRun = await closeHostedRunWithoutCommitTx({
      cursor,
      errorCode: eventResultsValidationError,
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
  const nextBrowserVaultReplicaRef = input.browserVaultReplicaRef === undefined
    ? cursorBrowserVaultReplicaRefToPrismaJson(cursor.browserVaultReplicaRef)
    : toNullablePrismaJson(input.browserVaultReplicaRef);
  const nextRuntimeWakeAt = input.nextRuntimeWakeAt === undefined
    ? cursor.nextRuntimeWakeAt
    : normalizeHostedRunWakeAt(input.nextRuntimeWakeAt);
  const nextRuntimeWakeReason = input.nextRuntimeWakeReason === undefined
    ? cursor.nextRuntimeWakeReason
    : normalizeHostedRunWakeReason(input.nextRuntimeWakeReason);
  const safeRedactedSummary = input.redactedSummary === undefined
    ? undefined
    : sanitizeHostedRunStoredJsonValue(input.redactedSummary);
  const updateResult = await input.tx.hostedExecutionCursor.updateMany({
    where: {
      committedSeq: run.inputCommittedSeq,
      userId: input.userId,
      version: run.inputCursorVersion,
    },
    data: {
      committedSeq: input.outputCommittedSeq,
      nextRuntimeWakeAt,
      browserVaultReplicaRef: nextBrowserVaultReplicaRef,
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

  if (acquiredIngressEventIds.length > 0) {
    await markHostedRunIngressEventsTerminalTx({
      eventResults: input.eventResults ?? [],
      outputCommittedSeq: input.outputCommittedSeq,
      runId: run.id,
      tx: input.tx,
      userId: input.userId,
      ingressEventIds: acquiredIngressEventIds,
    });
  }

  const current = await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const needsFinalize = input.finalizeRequired;
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
      redactedSummaryJson: safeRedactedSummary === undefined
        ? undefined
        : toNullablePrismaJson(safeRedactedSummary),
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
  browserVaultReplicaRef?: HostedBrowserVaultReplicaCursorRef;
  finalSnapshotRef: HostedIngressSnapshotRef;
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
  browserVaultReplicaRef?: HostedBrowserVaultReplicaCursorRef;
  finalSnapshotRef: HostedIngressSnapshotRef;
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
    allowedStatuses: [HOSTED_RUN_FINALIZING_STATUS],
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
  const finalBrowserVaultReplicaRef = input.browserVaultReplicaRef === undefined
    ? cursorBrowserVaultReplicaRefToPrismaJson(cursor.browserVaultReplicaRef)
    : toNullablePrismaJson(input.browserVaultReplicaRef);
  const nextRuntimeWakeAt = input.nextRuntimeWakeAt === undefined
    ? cursor.nextRuntimeWakeAt
    : normalizeHostedRunWakeAt(input.nextRuntimeWakeAt);
  const nextRuntimeWakeReason = input.nextRuntimeWakeReason === undefined
    ? cursor.nextRuntimeWakeReason
    : normalizeHostedRunWakeReason(input.nextRuntimeWakeReason);
  const safeRedactedSummary = input.redactedSummary === undefined
    ? undefined
    : sanitizeHostedRunStoredJsonValue(input.redactedSummary);
  const updateResult = await input.tx.hostedExecutionCursor.updateMany({
    where: {
      committedSeq: run.outputCommittedSeq,
      userId: input.userId,
      version: run.outputCursorVersion,
    },
    data: {
      nextRuntimeWakeAt,
      browserVaultReplicaRef: finalBrowserVaultReplicaRef,
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
      redactedSummaryJson: safeRedactedSummary === undefined
        ? undefined
        : toNullablePrismaJson(safeRedactedSummary),
      status: "finalized",
    },
  });

  return {
    cursor: projectHostedExecutionCursorRecord(current),
    finalized: true,
    run: projectHostedRunRecord(updatedRun),
  };
}


export async function readHostedExecutionCursorForUser(input: {
  prisma?: HostedRunStoreClient;
  userId: string;
}) {
  const prisma = input.prisma ?? getPrisma();
  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: prisma,
    userId: input.userId,
  });

  return projectHostedExecutionCursorRecord(cursor);
}

export async function releaseHostedRunFinalize(input: {
  failureClass?: string | null;
  failureCode?: string | null;
  prisma?: PrismaClient;
  runId: string;
  runToken: string;
  userId: string;
}): Promise<HostedRunReleaseFinalizeResponse> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => releaseHostedRunFinalizeTx({ ...input, tx }));
}

export async function releaseHostedRunFinalizeTx(input: {
  failureClass?: string | null;
  failureCode?: string | null;
  runId: string;
  runToken: string;
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<HostedRunReleaseFinalizeResponse> {
  const now = new Date();
  await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  await lockHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const cursor = await ensureHostedExecutionCursorRowTx({ tx: input.tx, userId: input.userId });
  const run = await readHostedRunForMutationTx({
    allowedStatuses: [HOSTED_RUN_FINALIZING_STATUS],
    runId: input.runId,
    runToken: input.runToken,
    tx: input.tx,
    userId: input.userId,
  });

  if (!run) {
    return {
      cursor: projectHostedExecutionCursorRecord(cursor),
      released: false,
      run: null,
    };
  }

  const releasedRun = await input.tx.hostedRun.update({
    where: { id: run.id },
    data: {
      errorClass: normalizeHostedRunFailureClass(input.failureClass) ?? "hosted_run_finalize_retryable",
      errorCode: normalizeHostedRunFailureCode(input.failureCode) ?? "HOSTED_RUN_FINALIZE_RETRYABLE",
      status: HOSTED_RUN_FINALIZE_RESUMABLE_STATUS,
      updatedAt: now,
    },
  });

  return {
    cursor: projectHostedExecutionCursorRecord(cursor),
    released: true,
    run: projectHostedRunRecord(releasedRun),
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
  runToken: string;
  userId: string;
}): Promise<HostedRunLogResponse> {
  const prisma = input.prisma ?? getPrisma();
  const safeMessage = sanitizeHostedRunLogMessage(input.message, input.redacted);
  const safeRedacted = sanitizeHostedRunStoredJsonValue(input.redacted);

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

    if (!hostedRunTokenMatches(run.runTokenHash, input.runToken)) {
      return { logged: false, log: null };
    }

    await maybeMarkHostedRunStartedTx({
      phase: input.phase,
      run,
      tx,
    });

    const log = await tx.hostedRunLog.create({
      data: {
        at: input.at ?? new Date(),
        component: input.component,
        id: randomUUID(),
        level: input.level,
        message: safeMessage,
        phase: input.phase,
        redactedJson: input.redacted === undefined ? Prisma.DbNull : toNullablePrismaJson(safeRedacted),
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
    pendingIngressEventCount: await countPendingHostedIngressEvents({ prisma, userId: input.userId }),
    run: run ? projectHostedRunRecord(run) : null,
    ...(input.runId ? {} : { runs: runs.map(projectHostedRunRecord) }),
  };
}

async function maybeMarkHostedRunStartedTx(input: {
  phase: string;
  run: HostedRunRow;
  tx: HostedRunMutationTx;
}): Promise<void> {
  if (input.run.status !== "acquired" || !phaseMarksHostedRunStarted(input.phase)) {
    return;
  }

  const now = new Date();
  await input.tx.hostedRun.updateMany({
    where: {
      id: input.run.id,
      status: "acquired",
    },
    data: {
      startedAt: input.run.startedAt ?? now,
      status: "running",
      updatedAt: now,
    },
  });
}

function phaseMarksHostedRunStarted(phase: string): boolean {
  return phase === "running"
    || phase === "wake.running"
    || phase === "runtime.starting"
    || phase === "runner_invocation_started"
    || phase === "side-effects.draining"
    || phase === "prepare"
    || phase === "prepared"
    || phase === "commit.recorded"
    || phase === "commit_attempted"
    || phase === "runner_prepared_snapshot"
    || phase === "finalize_started"
    || phase === "finalize_finished"
    || phase === "completed";
}

function isHostedRunActiveStale(
  run: HostedRunRow,
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

function normalizeHostedRunTurnInputLimit(value: number | null | undefined): number {
  return normalizeHostedRunAcquireLimit(value);
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
  tx: HostedIngressStoreClient;
  userId: string;
}): Promise<HostedIngressEventRow[]> {
  const rows = await input.tx.hostedIngressEvent.findMany({
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
  const contiguous: HostedIngressEventRow[] = [];
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

async function listContiguousHostedRunWakeRowsAfterSeqTx(input: {
  afterSeq: bigint;
  limit: number;
  tx: HostedIngressStoreClient;
  userId: string;
}): Promise<HostedIngressEventRow[]> {
  const rows = await input.tx.hostedIngressEvent.findMany({
    where: {
      quarantinedAt: null,
      runId: null,
      seq: { gt: input.afterSeq },
      state: "pending",
      userId: input.userId,
    },
    orderBy: { seq: "asc" },
    take: input.limit,
  });
  const contiguous: HostedIngressEventRow[] = [];
  let expectedSeq = input.afterSeq + 1n;

  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      break;
    }

    contiguous.push(row);
    expectedSeq += 1n;
  }

  return contiguous;
}

function resolveHostedRunTurnInputPeekAfterSeq(input: {
  afterSeq: bigint | null;
  run: HostedRunRow;
}): bigint {
  const claimedSeq = highestHostedRunClaimedSeq(input.run);
  if (input.afterSeq === null || input.afterSeq < claimedSeq) {
    return claimedSeq;
  }

  return input.afterSeq;
}

function highestHostedRunClaimedSeq(run: HostedRunRow): bigint {
  const seqs = readHostedRunBigIntArray(run.eventSeqsJson, "Hosted run eventSeqsJson");
  return seqs.length === 0 ? run.inputCommittedSeq : seqs[seqs.length - 1];
}

function appendHostedRunIngressProjection(
  run: HostedRunRow,
  rows: readonly HostedIngressEventRow[],
): Prisma.HostedRunUpdateInput {
  const existingKinds = readHostedRunStringArray(
    run.eventKindsJson,
    "Hosted run eventKindsJson",
  );
  const existingSeqs = readHostedRunStringArray(
    run.eventSeqsJson,
    "Hosted run eventSeqsJson",
  );
  const existingIngressEventIds = readHostedRunStringArray(
    run.ingressEventIdsJson,
    "Hosted run ingressEventIdsJson",
  );

  return {
    eventCount: existingSeqs.length + rows.length,
    eventKindsJson: toPrismaJsonArray(uniqueStrings([
      ...existingKinds,
      ...rows.map((row) => row.kind),
    ])),
    eventSeqsJson: toPrismaJsonArray([
      ...existingSeqs,
      ...rows.map((row) => row.seq.toString()),
    ]),
    ingressEventIdsJson: toPrismaJsonArray([
      ...existingIngressEventIds,
      ...rows.map((row) => row.id),
    ]),
  } satisfies Prisma.HostedRunUpdateInput;
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

async function claimResumableFinalizeRunTx(input: {
  now: Date;
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<{
  run: HostedRunRow;
  runToken: string;
} | null> {
  const candidate = await findResumableFinalizeRunTx({
    tx: input.tx,
    userId: input.userId,
  });

  if (!candidate) {
    return null;
  }

  const runToken = createHostedRunToken();
  const claimResult = await input.tx.hostedRun.updateMany({
    where: {
      id: candidate.id,
      status: HOSTED_RUN_FINALIZE_RESUMABLE_STATUS,
      userId: input.userId,
    },
    data: {
      attempt: { increment: 1 },
      runTokenHash: hashHostedRunToken(runToken),
      status: HOSTED_RUN_FINALIZING_STATUS,
      updatedAt: input.now,
    },
  });

  if (claimResult.count !== 1) {
    return null;
  }

  const run = await input.tx.hostedRun.findFirst({
    where: {
      id: candidate.id,
      userId: input.userId,
    },
  });

  if (!run) {
    throw new Error(`Claimed hosted finalize run ${candidate.id} disappeared before it could be returned.`);
  }

  return {
    run,
    runToken,
  };
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
  run: HostedRunRow;
  status: Extract<HostedRunStatus, "failed" | "superseded">;
  tx: HostedRunMutationTx;
}): Promise<HostedRunRow> {
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

async function resetHostedRunFinalizeForRetryTx(input: {
  run: HostedRunRow;
  tx: HostedRunMutationTx;
}): Promise<HostedRunRow> {
  return input.tx.hostedRun.update({
    where: { id: input.run.id },
    data: {
      status: HOSTED_RUN_FINALIZE_RESUMABLE_STATUS,
    },
  });
}

async function closeHostedRunWithoutCommitTx(input: {
  cursor: HostedExecutionCursorRow;
  errorClass?: string | null;
  errorCode: string;
  run: HostedRunRow;
  status: Extract<HostedRunStatus, "failed" | "superseded">;
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<HostedRunRow> {
  const now = new Date();

  await input.tx.hostedIngressEvent.updateMany({
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

function validateHostedRunEventResults(input: {
  eventResults: HostedRunEventResult[];
  expectedIngressEventIds: string[];
}): string | null {
  const expectedIngressEventIds = new Set(input.expectedIngressEventIds);
  const seenIngressEventIds = new Set<string>();

  if (input.expectedIngressEventIds.length === 0) {
    return input.eventResults.length === 0
      ? null
      : "HOSTED_RUN_EVENT_RESULTS_UNEXPECTED";
  }

  for (const result of input.eventResults) {
    if (seenIngressEventIds.has(result.ingressEventId)) {
      return "HOSTED_RUN_EVENT_RESULTS_DUPLICATE";
    }

    seenIngressEventIds.add(result.ingressEventId);

    if (!expectedIngressEventIds.has(result.ingressEventId)) {
      return "HOSTED_RUN_EVENT_RESULTS_UNKNOWN";
    }
  }

  for (const ingressEventId of expectedIngressEventIds) {
    if (!seenIngressEventIds.has(ingressEventId)) {
      return "HOSTED_RUN_EVENT_RESULTS_MISSING";
    }
  }

  return null;
}

async function markHostedRunIngressEventsTerminalTx(input: {
  eventResults: HostedRunEventResult[];
  outputCommittedSeq: bigint;
  runId: string;
  tx: HostedIngressMutationTx;
  userId: string;
  ingressEventIds: string[];
}): Promise<void> {
  const resultByIngressEventId = new Map(
    input.eventResults.map((result) => [result.ingressEventId, result]),
  );
  const ingressEvents = await input.tx.hostedIngressEvent.findMany({
    where: {
      id: { in: input.ingressEventIds },
      userId: input.userId,
    },
  });

  const releasedIngressEventIds: string[] = [];

  for (const ingressEvent of ingressEvents) {
    if (ingressEvent.seq > input.outputCommittedSeq) {
      releasedIngressEventIds.push(ingressEvent.id);
      continue;
    }

    const result = resultByIngressEventId.get(ingressEvent.id);
    if (!result) {
      throw new Error(`Hosted run result missing for acquired ingress event ${ingressEvent.id}.`);
    }
    const state = result.state;

    await input.tx.hostedIngressEvent.update({
      where: { id: ingressEvent.id },
      data: {
        completedAt: new Date(),
        payloadInlineCiphertext: null,
        payloadRef: null,
        quarantineCode: state === "quarantined"
          ? normalizeHostedRunWakeQuarantineCode(result.quarantineCode ?? ingressEvent.quarantineCode)
          : ingressEvent.quarantineCode,
        quarantinedAt: state === "quarantined"
          ? ingressEvent.quarantinedAt ?? new Date()
          : ingressEvent.quarantinedAt,
        runId: input.runId,
        state,
      },
    });

    if (ingressEvent.payloadRef) {
      await input.tx.hostedIngressPayload.deleteMany({
        where: {
          ingressEventId: ingressEvent.payloadRef,
          userId: input.userId,
        },
      });
    }
  }

  if (releasedIngressEventIds.length > 0) {
    await input.tx.hostedIngressEvent.updateMany({
      where: {
        id: { in: releasedIngressEventIds },
        userId: input.userId,
      },
      data: {
        runId: null,
        state: "pending",
      },
    });
  }
}

async function buildHostedRunAcquireResponseTx(input: {
  acquired: boolean;
  cursor: HostedExecutionCursorRow;
  events: HostedRunAcquireResponse["events"];
  resumeFinalize: boolean;
  run: HostedRunRow | null;
  runToken?: string;
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<HostedRunAcquireResponse> {
  return {
    acquired: input.acquired,
    cursor: projectHostedExecutionCursorRecord(input.cursor),
    events: input.events,
    pendingIngressEventCount: await countPendingHostedIngressEvents({
      prisma: input.tx,
      userId: input.userId,
    }),
    resumeFinalize: input.resumeFinalize,
    run: input.run ? projectHostedRunRecord(input.run) : null,
    ...(input.runToken === undefined ? {} : { runToken: input.runToken }),
  };
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

  if (input.runtimeTimerDue) {
    return "runtime_timer";
  }

  throw new Error(
    "Hosted run trigger kind requires explicit manual repair, pending wakes, or a due runtime timer.",
  );
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

function cursorBrowserVaultReplicaRefToPrismaJson(
  value: HostedExecutionCursorRow["browserVaultReplicaRef"],
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return toNullablePrismaJson(parseHostedBrowserVaultReplicaRef(value));
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
  ingressEventIdsJson: unknown;
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
    ingressEventIds: readHostedRunStringArray(
      record.ingressEventIdsJson,
      "Hosted run ingressEventIdsJson",
    ),
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
  const redactedMessage = typeof record.redactedJson === "string"
    ? sanitizeHostedRunLogMessage(record.redactedJson, null)
    : null;

  return {
    at: record.at.toISOString(),
    component: record.component,
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    level: parseHostedRunLogLevelForProjection(record.level),
    message: redactedMessage ?? record.message,
    phase: record.phase,
    redacted: record.redactedJson ?? null,
    runId: record.runId,
    userId: record.userId,
  };
}

function sanitizeHostedRunLogMessage(message: string, redacted: unknown): string {
  const candidate = typeof redacted === "string" && redacted.trim().length > 0
    ? redacted
    : message;
  return normalizeHostedExecutionOperatorMessage(
    sanitizeJsonLogString(candidate) ?? candidate,
  );
}

function sanitizeHostedRunStoredJsonValue(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return sanitizeHostedRunLogMessage(value, null);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return toPrismaJson(value.map((entry) => sanitizeHostedRunStoredJsonValue(entry)));
  }
  if (typeof value === "object") {
    return toPrismaJson(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, sanitizeHostedRunStoredJsonValue(entry)]),
      ),
    );
  }
  return null;
}

function parseHostedRunSnapshotRef(value: unknown): HostedIngressSnapshotRef {
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
    case "finalizing":
    case "committed_needs_finalize":
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
