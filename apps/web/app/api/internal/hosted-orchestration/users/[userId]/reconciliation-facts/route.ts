import {
  parseHostedRuntimeReconciliationFactsRequest,
} from "@murphai/hosted-execution/parsers";
import {
  projectHostedRuntimeReconciliationFactsWireResponse,
} from "@murphai/hosted-execution/orchestration-control";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  readHostedRuntimeReconciliationFactsWithVisibleAccess,
  type HostedRuntimeReconciliationFactsProcessingStage,
} from "@/src/lib/hosted-orchestration/visible-runtime-reconciliation";
import {
  resolveDecodedRouteParam,
} from "@/src/lib/http";

const HOSTED_ORCHESTRATION_RECONCILIATION_FACTS_CALLBACK_BODY_LIMIT_BYTES = 0;
const HOSTED_RUNTIME_RECONCILIATION_FAILURE_LOG_MESSAGE =
  "Hosted runtime reconciliation facts failed.";
const HOSTED_RUNTIME_RECONCILIATION_FAILURE_LOG_SCHEMA =
  "murph.hosted-runtime.reconciliation-facts.failure.v1";
const HOSTED_RUNTIME_RECONCILIATION_TIMING_LOG_SCHEMA =
  "murph.hosted-runtime.reconciliation-facts.timing.v1";

type HostedRuntimeReconciliationTimingStage =
  | HostedRuntimeReconciliationFactsProcessingStage
  | "authentication"
  | "request_validation"
  | "response_projection";

type HostedRuntimeReconciliationFailureErrorClass =
  | "hosted_onboarding"
  | "type_error"
  | "error"
  | "non_error";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ userId: string }> },
) => {
  const startedAt = Math.round(performance.now());
  let stageStartedAt = startedAt;
  let timingStage: HostedRuntimeReconciliationTimingStage = "authentication";
  const stageDurationsMs: Partial<Record<HostedRuntimeReconciliationTimingStage, number>> = {};
  const reportStage = (stage: HostedRuntimeReconciliationTimingStage): void => {
    const now = Math.round(performance.now());
    stageDurationsMs[timingStage] = (stageDurationsMs[timingStage] ?? 0)
      + now - stageStartedAt;
    timingStage = stage;
    stageStartedAt = now;
  };

  try {
    const authenticatedUserId = await requireHostedCloudflareCallbackRequest(request, {
      maxBodyBytes: HOSTED_ORCHESTRATION_RECONCILIATION_FACTS_CALLBACK_BODY_LIMIT_BYTES,
    });
    reportStage("request_validation");
    const routeUserId = await resolveDecodedRouteParam(context.params, "userId");
    assertHostedOrchestrationUserMatches({
      authenticatedUserId,
      routeUserId,
    });

    const factsRequest = parseHostedRuntimeReconciliationFactsRequest({
      userId: routeUserId,
    });

    let failureStage: HostedRuntimeReconciliationFactsProcessingStage =
      "canonical_access_workspace";
    reportStage(failureStage);
    let facts: Awaited<
      ReturnType<typeof readHostedRuntimeReconciliationFactsWithVisibleAccess>
    >;
    try {
      facts = await readHostedRuntimeReconciliationFactsWithVisibleAccess(
        factsRequest,
        (stage) => {
          failureStage = stage;
          reportStage(stage);
        },
      );
    } catch (error) {
      emitHostedRuntimeReconciliationFailure({
        error,
        stage: failureStage,
      });
      throw error;
    }

    reportStage("response_projection");
    return jsonOk(projectHostedRuntimeReconciliationFactsWireResponse(facts));
  } finally {
    try {
      reportStage(timingStage);
      console.info("Hosted runtime reconciliation facts timing.", {
        durationMs: stageStartedAt - startedAt,
        schema: HOSTED_RUNTIME_RECONCILIATION_TIMING_LOG_SCHEMA,
        stageDurationsMs,
      });
    } catch {
      // Timing telemetry must never replace the reconciliation result or failure.
    }
  }
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

function emitHostedRuntimeReconciliationFailure(input: {
  error: unknown;
  stage: HostedRuntimeReconciliationFactsProcessingStage;
}): void {
  try {
    const errorClass = classifyHostedRuntimeReconciliationFailure(input.error);
    const stage = input.stage;
    console.error(HOSTED_RUNTIME_RECONCILIATION_FAILURE_LOG_MESSAGE, {
      errorClass,
      schema: HOSTED_RUNTIME_RECONCILIATION_FAILURE_LOG_SCHEMA,
      stage,
    });
  } catch {
    // Failure telemetry must never replace the original reconciliation failure.
  }
}

function classifyHostedRuntimeReconciliationFailure(
  error: unknown,
): HostedRuntimeReconciliationFailureErrorClass {
  if (isHostedOnboardingError(error)) {
    return "hosted_onboarding";
  }
  if (error instanceof TypeError) {
    return "type_error";
  }
  if (error instanceof Error) {
    return "error";
  }
  return "non_error";
}
