import {
  HOSTED_RUNTIME_OWNER_RELEASE_IMMEDIATE_RECHECK_QUERY,
} from "@murphai/hosted-execution/routes";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedRuntimeOwnerReleaseMailboxLagActionable,
} from "@/src/lib/hosted-orchestration/runtime-reconciliation-facts";
import {
  signalHostedRuntimeRecheckRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: 0,
  });
  const immediateRecheckRequested = readImmediateRecheckRequested(request);

  if (
    !immediateRecheckRequested
    && !(await readHostedRuntimeOwnerReleaseMailboxLagActionable({ userId }))
  ) {
    return jsonOk({ signaled: false });
  }

  await signalHostedRuntimeRecheckRuntime({ userId });

  return jsonOk({ signaled: true });
});

function readImmediateRecheckRequested(request: Request): boolean {
  const search = new URL(request.url).search;
  if (search === "") {
    return false;
  }
  if (search !== `?${HOSTED_RUNTIME_OWNER_RELEASE_IMMEDIATE_RECHECK_QUERY}=1`) {
    throw invalidOwnerReleaseQuery();
  }

  return true;
}

function invalidOwnerReleaseQuery() {
  return hostedOnboardingError({
    code: "HOSTED_RUNTIME_OWNER_RELEASE_QUERY_INVALID",
    httpStatus: 400,
    message: "Hosted runtime owner-release query is invalid.",
  });
}
