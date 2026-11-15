import { ContractValidationError } from "@murphai/contracts/validation-error";
import { buildHostedRuntimeReplicaBatchProtocolProbe, parseHostedRuntimeReplicaPutCommand } from "../runtime-resources.ts";
import {
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_LATENCY_TRACE_BATCH_MAX_EVENTS,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_KIND,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION,
} from "../runtime-control.ts";
import { requireObject } from "./assertions.ts";
import { parseHostedRuntimeOwnerCommand } from "../runtime-owner.ts";
import { buildRecapScoreProtocolProbe, buildRecapVideoProtocolProbe, hostedGameToolRequestSchema, hostedGameToolResponseSchema } from "../game-tools.ts";
import { recapAssetSchema } from "@murphai/contracts/recap-show";

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

export function assertHostedRuntimeWebProtocolAdmission(
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
  assertRecapScoreEvidence(record.recapScore);
  assertRecapVideoEvidence(record.recapVideo);
}

/** Web must read a video part, a candidate and an identity request before a runtime that sends them is activated. */
function assertRecapVideoEvidence(value: unknown): void {
  try {
    const video = requireObject(value, "Recap video evidence");
    const expected = buildRecapVideoProtocolProbe();
    for (const field of ["part", "write", "recover"] as const) {
      if (JSON.stringify(hostedGameToolRequestSchema.parse(video[field])) !== JSON.stringify(hostedGameToolRequestSchema.parse(expected[field]))) throw new Error("Video witness mismatch.");
    }
    if (JSON.stringify(hostedGameToolResponseSchema.parse(video.result)) !== JSON.stringify(hostedGameToolResponseSchema.parse(expected.result))) throw new Error("Video witness mismatch.");
  } catch {
    throw new Error("Hosted Web protocol admission failed: recap_video.");
  }
}

function assertRecapScoreEvidence(value: unknown): void {
  try {
    const score = requireObject(value, "Recap score evidence");
    const expected = buildRecapScoreProtocolProbe();
    if (JSON.stringify(hostedGameToolRequestSchema.parse(score.upload)) !== JSON.stringify(hostedGameToolRequestSchema.parse(expected.upload))
      || JSON.stringify(recapAssetSchema.parse(score.asset)) !== JSON.stringify(recapAssetSchema.parse(expected.asset))) throw new Error("Score witness mismatch.");
  } catch {
    throw new Error("Hosted Web protocol admission failed: recap_score.");
  }
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
