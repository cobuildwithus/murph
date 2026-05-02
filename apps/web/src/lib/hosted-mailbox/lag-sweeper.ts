import {
  isHostedMailboxLane,
  type HostedMailboxLaneLag,
} from "@murphai/hosted-execution/runtime-control";
import type { PrismaClient } from "@prisma/client";

import { nudgeHostedRunnerUserBestEffortResult } from "../hosted-runner/control";
import { getPrisma } from "../prisma";
import { computeHostedMailboxLaneLag } from "./lag";

const DEFAULT_COUNTER_LIMIT = 500;
const DEFAULT_NUDGE_LIMIT = 50;
const MAX_COUNTER_LIMIT = 5_000;
const MAX_NUDGE_LIMIT = 250;
const NUDGE_TIMEOUT_MS = 5_000;

export interface HostedMailboxLagSweeperResult {
  candidateCounters: number;
  currentCounters: number;
  invalidLaneCounters: number;
  laggedCounters: number;
  laggedUsers: number;
  nudgeAccepted: number;
  nudgeAttempted: number;
  nudgeLimit: number;
  nudgeNotAccepted: number;
  skippedLaggedUsers: number;
}

type HostedMailboxLagSweeperPrisma = Pick<PrismaClient, "hostedMailboxLaneCounter">;

type HostedMailboxLagSweeperLogger = Pick<Console, "info" | "warn">;

export async function runHostedMailboxLagSweeper(input: {
  counterLimit?: number;
  logger?: HostedMailboxLagSweeperLogger;
  nudgeLimit?: number;
  prisma?: HostedMailboxLagSweeperPrisma;
} = {}): Promise<HostedMailboxLagSweeperResult> {
  const prisma = input.prisma ?? getPrisma();
  const logger = input.logger ?? console;
  const counterLimit = normalizeLimit(input.counterLimit, DEFAULT_COUNTER_LIMIT, MAX_COUNTER_LIMIT);
  const nudgeLimit = normalizeLimit(input.nudgeLimit, DEFAULT_NUDGE_LIMIT, MAX_NUDGE_LIMIT);
  const counters = await prisma.hostedMailboxLaneCounter.findMany({
    orderBy: [
      {
        updatedAt: "desc",
      },
      {
        userId: "asc",
      },
      {
        lane: "asc",
      },
    ],
    select: {
      lane: true,
      member: {
        select: {
          hostedWorkspace: {
            select: {
              checkpointedAt: true,
              redactedStatusJson: true,
            },
          },
        },
      },
      nextSeq: true,
      updatedAt: true,
      userId: true,
    },
    take: counterLimit,
    where: {
      nextSeq: {
        gt: 1n,
      },
    },
  });

  const laggedByUser = new Map<string, {
    checkpointedAt: Date | null;
    lanes: HostedMailboxLaneLag[];
    latestCounterUpdatedAt: Date;
  }>();
  let currentCounters = 0;
  let invalidLaneCounters = 0;
  let laggedCounters = 0;

  for (const counter of counters) {
    if (!isHostedMailboxLane(counter.lane)) {
      invalidLaneCounters += 1;
      logger.warn("Hosted mailbox lag sweeper skipped mailbox counter with invalid lane.", {
        lane: counter.lane,
        userId: counter.userId,
      });
      continue;
    }

    const maxSeq = counter.nextSeq > 0n ? counter.nextSeq - 1n : 0n;
    const lag = computeHostedMailboxLaneLag({
      highWater: {
        lane: counter.lane,
        maxSeq: maxSeq.toString(),
      },
      redactedStatusJson: counter.member.hostedWorkspace?.redactedStatusJson ?? null,
    });

    if (lag.lag === "0") {
      currentCounters += 1;
      continue;
    }

    laggedCounters += 1;
    const existing = laggedByUser.get(counter.userId);
    if (existing) {
      existing.lanes.push(lag);
      if (counter.updatedAt > existing.latestCounterUpdatedAt) {
        existing.latestCounterUpdatedAt = counter.updatedAt;
      }
      continue;
    }

    laggedByUser.set(counter.userId, {
      checkpointedAt: counter.member.hostedWorkspace?.checkpointedAt ?? null,
      lanes: [lag],
      latestCounterUpdatedAt: counter.updatedAt,
    });
  }

  logger.info("Hosted mailbox lag sweeper scanned mailbox counters.", {
    candidateCounters: counters.length,
    currentCounters,
    invalidLaneCounters,
    laggedCounters,
    laggedUsers: laggedByUser.size,
    nudgeLimit,
  });

  let nudgeAccepted = 0;
  let nudgeAttempted = 0;
  let nudgeNotAccepted = 0;
  const laggedUsers = Array.from(laggedByUser.entries()).slice(0, nudgeLimit);

  for (const [userId, lagged] of laggedUsers) {
    nudgeAttempted += 1;
    logger.warn("Hosted mailbox lag sweeper nudging runner for mailbox lag.", {
      checkpointedAt: lagged.checkpointedAt?.toISOString() ?? null,
      lanes: lagged.lanes,
      latestCounterUpdatedAt: lagged.latestCounterUpdatedAt.toISOString(),
      userId,
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
        inFlight: nudge.inFlight,
        nextAlarmAtPresent: nudge.nextAlarmAtPresent,
        userId,
      });
      continue;
    }

    nudgeNotAccepted += 1;
    logger.warn("Hosted mailbox lag sweeper runner nudge was not accepted.", {
      configured: nudge.configured,
      errorCode: nudge.errorCode,
      userId,
    });
  }

  const skippedLaggedUsers = Math.max(0, laggedByUser.size - laggedUsers.length);
  if (skippedLaggedUsers > 0) {
    logger.warn("Hosted mailbox lag sweeper skipped lagged users after nudge limit.", {
      nudgeLimit,
      skippedLaggedUsers,
    });
  }

  return {
    candidateCounters: counters.length,
    currentCounters,
    invalidLaneCounters,
    laggedCounters,
    laggedUsers: laggedByUser.size,
    nudgeAccepted,
    nudgeAttempted,
    nudgeLimit,
    nudgeNotAccepted,
    skippedLaggedUsers,
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
