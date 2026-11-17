// Frozen pre-score admission reader from 27407067e729. Only imports and the
// local object guard are adapted so mixed-version evidence stays executable.
import { ContractValidationError } from "@murphai/contracts/validation-error";
import { buildHostedRuntimeReplicaBatchProtocolProbe, parseHostedRuntimeReplicaPutCommand } from "@murphai/hosted-execution/runtime-resources";
import {
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_LATENCY_TRACE_BATCH_MAX_EVENTS,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_KIND,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION,
} from "@murphai/hosted-execution/runtime-control";
function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(name);
  return value as Record<string, unknown>;
}
import { parseHostedRuntimeOwnerCommand } from "@murphai/hosted-execution/runtime-owner";

// Preserve the legacy response for callers which do not need an audience.
// Scheduled delivery still independently requires the live owner's boolean.
export function parseHostedExternalThreadRouteAuthorityResponse(
  value: unknown,
): { assistantAskFallbackRequired?: boolean; threadIsDirect?: boolean } | void {
  const record = requireObject(value, "Hosted external thread route authority response");
  const { authorized, assistantAskFallbackRequired, threadIsDirect } = record;
  if (
    authorized !== true
    || (assistantAskFallbackRequired !== undefined && typeof assistantAskFallbackRequired !== "boolean")
    || (threadIsDirect !== undefined && typeof threadIsDirect !== "boolean")
  ) {
    throw new ContractValidationError("Hosted external thread route authority response is invalid.");
  }
  if (threadIsDirect === undefined && assistantAskFallbackRequired === undefined) return;
  return {
    ...(typeof assistantAskFallbackRequired === "boolean" ? { assistantAskFallbackRequired } : {}),
    ...(typeof threadIsDirect === "boolean" ? { threadIsDirect } : {}),
  };
}

export function assertPreScoreWebProtocolAdmission(
  value: unknown,
  nonce: string,
): void {
  const record = requireObject(value, "Hosted Web protocol admission");
  if (record.kind !== HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_KIND
    || record.schemaVersion !== HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION
    || record.nonce !== nonce) {
    throw new Error("Hosted Web protocol admission failed: version_or_nonce.");
  }
  if (typeof record.latencyMilestoneBatchMaxEvents !== "number"
    || !Number.isSafeInteger(record.latencyMilestoneBatchMaxEvents)
    || record.latencyMilestoneBatchMaxEvents < HOSTED_RUNTIME_LATENCY_TRACE_BATCH_MAX_EVENTS) {
    throw new Error("Hosted Web protocol admission failed: latency_milestone_batch.");
  }
  const codes = record.runtimeLogEventCodes;
  if (!Array.isArray(codes) || codes.some(code => typeof code !== "string")) {
    throw new Error("Hosted Web protocol admission failed: runtime_log_evidence.");
  }
  // A newer reader's superset is valid; source revision ordering is irrelevant.
  for (const required of HOSTED_RUNTIME_LOG_EVENT_CODES) {
    if (!codes.includes(required)) {
      // Only locally owned enum values enter diagnostics, never response text.
      throw new Error(`Hosted Web protocol admission failed: runtime_log_event:${required}.`);
    }
  }
  try {
    const replica = requireObject(record.runtimeReplicaBatch, "Replica batch evidence");
    const expected = buildHostedRuntimeReplicaBatchProtocolProbe();
    for (const field of ["admission", "settlement"] as const) {
      if (JSON.stringify(parseHostedRuntimeReplicaPutCommand(replica[field])) !== JSON.stringify(parseHostedRuntimeReplicaPutCommand(expected[field]))) {
        throw new Error("Replica batch witness mismatch.");
      }
    }
  } catch {
    throw new Error("Hosted Web protocol admission failed: replica_batch.");
  }
  let direct: ReturnType<typeof parseHostedExternalThreadRouteAuthorityResponse>;
  let group: ReturnType<typeof parseHostedExternalThreadRouteAuthorityResponse>;
  try {
    const routes = requireObject(record.threadRouteAuthority, "Thread route evidence");
    direct = parseHostedExternalThreadRouteAuthorityResponse(routes.direct);
    group = parseHostedExternalThreadRouteAuthorityResponse(routes.group);
  } catch {
    throw new Error("Hosted Web protocol admission failed: thread_route_audience.");
  }
  if (direct?.threadIsDirect !== true || group?.threadIsDirect !== false) {
    throw new Error("Hosted Web protocol admission failed: thread_route_audience.");
  }
  assertRuntimeOwnerCompletionEvidence(record.runtimeOwnerCompletion);
}

function assertRuntimeOwnerCompletionEvidence(value: unknown): void {
  try {
    const evidence = requireObject(value, "Runtime completion evidence");
    for (const [phase, target] of [["early", null], ["settled", "protocol-probe-target"]] as const) {
      const command = parseHostedRuntimeOwnerCommand(evidence[phase]);
      if (command.operation !== "complete" || command.attemptId !== "protocol-probe" || command.generation !== "1"
        || command.settledRunnerContainerName !== target || command.immediateRecheckRequested !== (phase === "settled")) {
        throw new Error("Invalid completion evidence.");
      }
    }
  } catch {
    throw new Error("Hosted Web protocol admission failed: runtime_owner_completion.");
  }
}
