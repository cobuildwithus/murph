import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { HostedPhoneCallBrief } from "@murphai/hosted-execution/phone-calls";

import {
  attachCallCirclePhoneCall,
  claimCallCircleMatchForConnector,
  markCallCircleMatchOutcome,
} from "./match-store";
import {
  appendCallCircleTerminalNotificationsTx,
} from "./notifications";
import {
  signalHostedAssistantNotificationsBestEffort,
  type HostedAssistantNotificationSignal,
} from "../hosted-execution/assistant-notifications";
import {
  activeCallCircleParticipantPairMatchWhere,
  canUseActiveCallCircleParticipantPair,
  readCallCircleMatchParticipantTimeZones,
} from "./participant-store";
import {
  CALL_CIRCLE_PHONE_CALL_REQUEST_KEY_PREFIX,
  isPreProviderFailedCallCircleBridgePhoneCall,
  isUnstartedCallCircleBridgePhoneCall,
} from "./phone-call-state";
import type {
  CallCircleMatchOutcome,
  CallCirclePrismaClient,
} from "./types";
import {
  hasCallCircleBridgeWindowElapsed,
  isWithinCallCircleDaytime,
  isWithinCallCircleBridgeWindow,
  readCallCircleBridgeWindowStartCutoff,
} from "./time";
import {
  createHostedPhoneCall,
  terminalizeUnstartedHostedPhoneCall,
} from "../phone-calls/service";
import {
  resolveVerifiedMemberTransferNumber,
} from "../phone-calls/transfer";
import { getPrisma } from "../prisma";

type CallCircleConnectorStartStatus =
  | "calling"
  | "handoff"
  | "ignored";

