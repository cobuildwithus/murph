import {
  parseHostedMailboxPayloadFetchRequest,
  parseHostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  fetchHostedMailboxPayload,
  readHostedMailboxConsumedSeqByLane,
  readHostedMailboxItemByDedupeKey,
} from "@/src/lib/hosted-mailbox/store";
import {
  requireHostedMailboxReplayPayloadTarget,
} from "@/src/lib/hosted-mailbox/replay-authority";
import {
  hostedMailboxItemsRequireAiUsageAccess,
} from "@/src/lib/hosted-mailbox/ai-usage-gate";
import {
  requireHostedRuntimeActiveAccess,
} from "@/src/lib/hosted-mailbox/runtime-access";
import {
  resolveHostedRuntimeAiUsageGate,
} from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";

const HOSTED_MAILBOX_PAYLOAD_FETCH_CALLBACK_BODY_LIMIT_BYTES = 16 * 1024;

type HostedRuntimeMailboxPayloadAiUsageItem = {
  acceptedAllowancePeriodStart?: string | null;
  consumedAt?: string | null;
  kind: string;
  lane: string;
  laneSeq: string;
  payloadInlineCiphertext?: string | null;
  payloadRef?: string | null;
  userId: string;
};

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_MAILBOX_PAYLOAD_FETCH_CALLBACK_BODY_LIMIT_BYTES,
  });
  const body = parseHostedMailboxPayloadFetchRequest(await readOptionalJsonObject(request));
  const replayAuthority = body.replayAuthority ?? null;
  if (!replayAuthority) {
    await requireHostedRuntimeActiveAccess(userId, {
      code: "HOSTED_RUNTIME_MAILBOX_PAYLOAD_USER_INACTIVE",
      message: "Hosted runtime mailbox payload access is not active.",
    });
  }
  const mailboxItem = await readHostedMailboxItemByDedupeKey({
    dedupeKey: body.dedupeKey,
    userId,
  });
  const matchedMailboxItem = mailboxItem?.id === body.mailboxItemId
    ? mailboxItem
    : null;
  if (replayAuthority) {
    await requireHostedMailboxReplayPayloadTarget({
      authority: replayAuthority,
      item: matchedMailboxItem,
      userId,
    });
  }
  await requireHostedRuntimeMailboxPayloadAiUsageAccess({
    item: matchedMailboxItem,
    replayAuthority,
    userId,
  });
  const response = await fetchHostedMailboxPayload({
    dedupeKey: body.dedupeKey,
    mailboxItemId: body.mailboxItemId,
    ...("payloadRef" in body ? { payloadRef: body.payloadRef } : {}),
    requestId: body.requestId,
    userId,
  });

  return jsonOk(parseHostedMailboxPayloadFetchResponse(response));
});

async function requireHostedRuntimeMailboxPayloadAiUsageAccess(input: {
  item: HostedRuntimeMailboxPayloadAiUsageItem | null;
  replayAuthority?: NonNullable<ReturnType<typeof parseHostedMailboxPayloadFetchRequest>["replayAuthority"]> | null;
  userId: string;
}): Promise<void> {
  if (
    !input.item
    || input.item.userId !== input.userId
  ) {
    return;
  }
  const consumedSeqByLane = await readHostedMailboxConsumedSeqByLane({
    lanes: [input.item.lane],
    userId: input.userId,
  });

  if (!hostedMailboxItemsRequireAiUsageAccess({
    consumedSeqByLane,
    items: [{
      consumedAt: input.item.consumedAt ?? null,
      kind: input.item.kind,
      lane: input.item.lane,
      laneSeq: input.item.laneSeq,
      payloadInlineCiphertext: input.item.payloadInlineCiphertext ?? null,
      payloadRef: input.item.payloadRef ?? null,
    }],
    lanes: [
      {
        importedSeq: "0",
        lane: input.item.lane,
      },
    ],
  })) {
    return;
  }
  const replayPeriodStart = input.replayAuthority
    ? input.item.acceptedAllowancePeriodStart ?? null
    : null;
  if (input.replayAuthority && replayPeriodStart === null) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_MAILBOX_REPLAY_AUTHORITY_INVALID",
      httpStatus: 403,
      message: "Hosted runtime mailbox replay authority is invalid.",
    });
  }
  const gate = await resolveHostedRuntimeAiUsageGate({
    ...(input.replayAuthority && replayPeriodStart !== null
      ? {
          access: "accepted_conversation" as const,
          acceptedConversationPeriodStart: replayPeriodStart,
        }
      : {}),
    mode: "read_first",
    userId: input.userId,
  });

  if (gate.status === "allowed") {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_RUNTIME_MAILBOX_PAYLOAD_AI_USAGE_DENIED",
    httpStatus: 403,
    message: "Hosted runtime mailbox payload AI usage is denied.",
  });
}
