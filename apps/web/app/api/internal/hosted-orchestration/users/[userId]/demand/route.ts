import {
  parseHostedRuntimeDemandRequest,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  readHostedRuntimeDemand,
} from "@/src/lib/hosted-orchestration/runtime-demand";
import {
  resolveDecodedRouteParam,
} from "@/src/lib/http";

const HOSTED_ORCHESTRATION_DEMAND_CALLBACK_BODY_LIMIT_BYTES = 0;

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ userId: string }> },
) => {
  const authenticatedUserId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_ORCHESTRATION_DEMAND_CALLBACK_BODY_LIMIT_BYTES,
  });
  const routeUserId = await resolveDecodedRouteParam(context.params, "userId");
  assertHostedOrchestrationUserMatches({
    authenticatedUserId,
    routeUserId,
  });

  const demandRequest = parseHostedRuntimeDemandRequest({
    browserVaultRefreshRequested: readHostedOrchestrationQueryFlag(
      request,
      "browserVaultRefreshRequested",
    ),
    lagRecoveryObserved: readHostedOrchestrationQueryFlag(
      request,
      "lagRecoveryObserved",
    ),
    manualRunRequested: readHostedOrchestrationQueryFlag(
      request,
      "manualRunRequested",
    ),
    userId: routeUserId,
  });

  return jsonOk(await readHostedRuntimeDemand(demandRequest));
});

function assertHostedOrchestrationUserMatches(input: {
  authenticatedUserId: string;
  routeUserId: string;
}): void {
  if (input.authenticatedUserId === input.routeUserId) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_ORCHESTRATION_USER_MISMATCH",
    httpStatus: 403,
    message: "Hosted orchestration request is not authorized for this user.",
  });
}

function readHostedOrchestrationQueryFlag(
  request: Request,
  name: string,
): boolean {
  const value = new URL(request.url).searchParams.get(name);

  if (value === null || value === "" || value === "0" || value === "false") {
    return false;
  }

  if (value === "1" || value === "true") {
    return true;
  }

  throw hostedOnboardingError({
    code: "HOSTED_ORCHESTRATION_INVALID_QUERY",
    httpStatus: 400,
    message: "Hosted orchestration query flag is invalid.",
  });
}