export type CallCircleConnectorStarter = (input: {
  matchId: string;
  now: Date;
  prisma: PrismaClient;
}) => Promise<{ phoneCallId?: string; status: CallCircleConnectorStartStatus }>;

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
      phoneCall: {
        select: {
          analyzedAt: true,
          endedAt: true,
          providerCallId: true,
          providerStartAttemptedAt: true,
          status: true,
        },
      },
    },
    where: { id: input.matchId },
  });
  if (!match) {
    return { status: "ignored" };
  }
  const isRecoverableClaimedBridge =
    match.status === "bridging" && match.phoneCallId === null;
  const isRecoverableFailedBridge =
    match.status === "bridging"
    && match.phoneCallId !== null
    && isPreProviderFailedCallCircleBridgePhoneCall(match.phoneCall);
  const isRecoverableAttachedBridge =
    match.status === "bridging"
    && match.phoneCallId !== null
    && isUnstartedCallCircleBridgePhoneCall(match.phoneCall);
  if (
    match.status !== "both_confirmed"
    && !isRecoverableClaimedBridge
    && !isRecoverableFailedBridge
    && !isRecoverableAttachedBridge
  ) {
    return { status: "ignored" };
  }
  if (match.finalAskedAt === null) {
    return { status: "ignored" };
  }
  if (isRecoverableFailedBridge) {
    const handedOff = await markCallCircleConnectorHandoff({
      match,
      now,
      outcome: "connector_start_failed",
      prisma,
    });
    return {
      ...(match.phoneCallId ? { phoneCallId: match.phoneCallId } : {}),
      status: handedOff ? "handoff" : "ignored",
    };
  }
  if (!isWithinCallCircleBridgeWindow({
    now,
    windowEndAt: match.windowEndAt,
    windowStartAt: match.windowStartAt,
  })) {
    if (!hasCallCircleBridgeWindowElapsed({
      now,
      windowEndAt: match.windowEndAt,
      windowStartAt: match.windowStartAt,
    })) {
      return { status: "ignored" };
    }
    const handedOff = await markCallCircleConnectorHandoff({
      match,
      now,
      outcome: "text_handoff",
      prisma,
    });
    return { status: handedOff ? "handoff" : "ignored" };
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
  const timeZones = await readCallCircleMatchParticipantTimeZones({
    groupId: match.groupId,
    memberAId: match.memberAId,
    memberBId: match.memberBId,
    prisma,
  });
  if (!timeZones) {
    return { status: "ignored" };
  }
  let providerStartTimeZones: typeof timeZones | null = null;

  try {
    const phoneCall = await createHostedPhoneCall({
      brief: buildCallCircleConnectorBrief({
        memberAPhone,
        timeZone: timeZones.memberATimeZone,
      }),
      beforeStart: async ({ phoneCallId, prisma: transactionPrisma }) => {
        if (!await canUseActiveCallCircleParticipantPair({
          groupId: match.groupId,
          memberAId: match.memberAId,
          memberBId: match.memberBId,
          prisma: transactionPrisma,
        })) {
          return false;
        }
        providerStartTimeZones = await readCallCircleMatchParticipantTimeZones({
          groupId: match.groupId,
          memberAId: match.memberAId,
          memberBId: match.memberBId,
          prisma: transactionPrisma,
        });
        if (!providerStartTimeZones) return false;
        if (isRecoverableAttachedBridge) {
          return await canStartAttachedCallCircleBridge({
            groupId: match.groupId,
            matchId: match.id,
            memberAId: match.memberAId,
            memberBId: match.memberBId,
            now,
            phoneCallId,
            prisma: transactionPrisma,
          });
        }
        return await attachCallCirclePhoneCall({
          matchId: match.id,
          phoneCallId,
          prisma: transactionPrisma,
        });
      },
      memberId: match.memberAId,
      providerStartGuardWhere: (attemptedAt) => {
        if (!providerStartTimeZones) return null;
        if (
          !isWithinCallCircleDaytime({
            now: attemptedAt,
            timeZone: providerStartTimeZones.memberATimeZone,
          })
          || !isWithinCallCircleDaytime({
            now: attemptedAt,
            timeZone: providerStartTimeZones.memberBTimeZone,
          })
        ) {
          return null;
        }
        return buildCallCircleProviderStartGuardWhere({
          groupId: match.groupId,
          matchId: match.id,
          memberAId: match.memberAId,
          memberBId: match.memberBId,
          now: attemptedAt,
        });
      },
      providerStartMemberIds: [match.memberAId, match.memberBId],
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
        await prisma.$transaction(async (tx) => {
          if (await canUseActiveCallCircleParticipantPair({
            groupId: match.groupId,
            memberAId: match.memberAId,
            memberBId: match.memberBId,
            prisma: tx,
          })) return;
          if (!await terminalizeUnstartedHostedPhoneCall({
            phoneCallId: phoneCall.phoneCallId,
            prisma: tx,
          })) return;
          await markCallCircleMatchOutcome({
            matchId: match.id,
            outcome: "participant_unavailable",
            phoneCallId: phoneCall.phoneCallId,
            prisma: tx,
            status: "canceled",
          });
        });
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

function buildCallCircleProviderStartGuardWhere(input: {
  groupId: string;
  matchId: string;
  memberAId: string;
  memberBId: string;
  now: Date;
}): Prisma.HostedPhoneCallWhereInput {
  return {
    callCircleMatch: {
      is: {
        ...activeCallCircleParticipantPairMatchWhere({
          groupId: input.groupId,
          memberAId: input.memberAId,
          memberBId: input.memberBId,
        }),
        finalAskedAt: { not: null },
        id: input.matchId,
        status: "bridging",
        windowEndAt: { gt: input.now },
        windowStartAt: {
          gt: readCallCircleBridgeWindowStartCutoff(input.now),
          lte: input.now,
        },
      },
    },
  };
}

async function canStartAttachedCallCircleBridge(input: {
  groupId: string;
  matchId: string;
  memberAId: string;
  memberBId: string;
  now: Date;
  phoneCallId: string;
  prisma: CallCirclePrismaClient;
}): Promise<boolean> {
  const count = await input.prisma.hostedCallCircleMatch.count({
    where: {
      ...activeCallCircleParticipantPairMatchWhere({
        groupId: input.groupId,
        memberAId: input.memberAId,
        memberBId: input.memberBId,
      }),
      finalAskedAt: { not: null },
      id: input.matchId,
      phoneCallId: input.phoneCallId,
      status: "bridging",
      windowEndAt: { gt: input.now },
      windowStartAt: {
        gt: readCallCircleBridgeWindowStartCutoff(input.now),
        lte: input.now,
      },
    },
  });
  return count === 1;
}

function buildCallCircleConnectorRequestKey(matchId: string): string {
  return `${CALL_CIRCLE_PHONE_CALL_REQUEST_KEY_PREFIX}${matchId}`;
}

function buildCallCircleConnectorBrief(input: {
  memberAPhone: string;
  timeZone: string;
}): HostedPhoneCallBrief {
  return {
    allowTransferToUser: true,
    goal: "Connect two group members for a short Call Circle call.",
    instructions: [
      "Transfer the call immediately after the opening line.",
      "Do not ask for another confirmation; web already recorded both final confirmations before this connector call started.",
      "Use only the server-supplied transfer target. Never say, spell, or repeat its phone number.",
    ],
    shareableFacts: {},
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
  outcome: CallCircleMatchOutcome;
  prisma: PrismaClient;
}): Promise<boolean> {
  const transaction = await input.prisma.$transaction(async (tx): Promise<{
    handedOff: boolean;
    signals: HostedAssistantNotificationSignal[];
  }> => {
    const current = await tx.hostedCallCircleMatch.findUnique({
      select: {
        phoneCall: {
          select: {
            analyzedAt: true,
            endedAt: true,
            providerCallId: true,
            providerStartAttemptedAt: true,
            status: true,
          },
        },
        phoneCallId: true,
        status: true,
      },
      where: { id: input.match.id },
    });
    const expectedPhoneCallId = current?.phoneCallId ?? null;
    const unstartedPhoneCall = isUnstartedCallCircleBridgePhoneCall(
      current?.phoneCall ?? null,
    );
    if (
      !current
      || (
        current.phoneCallId !== null
        && !isPreProviderFailedCallCircleBridgePhoneCall(current.phoneCall)
        && !unstartedPhoneCall
      )
      || !["both_confirmed", "bridging"].includes(current.status)
    ) {
      return { handedOff: false, signals: [] };
    }
    if (
      unstartedPhoneCall
      && current.phoneCallId
      && !await terminalizeUnstartedHostedPhoneCall({
        phoneCallId: current.phoneCallId,
        prisma: tx,
      })
    ) {
      return { handedOff: false, signals: [] };
    }
    if (!await canUseActiveCallCircleParticipantPair({
      groupId: input.match.groupId,
      memberAId: input.match.memberAId,
      memberBId: input.match.memberBId,
      prisma: tx,
    })) {
      await markCallCircleMatchOutcome({
        matchId: input.match.id,
        outcome: "participant_unavailable",
        phoneCallId: expectedPhoneCallId,
        prisma: tx,
        status: "canceled",
      });
      return { handedOff: false, signals: [] };
    }
    const marked = await markCallCircleMatchOutcome({
      matchId: input.match.id,
      outcome: input.outcome,
      phoneCallId: expectedPhoneCallId,
      prisma: tx,
      status: "dropped",
    });
    if (!marked) return { handedOff: false, signals: [] };
    return {
      handedOff: true,
      signals: await appendCallCircleTerminalNotificationsTx({
        groupId: input.match.groupId,
        kind: "handoff",
        matchId: input.match.id,
        memberAId: input.match.memberAId,
        memberBId: input.match.memberBId,
        now: input.now,
        tx,
      }),
    };
  });
  await signalHostedAssistantNotificationsBestEffort(transaction.signals);
  return transaction.handedOff;
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
