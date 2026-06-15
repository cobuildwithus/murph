import {
  recordHostedAiUsageRecordsAndSendLimitNotices,
} from "@/src/lib/hosted-execution/usage";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
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

  const usage = body.usage;
  const result = await recordHostedAiUsageRecordsAndSendLimitNotices({
    accountAllowance: true,
    trustedUserId: userId,
    usage: [usage],
  });

  return jsonOk({
    recorded: result.recordedIds.includes(usage.usageId),
    usageId: usage.usageId,
  });
});
