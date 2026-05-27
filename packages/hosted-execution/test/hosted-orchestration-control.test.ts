import { describe, expect, it } from "vitest";

import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
  HOSTED_RUNTIME_DEMAND_RUN_SOURCES,
  type HostedRuntimeDemandWorkspaceProjection,
  type HostedRuntimeSignal,
} from "../src/orchestration-control.ts";
import {
  HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA,
  HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG,
  type HostedAiUsageAllowDecision,
  type HostedMailboxLaneLag,
} from "../src/runtime-control.ts";
import {
  parseHostedRuntimeDemand,
  parseHostedRuntimeDemandRequest,
  parseHostedRuntimeEnsureProcessingRequest,
  parseHostedRuntimeEnsureProcessingResponse,
  parseHostedRuntimePrewarmRequest,
  parseHostedRuntimePrewarmResponse,
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
        source: "email:agentmail",
      },
      {
        kind: "manual_run_requested",
      },
      {
        kind: "browser_vault_refresh_requested",
      },
      {
        kind: "device_sync_recovery_requested",
      },
      {
        kind: "mailbox_lag_observed",
      },
      {
        kind: "runtime_recheck_requested",
      },
      {
        eventId: "runtime-prewarm:event-test",
        kind: "runtime_prewarm_requested",
        occurredAt: "2026-05-20T12:00:00.000Z",
        scopeHash: "linq-chat:scope-test",
        source: "linq.imessage.typing",
      },
    ];

    for (const signal of signals) {
      expect(parseHostedRuntimeSignal(signal)).toEqual(signal);
    }
  });

  it("keeps typing prewarm out of durable demand sources", () => {
    expect(HOSTED_RUNTIME_DEMAND_RUN_SOURCES).not.toContain(
      "linq.imessage.typing",
    );
  });

  it("rejects raw payload-shaped fields in runtime signals", () => {
    const baseSignal = {
      kind: "manual_run_requested",
    };

    expect(() => parseHostedRuntimeSignal({
      ...baseSignal,
      eventId: "hosted-orchestration-smoke",
    })).toThrow("Hosted runtime manual-run signal must not include eventId.");

    expect(() => parseHostedRuntimeSignal({
      ...baseSignal,
      source: "test",
    })).toThrow("Hosted runtime manual-run signal must not include source.");

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
      })).toThrow(`Hosted runtime manual-run signal must not include ${field}.`);
    }

    expect(() => parseHostedRuntimeSignal({
      kind: "mailbox_appended",
      lane: "conversation",
      laneSeq: "42",
      mailboxItemId: "mailbox_item_test",
      source: "Provider",
    })).toThrow(/safe source string/u);

    expect(() => parseHostedRuntimeSignal({
      kind: "mailbox_appended",
      lane: "conversation",
      laneSeq: "42",
      mailboxItemId: "mailbox_item_test",
      source: " ".repeat(1),
    })).toThrow(/safe source string/u);
  });

  it("parses demand requests and demand responses", () => {
    const demandRequest = {
      browserVaultRefreshRequested: true,
      deviceSyncRecoveryRequested: true,
      lagRecoveryObserved: false,
      manualRunRequested: true,
      userId: "user_test",
    };
    const mailboxLag = createMailboxLag();
    const workspace = createWorkspaceProjection();

    expect(parseHostedRuntimeDemandRequest(demandRequest)).toEqual(demandRequest);
    expect(parseHostedRuntimeDemandRequest({ userId: "user_test" })).toEqual({
      userId: "user_test",
    });
    expect(parseHostedRuntimeDemand({
      kind: "run",
      mailboxLag,
      reason: "nudge",
      source: "mailbox_backlog",
      workspace,
    })).toEqual({
      kind: "run",
      mailboxLag,
      reason: "nudge",
      source: "mailbox_backlog",
      workspace,
    });
    expect(parseHostedRuntimeDemand({
      kind: "idle",
      mailboxLag,
      nextWakeAt: "2026-05-20T12:01:00.000Z",
      workspace,
    })).toEqual({
      kind: "idle",
      mailboxLag,
      nextWakeAt: "2026-05-20T12:01:00.000Z",
      workspace,
    });
    expect(parseHostedRuntimeDemand({
      kind: "blocked",
      mailboxLag,
      reason: "ai_usage_gate_unavailable",
      retryAt: "2026-05-20T12:02:00.000Z",
      workspace: null,
    })).toEqual({
      kind: "blocked",
      mailboxLag,
      reason: "ai_usage_gate_unavailable",
      retryAt: "2026-05-20T12:02:00.000Z",
      workspace: null,
    });
  });

  it("rejects raw payload-shaped fields in demand contracts", () => {
    expect(() => parseHostedRuntimeDemandRequest({
      payload: true,
      userId: "user_test",
    })).toThrow("Hosted runtime demand request must not include payload.");

    expect(() => parseHostedRuntimeDemand({
      body: true,
      kind: "idle",
      mailboxLag: [],
      nextWakeAt: null,
      workspace: null,
    })).toThrow("Hosted runtime idle demand must not include body.");

    expect(() => parseHostedRuntimeDemand({
      kind: "run",
      mailboxLag: [],
      reason: "nudge",
      source: "mailbox_backlog",
      workspace: null,
    })).not.toThrow();

    expect(() => parseHostedRuntimeDemand({
      kind: "run",
      mailboxLag: [],
      reason: "nudge",
      requiresAiUsageDecision: false,
      source: "mailbox_backlog",
      workspace: null,
    })).toThrow("Hosted runtime run demand must not include requiresAiUsageDecision.");

    expect(() => parseHostedRuntimeDemand({
      kind: "run",
      mailboxLag: [],
      rawPayload: true,
      reason: "nudge",
      source: "mailbox_backlog",
      workspace: null,
    })).toThrow("Hosted runtime run demand must not include rawPayload.");

    expect(() => parseHostedRuntimeDemand({
      aiUsageAllowDecision: createAiUsageAllowDecision(),
      kind: "run",
      mailboxLag: [],
      reason: "nudge",
      source: "mailbox_backlog",
      workspace: null,
    })).toThrow("Hosted runtime run demand must not include aiUsageAllowDecision.");

    expect(() => parseHostedRuntimeDemand({
      kind: "idle",
      mailboxLag: [],
      nextWakeAt: null,
      workspace: {
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {},
        version: "7",
      },
    })).toThrow("Hosted runtime demand workspace projection must not include redactedStatus.");
  });

  it("parses ensure-processing request and response variants", () => {
    expect(parseHostedRuntimeEnsureProcessingRequest({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "manual",
      source: "device_sync_recovery",
    })).toEqual({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "manual",
      source: "device_sync_recovery",
    });

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
      reason: "nudge",
    })).toThrow(
      "Hosted runtime ensure-processing request must not include aiUsageAllowDecision.",
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

  it("parses prewarm request and response variants without mailbox fields", () => {
    expect(parseHostedRuntimePrewarmRequest({
      prewarmAttemptId: "prewarm_attempt_test",
      source: "linq.imessage.typing",
    })).toEqual({
      prewarmAttemptId: "prewarm_attempt_test",
      source: "linq.imessage.typing",
    });

    for (const action of [
      "started",
      "already_warm",
      "already_running",
    ] as const) {
      expect(parseHostedRuntimePrewarmResponse({
        action,
        kind: "runtime_prewarm_accepted",
      })).toEqual({
        action,
        kind: "runtime_prewarm_accepted",
      });
    }

    expect(parseHostedRuntimePrewarmResponse({
      kind: "retry_later",
      retryAt: "2026-05-20T12:04:00.000Z",
    })).toEqual({
      kind: "retry_later",
      retryAt: "2026-05-20T12:04:00.000Z",
    });
  });

  it("rejects mailbox and processing fields in prewarm contracts", () => {
    expect(() => parseHostedRuntimePrewarmRequest({
      prewarmAttemptId: "prewarm_attempt_test",
      reason: "nudge",
      source: "linq.imessage.typing",
    })).toThrow("Hosted runtime prewarm request must not include reason.");

    expect(() => parseHostedRuntimePrewarmResponse({
      action: "already_warm",
      kind: "runtime_prewarm_accepted",
      runtimeAttemptId: "runtime_attempt_test",
    })).toThrow(
      "Hosted runtime prewarm-accepted response must not include runtimeAttemptId.",
    );

    expect(() => parseHostedRuntimePrewarmResponse({
      kind: "retry_later",
      mailboxLag: [],
      retryAt: "2026-05-20T12:04:00.000Z",
    })).toThrow(
      "Hosted runtime prewarm retry-later response must not include mailboxLag.",
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

function createWorkspaceProjection(): HostedRuntimeDemandWorkspaceProjection {
  return {
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
