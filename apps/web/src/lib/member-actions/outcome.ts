import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  type MemberActionOutcomeV1,
  type MemberActionStatusV1,
  parseMemberActionOutcomeV1,
} from "@murphai/contracts";
import { buildHostedExecutionMemberActionCompletedWake } from "@murphai/hosted-execution";

import {
  appendHostedMailboxEnvelopeWithPreparedCryptoTx,
  readHostedMailboxWakeByDedupeKey,
  runWithPreparedHostedMailboxItemAppendCrypto,
} from "../hosted-mailbox/store";

const MEMBER_ACTION_COMPLETED_EVENT_PREFIX = "member.action.completed:";

export interface RecordMemberActionOutcomeResult {
  dedupeConflict: boolean;
  duplicate: boolean;
  recorded: true;
  schemaVersion: 1;
}

export function memberActionCompletedEventId(actionId: string): string {
  return `${MEMBER_ACTION_COMPLETED_EVENT_PREFIX}${actionId}`;
}

export async function recordMemberActionOutcome(input: {
  memberId: string;
  outcome: MemberActionOutcomeV1;
  prisma: PrismaClient;
}): Promise<RecordMemberActionOutcomeResult> {
  const outcome = parseMemberActionOutcomeV1(input.outcome);
  const eventId = memberActionCompletedEventId(outcome.actionId);
  const appended = await runWithPreparedHostedMailboxItemAppendCrypto({
    append: (prepared) =>
      input.prisma.$transaction((tx) =>
        appendHostedMailboxEnvelopeWithPreparedCryptoTx({
          envelope: buildHostedExecutionMemberActionCompletedWake({
            eventId,
            memberId: input.memberId,
            occurredAt: outcome.completedAt,
            outcome,
          }),
          prepared,
          tx,
        })
      ),
    prisma: input.prisma,
    userId: input.memberId,
  });

  return {
    dedupeConflict: appended.dedupeConflict,
    duplicate: appended.duplicate,
    recorded: true,
    schemaVersion: 1,
  };
}

export async function readMemberActionStatus(input: {
  actionId: string;
  memberId: string;
  prisma: PrismaClient;
}): Promise<MemberActionStatusV1> {
  const wake = await readHostedMailboxWakeByDedupeKey({
    dedupeKey: memberActionCompletedEventId(input.actionId),
    prisma: input.prisma,
    userId: input.memberId,
  });

  if (!wake) {
    return {
      actionId: input.actionId,
      schemaVersion: 1,
      status: "pending",
    };
  }
  if (
    wake.kind !== "member.action.completed"
    || wake.outcome.actionId !== input.actionId
  ) {
    throw new TypeError("Member action outcome identity does not match its mailbox key.");
  }

  return parseMemberActionOutcomeV1(wake.outcome);
}
