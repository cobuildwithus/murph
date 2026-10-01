import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionConversationMessageWake,
  type HostedVoiceInputRequest,
} from "@murphai/hosted-execution";
import { requireHostedRuntimeOwnerTx, type HostedRuntimeIdentity } from "../hosted-execution/runtime-owner";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS, lockHostedMemberSponsoredAccessRows } from "../hosted-onboarding/shared";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { assertHostedHistoricalLaunchConsentGranted } from "../legal/consent";
import { appendHostedMailboxEnvelopeWithPreparedCryptoTx, runWithPreparedHostedMailboxItemAppendCrypto } from "./store";

/** Publish through the existing encrypted mailbox under the current runtime fence. */
export async function admitHostedVoiceInput(input: {
  identity: HostedRuntimeIdentity;
  prisma: PrismaClient;
  request: HostedVoiceInputRequest;
}): Promise<{ mailboxItemId: string }> {
  const { callId, inputId, occurredAt, text } = input.request;
  const userId = input.identity.userId;
  const envelope = buildHostedExecutionConversationMessageWake({
    eventId: `voice.input:${callId}:${inputId}`,
    message: { channel: "voice", callId, inputId, text },
    occurredAt,
    userId,
  });
  const appended = await runWithPreparedHostedMailboxItemAppendCrypto({
    prisma: input.prisma,
    userId,
    append: (prepared) => input.prisma.$transaction(async (tx) => {
      // This owner locks the member and exact attempt through publication.
      const owner = await requireHostedRuntimeOwnerTx(tx, input.identity);
      if (owner.processingMode !== "default" || !owner.platformAiUsageAllowed) {
        throw hostedOnboardingError({
          code: "HOSTED_VOICE_RUNTIME_UNAVAILABLE",
          httpStatus: 403,
          message: "This runtime cannot accept voice input.",
        });
      }
      await lockHostedMemberSponsoredAccessRows(tx, userId);
      await assertActiveHostedMemberAccessAllowed({ memberId: userId, prisma: tx });
      await assertHostedHistoricalLaunchConsentGranted({ memberId: userId, prisma: tx });
      const result = await appendHostedMailboxEnvelopeWithPreparedCryptoTx({ envelope, prepared, tx });
      if (result.dedupeConflict) {
        throw hostedOnboardingError({
          code: "HOSTED_VOICE_INPUT_CONFLICT",
          httpStatus: 409,
          message: "This voice input already has different content.",
        });
      }
      return result;
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS),
  });
  // Replays repeat this wake, so a lost post-commit response cannot strand work.
  await signalHostedMailboxAppendRuntime({
    expectedUserId: userId,
    knownCheckpoint: { lane: appended.item.lane, laneSeq: appended.item.laneSeq, userId },
    mailboxItemId: appended.item.id,
    prisma: input.prisma,
  });
  return { mailboxItemId: appended.item.id };
}
