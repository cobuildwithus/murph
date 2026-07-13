import "server-only";

import {
  Prisma,
  type HostedCallCircleMatchResponse,
  type PrismaClient,
} from "@prisma/client";

import {
  generateHostedCallCircleMatchId,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import {
  activeCallCircleParticipantPairMatchWhere,
  readActiveCallCircleParticipantPair,
} from "./participant-store";
import { proposeCallCircleParticipantPair } from "./matcher";
import {
  CALL_CIRCLE_FINAL_ASK_LEAD_MS,
  CALL_CIRCLE_MAX_MATCH_LOOKBACK_MS,
  readCallCircleBridgeWindowStartCutoff,
} from "./time";
import { supersedeCallCircleNotificationsTx } from "./notifications";
import type {
  CallCircleMatchOutcome,
  CallCircleMatchRow,
  CallCirclePrismaClient,
  CallCircleSide,
} from "./types";

interface CallCircleMatchProposalInput {
  groupId: string;
  memberAId: string;
  memberBId: string;
  now: Date;
  windowEndAt: Date;
  windowStartAt: Date;
}

const AFFIRMATIVE_MATCH_RESPONSES: HostedCallCircleMatchResponse[] = [
  "confirmed",
  "countered",
];
const CALL_CIRCLE_OPEN_MATCH_STATUSES = new Set([
  "proposed",
  "asking",
  "both_confirmed",
  "bridging",
]);
const CALL_CIRCLE_BLOCKING_RECENT_MATCH_WHERE = {
  NOT: [
    {
      amAskedAt: null,
      finalAskedAt: null,
      status: "canceled",
    },
    {
      outcome: "notification_blocked",
      status: "dropped",
    },
  ],
} satisfies Prisma.HostedCallCircleMatchWhereInput;

export async function createCallCircleMatchProposal(input: {
  proposal: CallCircleMatchProposalInput;
  prisma?: CallCirclePrismaClient;
}): Promise<CallCircleMatchRow | null> {
  const prisma = input.prisma ?? getPrisma();
  const run = (tx: Prisma.TransactionClient) =>
    createCallCircleMatchProposalTx({
      proposal: input.proposal,
      prisma: tx,
    });
  try {
    return hasPrismaTransaction(prisma)
      ? await prisma.$transaction((tx) => run(tx))
      : await run(prisma);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return null;
    }
    throw error;
  }
}

async function createCallCircleMatchProposalTx(input: {
  proposal: CallCircleMatchProposalInput;
  prisma: Prisma.TransactionClient;
}): Promise<CallCircleMatchRow | null> {
  const prisma = input.prisma;
  const [memberAId, memberBId] = sortPair(
    input.proposal.memberAId,
    input.proposal.memberBId,
  );
  for (const memberId of [memberAId, memberBId]) {
    await lockHostedMemberRow(prisma, memberId);
  }
  const participants = await readActiveCallCircleParticipantPair({
    groupId: input.proposal.groupId,
    memberAId,
    memberBId,
    prisma,
  });
  if (!participants) return null;
  const recentMatches = await listRecentCallCircleMatches({
    memberIds: [memberAId, memberBId],
    now: input.proposal.now,
    prisma,
  });
  const currentProposal = proposeCallCircleParticipantPair({
    first: participants.memberA,
    now: input.proposal.now,
    recentMatches,
    second: participants.memberB,
  });
  if (
    !currentProposal
    || currentProposal.windowStartAt.getTime() !== input.proposal.windowStartAt.getTime()
    || currentProposal.windowEndAt.getTime() !== input.proposal.windowEndAt.getTime()
  ) {
    return null;
  }

  return prisma.hostedCallCircleMatch.create({
    data: {
      createdAt: input.proposal.now,
      groupId: input.proposal.groupId,
      id: generateHostedCallCircleMatchId(),
      memberAId,
      memberBId,
      status: "proposed",
      updatedAt: input.proposal.now,
      windowEndAt: input.proposal.windowEndAt,
      windowStartAt: input.proposal.windowStartAt,
    },
  });
}

function recentBlockingCallCircleMatchWhere(
  now: Date,
): Prisma.HostedCallCircleMatchWhereInput {
  return {
    OR: [
      {
        status: {
          in: ["proposed", "asking", "both_confirmed", "bridging"],
        },
      },
      {
        createdAt: {
          gte: new Date(now.getTime() - CALL_CIRCLE_MAX_MATCH_LOOKBACK_MS),
        },
        ...CALL_CIRCLE_BLOCKING_RECENT_MATCH_WHERE,
      },
    ],
  };
}

