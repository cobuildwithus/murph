import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  hostedCallCirclePreferencesSchema,
  normalizeHostedCallCircleMemberName,
  type HostedCallCirclePreferences,
  type HostedCallCirclePreferencesPatch,
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
  createHostedCallCircleMemberNameLookupKey,
  createHostedCallCircleMemberNameLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import {
  activeHostedMemberAccessWithParticipantsWhere,
} from "../hosted-onboarding/member-access";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import type {
  CallCircleParticipantRow,
  CallCirclePrismaClient,
} from "./types";
import { readNextCallCircleMatchingAt } from "./time";

export interface CallCircleDueParticipant {
  groupId: string;
  memberId: string;
  preferences: HostedCallCirclePreferences | null;
  storedPreferencesJson: Prisma.JsonValue;
}

export interface CallCircleEligibleParticipant extends CallCircleDueParticipant {
  preferences: HostedCallCirclePreferences;
}

export type CallCirclePreferenceWriteResult =
  | "updated"
  | "missing"
  | "incomplete"
  | "invalid_member_cadences";

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
  patch: HostedCallCirclePreferencesPatch;
  prisma: Prisma.TransactionClient;
}): Promise<CallCirclePreferenceWriteResult> {
  const prisma = input.prisma;
  await lockHostedMemberRow(prisma, input.memberId);
  const participant = await prisma.hostedCallCircleParticipant.findUnique({
    select: { preferencesJson: true },
    where: {
      groupId_memberId: {
        groupId: input.groupId,
        memberId: input.memberId,
      },
    },
  });
  if (!participant) return "missing";

  const current = participant.preferencesJson === null
    ? null
    : parseCallCirclePreferencesOrNull(participant.preferencesJson);
  if (participant.preferencesJson !== null && !current) return "incomplete";
  if (!current && (input.patch.timeZone === undefined || input.patch.windows === undefined)) {
    return "incomplete";
  }

  const memberCadenceUpdates = await resolveCallCircleMemberCadenceUpdates({
    groupId: input.groupId,
    selfMemberId: input.memberId,
    updates: input.patch.memberCadenceUpdates ?? [],
    prisma,
  });
  if (!memberCadenceUpdates) {
    return "invalid_member_cadences";
  }

  const memberCadences = new Map(
    (current?.memberCadences ?? []).map((entry) => [entry.memberId, entry.cadence]),
  );
  for (const update of memberCadenceUpdates) {
    if (update.cadence === "default") {
      memberCadences.delete(update.memberId);
    } else {
      memberCadences.set(update.memberId, update.cadence);
    }
  }
  const preferences = hostedCallCirclePreferencesSchema.parse({
    cadence: input.patch.cadence ?? current?.cadence,
    memberCadences: [...memberCadences]
      .sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0)
      .map(([memberId, cadence]) => ({ cadence, memberId })),
    timeZone: input.patch.timeZone ?? current?.timeZone,
    windows: input.patch.windows ?? current?.windows,
  });
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
  return result.count > 0 ? "updated" : "missing";
}

export async function refreshCallCircleParticipantMemberNameKey(input: {
  groupId: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
  selfMemberName: string | null | undefined;
}): Promise<void> {
  if (input.selfMemberName === undefined) return;
  await input.prisma.hostedCallCircleParticipant.updateMany({
    data: {
      memberNameKey: input.selfMemberName === null
        ? null
        : buildCallCircleMemberNameKey(input.groupId, input.selfMemberName),
    },
    where: {
      groupId: input.groupId,
      memberId: input.memberId,
    },
  });
}

async function resolveCallCircleMemberCadenceUpdates(input: {
  groupId: string;
  selfMemberId: string;
  updates: HostedCallCirclePreferencesPatch["memberCadenceUpdates"];
  prisma: Prisma.TransactionClient;
}): Promise<Array<{
  cadence: "weekly" | "biweekly" | "monthly" | "never" | "default";
  memberId: string;
}> | null> {
  const updates = input.updates ?? [];
  if (updates.length === 0) return [];
  const keyedUpdates = updates.map((update) => ({
    cadence: update.cadence,
    memberNameKeys: readCallCircleMemberNameKeyCandidates(
      input.groupId,
      update.memberName,
    ),
  }));
  const normalizedTargetKeys = keyedUpdates.map((update) => update.memberNameKeys.join("\0"));
  if (new Set(normalizedTargetKeys).size !== keyedUpdates.length) return null;
  const memberNameKeys = [...new Set(keyedUpdates.flatMap((update) => update.memberNameKeys))];

  const participants = await input.prisma.hostedCallCircleParticipant.findMany({
    select: {
      memberId: true,
      memberNameKey: true,
    },
    take: HOSTED_CALL_CIRCLE_PARTICIPANTS_MAX,
    where: {
      groupId: input.groupId,
      member: {
        ...activeHostedMemberAccessWithParticipantsWhere(),
        hostedGroupMemberships: {
          some: { groupId: input.groupId },
        },
      },
      memberNameKey: { in: memberNameKeys },
    },
  });
  const membersByNameKey = new Map<string, string[]>();
  for (const participant of participants) {
    if (!participant.memberNameKey) continue;
    const memberIds = membersByNameKey.get(participant.memberNameKey) ?? [];
    memberIds.push(participant.memberId);
    membersByNameKey.set(participant.memberNameKey, memberIds);
  }

  const resolved: Array<{
    cadence: "weekly" | "biweekly" | "monthly" | "never" | "default";
    memberId: string;
  }> = [];
  for (const update of keyedUpdates) {
    const memberIds = [...new Set(update.memberNameKeys.flatMap(
      (memberNameKey) => membersByNameKey.get(memberNameKey) ?? [],
    ))];
    if (memberIds.length !== 1 || memberIds[0] === input.selfMemberId) return null;
    const memberId = memberIds[0];
    if (!memberId) return null;
    resolved.push({ cadence: update.cadence, memberId });
  }
  return resolved;
}

