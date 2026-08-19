import { describe, expect, it } from "vitest";

import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
  type HostedRuntimeReconciliationFactsWorkspace,
  type HostedRuntimeSignal,
} from "../src/orchestration-control.ts";
import {
  HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA,
  HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG,
  type HostedAiUsageAllowDecision,
  type HostedMailboxLaneLag,
} from "../src/runtime-control.ts";
import {
  parseHostedRuntimeEnsureProcessingRequest,
  parseHostedRuntimeEnsureProcessingResponse,
  parseHostedRuntimeReconciliationFacts,
  parseHostedRuntimeReconciliationFactsRequest,
  parseHostedRuntimeSignal,
} from "../src/parsers.ts";

describe("hosted orchestration control contracts", () => {
  it("freezes the Temporal workflow, task queue, signal, and query names", () => {
    expect(HOSTED_USER_RUNTIME_WORKFLOW_TYPE).toBe("hostedUserRuntimeWorkflow");
    expect(HOSTED_USER_RUNTIME_TASK_QUEUE).toBe("murph-hosted-runtime");
    expect(HOSTED_USER_RUNTIME_SIGNAL_NAME).toBe("runtimeSignal");
    expect(HOSTED_USER_RUNTIME_STATUS_QUERY_NAME).toBe("runtimeWorkflowStatus");
  });

  it("parses every pointer-only runtime signal variant", () => {
    const signals: HostedRuntimeSignal[] = [
      {
        kind: "mailbox_appended",
        lane: "conversation",
        laneSeq: "42",
        mailboxItemId: "mailbox_item_test",
      },
      {
        kind: "runtime_recheck_requested",
      },
      {
        kind: "runtime_wake_requested",
      },
    ];

    for (const signal of signals) {
      expect(parseHostedRuntimeSignal(signal)).toEqual(signal);
    }
  });

  it("rejects raw payload-shaped fields in runtime signals", () => {
    const baseSignal = {
      kind: "runtime_recheck_requested",
    };

    expect(() => parseHostedRuntimeSignal({
      ...baseSignal,
      eventId: "hosted-orchestration-smoke",
    })).toThrow("Hosted runtime recheck signal must not include eventId.");

    expect(() => parseHostedRuntimeSignal({
      ...baseSignal,
      source: "test",
    })).toThrow("Hosted runtime recheck signal must not include source.");

    expect(() => parseHostedRuntimeSignal({
      kind: "runtime_recheck_requested",
      payload: {},
      source: "runner",
    })).toThrow("Hosted runtime recheck signal must not include payload.");

    for (const field of [
      "body",
      "headers",
      "message",
      "payload",
      "prompt",
      "rawPayload",
      "transcript",
    ]) {
      expect(() => parseHostedRuntimeSignal({
        ...baseSignal,
        [field]: true,
      })).toThrow(`Hosted runtime recheck signal must not include ${field}.`);
    }

    expect(() => parseHostedRuntimeSignal({
      kind: "mailbox_appended",
      lane: "conversation",
      laneSeq: "42",
      mailboxItemId: "mailbox_item_test",
      source: "Provider",
    })).toThrow("Hosted runtime mailbox signal must not include source.");

    expect(() => parseHostedRuntimeSignal({
      kind: ["device", "sync", "recovery", "requested"].join("_"),
    })).toThrow("Hosted runtime signal kind is not supported.");

    expect(() => parseHostedRuntimeSignal({
      eventId: "runtime-prewarm:event-test",
      kind: "runtime_prewarm_requested",
      occurredAt: "2026-05-20T12:00:00.000Z",
      source: "linq.message.ingress",
    })).toThrow("Hosted runtime signal kind is not supported.");
  });

  it("parses reconciliation facts requests and responses", () => {
    const factsRequest = {
      userId: "user_test",
    };
    const mailboxLag = createMailboxLag();
    const workspace = createWorkspaceProjection();

    expect(parseHostedRuntimeReconciliationFactsRequest(factsRequest)).toEqual(
      factsRequest,
    );
    expect(parseHostedRuntimeReconciliationFactsRequest({
      userId: "user_test",
    })).toEqual({
      userId: "user_test",
    });
    expect(parseHostedRuntimeReconciliationFacts({
      blocked: null,
      mailboxLag,
      workspace,
    })).toEqual({
      blocked: null,
      mailboxLag,
      workspace,
    });
    expect(parseHostedRuntimeReconciliationFacts({
      blocked: null,
      mailboxLag,
      workspace: {
        ...workspace,
        hostedMailboxSystemHandledThroughSeq: "11",
        systemMailboxFrontier: "model_free",
      },
    })).toEqual({
      blocked: null,
      mailboxLag,
      workspace: {
        ...workspace,
        hostedMailboxSystemHandledThroughSeq: "11",
        systemMailboxFrontier: "model_free",
      },
    });
    expect(() => parseHostedRuntimeReconciliationFacts({
      blocked: null,
      mailboxLag,
      workspace: {
        ...workspace,
        hostedMailboxSystemHandledThroughSeq: "not-a-sequence",
      },
    })).toThrow(
      "Hosted runtime reconciliation facts workspace hostedMailboxSystemHandledThroughSeq must be a non-negative base-10 integer string.",
    );
    expect(() => parseHostedRuntimeReconciliationFacts({
      blocked: null,
      mailboxLag,
      workspace: {
        ...workspace,
        systemMailboxFrontier: "device-sync.wake",
      },
    })).toThrow(
      "Hosted runtime reconciliation facts workspace systemMailboxFrontier is not supported.",
    );
    expect(parseHostedRuntimeReconciliationFacts({
      blocked: null,
      mailboxLag,
      workspace: {
        nextWakeAt: null,
        nextWakeReason: null,
        version: "7",
      },
    })).toEqual({
      blocked: null,
      mailboxLag,
      workspace: {
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: null,
        nextWakeReason: null,
        version: "7",
      },
    });
    expect(parseHostedRuntimeReconciliationFacts({
      blocked: {
        reason: "ai_usage_gate_unavailable",
        retryAt: "2026-05-20T12:02:00.000Z",
      },
      mailboxLag,
      workspace: null,
    })).toEqual({
      blocked: {
        reason: "ai_usage_gate_unavailable",
        retryAt: "2026-05-20T12:02:00.000Z",
      },
      mailboxLag,
      workspace: null,
    });
    expect(parseHostedRuntimeReconciliationFacts({
      blocked: {
        reason: "automation_engagement_paused",
        retryAt: "2026-05-21T12:00:00.000Z",
      },
      mailboxLag,
      workspace: null,
    })).toEqual({
      blocked: {
        reason: "automation_engagement_paused",
        retryAt: "2026-05-21T12:00:00.000Z",
      },
      mailboxLag,
      workspace: null,
    });
  });

  it("rejects raw payload-shaped fields in reconciliation facts contracts", () => {
    expect(() => parseHostedRuntimeReconciliationFactsRequest({
      deviceSyncRecoveryRequested: true,
      userId: "user_test",
    })).toThrow(
      "Hosted runtime reconciliation facts request must not include deviceSyncRecoveryRequested.",
    );

    expect(() => parseHostedRuntimeReconciliationFactsRequest({
      payload: true,
      userId: "user_test",
    })).toThrow("Hosted runtime reconciliation facts request must not include payload.");

    expect(() => parseHostedRuntimeReconciliationFacts({
      body: true,
      blocked: null,
      mailboxLag: [],
      workspace: null,
    })).toThrow("Hosted runtime reconciliation facts must not include body.");

    expect(() => parseHostedRuntimeReconciliationFacts({
      blocked: null,
      mailboxLag: [],
      requiresAiUsageDecision: false,
      workspace: null,
    })).toThrow(
      "Hosted runtime reconciliation facts must not include requiresAiUsageDecision.",
    );

    expect(() => parseHostedRuntimeReconciliationFacts({
      blocked: null,
      mailboxLag: [],
      rawPayload: true,
      workspace: null,
    })).toThrow("Hosted runtime reconciliation facts must not include rawPayload.");

    expect(() => parseHostedRuntimeReconciliationFacts({
      aiUsageAllowDecision: createAiUsageAllowDecision(),
      blocked: null,
      mailboxLag: [],
      workspace: null,
    })).toThrow(
      "Hosted runtime reconciliation facts must not include aiUsageAllowDecision.",
    );

    expect(() => parseHostedRuntimeReconciliationFacts({
      blocked: null,
      mailboxLag: [],
      workspace: {
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {},
        version: "7",
      },
    })).toThrow(
      "Hosted runtime reconciliation facts workspace must not include redactedStatus.",
    );
  });

  it("parses ensure-processing request and response variants", () => {
    const ensureProcessingRequest = parseHostedRuntimeEnsureProcessingRequest({
      orchestrationAttemptId: "orchestration_attempt_test",
    });
    expect(ensureProcessingRequest).toEqual({
      orchestrationAttemptId: "orchestration_attempt_test",
    });
    expect(ensureProcessingRequest).not.toHaveProperty("reason");
    expect(ensureProcessingRequest).not.toHaveProperty("source");
    expect(parseHostedRuntimeEnsureProcessingRequest({
      orchestrationAttemptId: "orchestration_attempt_test",
      processingMode: "inbox_media_retention",
    })).toEqual({
      orchestrationAttemptId: "orchestration_attempt_test",
      processingMode: "inbox_media_retention",
    });
    expect(parseHostedRuntimeEnsureProcessingRequest({
      assistantExecutionBlocked: true,
      orchestrationAttemptId: "orchestration_attempt_test",
      processingMode: "system_mailbox",
    })).toEqual({
      assistantExecutionBlocked: true,
      orchestrationAttemptId: "orchestration_attempt_test",
      processingMode: "system_mailbox",
    });
    expect(() => parseHostedRuntimeEnsureProcessingRequest({
      assistantExecutionBlocked: false,
      orchestrationAttemptId: "orchestration_attempt_test",
      processingMode: "system_mailbox",
    })).toThrow(
      "Hosted runtime ensure-processing request assistantExecutionBlocked must be true.",
    );
    expect(() => parseHostedRuntimeEnsureProcessingRequest({
      assistantExecutionBlocked: true,
      orchestrationAttemptId: "orchestration_attempt_test",
    })).toThrow(
      "Hosted runtime ensure-processing request assistantExecutionBlocked requires system_mailbox processingMode.",
    );
    expect(() => parseHostedRuntimeEnsureProcessingRequest({
      assistantExecutionBlocked: true,
      orchestrationAttemptId: "orchestration_attempt_test",
      processingMode: "default",
    })).toThrow(
      "Hosted runtime ensure-processing request assistantExecutionBlocked requires system_mailbox processingMode.",
    );
    expect(() => parseHostedRuntimeEnsureProcessingRequest({
      orchestrationAttemptId: "orchestration_attempt_test",
      processingMode: "assistant",
    })).toThrow("Hosted runtime ensure-processing request processingMode is not supported.");

    for (const action of [
      "started",
      "replaced",
      "woken",
      "already_running",
    ] as const) {
      expect(parseHostedRuntimeEnsureProcessingResponse({
        action,
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-05-20T12:03:00.000Z",
        runtimeAttemptId: "runtime_attempt_test",
      })).toEqual({
        action,
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-05-20T12:03:00.000Z",
        runtimeAttemptId: "runtime_attempt_test",
      });
    }

    expect(parseHostedRuntimeEnsureProcessingResponse({
      kind: "retry_later",
      retryAt: "2026-05-20T12:04:00.000Z",
    })).toEqual({
      kind: "retry_later",
      retryAt: "2026-05-20T12:04:00.000Z",
    });

  });

  it("rejects raw payload-shaped fields and completion shortcuts in ensure-processing contracts", () => {
    expect(() => parseHostedRuntimeEnsureProcessingRequest({
      aiUsageAllowDecision: createAiUsageAllowDecision(),
      orchestrationAttemptId: "orchestration_attempt_test",
    })).toThrow(
      "Hosted runtime ensure-processing request must not include aiUsageAllowDecision.",
    );

    expect(() => parseHostedRuntimeEnsureProcessingRequest({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
    })).toThrow(
      "Hosted runtime ensure-processing request must not include reason.",
    );

    expect(() => parseHostedRuntimeEnsureProcessingRequest({
      orchestrationAttemptId: "orchestration_attempt_test",
      source: "device_sync_recovery",
    })).toThrow(
      "Hosted runtime ensure-processing request must not include source.",
    );

    expect(() => parseHostedRuntimeEnsureProcessingResponse({
      action: "woken",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: "runtime_attempt_test",
    })).toThrow(
      "Hosted runtime processing-accepted response recommendedRecheckAt must be a string or null.",
    );

    expect(() => parseHostedRuntimeEnsureProcessingResponse({
      action: "woken",
      kind: "runtime_processing_accepted",
      mailboxLag: [],
      recommendedRecheckAt: "2026-05-20T12:03:00.000Z",
      runtimeAttemptId: "runtime_attempt_test",
    })).toThrow("Hosted runtime processing-accepted response must not include mailboxLag.");

    expect(() => parseHostedRuntimeEnsureProcessingResponse({
      action: "woken",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: null,
      runtimeAttemptId: "runtime_attempt_test",
    })).toThrow(
      "Hosted runtime processing-accepted response recommendedRecheckAt must be a string.",
    );

    expect(() => parseHostedRuntimeEnsureProcessingResponse({
      kind: "retry_later",
      mailboxLag: [],
      retryAt: "2026-05-20T12:04:00.000Z",
    })).toThrow(
      "Hosted runtime processing retry-later response must not include mailboxLag.",
    );

    expect(() => parseHostedRuntimeEnsureProcessingResponse({
      kind: "retry_later",
      reason: "container rpc timeout",
      retryAt: "2026-05-20T12:04:00.000Z",
    })).toThrow(
      "Hosted runtime processing retry-later response must not include reason.",
    );
  });

});

function createMailboxLag(): HostedMailboxLaneLag[] {
  return [
    {
      importedSeq: "2",
      lag: "1",
      lane: "conversation",
      maxSeq: "3",
      maxUpdatedAt: "2026-05-20T12:00:00.000Z",
    },
  ];
}

function createWorkspaceProjection(): HostedRuntimeReconciliationFactsWorkspace {
  return {
    inboxMediaRetentionWakeAt: null,
    nextWakeAt: null,
    nextWakeReason: null,
    version: "7",
  };
}

function createAiUsageAllowDecision(): HostedAiUsageAllowDecision {
  return {
    allowed: true,
    expiresAt: "2026-05-20T12:05:00.000Z",
    issuedAt: "2026-05-20T12:00:00.000Z",
    nonce: "nonce_test",
    schema: HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA,
    signature: {
      alg: HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG,
      keyId: "key_test",
      signature: "signature_test",
    },
    userId: "user_test",
  };
}