function hasPrismaTransaction(
  prisma: CallCirclePrismaClient,
): prisma is PrismaClient {
  return "$transaction" in prisma && typeof prisma.$transaction === "function";
}

export async function listRecentCallCircleMatches(input: {
  memberIds: readonly string[];
  now: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<Array<{
  createdAt: Date;
  memberAId: string;
  memberBId: string;
  open: boolean;
}>> {
  const prisma = input.prisma ?? getPrisma();
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) return [];
  const matches = await prisma.hostedCallCircleMatch.findMany({
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take: 200,
    select: {
      createdAt: true,
      memberAId: true,
      memberBId: true,
      status: true,
    },
    where: {
      AND: [
        recentBlockingCallCircleMatchWhere(input.now),
        {
          OR: [
            { memberAId: { in: memberIds } },
            { memberBId: { in: memberIds } },
          ],
        },
      ],
    },
  });
  return matches.map((match) => ({
    createdAt: match.createdAt,
    memberAId: match.memberAId,
    memberBId: match.memberBId,
    open: CALL_CIRCLE_OPEN_MATCH_STATUSES.has(match.status),
  }));
}

export async function confirmCallCircleMatchSide(input: {
  expectedAsk: Pick<
    CallCircleMatchRow,
    "amAskedAt" | "finalAskedAt" | "windowEndAt" | "windowStartAt"
  >;
  groupId: string;
  matchId: string;
  memberAId: string;
  memberBId: string;
  memberId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
  side: CallCircleSide;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      ...(input.side === "A"
        ? { sideAResponse: "confirmed" as const }
        : { sideBResponse: "confirmed" as const }),
      status: "asking",
    },
    where: {
      ...activeCallCircleParticipantPairMatchWhere({
        groupId: input.groupId,
        memberAId: input.memberAId,
        memberBId: input.memberBId,
      }),
      groupId: input.groupId,
      id: input.matchId,
      ...sideMemberWhere(input.side, input.memberId),
      ...callCircleAskSnapshotWhere(input.expectedAsk, input.now),
      ...sideResponseWhere(input.side, "pending"),
      status: { in: ["proposed", "asking"] },
    },
  });
  if (result.count > 0) {
    await markCallCircleMatchBothConfirmedIfReady({
      groupId: input.groupId,
      matchId: input.matchId,
      now: input.now,
      prisma,
    });
  }
  return result.count > 0;
}

export async function declineCallCircleMatchSide(input: {
  expectedAsk: Pick<
    CallCircleMatchRow,
    "amAskedAt" | "finalAskedAt" | "windowEndAt" | "windowStartAt"
  >;
  groupId: string;
  matchId: string;
  memberAId: string;
  memberBId: string;
  memberId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
  side: CallCircleSide;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const outcome: CallCircleMatchOutcome = input.side === "A"
    ? "declined_by_a"
    : "declined_by_b";
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      outcome,
      ...(input.side === "A"
        ? { sideAResponse: "declined" as const }
        : { sideBResponse: "declined" as const }),
      status: "dropped",
    },
    where: {
      ...activeCallCircleParticipantPairMatchWhere({
        groupId: input.groupId,
        memberAId: input.memberAId,
        memberBId: input.memberBId,
      }),
      groupId: input.groupId,
      id: input.matchId,
      ...sideMemberWhere(input.side, input.memberId),
      ...callCircleAskSnapshotWhere(input.expectedAsk, input.now),
      OR: [
        {
          ...sideResponseWhere(input.side, "pending"),
          status: { in: ["proposed", "asking"] },
        },
        {
          ...affirmativeSideWithPendingPartnerWhere(input.side),
          status: "asking",
        },
        { status: "both_confirmed" },
      ],
    },
  });
  return result.count > 0;
}

