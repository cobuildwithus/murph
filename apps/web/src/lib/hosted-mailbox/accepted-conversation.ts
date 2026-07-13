import {
  preserveHostedAcceptedConversationAllowancePeriodTx,
} from "../hosted-execution/usage-allowance";
import {
  appendHostedMailboxEnvelopeTx,
  type AppendHostedMailboxItemResult,
  type HostedMailboxMutationTx,
  type HostedMailboxProducerEnvelope,
} from "./store";

export async function appendHostedAcceptedConversationEnvelopeTx(input: {
  envelope: HostedMailboxProducerEnvelope;
  tx: HostedMailboxMutationTx;
}): Promise<AppendHostedMailboxItemResult> {
  if (input.envelope.kind !== "conversation.message") {
    throw new TypeError("Hosted accepted conversation append requires a conversation envelope.");
  }
  const append = await appendHostedMailboxEnvelopeTx(input);
  const existingBinding = await input.tx.hostedMailboxItem.findUnique({
    select: {
      acceptedAllowancePeriodStart: true,
    },
    where: {
      id: append.item.id,
    },
  });
  if (existingBinding?.acceptedAllowancePeriodStart) {
    return append;
  }

  const periodStart = await preserveHostedAcceptedConversationAllowancePeriodTx({
    acceptedAt: append.item.createdAt,
    allowUniqueExistingPeriod: !append.inserted,
    memberId: input.envelope.userId,
    tx: input.tx,
  });
  const bound = await input.tx.hostedMailboxItem.updateMany({
    data: {
      acceptedAllowancePeriodStart: periodStart,
    },
    where: {
      acceptedAllowancePeriodStart: null,
      id: append.item.id,
      kind: "conversation.message",
      userId: input.envelope.userId,
    },
  });
  if (bound.count !== 1) {
    throw new Error("Hosted accepted conversation allowance period binding failed.");
  }
  return append;
}
