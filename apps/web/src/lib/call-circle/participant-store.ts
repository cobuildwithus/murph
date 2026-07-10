import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  hostedCallCirclePreferencesSchema,
  type HostedCallCirclePreferences,
} from "@murphai/hosted-execution/call-circle";
import {
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
} from "@murphai/hosted-execution/runtime-control";

import {
  generateHostedCallCircleParticipantId,
  lockHostedGroupRow,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import {
  activeHostedMemberAccessWithParticipantsWhere,
} from "../hosted-onboarding/member-access";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import type {
  CallCircleParticipantRow,
  CallCirclePrismaClient,
} from "./types";

export interface CallCircleEligibleParticipant {
  groupId: string;
  memberId: string;
  preferences: HostedCallCirclePreferences;
}

export const HOSTED_CALL_CIRCLE_PARTICIPANTS_MAX =
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX;

export async function acceptCallCircleOfferEnrollment(input: {
  groupId: string;
  memberId: string;
  now: Date;
  offerPostedAt: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<CallCircleParticipantRow> {
  const prisma = input.prisma ?? getPrisma();
  if (hasPrismaTransactionMethod(prisma)) {
    return await prisma.$transaction(async (tx) => acceptCallCircleOfferEnrollmentInLockedGroup({
      groupId: input.groupId,
      memberId: input.memberId,
      now: input.now,
      offerPostedAt: input.offerPostedAt,
      prisma: tx,
    }));
  }
  return await acceptCallCircleOfferEnrollmentInLockedGroup({
    groupId: input.groupId,
    memberId: input.memberId,
    now: input.now,
    offerPostedAt: input.offerPostedAt,
    prisma,
  });
}

async function acceptCallCircleOfferEnrollmentInLockedGroup(input: {
  groupId: string;
  memberId: string;
  now: Date;
  offerPostedAt: Date;
  prisma: Prisma.TransactionClient;
}): Promise<CallCircleParticipantRow> {
  const prisma = input.prisma;
  await lockHostedGroupRow(prisma, input.groupId);
  await lockHostedMemberRow(prisma, input.memberId);
  const existingAfterLock = await prisma.hostedCallCircleParticipant.findUnique({
    where: {
      groupId_memberId: {
        groupId: input.groupId,
        memberId: input.memberId,
      },
    },
  });
  if (existingAfterLock) {
    if (shouldResumePausedParticipant({
      offerPostedAt: input.offerPostedAt,
      participant: existingAfterLock,
    })) {
      const resumed = await prisma.hostedCallCircleParticipant.updateMany({
        data: {
          nextMatchingAt: input.now,
          pausedAt: null,
          status: "enrolled",
          updatedAt: input.now,
        },
        where: {
          groupId: input.groupId,
          memberId: input.memberId,
          pausedAt: { lt: input.offerPostedAt },
          status: "paused",
        },
      });
      if (resumed.count > 0) {
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
    return existingAfterLock;
  }
  const participantCount = await prisma.hostedCallCircleParticipant.count({
    where: {
      groupId: input.groupId,
    },
  });
  if (participantCount >= HOSTED_CALL_CIRCLE_PARTICIPANTS_MAX) {
    throw hostedOnboardingError({
      code: "HOSTED_CALL_CIRCLE_PARTICIPANT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This group already has the maximum number of Call Circle participants.",
      retryable: false,
    });
  }
  try {
    return await prisma.hostedCallCircleParticipant.create({
      data: {
        createdAt: input.now,
        groupId: input.groupId,
        id: generateHostedCallCircleParticipantId(),
        memberId: input.memberId,
        nextMatchingAt: input.now,
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

function shouldResumePausedParticipant(input: {
  offerPostedAt: Date;
  participant: CallCircleParticipantRow;
}): boolean {
  return input.participant.status === "paused"
    && input.participant.pausedAt !== null
    && input.participant.pausedAt.getTime() < input.offerPostedAt.getTime();
}

export async function writeCallCirclePreferences(input: {
  groupId: string;
  memberId: string;
  now?: Date;
  preferences: HostedCallCirclePreferences;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const preferences = hostedCallCirclePreferencesSchema.parse(input.preferences);
  const result = await prisma.hostedCallCircleParticipant.updateMany({
    data: {
      nextMatchingAt: input.now ?? new Date(),
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
  now?: Date;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  const prisma = input.prisma;
  await lockHostedMemberRow(prisma, input.memberId);
  const result = await prisma.hostedCallCircleParticipant.updateMany({
    data: {
      pausedAt: input.now ?? new Date(),
      status: "paused",
    },
    where: {
      groupId: input.groupId,
      memberId: input.memberId,
    },
  });
  return result.count > 0;
}

export async function resumeCallCircleParticipant(input: {
  groupId: string;
  memberId: string;
  now?: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.hostedCallCircleParticipant.updateMany({
    data: {
      nextMatchingAt: input.now ?? new Date(),
      pausedAt: null,
      status: "enrolled",
    },
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
      { createdAt: "asc" },
      { memberId: "asc" },
    ],
    select: {
      groupId: true,
      memberId: true,
      preferencesJson: true,
    },
    take: HOSTED_CALL_CIRCLE_PARTICIPANTS_MAX,
    where: {
      ...activeCallCircleParticipantWhere({ groupId: input.groupId }),
      preferencesJson: { not: Prisma.DbNull },
    },
  });

  return participants.flatMap((participant) => {
    const preferences = parseCallCirclePreferencesOrNull(participant.preferencesJson);
    if (
      !preferences
      || preferences.windows.length === 0
    ) {
      return [];
    }
    return [{
      groupId: participant.groupId,
      memberId: participant.memberId,
      preferences,
    }];
  });
}

async function readCallCircleParticipantTimeZones(input: {
  groupId: string;
  memberIds: readonly string[];
  prisma?: CallCirclePrismaClient;
}): Promise<Map<string, string>> {
  const prisma = input.prisma ?? getPrisma();
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) return new Map();
  const participants = await prisma.hostedCallCircleParticipant.findMany({
    select: {
      memberId: true,
      preferencesJson: true,
    },
    where: {
      groupId: input.groupId,
      memberId: { in: memberIds },
      preferencesJson: { not: Prisma.DbNull },
    },
  });
  const timeZones = new Map<string, string>();
  for (const participant of participants) {
    const preferences = parseCallCirclePreferencesOrNull(participant.preferencesJson);
    if (preferences) {
      timeZones.set(participant.memberId, preferences.timeZone);
    }
  }
  return timeZones;
}

export async function readCallCircleMatchParticipantTimeZones(input: {
  groupId: string;
  memberAId: string;
  memberBId: string;
  prisma?: CallCirclePrismaClient;
}): Promise<{
  memberATimeZone: string;
  memberBTimeZone: string;
} | null> {
  const timeZones = await readCallCircleParticipantTimeZones({
    groupId: input.groupId,
    memberIds: [input.memberAId, input.memberBId],
    prisma: input.prisma,
  });
  const memberATimeZone = timeZones.get(input.memberAId);
  const memberBTimeZone = timeZones.get(input.memberBId);
  return memberATimeZone && memberBTimeZone
    ? { memberATimeZone, memberBTimeZone }
    : null;
}

export async function canUseActiveCallCircleParticipantPair(input: {
  groupId: string;
  memberAId: string;
  memberBId: string;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  if (input.memberAId === input.memberBId) return false;
  const prisma = input.prisma ?? getPrisma();
  const participantCount = await prisma.hostedCallCircleParticipant.count({
    where: {
      ...activeCallCircleParticipantWhere({ groupId: input.groupId }),
      memberId: { in: [input.memberAId, input.memberBId] },
    },
  });
  return participantCount === 2;
}

export function activeCallCircleParticipantWhere(input: {
  groupId: string;
  memberId?: string;
}): Prisma.HostedCallCircleParticipantWhereInput {
  return {
    groupId: input.groupId,
    ...(input.memberId ? { memberId: input.memberId } : {}),
    member: {
      ...activeHostedMemberAccessWithParticipantsWhere(),
      hostedGroupMemberships: {
        some: { groupId: input.groupId },
      },
    },
    status: "enrolled",
  };
}

export function activeCallCircleParticipantPairMatchWhere(input: {
  groupId: string;
  memberAId: string;
  memberBId: string;
}): Prisma.HostedCallCircleMatchWhereInput {
  return {
    AND: [
      {
        group: {
          callCircleParticipants: {
            some: activeCallCircleParticipantWhere({
              groupId: input.groupId,
              memberId: input.memberAId,
            }),
          },
        },
      },
      {
        group: {
          callCircleParticipants: {
            some: activeCallCircleParticipantWhere({
              groupId: input.groupId,
              memberId: input.memberBId,
            }),
          },
        },
      },
    ],
    groupId: input.groupId,
    memberAId: input.memberAId,
    memberBId: input.memberBId,
  };
}

export async function canUseActiveCallCircleParticipant(input: {
  groupId: string;
  memberId: string;
  prisma?: CallCirclePrismaClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  return await prisma.hostedCallCircleParticipant.count({
    where: activeCallCircleParticipantWhere({
      groupId: input.groupId,
      memberId: input.memberId,
    }),
  }) === 1;
}

function parseCallCirclePreferencesOrNull(
  value: Prisma.JsonValue | null,
): HostedCallCirclePreferences | null {
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

function hasPrismaTransactionMethod(
  prisma: CallCirclePrismaClient,
): prisma is PrismaClient {
  return "$transaction" in prisma;
}
