import {
  parseHostedRuntimeIMessageContactToolRequest,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  handleHostedRuntimeIMessageContactTool,
} from "@/src/lib/hosted-execution/imessage-contact-tool";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 1_024;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } =
    await requireHostedCloudflareCallbackJsonRequest(request, {
      maxBodyBytes: BODY_LIMIT_BYTES,
    });
  return jsonOk(await handleHostedRuntimeIMessageContactTool({
    memberId,
    request: parseHostedRuntimeIMessageContactToolRequest(payload),
  }));
});
