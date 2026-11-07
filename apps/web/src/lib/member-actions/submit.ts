import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { MemberActionRequestV1 } from "@murphai/contracts";
import {
  buildHostedExecutionMemberActionRequestedWake,
} from "@murphai/hosted-execution";

import {
  appendHostedMailboxEnvelopeWithPreparedCryptoTx,
  runWithPreparedHostedMailboxItemAppendCrypto,
} from "../hosted-mailbox/store";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows,
} from "../hosted-onboarding/shared";
import { assertHostedHistoricalLaunchConsentGranted } from "../legal/consent";
import { createHostedPostCommitDeadline, waitForHostedPostCommitOperation } from "../hosted-onboarding/bounded-post-commit";

export interface SubmitMemberActionResult {
  accepted: true;
  actionId: string;
  dedupeConflict: boolean;
  duplicate: boolean;
  schemaVersion: 1;
}

export async function submitMemberAction(input: {
  memberId: string;
  prisma: PrismaClient;
  request: MemberActionRequestV1;
  assertCurrentAuthorityTx?: (tx: Prisma.TransactionClient) => Promise<void>;
}): Promise<SubmitMemberActionResult> {
  const appended = await runWithPreparedHostedMailboxItemAppendCrypto({
    append: (prepared) =>
      input.prisma.$transaction(async (tx) => {
        await lockHostedMemberRow(tx, input.memberId);
        await lockHostedMemberSponsoredAccessRows(tx, input.memberId);
        await input.assertCurrentAuthorityTx?.(tx);
        await assertActiveHostedMemberAccessAllowed({
          memberId: input.memberId,
          prisma: tx,
        });
        await assertHostedHistoricalLaunchConsentGranted({
          memberId: input.memberId,
          prisma: tx,
        });

        return appendHostedMailboxEnvelopeWithPreparedCryptoTx({
          envelope: buildHostedExecutionMemberActionRequestedWake({
            eventId: `member.action.requested:${input.request.actionId}`,
            memberId: input.memberId,
            occurredAt: input.request.requestedAt,
            request: input.request,
          }),
          prepared,
          tx,
        });
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS),
    prisma: input.prisma,
    userId: input.memberId,
  });

  if (!appended.dedupeConflict) {
    try {
      await waitForHostedPostCommitOperation({
        deadlineMs: createHostedPostCommitDeadline(undefined),
        operation: abortSignal => signalHostedMailboxAppendRuntime({
          abortSignal,
          expectedUserId: input.memberId,
          knownCheckpoint: {
            lane: appended.item.lane,
            laneSeq: appended.item.laneSeq,
            userId: input.memberId,
          },
          mailboxItemId: appended.item.id,
          prisma: input.prisma,
        }),
      });
    } catch {
      // Durable acceptance stands; the existing mailbox handoff sweeper retries.
    }
  }

  return {
    accepted: true,
    actionId: input.request.actionId,
    dedupeConflict: appended.dedupeConflict,
    duplicate: appended.duplicate,
    schemaVersion: 1,
  };
}
