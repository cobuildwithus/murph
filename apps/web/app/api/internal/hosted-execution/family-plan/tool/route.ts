import {
  parseHostedRuntimeFamilyPlanToolRequest,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  handleHostedRuntimeFamilyPlanTool,
  projectHostedRuntimeFamilyPlanToolResponseForContract,
} from "@/src/lib/hosted-execution/family-plan-tool";
import { readRawBodyBuffer } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 16_384;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: BODY_LIMIT_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
    payloadText,
  });
  const body = parseHostedRuntimeFamilyPlanToolRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );

  const response = await handleHostedRuntimeFamilyPlanTool({
    memberId,
    request: body,
  });
  return jsonOk(projectHostedRuntimeFamilyPlanToolResponseForContract(
    response,
    body.contractVersion,
  ));
});
