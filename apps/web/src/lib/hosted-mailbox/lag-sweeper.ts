import { createHash } from "node:crypto";

import {
  isHostedMailboxLane,
  type HostedMailboxLaneLag,
} from "@murphai/hosted-execution/runtime-control";
import type { PrismaClient } from "@prisma/client";

import { nudgeHostedRunnerUserBestEffortResult } from "../hosted-runner/control";
import { getPrisma } from "../prisma";
import {
  computeHostedMailboxLaneLag,
  mergeLatestHostedMailboxImportRedactedStatus,
  readHostedMailboxRedactedStatusRecord,
} from "./lag";

const DEFAULT_NUDGE_LIMIT = 25;
const MAX_NUDGE_LIMIT = 250;
const NUDGE_TIMEOUT_MS = 5_000;
const NUDGE_CONCURRENCY = 5;

export interface HostedMailboxLagSweeperResult {
  highWaterRows: number;
  laggedUsers: number;
  nudgeAccepted: number;
  nudgeAttempted: number;
  nudgeLimit: number;
  nudgeNotAccepted: number;
  skippedLaggedUsers: number;
}

type HostedMailboxLagSweeperPrisma =
  Pick<PrismaClient, "hostedMailboxItem" | "hostedRuntimeLog" | "hostedWorkspace">;

type HostedMailboxLagSweeperLogger = Pick<Console, "info" | "warn">;

interface HostedMailboxLaggedUser {
  lanes: HostedMailboxLaneLag[];
  latestMailboxUpdatedAt: Date | null;
  workspaceCheckpointedAt: Date | null;
}

type HostedMailboxLaggedUserEntry = [string, HostedMailboxLaggedUser];

