import {
  parseHostedRuntimeOwnerReleaseSearch,
} from "@murphai/hosted-execution/routes";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedRuntimeOwnerReleaseMailboxLagActionable,
} from "@/src/lib/hosted-orchestration/runtime-reconciliation-facts";
import {
  signalHostedRuntimeOwnerReleasedRuntime,
  signalHostedRuntimeRecheckRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: 0,
  });
  const ownerRelease = readOwnerRelease(request);

  if (ownerRelease.runtimeAttemptId !== null) {
    await signalHostedRuntimeOwnerReleasedRuntime({
      runtimeAttemptId: ownerRelease.runtimeAttemptId,
      userId,
    });
    return jsonOk({ signaled: true });
  }

  if (
    !ownerRelease.immediateRecheckRequested
    && !(await readHostedRuntimeOwnerReleaseMailboxLagActionable({ userId }))
  ) {
    return jsonOk({ signaled: false });
  }

  await signalHostedRuntimeRecheckRuntime({ userId });
  return jsonOk({ signaled: true });
});

function readOwnerRelease(request: Request): {
  immediateRecheckRequested: boolean;
  runtimeAttemptId: string | null;
} {
  try {
    return parseHostedRuntimeOwnerReleaseSearch(new URL(request.url).search);
  } catch {
    throw invalidOwnerReleaseQuery();
  }
}

function invalidOwnerReleaseQuery() {
  return hostedOnboardingError({
    code: "HOSTED_RUNTIME_OWNER_RELEASE_QUERY_INVALID",
    httpStatus: 400,
    message: "Hosted runtime owner-release query is invalid.",
  });
}
