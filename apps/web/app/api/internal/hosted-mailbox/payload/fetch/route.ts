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
  hostedMailboxItemsRequireAiUsageAccess,
} from "@/src/lib/hosted-mailbox/ai-usage-gate";
import {
  requireHostedRuntimeMailboxActiveAccess,
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
  await requireHostedRuntimeMailboxActiveAccess(userId, {
    code: "HOSTED_RUNTIME_MAILBOX_PAYLOAD_USER_INACTIVE",
    message: "Hosted runtime mailbox payload access is not active.",
  });
  const body = parseHostedMailboxPayloadFetchRequest(await readOptionalJsonObject(request));
  const mailboxItem = await readHostedMailboxItemByDedupeKey({
    dedupeKey: body.dedupeKey,
    userId,
  });
  await requireHostedRuntimeMailboxPayloadAiUsageAccess({
    item: mailboxItem?.id === body.mailboxItemId ? mailboxItem : null,
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

  const gate = await resolveHostedRuntimeAiUsageGate({
    mode: "read_first",
    userId: input.userId,
  });

  if (gate.status === "allowed") {
    return;
  }

  if (gate.status === "unavailable") {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_MAILBOX_PAYLOAD_AI_USAGE_GATE_UNAVAILABLE",
      details: {
        statusCode: 503,
      },
      httpStatus: 503,
      message: "Hosted runtime mailbox payload AI usage gate is unavailable.",
      retryable: true,
    });
  }

  throw hostedOnboardingError({
    code: "HOSTED_RUNTIME_MAILBOX_PAYLOAD_AI_USAGE_DENIED",
    httpStatus: 403,
    message: "Hosted runtime mailbox payload AI usage is denied.",
  });
}
