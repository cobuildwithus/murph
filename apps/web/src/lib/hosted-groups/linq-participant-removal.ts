import "server-only";

import type { Prisma } from "@prisma/client";

import { cancelOpenCallCircleMatchesForParticipant } from "../call-circle/match-store";
import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import {
  lockHostedGroupRow,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import { readHostedThreadRouteByThreadIdentity } from "../hosted-routing/thread-route-store";

export async function applyHostedLinqParticipantRemovalTx(input: {
  chatId: string;
  handle: string;
  removedAt: Date;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const route = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.tx,
    threadId: input.chatId,
  });
  if (!route) {
    return false;
  }

  const group = await input.tx.hostedGroup.findUnique({
    where: { runtimeMemberId: route.containerMemberId },
    select: { id: true, runtimeMemberId: true },
  });
  if (!group?.runtimeMemberId) {
    return false;
  }

  const memberId = await lookupHostedParticipantMemberId({
    handle: input.handle,
    prisma: input.tx,
  });
  if (!memberId) {
    return false;
  }

  await lockHostedGroupRow(input.tx, group.id);
  await lockHostedMemberRow(input.tx, memberId);

  const currentGroup = await input.tx.hostedGroup.findUnique({
    where: { id: group.id },
    select: { id: true, runtimeMemberId: true },
  });
  const currentMemberId = await lookupHostedParticipantMemberId({
    handle: input.handle,
    prisma: input.tx,
  });
  if (
    currentGroup?.runtimeMemberId !== route.containerMemberId
    || currentMemberId !== memberId
  ) {
    return false;
  }

  await input.tx.hostedGroupMember.deleteMany({
    where: {
      groupId: group.id,
      memberId,
    },
  });
  await input.tx.hostedThreadContainerParticipant.updateMany({
    data: { removedAt: input.removedAt },
    where: {
      containerMemberId: route.containerMemberId,
      participantMemberId: memberId,
      removedAt: null,
    },
  });
  await cancelOpenCallCircleMatchesForParticipant({
    groupId: group.id,
    memberId,
    now: input.removedAt,
    prisma: input.tx,
  });
  await input.tx.hostedCallCircleParticipant.deleteMany({
    where: {
      groupId: group.id,
      memberId,
    },
  });

  return true;
}

async function lookupHostedParticipantMemberId(input: {
  handle: string;
  prisma: Prisma.TransactionClient;
}): Promise<string | null> {
  if (input.handle.includes("@")) {
    return (await lookupHostedMemberByVerifiedEmailAddress({
      address: input.handle,
      prisma: input.prisma,
    }))?.core.id ?? null;
  }

  const phoneNumber = normalizePhoneNumber(input.handle);
  if (!phoneNumber) {
    return null;
  }

  return (await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber,
    prisma: input.prisma,
  }))?.core.id ?? null;
}
