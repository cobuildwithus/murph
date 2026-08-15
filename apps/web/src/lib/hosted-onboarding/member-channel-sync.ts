import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionMemberChannelsUpdatedWake,
  type HostedExecutionMemberChannels,
} from "@murphai/hosted-execution";

import { getPrisma } from "../prisma";
import {
  appendHostedMailboxEnvelopeTx,
  appendPreparedHostedMailboxEnvelopeTx,
  prepareHostedMailboxEnvelopeAppend,
  type PreparedHostedMailboxEnvelopeAppend,
} from "../hosted-mailbox/store";
import { hostedOnboardingError } from "./errors";
import { readActiveHostedMemberAccess } from "./member-access";
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

type HostedMemberEmailLinkedClient = PrismaClient | Prisma.TransactionClient;

export interface HostedMailboxAppendDispatch {
  mailboxItemId: string;
}

export async function prepareHostedMemberChannelsUpdatedForSnapshot(input: {
  emailLinked: boolean;
  member: HostedMemberSnapshot;
  memberId: string;
  occurredAt: string;
  prisma: PrismaClient;
  sourceType: string;
}): Promise<PreparedHostedMailboxEnvelopeAppend> {
  const memberChannels = resolveHostedMemberChannelsForSnapshot({
    emailLinked: input.emailLinked,
    member: input.member,
  });
  return prepareHostedMailboxEnvelopeAppend({
    envelope: buildHostedExecutionMemberChannelsUpdatedWake({
      eventId: buildHostedMemberChannelsUpdatedEventId(input),
      memberChannels,
      memberId: input.memberId,
      occurredAt: input.occurredAt,
    }),
    prisma: input.prisma,
  });
}

export async function commitPreparedHostedMemberChannelsUpdatedTx(input: {
  prepared: PreparedHostedMailboxEnvelopeAppend;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMailboxAppendDispatch> {
  return appendPreparedHostedMailboxEnvelopeTx({
    prepared: input.prepared,
    tx: input.prisma,
  });
}

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
      linqChatId: input.member.routing?.linqChatId ?? null,
      pendingLinqChatId: input.member.routing?.pendingLinqChatId ?? null,
      pendingLinqParticipantContact:
        input.member.routing?.pendingLinqParticipantContact ?? null,
      telegramThreadId: input.member.routing?.telegramThreadId ?? null,
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
}): Promise<HostedMailboxAppendDispatch> {
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

  return appendHostedMemberChannelsUpdatedForSnapshotTx({
    emailLinked: input.emailLinked,
    member,
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    prisma: input.prisma,
    sourceType: input.sourceType,
  });
}

async function appendHostedMemberChannelsUpdatedForSnapshotTx(input: {
  emailLinked: boolean;
  member: HostedMemberSnapshot;
  memberId: string;
  occurredAt: string;
  prisma: Prisma.TransactionClient;
  sourceType: string;
}): Promise<HostedMailboxAppendDispatch> {
  const memberChannels = resolveHostedMemberChannelsForSnapshot({
    emailLinked: input.emailLinked,
    member: input.member,
  });
  const wake = buildHostedExecutionMemberChannelsUpdatedWake({
    eventId: buildHostedMemberChannelsUpdatedEventId({
      memberId: input.memberId,
      occurredAt: input.occurredAt,
      sourceType: input.sourceType,
    }),
    memberChannels,
    memberId: input.memberId,
    occurredAt: input.occurredAt,
  });

  const append = await appendHostedMailboxEnvelopeTx({
    envelope: wake,
    tx: input.prisma,
  });

  return {
    mailboxItemId: append.item.id,
  };
}

export async function enqueueHostedMemberChannelsUpdatedForActiveMemberTx(input: {
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
  memberId: string;
  occurredAt: string;
  prisma: Prisma.TransactionClient;
  sourceType: string;
}): Promise<HostedMailboxAppendDispatch | null> {
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

  if (!await readActiveHostedMemberAccess({
    memberId: member.core.id,
    prisma: input.prisma,
  })) {
    return null;
  }

  const emailLinked = await resolveHostedMemberEmailLinked({
    linkedAccounts: input.linkedAccounts,
    memberId: input.memberId,
    prisma: input.prisma,
  });
  return appendHostedMemberChannelsUpdatedForSnapshotTx({
    emailLinked,
    member,
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    prisma: input.prisma,
    sourceType: input.sourceType,
  });
}

export async function resolveHostedMemberEmailLinked(input: {
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
  memberId: string;
  prisma?: HostedMemberEmailLinkedClient;
}): Promise<boolean> {
  if (extractHostedPrivyVerifiedEmailAccount(input.linkedAccounts ?? []) !== null) {
    return true;
  }

  const emailAuthorization = await readHostedMemberEmailAuthorization({
    memberId: input.memberId,
    prisma: input.prisma ?? getPrisma(),
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
