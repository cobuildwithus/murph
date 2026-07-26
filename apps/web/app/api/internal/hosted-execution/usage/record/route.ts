import {
  recordHostedAiUsageRecordsAndSendLimitNotices,
} from "@/src/lib/hosted-execution/usage";
import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { parseHostedRuntimeUsageRecordRequest } from "@murphai/hosted-execution/parsers";

const HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES = 16_384;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES,
  });
  const body = parseHostedRuntimeUsageRecordRequest(payload);

  const usage = body.usage;
  const result = await recordHostedAiUsageRecordsAndSendLimitNotices({
    accountAllowance: true,
    ...(body.noticeDeliveryTarget === undefined
      ? {}
      : { noticeDeliveryTarget: body.noticeDeliveryTarget }),
    ...(body.reservationId === undefined
      ? {}
      : { reservationId: body.reservationId }),
    trustedUserId: userId,
    usage: [usage],
  });

  return jsonOk({
    recorded: result.recordedIds.includes(usage.usageId),
    usageId: usage.usageId,
  });
});
