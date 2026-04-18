import type { Prisma } from "@prisma/client";
import {
  buildHostedExecutionMemberChannelsUpdatedDispatch,
  type HostedExecutionDispatchRequest,
  type HostedExecutionMemberChannels,
} from "@murphai/hosted-execution";

import { getPrisma } from "../prisma";
import { appendHostedExecutionWakeTx } from "../hosted-execution/dispatch-lifecycle";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberEmailAuthorization,
  readHostedMemberSnapshot,
  type HostedMemberSnapshot,
} from "./hosted-member-store";
import { resolveHostedMemberChannels } from "./messaging-state";
import {
  extractHostedPrivyVerifiedEmailAccount,
  type PrivyLinkedAccountLike,
} from "./privy-shared";
import { lockHostedMemberRow } from "./shared";

export function resolveHostedMemberChannelsForSnapshot(input: {
  emailLinked: boolean;
  member: HostedMemberSnapshot;
}): HostedExecutionMemberChannels {
  return resolveHostedMemberChannels({
    emailLinked: input.emailLinked,
    identity: {
      phoneLookupKey: input.member.identity?.phoneLookupKey ?? null,
    },
    routing: {
      telegramUserId: input.member.routing?.telegramUserId ?? null,
    },
  });
}

export async function enqueueHostedMemberChannelsUpdatedTx(input: {
  emailLinked: boolean;
  memberId: string;
  occurredAt: string;
  prisma: Prisma.TransactionClient;
  sourceType: string;
}): Promise<HostedExecutionDispatchRequest> {
  await lockHostedMemberRow(input.prisma, input.memberId);

  const member = await readHostedMemberSnapshot({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      message: "Finish signup from your latest Murph link before continuing.",
      httpStatus: 403,
    });
  }

  const memberChannels = resolveHostedMemberChannelsForSnapshot({
    emailLinked: input.emailLinked,
    member,
  });
  const dispatch = buildHostedExecutionMemberChannelsUpdatedDispatch({
    eventId: buildHostedMemberChannelsUpdatedEventId({
      memberId: input.memberId,
      occurredAt: input.occurredAt,
      sourceType: input.sourceType,
    }),
    memberChannels,
    memberId: input.memberId,
    occurredAt: input.occurredAt,
  });

  await appendHostedExecutionWakeTx({
    dispatch,
    sourceId: dispatch.eventId,
    sourceType: input.sourceType,
    tx: input.prisma,
  });

  return dispatch;
}

export async function resolveHostedMemberEmailLinked(input: {
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
  memberId: string;
}): Promise<boolean> {
  if (extractHostedPrivyVerifiedEmailAccount(input.linkedAccounts ?? []) !== null) {
    return true;
  }

  const emailAuthorization = await readHostedMemberEmailAuthorization({
    memberId: input.memberId,
    prisma: getPrisma(),
  });

  return Boolean(emailAuthorization?.verifiedEmail);
}

export function buildHostedMemberChannelsUpdatedEventId(input: {
  memberId: string;
  occurredAt: string;
  sourceType: string;
}): string {
  return [
    "member.channels.updated",
    input.sourceType,
    input.memberId,
    input.occurredAt,
  ].join(":");
}
