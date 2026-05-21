import { describe, expect, it } from "vitest";

import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
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
  parseHostedRuntimeEnsureExecutionRequest,
  parseHostedRuntimeEnsureExecutionResponse,
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
    ];

    for (const signal of signals) {
      expect(parseHostedRuntimeSignal(signal)).toEqual(signal);
    }
  });

  it("rejects raw payload-shaped fields in runtime signals", () => {
    const baseSignal = {
      kind: "manual_run_requested",
    };

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
      ignoredWorkspaceWakeKey: "7:2026-05-20T12:01:00.000Z:assistant",
      lagRecoveryObserved: false,
      manualRunRequested: true,
      runtimeResultWakeAt: "2026-05-20T12:00:30.000Z",
      runtimeResultWakeReason: "assistant",
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
      kind: "run",
      mailboxLag,
      reason: "retry",
      source: "runtime_result_wake",
      workspace: null,
    })).toEqual({
      kind: "run",
      mailboxLag,
      reason: "retry",
      source: "runtime_result_wake",
      workspace: null,
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

  it("parses ensure-execution request and every response variant", () => {
    expect(parseHostedRuntimeEnsureExecutionRequest({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "manual",
    })).toEqual({
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "manual",
    });
    expect(parseHostedRuntimeEnsureExecutionResponse({
      action: "started",
      kind: "runtime_completed",
      runtimeAttemptId: "runtime_attempt_test",
      runtimeResultNextWakeAt: "2026-05-20T12:03:00.000Z",
      runtimeResultNextWakeReason: "assistant",
      runtimeStatus: "idle",
    })).toEqual({
      action: "started",
      kind: "runtime_completed",
      runtimeAttemptId: "runtime_attempt_test",
      runtimeResultNextWakeAt: "2026-05-20T12:03:00.000Z",
      runtimeResultNextWakeReason: "assistant",
      runtimeStatus: "idle",
    });
    expect(parseHostedRuntimeEnsureExecutionResponse({
      kind: "runtime_wake_sent",
      recommendedRecheckAt: null,
      runtimeAttemptId: "runtime_attempt_test",
    })).toEqual({
      kind: "runtime_wake_sent",
      recommendedRecheckAt: null,
      runtimeAttemptId: "runtime_attempt_test",
    });
    expect(parseHostedRuntimeEnsureExecutionResponse({
      action: "replaced",
      kind: "runtime_completed",
      runtimeAttemptId: "runtime_attempt_replacement_test",
      runtimeResultNextWakeAt: null,
      runtimeResultNextWakeReason: null,
      runtimeStatus: "scheduled",
    })).toEqual({
      action: "replaced",
      kind: "runtime_completed",
      runtimeAttemptId: "runtime_attempt_replacement_test",
      runtimeResultNextWakeAt: null,
      runtimeResultNextWakeReason: null,
      runtimeStatus: "scheduled",
    });
    expect(() => parseHostedRuntimeEnsureExecutionResponse({
      action: "started",
      kind: "runtime_completed",
      runtimeAttemptId: "runtime_attempt_missing_reason_test",
      runtimeResultNextWakeAt: "2026-05-20T12:03:00.000Z",
      runtimeStatus: "idle",
    })).toThrow(
      "Hosted runtime completed response runtimeResultNextWakeReason must be a string or null.",
    );
  });

  it("rejects raw payload-shaped fields and completion shortcuts in ensure-execution contracts", () => {
    expect(() => parseHostedRuntimeEnsureExecutionRequest({
      aiUsageAllowDecision: createAiUsageAllowDecision(),
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
    })).toThrow(
      "Hosted runtime ensure-execution request must not include aiUsageAllowDecision.",
    );

    expect(() => parseHostedRuntimeEnsureExecutionRequest({
      headers: true,
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
    })).toThrow("Hosted runtime ensure-execution request must not include headers.");

    expect(() => parseHostedRuntimeEnsureExecutionResponse({
      kind: "caught-up",
      runtimeAttemptId: "runtime_attempt_test",
    })).toThrow(/Hosted runtime ensure-execution response kind is not supported/u);

    expect(() => parseHostedRuntimeEnsureExecutionResponse({
      kind: "runtime_wake_sent",
      mailboxLag: [],
      recommendedRecheckAt: null,
      runtimeAttemptId: "runtime_attempt_test",
    })).toThrow("Hosted runtime wake-sent response must not include mailboxLag.");

    expect(() => parseHostedRuntimeEnsureExecutionResponse({
      action: "started",
      kind: "runtime_completed",
      payload: true,
      runtimeAttemptId: "runtime_attempt_test",
      runtimeResultNextWakeAt: null,
      runtimeResultNextWakeReason: null,
      runtimeStatus: "idle",
    })).toThrow("Hosted runtime completed response must not include payload.");

    expect(() => parseHostedRuntimeEnsureExecutionResponse({
      action: "started",
      kind: "runtime_completed",
      redactedStatus: {},
      runtimeAttemptId: "runtime_attempt_test",
      runtimeResultNextWakeAt: null,
      runtimeResultNextWakeReason: null,
      runtimeStatus: "idle",
    })).toThrow("Hosted runtime completed response must not include redactedStatus.");
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
