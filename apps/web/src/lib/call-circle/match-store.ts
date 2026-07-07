import "server-only";

import {
  Prisma,
  type HostedCallCircleMatchResponse,
  type PrismaClient,
} from "@prisma/client";

import {
  generateHostedCallCircleMatchId,
} from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import {
  canUseActiveCallCircleParticipantPair,
} from "./participant-store";
import type {
  CallCircleMatchRow,
  CallCirclePrismaClient,
  CallCircleSide,
} from "./types";

export interface CallCircleMatchProposalInput {
  groupId: string;
  memberAId: string;
  memberBId: string;
  now: Date;
  windowEndAt: Date;
  windowStartAt: Date;
}

export interface CallCircleResponseMutationResult {
  changed: boolean;
  matchId: string;
}

const AFFIRMATIVE_MATCH_RESPONSES: HostedCallCircleMatchResponse[] = [
  "confirmed",
  "countered",
];
const CALL_CIRCLE_MATCH_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const CURRENT_ASK_SENT_WHERE = [
  { amAskedAt: { not: null } },
  { finalAskedAt: { not: null } },
] satisfies Prisma.HostedCallCircleMatchWhereInput[];
export const CALL_CIRCLE_BLOCKING_RECENT_MATCH_WHERE = {
  NOT: [
    { status: "canceled" },
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
  const [memberAId, memberBId] = sortPair(
    input.proposal.memberAId,
    input.proposal.memberBId,
  );
  const proposal = {
    ...input.proposal,
    memberAId,
    memberBId,
  };
  const run = (tx: CallCirclePrismaClient) =>
    createCallCircleMatchProposalTx({
      proposal,
      prisma: tx,
    });
  try {
    return hasPrismaTransaction(prisma)
      ? await prisma.$transaction((tx) => run(tx))
      : await run(prisma);
  } catch (error) {
    if (
      error instanceof CallCircleProposalClaimMissedError
      || isUniqueConstraintError(error)
    ) {
      return null;
    }
    throw error;
  }
}

async function createCallCircleMatchProposalTx(input: {
  proposal: CallCircleMatchProposalInput;
  prisma: CallCirclePrismaClient;
}): Promise<CallCircleMatchRow | null> {
  const prisma = input.prisma;
  const [memberAId, memberBId] = sortPair(
    input.proposal.memberAId,
    input.proposal.memberBId,
  );
  if (!await canUseActiveCallCircleParticipantPair({
    groupId: input.proposal.groupId,
    memberAId,
    memberBId,
    prisma,
  })) {
    return null;
  }

  const claim = await prisma.hostedCallCircleParticipant.updateMany({
    data: { lastMatchedAt: input.proposal.now },
    where: {
      groupId: input.proposal.groupId,
      memberId: { in: [memberAId, memberBId] },
      OR: [
        { lastMatchedAt: null },
        {
          lastMatchedAt: {
            lt: new Date(input.proposal.now.getTime() - CALL_CIRCLE_MATCH_LOOKBACK_MS),
          },
        },
      ],
      preferencesJson: { not: Prisma.DbNull },
      status: "enrolled",
    },
  });
  if (claim.count !== 2) {
    throw new CallCircleProposalClaimMissedError();
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

class CallCircleProposalClaimMissedError extends Error {
  constructor() {
    super("Call Circle proposal participant claim missed.");
  }
}

function hasPrismaTransaction(
  prisma: CallCirclePrismaClient,
): prisma is PrismaClient {
  return "$transaction" in prisma && typeof prisma.$transaction === "function";
}

export async function listRecentCallCircleMatches(input: {
  groupId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<Array<{
  createdAt: Date;
  memberAId: string;
  memberBId: string;
  status: string;
  windowStartAt: Date;
}>> {
  const prisma = input.prisma ?? getPrisma();
  return prisma.hostedCallCircleMatch.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      memberAId: true,
      memberBId: true,
      status: true,
      windowStartAt: true,
    },
    where: {
      createdAt: {
        gte: new Date(input.now.getTime() - 7 * 24 * 60 * 60 * 1000),
      },
      groupId: input.groupId,
      ...CALL_CIRCLE_BLOCKING_RECENT_MATCH_WHERE,
    },
  });
}

export async function readLastCallCirclePartnerMemberIds(input: {
  groupId: string;
  memberIds: readonly string[];
  prisma?: CallCirclePrismaClient;
}): Promise<Map<string, string>> {
  const prisma = input.prisma ?? getPrisma();
  const memberIds = Array.from(new Set(input.memberIds));
  const matches = await Promise.all(memberIds.map((memberId) =>
    prisma.hostedCallCircleMatch.findFirst({
      orderBy: { createdAt: "desc" },
      select: {
        memberAId: true,
        memberBId: true,
      },
      where: {
        groupId: input.groupId,
        OR: [
          { memberAId: memberId },
          { memberBId: memberId },
        ],
        ...CALL_CIRCLE_BLOCKING_RECENT_MATCH_WHERE,
      },
    })
  ));

  const lastPartnerByMemberId = new Map<string, string>();
  memberIds.forEach((memberId, index) => {
    const match = matches[index];
    if (!match) return;
    lastPartnerByMemberId.set(
      memberId,
      match.memberAId === memberId ? match.memberBId : match.memberAId,
    );
  });
  return lastPartnerByMemberId;
}

export async function confirmCallCircleMatchSide(input: {
  groupId: string;
  matchId: string;
  memberId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
  side: CallCircleSide;
}): Promise<CallCircleResponseMutationResult> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      ...(input.side === "A"
        ? { sideAResponse: "confirmed" as const }
        : { sideBResponse: "confirmed" as const }),
      status: "asking",
    },
    where: {
      groupId: input.groupId,
      id: input.matchId,
      ...sideMemberWhere(input.side, input.memberId),
      OR: CURRENT_ASK_SENT_WHERE,
      ...sideResponseWhere(input.side, "pending"),
      status: { in: ["proposed", "asking"] },
      windowEndAt: { gt: input.now },
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
  return { changed: result.count > 0, matchId: input.matchId };
}

export async function declineCallCircleMatchSide(input: {
  groupId: string;
  matchId: string;
  memberId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
  side: CallCircleSide;
}): Promise<CallCircleResponseMutationResult> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      endedAt: input.now,
      outcome: `declined_by_${input.side.toLowerCase()}`,
      ...(input.side === "A"
        ? { sideAResponse: "declined" as const }
        : { sideBResponse: "declined" as const }),
      status: "dropped",
    },
    where: {
      groupId: input.groupId,
      id: input.matchId,
      ...sideMemberWhere(input.side, input.memberId),
      OR: [
        {
          OR: CURRENT_ASK_SENT_WHERE,
          ...sideResponseWhere(input.side, "pending"),
          status: { in: ["proposed", "asking"] },
        },
        { status: "both_confirmed" },
      ],
      windowEndAt: { gt: input.now },
    },
  });
  return { changed: result.count > 0, matchId: input.matchId };
}

