import {
  projectHostedRuntimeReconciliationFactsWireResponse,
  type HostedRuntimeReconciliationFactsWireResponse,
} from "../packages/hosted-execution/src/reconciliation-facts-wire.ts";
import type {
  HostedRuntimeReconciliationFacts,
} from "../packages/hosted-execution/src/orchestration-control.ts";

export function buildTemporalCompatibilityProducerFixtures():
  HostedRuntimeReconciliationFactsWireResponse[] {
  return [
    projectHostedRuntimeReconciliationFactsWireResponse({
      blocked: null,
      environmentInterviewPending: false,
      mailboxLag: [],
      workspace: null,
    }),
    projectHostedRuntimeReconciliationFactsWireResponse({
      blocked: {
        reason: "hosted_runtime_not_configured",
        retryAt: "2026-01-01T00:02:00.000Z",
      },
      environmentInterviewPending: false,
      mailboxLag: [{
        importedSeq: "1",
        lag: "1",
        lane: "conversation",
        maxSeq: "2",
        maxUpdatedAt: "2026-01-01T00:00:00.000Z",
      }],
      workspace: {
        hostedMailboxSystemHandledThroughSeq: "1",
        inboxMediaRetentionWakeAt: "2026-01-01T00:00:00.000Z",
        nextWakeAt: "2026-01-01T00:01:00.000Z",
        nextWakeReason: "assistant_delivery",
        systemMailboxFrontier: "model_free",
        version: "1",
      },
    }),
    projectHostedRuntimeReconciliationFactsWireResponse({
      blocked: {
        reason: "ai_usage_gate_unavailable",
        retryAt: null,
      },
      environmentInterviewPending: true,
      mailboxLag: [{
        importedSeq: "0",
        lag: "0",
        lane: "system",
        maxSeq: "0",
      }],
      workspace: {
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: null,
        nextWakeReason: null,
        version: null,
      },
    }),
  ];
}
