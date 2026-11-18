import { buildRecapScoreProtocolProbe, buildRecapVideoProtocolProbe, hostedGameToolRequestSchema, hostedGameToolResponseSchema } from '@murphai/hosted-execution/runtime-control';
import { recapAssetSchema } from '@murphai/contracts/recap-show';
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
import { parseAssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import { priceHostedAiUsageForAllowance } from "./usage-allowance";
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
  const score = buildRecapScoreProtocolProbe();
  const video = buildRecapVideoProtocolProbe();
  return {
    // Exercise the same parser and price calculation as signed usage ingestion.
    // The probe runs only during deployment and writes no records.
    pricedAssistantModels: ["gpt-6.2-sol", "gpt-6.2-astra"].filter(model =>
      ["standard", "openai-flex"].every(tokenPricingBasis => {
        const record = parseAssistantUsageRecord({
          schema: "murph.assistant-usage.v1", sessionId: "protocol-probe", turnId: "protocol-probe",
          usageId: "protocol-probe.attempt-1", attemptCount: 1, occurredAt: "2000-01-01T00:00:00Z",
          provider: "codex-cli", providerName: "openai", credentialSource: "platform",
          requestedModel: model, servedModel: model, tokenPricingBasis,
          inputTokens: 1000, outputTokens: 1000, totalTokens: 2000,
          cacheWriteTokens: 100, rawUsageJson: { cacheWrite12hInputTokens: 50 },
        });
        return priceHostedAiUsageForAllowance(record).costUsdMicros > 0n;
      })),
    recapScore: { upload: hostedGameToolRequestSchema.parse(score.upload), asset: recapAssetSchema.parse(score.asset) },
    // The same schemas the group tool route and its results use; no game, member or storage is touched.
    recapVideo: { part: hostedGameToolRequestSchema.parse(video.part), write: hostedGameToolRequestSchema.parse(video.write),
      recover: hostedGameToolRequestSchema.parse(video.recover), result: hostedGameToolResponseSchema.parse(video.result) },
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
