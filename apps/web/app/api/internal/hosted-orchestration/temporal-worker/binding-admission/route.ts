import {
  HOSTED_TEMPORAL_WORKER_BINDING_ADMISSION_KIND,
  HOSTED_TEMPORAL_WORKER_BINDING_CONTRACT_REVISION,
  type HostedTemporalWorkerBindingAdmission,
} from "@murphai/hosted-execution/contracts";

import {
  requireHostedCloudflareSystemCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

const HOSTED_TEMPORAL_WORKER_BINDING_ADMISSION_BODY_LIMIT_BYTES = 0;

export const GET = withJsonError(async (request: Request) => {
  const signingKeyId = await requireHostedCloudflareSystemCallbackRequest(
    request,
    {
      maxBodyBytes: HOSTED_TEMPORAL_WORKER_BINDING_ADMISSION_BODY_LIMIT_BYTES,
    },
  );
  const admission = {
    bindingContractRevision: HOSTED_TEMPORAL_WORKER_BINDING_CONTRACT_REVISION,
    environment: "production",
    kind: HOSTED_TEMPORAL_WORKER_BINDING_ADMISSION_KIND,
    owner: "web",
    signingKeyId,
  } satisfies HostedTemporalWorkerBindingAdmission;

  return jsonOk(admission);
});
