import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  HOSTED_RUN_STALE_RUNNER_USER_ERROR_CODE,
  type HostedRunAcquireResponse,
  type HostedRunExecutorKind,
  type HostedRunTriggerKind,
  type HostedRunTurnInputAdoptResponse,
  type HostedRunTurnInputPeekResponse,
} from "@murphai/hosted-execution/contracts";

import { countPendingHostedIngressEvents } from "../hosted-ingress/store";
import { hydrateHostedIngressEventsTx, projectHostedExecutionCursorRecord } from "../hosted-ingress/store-projections";
import type {
  HostedExecutionCursorRow,
  HostedIngressEventRow,
  HostedIngressStoreClient,
} from "../hosted-ingress/store.types";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";

import {
  closeHostedRunWithoutCommitTx,
  readHostedRunForMutationTx,
  resetHostedRunFinalizeForRetryTx,
} from "./lifecycle";
import { projectHostedRunRecord } from "./projection";
import {
  createHostedRunToken,
  DEFAULT_HOSTED_RUN_EXECUTOR_KIND,
  HOSTED_RUN_ACTIVE_STATUSES,
  HOSTED_RUN_FINALIZING_STATUS,
  HOSTED_RUN_FINALIZE_RESUMABLE_STATUS,
  hashHostedRunToken,
  type HostedRunMutationTx,
  type HostedRunRow,
  isHostedRunActiveStale,
  loadLockedCursorTx,
  loadLockedCursorRowTx,
  normalizeHostedRunAcquireLimit,
  normalizeHostedRunTurnInputLimit,
  normalizeNullableHostedRunString,
  readHostedRunBigIntArray,
  readHostedRunStringArray,
  toNullablePrismaJson,
  toPrismaJsonArray,
  uniqueStrings,
} from "./shared";

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
  const cursor = await loadLockedAcquireCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
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
  await loadLockedCursorTx({
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
  await loadLockedCursorTx({
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

async function loadLockedAcquireCursorRowTx(input: {
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<HostedExecutionCursorRow> {
  try {
    return await loadLockedCursorRowTx(input);
  } catch (error) {
    throw mapHostedRunAcquireCursorError(error);
  }
}

function mapHostedRunAcquireCursorError(error: unknown): Error {
  if (isHostedExecutionCursorForeignKeyError(error)) {
    return createHostedRunStaleRunnerUserError();
  }

  return error instanceof Error ? error : new Error("Hosted run acquire cursor load failed.");
}

function isHostedExecutionCursorForeignKeyError(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError)
    || error.code !== "P2003"
  ) {
    return false;
  }

  const modelName = error.meta?.modelName;
  if (modelName === "HostedExecutionCursor") {
    return true;
  }

  return typeof error.message === "string"
    && error.message.includes("hosted_execution_cursor_user_id_fkey");
}

function createHostedRunStaleRunnerUserError(): Error {
  return hostedOnboardingError({
    code: HOSTED_RUN_STALE_RUNNER_USER_ERROR_CODE,
    details: {
      boundary: "hosted-run.acquire",
      condition: "stale_runner_missing_hosted_member",
    },
    httpStatus: 410,
    message: "Hosted runner is bound to a member that no longer exists in the hosted web database.",
    retryable: false,
  });
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
