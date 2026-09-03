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
import { isRecord } from "@/src/lib/primitives";

const LATENCY_EVENT_METADATA = {
  assistant_input_staged: "hosted_ingress_assistant_input_staged",
  assistant_milestone: "hosted_ingress_assistant_milestone_set_based",
  provider_started: "hosted_ingress_provider_started_set_based",
  runtime_milestone: "hosted_ingress_runtime_milestone",
  checkpoint_publication_expected_by: "hosted_ingress_checkpoint_publication_expected_by_set_based",
} as const;

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

  try {
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
    // get an ingress trace row, so reporting them is noise. A row skipped while
    // another callback holds its lock is also expected: the runtime retries that
    // non-blocking write. Warn only when a traced row actually failed the guarded
    // ownership or eligibility check.
    const contendedCount = result.contendedCount ?? 0;
    const untracedCount = result.untracedCount ?? 0;
    const rejectedCount = result.unmatchedCount - untracedCount - contendedCount;
    if (rejectedCount > 0) {
      const eventType = traceRequest.event.type;
      const source = traceRequest.event.source;
      console.warn("Hosted runtime latency trace callback had rejected rows.", {
        contendedCount,
        eventType,
        matchedCount: result.matchedCount,
        rejectedCount,
        source,
        untracedCount,
      });
    }
    if (result.truncated === true) {
      console.warn("Hosted runtime latency collection milestone reached its write bound.", {
        eventType: traceRequest.event.type,
        matchedCount: result.matchedCount,
        source: traceRequest.event.source,
      });
    }

    return jsonOk(parseHostedRuntimeLatencyTraceResponse(result));
  } catch (error) {
    const codes = readLatencyPersistenceErrorCodes(error);
    const eventMetadataKey = traceRequest.event.type === "runtime_milestone"
      && traceRequest.event.milestone === "checkpoint_publication_expected_by"
      ? "checkpoint_publication_expected_by"
      : traceRequest.event.type;
    console.error("Hosted runtime latency trace persistence failed.", {
      eventType: traceRequest.event.type,
      inputCardinality: "assistantInputIds" in traceRequest.event
        ? traceRequest.event.assistantInputIds.length : 1,
      prismaCode: codes.prismaCode,
      queryTag: LATENCY_EVENT_METADATA[eventMetadataKey],
      source: traceRequest.event.source,
      sqlState: codes.sqlState,
    });
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_LATENCY_TRACE_PERSISTENCE_FAILED",
      httpStatus: 500,
      message: "Hosted runtime latency trace persistence failed.",
    });
  }
});

function readLatencyPersistenceErrorCodes(error: unknown) {
  if (!isRecord(error)) return { prismaCode: null, sqlState: null };
  const cause = isRecord(error.meta)
    && isRecord(error.meta.driverAdapterError)
    && isRecord(error.meta.driverAdapterError.cause)
    ? error.meta.driverAdapterError.cause
    : null;
  const postgresCode = typeof cause?.originalCode === "string"
    ? cause.originalCode
    : cause?.code;

  return {
    prismaCode: typeof error.code === "string" && /^P\d{4}$/u.test(error.code)
      ? error.code
      : null,
    sqlState: typeof postgresCode === "string" && /^[0-9A-Z]{5}$/u.test(postgresCode)
      ? postgresCode
      : null,
  };
}

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
