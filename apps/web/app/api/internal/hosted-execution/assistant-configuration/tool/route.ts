import {
  parseHostedRuntimeAssistantConfigurationControlRequest,
} from "@murphai/hosted-execution/parsers";

import {
  handleHostedRuntimeAssistantConfigurationTool,
} from "@/src/lib/hosted-execution/assistant-configuration-tool";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readRawBodyBuffer } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 8 * 1_024;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: BODY_LIMIT_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
    payloadText,
  });
  const body = parseHostedRuntimeAssistantConfigurationControlRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );

  return jsonOk(await handleHostedRuntimeAssistantConfigurationTool({
    memberId,
    request: body,
  }));
});
