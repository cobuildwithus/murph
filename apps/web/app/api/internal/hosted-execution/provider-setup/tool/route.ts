import {
  parseHostedRuntimeProviderSetupToolRequest,
} from "@murphai/hosted-execution/provider-setup";

import {
  handleHostedRuntimeProviderSetupTool,
} from "@/src/lib/device-sync/provider-setup/tool";
import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 8_192;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } =
    await requireHostedCloudflareCallbackJsonRequest(request, {
      maxBodyBytes: BODY_LIMIT_BYTES,
    });

  return jsonOk(await handleHostedRuntimeProviderSetupTool({
    memberId,
    request: parseHostedRuntimeProviderSetupToolRequest(payload),
  }));
});