function buildCallCircleMemberNameKey(groupId: string, memberName: string): string {
  const memberNameKey = createHostedCallCircleMemberNameLookupKey({
    groupId,
    normalizedMemberName: normalizeHostedCallCircleMemberName(memberName),
  });
  if (!memberNameKey) {
    throw new Error("Call Circle member name could not be indexed.");
  }
  return memberNameKey;
}

function readCallCircleMemberNameKeyCandidates(
  groupId: string,
  memberName: string,
): string[] {
  const candidates = createHostedCallCircleMemberNameLookupKeyReadCandidates({
    groupId,
    normalizedMemberName: normalizeHostedCallCircleMemberName(memberName),
  });
  if (candidates.length === 0) {
    throw new Error("Call Circle member name could not be indexed.");
  }
  return candidates;
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

export async function listCallCircleDueParticipants(input: {
  groupId: string;
  now: Date;
  prisma?: CallCirclePrismaClient;
}): Promise<CallCircleDueParticipant[]> {
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
      nextMatchingAt: { lte: input.now },
      preferencesJson: { not: Prisma.DbNull },
    },
  });

  return participants.flatMap((participant) => {
    const preferences = parseCallCirclePreferencesOrNull(participant.preferencesJson);
    if (participant.preferencesJson === null) return [];
    return [{
      groupId: participant.groupId,
      memberId: participant.memberId,
      preferences,
      storedPreferencesJson: participant.preferencesJson,
    }];
  });
}

export async function advanceCallCircleParticipantMatchingCursors(input: {
  now: Date;
  participants: readonly CallCircleDueParticipant[];
  prisma?: CallCirclePrismaClient;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();
  await Promise.all(input.participants.map(async (participant) => {
    await prisma.hostedCallCircleParticipant.updateMany({
      data: {
        nextMatchingAt: readNextCallCircleMatchingAt(input.now),
      },
      where: {
        groupId: participant.groupId,
        memberId: participant.memberId,
        nextMatchingAt: { lte: input.now },
        preferencesJson: { equals: toPrismaJsonValue(participant.storedPreferencesJson) },
        status: "enrolled",
      },
    });
  }));
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

export async function readActiveCallCircleParticipantPair(input: {
  groupId: string;
  memberAId: string;
  memberBId: string;
  prisma?: CallCirclePrismaClient;
}): Promise<{
  memberA: { memberId: string; preferences: HostedCallCirclePreferences };
  memberB: { memberId: string; preferences: HostedCallCirclePreferences };
} | null> {
  if (input.memberAId === input.memberBId) return null;
  const prisma = input.prisma ?? getPrisma();
  const participants = await prisma.hostedCallCircleParticipant.findMany({
    select: {
      memberId: true,
      preferencesJson: true,
    },
    take: 2,
    where: {
      ...activeCallCircleParticipantWhere({ groupId: input.groupId }),
      memberId: { in: [input.memberAId, input.memberBId] },
    },
  });
  if (participants.length !== 2) return null;
  const byMemberId = new Map(participants.map((participant) => [
    participant.memberId,
    participant.preferencesJson === null
      ? null
      : parseCallCirclePreferencesOrNull(participant.preferencesJson),
  ]));
  const memberAPreferences = byMemberId.get(input.memberAId);
  const memberBPreferences = byMemberId.get(input.memberBId);
  if (!memberAPreferences || !memberBPreferences) return null;
  return {
    memberA: {
      memberId: input.memberAId,
      preferences: memberAPreferences,
    },
    memberB: {
      memberId: input.memberBId,
      preferences: memberBPreferences,
    },
  };
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

function toPrismaJsonValue(value: Prisma.JsonValue): Prisma.InputJsonValue {
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