export async function counterCallCircleMatchSide(input: {
  expectedAsk: Pick<
    CallCircleMatchRow,
    "amAskedAt" | "finalAskedAt" | "windowEndAt" | "windowStartAt"
  >;
  groupId: string;
  matchId: string;
  memberAId: string;
  memberBId: string;
  memberId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
  side: CallCircleSide;
  windowEndAt: Date;
  windowStartAt: Date;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      amAskedAt: null,
      finalAskedAt: null,
      ...(input.side === "A"
        ? {
            counterUsedA: true,
            sideAResponse: "countered" as const,
            sideBResponse: "pending" as const,
          }
        : {
            counterUsedB: true,
            sideAResponse: "pending" as const,
            sideBResponse: "countered" as const,
          }),
      status: "asking",
      windowEndAt: input.windowEndAt,
      windowStartAt: input.windowStartAt,
    },
    where: {
      ...activeCallCircleParticipantPairMatchWhere({
        groupId: input.groupId,
        memberAId: input.memberAId,
        memberBId: input.memberBId,
      }),
      groupId: input.groupId,
      id: input.matchId,
      ...sideMemberWhere(input.side, input.memberId),
      ...(input.side === "A" ? { counterUsedA: false } : { counterUsedB: false }),
      ...callCircleAskSnapshotWhere(input.expectedAsk, input.now),
      finalAskedAt: null,
      OR: [
        {
          ...sideResponseWhere(input.side, "pending"),
          status: { in: ["proposed", "asking"] },
        },
        {
          ...affirmativeSideWithPendingPartnerWhere(input.side),
          status: "asking",
        },
      ],
    },
  });
  return result.count > 0;
}

async function markCallCircleMatchBothConfirmedIfReady(input: {
  groupId: string;
  matchId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: { status: "both_confirmed" },
    where: {
      groupId: input.groupId,
      id: input.matchId,
      sideAResponse: { in: AFFIRMATIVE_MATCH_RESPONSES },
      sideBResponse: { in: AFFIRMATIVE_MATCH_RESPONSES },
      status: "asking",
      windowEndAt: { gt: input.now },
    },
  });
  return result.count > 0;
}

export async function markCallCircleMatchAmAsked(input: {
  groupId: string;
  matchId: string;
  memberAId: string;
  memberBId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
  sideAResponse: HostedCallCircleMatchResponse;
  sideBResponse: HostedCallCircleMatchResponse;
  windowEndAt: Date;
  windowStartAt: Date;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      amAskedAt: input.now,
      status: "asking",
    },
    where: {
      ...activeCallCircleParticipantPairMatchWhere({
        groupId: input.groupId,
        memberAId: input.memberAId,
        memberBId: input.memberBId,
      }),
      amAskedAt: null,
      finalAskedAt: null,
      groupId: input.groupId,
      id: input.matchId,
      phoneCallId: null,
      sideAResponse: input.sideAResponse,
      sideBResponse: input.sideBResponse,
      status: { in: ["proposed", "asking"] },
      windowEndAt: input.windowEndAt,
      windowStartAt: input.windowStartAt,
    },
  });
  return result.count > 0;
}

export async function markCallCircleMatchFinalAsked(input: {
  groupId: string;
  matchId: string;
  memberAId: string;
  memberBId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
  sideAResponse: HostedCallCircleMatchResponse;
  sideBResponse: HostedCallCircleMatchResponse;
  windowEndAt: Date;
  windowStartAt: Date;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      finalAskedAt: input.now,
      sideAResponse: "pending",
      sideBResponse: "pending",
      status: "asking",
    },
    where: {
      ...activeCallCircleParticipantPairMatchWhere({
        groupId: input.groupId,
        memberAId: input.memberAId,
        memberBId: input.memberBId,
      }),
      amAskedAt: { not: null },
      finalAskedAt: null,
      groupId: input.groupId,
      id: input.matchId,
      phoneCallId: null,
      sideAResponse: input.sideAResponse,
      sideBResponse: input.sideBResponse,
      status: "both_confirmed",
      windowEndAt: input.windowEndAt,
      windowStartAt: input.windowStartAt,
    },
  });
  return result.count > 0;
}

type CallCircleStageDropInput = {
  groupId: string;
  matchId: string;
  prisma?: CallCirclePrismaClient;
  sideAResponse: HostedCallCircleMatchResponse;
  sideBResponse: HostedCallCircleMatchResponse;
  windowEndAt: Date;
  windowStartAt: Date;
};

export async function dropCallCircleMatchForNotificationBlocked(
  input: CallCircleStageDropInput & { stage: "am" | "final" },
): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      outcome: "notification_blocked",
      status: "dropped",
    },
    where: {
      amAskedAt: input.stage === "am" ? null : { not: null },
      finalAskedAt: null,
      groupId: input.groupId,
      id: input.matchId,
      phoneCallId: null,
      sideAResponse: input.sideAResponse,
      sideBResponse: input.sideBResponse,
      status: input.stage === "am"
        ? { in: ["proposed", "asking"] }
        : "both_confirmed",
      windowEndAt: input.windowEndAt,
      windowStartAt: input.windowStartAt,
    },
  });
  return result.count > 0;
}

