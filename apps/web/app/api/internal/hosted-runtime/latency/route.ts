import { after } from "next/server";

import {
  parseHostedRuntimeLatencyTraceBatchRequest,
  parseHostedRuntimeLatencyTraceRequest,
  parseHostedRuntimeLatencyTraceResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES,
  type HostedRuntimeLatencyTraceEvent,
  type HostedRuntimeLatencyTraceResponse,
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
  recordHostedIngressDeliveryCommitted,
  recordHostedIngressAssistantInputStaged,
  recordHostedIngressProviderStarted,
  recordHostedIngressRuntimeMilestone,
} from "@/src/lib/hosted-runtime-latency/store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { reportHostedRuntimeTypingAlerts } from "@/src/lib/hosted-runtime-latency/typing-alert-monitor";
import { isRecord } from "@/src/lib/primitives";

const LATENCY_EVENT_METADATA = {
  delivery_committed: "hosted_ingress_delivery_committed",
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
  if (isRecord(payload) && "events" in payload) {
    const batch = parseHostedRuntimeLatencyTraceBatchRequest(payload);
    // Reject the whole envelope before any write if even one event has the wrong fence.
    const fences = batch.events.map(event => requireMatchingRuntimeWriteFence(request, event.runtimeAttemptId));
    const results: Array<HostedRuntimeLatencyTraceResponse | null> = [];
    for (const [index, event] of batch.events.entries()) {
      try {
        results.push(await recordLatencyEvent(event, authenticatedUserId, fences[index]!));
      } catch {
        // The existing event owner reports bounded diagnostics; only this event retries.
        results.push(null);
      }
    }
    return jsonOk({ results });
  }
  const { event } = parseHostedRuntimeLatencyTraceRequest(payload);
  return jsonOk(await recordLatencyEvent(
    event, authenticatedUserId, requireMatchingRuntimeWriteFence(request, event.runtimeAttemptId),
  ));
});

async function recordLatencyEvent(
  event: HostedRuntimeLatencyTraceEvent,
  authenticatedUserId: string,
  writeFence: NonNullable<ReturnType<typeof readHostedRuntimeWriteFence>>,
): Promise<HostedRuntimeLatencyTraceResponse> {
  const runtimeAttemptId = writeFence.attemptId;
  try {
    const result = event.type === "delivery_committed"
      ? await recordHostedIngressDeliveryCommitted({
          ...event,
          authenticatedUserId,
          runtimeAttemptId,
          runtimeLeaseGeneration: writeFence.leaseGeneration,
        })
      : event.type === "assistant_input_staged"
      ? await recordHostedIngressAssistantInputStaged({
        assistantInputId: event.assistantInputId,
        at: event.at,
        authenticatedUserId,
        mailboxItemId: event.mailboxItemId,
        phaseBreakdown: event.phaseBreakdown,
        runnerJobAcceptedAt: event.runnerJobAcceptedAt,
        runtimeAttemptId,
        runtimePhaseStartedAt: event.runtimePhaseStartedAt,
        source: event.source,
        workspaceRestoreDoneAt: event.workspaceRestoreDoneAt,
      })
    : event.type === "assistant_milestone"
      ? await recordHostedIngressAssistantMilestone({
          assistantInputIds: event.assistantInputIds,
          at: event.at,
          authenticatedUserId,
          ...(event.checkpointPublicationExpectedBy === undefined
            ? {}
            : {
                checkpointPublicationExpectedBy:
                  event.checkpointPublicationExpectedBy,
              }),
          milestone: event.milestone,
          runtimeAttemptId,
          runtimeLeaseGeneration: writeFence.leaseGeneration,
          source: event.source,
        })
      : event.type === "provider_started"
      ? await recordHostedIngressProviderStarted({
          assistantInputIds: event.assistantInputIds,
          at: event.at,
          authenticatedUserId,
          phaseBreakdown: event.phaseBreakdown,
          providerRequestOrdinal: event.providerRequestOrdinal,
          runtimeAttemptId,
          source: event.source,
        })
        : await recordHostedIngressRuntimeMilestone({
          at: event.at,
          authenticatedUserId,
          milestone: event.milestone,
          runtimeAttemptId,
          runtimeLeaseGeneration: writeFence.leaseGeneration,
          source: event.source,
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
      const eventType = event.type;
      const source = event.source;
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
        eventType: event.type,
        matchedCount: result.matchedCount,
        source: event.source,
      });
    }

    if (result.recorded && event.source !== "email" && (
      event.type === "assistant_input_staged"
      || (event.type === "assistant_milestone" && (
        event.milestone === "linq_typing_accepted"
        || event.milestone === "telegram_typing_accepted"
      ))
    )) {
      after(() => reportHostedRuntimeTypingAlerts({
        userId: authenticatedUserId,
        assistantInputIds: event.type === "assistant_input_staged"
          ? [event.assistantInputId] : event.assistantInputIds,
      }));
    }
    return parseHostedRuntimeLatencyTraceResponse(result);
  } catch (error) {
    const codes = readLatencyPersistenceErrorCodes(error);
    const eventMetadataKey = event.type === "runtime_milestone"
      && event.milestone === "checkpoint_publication_expected_by"
      ? "checkpoint_publication_expected_by"
      : event.type;
    console.error("Hosted runtime latency trace persistence failed.", {
      eventType: event.type,
      inputCardinality: "assistantInputIds" in event
        ? event.assistantInputIds.length : 1,
      prismaCode: codes.prismaCode,
      queryTag: LATENCY_EVENT_METADATA[eventMetadataKey],
      source: event.source,
      sqlState: codes.sqlState,
    });
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_LATENCY_TRACE_PERSISTENCE_FAILED",
      httpStatus: 500,
      message: "Hosted runtime latency trace persistence failed.",
    });
  }
}

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
