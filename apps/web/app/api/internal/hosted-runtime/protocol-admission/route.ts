import { HOSTED_EXECUTION_NONCE_HEADER } from "@murphai/hosted-execution/contracts";
import { HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION } from "@murphai/hosted-execution/runtime-control";

import { requireHostedCloudflareSystemCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { buildHostedRuntimeWebProtocolAdmission } from "@/src/lib/hosted-execution/runtime-protocol";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";

export const GET = withJsonError(async (request: Request) => {
  await requireHostedCloudflareSystemCallbackRequest(request, {
    maxBodyBytes: 0,
    nonceOwner: "system:hosted-runtime-protocol-admission",
  });
  const query = new URL(request.url).searchParams;
  const nonce = request.headers.get(HOSTED_EXECUTION_NONCE_HEADER);
  if (!nonce || query.size !== 2 || query.get("nonce") !== nonce
    || query.get("schemaVersion") !== String(HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION)) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_PROTOCOL_PROBE_INVALID",
      httpStatus: 400,
      message: "Hosted runtime protocol probe is invalid.",
      retryable: false,
    });
  }
  return jsonOk(buildHostedRuntimeWebProtocolAdmission(nonce));
});
