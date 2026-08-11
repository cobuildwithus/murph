import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionGroupNewsletterEmailNeededWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionPendingEffectsReconcileRequestedWake,
  buildHostedExecutionRuntimeControlWake,
} from "@murphai/hosted-execution";
import {
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(async (value) => value),
  initializeAssistantGroupRoomModel: vi.fn(),
  prepareHostedWakeContext: vi.fn(),
  sendAssistantNotification: vi.fn(),
  upsertAssistantCronAutomation: vi.fn(),
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  hydrateHostedExecutionDefaultTarget: mocks.hydrateHostedExecutionDefaultTarget,
  prepareHostedWakeContext: mocks.prepareHostedWakeContext,
}));

vi.mock("@murphai/assistant-engine", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-engine")>(
    "@murphai/assistant-engine",
  );

  return {
    ...actual,
    initializeAssistantGroupRoomModel:
      mocks.initializeAssistantGroupRoomModel,
    sendAssistantNotification: mocks.sendAssistantNotification,
    upsertAssistantCronAutomation: mocks.upsertAssistantCronAutomation,
  };
});

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );

  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  executeHostedMailboxEvent,
  emitHostedAssistantProviderTraceLog,
} from "../src/hosted-runtime/events.ts";
import { emitHostedAssistantContextTraceLog } from "../src/hosted-runtime/context-diagnostics.ts";

const executionContext = {
  hosted: {
    memberId: "member_123",
    userEnvKeys: [],
  },
} as const;

function createRuntime(userEnv: Readonly<Record<string, string>> = {}) {
  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform: {
      artifactStore: {
        async get() {
          return null;
        },
        async put() {},
      },
      deviceSyncPort: null,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      usageRecordPort: null,
    },
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: { ...userEnv },
  } as const;
}

function expectHostedTurnEnvironment(input: {
  env?: Record<string, string>;
  vaultRoot: string;
}) {
  return {
    currentWorkingDirectory: null,
    env: expect.objectContaining({
      ...(input.env ?? {}),
      MURPH_HOSTED_RUNTIME_PROCESS: "1",
      VAULT: input.vaultRoot,
    }),
  };
}

function createQueuedNotificationResult(intentId = "intent_notification") {
  return {
    decision: {
      kind: "send_message",
      privateSummary: "Notification accepted for delivery.",
      text: "Welcome to Murph.",
    },
    deliveryOutcome: {
      error: null,
      intentId,
      kind: "queued",
      media: [],
      session: {
        sessionId: "session_notification",
      },
    },
    response: "Welcome to Murph.",
    session: {
      sessionId: "session_notification",
    },
  };
}

beforeEach(() => {
  mocks.initializeAssistantGroupRoomModel.mockResolvedValue({
    kind: "initialized",
    state: {
      body: "## Explicit setup\n\nKeep this room low-key.",
      digest: "sha256:test",
      kind: "present",
      status: "active",
    },
  });
  mocks.sendAssistantNotification.mockResolvedValue(createQueuedNotificationResult());
});

afterEach(() => {
  vi.clearAllMocks();
  mocks.emitHostedExecutionStructuredLog.mockReset();
  mocks.prepareHostedWakeContext.mockResolvedValue(null);
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (value) => value);
});

