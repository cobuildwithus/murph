import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
} from "@murphai/hosted-execution";
import {
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(async (value) => value),
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
          codexInvalidOutputFallbackAttempted: true,
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
          codexTimingElapsedMs: 8123,
          codexTimingProviderActionCount: 1,
          codexTimingThreadIdPresent: true,
          codexTimingStage: "turn-completed",
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
        codexTimingElapsedMs: 8123,
        codexTimingProviderActionCount: 1,
        codexTimingThreadIdPresent: true,
        codexTimingStage: "turn-completed",
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
  });

  it("captures hosted Codex warm app-server timing traces", () => {
    for (const stage of ["warm-reused", "warm-idle", "warm-abort-poisoned"]) {
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
          routePlanningSupportedExperimentProtocolsElapsedMs: 50,
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
        routePlanningFreshThreadFallbackPrepared: true,
        routePlanningFreshThreadFallbackPromptElapsedMs: 80,
        routePlanningMemoryOverviewElapsedMs: 900,
        routePlanningMeasuredElapsedMs: 6988,
        routePlanningPrimaryInstructionsElapsedMs: 70,
        routePlanningPrimarySystemPromptElapsedMs: 70,
        routePlanningResumeBindingElapsedMs: 3,
        routePlanningSlowestStage: "memory_overview",
        routePlanningSlowestStageElapsedMs: 900,
        routePlanningSupportedExperimentProtocolsElapsedMs: 50,
        routePlanningTargetCapabilitiesElapsedMs: 5,
        routePlanningUnaccountedElapsedMs: 12,
        routePlanningVaultOverviewElapsedMs: 900,
        workingDirectoryKind: "hosted-stable-proc-cwd",
      }),
    });
    expect(entry?.redacted).not.toHaveProperty("codexThreadId");
    expect(entry?.redacted).not.toHaveProperty("providerContinuation");
    expect(entry?.redacted).not.toHaveProperty("resumeProviderSessionIdPresent");
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
          existingTranscriptEntryCount: 0,
          existingTranscriptWelcomeVisible: false,
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
      turnTrigger: "automation-cron",
      vault: "/tmp/assistant-runtime-events",
    });
    expect(mocks.upsertAssistantCronAutomation).toHaveBeenCalledWith({
      firstOccurrencePolicy: "after-current-local-day",
      instructions: expect.stringContaining("vault-cli assistant onboarding status"),
      route: {
        channel: "linq",
        deliverySource: null,
        deliveryTarget: "thread_123",
        identityId: "hid_linq_identity_123",
        participantId: null,
        threadId: null,
      },
      schedule: {
        kind: "dailyLocal",
        localTime: "13:30",
      },
      slug: "finish-onboarding-followup",
      summary: "Daily setup continuation check until Murph onboarding is complete.",
      tags: ["assistant", "onboarding"],
      title: "Finish Murph onboarding follow-up",
      vault: "/tmp/assistant-runtime-events",
    });
    const seedInput = mocks.upsertAssistantCronAutomation.mock.calls.at(0)?.[0];
    expect(seedInput?.instructions).toContain(
      "vault-cli automation set-status finish-onboarding-followup --status archived",
    );
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
          existingTranscriptEntryCount: 0,
          existingTranscriptWelcomeVisible: false,
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
            existingTranscriptEntryCount: 0,
            existingTranscriptWelcomeVisible: false,
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

  it("rehydrates execution context after bootstrap before sending notifications", async () => {
    const hydratedExecutionContext = {
      hosted: {
        defaultTarget: {
          adapter: "codex-cli" as const,
          approvalPolicy: "never" as const,
          codexCommand: null,
          model: "gpt-5.5",
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
      turnTrigger: "automation-cron",
      vault: "/tmp/assistant-runtime-events",
    });
    expect(mocks.upsertAssistantCronAutomation).not.toHaveBeenCalled();
  });

  it("seeds onboarding follow-up for Telegram signup welcome routes", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_telegram_welcome",
      memberId: "member_123",
      notification: {
        deliveryIdempotencyKey: "signup-welcome:member_123",
        instructions: "Send exactly the signup welcome.",
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
        },
        slug: "finish-onboarding-followup",
      }),
    );
  });

  it("does not seed onboarding follow-up for non-exact signup welcome tokens", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_welcome_prefix_only",
      memberId: "member_123",
      notification: {
        deliveryIdempotencyKey: "signup-welcome:member_123:retry",
        instructions: "Send exactly the signup welcome.",
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

  it("does not seed onboarding follow-up when signup welcome delivery is skipped", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_welcome_skip_result",
      memberId: "member_123",
      notification: {
        deliveryIdempotencyKey: "signup-welcome:member_123",
        instructions: "Send exactly the signup welcome.",
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
        reason: "First contact was already accepted.",
      },
      deliveryOutcome: null,
      response: null,
      session: {
        sessionId: "session_notification_skip",
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
    expect(mocks.upsertAssistantCronAutomation).not.toHaveBeenCalled();
  });

  it("keeps signup welcome delivery successful when onboarding follow-up seeding fails", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_seed_failure",
      memberId: "member_123",
      notification: {
        deliveryDedupeToken: "signup-welcome:member_123",
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

  it("skips failed first-contact notifications instead of blocking ingress progress", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_skipped",
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
          assistantNotificationProviderModel: "gpt-5.5",
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
          assistantNotificationProviderModel: "gpt-5.5",
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
        deliveryIdempotencyKey: "signup-welcome:member_123",
        instructions: "Send exactly the signup welcome.",
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
      deliveryDedupeToken: null,
      deliveryDispatchMode: undefined,
      deliveryIdempotencyKey: "signup-welcome:member_123",
      deliveryKind: "participant",
      deliverySource: {
        fromPhoneNumber: "+15550001111",
        kind: "linq",
      },
      deliveryTarget: null,
      executionContext,
      firstContactPolicy: null,
      hostedDeliveryIdempotency: {
        assistantTurnOrdinal: "assistant-notification:1",
        conversationId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        inboundMailboxItemIds: ["evt_notification_materialize_linq_home"],
        recipientKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
      identityId: "hid_linq_identity_participant",
      instructions: "Send exactly the signup welcome.",
      onTraceEvent: expect.any(Function),
      responsePolicy: null,
      threadId: null,
      threadIsDirect: true,
      turnEnvironment: expectHostedTurnEnvironment({
        vaultRoot: "/tmp/assistant-runtime-events",
      }),
      turnTrigger: "automation-cron",
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
        },
        slug: "finish-onboarding-followup",
      }),
    );
  });

  it("skips onboarding follow-up seeding for Linq participant routes without delivery source", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification_linq_participant_no_source",
      memberId: "member_123",
      notification: {
        deliveryIdempotencyKey: "signup-welcome:member_123",
        instructions: "Send exactly the signup welcome.",
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
    expect(mocks.upsertAssistantCronAutomation).not.toHaveBeenCalled();
    expect(result.redactedLogEntries).not.toContainEqual(
      expect.objectContaining({
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

});
