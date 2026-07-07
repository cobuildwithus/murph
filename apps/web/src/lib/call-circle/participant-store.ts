import "server-only";

import { Prisma } from "@prisma/client";
import {
  hostedCallCirclePreferencesSchema,
  type HostedCallCirclePreferences,
} from "@murphai/hosted-execution/call-circle";

import {
  generateHostedCallCircleParticipantId,
} from "../hosted-onboarding/shared";
import {
  readActiveHostedMemberAccess,
} from "../hosted-onboarding/member-access";
import { getPrisma } from "../prisma";
import type {
  CallCircleParticipantRow,
  CallCirclePrismaClient,
} from "./types";

export interface CallCircleParticipantPreferences
  extends HostedCallCirclePreferences {}

export interface CallCircleEligibleParticipant {
  groupId: string;
  lastMatchedAt: Date | null;
  memberId: string;
  preferences: CallCircleParticipantPreferences;
  timeZone: string;
}

const DEFAULT_CALL_CIRCLE_TIME_ZONE = "UTC";

export async function enrollCallCircleParticipant(input: {
  groupId: string;
  memberId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<CallCircleParticipantRow> {
  const prisma = input.prisma ?? getPrisma();
  try {
    return await prisma.hostedCallCircleParticipant.create({
      data: {
        createdAt: input.now,
        groupId: input.groupId,
        id: generateHostedCallCircleParticipantId(),
        memberId: input.memberId,
        status: "enrolled",
        updatedAt: input.now,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return await prisma.hostedCallCircleParticipant.findUniqueOrThrow({
      where: {
        groupId_memberId: {
          groupId: input.groupId,
          memberId: input.memberId,
        },
      },
    });
  }
}

export async function writeCallCirclePreferences(input: {
  groupId: string;
  memberId: string;
  preferences: CallCircleParticipantPreferences;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const preferences = hostedCallCirclePreferencesSchema.parse(input.preferences);
  const result = await prisma.hostedCallCircleParticipant.updateMany({
    data: {
      preferencesJson: toPrismaJson(preferences),
    },
    where: {
      groupId: input.groupId,
      memberId: input.memberId,
    },
  });
  return result.count > 0;
}

export async function pauseCallCircleParticipant(input: {
  groupId: string;
  memberId: string;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleParticipant.updateMany({
    data: { status: "paused" },
    where: {
      groupId: input.groupId,
      memberId: input.memberId,
      status: "enrolled",
    },
  });
  return result.count > 0;
}

export async function resumeCallCircleParticipant(input: {
  groupId: string;
  memberId: string;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleParticipant.updateMany({
    data: { status: "enrolled" },
    where: {
      groupId: input.groupId,
      memberId: input.memberId,
      status: "paused",
    },
  });
  return result.count > 0;
}

export async function listCallCircleEligibleParticipants(input: {
  groupId: string;
  prisma?: CallCirclePrismaClient;
}): Promise<CallCircleEligibleParticipant[]> {
  const prisma = input.prisma ?? getPrisma();
  const participants = await prisma.hostedCallCircleParticipant.findMany({
    orderBy: [
      { lastMatchedAt: "asc" },
      { createdAt: "asc" },
      { memberId: "asc" },
    ],
    select: {
      groupId: true,
      lastMatchedAt: true,
      member: {
        select: {
          pendingActivationTimeZone: true,
        },
      },
      memberId: true,
      preferencesJson: true,
    },
    where: {
      groupId: input.groupId,
      preferencesJson: { not: Prisma.DbNull },
      status: "enrolled",
    },
  });

  return participants.flatMap((participant) => {
    const preferences = parseCallCirclePreferencesOrNull(participant.preferencesJson);
    if (!preferences || preferences.windows.length === 0) return [];
    return [{
      groupId: participant.groupId,
      lastMatchedAt: participant.lastMatchedAt,
      memberId: participant.memberId,
      preferences,
      timeZone: participant.member.pendingActivationTimeZone
        ?? DEFAULT_CALL_CIRCLE_TIME_ZONE,
    }];
  });
}

export async function canUseActiveCallCircleParticipantPair(input: {
  groupId: string;
  memberAId: string;
  memberBId: string;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  if (input.memberAId === input.memberBId) return false;
  const prisma = input.prisma ?? getPrisma();
  const memberIds = [input.memberAId, input.memberBId];
  const [
    memberAHasAccess,
    memberBHasAccess,
    membershipCount,
    participantCount,
  ] = await Promise.all([
    readActiveHostedMemberAccess({
      memberId: input.memberAId,
      prisma,
    }),
    readActiveHostedMemberAccess({
      memberId: input.memberBId,
      prisma,
    }),
    prisma.hostedGroupMember.count({
      where: {
        groupId: input.groupId,
        memberId: { in: memberIds },
      },
    }),
    prisma.hostedCallCircleParticipant.count({
      where: {
        groupId: input.groupId,
        memberId: { in: memberIds },
        status: "enrolled",
      },
    }),
  ]);

  return memberAHasAccess
    && memberBHasAccess
    && membershipCount === 2
    && participantCount === 2;
}

export async function canUseActiveCallCircleParticipant(input: {
  groupId: string;
  memberId: string;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const [
    hasAccess,
    membershipCount,
    participantCount,
  ] = await Promise.all([
    readActiveHostedMemberAccess({
      memberId: input.memberId,
      prisma,
    }),
    prisma.hostedGroupMember.count({
      where: {
        groupId: input.groupId,
        memberId: input.memberId,
      },
    }),
    prisma.hostedCallCircleParticipant.count({
      where: {
        groupId: input.groupId,
        memberId: input.memberId,
        status: "enrolled",
      },
    }),
  ]);

  return hasAccess && membershipCount === 1 && participantCount === 1;
}

export async function canAppendCallCircleSetupNotification(input: {
  groupId: string;
  memberId: string;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const [
    hasAccess,
    membershipCount,
    participantCount,
  ] = await Promise.all([
    readActiveHostedMemberAccess({
      memberId: input.memberId,
      prisma,
    }),
    prisma.hostedGroupMember.count({
      where: {
        groupId: input.groupId,
        memberId: input.memberId,
      },
    }),
    prisma.hostedCallCircleParticipant.count({
      where: {
        groupId: input.groupId,
        memberId: input.memberId,
        preferencesJson: { equals: Prisma.DbNull },
        status: "enrolled",
      },
    }),
  ]);

  return hasAccess && membershipCount === 1 && participantCount === 1;
}

export function parseCallCirclePreferencesOrNull(
  value: Prisma.JsonValue | null,
): CallCircleParticipantPreferences | null {
  const parsed = hostedCallCirclePreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toPrismaJson(value: HostedCallCirclePreferences): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002";
}
