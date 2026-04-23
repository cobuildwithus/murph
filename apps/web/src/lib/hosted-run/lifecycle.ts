import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  HostedBrowserVaultReplicaCursorRef,
  HostedIngressSnapshotRef,
  HostedRunCommitResponse,
  HostedRunEventResult,
  HostedRunFinalizeResponse,
  HostedRunReleaseFinalizeResponse,
  HostedRunStatus,
} from "@murphai/hosted-execution/contracts";

import { getPrisma } from "../prisma";
import { ensureHostedExecutionCursorRow } from "../hosted-ingress/store-data";
import { projectHostedExecutionCursorRecord } from "../hosted-ingress/store-projections";
import type {
  HostedExecutionCursorRow,
  HostedIngressMutationTx,
} from "../hosted-ingress/store.types";

import { projectHostedRunRecord } from "./projection";
import { sanitizeHostedRunStoredJsonValue } from "./sanitize";
import {
  cursorBrowserVaultReplicaRefToPrismaJson,
  cursorSnapshotRefToPrismaJson,
  HOSTED_RUN_FINALIZING_STATUS,
  HOSTED_RUN_FINALIZE_RESUMABLE_STATUS,
  type HostedRunCursorUpdateInput,
  type HostedRunMutationTx,
  type HostedRunRow,
  hostedRunTokenMatches,
  loadLockedCursorRowTx,
  normalizeHostedRunFailureClass,
  normalizeHostedRunFailureCode,
  normalizeHostedRunWakeAt,
  normalizeHostedRunWakeQuarantineCode,
  normalizeHostedRunWakeReason,
  readHostedRunBigIntArray,
  readHostedRunStringArray,
  toNullablePrismaJson,
} from "./shared";

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
  const cursor = await loadLockedCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
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
    return failCommit({
      cursor,
      errorClass: normalizeHostedRunFailureClass(input.failureClass) ?? "hosted_run_runtime",
      errorCode: failureCode,
      run,
      status: "failed",
      tx: input.tx,
      userId: input.userId,
    });
  }

  if (input.expectedCursorVersion !== run.inputCursorVersion) {
    return failCommit({
      cursor,
      errorCode: "HOSTED_RUN_EXPECTED_CURSOR_VERSION_MISMATCH",
      run,
      status: "failed",
      tx: input.tx,
      userId: input.userId,
    });
  }

  if (cursor.version !== run.inputCursorVersion || cursor.committedSeq !== run.inputCommittedSeq) {
    return failCommit({
      cursor,
      errorCode: "HOSTED_RUN_CURSOR_CONFLICT",
      run,
      status: "superseded",
      tx: input.tx,
      userId: input.userId,
    });
  }

  if (input.outputCommittedSeq < run.inputCommittedSeq) {
    return failCommit({
      cursor,
      errorCode: "HOSTED_RUN_OUTPUT_SEQ_REGRESSION",
      run,
      status: "failed",
      tx: input.tx,
      userId: input.userId,
    });
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
    return failCommit({
      cursor,
      errorCode: "HOSTED_RUN_OUTPUT_SEQ_OUTSIDE_ACQUIRED_RANGE",
      run,
      status: "failed",
      tx: input.tx,
      userId: input.userId,
    });
  }

  const eventResultsValidationError = validateHostedRunEventResults({
    eventResults: input.eventResults ?? [],
    expectedIngressEventIds: committedIngressEventIds,
  });

  if (eventResultsValidationError) {
    return failCommit({
      cursor,
      errorCode: eventResultsValidationError,
      run,
      status: "failed",
      tx: input.tx,
      userId: input.userId,
    });
  }

  const cursorUpdateFields = resolveCursorUpdateFields({
    browserVaultReplicaRef: input.browserVaultReplicaRef,
    cursor,
    nextRuntimeWakeAt: input.nextRuntimeWakeAt,
    nextRuntimeWakeReason: input.nextRuntimeWakeReason,
    snapshotRef: input.preparedSnapshotRef,
  });
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
      ...cursorUpdateFields,
      version: { increment: 1 },
    },
  });

  if (updateResult.count !== 1) {
    const current = await ensureHostedExecutionCursorRow({
      tx: input.tx,
      userId: input.userId,
    });

    return failCommit({
      cursor: current,
      errorCode: "HOSTED_RUN_CURSOR_CAS_LOST",
      run,
      status: "superseded",
      tx: input.tx,
      userId: input.userId,
    });
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

  const current = await ensureHostedExecutionCursorRow({
    tx: input.tx,
    userId: input.userId,
  });
  const needsFinalize = input.finalizeRequired;
  const updatedRun = await input.tx.hostedRun.update({
    where: { id: run.id },
    data: {
      committedAt: now,
      nextRuntimeWakeAt: cursorUpdateFields.nextRuntimeWakeAt,
      nextRuntimeWakeReason: cursorUpdateFields.nextRuntimeWakeReason,
      outputCommittedSeq: input.outputCommittedSeq,
      outputCursorVersion: current.version,
      preparedAt: now,
      preparedSnapshotRef: cursorUpdateFields.snapshotRef,
      redactedSummaryJson: safeRedactedSummary === undefined
        ? undefined
        : toNullablePrismaJson(safeRedactedSummary),
      status: needsFinalize ? "committed_needs_finalize" : "finalized",
      ...(needsFinalize
        ? {}
        : {
            finalSnapshotRef: cursorUpdateFields.snapshotRef,
            finalizedAt: now,
          }),
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
  const cursor = await loadLockedCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
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
    return failFinalize({
      cursor,
      errorCode: "HOSTED_RUN_FINALIZE_MISSING_COMMIT_STATE",
      run,
      status: "failed",
      tx: input.tx,
    });
  }

  if (cursor.version !== run.outputCursorVersion || cursor.committedSeq !== run.outputCommittedSeq) {
    return failFinalize({
      cursor,
      errorCode: "HOSTED_RUN_FINALIZE_CURSOR_CONFLICT",
      run,
      status: "superseded",
      tx: input.tx,
    });
  }

  const cursorUpdateFields = resolveCursorUpdateFields({
    browserVaultReplicaRef: input.browserVaultReplicaRef,
    cursor,
    nextRuntimeWakeAt: input.nextRuntimeWakeAt,
    nextRuntimeWakeReason: input.nextRuntimeWakeReason,
    snapshotRef: input.finalSnapshotRef,
  });
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
      ...cursorUpdateFields,
      version: { increment: 1 },
    },
  });

  if (updateResult.count !== 1) {
    const current = await ensureHostedExecutionCursorRow({
      tx: input.tx,
      userId: input.userId,
    });

    return failFinalize({
      cursor: current,
      errorCode: "HOSTED_RUN_FINALIZE_CURSOR_CAS_LOST",
      run,
      status: "superseded",
      tx: input.tx,
    });
  }

  const current = await ensureHostedExecutionCursorRow({
    tx: input.tx,
    userId: input.userId,
  });
  const updatedRun = await input.tx.hostedRun.update({
    where: { id: run.id },
    data: {
      finalSnapshotRef: cursorUpdateFields.snapshotRef,
      finalizedAt: now,
      nextRuntimeWakeAt: cursorUpdateFields.nextRuntimeWakeAt,
      nextRuntimeWakeReason: cursorUpdateFields.nextRuntimeWakeReason,
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
  const cursor = await loadLockedCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
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

function resolveCursorUpdateFields(input: HostedRunCursorUpdateInput): {
  browserVaultReplicaRef: Prisma.InputJsonValue | typeof Prisma.DbNull;
  nextRuntimeWakeAt: Date | null;
  nextRuntimeWakeReason: string | null;
  snapshotRef: Prisma.InputJsonValue | typeof Prisma.DbNull;
} {
  return {
    snapshotRef: input.snapshotRef === undefined
      ? cursorSnapshotRefToPrismaJson(input.cursor.snapshotRef)
      : toNullablePrismaJson(input.snapshotRef),
    browserVaultReplicaRef: input.browserVaultReplicaRef === undefined
      ? cursorBrowserVaultReplicaRefToPrismaJson(input.cursor.browserVaultReplicaRef)
      : toNullablePrismaJson(input.browserVaultReplicaRef),
    nextRuntimeWakeAt: input.nextRuntimeWakeAt === undefined
      ? input.cursor.nextRuntimeWakeAt
      : normalizeHostedRunWakeAt(input.nextRuntimeWakeAt),
    nextRuntimeWakeReason: input.nextRuntimeWakeReason === undefined
      ? input.cursor.nextRuntimeWakeReason
      : normalizeHostedRunWakeReason(input.nextRuntimeWakeReason),
  };
}

async function failCommit(input: {
  cursor: HostedExecutionCursorRow;
  errorClass?: string | null;
  errorCode: string;
  run: HostedRunRow;
  status: Extract<HostedRunStatus, "failed" | "superseded">;
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<HostedRunCommitResponse> {
  const failedRun = await closeHostedRunWithoutCommitTx({
    cursor: input.cursor,
    errorClass: input.errorClass,
    errorCode: input.errorCode,
    run: input.run,
    status: input.status,
    tx: input.tx,
    userId: input.userId,
  });

  return {
    committed: false,
    cursor: projectHostedExecutionCursorRecord(input.cursor),
    needsFinalize: false,
    run: projectHostedRunRecord(failedRun),
  };
}

async function failFinalize(input: {
  cursor: HostedExecutionCursorRow;
  errorCode: string;
  run: HostedRunRow;
  status: Extract<HostedRunStatus, "failed" | "superseded">;
  tx: HostedRunMutationTx;
}): Promise<HostedRunFinalizeResponse> {
  const failedRun = await closeHostedRunFinalizeConflictTx({
    errorCode: input.errorCode,
    run: input.run,
    status: input.status,
    tx: input.tx,
  });

  return {
    cursor: projectHostedExecutionCursorRecord(input.cursor),
    finalized: false,
    run: projectHostedRunRecord(failedRun),
  };
}

export async function readHostedRunForMutationTx(input: {
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

export async function resetHostedRunFinalizeForRetryTx(input: {
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

export async function closeHostedRunWithoutCommitTx(input: {
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
