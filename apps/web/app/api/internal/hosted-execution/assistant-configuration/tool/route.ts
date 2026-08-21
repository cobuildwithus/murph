import {
  parseHostedRuntimeAssistantConfigurationWebControlRequest,
} from "@murphai/hosted-execution/parsers";

import {
  handleHostedRuntimeAssistantConfigurationTool,
} from "@/src/lib/hosted-execution/assistant-configuration-tool";
import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 8 * 1_024;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
  });
  const body = parseHostedRuntimeAssistantConfigurationWebControlRequest(payload);

  return jsonOk(await handleHostedRuntimeAssistantConfigurationTool({
    memberId,
    request: body,
  }));
});
