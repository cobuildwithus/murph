import { buildHostedRuntimeReplicaBatchProtocolProbe, parseHostedRuntimeReplicaPutCommand } from "@murphai/hosted-execution/runtime-resources";
import { parseHostedRuntimeLatencyTraceBatchRequest, parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import {
  buildHostedRuntimeLogProtocolProbe,
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_LATENCY_TRACE_BATCH_MAX_EVENTS,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_KIND,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION,
  type HostedRuntimeWebProtocolAdmission,
} from "@murphai/hosted-execution/runtime-control";
import { parseHostedRuntimeOwnerCommand } from "@murphai/hosted-execution/runtime-owner";

export function buildHostedThreadRouteAuthorityResponse(
  threadIsDirect: boolean,
  assistantAskFallbackRequired?: boolean,
) {
  return {
    authorized: true,
    threadIsDirect,
    ...(assistantAskFallbackRequired ? { assistantAskFallbackRequired: true } : {}),
  };
}

export function buildHostedRuntimeWebProtocolAdmission(nonce: string): HostedRuntimeWebProtocolAdmission {
  const replica = buildHostedRuntimeReplicaBatchProtocolProbe();
  return {
    runtimeReplicaBatch: { admission: parseHostedRuntimeReplicaPutCommand(replica.admission), settlement: parseHostedRuntimeReplicaPutCommand(replica.settlement) },
    kind: HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_KIND,
    schemaVersion: HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION,
    nonce,
    latencyMilestoneBatchMaxEvents: parseHostedRuntimeLatencyTraceBatchRequest({
      events: Array.from({ length: HOSTED_RUNTIME_LATENCY_TRACE_BATCH_MAX_EVENTS }, () => ({
        type: "assistant_milestone", source: "linq", assistantInputIds: ["synthetic-input"],
        runtimeAttemptId: "synthetic-attempt", at: "2000-01-01T00:00:00.000Z",
        milestone: "first_codex_output_observed",
      })),
    }).events.length,
    // This is the same parser imported by the real /hosted-runtime/log route.
    // No log is persisted and no member, provider or runner is accessed.
    runtimeLogEventCodes: HOSTED_RUNTIME_LOG_EVENT_CODES.map(eventCode =>
      parseHostedRuntimeLogRequest(buildHostedRuntimeLogProtocolProbe(eventCode)).entries[0]!.eventCode),
    threadRouteAuthority: {
      direct: buildHostedThreadRouteAuthorityResponse(true),
      group: buildHostedThreadRouteAuthorityResponse(false),
    },
    runtimeOwnerCompletion: {
      early: parseHostedRuntimeOwnerCommand({ operation: "complete", attemptId: "protocol-probe", generation: "1",
        settledRunnerContainerName: null, immediateRecheckRequested: false }),
      settled: parseHostedRuntimeOwnerCommand({ operation: "complete", attemptId: "protocol-probe", generation: "1",
        settledRunnerContainerName: "protocol-probe-target", immediateRecheckRequested: true }),
    },
  };
}
