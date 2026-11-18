import { parseInput } from "@murphai/hosted-execution/request-input";
import { HOSTED_RUNTIME_FAMILY_PLAN_INVITE_IDS_PARAM } from "@murphai/hosted-execution/runtime-control";
import {
  parseHostedRuntimeFamilyPlanToolRequest,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  handleHostedRuntimeFamilyPlanTool,
} from "@/src/lib/hosted-execution/family-plan-tool";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 16_384;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
  });
  const body = parseInput(payload, parseHostedRuntimeFamilyPlanToolRequest);

  return jsonOk(await handleHostedRuntimeFamilyPlanTool({
    includeInviteIds: new URL(request.url).searchParams.get(HOSTED_RUNTIME_FAMILY_PLAN_INVITE_IDS_PARAM) === "1",
    memberId,
    request: body,
  }));
});
