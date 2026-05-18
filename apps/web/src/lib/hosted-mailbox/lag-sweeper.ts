import { createHash } from "node:crypto";

import {
  isHostedMailboxLane,
  type HostedMailboxLaneLag,
} from "@murphai/hosted-execution/runtime-control";
import type { PrismaClient } from "@prisma/client";

import { nudgeHostedAssistantRunnerUserBestEffortResult } from "../hosted-runner/assistant-nudge";
import { getPrisma } from "../prisma";
import {
  computeHostedMailboxLaneLag,
  readHostedMailboxRedactedStatusRecord,
} from "./lag";

const DEFAULT_NUDGE_LIMIT = 25;
const MAX_NUDGE_LIMIT = 250;
const FIRST_LAG_NUDGE_AFTER_MS = 20 * 60_000;
const LAG_NUDGE_REPEAT_MS = 30 * 60_000;
const LAG_NUDGE_WINDOW_MS = 10 * 60_000;
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
  Pick<PrismaClient, "hostedMailboxItem" | "hostedWorkspace">;

type HostedMailboxLagSweeperLogger = Pick<Console, "info" | "warn">;

interface HostedMailboxLaggedUser {
  lanes: HostedMailboxLaggedLane[];
  latestMailboxUpdatedAt: Date | null;
  workspaceCheckpointedAt: Date | null;
}

interface HostedMailboxLaggedLane {
  lag: HostedMailboxLaneLag;
  latestMailboxUpdatedAt: Date | null;
  oldestUncheckpointedAt: Date | null;
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
  const workspaces = await prisma.hostedWorkspace.findMany({
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
  });
  const workspaceByUserId = new Map(
    workspaces.map((workspace) => [workspace.userId, workspace]),
  );
  const laggedByUser = new Map<string, HostedMailboxLaggedUser>();

  for (const highWater of highWaterRows) {
    if (!isHostedMailboxLane(highWater.lane) || highWater._max.laneSeq === null) {
      continue;
    }

    const workspace = workspaceByUserId.get(highWater.userId) ?? null;
    const redactedStatusJson = readHostedMailboxRedactedStatusRecord(
      workspace?.redactedStatusJson ?? null,
    );
    const lag = computeHostedMailboxLaneLag({
      highWater: {
        lane: highWater.lane,
        maxSeq: highWater._max.laneSeq.toString(),
        maxUpdatedAt: highWater._max.updatedAt?.toISOString() ?? null,
      },
      redactedStatusJson,
    });

    if (lag.lag === "0") {
      continue;
    }

    const laggedLane = await buildHostedMailboxLaggedLane({
      highWaterLatestUpdatedAt: highWater._max.updatedAt,
      lag,
      prisma,
      userId: highWater.userId,
    });
    const existing = laggedByUser.get(highWater.userId);
    if (existing) {
      existing.lanes.push(laggedLane);
      existing.latestMailboxUpdatedAt = maxNullableDate(
        existing.latestMailboxUpdatedAt,
        highWater._max.updatedAt,
      );
      continue;
    }

    laggedByUser.set(highWater.userId, {
      lanes: [laggedLane],
      latestMailboxUpdatedAt: highWater._max.updatedAt,
      workspaceCheckpointedAt: workspace?.checkpointedAt ?? null,
    });
  }

  const laggedUsers = Array.from(laggedByUser.entries());
  const eligibleLaggedUsers = laggedUsers.filter(([, lagged]) =>
    shouldNudgeHostedMailboxLaggedUser({
      lagged,
      now,
    })
  );
  const selectedLaggedUsers = selectRotatingNudgeWindow({
    laggedUsers: eligibleLaggedUsers,
    now,
    nudgeLimit,
  });
  const laggedLaneCount = countHostedMailboxLaggedLanes(laggedUsers);
  const eligibleLaggedLaneCount = countHostedMailboxEligibleLaggedLanes({
    laggedUsers,
    now,
  });
  const freshGraceUsers = Math.max(0, laggedByUser.size - eligibleLaggedUsers.length);
  const limitSkippedUsers = Math.max(0, eligibleLaggedUsers.length - selectedLaggedUsers.length);
  const oldestUncheckpointedAgeMs = maxHostedMailboxUncheckpointedAgeMs({
    laggedUsers,
    now,
  });

  logger.info("Hosted mailbox lag sweeper scanned mailbox high-water rows.", {
    eligibleLaggedLaneCount,
    highWaterRows: highWaterRows.length,
    laggedLaneCount,
    eligibleLaggedUsers: eligibleLaggedUsers.length,
    laggedUsers: laggedByUser.size,
    nudgeLimit,
    oldestUncheckpointedAgeMs,
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
        lanes: lagged.lanes.map(formatHostedMailboxLaggedLaneForLog),
        latestMailboxUpdatedAt: lagged.latestMailboxUpdatedAt?.toISOString() ?? null,
        oldestUncheckpointedAt: minHostedMailboxLaneDate(lagged.lanes)
          ?.toISOString() ?? null,
        userFingerprint,
        workspaceCheckpointedAt: lagged.workspaceCheckpointedAt?.toISOString() ?? null,
      });
      const nudgeInput = {
        context: "hosted-mailbox-lag-sweeper",
        timeoutMs: NUDGE_TIMEOUT_MS,
        userId,
      };
      const nudge = await nudgeHostedAssistantRunnerUserBestEffortResult(nudgeInput);

