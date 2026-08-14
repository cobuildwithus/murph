import {
  parseHostedRuntimeProviderSetupContinuationValidateRequest,
} from "@murphai/hosted-execution/provider-setup";

import {
  handleHostedRuntimeProviderSetupContinuationValidation,
} from "@/src/lib/device-sync/provider-setup/tool";
import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 2_048;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } =
    await requireHostedCloudflareCallbackJsonRequest(request, {
      maxBodyBytes: BODY_LIMIT_BYTES,
    });

  return jsonOk(await handleHostedRuntimeProviderSetupContinuationValidation({
    memberId,
    request: parseHostedRuntimeProviderSetupContinuationValidateRequest(payload),
  }));
});
