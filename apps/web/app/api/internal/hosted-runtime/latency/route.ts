import {
  parseHostedRuntimeLatencyTraceRequest,
  parseHostedRuntimeLatencyTraceResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRuntimeLatencyTraceEvent,
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
    console.error("Hosted runtime latency trace persistence failed.", {
      eventType: traceRequest.event.type,
      inputCardinality: readLatencyEventInputCardinality(traceRequest.event),
      prismaCode: codes.prismaCode,
      queryTag: readLatencyEventQueryTag(traceRequest.event.type),
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

function readLatencyEventInputCardinality(
  event: HostedRuntimeLatencyTraceEvent,
): number {
  switch (event.type) {
    case "assistant_milestone":
    case "provider_started":
      return event.assistantInputIds.length;
    case "assistant_input_staged":
    case "runtime_milestone":
      return 1;
  }
}

function readLatencyEventQueryTag(
  eventType: "assistant_input_staged" | "assistant_milestone" | "provider_started" | "runtime_milestone",
): string {
  switch (eventType) {
    case "assistant_input_staged":
      return "hosted_ingress_assistant_input_staged";
    case "assistant_milestone":
      return "hosted_ingress_assistant_milestone_set_based";
    case "provider_started":
      return "hosted_ingress_provider_started_set_based";
    case "runtime_milestone":
      return "hosted_ingress_runtime_milestone";
  }
}

function readLatencyPersistenceErrorCodes(error: unknown): {
  prismaCode: string | null;
  sqlState: string | null;
} {
  let current: unknown = error;
  let prismaCode: string | null = null;
  let sqlState: string | null = null;
  const seen = new Set<unknown>();

  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    for (const key of ["code", "originalCode"] as const) {
      const value = readUnknownStringProperty(current, key);
      if (value && /^P\d{4}$/u.test(value)) {
        prismaCode ??= value;
      } else if (value && /^[0-9A-Z]{5}$/u.test(value)) {
        sqlState ??= value;
      }
    }
    current = readUnknownProperty(current, "cause");
  }

  return { prismaCode, sqlState };
}

function readUnknownStringProperty(value: unknown, key: string): string | null {
  const property = readUnknownProperty(value, key);
  return typeof property === "string" ? property : null;
}

function readUnknownProperty(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return undefined;
  }
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
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
