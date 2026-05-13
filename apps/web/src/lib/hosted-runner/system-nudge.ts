import type { PrismaClient } from "@prisma/client";

import {
  computeHostedMailboxLaneLag,
} from "../hosted-mailbox/lag";
import { getPrisma } from "../prisma";
import {
  nudgeHostedAssistantRunnerUserBestEffortResult,
} from "./assistant-nudge";
import {
  nudgeHostedRunnerUserBestEffortResult,
  type HostedRunnerUserNudgeBestEffortResult,
} from "./control";

type HostedSystemRunnerNudgePrisma = Pick<PrismaClient, "hostedMailboxItem" | "hostedWorkspace">;

export interface HostedSystemRunnerUserNudgeBestEffortResult
  extends HostedRunnerUserNudgeBestEffortResult {
  conversationLagPresent: boolean;
  usageGateDenied?: boolean;
}

export async function nudgeHostedSystemRunnerUserBestEffortResult(input: {
  context?: string;
  prisma?: HostedSystemRunnerNudgePrisma;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedSystemRunnerUserNudgeBestEffortResult> {
  let conversationLagPresent: boolean;
  try {
    conversationLagPresent = await hasHostedConversationMailboxLag({
      prisma: input.prisma,
      userId: input.userId,
    });
  } catch (error) {
    console.warn("Hosted system runner nudge conversation lag check failed.", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return {
      accepted: false,
      alarmScheduled: null,
      alreadyRunning: null,
      configured: true,
      conversationLagPresent: true,
      errorCode: "CONVERSATION_LAG_CHECK_FAILED",
      immediateDriveStarted: null,
      inFlight: null,
      nextAlarmAtPresent: null,
    };
  }

  const nudge = conversationLagPresent
    ? await nudgeHostedAssistantRunnerUserBestEffortResult({
        context: input.context,
        timeoutMs: input.timeoutMs,
        userId: input.userId,
      })
    : await nudgeHostedRunnerUserBestEffortResult({
        context: input.context,
        timeoutMs: input.timeoutMs,
        userId: input.userId,
      });

  return {
    ...nudge,
    conversationLagPresent,
  };
}

async function hasHostedConversationMailboxLag(input: {
  prisma?: HostedSystemRunnerNudgePrisma;
  userId: string;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const [highWater, workspace] = await Promise.all([
    prisma.hostedMailboxItem.findFirst({
      orderBy: {
        laneSeq: "desc",
      },
      select: {
        laneSeq: true,
      },
      where: {
        lane: "conversation",
        userId: input.userId,
      },
    }),
    prisma.hostedWorkspace.findUnique({
      select: {
        redactedStatusJson: true,
      },
      where: {
        userId: input.userId,
      },
    }),
  ]);

  if (!highWater) {
    return false;
  }

  const lag = computeHostedMailboxLaneLag({
    highWater: {
      lane: "conversation",
      maxSeq: highWater.laneSeq.toString(),
    },
    redactedStatusJson: workspace?.redactedStatusJson ?? null,
  });

  return lag.lag !== "0";
}
