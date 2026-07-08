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
} from "../hosted-onboarding/shared";
import {
  readActiveHostedMemberAccess,
} from "../hosted-onboarding/member-access";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import type {
  CallCircleParticipantRow,
  CallCirclePrismaClient,
} from "./types";
import {
  normalizeCallCircleTimeZone,
} from "./time";

export interface CallCircleParticipantPreferences
  extends HostedCallCirclePreferences {}

export interface CallCircleEligibleParticipant {
  groupId: string;
  lastMatchedAt: Date | null;
  memberId: string;
  preferences: CallCircleParticipantPreferences;
  timeZone: string;
}

export const HOSTED_CALL_CIRCLE_PARTICIPANTS_MAX =
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX;

export async function enrollCallCircleParticipant(input: {
  groupId: string;
  memberId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<CallCircleParticipantRow> {
  const prisma = input.prisma ?? getPrisma();
  if (hasPrismaTransactionMethod(prisma)) {
    return await prisma.$transaction(async (tx) => enrollCallCircleParticipantInLockedGroup({
      groupId: input.groupId,
      memberId: input.memberId,
      now: input.now,
      prisma: tx,
    }));
  }
  return await enrollCallCircleParticipantInLockedGroup({
    groupId: input.groupId,
    memberId: input.memberId,
    now: input.now,
    prisma,
  });
}

export async function acceptCallCircleOfferEnrollment(input: {
  groupId: string;
  memberId: string;
  now: Date;
  offerPostedAt: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<CallCircleParticipantRow> {
  const prisma = input.prisma ?? getPrisma();
  if (hasPrismaTransactionMethod(prisma)) {
    return await prisma.$transaction(async (tx) => enrollCallCircleParticipantInLockedGroup({
      groupId: input.groupId,
      memberId: input.memberId,
      now: input.now,
      prisma: tx,
      resumePausedAfter: input.offerPostedAt,
    }));
  }
  return await enrollCallCircleParticipantInLockedGroup({
    groupId: input.groupId,
    memberId: input.memberId,
    now: input.now,
    prisma,
    resumePausedAfter: input.offerPostedAt,
  });
}

async function enrollCallCircleParticipantInLockedGroup(input: {
  groupId: string;
  memberId: string;
  now: Date;
  prisma: CallCirclePrismaClient;
  resumePausedAfter?: Date;
}): Promise<CallCircleParticipantRow> {
  const prisma = input.prisma;
  const existing = await prisma.hostedCallCircleParticipant.findUnique({
    where: {
      groupId_memberId: {
        groupId: input.groupId,
        memberId: input.memberId,
      },
    },
  });
  if (existing && !shouldResumePausedParticipant({
    offerPostedAt: input.resumePausedAfter,
    participant: existing,
  })) {
    return existing;
  }
  await lockHostedCallCircleParticipantGroup(prisma, input.groupId);
  const existingAfterLock = await prisma.hostedCallCircleParticipant.findUnique({
    where: {
      groupId_memberId: {
        groupId: input.groupId,
        memberId: input.memberId,
      },
    },
  });
  if (existingAfterLock) {
    const resumePausedAfter = input.resumePausedAfter;
    if (resumePausedAfter && shouldResumePausedParticipant({
      offerPostedAt: resumePausedAfter,
      participant: existingAfterLock,
    })) {
      const resumed = await prisma.hostedCallCircleParticipant.updateMany({
        data: {
          status: "enrolled",
          updatedAt: input.now,
        },
        where: {
          groupId: input.groupId,
          memberId: input.memberId,
          status: "paused",
          updatedAt: { lt: resumePausedAfter },
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
  offerPostedAt?: Date;
  participant: CallCircleParticipantRow;
}): boolean {
  return input.offerPostedAt !== undefined
    && input.participant.status === "paused"
    && input.participant.updatedAt.getTime() < input.offerPostedAt.getTime();
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
      timeZone: normalizeCallCircleTimeZone(preferences.timeZone),
    }];
  });
}

export async function readCallCircleParticipantTimeZones(input: {
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
      timeZones.set(participant.memberId, normalizeCallCircleTimeZone(preferences.timeZone));
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

function hasPrismaTransactionMethod(
  prisma: CallCirclePrismaClient,
): prisma is PrismaClient {
  return "$transaction" in prisma;
}

async function lockHostedCallCircleParticipantGroup(
  prisma: CallCirclePrismaClient,
  groupId: string,
): Promise<void> {
  await prisma.$queryRaw(Prisma.sql`
    SELECT 1
    FROM "hosted_group"
    WHERE "id" = ${groupId}
    FOR UPDATE
  `);
}
