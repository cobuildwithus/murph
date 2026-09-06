import {
  recordHostedAiUsageRecordsAndSendLimitNotices,
} from "@/src/lib/hosted-execution/usage";
import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { parseHostedRuntimeUsageRecordRequest } from "@murphai/hosted-execution/parsers";
import { HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES } from "@murphai/hosted-execution/runtime-control";

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
    trustedUserId: userId,
    usage: [usage],
  });
  if (result.platformAiUsageAllowedAfter === null) {
    throw new TypeError("Hosted usage recording did not settle the managed AI allowance.");
  }

  return jsonOk({
    platformAiUsageAllowedAfter: result.platformAiUsageAllowedAfter,
    recorded: result.recordedIds.includes(usage.usageId),
    usageId: usage.usageId,
  });
});
