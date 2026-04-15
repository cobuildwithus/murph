import type { Prisma } from "@prisma/client";
import {
  buildHostedExecutionMemberChannelsUpdatedDispatch,
  type HostedExecutionDispatchRequest,
  type HostedExecutionMemberChannels,
} from "@murphai/hosted-execution";

import { hasHostedVerifiedEmailUserEnv } from "../hosted-execution/control";
import { enqueueHostedExecutionOutbox } from "../hosted-execution/outbox";
import { hostedOnboardingError } from "./errors";
import {
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

  await enqueueHostedExecutionOutbox({
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
  onUnconfirmed: "disable" | "retry";
}): Promise<boolean> {
  if (extractHostedPrivyVerifiedEmailAccount(input.linkedAccounts ?? []) !== null) {
    return true;
  }

  const emailLinked = await hasHostedVerifiedEmailUserEnv(input.memberId);

  if (emailLinked === null) {
    if (input.onUnconfirmed === "disable") {
      return false;
    }

    throw hostedOnboardingError({
      code: "HOSTED_EMAIL_SYNC_STATUS_UNAVAILABLE",
      message:
        "We could not confirm your hosted email status yet. Wait a moment and try again so channel sync stays consistent.",
      httpStatus: 409,
      retryable: true,
    });
  }

  return emailLinked;
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
