import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { requireHostedRuntimeCallbackTx } from "@/src/lib/hosted-execution/runtime-owner";
import { readHostedRuntimeCallbackAuthority } from "@/src/lib/hosted-execution/runtime-write-fence";
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
  lane: string;
  laneSeq: string;
  payloadInlineCiphertext?: string | null;
  payloadRef?: string | null;
  userId: string;
};

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    runtimeAuthority: "caller_transaction",
    maxBodyBytes: HOSTED_MAILBOX_PAYLOAD_FETCH_CALLBACK_BODY_LIMIT_BYTES,
  });
  const body = parseHostedMailboxPayloadFetchRequest(await readOptionalJsonObject(request));
  const authority = readHostedRuntimeCallbackAuthority(request);
  const response = await getPrisma().$transaction(async (tx) => {
    await requireHostedRuntimeCallbackTx(tx, userId, authority ? { ...authority, userId } : null);
    await requireHostedRuntimeMailboxActiveAccess(userId, {
      prisma: tx,
      code: "HOSTED_RUNTIME_MAILBOX_PAYLOAD_USER_INACTIVE",
      message: "Hosted runtime mailbox payload access is not active.",
    });
    const mailboxItem = await readHostedMailboxItemByDedupeKey({
      prisma: tx,
      dedupeKey: body.dedupeKey,
      userId,
    });
    const item = mailboxItem?.id === body.mailboxItemId ? mailboxItem : null;
    await requireHostedRuntimeMailboxPayloadAiUsageAccess({
      item,
      prisma: tx,
      userId,
    });
    return fetchHostedMailboxPayload({
      prisma: tx,
      item,
      ...("payloadRef" in body ? { payloadRef: body.payloadRef } : {}),
    });
  });

  return jsonOk(parseHostedMailboxPayloadFetchResponse(response));
});

async function requireHostedRuntimeMailboxPayloadAiUsageAccess(input: {
  item: HostedRuntimeMailboxPayloadAiUsageItem | null;
  prisma: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  if (
    !input.item
    || input.item.userId !== input.userId
    || input.item.lane !== "conversation"
  ) {
    return;
  }
  const consumedSeqByLane = await readHostedMailboxConsumedSeqByLane({
    prisma: input.prisma,
    lanes: [input.item.lane],
    userId: input.userId,
  });

  if (!hostedMailboxItemsRequireAiUsageAccess({
    consumedSeqByLane,
    items: [{
      consumedAt: input.item.consumedAt ?? null,
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
    prisma: input.prisma,
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
