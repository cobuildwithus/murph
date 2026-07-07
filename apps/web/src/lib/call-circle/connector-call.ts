import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { HostedPhoneCallBrief } from "@murphai/hosted-execution/phone-calls";

import {
  attachCallCirclePhoneCall,
  claimCallCircleMatchForConnector,
  markCallCircleMatchOutcome,
} from "./match-store";
import {
  appendCallCircleHandoffNotificationTx,
  type CallCircleNotificationSignal,
  readCallCircleNotificationSignal,
  readCallCircleNotificationPreflightTx,
  signalCallCircleNotificationRuntimesBestEffort,
} from "./notifications";
import {
  normalizeCallCircleTimeZone,
} from "./time";
import {
  canUseActiveCallCircleParticipantPair,
} from "./participant-store";
import {
  createHostedPhoneCall,
} from "../phone-calls/service";
import {
  resolveVerifiedMemberTransferNumber,
} from "../phone-calls/transfer";
import { getPrisma } from "../prisma";

export type CallCircleConnectorStartStatus =
  | "calling"
  | "handoff"
  | "ignored";

export type CallCircleConnectorStarter = (input: {
  matchId: string;
  now: Date;
  prisma: PrismaClient;
}) => Promise<{ phoneCallId?: string; status: CallCircleConnectorStartStatus }>;

const CALL_CIRCLE_CONNECTOR_REQUEST_KEY_PREFIX = "call-circle:";
const RETELL_CONNECTOR_AGENT_ID_ENV = "RETELL_CONNECTOR_AGENT_ID";
const RETELL_CONNECTOR_AGENT_VERSION_ENV = "RETELL_CONNECTOR_AGENT_VERSION";