export async function claimCallCircleMatchForConnector(input: {
  groupId: string;
  matchId: string;
  memberAId: string;
  memberBId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      status: "bridging",
    },
    where: {
      ...activeCallCircleParticipantPairMatchWhere({
        groupId: input.groupId,
        memberAId: input.memberAId,
        memberBId: input.memberBId,
      }),
      finalAskedAt: { not: null },
      id: input.matchId,
      status: "both_confirmed",
      windowEndAt: { gt: input.now },
      windowStartAt: {
        gt: readCallCircleBridgeWindowStartCutoff(input.now),
        lte: input.now,
      },
    },
  });
  return result.count > 0;
}

export async function attachCallCirclePhoneCall(input: {
  matchId: string;
  phoneCallId: string;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: { phoneCallId: input.phoneCallId },
    where: {
      id: input.matchId,
      OR: [
        { phoneCallId: null },
        { phoneCallId: input.phoneCallId },
      ],
      status: "bridging",
    },
  });
  return result.count > 0;
}

export async function cancelCallCircleMatchForInactivePair(input: {
  groupId: string;
  matchId: string;
  memberAId: string;
  memberBId: string;
  now?: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const run = async (tx: Prisma.TransactionClient): Promise<boolean> => {
    const result = await tx.hostedCallCircleMatch.updateMany({
      data: {
        outcome: "participant_unavailable",
        status: "canceled",
      },
      where: {
        groupId: input.groupId,
        id: input.matchId,
        memberAId: input.memberAId,
        memberBId: input.memberBId,
        status: { in: ["proposed", "asking", "both_confirmed"] },
      },
    });
    if (result.count === 0) return false;

    await supersedeCallCircleNotificationsTx({
      matches: [{
        id: input.matchId,
        memberAId: input.memberAId,
        memberBId: input.memberBId,
      }],
      now,
      tx,
    });
    return true;
  };

  return hasPrismaTransaction(prisma)
    ? prisma.$transaction((tx) => run(tx))
    : run(prisma);
}

export async function markCallCircleMatchOutcome(input: {
  expectedOutcome?: CallCircleMatchOutcome;
  expectedStatuses?: readonly (
    | "proposed"
    | "asking"
    | "both_confirmed"
    | "bridging"
    | "dropped"
  )[];
  matchId: string;
  outcome: CallCircleMatchOutcome;
  phoneCallId?: string | null;
  prisma?: CallCirclePrismaClient;
  status: "completed" | "dropped" | "expired" | "canceled";
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      outcome: input.outcome,
      status: input.status,
    },
    where: {
      id: input.matchId,
      ...(input.expectedOutcome ? { outcome: input.expectedOutcome } : {}),
      ...("phoneCallId" in input ? { phoneCallId: input.phoneCallId ?? null } : {}),
      status: {
        in: input.expectedStatuses
          ? Array.from(input.expectedStatuses)
          : ["proposed", "asking", "both_confirmed", "bridging"],
      },
    },
  });
  return result.count > 0;
}

export async function cancelOpenCallCircleMatchesForParticipant(input: {
  groupId: string;
  memberId: string;
  now?: Date;
  prisma: Prisma.TransactionClient;
}): Promise<number> {
  return cancelOpenCallCircleMatches({
    groupId: input.groupId,
    memberIds: [input.memberId],
    now: input.now,
    prisma: input.prisma,
  });
}

export async function cancelOpenCallCircleMatchesForMembers(input: {
  memberIds: readonly string[];
  now?: Date;
  prisma: Prisma.TransactionClient;
}): Promise<number> {
  return cancelOpenCallCircleMatches({
    memberIds: input.memberIds,
    now: input.now,
    prisma: input.prisma,
  });
}

