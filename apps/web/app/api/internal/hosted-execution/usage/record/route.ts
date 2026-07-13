import {
  recordHostedAiUsageRecordsAndSendLimitNotices,
} from "@/src/lib/hosted-execution/usage";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedMailboxItemByLaneSeq,
} from "@/src/lib/hosted-mailbox/store";
import { readRawBodyBuffer } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { parseHostedRuntimeUsageRecordRequest } from "@murphai/hosted-execution/parsers";

const HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES = 16_384;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES,
  })).toString("utf8");
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES,
    payloadText,
  });
  const body = parseHostedRuntimeUsageRecordRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );
  if (body.processingMode === "conversation_replay_usage_limit") {
    throw new TypeError("Usage-limit replay cannot record provider usage.");
  }
  if (
    body.processingMode !== "conversation_replay"
    && (body.acceptedConversationAt || body.acceptedConversationSeq)
  ) {
    throw new TypeError("Accepted conversation authority requires conversation replay mode.");
  }

  const usage = body.usage;
  const acceptedConversationPeriodStart = body.processingMode === "conversation_replay"
    ? await requireAcceptedConversationPeriodStart({
        acceptedConversationAt: body.acceptedConversationAt,
        acceptedConversationSeq: body.acceptedConversationSeq,
        userId,
      })
    : null;
  const result = await recordHostedAiUsageRecordsAndSendLimitNotices({
    ...(acceptedConversationPeriodStart
      ? {
          acceptedConversation: true,
          acceptedConversationPeriodStart,
        }
      : {}),
    accountAllowance: true,
    ...(body.noticeDeliveryTarget === undefined
      ? {}
      : { noticeDeliveryTarget: body.noticeDeliveryTarget }),
    trustedUserId: userId,
    usage: [usage],
  });

  return jsonOk({
    recorded: result.recordedIds.includes(usage.usageId),
    usageId: usage.usageId,
  });
});

async function requireAcceptedConversationPeriodStart(input: {
  acceptedConversationAt: string | null | undefined;
  acceptedConversationSeq: string | null | undefined;
  userId: string;
}): Promise<Date> {
  if (!input.acceptedConversationAt || !input.acceptedConversationSeq) {
    throw new TypeError("Conversation replay usage requires its accepted conversation authority.");
  }
  const item = await readHostedMailboxItemByLaneSeq({
    lane: "conversation",
    laneSeq: input.acceptedConversationSeq,
    userId: input.userId,
  });
  if (
    item?.kind !== "conversation.message"
    || item.createdAt !== input.acceptedConversationAt
    || !item.acceptedAllowancePeriodStart
  ) {
    throw new TypeError("Conversation replay usage authority does not match an accepted mailbox row.");
  }
  return new Date(item.acceptedAllowancePeriodStart);
}
