import {
  parseHostedRuntimeReconciliationFactsRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_RECONCILIATION_ENVIRONMENT_INTERVIEW_SEARCH,
  projectHostedRuntimeReconciliationFactsWireResponse,
} from "@murphai/hosted-execution/orchestration-control";

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
  readHostedRuntimeReconciliationFactsWithVisibleAccess,
} from "@/src/lib/hosted-orchestration/visible-runtime-reconciliation";
import {
  resolveDecodedRouteParam,
} from "@/src/lib/http";

const HOSTED_ORCHESTRATION_RECONCILIATION_FACTS_CALLBACK_BODY_LIMIT_BYTES = 0;

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ userId: string }> },
) => {
  const authenticatedUserId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_ORCHESTRATION_RECONCILIATION_FACTS_CALLBACK_BODY_LIMIT_BYTES,
  });
  const routeUserId = await resolveDecodedRouteParam(context.params, "userId");
  assertHostedOrchestrationUserMatches({
    authenticatedUserId,
    routeUserId,
  });

  const factsRequest = parseHostedRuntimeReconciliationFactsRequest({
    userId: routeUserId,
  });

  const facts = await readHostedRuntimeReconciliationFactsWithVisibleAccess(
    factsRequest,
  );

  return jsonOk(projectHostedRuntimeReconciliationFactsWireResponse(
    facts,
    new URL(request.url).search
      === HOSTED_RUNTIME_RECONCILIATION_ENVIRONMENT_INTERVIEW_SEARCH,
  ));
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