export async function startCallCircleConnectorCall(input: {
  matchId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<{ phoneCallId?: string; status: CallCircleConnectorStartStatus }> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const match = await prisma.hostedCallCircleMatch.findUnique({
    include: {
      memberA: { select: { pendingActivationTimeZone: true } },
      memberB: { select: { pendingActivationTimeZone: true } },
      phoneCall: {
        select: { analyzedAt: true, providerCallId: true, status: true },
      },
    },
    where: { id: input.matchId },
  });
  if (!match) {
    return { status: "ignored" };
  }
  const isRecoverableClaimedBridge =
    match.status === "bridging" && match.phoneCallId === null;
  const isRecoverableAttachedBridge =
    match.status === "bridging"
    && match.phoneCallId !== null
    && isUnstartedAttachedCallCirclePhoneCall(match.phoneCall);
  if (
    match.status !== "both_confirmed"
    && !isRecoverableClaimedBridge
    && !isRecoverableAttachedBridge
  ) {
    return { status: "ignored" };
  }
  if (
    match.finalAskedAt === null
    || now < match.windowStartAt
    || now >= match.windowEndAt
  ) {
    return { status: "ignored" };
  }

  if (!await canUseActiveCallCircleParticipantPair({
    groupId: match.groupId,
    memberAId: match.memberAId,
    memberBId: match.memberBId,
    prisma,
  })) {
    await markCallCircleMatchOutcome({
      matchId: match.id,
      now,
      outcome: "participant_unavailable",
      prisma,
      status: "canceled",
    });
    return { status: "ignored" };
  }

  const connectorConfig = readCallCircleConnectorConfig();
  if (!connectorConfig) {
    const handedOff = await markCallCircleConnectorHandoff({
      match,
      now,
      outcome: "connector_agent_unconfigured",
      prisma,
    });
    return { status: handedOff ? "handoff" : "ignored" };
  }

  const claimed = isRecoverableClaimedBridge
    || isRecoverableAttachedBridge
    || (await claimCallCircleMatchForConnector({
      groupId: match.groupId,
      matchId: match.id,
      memberAId: match.memberAId,
      memberBId: match.memberBId,
      now,
      prisma,
    }));
  if (!claimed) {
    if (!await canUseActiveCallCircleParticipantPair({
      groupId: match.groupId,
      memberAId: match.memberAId,
      memberBId: match.memberBId,
      prisma,
    })) {
      await markCallCircleMatchOutcome({
        matchId: match.id,
        now,
        outcome: "participant_unavailable",
        prisma,
        status: "canceled",
      });
    }
    return { status: "ignored" };
  }

  if (!await canUseActiveCallCircleParticipantPair({
    groupId: match.groupId,
    memberAId: match.memberAId,
    memberBId: match.memberBId,
    prisma,
  })) {
    await markCallCircleMatchOutcome({
      matchId: match.id,
      now,
      outcome: "participant_unavailable",
      prisma,
      status: "canceled",
    });
    return { status: "ignored" };
  }

  const [memberAPhone, memberBPhone] = await Promise.all([
    resolveVerifiedMemberTransferNumber({ memberId: match.memberAId }),
    resolveVerifiedMemberTransferNumber({ memberId: match.memberBId }),
  ]);
  if (!memberAPhone || !memberBPhone) {
    const handedOff = await markCallCircleConnectorHandoff({
      match,
      now,
      outcome: "verified_phone_missing",
      prisma,
    });
    return { status: handedOff ? "handoff" : "ignored" };
  }

  try {
    const phoneCall = await createHostedPhoneCall({
      brief: buildCallCircleConnectorBrief({
        memberAPhone,
        matchId: match.id,
        timeZone: normalizeCallCircleTimeZone(match.memberA.pendingActivationTimeZone),
      }),
      beforeStart: async ({ phoneCallId }) => {
        if (!await canUseActiveCallCircleParticipantPair({
          groupId: match.groupId,
          memberAId: match.memberAId,
          memberBId: match.memberBId,
          prisma,
        })) {
          return false;
        }
        if (isRecoverableAttachedBridge) {
          return await canStartAttachedCallCircleBridge({
            groupId: match.groupId,
            matchId: match.id,
            memberAId: match.memberAId,
            memberBId: match.memberBId,
            now,
            phoneCallId,
            prisma,
          });
        }
        return await attachCallCirclePhoneCall({
          matchId: match.id,
          phoneCallId,
          prisma,
        });
      },
      memberId: match.memberAId,
      requestKey: buildCallCircleConnectorRequestKey(match.id),
      resultNotificationRouteResolver: async () => undefined,
      runtimeOptions: {
        openingLine:
          "This is Murph. Connecting you with a friend from your group, one moment.",
        retellAgentId: connectorConfig.agentId,
        retellAgentVersion: connectorConfig.agentVersion,
      },
      transferNumberResolver: async () => memberBPhone,
    });
    if (phoneCall.status !== "calling") {
      if (phoneCall.status === "starting") {
        return { phoneCallId: phoneCall.phoneCallId, status: "ignored" };
      }
      const handedOff = await markCallCircleConnectorHandoff({
        match,
        now,
        outcome: "connector_start_failed",
        prisma,
      });
      return { phoneCallId: phoneCall.phoneCallId, status: handedOff ? "handoff" : "ignored" };
    }
    return { phoneCallId: phoneCall.phoneCallId, status: "calling" };
  } catch {
    const handedOff = await markCallCircleConnectorHandoff({
      match,
      now,
      outcome: "connector_start_failed",
      prisma,
    });
    return { status: handedOff ? "handoff" : "ignored" };
  }
}

async function canStartAttachedCallCircleBridge(input: {
  groupId: string;
  matchId: string;
  memberAId: string;
  memberBId: string;
  now: Date;
  phoneCallId: string;
  prisma: PrismaClient;
}): Promise<boolean> {
  const count = await input.prisma.hostedCallCircleMatch.count({
    where: {
      finalAskedAt: { not: null },
      groupId: input.groupId,
      id: input.matchId,
      memberAId: input.memberAId,
      memberBId: input.memberBId,
      phoneCallId: input.phoneCallId,
      status: "bridging",
      windowEndAt: { gt: input.now },
      windowStartAt: { lte: input.now },
    },
  });
  return count === 1;
}

function isUnstartedAttachedCallCirclePhoneCall(
  phoneCall: {
    analyzedAt: Date | null;
    providerCallId: string | null;
    status: string;
  } | null,
): boolean {
  return phoneCall !== null
    && phoneCall.analyzedAt === null
    && phoneCall.providerCallId === null
    && phoneCall.status === "starting";
}

export function buildCallCircleConnectorRequestKey(matchId: string): string {
  return `${CALL_CIRCLE_CONNECTOR_REQUEST_KEY_PREFIX}${matchId}`;
}

export function readCallCircleMatchIdFromPhoneCallRequestKey(
  requestKey: string,
): string | null {
  return requestKey.startsWith(CALL_CIRCLE_CONNECTOR_REQUEST_KEY_PREFIX)
    ? requestKey.slice(CALL_CIRCLE_CONNECTOR_REQUEST_KEY_PREFIX.length)
    : null;
}

function buildCallCircleConnectorBrief(input: {
  matchId: string;
  memberAPhone: string;
  timeZone: string;
}): HostedPhoneCallBrief {
  return {
    allowTransferToUser: true,
    goal: "Connect two group members for a short Call Circle call.",
    instructions: [
      "Say: This is Murph. Connecting you with a friend from your group, one moment.",
      "Transfer the call immediately after the opening line.",
      "Do not ask for another confirmation; web already recorded both final confirmations before this connector call started.",
    ],
    shareableFacts: {
      call_circle_match_id: input.matchId,
    },
    successCriteria: "The call transfers to the matched group member.",
    timeZone: input.timeZone,
    to: {
      label: "Call Circle member",
      phoneNumber: input.memberAPhone,
    },
  };
}

async function markCallCircleConnectorHandoff(input: {
  match: {
    groupId: string;
    id: string;
    memberAId: string;
    memberBId: string;
  };
  now: Date;
  outcome: string;
  prisma: PrismaClient;
}): Promise<boolean> {
  const transaction = await input.prisma.$transaction(async (tx): Promise<{
    handedOff: boolean;
    signals: CallCircleNotificationSignal[];
  }> => {
    if (!await canUseActiveCallCircleParticipantPair({
      groupId: input.match.groupId,
      memberAId: input.match.memberAId,
      memberBId: input.match.memberBId,
      prisma: tx,
    })) {
      await markCallCircleMatchOutcome({
        matchId: input.match.id,
        now: input.now,
        outcome: "participant_unavailable",
        prisma: tx,
        status: "canceled",
      });
      return { handedOff: false, signals: [] };
    }
    const marked = await markCallCircleMatchOutcome({
      matchId: input.match.id,
      now: input.now,
      outcome: input.outcome,
      prisma: tx,
      status: "dropped",
    });
    if (!marked) return { handedOff: false, signals: [] };
    const notifications = await Promise.all([
      appendConnectorHandoffNotificationIfReachableTx({
        matchId: input.match.id,
        memberId: input.match.memberAId,
        now: input.now,
        tx,
      }),
      appendConnectorHandoffNotificationIfReachableTx({
        matchId: input.match.id,
        memberId: input.match.memberBId,
        now: input.now,
        tx,
      }),
    ]);
    return {
      handedOff: true,
      signals: notifications.flatMap((notification, index) => {
        const memberId = index === 0
          ? input.match.memberAId
          : input.match.memberBId;
        const signal = notification
          ? readCallCircleNotificationSignal({ memberId, notification })
          : null;
        return signal ? [signal] : [];
      }),
    };
  });
  await signalCallCircleNotificationRuntimesBestEffort(transaction.signals);
  return transaction.handedOff;
}

async function appendConnectorHandoffNotificationIfReachableTx(input: {
  matchId: string;
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}) {
  const preflight = await readCallCircleNotificationPreflightTx({
    memberId: input.memberId,
    now: input.now,
    tx: input.tx,
  });
  if (preflight.status !== "ok") return null;
  return await appendCallCircleHandoffNotificationTx({
    matchId: input.matchId,
    memberId: input.memberId,
    now: input.now,
    preflight,
    tx: input.tx,
  });
}

function readCallCircleConnectorConfig(): {
  agentId: string;
  agentVersion: string | null;
} | null {
  const agentId = process.env[RETELL_CONNECTOR_AGENT_ID_ENV]?.trim();
  if (!agentId) {
    return null;
  }
  return {
    agentId,
    agentVersion: process.env[RETELL_CONNECTOR_AGENT_VERSION_ENV]?.trim() || null,
  };
}