export async function counterCallCircleMatchSide(input: {
  groupId: string;
  matchId: string;
  memberId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
  side: CallCircleSide;
  windowEndAt: Date;
  windowStartAt: Date;
}): Promise<CallCircleResponseMutationResult> {
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
      groupId: input.groupId,
      id: input.matchId,
      ...sideMemberWhere(input.side, input.memberId),
      ...(input.side === "A" ? { counterUsedA: false } : { counterUsedB: false }),
      OR: CURRENT_ASK_SENT_WHERE,
      ...sideResponseWhere(input.side, "pending"),
      status: { in: ["proposed", "asking"] },
      windowEndAt: { gt: input.now },
    },
  });
  return { changed: result.count > 0, matchId: input.matchId };
}

export async function markCallCircleMatchBothConfirmedIfReady(input: {
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
  matchId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      amAskedAt: input.now,
      status: "asking",
    },
    where: {
      amAskedAt: null,
      id: input.matchId,
      status: { in: ["proposed", "asking"] },
    },
  });
  return result.count > 0;
}

export async function markCallCircleMatchFinalAsked(input: {
  matchId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
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
      finalAskedAt: null,
      id: input.matchId,
      status: "both_confirmed",
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
  if (!await canUseActiveCallCircleParticipantPair({
    groupId: input.groupId,
    memberAId: input.memberAId,
    memberBId: input.memberBId,
    prisma,
  })) {
    return false;
  }
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      claimedAt: input.now,
      status: "bridging",
    },
    where: {
      claimedAt: null,
      finalAskedAt: { not: null },
      id: input.matchId,
      status: "both_confirmed",
      windowEndAt: { gt: input.now },
      windowStartAt: { lte: input.now },
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
      phoneCallId: null,
      status: "bridging",
    },
  });
  return result.count > 0;
}

export async function markCallCircleMatchOutcome(input: {
  matchId: string;
  now: Date;
  outcome: string;
  phoneCallId?: string | null;
  prisma?: CallCirclePrismaClient;
  status: "completed" | "dropped" | "expired" | "canceled";
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      endedAt: input.now,
      outcome: input.outcome,
      status: input.status,
    },
    where: {
      id: input.matchId,
      ...("phoneCallId" in input ? { phoneCallId: input.phoneCallId ?? null } : {}),
      status: { in: ["proposed", "asking", "both_confirmed", "bridging"] },
    },
  });
  return result.count > 0;
}

export async function cancelOpenCallCircleMatchesForParticipant(input: {
  groupId: string;
  memberId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<number> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      endedAt: input.now,
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
          ],
        },
      ],
    },
  });
  return result.count;
}

export async function expirePastCallCircleMatches(input: {
  now: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<number> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleMatch.updateMany({
    data: {
      endedAt: input.now,
      outcome: "expired",
      status: "expired",
    },
    where: {
      OR: [
        { status: { in: ["proposed", "asking"] } },
        { finalAskedAt: null, status: "both_confirmed" },
      ],
      windowEndAt: { lte: input.now },
    },
  });
  return result.count;
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

function sortPair(firstMemberId: string, secondMemberId: string): [string, string] {
  return firstMemberId.localeCompare(secondMemberId) <= 0
    ? [firstMemberId, secondMemberId]
    : [secondMemberId, firstMemberId];
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002";
}
