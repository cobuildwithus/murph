import {
  parseHostedPlanUsageToolRequest,
} from "@murphai/hosted-execution/plan-usage";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedPersonalAiUsageStatus,
} from "@/src/lib/hosted-execution/usage-status";
import { readRawBodyBuffer } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 512;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: BODY_LIMIT_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
    payloadText,
  });
  parseHostedPlanUsageToolRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );

  return jsonOk(await readHostedPersonalAiUsageStatus({ memberId }));
});
