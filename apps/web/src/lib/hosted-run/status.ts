import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  HostedRunLogLevel,
  HostedRunLogResponse,
  HostedRunStatusResponse,
} from "@murphai/hosted-execution/contracts";

import { countPendingHostedIngressEvents } from "../hosted-ingress/store";
import { ensureHostedExecutionCursorRow } from "../hosted-ingress/store-data";
import { projectHostedExecutionCursorRecord } from "../hosted-ingress/store-projections";
import { getPrisma } from "../prisma";

import { projectHostedRunLogRecord, projectHostedRunRecord } from "./projection";
import {
  sanitizeHostedRunLogMessage,
  sanitizeHostedRunStoredJsonValue,
} from "./sanitize";
import {
  type HostedRunMutationTx,
  type HostedRunRow,
  type HostedRunStoreClient,
  hostedRunTokenMatches,
  normalizeHostedRunStatusLimit,
  toNullablePrismaJson,
} from "./shared";

export async function readHostedExecutionCursorForUser(input: {
  prisma?: HostedRunStoreClient;
  userId: string;
}) {
  const prisma = input.prisma ?? getPrisma();
  const cursor = await ensureHostedExecutionCursorRow({
    tx: prisma,
    userId: input.userId,
  });

  return projectHostedExecutionCursorRecord(cursor);
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
  const cursor = await ensureHostedExecutionCursorRow({
    tx: prisma,
    userId: input.userId,
  });
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
