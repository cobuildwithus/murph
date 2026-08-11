import {
  parseHostedRuntimeLatencyTraceRequest,
  parseHostedRuntimeLatencyTraceResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES,
} from "@murphai/hosted-execution/runtime-control";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedRuntimeWriteFence,
} from "@/src/lib/hosted-execution/runtime-write-fence";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  recordHostedIngressAssistantMilestone,
  recordHostedIngressAssistantInputStaged,
  recordHostedIngressProviderStarted,
  recordHostedIngressRuntimeMilestone,
} from "@/src/lib/hosted-runtime-latency/store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: authenticatedUserId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES,
  });
  const traceRequest = parseHostedRuntimeLatencyTraceRequest(payload);
  const writeFence = requireMatchingRuntimeWriteFence(
    request,
    traceRequest.event.runtimeAttemptId,
  );
  const runtimeAttemptId = writeFence.attemptId;

  const result = traceRequest.event.type === "assistant_input_staged"
    ? await recordHostedIngressAssistantInputStaged({
        assistantInputId: traceRequest.event.assistantInputId,
        at: traceRequest.event.at,
        authenticatedUserId,
        mailboxItemId: traceRequest.event.mailboxItemId,
        phaseBreakdown: traceRequest.event.phaseBreakdown,
        runnerJobAcceptedAt: traceRequest.event.runnerJobAcceptedAt,
        runtimeAttemptId,
        runtimePhaseStartedAt: traceRequest.event.runtimePhaseStartedAt,
        source: traceRequest.event.source,
        workspaceRestoreDoneAt: traceRequest.event.workspaceRestoreDoneAt,
      })
    : traceRequest.event.type === "assistant_milestone"
      ? await recordHostedIngressAssistantMilestone({
          assistantInputIds: traceRequest.event.assistantInputIds,
          at: traceRequest.event.at,
          authenticatedUserId,
          ...(traceRequest.event.checkpointPublicationExpectedBy === undefined
            ? {}
            : {
                checkpointPublicationExpectedBy:
                  traceRequest.event.checkpointPublicationExpectedBy,
              }),
          milestone: traceRequest.event.milestone,
          runtimeAttemptId,
          runtimeLeaseGeneration: writeFence.leaseGeneration,
          source: traceRequest.event.source,
        })
      : traceRequest.event.type === "provider_started"
      ? await recordHostedIngressProviderStarted({
          assistantInputIds: traceRequest.event.assistantInputIds,
          at: traceRequest.event.at,
          authenticatedUserId,
          phaseBreakdown: traceRequest.event.phaseBreakdown,
          providerRequestOrdinal: traceRequest.event.providerRequestOrdinal,
          runtimeAttemptId,
          source: traceRequest.event.source,
        })
      : await recordHostedIngressRuntimeMilestone({
          at: traceRequest.event.at,
          authenticatedUserId,
          milestone: traceRequest.event.milestone,
          runtimeAttemptId,
          runtimeLeaseGeneration: writeFence.leaseGeneration,
          source: traceRequest.event.source,
        });

  // Assistant inputs the runtime created without an inbound messaging wake never
  // get an ingress trace row, so reporting them is noise. Warn only when a row
  // existed and the guarded write still declined it, which is the case an
  // operator can act on.
  const untracedCount = result.untracedCount ?? 0;
  const rejectedCount = result.unmatchedCount - untracedCount;
  if (rejectedCount > 0) {
    const eventType = traceRequest.event.type;
    const source = traceRequest.event.source;
    console.warn("Hosted runtime latency trace callback had rejected rows.", {
      eventType,
      matchedCount: result.matchedCount,
      rejectedCount,
      runtimeAttemptId,
      source,
      untracedCount,
    });
  }

  return jsonOk(parseHostedRuntimeLatencyTraceResponse(result));
});

function requireMatchingRuntimeWriteFence(
  request: Request,
  eventRuntimeAttemptId: string | null | undefined,
): NonNullable<ReturnType<typeof readHostedRuntimeWriteFence>> {
  const writeFence = readHostedRuntimeWriteFence(request);
  const normalizedEventRuntimeAttemptId = eventRuntimeAttemptId?.trim() ?? "";

  if (
    !writeFence
    || normalizedEventRuntimeAttemptId !== writeFence.attemptId
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_LATENCY_TRACE_ATTEMPT_MISMATCH",
      httpStatus: 401,
      message: "Hosted runtime latency trace attempt did not match the active runtime write fence.",
    });
  }

  return writeFence;
}