async function cancelOpenCallCircleMatches(input: {
  groupId?: string;
  memberIds?: readonly string[];
  now?: Date;
  prisma: Prisma.TransactionClient;
}): Promise<number> {
  const prisma = input.prisma;
  const memberIds = [...new Set(input.memberIds ?? [])].sort();
  if (!input.groupId && memberIds.length === 0) return 0;
  const participantWhere = memberIds.length > 0
    ? {
        OR: [
          { memberAId: { in: memberIds } },
          { memberBId: { in: memberIds } },
        ],
      }
    : null;
  const openStatusWhere = {
    OR: [
      { status: { in: ["proposed", "asking", "both_confirmed"] } },
      { phoneCallId: null, status: "bridging" },
      {
        phoneCall: {
          is: {
            providerStartAttemptedAt: null,
          },
        },
        status: "bridging",
      },
    ],
  } satisfies Prisma.HostedCallCircleMatchWhereInput;
  const openWhere = {
    ...(input.groupId ? { groupId: input.groupId } : {}),
    AND: [
      ...(participantWhere ? [participantWhere] : []),
      openStatusWhere,
    ],
  } satisfies Prisma.HostedCallCircleMatchWhereInput;
  const candidates = await prisma.hostedCallCircleMatch.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      memberAId: true,
      memberBId: true,
    },
    where: openWhere,
  });
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      outcome: "participant_unavailable",
      status: "canceled",
    },
    where: openWhere,
  });
  const canceledMatches = result.count === 0 || candidates.length === 0
    ? []
    : await prisma.hostedCallCircleMatch.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          memberAId: true,
          memberBId: true,
        },
        where: {
          id: { in: candidates.map((match) => match.id) },
          outcome: "participant_unavailable",
          status: "canceled",
        },
      });
  await supersedeCallCircleNotificationsTx({
    groupId: input.groupId,
    matches: canceledMatches,
    now: input.now ?? new Date(),
    setupMemberIds: memberIds,
    tx: prisma,
  });
  return result.count;
}

export async function expirePastCallCircleMatches(input: {
  matchIds: readonly string[];
  now: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<number> {
  if (input.matchIds.length === 0) return 0;
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      outcome: "expired",
      status: "expired",
    },
    where: {
      AND: [callCircleExpiredResponseWhere(input.now)],
      id: { in: Array.from(input.matchIds) },
    },
  });
  return result.count;
}

export function callCircleExpiredResponseWhere(
  now: Date,
): Prisma.HostedCallCircleMatchWhereInput {
  return {
    OR: [
      {
        finalAskedAt: null,
        status: { in: ["proposed", "asking", "both_confirmed"] },
        // Preserve the exact cutoff tick for the final-ask scheduler phase.
        windowStartAt: {
          lt: new Date(now.getTime() + CALL_CIRCLE_FINAL_ASK_LEAD_MS),
        },
      },
      {
        finalAskedAt: { not: null },
        OR: [
          { windowEndAt: { lte: now } },
          {
            windowStartAt: {
              lte: readCallCircleBridgeWindowStartCutoff(now),
            },
          },
        ],
        status: "asking",
      },
    ],
  };
}

function sideMemberWhere(
  side: CallCircleSide,
  memberId: string,
): { memberAId: string } | { memberBId: string } {
  return side === "A" ? { memberAId: memberId } : { memberBId: memberId };
}

function sideResponseWhere(
  side: CallCircleSide,
  response: "pending",
): { sideAResponse: "pending" } | { sideBResponse: "pending" } {
  return side === "A" ? { sideAResponse: response } : { sideBResponse: response };
}

function affirmativeSideWithPendingPartnerWhere(
  side: CallCircleSide,
): Prisma.HostedCallCircleMatchWhereInput {
  return side === "A"
    ? {
        sideAResponse: { in: AFFIRMATIVE_MATCH_RESPONSES },
        sideBResponse: "pending",
      }
    : {
        sideAResponse: "pending",
        sideBResponse: { in: AFFIRMATIVE_MATCH_RESPONSES },
      };
}

function callCircleAskSnapshotWhere(
  expectedAsk: Pick<
    CallCircleMatchRow,
    "amAskedAt" | "finalAskedAt" | "windowEndAt" | "windowStartAt"
  >,
  now: Date,
): Prisma.HostedCallCircleMatchWhereInput {
  return {
    amAskedAt: expectedAsk.amAskedAt,
    finalAskedAt: expectedAsk.finalAskedAt,
    windowEndAt: {
      equals: expectedAsk.windowEndAt,
      gt: now,
    },
    windowStartAt: {
      equals: expectedAsk.windowStartAt,
      gt: expectedAsk.finalAskedAt
        ? readCallCircleBridgeWindowStartCutoff(now)
        : new Date(now.getTime() + CALL_CIRCLE_FINAL_ASK_LEAD_MS),
    },
  };
}

function sortPair(firstMemberId: string, secondMemberId: string): [string, string] {
  return firstMemberId <= secondMemberId
    ? [firstMemberId, secondMemberId]
    : [secondMemberId, firstMemberId];
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002";
}
