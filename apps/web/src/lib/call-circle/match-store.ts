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
  canUseActiveCallCircleParticipantPair,
} from "./participant-store";
import {
  CALL_CIRCLE_FINAL_ASK_LEAD_MS,
  CALL_CIRCLE_MATCH_LOOKBACK_MS,
  readCallCircleBridgeWindowStartCutoff,
} from "./time";
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
  if (!await canUseActiveCallCircleParticipantPair({
    groupId: input.proposal.groupId,
    memberAId,
    memberBId,
    prisma,
  })) {
    return null;
  }
  if (await hasRecentCallCircleMatchForMembers({
    memberIds: [memberAId, memberBId],
    now: input.proposal.now,
    prisma,
  })) {
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

async function hasRecentCallCircleMatchForMembers(input: {
  memberIds: readonly string[];
  now: Date;
  prisma: CallCirclePrismaClient;
}): Promise<boolean> {
  const memberIds = Array.from(input.memberIds);
  const match = await input.prisma.hostedCallCircleMatch.findFirst({
    select: { id: true },
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
  return match !== null;
}

export async function listCallCircleMemberIdsWithRecentMatch(input: {
  memberIds: readonly string[];
  now: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<string[]> {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) return [];
  const prisma = input.prisma ?? getPrisma();
  const recentMatchWhere = recentBlockingCallCircleMatchWhere(input.now);
  const members = await prisma.hostedMember.findMany({
    orderBy: { id: "asc" },
    select: { id: true },
    take: memberIds.length,
    where: {
      id: { in: memberIds },
      OR: [
        { callCircleMatchesAsA: { some: recentMatchWhere } },
        { callCircleMatchesAsB: { some: recentMatchWhere } },
      ],
    },
  });
  return members.map((member) => member.id);
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
          gte: new Date(now.getTime() - CALL_CIRCLE_MATCH_LOOKBACK_MS),
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
  groupId: string;
  prisma?: CallCirclePrismaClient;
}): Promise<Array<{
  createdAt: Date;
  memberAId: string;
  memberBId: string;
}>> {
  const prisma = input.prisma ?? getPrisma();
  return prisma.hostedCallCircleMatch.findMany({
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take: 200,
    select: {
      createdAt: true,
      memberAId: true,
      memberBId: true,
    },
    where: {
      groupId: input.groupId,
      ...CALL_CIRCLE_BLOCKING_RECENT_MATCH_WHERE,
    },
  });
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
      ...sideResponseWhere(input.side, "pending"),
      status: { in: ["proposed", "asking"] },
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
  prisma?: CallCirclePrismaClient;
}): Promise<number> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      outcome: "participant_unavailable",
      status: "canceled",
    },
    where: {
      groupId: input.groupId,
      AND: [
        {
          OR: [
            { memberAId: input.memberId },
            { memberBId: input.memberId },
          ],
        },
        {
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
        },
      ],
    },
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
  return firstMemberId.localeCompare(secondMemberId) <= 0
    ? [firstMemberId, secondMemberId]
    : [secondMemberId, firstMemberId];
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002";
}
