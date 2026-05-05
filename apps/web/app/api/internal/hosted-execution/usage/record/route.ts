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
    accountAllowance: true,
    trustedUserId: userId,
    usage,
  });

  const testDelayMs = Number.parseInt(
    process.env.MURPH_E2E_HOSTED_USAGE_RECORD_DELAY_MS ?? "",
    10,
  );
  if (Number.isFinite(testDelayMs) && testDelayMs > 0) {
    // Test-only hook used by hosted-local e2e to widen the post-send finalize window.
    await new Promise((resolve) => setTimeout(resolve, testDelayMs));
  }

  return jsonOk({
    recorded: result.recordedIds.length,
    usageIds: result.recordedIds,
  });
});
