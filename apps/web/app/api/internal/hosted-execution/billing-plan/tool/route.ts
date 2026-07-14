import {
  parseHostedRuntimeBillingPlanToolRequest,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  handleHostedRuntimeBillingPlanTool,
} from "@/src/lib/hosted-execution/billing-plan-tool";
import { readRawBodyBuffer } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 4_096;

export const maxDuration = 800;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: BODY_LIMIT_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
    payloadText,
  });
  const body = parseHostedRuntimeBillingPlanToolRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );

  return jsonOk(await handleHostedRuntimeBillingPlanTool({
    memberId,
    request: body,
  }));
});
