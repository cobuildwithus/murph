import { createHash } from "node:crypto";

import {
  isHostedMailboxLane,
  type HostedMailboxLaneLag,
} from "@murphai/hosted-execution/runtime-control";
import type { PrismaClient } from "@prisma/client";

import { signalHostedUserRuntimeWorkflow } from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";
import {
  computeHostedMailboxLaneLag,
  readHostedMailboxRedactedStatusRecord,
} from "./lag";

const DEFAULT_SIGNAL_LIMIT = 25;
const MAX_SIGNAL_LIMIT = 250;
const FIRST_LAG_SIGNAL_AFTER_MS = 20 * 60_000;
const LAG_SIGNAL_REPEAT_MS = 30 * 60_000;
const LAG_SIGNAL_WINDOW_MS = 10 * 60_000;
const SIGNAL_CONCURRENCY = 5;

export interface HostedMailboxLagSweeperResult {
  highWaterRows: number;
  laggedUsers: number;
  signalAccepted: number;
  signalAttempted: number;
  signalFailed: number;
  signalLimit: number;
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
  signalLimit?: number;
  prisma?: HostedMailboxLagSweeperPrisma;
} = {}): Promise<HostedMailboxLagSweeperResult> {
  const prisma = input.prisma ?? getPrisma();
  const logger = input.logger ?? console;
  const now = input.now ?? new Date();
  const signalLimit = normalizeLimit(
    input.signalLimit,
    DEFAULT_SIGNAL_LIMIT,
    MAX_SIGNAL_LIMIT,
  );
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
    shouldSignalHostedMailboxLaggedUser({
      lagged,
      now,
    })
  );
  const selectedLaggedUsers = selectRotatingSignalWindow({
    laggedUsers: eligibleLaggedUsers,
    now,
    signalLimit,
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
    signalLimit,
    oldestUncheckpointedAgeMs,
    selectedLaggedUsers: selectedLaggedUsers.length,
  });

  let signalAccepted = 0;
  let signalAttempted = 0;
  let signalFailed = 0;

  await runWithConcurrency(
    selectedLaggedUsers,
    SIGNAL_CONCURRENCY,
    async ([userId, lagged]) => {
      signalAttempted += 1;
      const userFingerprint = fingerprintHostedMailboxLagUser(userId);
      const eventId = buildHostedMailboxLagObservedEventId({
        now,
        userId,
      });
      logger.warn("Hosted mailbox lag sweeper signaling Temporal for mailbox lag.", {
        lanes: lagged.lanes.map(formatHostedMailboxLaggedLaneForLog),
        latestMailboxUpdatedAt: lagged.latestMailboxUpdatedAt?.toISOString() ?? null,
        oldestUncheckpointedAt: minHostedMailboxLaneDate(lagged.lanes)
          ?.toISOString() ?? null,
        userFingerprint,
        workspaceCheckpointedAt: lagged.workspaceCheckpointedAt?.toISOString() ?? null,
      });

      try {
        await signalHostedUserRuntimeWorkflow({
          signal: {
            eventId,
            kind: "mailbox_lag_observed",
            source: "lag-sweeper",
          },
          userId,
        });
        signalAccepted += 1;
        logger.info("Hosted mailbox lag sweeper Temporal signal accepted.", {
          userFingerprint,
        });
        return;
      } catch (error) {
        signalFailed += 1;
        logger.warn("Hosted mailbox lag sweeper Temporal signal failed.", {
          errorCode: classifyHostedMailboxLagSignalError(error),
          userFingerprint,
        });
      }
    },
  );

  const skippedLaggedUsers = freshGraceUsers + limitSkippedUsers;
  if (skippedLaggedUsers > 0) {
    logger.warn("Hosted mailbox lag sweeper skipped lagged users.", {
      eligibleLaggedUsers: eligibleLaggedUsers.length,
      freshGraceUsers,
      limitSkippedUsers,
      oldestUncheckpointedAgeMs,
      signalLimit,
      skippedLaggedUsers,
    });
  }

  return {
    highWaterRows: highWaterRows.length,
    laggedUsers: laggedByUser.size,
    signalAccepted,
    signalAttempted,
    signalFailed,
    signalLimit,
    skippedLaggedUsers,
  };
}

function shouldSignalHostedMailboxLaggedUser(input: {
  lagged: HostedMailboxLaggedUser;
  now: Date;
}): boolean {
  return input.lagged.lanes.some((lane) =>
    shouldSignalHostedMailboxLaggedLane({
      lane,
      now: input.now,
    })
  );
}

function shouldSignalHostedMailboxLaggedLane(input: {
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

  if (lagAgeMs < FIRST_LAG_SIGNAL_AFTER_MS) {
    return false;
  }

  return ((lagAgeMs - FIRST_LAG_SIGNAL_AFTER_MS) % LAG_SIGNAL_REPEAT_MS)
    < LAG_SIGNAL_WINDOW_MS;
}

function selectRotatingSignalWindow(input: {
  laggedUsers: HostedMailboxLaggedUserEntry[];
  now: Date;
  signalLimit: number;
}): HostedMailboxLaggedUserEntry[] {
  const laggedUsers = [...input.laggedUsers].sort(([left], [right]) => left.localeCompare(right));

  if (laggedUsers.length <= input.signalLimit) {
    return laggedUsers;
  }

  const minute = Math.floor(input.now.getTime() / 60_000);
  const offset = minute % laggedUsers.length;
  const rotated = laggedUsers.slice(offset).concat(laggedUsers.slice(0, offset));

  return rotated.slice(0, input.signalLimit);
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

function buildHostedMailboxLagObservedEventId(input: {
  now: Date;
  userId: string;
}): string {
  const minute = Math.floor(input.now.getTime() / 60_000);
  const fingerprint = createHash("sha256")
    .update(`mailbox-lag:${input.userId}:${minute}`)
    .digest("hex")
    .slice(0, 24);

  return `mailbox-lag:${minute}:${fingerprint}`;
}

function classifyHostedMailboxLagSignalError(error: unknown): string {
  if (error instanceof Error && error.name.trim()) {
    return error.name.slice(0, 64);
  }

  return "UnknownError";
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
      shouldSignalHostedMailboxLaggedLane({
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
