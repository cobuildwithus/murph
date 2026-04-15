import { importHostedAiUsageRecords } from "@/src/lib/hosted-execution/usage";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = await readOptionalJsonObject(request);
  if (!Array.isArray(body.usage)) {
    throw new TypeError("usage must be an array.");
  }

  const usage = body.usage;
  const result = await importHostedAiUsageRecords({
    trustedUserId: userId,
    usage,
  });

  return jsonOk({
    recorded: result.recordedIds.length,
    usageIds: result.recordedIds,
  });
});
