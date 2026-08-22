import {
  parseHostedRuntimeReconciliationFactsRequest,
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

  // Keep the wire response compatible with the deployed Temporal worker.
  // Additive facts must reach that consumer before Web begins emitting them.
  return jsonOk({
    blocked: facts.blocked,
    mailboxLag: facts.mailboxLag,
    workspace: facts.workspace,
  });
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
