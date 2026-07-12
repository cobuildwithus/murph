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

interface CallCircleProviderStartGroupAuthority {
  ownerMemberId: string;
  runtimeMemberId: string;
}

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

  const providerStartGroupAuthority = await readCallCircleProviderStartGroupAuthority({
    groupId: match.groupId,
    prisma,
  });
  if (!providerStartGroupAuthority) {
    const handedOff = await markCallCircleConnectorHandoff({
      match,
      now,
      outcome: "connector_start_failed",
      prisma,
    });
    return { status: handedOff ? "handoff" : "ignored" };
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
  let providerStartMemberBPhone: string | null = null;

  try {
    const phoneCall = await createHostedPhoneCall({
      brief: buildCallCircleConnectorBrief({
        memberAPhone,
        timeZone: timeZones.memberATimeZone,
      }),
      beforeStart: async ({ phoneCallId, prisma: transactionPrisma }) => {
        providerStartMemberBPhone = null;
        const currentGroupAuthority = await readCallCircleProviderStartGroupAuthority({
          groupId: match.groupId,
          prisma: transactionPrisma,
        });
        if (
          !currentGroupAuthority
          || currentGroupAuthority.ownerMemberId !== providerStartGroupAuthority.ownerMemberId
          || currentGroupAuthority.runtimeMemberId !== providerStartGroupAuthority.runtimeMemberId
        ) {
          return false;
        }
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
        const [currentMemberAPhone, currentMemberBPhone] = await Promise.all([
          resolveVerifiedMemberTransferNumber({
            memberId: match.memberAId,
            prisma: transactionPrisma,
          }),
          resolveVerifiedMemberTransferNumber({
            memberId: match.memberBId,
            prisma: transactionPrisma,
          }),
        ]);
        if (currentMemberAPhone !== memberAPhone || !currentMemberBPhone) {
          return false;
        }
        if (isRecoverableAttachedBridge) {
          const canStart = await canStartAttachedCallCircleBridge({
            groupId: match.groupId,
            matchId: match.id,
            memberAId: match.memberAId,
            memberBId: match.memberBId,
            now,
            phoneCallId,
            prisma: transactionPrisma,
          });
          if (canStart) providerStartMemberBPhone = currentMemberBPhone;
          return canStart;
        }
        const attached = await attachCallCirclePhoneCall({
          matchId: match.id,
          phoneCallId,
          prisma: transactionPrisma,
        });
        if (attached) providerStartMemberBPhone = currentMemberBPhone;
        return attached;
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
      providerStartMemberIds: [
        match.memberAId,
        match.memberBId,
        providerStartGroupAuthority.ownerMemberId,
        providerStartGroupAuthority.runtimeMemberId,
      ],
      requestKey: buildCallCircleConnectorRequestKey(match.id),
      resultNotificationRouteResolver: async () => undefined,
      runtimeOptions: {
        openingLine:
          "This is Murph. Connecting you with a friend from your group, one moment.",
        retellAgentId: connectorConfig.agentId,
        retellAgentVersion: connectorConfig.agentVersion,
      },
      transferNumberResolver: async () => providerStartMemberBPhone,
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

async function readCallCircleProviderStartGroupAuthority(input: {
  groupId: string;
  prisma: CallCirclePrismaClient;
}): Promise<CallCircleProviderStartGroupAuthority | null> {
  const group = await input.prisma.hostedGroup.findUnique({
    select: {
      owner: { select: { suspendedAt: true } },
      ownerMemberId: true,
      runtimeMember: { select: { suspendedAt: true } },
      runtimeMemberId: true,
    },
    where: { id: input.groupId },
  });
  if (
    !group?.runtimeMemberId
    || group.owner.suspendedAt
    || group.runtimeMember?.suspendedAt
  ) {
    return null;
  }
  return {
    ownerMemberId: group.ownerMemberId,
    runtimeMemberId: group.runtimeMemberId,
  };
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