export async function runHostedMailboxLagSweeper(input: {
  logger?: HostedMailboxLagSweeperLogger;
  now?: Date;
  nudgeLimit?: number;
  prisma?: HostedMailboxLagSweeperPrisma;
} = {}): Promise<HostedMailboxLagSweeperResult> {
  const prisma = input.prisma ?? getPrisma();
  const logger = input.logger ?? console;
  const now = input.now ?? new Date();
  const nudgeLimit = normalizeLimit(input.nudgeLimit, DEFAULT_NUDGE_LIMIT, MAX_NUDGE_LIMIT);
  const highWaterRows = await prisma.hostedMailboxItem.groupBy({
    _max: {
      laneSeq: true,
      updatedAt: true,
    },
    by: ["userId", "lane"],
  });
  const userIds = Array.from(new Set(highWaterRows.map((row) => row.userId)));
  const [workspaces, latestMailboxImportLogs] = await Promise.all([
    prisma.hostedWorkspace.findMany({
      select: {
        checkpointedAt: true,
        redactedStatusJson: true,
        userId: true,
      },
      where: {
        userId: {
          in: userIds,
        },
      },
    }),
    userIds.length > 0
      ? prisma.hostedRuntimeLog.findMany({
        distinct: ["userId"],
        orderBy: {
          at: "desc",
        },
        select: {
          redactedJson: true,
          userId: true,
        },
        where: {
          eventCode: "mailbox.imported",
          userId: {
            in: userIds,
          },
        },
      })
      : Promise.resolve([]),
  ]);
  const workspaceByUserId = new Map(
    workspaces.map((workspace) => [workspace.userId, workspace]),
  );
  const latestMailboxImportStatusByUserId = new Map(
    latestMailboxImportLogs.map((log) => [
      log.userId,
      readHostedMailboxRedactedStatusRecord(log.redactedJson),
    ]),
  );
  const laggedByUser = new Map<string, HostedMailboxLaggedUser>();

  for (const highWater of highWaterRows) {
    if (!isHostedMailboxLane(highWater.lane) || highWater._max.laneSeq === null) {
      continue;
    }

    const workspace = workspaceByUserId.get(highWater.userId) ?? null;
    const redactedStatusJson = mergeLatestHostedMailboxImportRedactedStatus(
      readHostedMailboxRedactedStatusRecord(workspace?.redactedStatusJson ?? null),
      latestMailboxImportStatusByUserId.get(highWater.userId) ?? null,
    );
    const lag = computeHostedMailboxLaneLag({
      highWater: {
        lane: highWater.lane,
        maxSeq: highWater._max.laneSeq.toString(),
      },
      redactedStatusJson,
    });

    if (lag.lag === "0") {
      continue;
    }

    const existing = laggedByUser.get(highWater.userId);
    if (existing) {
      existing.lanes.push(lag);
      existing.latestMailboxUpdatedAt = maxNullableDate(
        existing.latestMailboxUpdatedAt,
        highWater._max.updatedAt,
      );
      continue;
    }

    laggedByUser.set(highWater.userId, {
      lanes: [lag],
      latestMailboxUpdatedAt: highWater._max.updatedAt,
      workspaceCheckpointedAt: workspace?.checkpointedAt ?? null,
    });
  }

  const selectedLaggedUsers = selectRotatingNudgeWindow({
    laggedUsers: Array.from(laggedByUser.entries()),
    now,
    nudgeLimit,
  });

  logger.info("Hosted mailbox lag sweeper scanned mailbox high-water rows.", {
    highWaterRows: highWaterRows.length,
    laggedUsers: laggedByUser.size,
    nudgeLimit,
    selectedLaggedUsers: selectedLaggedUsers.length,
  });

  let nudgeAccepted = 0;
  let nudgeAttempted = 0;
  let nudgeNotAccepted = 0;

  await runWithConcurrency(
    selectedLaggedUsers,
    NUDGE_CONCURRENCY,
    async ([userId, lagged]) => {
      nudgeAttempted += 1;
      const userFingerprint = fingerprintHostedMailboxLagUser(userId);
      logger.warn("Hosted mailbox lag sweeper nudging runner for mailbox lag.", {
        lanes: lagged.lanes,
        latestMailboxUpdatedAt: lagged.latestMailboxUpdatedAt?.toISOString() ?? null,
        userFingerprint,
        workspaceCheckpointedAt: lagged.workspaceCheckpointedAt?.toISOString() ?? null,
      });
      const nudge = await nudgeHostedRunnerUserBestEffortResult({
        context: "hosted-mailbox-lag-sweeper",
        timeoutMs: NUDGE_TIMEOUT_MS,
        userId,
      });

      if (nudge.accepted) {
        nudgeAccepted += 1;
        logger.info("Hosted mailbox lag sweeper runner nudge accepted.", {
          alarmScheduled: nudge.alarmScheduled,
          alreadyRunning: nudge.alreadyRunning,
          immediateDriveStarted: nudge.immediateDriveStarted,
          inFlight: nudge.inFlight,
          nextAlarmAtPresent: nudge.nextAlarmAtPresent,
          userFingerprint,
        });
        return;
      }

      nudgeNotAccepted += 1;
      logger.warn("Hosted mailbox lag sweeper runner nudge was not accepted.", {
        configured: nudge.configured,
        errorCode: nudge.errorCode,
        userFingerprint,
      });
    },
  );

  const skippedLaggedUsers = Math.max(0, laggedByUser.size - selectedLaggedUsers.length);
  if (skippedLaggedUsers > 0) {
    logger.warn("Hosted mailbox lag sweeper skipped lagged users after nudge limit.", {
      nudgeLimit,
      skippedLaggedUsers,
    });
  }

  return {
    highWaterRows: highWaterRows.length,
    laggedUsers: laggedByUser.size,
    nudgeAccepted,
    nudgeAttempted,
    nudgeLimit,
    nudgeNotAccepted,
    skippedLaggedUsers,
  };
}

function selectRotatingNudgeWindow(input: {
  laggedUsers: HostedMailboxLaggedUserEntry[];
  now: Date;
  nudgeLimit: number;
}): HostedMailboxLaggedUserEntry[] {
  const laggedUsers = [...input.laggedUsers].sort(([left], [right]) => left.localeCompare(right));

  if (laggedUsers.length <= input.nudgeLimit) {
    return laggedUsers;
  }

  const minute = Math.floor(input.now.getTime() / 60_000);
  const offset = minute % laggedUsers.length;
  const rotated = laggedUsers.slice(offset).concat(laggedUsers.slice(0, offset));

  return rotated.slice(0, input.nudgeLimit);
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }));
}

function fingerprintHostedMailboxLagUser(userId: string): string {
  return createHash("sha256")
    .update(userId)
    .digest("hex")
    .slice(0, 12);
}

function maxNullableDate(left: Date | null, right: Date | null): Date | null {
  if (left === null) {
    return right;
  }

  if (right === null) {
    return left;
  }

  return left > right ? left : right;
}

function normalizeLimit(
  value: number | undefined,
  defaultValue: number,
  maxValue: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maxValue)
    : defaultValue;
}
