import {
  parseHostedPlanUsageToolRequest,
} from "@murphai/hosted-execution/plan-usage";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedPersonalAiUsageStatus,
} from "@/src/lib/hosted-execution/usage-status";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 512;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
  });
  parseHostedPlanUsageToolRequest(payload);

  return jsonOk(await readHostedPersonalAiUsageStatus({ memberId }));
});
