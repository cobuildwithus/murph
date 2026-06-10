import {
  parseHostedRuntimeLatencyTraceRequest,
  parseHostedRuntimeLatencyTraceResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES,
} from "@murphai/hosted-execution/runtime-control";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  recordHostedIngressAssistantInputStaged,
  recordHostedIngressProviderStarted,
  recordHostedIngressRuntimeMilestone,
} from "@/src/lib/hosted-runtime-latency/store";
import { readRawBodyBuffer } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const HOSTED_RUNTIME_ATTEMPT_ID_HEADER = "x-hosted-runtime-attempt-id";

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES,
  })).toString("utf8");
  const authenticatedUserId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES,
    payloadText,
  });
  const traceRequest = parseHostedRuntimeLatencyTraceRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );
  const runtimeAttemptId = requireMatchingRuntimeAttemptId(request, traceRequest.event.runtimeAttemptId);

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
          source: traceRequest.event.source,
        });

  if (result.unmatchedCount > 0) {
    const eventType = traceRequest.event.type;
    const source = traceRequest.event.source;
    console.warn("Hosted runtime latency trace callback had unmatched rows.", {
      eventType,
      matchedCount: result.matchedCount,
      source,
      unmatchedCount: result.unmatchedCount,
    });
  }

  return jsonOk(parseHostedRuntimeLatencyTraceResponse(result));
});

function requireMatchingRuntimeAttemptId(
  request: Request,
  eventRuntimeAttemptId: string | null | undefined,
): string {
  const headerRuntimeAttemptId = request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)?.trim() ?? "";
  const normalizedEventRuntimeAttemptId = eventRuntimeAttemptId?.trim() ?? "";

  if (!headerRuntimeAttemptId || normalizedEventRuntimeAttemptId !== headerRuntimeAttemptId) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_LATENCY_TRACE_ATTEMPT_MISMATCH",
      httpStatus: 401,
      message: "Hosted runtime latency trace attempt did not match the active runtime write fence.",
    });
  }

  return headerRuntimeAttemptId;
}