      if (nudge.accepted) {
        nudgeAccepted += 1;
        logger.info("Hosted mailbox lag sweeper runner nudge accepted.", {
          alarmScheduled: nudge.alarmScheduled,
          immediateDriveStarted: nudge.immediateDriveStarted,
          inFlight: nudge.inFlight,
          kind: nudge.kind,
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

  const skippedLaggedUsers = freshGraceUsers + limitSkippedUsers;
  if (skippedLaggedUsers > 0) {
    logger.warn("Hosted mailbox lag sweeper skipped lagged users.", {
      eligibleLaggedUsers: eligibleLaggedUsers.length,
      freshGraceUsers,
      limitSkippedUsers,
      nudgeLimit,
      oldestUncheckpointedAgeMs,
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

function shouldNudgeHostedMailboxLaggedUser(input: {
  lagged: HostedMailboxLaggedUser;
  now: Date;
}): boolean {
  return input.lagged.lanes.some((lane) =>
    shouldNudgeHostedMailboxLaggedLane({
      lane,
      now: input.now,
    })
  );
}

function shouldNudgeHostedMailboxLaggedLane(input: {
  lane: HostedMailboxLaggedLane;
  now: Date;
}): boolean {
  if (!input.lane.oldestUncheckpointedAt) {
    return true;
  }

  const lagAgeMs = input.now.getTime() - input.lane.oldestUncheckpointedAt.getTime();

  if (lagAgeMs < 0) {
    return true;
  }

  if (lagAgeMs < FIRST_LAG_NUDGE_AFTER_MS) {
    return false;
  }

  return ((lagAgeMs - FIRST_LAG_NUDGE_AFTER_MS) % LAG_NUDGE_REPEAT_MS)
    < LAG_NUDGE_WINDOW_MS;
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

async function buildHostedMailboxLaggedLane(input: {
  highWaterLatestUpdatedAt: Date | null;
  lag: HostedMailboxLaneLag;
  prisma: HostedMailboxLagSweeperPrisma;
  userId: string;
}): Promise<HostedMailboxLaggedLane> {
  const oldestUncheckpointedAt = await readOldestUncheckpointedMailboxUpdatedAt({
    importedSeq: input.lag.importedSeq,
    lane: input.lag.lane,
    prisma: input.prisma,
    userId: input.userId,
  });

  return {
    lag: input.lag,
    latestMailboxUpdatedAt: input.highWaterLatestUpdatedAt,
    oldestUncheckpointedAt,
  };
}

async function readOldestUncheckpointedMailboxUpdatedAt(input: {
  importedSeq: string;
  lane: HostedMailboxLaneLag["lane"];
  prisma: HostedMailboxLagSweeperPrisma;
  userId: string;
}): Promise<Date | null> {
  const oldestUncheckpointed = await input.prisma.hostedMailboxItem.findFirst({
    orderBy: {
      laneSeq: "asc",
    },
    select: {
      updatedAt: true,
    },
    where: {
      lane: input.lane,
      laneSeq: {
        gt: BigInt(input.importedSeq),
      },
      userId: input.userId,
    },
  });

  return oldestUncheckpointed?.updatedAt ?? null;
}

function minHostedMailboxLaneDate(
  lanes: HostedMailboxLaggedLane[],
): Date | null {
  return lanes.reduce<Date | null>(
    (oldest, lane) => {
      if (!lane.oldestUncheckpointedAt) {
        return oldest;
      }

      return oldest === null || lane.oldestUncheckpointedAt < oldest
        ? lane.oldestUncheckpointedAt
        : oldest;
    },
    null,
  );
}

function countHostedMailboxLaggedLanes(
  laggedUsers: HostedMailboxLaggedUserEntry[],
): number {
  return laggedUsers.reduce((total, [, lagged]) => total + lagged.lanes.length, 0);
}

function countHostedMailboxEligibleLaggedLanes(input: {
  laggedUsers: HostedMailboxLaggedUserEntry[];
  now: Date;
}): number {
  return input.laggedUsers.reduce(
    (total, [, lagged]) => total + lagged.lanes.filter((lane) =>
      shouldNudgeHostedMailboxLaggedLane({
        lane,
        now: input.now,
      })
    ).length,
    0,
  );
}

function maxHostedMailboxUncheckpointedAgeMs(input: {
  laggedUsers: HostedMailboxLaggedUserEntry[];
  now: Date;
}): number | null {
  let maxAgeMs: number | null = null;

  for (const [, lagged] of input.laggedUsers) {
    for (const lane of lagged.lanes) {
      if (!lane.oldestUncheckpointedAt) {
        continue;
      }

      const ageMs = input.now.getTime() - lane.oldestUncheckpointedAt.getTime();
      maxAgeMs = maxAgeMs === null ? ageMs : Math.max(maxAgeMs, ageMs);
    }
  }

  return maxAgeMs;
}

function formatHostedMailboxLaggedLaneForLog(
  lane: HostedMailboxLaggedLane,
): HostedMailboxLaneLag & {
  latestMailboxUpdatedAt: string | null;
  oldestUncheckpointedAt: string | null;
} {
  return {
    ...lane.lag,
    latestMailboxUpdatedAt: lane.latestMailboxUpdatedAt?.toISOString() ?? null,
    oldestUncheckpointedAt: lane.oldestUncheckpointedAt?.toISOString() ?? null,
  };
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
