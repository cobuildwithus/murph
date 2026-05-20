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
  createHostedRuntimeUsageAllowDecisionResponse,
} from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import {
  resolveDecodedRouteParam,
} from "@/src/lib/http";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ userId: string }> },
) => {
  const authenticatedUserId = await requireHostedCloudflareCallbackRequest(request);
  const routeUserId = await resolveDecodedRouteParam(context.params, "userId");
  assertHostedOrchestrationUserMatches({
    authenticatedUserId,
    routeUserId,
  });

  const decision = await createHostedRuntimeUsageAllowDecisionResponse({
    userId: routeUserId,
  });

  return decision.kind === "allowed"
    ? jsonOk(decision.aiUsageAllowDecision)
    : jsonOk(decision);
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