describe("executeHostedMailboxEvent", () => {
  it("drops spoofed raw-looking values from hosted context diagnostic traces", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_context_spoof",
      memberId: "member_123",
      notification: {
        instructions: "Send exactly the signup welcome.",
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const entry = emitHostedAssistantContextTraceLog({
      event: {
        rawEvent: {
          schema: "murph.assistant-context-diagnostics.v1",
          type: "assistant.context.diagnostics",
          stage: "assistant-session-resolved",
          source: "assistant-notification",
          channel: "linq",
          actorFingerprint: "h1_abcdef0123456789abcdef01",
          threadFingerprint: "raw-thread-id",
          sessionFingerprint: "raw-session-id",
          primaryConversationScope: "thread",
          actorFallbackConversationScope: "raw-scope",
          sessionTurnCount: -1,
          actorFallbackConversationIndexed: true,
          conversationLookupIndexedCandidateCount: 1,
          conversationLookupKeyCount: 2,
          conversationLookupMatchedScope: "thread",
          primaryConversationIndexed: false,
          sessionResolutionLookupSource: "conversation-key",
        },
      },
      wake,
    });

    expect(entry?.redacted).toEqual(
      expect.objectContaining({
        actorFingerprint: "h1_abcdef0123456789abcdef01",
        actorFallbackConversationIndexed: true,
        channel: "linq",
        conversationLookupIndexedCandidateCount: 1,
        conversationLookupKeyCount: 2,
        conversationLookupMatchedScope: "thread",
        primaryConversationIndexed: false,
        primaryConversationScope: "thread",
        schema: "murph.assistant-context-diagnostics.v1",
        sessionResolutionLookupSource: "conversation-key",
        source: "assistant-notification",
        stage: "assistant-session-resolved",
      }),
    );
    expect(entry?.redacted).not.toHaveProperty("threadFingerprint");
    expect(entry?.redacted).not.toHaveProperty("sessionFingerprint");
    expect(entry?.redacted).not.toHaveProperty("actorFallbackConversationScope");
    expect(entry?.redacted).not.toHaveProperty("sessionTurnCount");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-thread-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-session-id");
  });

  it("captures hosted context timing diagnostics as metadata only", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_context_timing",
      memberId: "member_123",
      notification: {
        instructions: "Reply in chat.",
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const entry = emitHostedAssistantContextTraceLog({
      event: {
        rawEvent: {
          schema: "murph.assistant-context-diagnostics.v1",
          type: "assistant.context.diagnostics",
          stage: "assistant-pre-provider-ready",
          preProviderAdmissionCount: 0,
          preProviderSetupMs: 123,
          providerRequestOrdinal: 0,
          turnLockWaitMs: 45,
          rawUserId: "raw-user-id",
          rawPrompt: "raw prompt text",
        },
      },
      wake,
    });

    expect(entry).toEqual({
      component: "runtime.context",
      eventId: "evt_context_timing",
      level: "info",
      message: "Hosted assistant context timing captured.",
      phase: "wake.running",
      redacted: expect.objectContaining({
        preProviderAdmissionCount: 0,
        preProviderSetupMs: 123,
        providerRequestOrdinal: 0,
        schema: "murph.assistant-context-diagnostics.v1",
        stage: "assistant-pre-provider-ready",
        turnLockWaitMs: 45,
      }),
    });
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-user-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw prompt text");
  });

  it("captures hosted turn-lock timing diagnostics as metadata only", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_context_lock_timing",
      memberId: "member_123",
      notification: {
        instructions: "Reply in chat.",
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const entry = emitHostedAssistantContextTraceLog({
      event: {
        rawEvent: {
          schema: "murph.assistant-context-diagnostics.v1",
          type: "assistant.context.diagnostics",
          stage: "assistant-turn-lock-acquired",
          turnLockWaitMs: 321,
          rawUserId: "raw-user-id",
          rawPrompt: "raw prompt text",
        },
      },
      wake,
    });

    expect(entry).toEqual({
      component: "runtime.context",
      eventId: "evt_context_lock_timing",
      level: "info",
      message: "Hosted assistant context timing captured.",
      phase: "wake.running",
      redacted: expect.objectContaining({
        schema: "murph.assistant-context-diagnostics.v1",
        stage: "assistant-turn-lock-acquired",
        turnLockWaitMs: 321,
      }),
    });
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-user-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw prompt text");
  });

  it("captures hosted Codex invalid-output diagnostics without raw identifiers", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_codex_invalid_output",
      memberId: "member_123",
      notification: {
        instructions: "Reply in chat.",
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const entry = emitHostedAssistantProviderTraceLog({
      details: Object.fromEntries(
        Array.from({ length: 60 }, (_value, index) => [
          `context${index}`,
          `value-${index}`,
        ]),
      ),
      event: {
        codexThreadId: "raw-provider-session-id",
        rawEvent: {
          schema: "murph.assistant-codex-invalid-output-diagnostics.v1",
          type: "assistant.codex.invalid_output_resume_failure",
          providerTraceKind: "codex.invalid_output_resume_failure",
          codexInvalidOutputTraceType: "failure",
          codexInvalidOutputPhase: "resume-failed",
          codexInvalidOutputInputIndex: 193,
          codexInvalidOutputErrorField: "input.193.output",
          codexInvalidOutputErrorCode: "ASSISTANT_CODEX_FAILED",
          codexInvalidOutputErrorKind: "invalid-input-output",
          codexInvalidOutputErrorMessageLength: 96,
          codexInvalidOutputErrorPreview: "raw HbA1c 9.1 should not persist",
          codexInvalidOutputFallbackAttempted: true,
          codexInvalidOutputFallbackErrorCode: "ASSISTANT_CODEX_FAILED",
          codexInvalidOutputFallbackResult: "succeeded",
          codexInvalidOutputResumeSessionPresent: true,
          codexInvalidOutputFailureSessionPresent: true,
          codexInvalidOutputFailureTurnPresent: true,
          codexInvalidOutputResumeMatchesFailureSession: true,
          codexInvalidOutputFailureProviderActionCount: 2,
          codexInvalidOutputFailureEventCount: 3,
          codexInvalidOutputFailureEventMethods: [
            "turn/started",
            "turn/completed",
            "private HbA1c 9.1",
          ],
          codexInvalidOutputFailureEventStatuses: ["failed", "private symptom"],
          codexInvalidOutputFailureOutputKinds: ["array", "private health"],
          codexInvalidOutputFailureOutputObjectKeys: [
            "[key],text,type",
            "HbA1c,patientName",
          ],
          codexInvalidOutputFailureOutputArrayLengths: [2],
          codexInvalidOutputFailureOutputPartTypes: [
            "input_text",
            "input_image",
            "https://example.invalid/raw-part-type",
          ],
          codexInvalidOutputFailureParamKeys: [
            "[key]",
            "output,HbA1c",
          ],
          codexThreadId: "raw-provider-session-id",
        },
        updates: [],
      },
      wake,
    });

    expect(entry).toEqual(
      expect.objectContaining({
        component: "runtime.provider",
        eventId: "evt_codex_invalid_output",
        level: "info",
        message: "Hosted assistant Codex invalid-output diagnostics captured.",
        phase: "wake.running",
        redacted: expect.objectContaining({
          codexInvalidOutputErrorCode: "ASSISTANT_CODEX_FAILED",
          codexInvalidOutputErrorField: "input.193.output",
          codexInvalidOutputErrorKind: "invalid-input-output",
          codexInvalidOutputErrorMessageLength: 96,
          codexInvalidOutputFailureEventMethods: [
            "turn/started",
            "turn/completed",
          ],
          codexInvalidOutputFailureEventStatuses: ["failed"],
          codexInvalidOutputFailureOutputObjectKeys: ["[key],text,type"],
          codexInvalidOutputFailureOutputArrayLengths: [2],
          codexInvalidOutputFailureOutputKinds: ["array"],
          codexInvalidOutputFailureOutputPartTypes: [
            "input_text",
            "input_image",
          ],
          codexInvalidOutputFailureParamKeys: ["[key]"],
          codexInvalidOutputFailureProviderActionCount: 2,
          codexInvalidOutputInputIndex: 193,
          codexInvalidOutputPhase: "resume-failed",
          codexInvalidOutputTraceType: "failure",
          providerTraceKind: "codex.invalid_output_resume_failure",
          schema: "murph.assistant-codex-invalid-output-diagnostics.v1",
        }),
      }),
    );
    expect(entry?.redacted).not.toHaveProperty("codexThreadId");
    expect(entry?.redacted).not.toHaveProperty("codexInvalidOutputErrorPreview");
    expect(entry?.redacted).not.toHaveProperty("codexInvalidOutputFallbackAttempted");
    expect(entry?.redacted).not.toHaveProperty("codexInvalidOutputFallbackErrorCode");
    expect(entry?.redacted).not.toHaveProperty("codexInvalidOutputFallbackResult");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-provider-session-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("HbA1c");
    expect(JSON.stringify(entry?.redacted)).not.toContain("patientName");
    expect(JSON.stringify(entry?.redacted)).not.toContain("example.invalid");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime.provider",
        message: "Hosted assistant Codex invalid-output diagnostics captured.",
        phase: "wake.running",
        wake,
      }),
    );
  });

  it("captures hosted Codex resume-failure diagnostics without raw identifiers", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_codex_resume_failure",
      memberId: "member_123",
      notification: {
        instructions: "Reply in chat.",
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const entry = emitHostedAssistantProviderTraceLog({
      details: {},
      event: {
        codexThreadId: "raw-provider-session-id",
        rawEvent: {
          schema: "murph.assistant-codex-resume-failure-diagnostics.v1",
          type: "assistant.codex.resume_failure",
          providerTraceKind: "codex.resume_failure",
          codexResumeFailureTraceType: "failure",
          codexResumeFailurePhase: "resume-failed",
          codexResumeFailureCodexAbortRequested: false,
          codexResumeFailureCodexExitSignal: "SIGKILL",
          codexResumeFailureCodexFailureStage: "turn_failed",
          codexResumeFailureCodexTurnStatus: "failed",
          codexResumeFailureCodexJsonEventCount: 3,
          codexResumeFailureCodexLifecycleStage: "turn_running",
          codexResumeFailureCodexLiveTurnOpen: true,
          codexResumeFailureCodexPendingRpcCount: 1,
          codexResumeFailureCodexPendingRpcMethod: "turn/start",
          codexResumeFailureCodexProcessGroupPresent: true,
          codexResumeFailureCodexProcessLifetimeMs: 2041,
          codexResumeFailureCodexProviderRequestStarted: true,
          codexResumeFailureCodexShutdownRequested: false,
          codexResumeFailureCodexStderrBytes: 128,
          codexResumeFailureCodexTerminationSignalSent: "SIGTERM",
          codexResumeFailureErrorCode: "ASSISTANT_CODEX_APP_SERVER_RPC_FAILED",
          codexResumeFailureErrorKind: "rpc-failed",
          codexResumeFailureErrorMessage:
            "Codex app-server turn failed. status failed. Authorization: Bearer raw-token-value",
          codexResumeFailureErrorMessageLength: 251,
          codexResumeFailureErrorMessagePresent: true,
          codexResumeFailureErrorPhrases: [
            "codex-turn-failed",
            "status-failed",
            "raw private value",
          ],
          codexResumeFailureResumeSessionPresent: true,
          codexResumeFailureSessionPresent: true,
          codexResumeFailureTurnPresent: true,
          codexResumeFailureResumeMatchesFailureSession: true,
          codexResumeFailureProviderActionCount: 0,
          codexResumeFailureEventCount: 2,
          codexResumeFailureEventMethods: [
            "rpc.error",
            "turn/completed",
            "private method",
          ],
          codexResumeFailureEventStatuses: [
            "failed",
            "turn_failed",
            "private symptom",
          ],
          codexResumeFailureEventKinds: ["message", "process_exit", "private"],
          codexResumeFailureOutputKinds: ["array", "object", "private value"],
          codexResumeFailureOutputArrayLengths: [3],
          codexResumeFailureOutputPartTypes: [
            "input_text",
            "process_exit",
            "https://example.invalid/raw-part-type",
          ],
          codexResumeFailureOutputObjectKeys: [
            "[key],text,type",
            "privateField,privateName",
          ],
          codexResumeFailureOutputStringLengths: [48],
          codexResumeFailureParamKeys: [
            "[key]",
            "output,[key]",
            "output,privateField",
          ],
          codexResumeFailureRetryable: false,
          codexResumeFailureErrorPreview: "raw private text should not persist",
          codexThreadId: "raw-provider-session-id",
        },
        updates: [],
      },
      wake,
    });

    expect(entry).toEqual(
      expect.objectContaining({
        component: "runtime.provider",
        eventId: "evt_codex_resume_failure",
        level: "info",
        message: "Hosted assistant Codex resume-failure diagnostics captured.",
        phase: "wake.running",
        redacted: expect.objectContaining({
          codexResumeFailureCodexAbortRequested: false,
          codexResumeFailureCodexExitSignal: "SIGKILL",
          codexResumeFailureCodexFailureStage: "turn_failed",
          codexResumeFailureCodexTurnStatus: "failed",
          codexResumeFailureCodexJsonEventCount: 3,
          codexResumeFailureCodexLifecycleStage: "turn_running",
          codexResumeFailureCodexLiveTurnOpen: true,
          codexResumeFailureCodexPendingRpcCount: 1,
          codexResumeFailureCodexPendingRpcMethod: "turn/start",
          codexResumeFailureCodexProcessGroupPresent: true,
          codexResumeFailureCodexProcessLifetimeMs: 2041,
          codexResumeFailureCodexProviderRequestStarted: true,
          codexResumeFailureCodexShutdownRequested: false,
          codexResumeFailureCodexStderrBytes: 128,
          codexResumeFailureCodexTerminationSignalSent: "SIGTERM",
          codexResumeFailureErrorCode: "ASSISTANT_CODEX_APP_SERVER_RPC_FAILED",
          codexResumeFailureErrorKind: "rpc-failed",
          codexResumeFailureErrorMessage:
            "Codex app-server turn failed. status failed. Authorization=Bearer [redacted]",
          codexResumeFailureErrorMessageLength: 251,
          codexResumeFailureErrorMessagePresent: true,
          codexResumeFailureErrorPhrases: [
            "codex-turn-failed",
            "status-failed",
          ],
          codexResumeFailureEventCount: 2,
          codexResumeFailureEventKinds: ["message", "process_exit"],
          codexResumeFailureEventMethods: ["rpc.error", "turn/completed"],
          codexResumeFailureEventStatuses: ["failed", "turn_failed"],
          codexResumeFailureOutputArrayLengths: [3],
          codexResumeFailureOutputKinds: ["array", "object"],
          codexResumeFailureOutputObjectKeys: ["[key],text,type"],
          codexResumeFailureOutputPartTypes: ["input_text", "process_exit"],
          codexResumeFailureOutputStringLengths: [48],
          codexResumeFailureParamKeys: ["[key]", "output,[key]"],
          codexResumeFailurePhase: "resume-failed",
          codexResumeFailureProviderActionCount: 0,
          codexResumeFailureResumeMatchesFailureSession: true,
          codexResumeFailureResumeSessionPresent: true,
          codexResumeFailureRetryable: false,
          codexResumeFailureSessionPresent: true,
          codexResumeFailureTraceType: "failure",
          codexResumeFailureTurnPresent: true,
          providerTraceKind: "codex.resume_failure",
          schema: "murph.assistant-codex-resume-failure-diagnostics.v1",
        }),
      }),
    );
    expect(entry?.redacted).not.toHaveProperty("codexThreadId");
    expect(entry?.redacted).not.toHaveProperty("codexResumeFailureErrorPreview");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-provider-session-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-token-value");
    expect(JSON.stringify(entry?.redacted)).not.toContain("privateField");
    expect(JSON.stringify(entry?.redacted)).not.toContain("privateName");
    expect(JSON.stringify(entry?.redacted)).not.toContain("example.invalid");
    expect(JSON.stringify(entry?.redacted)).not.toContain("private");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime.provider",
        message: "Hosted assistant Codex resume-failure diagnostics captured.",
        phase: "wake.running",
        wake,
      }),
    );
  });

  it("captures hosted Codex app-server timing without raw identifiers", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_codex_timing",
      memberId: "member_123",
      notification: {
        instructions: "Reply in chat.",
        route: {
          actorId: "actor_codex_timing",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const entry = emitHostedAssistantProviderTraceLog({
      details: {
        requestId: "req_123",
      },
      event: {
        codexThreadId: "raw-provider-session-id",
        rawEvent: {
          schema: "murph.assistant-codex-app-server-timing.v1",
          type: "assistant.codex.app_server_timing",
          codexTimingColdStartReason: "node-process-first-use",
          codexTimingElapsedMs: 8123,
          codexTimingProviderActionCount: 1,
          codexTimingThreadIdPresent: true,
          codexTimingStage: "initialized",
          codexTimingTotalElapsedMs: 11042,
          codexTimingTurnIdPresent: true,
          cwd: "/tmp/raw-path",
          threadId: "raw-thread-id",
        },
      },
      wake,
    });

    expect(entry).toEqual({
      component: "runtime.provider",
      eventId: "evt_codex_timing",
      level: "info",
      message: "Hosted assistant Codex app-server timing captured.",
      phase: "wake.running",
      redacted: expect.objectContaining({
        codexTimingColdStartReason: "node-process-first-use",
        codexTimingElapsedMs: 8123,
        codexTimingProviderActionCount: 1,
        codexTimingThreadIdPresent: true,
        codexTimingStage: "initialized",
        codexTimingTotalElapsedMs: 11042,
        codexTimingTraceType: "app-server",
        codexTimingTurnIdPresent: true,
        providerTraceKind: "codex.app_server_timing",
        requestId: "req_123",
        schema: "murph.assistant-codex-app-server-timing.v1",
      }),
    });
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-provider-session-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-thread-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("/tmp/raw-path");

    const invalidReasonEntry = emitHostedAssistantProviderTraceLog({
      details: { requestId: "req_123" },
      event: {
        rawEvent: {
          schema: "murph.assistant-codex-app-server-timing.v1",
          type: "assistant.codex.app_server_timing",
          codexTimingColdStartReason: "raw-unbounded-reason",
          codexTimingElapsedMs: 1,
          codexTimingStage: "initialized",
        },
      },
      wake,
    });
    expect(invalidReasonEntry).not.toBeNull();
    expect(invalidReasonEntry?.redacted).not.toHaveProperty(
      "codexTimingColdStartReason",
    );
    expect(JSON.stringify(invalidReasonEntry)).not.toContain(
      "raw-unbounded-reason",
    );
  });

  it("captures hosted Codex transport diagnostics without raw payloads", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_codex_transport_diagnostics",
      memberId: "member_123",
      notification: {
        instructions: "Reply in chat.",
        route: {
          actorId: "actor_codex_transport",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const entry = emitHostedAssistantProviderTraceLog({
      details: {
        requestId: "req_123",
      },
      event: {
        codexThreadId: "raw-provider-session-id",
        rawEvent: {
          schema: "murph.assistant-codex-transport-diagnostics.v1",
          type: "assistant.codex.transport_diagnostics",
          codexTransportAdditionalDetailsPresent: true,
          codexTransportErrorMessage: "raw provider message must not appear",
          codexTransportErrorMessageLength: 144,
          codexTransportErrorMessagePresent: true,
          codexTransportEventKind: "stream-idle-timeout",
          codexTransportFallbackActivated: false,
          codexTransportIdleTimeout: true,
          codexTransportProviderActionCount: 0,
          codexTransportRetryCount: 2,
          codexTransportRetryExhausted: false,
          codexTransportRetryMax: 5,
          codexTransportSourceMethod: "error",
          codexTransportStreamDisconnected: true,
          codexTransportTerminalAfterProviderAction: false,
          codexTransportThreadId: "raw-thread-id",
          codexTransportThreadIdPresent: true,
          codexTransportTransport: "websocket",
          codexTransportTurnId: "raw-turn-id",
          codexTransportTurnIdPresent: true,
          codexTransportUrl: "https://api.openai.com/v1/responses",
          codexTransportWillRetry: true,
        },
      },
      wake,
    });

    expect(entry).toEqual({
      component: "runtime.provider",
      eventId: "evt_codex_transport_diagnostics",
      level: "info",
      message: "Hosted assistant Codex transport diagnostics captured.",
      phase: "wake.running",
      redacted: expect.objectContaining({
        codexTransportAdditionalDetailsPresent: true,
        codexTransportErrorMessageLength: 144,
        codexTransportErrorMessagePresent: true,
        codexTransportEventKind: "stream-idle-timeout",
        codexTransportFallbackActivated: false,
        codexTransportIdleTimeout: true,
        codexTransportProviderActionCount: 0,
        codexTransportRetryCount: 2,
        codexTransportRetryExhausted: false,
        codexTransportRetryMax: 5,
        codexTransportSourceMethod: "error",
        codexTransportStreamDisconnected: true,
        codexTransportTerminalAfterProviderAction: false,
        codexTransportThreadIdPresent: true,
        codexTransportTraceType: "transport-diagnostics",
        codexTransportTransport: "websocket",
        codexTransportTurnIdPresent: true,
        codexTransportWillRetry: true,
        providerTraceKind: "codex.transport_diagnostics",
        requestId: "req_123",
        schema: "murph.assistant-codex-transport-diagnostics.v1",
      }),
    });
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-provider-session-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw provider message");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-thread-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-turn-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("api.openai.com");
  });

  it("captures hosted Codex reusable app-server timing traces", () => {
    for (const stage of [
      "preinitialized",
      "warm-reused",
      "warm-idle",
      "warm-abort-poisoned",
    ]) {
      const eventId = `evt_codex_${stage.replaceAll("-", "_")}_timing`;
      const wake = buildHostedExecutionAssistantNotificationRequestedWake({
        eventId,
        memberId: "member_123",
        notification: {
          instructions: "Reply in chat.",
          route: {
            actorId: "actor_codex_warm_timing",
            channel: "linq",
            delivery: {
              kind: "thread",
              target: "thread_123",
            },
            identityId: "hbidx:phone:v1:test",
            threadId: "thread_123",
            threadIsDirect: true,
          },
        },
        occurredAt: "2026-04-08T00:00:00.000Z",
      });

      const entry = emitHostedAssistantProviderTraceLog({
        details: {
          requestId: "req_123",
        },
        event: {
          rawEvent: {
            schema: "murph.assistant-codex-app-server-timing.v1",
            type: "assistant.codex.app_server_timing",
            codexTimingColdStartReason: "node-process-first-use",
            codexTimingElapsedMs: 12,
            codexTimingStage: stage,
            codexTimingTotalElapsedMs: 34,
            cwd: "/tmp/raw-path",
            threadId: "raw-thread-id",
          },
        },
        wake,
      });

      expect(entry).toEqual({
        component: "runtime.provider",
        eventId,
        level: "info",
        message: "Hosted assistant Codex app-server timing captured.",
        phase: "wake.running",
        redacted: expect.objectContaining({
          ...(stage === "preinitialized"
            ? { codexTimingColdStartReason: "node-process-first-use" }
            : {}),
          codexTimingElapsedMs: 12,
          codexTimingStage: stage,
          codexTimingTotalElapsedMs: 34,
          codexTimingTraceType: "app-server",
          providerTraceKind: "codex.app_server_timing",
          requestId: "req_123",
          schema: "murph.assistant-codex-app-server-timing.v1",
        }),
      });
      expect(JSON.stringify(entry?.redacted)).not.toContain("raw-thread-id");
      expect(JSON.stringify(entry?.redacted)).not.toContain("/tmp/raw-path");
    }
  });

  it("captures local Codex turn-completion boundaries without raw provider metadata", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_codex_turn_completion_timing",
      memberId: "member_123",
      notification: {
        instructions: "Reply in chat.",
        route: {
          actorId: "actor_codex_turn_completion_timing",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-07-16T00:00:00.000Z",
    });
    const completionBoundaries = {
      codexTimingProviderRequestOrdinal: 2,
      codexTimingTurnStartAckElapsedMs: 14,
      codexTimingTurnStartedNotificationElapsedMs: 16,
      codexTimingTurnCompletedNotificationElapsedMs: 5_610,
      codexTimingTurnCompleteElapsedMs: 5_622,
    } as const;

    const entry = emitHostedAssistantProviderTraceLog({
      details: { requestId: "req_123" },
      event: {
        rawEvent: {
          schema: "murph.assistant-codex-app-server-timing.v1",
          type: "assistant.codex.app_server_timing",
          codexTimingStage: "turn-completed",
          ...completionBoundaries,
          rawTurnId: "raw-turn-id",
          rawProviderUrl: "https://api.openai.com/v1/responses",
        },
      },
      wake,
    });

    expect(entry?.redacted).toEqual(expect.objectContaining({
      codexTimingProviderRequestOrdinal: 2,
      codexTimingTurnCompleteElapsedMs: 5_622,
      codexTimingTurnCompletedNotificationElapsedMs: 5_610,
      codexTimingTurnStartAckElapsedMs: 14,
      codexTimingTurnStartedNotificationElapsedMs: 16,
      codexTimingTraceType: "app-server",
      providerTraceKind: "codex.app_server_timing",
    }));
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-turn-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("api.openai.com");

    const nonCompletionEntry = emitHostedAssistantProviderTraceLog({
      details: { requestId: "req_123" },
      event: {
        rawEvent: {
          schema: "murph.assistant-codex-app-server-timing.v1",
          type: "assistant.codex.app_server_timing",
          codexTimingStage: "turn-started",
          ...completionBoundaries,
        },
      },
      wake,
    });

    expect(nonCompletionEntry?.redacted).toEqual(expect.objectContaining({
      codexTimingStage: "turn-started",
      codexTimingTraceType: "app-server",
      providerTraceKind: "codex.app_server_timing",
    }));
    for (const key of Object.keys(completionBoundaries)) {
      expect(nonCompletionEntry?.redacted).not.toHaveProperty(key);
    }
  });

  it("captures hosted Codex action diagnostics without raw payloads", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_codex_action_diagnostics",
      memberId: "member_123",
      notification: {
        instructions: "Reply in chat.",
        route: {
          actorId: "actor_action_diagnostics",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const entry = emitHostedAssistantProviderTraceLog({
      details: {
        requestId: "req_123",
      },
      event: {
        codexThreadId: "raw-provider-session-id",
        rawEvent: {
          schema: "murph.assistant-codex-action-diagnostics.v1",
          type: "assistant.codex.action_diagnostics",
          codexActionCachedInputUnitMax: 1000,
          codexActionCommandCount: 1,
          codexActionCompletedCount: 2,
          codexActionDurationMsMax: 123,
          codexActionDurationMsTotal: 183,
          codexActionDynamicToolCallCount: 1,
          codexActionEventCount: 8,
          codexActionFailedCount: 0,
          codexActionFileChangeCount: 0,
          codexActionFinalInputUnit: 81000,
          codexActionFinalOutputUnit: 1200,
          codexActionInputUnitMax: 81000,
          codexActionKinds: ["dynamic.tool.call", "command.execution"],
          codexActionLabels: [
            "dynamic.tool.call",
            "dynamic.vault.readSummary",
            "command.execution",
            "/tmp/raw-path",
          ],
          codexActionOutputBytesMax: 64,
          codexActionOutputBytesTotal: 128,
          codexActionOutputItemCount: 3,
          codexActionOutputUnitMax: 1200,
          codexActionProviderActionCount: 2,
          codexActionSlowDurationMs: [123, 60],
          codexActionSlowKinds: ["dynamic.tool.call", "command.execution"],
          codexActionSlowLabels: [
            "dynamic.tool.call",
            "dynamic.vault.readSummary",
            "command.execution",
            "/tmp/raw-slow-path",
          ],
          codexActionThreadIdPresent: true,
          codexActionToolCallCounts: [1, 1],
          codexActionToolNames: ["dynamic:vault.readSummary", "command.execution"],
          codexActionToolOutputBytesMax: [64, 32],
          codexActionToolOutputBytesTotal: [96, 32],
          codexActionToolSummaries: [
            {
              callCount: 1,
              kind: "dynamic.tool.call",
              namespace: "raw-namespace-should-drop",
              namespacePresent: true,
              outputBytesMax: 64,
              outputBytesTotal: 96,
              tool: "readSummary",
            },
            {
              callCount: 1,
              kind: "command.execution",
              outputBytesMax: 32,
              outputBytesTotal: 32,
            },
            {
              callCount: 1,
              kind: "mcp.tool.call",
              outputBytesMax: 1,
              outputBytesTotal: 1,
              server: "/tmp/raw-path",
              serverPresent: true,
              tool: "unsafe",
            },
          ],
          codexActionTotalUnitMax: 82500,
          codexActionUsageSampleCount: 1,
          codexActionTurnIdPresent: true,
          codexActionWebSearchCount: 0,
          prompt: "raw prompt must not appear",
          toolOutput: "raw tool output must not appear",
        },
      },
      wake,
    });

    expect(entry).toEqual({
      component: "runtime.provider",
      eventId: "evt_codex_action_diagnostics",
      level: "info",
      message: "Hosted assistant Codex action diagnostics captured.",
      phase: "wake.running",
      redacted: expect.objectContaining({
        codexActionCommandCount: 1,
        codexActionDurationMsMax: 123,
        codexActionDurationMsTotal: 183,
        codexActionDynamicToolCallCount: 1,
        codexActionFinalInputUnit: 81000,
        codexActionInputUnitMax: 81000,
        codexActionKinds: ["dynamic.tool.call", "command.execution"],
        codexActionOutputBytesMax: 64,
        codexActionOutputBytesTotal: 128,
        codexActionProviderActionCount: 2,
        codexActionSlowDurationMs: [123, 60],
        codexActionSlowKinds: ["dynamic.tool.call", "command.execution"],
        codexActionToolSummaries: [
          {
            callCount: 1,
            kind: "dynamic.tool.call",
            namespacePresent: true,
            outputBytesMax: 64,
            outputBytesTotal: 96,
            tool: "readSummary",
          },
          {
            callCount: 1,
            kind: "command.execution",
            outputBytesMax: 32,
            outputBytesTotal: 32,
          },
          {
            callCount: 1,
            kind: "mcp.tool.call",
            outputBytesMax: 1,
            outputBytesTotal: 1,
            serverPresent: true,
            tool: "unsafe",
          },
        ],
        codexActionTraceType: "action-diagnostics",
        providerTraceKind: "codex.action_diagnostics",
        requestId: "req_123",
        schema: "murph.assistant-codex-action-diagnostics.v1",
      }),
    });
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-provider-session-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-namespace-should-drop");
    expect(JSON.stringify(entry?.redacted)).not.toContain("/tmp/raw-path");
    expect(JSON.stringify(entry?.redacted)).not.toContain("/tmp/raw-slow-path");
    expect(entry?.redacted).not.toHaveProperty("codexActionLabels");
    expect(entry?.redacted).not.toHaveProperty("codexActionSlowLabels");
    expect(entry?.redacted).not.toHaveProperty("codexActionToolCallCounts");
    expect(entry?.redacted).not.toHaveProperty("codexActionToolNames");
    expect(entry?.redacted).not.toHaveProperty("codexActionToolOutputBytesMax");
    expect(entry?.redacted).not.toHaveProperty("codexActionToolOutputBytesTotal");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw prompt");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw tool output");
  });

  it("accepts legacy hosted provider plan diagnostic keys", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_provider_plan_legacy_keys",
      memberId: "member_123",
      notification: {
        instructions: "Reply in chat.",
        route: {
          actorId: "actor_provider_plan_legacy",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const entry = emitHostedAssistantProviderTraceLog({
      details: {
        requestId: "req_legacy_keys",
      },
      event: {
        codexThreadId: "raw-provider-session-id",
        rawEvent: {
          schema: "murph.assistant-provider-plan-diagnostics.v1",
          type: "assistant.provider.plan",
          providerContinuation: "provider-state-optimization",
          providerRequestOrdinal: 2,
          resumeProviderSessionIdPresent: true,
          routePlanningActiveExperimentContextElapsedMs: 6000,
          routePlanningAnyBootstrapContextPrepared: true,
          routePlanningBootstrapContextPrepared: false,
          routePlanningCliBootstrapElapsedMs: null,
          routePlanningElapsedMs: 7000,
          routePlanningFallbackInstructionsElapsedMs: 80,
          routePlanningFreshThreadFallbackPrepared: true,
          routePlanningFreshThreadFallbackPromptElapsedMs: 80,
          routePlanningMemoryOverviewElapsedMs: 900,
          routePlanningMeasuredElapsedMs: 6988,
          routePlanningPrimaryInstructionsElapsedMs: 70,
          routePlanningPrimarySystemPromptElapsedMs: 70,
          routePlanningResumeBindingElapsedMs: 3,
          routePlanningSlowestStage: "memory_overview",
          routePlanningSlowestStageElapsedMs: 900,
          routePlanningTargetCapabilitiesElapsedMs: 5,
          routePlanningUnaccountedElapsedMs: 12,
          routePlanningVaultOverviewElapsedMs: 900,
          routePlanningRawPath: "/tmp/raw-path",
          workingDirectoryKind: "hosted-stable-proc-cwd",
        },
        updates: [],
      },
      wake,
    });

    expect(entry).toEqual({
      component: "runtime.provider",
      eventId: "evt_provider_plan_legacy_keys",
      level: "info",
      message: "Hosted assistant provider plan captured.",
      phase: "wake.running",
      redacted: expect.objectContaining({
        codexContinuation: "provider-state-optimization",
        providerPlanKind: "provider.plan",
        providerRequestOrdinal: 2,
        requestId: "req_legacy_keys",
        resumeCodexThreadIdPresent: true,
        routePlanningActiveExperimentContextElapsedMs: 6000,
        routePlanningAnyBootstrapContextPrepared: true,
        routePlanningBootstrapContextPrepared: false,
        routePlanningElapsedMs: 7000,
        routePlanningFallbackInstructionsElapsedMs: 80,
        routePlanningMemoryOverviewElapsedMs: 900,
        routePlanningMeasuredElapsedMs: 6988,
        routePlanningPrimaryInstructionsElapsedMs: 70,
        routePlanningPrimarySystemPromptElapsedMs: 70,
        routePlanningResumeBindingElapsedMs: 3,
        routePlanningSlowestStage: "memory_overview",
        routePlanningSlowestStageElapsedMs: 900,
        routePlanningTargetCapabilitiesElapsedMs: 5,
        routePlanningUnaccountedElapsedMs: 12,
        routePlanningVaultOverviewElapsedMs: 900,
        workingDirectoryKind: "hosted-stable-proc-cwd",
      }),
    });
    expect(entry?.redacted).not.toHaveProperty("codexThreadId");
    expect(entry?.redacted).not.toHaveProperty("providerContinuation");
    expect(entry?.redacted).not.toHaveProperty("resumeProviderSessionIdPresent");
    expect(entry?.redacted).not.toHaveProperty(
      "routePlanningFreshThreadFallbackPrepared",
    );
    expect(entry?.redacted).not.toHaveProperty(
      "routePlanningFreshThreadFallbackPromptElapsedMs",
    );
    expect(entry?.redacted).not.toHaveProperty("routePlanningRawPath");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-provider-session-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("/tmp/raw-path");
  });

  it("captures assistant context snapshot as a route-planning slowest stage", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_provider_plan_context_snapshot",
      memberId: "member_123",
      notification: {
        instructions: "Reply in chat.",
        route: {
          actorId: "actor_provider_plan_context_snapshot",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const entry = emitHostedAssistantProviderTraceLog({
      details: {
        requestId: "req_context_snapshot",
      },
      event: {
        rawEvent: {
          schema: "murph.assistant-provider-plan-diagnostics.v1",
          type: "assistant.provider.plan",
          codexContinuation: "provider-state-optimization",
          providerRequestOrdinal: 0,
          resumeCodexThreadIdPresent: true,
          routePlanningAssistantContextSnapshotElapsedMs: 8,
          routePlanningElapsedMs: 23,
          routePlanningMeasuredElapsedMs: 22,
          routePlanningSlowestStage: "assistant_context_snapshot",
          routePlanningSlowestStageElapsedMs: 8,
          workingDirectoryKind: "hosted-stable-proc-cwd",
        },
        updates: [],
      },
      wake,
    });

    expect(entry).toEqual({
      component: "runtime.provider",
      eventId: "evt_provider_plan_context_snapshot",
      level: "info",
      message: "Hosted assistant provider plan captured.",
      phase: "wake.running",
      redacted: expect.objectContaining({
        codexContinuation: "provider-state-optimization",
        providerPlanKind: "provider.plan",
        requestId: "req_context_snapshot",
        routePlanningAssistantContextSnapshotElapsedMs: 8,
        routePlanningElapsedMs: 23,
        routePlanningMeasuredElapsedMs: 22,
        routePlanningSlowestStage: "assistant_context_snapshot",
        routePlanningSlowestStageElapsedMs: 8,
        workingDirectoryKind: "hosted-stable-proc-cwd",
      }),
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime.provider",
        message: "Hosted assistant provider plan captured.",
        phase: "wake.running",
        wake,
      }),
    );
  });

  it("drops retired protocol-preload timing diagnostics from hosted projection", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_provider_plan_retired_protocol_preload",
      memberId: "member_123",
      notification: {
        instructions: "Reply in chat.",
        route: {
          actorId: "actor_provider_plan_retired_protocol_preload",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const entry = emitHostedAssistantProviderTraceLog({
      details: {
        requestId: "req_retired_protocol_preload",
      },
      event: {
        rawEvent: {
          schema: "murph.assistant-provider-plan-diagnostics.v1",
          type: "assistant.provider.plan",
          codexContinuation: "provider-state-optimization",
          routePlanningElapsedMs: 50,
          routePlanningSlowestStage: "supported_experiment_protocols",
          routePlanningSupportedExperimentProtocolsElapsedMs: 50,
          workingDirectoryKind: "hosted-stable-proc-cwd",
        },
        updates: [],
      },
      wake,
    });

    expect(entry?.redacted).toEqual(expect.objectContaining({
      requestId: "req_retired_protocol_preload",
      routePlanningElapsedMs: 50,
      workingDirectoryKind: "hosted-stable-proc-cwd",
    }));
    expect(entry?.redacted).not.toHaveProperty(
      "routePlanningSupportedExperimentProtocolsElapsedMs",
    );
    expect(entry?.redacted).not.toHaveProperty("routePlanningSlowestStage");
    expect(JSON.stringify(entry?.redacted)).not.toContain(
      "supported_experiment_protocols",
    );
  });

  it("captures provider prompt-size diagnostics without prompt text", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_provider_prompt_size",
      memberId: "member_123",
      notification: {
        instructions: "Reply in chat.",
        route: {
          actorId: "actor_provider_prompt_size",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const entry = emitHostedAssistantProviderTraceLog({
      details: {
        requestId: "req_prompt_size",
      },
      event: {
        codexThreadId: "raw-provider-session-id",
        rawEvent: {
          schema: "murph.assistant-provider-prompt-size-diagnostics.v1",
          type: "assistant.provider.prompt_size",
          providerPromptDiagnosticKind: "primary",
          baseInstructionsBytes: 768,
          providerPromptBytes: 4096,
          userPromptBytes: 5,
          turnContextPromptBytes: 2048,
          developerInstructionsBytes: 1024,
          conversationContextBytes: 256,
          systemPromptBytes: 512,
          developerInstructionsPresent: true,
          conversationContextPresent: true,
          resumeCodexThreadIdPresent: true,
          prompt: "private prompt text should not be logged",
          userPrompt: "hello",
          threadId: "raw-thread-id",
        },
        updates: [],
      },
      wake,
    });

    expect(entry).toEqual({
      component: "runtime.provider",
      eventId: "evt_provider_prompt_size",
      level: "info",
      message: "Hosted assistant provider prompt-size diagnostics captured.",
      phase: "wake.running",
      redacted: expect.objectContaining({
        baseInstructionsBytes: 768,
        conversationContextBytes: 256,
        conversationContextPresent: true,
        developerInstructionsBytes: 1024,
        developerInstructionsPresent: true,
        providerPromptBytes: 4096,
        providerPromptDiagnosticKind: "primary",
        providerTraceKind: "provider.prompt_size",
        requestId: "req_prompt_size",
        resumeCodexThreadIdPresent: true,
        schema: "murph.assistant-provider-prompt-size-diagnostics.v1",
        systemPromptBytes: 512,
        turnContextPromptBytes: 2048,
        userPromptBytes: 5,
      }),
    });
    expect(entry?.redacted).not.toHaveProperty("prompt");
    expect(entry?.redacted).not.toHaveProperty("userPrompt");
    expect(entry?.redacted).not.toHaveProperty("threadId");
    expect(JSON.stringify(entry?.redacted)).not.toContain("private prompt text");
    expect(JSON.stringify(entry?.redacted)).not.toContain("hello");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-provider-session-id");
    expect(JSON.stringify(entry?.redacted)).not.toContain("raw-thread-id");
  });

  it("sends signup assistant notifications and returns the seeded follow-up wake", async () => {
    const seededNextWakeAt = "2026-04-09T17:30:00.000Z";
    const bootstrapResult = {
      assistantConfigStatus: "saved",
      assistantConfigured: true,
      assistantProvider: "codex-cli" as const,
      assistantSeeded: false,
      emailAutoReplyEnabled: true,
      linqAutoReplyEnabled: true,
      telegramAutoReplyEnabled: true,
      vaultCreated: false,
    };
    mocks.prepareHostedWakeContext.mockResolvedValue(bootstrapResult);
    mocks.sendAssistantNotification.mockImplementationOnce(async (input) => {
      input.onTraceEvent?.({
        codexThreadId: null,
        rawEvent: {
          schema: "murph.assistant-context-diagnostics.v1",
          type: "assistant.context.diagnostics",
          stage: "assistant-session-resolved",
          source: "assistant-notification",
          fingerprintReady: true,
          channel: "linq",
          threadIsDirect: true,
          actorPresent: true,
          identityPresent: true,
          threadPresent: true,
          sessionPresent: true,
          actorFingerprint: "h1_111111111111111111111111",
          identityFingerprint: "h1_222222222222222222222222",
          threadFingerprint: "h1_333333333333333333333333",
          sessionFingerprint: "h1_444444444444444444444444",
          primaryConversationFingerprint: "h1_555555555555555555555555",
          primaryConversationScope: "thread",
          actorFallbackConversationFingerprint: "h1_666666666666666666666666",
          actorFallbackConversationScope: "actor",
          sessionResolutionCreated: true,
          sessionTurnCount: 0,
        },
        updates: [],
      });
      input.onTraceEvent?.({
        codexThreadId: null,
        rawEvent: {
          schema: "murph.assistant-provider-plan-diagnostics.v1",
          type: "assistant.provider.plan",
          codexContinuation: "provider-state-optimization",
          providerRequestOrdinal: 1,
          resumeCodexThreadIdPresent: true,
          workingDirectoryKind: "hosted-stable-proc-cwd",
        },
        updates: [],
      });
      return createQueuedNotificationResult();
    });
    mocks.upsertAssistantCronAutomation.mockResolvedValueOnce({
      enabled: true,
      schedule: {
        kind: "dailyLocal",
        localTime: "13:30",
      },
      state: {
        nextRunAt: seededNextWakeAt,
      },
    });

    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification",
      memberId: "member_123",
      notification: {
        deliveryDispatchMode: "queue-only",
        deliveryDedupeToken: "signup-welcome:member_123",
        deliveryIdempotencyKey: "signup-welcome:member_123",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph, your personal health assistant.",
        },
        route: {
          actorId: "hid_linq_actor_123",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hid_linq_identity_123",
          threadId: "hid_linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const runtime = createRuntime();
    const result = await executeHostedMailboxEvent({
      wake,
      executionContext,
      forceQueueOnlyAssistantNotification: true,
      runtime,
      runtimeEnv: {
        OPENAI_API_KEY: "secret",
      },
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.prepareHostedWakeContext).toHaveBeenCalledWith(
      "/tmp/assistant-runtime-events",
      wake,
      {
        OPENAI_API_KEY: "secret",
      },
      runtime.resolvedConfig,
      {
        operatorHomeRoot: null,
      },
    );
    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith({
      actorId: "hid_linq_actor_123",
      bindingDeliveryTarget: "thread_123",
      channel: "linq",
      deliveryDedupeToken: "signup-welcome:member_123",
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: "signup-welcome:member_123",
      deliveryKind: "thread",
      deliverySource: null,
      deliveryTarget: null,
      executionContext,
      firstContactPolicy: {
        markSeenOnDeliveryAccepted: true,
      },
      hostedDeliveryIdempotency: {
        assistantTurnOrdinal: "assistant-notification:1",
        conversationId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        inboundMailboxItemIds: ["evt_notification"],
        recipientKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
      identityId: "hid_linq_identity_123",
      instructions: "Send exactly the signup welcome.",
      onTraceEvent: expect.any(Function),
      responsePolicy: {
        kind: "require_send_exact_text",
        text: "Welcome to Murph, your personal health assistant.",
      },
      threadId: "hid_linq_thread_123",
      threadIsDirect: true,
      turnEnvironment: expectHostedTurnEnvironment({
        env: {
          OPENAI_API_KEY: "secret",
        },
        vaultRoot: "/tmp/assistant-runtime-events",
      }),
      turnTrigger: "manual-deliver",
      vault: "/tmp/assistant-runtime-events",
    });
    expect(mocks.upsertAssistantCronAutomation).toHaveBeenCalledWith({
      firstOccurrenceActiveDayCount: 3,
      firstOccurrenceActiveUntilLocalTime: "15:00",
      firstOccurrencePolicy: "after-current-local-day",
      instructions: expect.stringContaining(
        "vault-cli assistant onboarding resume-context --format json",
      ),
      route: {
        channel: "linq",
        deliverySource: null,
        deliveryTarget: "thread_123",
        identityId: "hid_linq_identity_123",
        participantId: null,
        threadId: null,
        threadIsDirect: true,
      },
      schedule: {
        kind: "dailyLocal",
        localTime: expect.stringMatching(/^(?:13:[3-5]\d|14:[0-2]\d)$/u),
      },
      slug: "finish-onboarding-followup",
      summary: "One daily opportunity for three days to continue unfinished Murph onboarding.",
      tags: [
        "assistant",
        "scheduled",
        "murph-managed",
        "onboarding",
        "murph-managed:onboarding-followup",
      ],
      title: "Finite Murph onboarding follow-up",
      vault: "/tmp/assistant-runtime-events",
    });
    const seedInput = mocks.upsertAssistantCronAutomation.mock.calls.at(0)?.[0];
    const scheduledContinuationScenarios = [
      {
        clause: "If `onboarding.status` is `completed`, return skip.",
        state: "completed",
      },
      {
        clause:
          "This background occurrence must never run the onboarding completion command or otherwise mutate onboarding state.",
        state: "overall decline",
      },
      {
        clause:
          "If that step is only a reflection or parking transition, combine it with the next skill-approved question when the skill permits; otherwise return skip.",
        state: "reflection-only next step",
      },
      {
        clause:
          "Follow the onboarding skill’s finite three-day recovery rule exactly.",
        state: "latest question unanswered",
      },
      {
        clause:
          "Before sending, triple-check the snapshot and recent messages for an answer, skip, defer, decline, or a newer topic that should win.",
        state: "checkpoint answered or category skipped",
      },
      {
        clause:
          "Honor requested timing and return skip after an explicit decline, a request not to follow up, or whenever the reopening question would not be timely or useful.",
        state: "deferred until later",
      },
      {
        clause:
          "It must contain exactly one easy, reply-oriented question; otherwise return an ordinary skip.",
        state: "eligible continuation",
      },
    ] as const;
    for (const scenario of scheduledContinuationScenarios) {
      expect(
        seedInput?.instructions,
        `scheduled onboarding state: ${scenario.state}`,
      ).toContain(scenario.clause);
    }
    expect(seedInput?.instructions).toContain(
      "The managed-automation owner archives this follow-up deterministically.",
    );
    expect(seedInput?.instructions).toContain(
      "Goal: use this finite three-day window to make at most one low-pressure daily attempt to continue unfinished Murph onboarding and get a reply.",
    );
    expect(seedInput?.instructions).toContain("Success criteria:");
    expect(seedInput?.instructions).toContain(
      "$MURPH_ASSISTANT_SKILLS_ROOT/murph-onboarding/SKILL.md",
    );
    expect(seedInput?.instructions).toContain(
      "The skill is the single owner of conversation order, checkpoint meaning, persistence, and completion; do not create a second state machine in this automation.",
    );
    expect(seedInput?.instructions).toContain(
      "This background occurrence must never run the onboarding completion command or otherwise mutate onboarding state.",
    );
    expect(seedInput?.instructions).toContain(
      "Only a later foreground user reply may advance or complete onboarding.",
    );
    expect(seedInput?.instructions).not.toContain(
      "If a promised follow-through or next step in the member's agreed support loop is due, do that first.",
    );
    expect(seedInput?.instructions).toContain(
      "Otherwise use exactly the next unresolved step from the onboarding skill, including aspiration capture, explicit parking, foundation questions, contextual return, and its targeted-read rules for omitted, truncated, or errored evidence.",
    );
    expect(seedInput?.instructions).toContain(
      "This automation never owns a promised check-in, reminder, or proactive support action.",
    );
    expect(seedInput?.instructions).toContain(
      "Those use the canonical plan and dedicated automation required by `behavior-followthrough`, which owns timing, due evaluation, delivery, retry, and skip behavior.",
    );
    expect(seedInput?.instructions).toContain(
      "Output: send at most one brief, natural, low-pressure in-chat continuation.",
    );
    expect(seedInput?.instructions).toContain(
      "The user's reply will be handled by the next normal Murph onboarding turn",
    );
    expect(seedInput?.instructions).toContain("available recent user messages");
    expect(seedInput?.instructions).toContain(
      "one brief, skill-compatible question gives the member an easy way to reply and continue",
    );
    expect(seedInput?.instructions).not.toContain("The six checkpoints are");
    expect(seedInput?.instructions).toContain("return skip");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          deliveryDispatchMode: "queue-only",
          firstContact: true,
          notificationRouteChannel: "linq",
          notificationRouteDeliveryKind: "thread",
          responsePolicyKind: "require_send_exact_text",
        }),
        message: "Hosted assistant notification started.",
        phase: "wake.running",
        wake,
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        component: "runtime.context",
        details: expect.objectContaining({
          actorFingerprint: "h1_111111111111111111111111",
          actorFallbackConversationFingerprint: "h1_666666666666666666666666",
          fingerprintReady: true,
          primaryConversationFingerprint: "h1_555555555555555555555555",
          sessionFingerprint: "h1_444444444444444444444444",
          sessionResolutionCreated: true,
          stage: "assistant-session-resolved",
        }),
        message: "Hosted assistant context fingerprints captured.",
        phase: "wake.running",
        wake,
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        component: "runtime.provider",
        details: expect.objectContaining({
          codexContinuation: "provider-state-optimization",
          providerPlanKind: "provider.plan",
          resumeCodexThreadIdPresent: true,
          workingDirectoryKind: "hosted-stable-proc-cwd",
        }),
        message: "Hosted assistant provider plan captured.",
        phase: "wake.running",
        wake,
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          eventCode: "assistant.onboarding_followup_seeded",
          onboardingFollowupEnabled: true,
          onboardingFollowupNextRunAt: seededNextWakeAt,
          onboardingFollowupOpportunityDays: 3,
          onboardingFollowupScheduleKind: "dailyLocal",
        }),
        message: "Hosted onboarding follow-up automation seeded.",
        phase: "wake.running",
        wake,
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          notificationRouteChannel: "linq",
          notificationRouteDeliveryKind: "thread",
        }),
        message: "Hosted assistant notification finished.",
        phase: "wake.running",
        wake,
      }),
    );
    expect(result).toEqual({
      bootstrapResult,
      conversationMetrics: null,
      deliveryIntentIds: ["intent_notification"],
      mailboxLane: "assistant-notification",
      nextWakeAt: seededNextWakeAt,
      nextWakeReason: "assistant",
      postCheckpointRecord: null,
      redactedLogEntries: [
        {
          component: "runtime",
          eventId: "evt_notification",
          level: "info",
          message: "Hosted assistant notification started.",
          phase: "wake.running",
          redacted: expect.objectContaining({
            deliveryDedupeTokenPresent: true,
            deliveryDispatchMode: "queue-only",
            firstContact: true,
            actorPresent: true,
            identityPresent: true,
            notificationRouteChannel: "linq",
            notificationRouteDeliveryKind: "thread",
            notificationRouteIdentityPresent: true,
            notificationRouteThreadIdPresent: true,
            notificationRouteThreadIsDirect: true,
            primaryConversationScope: "thread",
            responsePolicyKind: "require_send_exact_text",
            threadPresent: true,
          }),
        },
        {
          component: "runtime.context",
          eventId: "evt_notification",
          level: "info",
          message: "Hosted assistant context fingerprints captured.",
          phase: "wake.running",
          redacted: expect.objectContaining({
            actorFallbackConversationFingerprint: "h1_666666666666666666666666",
            fingerprintReady: true,
            primaryConversationFingerprint: "h1_555555555555555555555555",
            sessionFingerprint: "h1_444444444444444444444444",
            sessionResolutionCreated: true,
            stage: "assistant-session-resolved",
          }),
        },
        {
          component: "runtime.provider",
          eventId: "evt_notification",
          level: "info",
          message: "Hosted assistant provider plan captured.",
          phase: "wake.running",
          redacted: expect.objectContaining({
            codexContinuation: "provider-state-optimization",
            providerPlanKind: "provider.plan",
            resumeCodexThreadIdPresent: true,
            workingDirectoryKind: "hosted-stable-proc-cwd",
          }),
        },
        {
          component: "runtime",
          eventId: "evt_notification",
          level: "info",
          message: "Hosted onboarding follow-up automation seeded.",
          phase: "wake.running",
          redacted: expect.objectContaining({
            eventCode: "assistant.onboarding_followup_seeded",
            onboardingFollowupEnabled: true,
            onboardingFollowupNextRunAt: seededNextWakeAt,
            onboardingFollowupOpportunityDays: 3,
            onboardingFollowupScheduleKind: "dailyLocal",
          }),
        },
        {
          component: "runtime",
          eventId: "evt_notification",
          level: "info",
          message: "Hosted assistant notification finished.",
          phase: "wake.running",
          redacted: expect.objectContaining({
            deliveryDedupeTokenPresent: true,
            deliveryDispatchMode: "queue-only",
            firstContact: true,
            actorPresent: true,
            identityPresent: true,
            notificationRouteChannel: "linq",
            notificationRouteDeliveryKind: "thread",
            notificationRouteIdentityPresent: true,
            notificationRouteThreadIdPresent: true,
            notificationRouteThreadIsDirect: true,
            primaryConversationScope: "thread",
            responsePolicyKind: "require_send_exact_text",
            threadPresent: true,
          }),
        },
      ],
    });
  });

  it("maps private Assistant Ask completion proof into exact notification delivery authority", async () => {
    const completionId = `aask_done_${"b".repeat(64)}`;
    const requestId = `aask_req_${"a".repeat(64)}`;
    const expiresAt = "2099-08-09T05:10:00.000Z";
    const deliveryKey = `assistant-ask-private:${completionId}`;
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: completionId,
      memberId: "member_123",
      notification: {
        deliveryDedupeToken: deliveryKey,
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: deliveryKey,
        externalThreadRouteAuthority: null,
        instructions: "Queue the exact reviewed private answer.",
        privateAssistantAskCompletion: {
          expiresAt,
          requestId,
        },
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Reviewed private answer.",
        },
        route: {
          actorId: "hid_linq_actor_private",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq-direct-chat",
          },
          identityId: "hid_linq_identity_private",
          threadId: "hid_linq_thread_private",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-08-09T05:00:00.000Z",
    });

    await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      sourceMailboxItemId: "hmi_private_completion",
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.sendAssistantNotification).toHaveBeenCalledOnce();
    const notificationInput =
      mocks.sendAssistantNotification.mock.calls[0]?.[0];
    expect(notificationInput).toMatchObject({
      answeredMailboxItemIds: [completionId],
      deliveryDedupeToken: deliveryKey,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: deliveryKey,
      firstContactPolicy: null,
      hostedDeliveryIdempotency: {
        inboundMailboxItemIds: ["hmi_private_completion"],
      },
      responsePolicy: {
        kind: "require_send_exact_text",
        text: "Reviewed private answer.",
      },
      reviewedAssistantAskCompletionExpiresAt: expiresAt,
      threadIsDirect: true,
    });
    expect(notificationInput).not.toHaveProperty(
      "outboxExternalThreadRouteAuthority",
    );
    expect(notificationInput).not.toHaveProperty("notificationPromptProfile");
    expect(notificationInput).not.toHaveProperty("privateAssistantAskCompletion");
    expect(notificationInput).not.toHaveProperty("requestId");
  });

  it("propagates detached group route authority into the assistant outbox", async () => {
    const externalThreadRouteAuthority = {
      accountLookupKey: "linq-account-key",
      channel: "linq" as const,
      containerMemberId: "group-runtime-member",
      threadId: "linq-group-chat",
    };
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_group_notification",
      memberId: "group-runtime-member",
      notification: {
        deliveryDispatchMode: "queue-only",
        deliveryDedupeToken: "phone-call-result:hpc_group",
        deliveryIdempotencyKey: "phone-call-result:hpc_group",
        externalThreadRouteAuthority,
        instructions: "Report the completed call result to this group.",
        responsePolicy: { kind: "allow_send_or_skip" },
        route: {
          actorId: null,
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq-group-chat",
          },
          identityId: "group-identity",
          threadId: "group-thread",
          threadIsDirect: false,
        },
      },
      occurredAt: "2026-07-25T12:00:00.000Z",
    });

    await executeHostedMailboxEvent({
      wake,
      executionContext: {
        hosted: {
          memberId: "group-runtime-member",
          userEnvKeys: [],
        },
      },
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        bindingDeliveryTarget: "linq-group-chat",
        channel: "linq",
        deliveryKind: "thread",
        deliveryTarget: null,
        outboxExternalThreadRouteAuthority: externalThreadRouteAuthority,
        threadId: "group-thread",
        threadIsDirect: false,
      }),
    );
  });

  it("proves an explicit direct Linq target from exact validated route authority", async () => {
    const externalThreadRouteAuthority = {
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq-direct-chat",
    };
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_direct_linq_notification",
      memberId: "member_123",
      notification: {
        deliveryDispatchMode: "queue-only",
        deliveryDedupeToken: "usage-referral-reward:direct-linq",
        deliveryIdempotencyKey: "usage-referral-reward:direct-linq",
        externalThreadRouteAuthority,
        instructions: "Celebrate the completed referral reward.",
        responsePolicy: { kind: "require_send" },
        route: {
          actorId: "linq-participant",
          channel: "linq",
          delivery: {
            kind: "explicit",
            target: "linq-direct-chat",
          },
          identityId: "direct-identity",
          threadId: "direct-thread",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-08-10T12:00:00.000Z",
    });

    await executeHostedMailboxEvent({
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
      wake,
    });

    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: "linq-direct-chat",
        channel: "linq",
        deliveryKind: null,
        deliveryTarget: "linq-direct-chat",
        outboxExternalThreadRouteAuthority: externalThreadRouteAuthority,
        threadIsDirect: true,
      }),
    );
  });

  it.each([
    {
      authority: undefined,
      label: "absent authority",
    },
    {
      authority: {
        channel: "linq" as const,
        containerMemberId: "member_123",
        threadId: "stale-linq-chat",
      },
      label: "stale target authority",
    },
    {
      authority: {
        channel: "linq" as const,
        containerMemberId: "different-member",
        threadId: "linq-direct-chat",
      },
      label: "wrong-member authority",
    },
    {
      authority: {
        channel: "telegram" as const,
        containerMemberId: "member_123",
        threadId: "linq-direct-chat",
      },
      label: "wrong-channel authority",
    },
    {
      authority: {
        channel: "linq" as const,
        containerMemberId: "member_123",
        threadId: "linq-direct-chat",
      },
      label: "non-direct route",
      threadIsDirect: false,
    },
    {
      authority: {
        channel: "linq" as const,
        containerMemberId: "wake-member",
        threadId: "linq-direct-chat",
      },
      label: "runtime-member mismatch",
      memberId: "wake-member",
    },
  ])("fails closed for an explicit Linq target with $label", async (fixture) => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: `evt_direct_linq_unverified_${fixture.label.replaceAll(" ", "-")}`,
      memberId: fixture.memberId ?? "member_123",
      notification: {
        ...(fixture.authority
          ? { externalThreadRouteAuthority: fixture.authority }
          : {}),
        instructions: "Celebrate the completed referral reward.",
        responsePolicy: { kind: "require_send" },
        route: {
          actorId: "linq-participant",
          channel: "linq",
          delivery: {
            kind: "explicit",
            target: "linq-direct-chat",
          },
          identityId: "direct-identity",
          threadId: "direct-thread",
          threadIsDirect: fixture.threadIsDirect ?? true,
        },
      },
      occurredAt: "2026-08-10T12:00:00.000Z",
    });

    await executeHostedMailboxEvent({
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
      wake,
    });

    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: null,
        deliveryKind: null,
        deliveryTarget: "linq-direct-chat",
      }),
    );
  });

  it("initializes explicit group room setup before accepting activation replay", async () => {
    const roomContext = "## Explicit setup\n\nKeep this room low-key.";
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "member.activated:linq-group:member_123:evt_room_setup",
      initialGroupRoomModelMarkdown: roomContext,
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: "member_123",
      occurredAt: "2026-07-29T18:01:00.000Z",
      signupWelcome: null,
    });

    const result = await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      sourceMailboxItemId: "hmi_room_setup_123",
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.initializeAssistantGroupRoomModel).toHaveBeenCalledExactlyOnceWith({
      body: roomContext,
      vaultRoot: "/tmp/assistant-runtime-events",
    });
    expect(mocks.sendAssistantNotification).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mailboxLane: "member-activated",
      redactedLogEntries: [
        expect.objectContaining({
          redacted: {
            eventCode: "assistant.group_room_model_activation_seed",
            outcome: "initialized",
          },
        }),
      ],
    });
    expect(JSON.stringify(result.redactedLogEntries)).not.toContain(roomContext);
  });

  it("keeps activation retryable without logging room setup when initialization is unavailable", async () => {
    const roomContext = "## Explicit setup\n\nKeep a private phrase private.";
    mocks.initializeAssistantGroupRoomModel.mockRejectedValueOnce(
      new Error("room setup unavailable"),
    );
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "member.activated:linq-group:member_123:evt_room_setup_fail",
      initialGroupRoomModelMarkdown: roomContext,
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: "member_123",
      occurredAt: "2026-07-29T18:01:00.000Z",
      signupWelcome: null,
    });

    await expect(executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      sourceMailboxItemId: "hmi_room_setup_fail_123",
      vaultRoot: "/tmp/assistant-runtime-events",
    })).rejects.toThrow("room setup unavailable");

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          eventCode: "assistant.group_room_model_activation_seed",
          outcome: "unavailable",
        },
        level: "warn",
      }),
    );
    expect(
      JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls),
    ).not.toContain(roomContext);
  });

  it("delivers embedded member activation signup welcomes and seeds onboarding follow-up", async () => {
    const seededNextWakeAt = "2026-04-09T17:30:00.000Z";
    mocks.upsertAssistantCronAutomation.mockResolvedValueOnce({
      enabled: true,
      state: {
        nextRunAt: seededNextWakeAt,
      },
    });
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "member.activated:stripe:member_123:evt_123",
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
      signupWelcome: {
        route: {
          actorId: "hid_linq_actor_123",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hid_linq_identity_123",
          threadId: "hid_linq_thread_123",
          threadIsDirect: true,
        },
        text: "Welcome to Murph.",
      },
    });

    const result = await executeHostedMailboxEvent({
      wake,
      executionContext,
      forceQueueOnlyAssistantNotification: true,
      runtime: createRuntime(),
      runtimeEnv: {},
      sourceMailboxItemId: "hmi_activation_123",
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith({
      actorId: "hid_linq_actor_123",
      bindingDeliveryTarget: "thread_123",
      channel: "linq",
      deliveryDedupeToken: "signup-welcome:member_123",
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: "signup-welcome:member_123",
      deliveryKind: "thread",
      deliverySource: null,
      deliveryTarget: null,
      executionContext,
      firstContactPolicy: {
        markSeenOnDeliveryAccepted: true,
      },
      hostedDeliveryIdempotency: {
        assistantTurnOrdinal: "member-activated:signup-welcome:1",
        conversationId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        inboundMailboxItemIds: ["hmi_activation_123"],
        recipientKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
      identityId: "hid_linq_identity_123",
      instructions: [
        "Prepare the first in-chat onboarding reply.",
        "Use this user-facing reply only:",
        "Welcome to Murph.",
      ].join("\n\n"),
      onTraceEvent: expect.any(Function),
      responsePolicy: {
        kind: "require_send_exact_text",
        text: "Welcome to Murph.",
      },
      threadId: "hid_linq_thread_123",
      threadIsDirect: true,
      turnEnvironment: expectHostedTurnEnvironment({
        vaultRoot: "/tmp/assistant-runtime-events",
      }),
      turnTrigger: "manual-deliver",
      vault: "/tmp/assistant-runtime-events",
    });
    expect(mocks.upsertAssistantCronAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        route: {
          channel: "linq",
          deliverySource: null,
          deliveryTarget: "thread_123",
          identityId: "hid_linq_identity_123",
          participantId: null,
          threadId: null,
          threadIsDirect: true,
        },
        slug: "finish-onboarding-followup",
      }),
    );
    expect(result).toMatchObject({
      mailboxLane: "member-activated",
      nextWakeAt: seededNextWakeAt,
      nextWakeReason: "assistant",
    });
  });

  it("still seeds onboarding follow-up when the embedded member activation welcome is superseded by prior first contact", async () => {
    const seededNextWakeAt = "2026-04-09T17:30:00.000Z";
    mocks.sendAssistantNotification.mockResolvedValueOnce({
      decision: {
        kind: "skip",
        privateSummary: "First-contact notification already accepted for this route.",
      },
      response: null,
      session: {
        sessionId: "session_notification_skip",
      },
    });
    mocks.upsertAssistantCronAutomation.mockResolvedValueOnce({
      enabled: true,
      state: {
        nextRunAt: seededNextWakeAt,
      },
    });
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "member.activated:stripe:member_123:evt_skip",
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
      signupWelcome: {
        route: {
          actorId: "hid_linq_actor_123",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hid_linq_identity_123",
          threadId: "hid_linq_thread_123",
          threadIsDirect: true,
        },
        text: "Welcome to Murph.",
      },
    });

    const result = await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      sourceMailboxItemId: "hmi_activation_skip_123",
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.sendAssistantNotification).toHaveBeenCalledOnce();
    expect(mocks.upsertAssistantCronAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "finish-onboarding-followup",
      }),
    );
    expect(result).toMatchObject({
      mailboxLane: "member-activated",
      nextWakeAt: seededNextWakeAt,
      nextWakeReason: "assistant",
    });
  });

  it("rehydrates execution context after bootstrap before sending notifications", async () => {
    const hydratedExecutionContext = {
      hosted: {
        defaultTarget: {
          adapter: "codex-cli" as const,
          approvalPolicy: "never" as const,
          codexCommand: null,
          model: "gpt-5.6-terra",
          modelProvider: "openai",
          oss: false,
          profile: null,
          reasoningEffort: "medium" as const,
          sandbox: "danger-full-access" as const,
        },
        memberId: "member_123",
        userEnvKeys: [],
      },
    };
    mocks.hydrateHostedExecutionDefaultTarget.mockResolvedValue(hydratedExecutionContext);

    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_rehydrate",
      memberId: "member_123",
      notification: {
        instructions: "Send exactly the signup welcome.",
        route: {
          actorId: "hid_linq_actor_123",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hid_linq_identity_123",
          threadId: "hid_linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });
    const operatorHomeRoot = "/tmp/assistant-runtime-events-home";
    const runtimeEnv = {
      CODEX_HOME: "/tmp/assistant-runtime-events-home/.codex-hosted",
    };
    const runtime = createRuntime();

    await executeHostedMailboxEvent({
      wake,
      executionContext,
      operatorHomeRoot,
      runtime,
      runtimeEnv,
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.prepareHostedWakeContext).toHaveBeenCalledWith(
      "/tmp/assistant-runtime-events",
      wake,
      runtimeEnv,
      runtime.resolvedConfig,
      {
        operatorHomeRoot,
      },
    );
    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      executionContext,
      {
        homeDirectory: operatorHomeRoot,
        runtimeEnv,
      },
    );
    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith({
      actorId: "hid_linq_actor_123",
      bindingDeliveryTarget: "thread_123",
      channel: "linq",
      deliveryDedupeToken: null,
      deliveryDispatchMode: undefined,
      deliveryIdempotencyKey: null,
      deliveryKind: "thread",
      deliverySource: null,
      deliveryTarget: null,
      executionContext: hydratedExecutionContext,
      firstContactPolicy: null,
      hostedDeliveryIdempotency: {
        assistantTurnOrdinal: "assistant-notification:1",
        conversationId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        inboundMailboxItemIds: ["evt_notification_rehydrate"],
        recipientKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
      identityId: "hid_linq_identity_123",
      instructions: "Send exactly the signup welcome.",
      onTraceEvent: expect.any(Function),
      responsePolicy: null,
      threadId: "hid_linq_thread_123",
      threadIsDirect: true,
      turnEnvironment: expectHostedTurnEnvironment({
        env: {
          CODEX_HOME: "/tmp/assistant-runtime-events-home/.codex-hosted",
          HOME: operatorHomeRoot,
        },
        vaultRoot: "/tmp/assistant-runtime-events",
      }),
      turnTrigger: "manual-deliver",
      vault: "/tmp/assistant-runtime-events",
    });
    expect(mocks.upsertAssistantCronAutomation).not.toHaveBeenCalled();
  });

  it("seeds onboarding follow-up for Telegram signup welcome routes", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_telegram_welcome",
      memberId: "member_123",
      notification: {
        deliveryDedupeToken: "signup-welcome:member_123",
        deliveryIdempotencyKey: "signup-welcome:member_123",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph.",
        },
        route: {
          actorId: "hid_telegram_actor_123",
          channel: "telegram",
          delivery: {
            kind: "thread",
            target: "telegram_thread_123",
          },
          identityId: null,
          threadId: null,
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.upsertAssistantCronAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        route: {
          channel: "telegram",
          deliverySource: null,
          deliveryTarget: null,
          identityId: null,
          participantId: null,
          threadId: "telegram_thread_123",
          threadIsDirect: true,
        },
        slug: "finish-onboarding-followup",
      }),
    );
  });

  it("keeps queue-only dispatch for non-canonical exact first-contact notifications", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_prefix_only_exact",
      memberId: "member_123",
      notification: {
        deliveryDedupeToken: "signup-welcome:member_123:retry",
        deliveryIdempotencyKey: "signup-welcome:member_123:retry",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the fixed setup reminder.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Fixed setup reminder.",
        },
        route: {
          actorId: "hid_linq_actor_123",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hid_linq_identity_123",
          threadId: "hid_linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    await executeHostedMailboxEvent({
      wake,
      executionContext,
      forceQueueOnlyAssistantNotification: true,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryDispatchMode: "queue-only",
        deliveryDedupeToken: "signup-welcome:member_123:retry",
        deliveryIdempotencyKey: "signup-welcome:member_123:retry",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Fixed setup reminder.",
        },
      }),
    );
  });

  it("does not seed onboarding follow-up for non-canonical signup welcome tokens", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_welcome_prefix_only",
      memberId: "member_123",
      notification: {
        deliveryIdempotencyKey: "signup-welcome:member_123",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph.",
        },
        route: {
          actorId: "hid_telegram_actor_123",
          channel: "telegram",
          delivery: {
            kind: "thread",
            target: "telegram_thread_123",
          },
          identityId: null,
          threadId: null,
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.sendAssistantNotification).toHaveBeenCalledOnce();
    expect(mocks.upsertAssistantCronAutomation).not.toHaveBeenCalled();
  });

  it("still seeds onboarding follow-up when the signup welcome notification is superseded by prior first contact", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_welcome_skip_result",
      memberId: "member_123",
      notification: {
        deliveryDedupeToken: "signup-welcome:member_123",
        deliveryIdempotencyKey: "signup-welcome:member_123",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph.",
        },
        route: {
          actorId: "hid_telegram_actor_123",
          channel: "telegram",
          delivery: {
            kind: "thread",
            target: "telegram_thread_123",
          },
          identityId: null,
          threadId: null,
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });
    mocks.sendAssistantNotification.mockResolvedValueOnce({
      decision: {
        kind: "skip",
        privateSummary: "First-contact notification already accepted for this route.",
      },
      response: null,
      session: {
        sessionId: "session_notification_skip",
      },
    });
    mocks.upsertAssistantCronAutomation.mockResolvedValueOnce({
      enabled: true,
      state: {
        nextRunAt: "2026-04-09T17:30:00.000Z",
      },
    });

    await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.sendAssistantNotification).toHaveBeenCalledOnce();
    expect(mocks.upsertAssistantCronAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "finish-onboarding-followup",
      }),
    );
  });

  it("keeps signup welcome delivery successful when onboarding follow-up seeding fails", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_seed_failure",
      memberId: "member_123",
      notification: {
        deliveryDedupeToken: "signup-welcome:member_123",
        deliveryIdempotencyKey: "signup-welcome:member_123",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph.",
        },
        route: {
          actorId: "hid_linq_actor_123",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hid_linq_identity_123",
          threadId: "hid_linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });
    mocks.upsertAssistantCronAutomation.mockRejectedValueOnce(
      new Error("automation store unavailable"),
    );

    const result = await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(result).toMatchObject({
      conversationMetrics: null,
      mailboxLane: "assistant-notification",
    });
    expect(mocks.upsertAssistantCronAutomation).toHaveBeenCalledTimes(1);
    expect(result.redactedLogEntries).toContainEqual(
      expect.objectContaining({
        eventId: "evt_notification_seed_failure",
        level: "warn",
        message: "Hosted onboarding follow-up automation seed failed.",
        redacted: expect.objectContaining({
          eventCode: "assistant.onboarding_followup_seed_failed",
          notificationRouteChannel: "linq",
          notificationRouteDeliveryKind: "thread",
        }),
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          eventCode: "assistant.onboarding_followup_seed_failed",
          notificationRouteChannel: "linq",
        }),
        level: "warn",
        message: "Hosted onboarding follow-up automation seed failed.",
        phase: "wake.running",
        wake,
      }),
    );
  });

  it("skips failed non-signup first-contact notifications instead of blocking ingress progress", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_skipped",
      memberId: "member_123",
      notification: {
        deliveryDedupeToken: "first-contact:member_123",
        deliveryIdempotencyKey: "first-contact:member_123",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph, your personal health assistant.",
        },
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: null,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });
    mocks.sendAssistantNotification.mockRejectedValueOnce(
      Object.assign(new Error("Provider rejected configured credentials."), {
        code: "invalid_api_key",
        details: {
          assistantNotificationProvider: "codex-cli",
          assistantNotificationProviderBaseUrlOrigin: "https://ai-gateway.vercel.sh",
          assistantNotificationProviderModel: "gpt-5.6-terra",
          assistantNotificationStage: "provider",
        },
        statusCode: 401,
      }),
    );

    const result = await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(result).toMatchObject({
      conversationMetrics: null,
      mailboxLane: "assistant-notification",
    });
    expect(result.redactedLogEntries).toEqual([
      expect.objectContaining({
        eventId: "evt_notification_skipped",
        message: "Hosted assistant notification started.",
      }),
      expect.objectContaining({
        eventId: "evt_notification_skipped",
        level: "warn",
        message: "Hosted assistant notification failed and was skipped so the hosted runtime pass can continue.",
        redacted: expect.objectContaining({
          assistantNotificationErrorCode: "authorization_error",
          assistantNotificationErrorCodeDetail: "invalid_api_key",
          assistantNotificationErrorDetail: "Provider rejected configured credentials.",
          assistantNotificationErrorMessage: "Hosted execution authorization failed.",
          assistantNotificationErrorName: "Error",
          assistantNotificationErrorStatus: 401,
          assistantNotificationProvider: "codex-cli",
          assistantNotificationProviderBaseUrlConfigured: true,
          assistantNotificationProviderErrorCode: "invalid_api_key",
          assistantNotificationProviderModel: "gpt-5.6-terra",
          assistantNotificationStage: "provider",
          errorCode: "authorization_error",
          notificationRouteThreadIsDirect: null,
        }),
      }),
    ]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          notificationRouteThreadIsDirect: null,
        }),
        level: "warn",
        message: "Hosted assistant notification failed and was skipped so the hosted runtime pass can continue.",
        phase: "wake.running",
        wake,
      }),
    );
    expect(mocks.upsertAssistantCronAutomation).not.toHaveBeenCalled();
  });

  it("fails canonical signup welcome notification errors so the mailbox can retry", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_signup_failure",
      memberId: "member_123",
      notification: {
        deliveryDedupeToken: "signup-welcome:member_123",
        deliveryIdempotencyKey: "signup-welcome:member_123",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph, your personal health assistant.",
        },
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });
    mocks.sendAssistantNotification.mockRejectedValueOnce(
      new Error("signup welcome delivery failed"),
    );

    await expect(executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    })).rejects.toThrow("signup welcome delivery failed");
    expect(mocks.upsertAssistantCronAutomation).not.toHaveBeenCalled();
  });

  it("skips failed allow-send-or-skip notifications instead of blocking ingress progress", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_allow_send_or_skip",
      memberId: "member_123",
      notification: {
        instructions: "Send the optional update if possible.",
        responsePolicy: {
          kind: "allow_send_or_skip",
        },
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });
    mocks.sendAssistantNotification.mockRejectedValueOnce(
      new Error("optional notification skipped by provider"),
    );

    await expect(executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    })).resolves.toMatchObject({
      conversationMetrics: null,
      mailboxLane: "assistant-notification",
    });
  });

  it.each([
    "creative-response",
    "creative-response-text",
  ] as const)(
    "settles a failed %s notification without replaying optional creative work",
    async (notificationPromptProfile) => {
      const wake = buildHostedExecutionAssistantNotificationRequestedWake({
        eventId: `evt_notification_${notificationPromptProfile}_failure`,
        memberId: "member_group_runtime",
        notification: {
          instructions: "Create one brief sponsorship thank-you.",
          notificationPromptProfile,
          responsePolicy: {
            kind: "require_send",
          },
          route: {
            actorId: null,
            channel: "linq",
            delivery: {
              kind: "thread",
              target: "thread_group_sponsorship",
            },
            identityId: "hbidx:phone:v1:test",
            threadId: "thread_group_sponsorship",
            threadIsDirect: false,
          },
        },
        occurredAt: "2026-04-08T00:00:00.000Z",
      });
      mocks.sendAssistantNotification.mockRejectedValueOnce(
        new Error("creative notification delivery failed"),
      );

      await expect(executeHostedMailboxEvent({
        wake,
        executionContext,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events",
      })).resolves.toMatchObject({
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
      });
      expect(mocks.sendAssistantNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationPromptProfile,
        }),
      );
    },
  );

  it("still fails closed for non-first-contact required notifications", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_required_failure",
      memberId: "member_123",
      notification: {
        instructions: "Send the required update.",
        responsePolicy: {
          kind: "require_send",
        },
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });
    mocks.sendAssistantNotification.mockRejectedValueOnce(
      new Error("required notification failed"),
    );

    await expect(executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    })).rejects.toThrow("required notification failed");
  });

  it("passes participant delivery notification data through unchanged", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_materialize_linq_home",
      memberId: "member_123",
      notification: {
        deliveryDedupeToken: "signup-welcome:member_123",
        deliveryIdempotencyKey: "signup-welcome:member_123",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph.",
        },
        route: {
          actorId: "hid_linq_actor_participant",
          channel: "linq",
          delivery: {
            kind: "participant",
            source: {
              fromPhoneNumber: "+15550001111",
              kind: "linq",
            },
            target: "+15550002222",
          },
          identityId: "hid_linq_identity_participant",
          threadId: null,
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith({
      actorId: "hid_linq_actor_participant",
      bindingDeliveryTarget: "+15550002222",
      channel: "linq",
      deliveryDedupeToken: "signup-welcome:member_123",
      deliveryDispatchMode: undefined,
      deliveryIdempotencyKey: "signup-welcome:member_123",
      deliveryKind: "participant",
      deliverySource: {
        fromPhoneNumber: "+15550001111",
        kind: "linq",
      },
      deliveryTarget: null,
      executionContext,
      firstContactPolicy: {
        markSeenOnDeliveryAccepted: true,
      },
      hostedDeliveryIdempotency: {
        assistantTurnOrdinal: "assistant-notification:1",
        conversationId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        inboundMailboxItemIds: ["evt_notification_materialize_linq_home"],
        recipientKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
      identityId: "hid_linq_identity_participant",
      instructions: "Send exactly the signup welcome.",
      onTraceEvent: expect.any(Function),
      responsePolicy: {
        kind: "require_send_exact_text",
        text: "Welcome to Murph.",
      },
      threadId: null,
      threadIsDirect: true,
      turnEnvironment: expectHostedTurnEnvironment({
        vaultRoot: "/tmp/assistant-runtime-events",
      }),
      turnTrigger: "manual-deliver",
      vault: "/tmp/assistant-runtime-events",
    });
    expect(mocks.upsertAssistantCronAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        route: {
          channel: "linq",
          deliverySource: {
            fromPhoneNumber: "+15550001111",
            kind: "linq",
          },
          deliveryTarget: null,
          identityId: "hid_linq_identity_participant",
          participantId: "+15550002222",
          threadId: null,
          threadIsDirect: true,
        },
        slug: "finish-onboarding-followup",
      }),
    );
  });

  it("logs a seed failure when target validation rejects Linq participant routes without delivery source", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_linq_participant_no_source",
      memberId: "member_123",
      notification: {
        deliveryDedupeToken: "signup-welcome:member_123",
        deliveryIdempotencyKey: "signup-welcome:member_123",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph.",
        },
        route: {
          actorId: "hid_linq_actor_participant",
          channel: "linq",
          delivery: {
            kind: "participant",
            target: "+15550002222",
          },
          identityId: "hid_linq_identity_participant",
          threadId: null,
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });
    // Deliverability is enforced by upsertAssistantCronAutomation's target
    // validation in assistant-engine (covered there); the runtime only
    // catches the rejection and logs the seed failure.
    mocks.upsertAssistantCronAutomation.mockRejectedValueOnce(
      Object.assign(
        new Error(
          "iMessage assistant cron jobs require an explicit delivery target or a participant target with a Linq delivery source.",
        ),
        { code: "ASSISTANT_CRON_DELIVERY_REQUIRED" },
      ),
    );

    const result = await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(result).toMatchObject({
      conversationMetrics: null,
      mailboxLane: "assistant-notification",
    });
    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "linq",
        deliveryKind: "participant",
        deliverySource: null,
        bindingDeliveryTarget: "+15550002222",
      }),
    );
    expect(mocks.upsertAssistantCronAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        route: expect.objectContaining({
          channel: "linq",
          deliverySource: null,
          deliveryTarget: null,
          participantId: "+15550002222",
        }),
      }),
    );
    expect(result.redactedLogEntries).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message: "Hosted onboarding follow-up automation seed failed.",
      }),
    );
  });

  it("rejects direct conversation wakes so mailbox staging owns assistant input", async () => {
    const linqWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq",
      linqMessage: {
        chatId: "chat_123",
        from: "+15551234567",
        isFromMe: false,
        messageId: "msg_123",
        parts: [],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "15551234567",
      userId: "member_123",
    });

    await expect(
      executeHostedMailboxEvent({
        wake: linqWake,
        executionContext,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events",
      }),
    ).rejects.toThrow(
      "Hosted conversation wakes must be imported through mailbox AssistantInputEvent staging.",
    );
    expect(mocks.prepareHostedWakeContext).not.toHaveBeenCalled();
    expect(mocks.sendAssistantNotification).not.toHaveBeenCalled();
  });

  it("rejects direct group newsletter email-needed wakes so mailbox staging owns the private note", async () => {
    const wake = buildHostedExecutionGroupNewsletterEmailNeededWake({
      eventId: "group-newsletter.email-needed:member_123:hgrp_123",
      groupDisplayName: "Tempo Crew",
      groupId: "hgrp_123",
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    await expect(
      executeHostedMailboxEvent({
        wake,
        executionContext,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events",
      }),
    ).rejects.toThrow(
      "Hosted group newsletter email-needed wakes are staged at mailbox import and must never reach system wake execution.",
    );
    expect(mocks.sendAssistantNotification).not.toHaveBeenCalled();
  });

  it("treats explicit member channel sync events as no-op wake handlers", async () => {
    const wake = buildHostedExecutionMemberChannelsUpdatedWake({
      eventId: "evt_member_channels_updated",
      memberChannels: {
        email: true,
        linq: false,
        telegram: true,
      },
      memberId: "member_123",
      occurredAt: "2026-04-08T00:03:00.000Z",
    });

    const result = await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.sendAssistantNotification).not.toHaveBeenCalled();
    assert.deepEqual(result, {
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "member-channels-updated",
      nextWakeAt: null,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
  });

  it("receives pending-effects reconciliation requests without running assistant work", async () => {
    const wake = buildHostedExecutionPendingEffectsReconcileRequestedWake({
      effectId: "vault-file-send:effect_123",
      eventId: "evt_pending_effects_reconcile",
      occurredAt: "2026-04-08T00:03:00.000Z",
      userId: "member_123",
    });

    const result = await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.sendAssistantNotification).not.toHaveBeenCalled();
    assert.deepEqual(result, {
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
  });

});
