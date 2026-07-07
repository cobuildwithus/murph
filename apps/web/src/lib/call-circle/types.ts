import "server-only";

import type {
  HostedCallCircleMatch,
  HostedCallCircleMatchResponse,
  HostedCallCircleMatchStatus,
  HostedCallCircleParticipant,
  HostedCallCircleParticipantStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export type CallCirclePrismaClient = PrismaClient | Prisma.TransactionClient;

export type CallCircleSide = "A" | "B";

export type CallCircleParticipantRow = HostedCallCircleParticipant;
export type CallCircleMatchRow = HostedCallCircleMatch;
export type CallCircleParticipantStatus = HostedCallCircleParticipantStatus;
export type CallCircleMatchStatus = HostedCallCircleMatchStatus;
export type CallCircleMatchResponse = HostedCallCircleMatchResponse;

export interface CallCircleMutationResult {
  changed: boolean;
}

export function readCallCircleSideMemberId(input: {
  match: Pick<HostedCallCircleMatch, "memberAId" | "memberBId">;
  side: CallCircleSide;
}): string {
  return input.side === "A" ? input.match.memberAId : input.match.memberBId;
}
