import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionVaultShareAcceptedWake,
} from "@murphai/hosted-execution";
import {
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
  handleHostedShareAcceptedWake: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(async (value) => value),
  ingestHostedConversationMessageWake: vi.fn(),
  prepareHostedWakeContext: vi.fn(),
  sendAssistantNotification: vi.fn(),
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

vi.mock("../src/hosted-runtime/events/conversation.ts", () => ({
  ingestHostedConversationMessageWake: mocks.ingestHostedConversationMessageWake,
}));

vi.mock("../src/hosted-runtime/events/share.ts", () => ({
  handleHostedShareAcceptedWake: mocks.handleHostedShareAcceptedWake,
}));

import { executeHostedIngressEvent } from "../src/hosted-runtime/events.ts";
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
      usageExportPort: null,
    },
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: { ...userEnv },
  } as const;
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.emitHostedExecutionStructuredLog.mockReset();
  mocks.prepareHostedWakeContext.mockResolvedValue(null);
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (value) => value);
  mocks.handleHostedShareAcceptedWake.mockResolvedValue({
    shareImportResult: null,
    shareImportTitle: null,
  });
  mocks.ingestHostedConversationMessageWake.mockResolvedValue({
    nextWakeAt: null,
    parserProcessed: 0,
  });
});

describe("executeHostedIngressEvent", () => {
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
        },
      },
      wake,
    });

    expect(entry?.redacted).toEqual(
      expect.objectContaining({
        actorFingerprint: "h1_abcdef0123456789abcdef01",
        channel: "linq",
        primaryConversationScope: "thread",
        schema: "murph.assistant-context-diagnostics.v1",
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

  it("sends generic assistant notifications and returns noop wake metrics", async () => {
    const bootstrapResult = {
      assistantConfigStatus: "saved",
      assistantConfigured: true,
      assistantProvider: "openai-compatible" as const,
      assistantSeeded: false,
      emailAutoReplyEnabled: true,
      linqAutoReplyEnabled: true,
      telegramAutoReplyEnabled: true,
      vaultCreated: false,
    };
    mocks.prepareHostedWakeContext.mockResolvedValue(bootstrapResult);
    const debugSystemPrompt = "System prompt headed to Azure with notification rules. ".repeat(16);
    const debugUserPrompt = "Send exactly the signup welcome.";
    const debugRequestBody = JSON.stringify({
      model: "openai/gpt-5.4",
      input: [
        {
          content: [
            {
              text: debugUserPrompt,
              type: "input_text",
            },
          ],
          role: "user",
        },
      ],
      instructions: debugSystemPrompt,
      providerOptions: {
        gateway: {
          tags: "[redacted]",
          user: "[redacted]",
          zeroDataRetention: true,
        },
      },
      tools: [
        {
          name: "vault.show",
          type: "function",
        },
      ],
    });
    mocks.sendAssistantNotification.mockImplementationOnce(async (input) => {
      input.onTraceEvent?.({
        providerSessionId: null,
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
        providerSessionId: null,
        rawEvent: {
          schema: "murph.assistant-provider-request-debug.v1",
          type: "assistant.provider.request.debug",
          attemptCount: 1,
          channel: "linq",
          conversationMessageCount: 0,
          conversationMessageRoles: [],
          deliveryDispatchMode: "queue-only",
          gatewayOnlyProviderCount: 1,
          gatewayOnlyProviders: ["azure"],
          nativeResumePolicy: "disabled",
          promptProfile: "notification-decision",
          provider: "openai-compatible",
          providerExecutionDriver: "responses",
          providerModel: "openai/gpt-5.4",
          providerName: "vercel-ai-gateway",
          routeId: "route-notification",
          sessionContextPresent: false,
          supportsToolRuntime: true,
          systemPromptHash: "hash-system-prompt",
          systemPromptLength: debugSystemPrompt.length,
          toolCount: 0,
          toolNames: [],
          turnTrigger: "automation-cron",
          userPromptHash: "hash-user-prompt",
          userPromptLength: debugUserPrompt.length,
          zeroDataRetention: true,
        },
        updates: [],
      });
      input.onTraceEvent?.({
        providerSessionId: null,
        rawEvent: {
          schema: "murph.assistant-responses-request-debug.v1",
          type: "assistant.responses.request.debug",
          contextManagementPresent: true,
          gatewayOnlyProviderCount: 0,
          gatewayTagsCount: 1,
          gatewayUserPresent: true,
          gatewayZeroDataRetention: true,
          inputMessageCount: 1,
          inputRoles: ["user"],
          inputTextFieldCount: 1,
          inputTextHash: "hash-input",
          inputTextLength: debugUserPrompt.length,
          instructionsHash: "hash-instructions",
          instructionsLength: debugSystemPrompt.length,
          method: "POST",
          model: "openai/gpt-5.4",
          payloadTopLevelKeys: ["input", "instructions", "model", "providerOptions", "tools"],
          previousResponseIdPresent: false,
          providerOptionsHash: "hash-provider-options",
          requestBodyHash: "hash-request-body",
          requestBodyLength: debugRequestBody.length,
          requestUrlOrigin: "https://ai-gateway.vercel.sh",
          requestUrlPath: "/v1/responses",
          responseFormatHash: "hash-response-format",
          textConfigHash: "hash-text-config",
          toolChoice: "auto",
          toolCount: 1,
          toolNames: ["vault.show"],
          toolsHash: "hash-tools",
        },
        updates: [],
      });
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

    const runtime = createRuntime();
    const result = await executeHostedIngressEvent({
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
    );
    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith({
      actorId: "+15550002222",
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
      identityId: "hbidx:phone:v1:test",
      instructions: "Send exactly the signup welcome.",
      onTraceEvent: expect.any(Function),
      responsePolicy: {
        kind: "require_send_exact_text",
        text: "Welcome to Murph, your personal health assistant.",
      },
      threadId: "thread_123",
      threadIsDirect: true,
      turnTrigger: "automation-cron",
      vault: "/tmp/assistant-runtime-events",
    });
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
          assistantProviderRequest: expect.objectContaining({
            gatewayOnlyProviders: ["azure"],
            providerExecutionDriver: "responses",
            providerModel: "openai/gpt-5.4",
            providerName: "vercel-ai-gateway",
            schema: "murph.assistant-provider-request-debug.v1",
            systemPromptHash: "hash-system-prompt",
            systemPromptLength: debugSystemPrompt.length,
            userPromptHash: "hash-user-prompt",
            userPromptLength: debugUserPrompt.length,
            zeroDataRetention: true,
          }),
        }),
        message: "Hosted assistant provider request summary captured.",
        phase: "wake.running",
        wake,
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        component: "runtime.provider.http",
        details: expect.objectContaining({
          assistantResponsesRequest: expect.objectContaining({
            gatewayZeroDataRetention: true,
            model: "openai/gpt-5.4",
            requestBodyHash: "hash-request-body",
            requestBodyLength: debugRequestBody.length,
            requestUrlPath: "/v1/responses",
            toolNames: ["vault.show"],
          }),
        }),
        message: "Hosted assistant final Responses request summary captured.",
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
    expect(result.redactedLogEntries?.[2]?.redacted).toEqual(
      expect.objectContaining({
        assistantProviderRequest: expect.not.objectContaining({
          rawEvent: expect.anything(),
          systemPrompt: expect.anything(),
          systemPromptChunks: expect.anything(),
          userPrompt: expect.anything(),
          userPromptChunks: expect.anything(),
        }),
      }),
    );
    expect(result.redactedLogEntries?.[3]?.redacted).toEqual(
      expect.objectContaining({
        assistantResponsesRequest: expect.not.objectContaining({
          requestBody: expect.anything(),
          requestBodyChunkGroups: expect.anything(),
        }),
      }),
    );
    expect(result).toEqual({
      bootstrapResult,
      conversationMetrics: null,
      ingressLane: "assistant-notification",
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
          message: "Hosted assistant provider request summary captured.",
          phase: "wake.running",
          redacted: expect.objectContaining({
            assistantProviderRequest: expect.objectContaining({
              gatewayOnlyProviders: ["azure"],
              providerModel: "openai/gpt-5.4",
              systemPromptHash: "hash-system-prompt",
              userPromptHash: "hash-user-prompt",
              zeroDataRetention: true,
            }),
          }),
        },
        {
          component: "runtime.provider.http",
          eventId: "evt_notification",
          level: "info",
          message: "Hosted assistant final Responses request summary captured.",
          phase: "wake.running",
          redacted: expect.objectContaining({
            assistantResponsesRequest: expect.objectContaining({
              model: "openai/gpt-5.4",
              requestBodyHash: "hash-request-body",
              requestBodyLength: debugRequestBody.length,
              toolNames: ["vault.show"],
            }),
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
      shareImportResult: null,
      shareImportTitle: null,
      vaultSyncImportResult: null,
    });
  });

  it("rehydrates execution context after bootstrap before sending notifications", async () => {
    const hydratedExecutionContext = {
      hosted: {
        defaultTarget: {
          adapter: "openai-compatible" as const,
          apiKeyEnv: "OPENAI_API_KEY",
          endpoint: "https://gateway.example.test/v1",
          headers: null,
          model: "gpt-4.1-mini",
          presetId: null,
          providerName: "Hosted Gateway",
          reasoningEffort: null,
          webSearch: null,
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

    await executeHostedIngressEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      executionContext,
    );
    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith({
      actorId: "+15550002222",
      channel: "linq",
      deliveryDedupeToken: null,
      deliveryDispatchMode: undefined,
      deliveryIdempotencyKey: null,
      deliveryKind: "thread",
      deliverySource: null,
      deliveryTarget: null,
      executionContext: hydratedExecutionContext,
      firstContactPolicy: null,
      identityId: "hbidx:phone:v1:test",
      instructions: "Send exactly the signup welcome.",
      onTraceEvent: expect.any(Function),
      responsePolicy: null,
      threadId: "thread_123",
      threadIsDirect: true,
      turnTrigger: "automation-cron",
      vault: "/tmp/assistant-runtime-events",
    });
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
          assistantNotificationProvider: "openai-compatible",
          assistantNotificationProviderBaseUrlOrigin: "https://gateway.example.test",
          assistantNotificationProviderModel: "openai/gpt-5.4",
          assistantNotificationStage: "provider",
        },
        statusCode: 401,
      }),
    );

    const result = await executeHostedIngressEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(result).toMatchObject({
      conversationMetrics: null,
      ingressLane: "assistant-notification",
    });
    expect(result.redactedLogEntries).toEqual([
      expect.objectContaining({
        eventId: "evt_notification_skipped",
        message: "Hosted assistant notification started.",
      }),
      expect.objectContaining({
        eventId: "evt_notification_skipped",
        level: "warn",
        message: "Hosted assistant notification failed and was skipped so the hosted run can continue.",
        redacted: expect.objectContaining({
          assistantNotificationErrorCode: "authorization_error",
          assistantNotificationErrorCodeDetail: "invalid_api_key",
          assistantNotificationErrorDetail: "Provider rejected configured credentials.",
          assistantNotificationErrorMessage: "Hosted execution authorization failed.",
          assistantNotificationErrorName: "Error",
          assistantNotificationErrorStatus: 401,
          assistantNotificationProvider: "openai-compatible",
          assistantNotificationProviderBaseUrlConfigured: true,
          assistantNotificationProviderErrorCode: "invalid_api_key",
          assistantNotificationProviderModel: "openai/gpt-5.4",
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
        message: "Hosted assistant notification failed and was skipped so the hosted run can continue.",
        phase: "wake.running",
        wake,
      }),
    );
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

    await expect(executeHostedIngressEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    })).resolves.toMatchObject({
      conversationMetrics: null,
      ingressLane: "assistant-notification",
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

    await expect(executeHostedIngressEvent({
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
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "participant",
            source: {
              fromPhoneNumber: "+15550001111",
              kind: "linq",
            },
            target: "+15550002222",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: null,
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    await executeHostedIngressEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith({
      actorId: "+15550002222",
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
      identityId: "hbidx:phone:v1:test",
      instructions: "Send exactly the signup welcome.",
      onTraceEvent: expect.any(Function),
      responsePolicy: null,
      threadId: null,
      threadIsDirect: true,
      turnTrigger: "automation-cron",
      vault: "/tmp/assistant-runtime-events",
    });
  });

  it("routes Linq, Telegram, and email events to their hosted ingestion helpers", async () => {
    const runtime = createRuntime({
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
    });
    const vaultRoot = "/tmp/assistant-runtime-events";

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
    const linqResult = await executeHostedIngressEvent({
      wake: linqWake,
      executionContext,
      runtime,
      runtimeEnv: {},
      vaultRoot,
    });

    const telegramWake = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "evt_telegram",
      occurredAt: "2026-04-08T00:01:00.000Z",
      telegramMessage: {
        messageId: "tg_message_123",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "chat_123",
      },
      userId: "member_123",
    });
    await executeHostedIngressEvent({
      wake: telegramWake,
      executionContext,
      runtime,
      runtimeEnv: {},
      vaultRoot,
    });

    const emailWake = buildHostedExecutionEmailConversationMessageWake({
      eventId: "evt_email",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-04-08T00:02:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "user@example.com",
      userId: "member_123",
    });
    await executeHostedIngressEvent({
      wake: emailWake,
      executionContext,
      runtime,
      runtimeEnv: {
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
      },
      vaultRoot,
    });

    expect(mocks.ingestHostedConversationMessageWake).toHaveBeenNthCalledWith(1, {
      runtime,
      vaultRoot,
      wake: linqWake,
    });
    expect(mocks.ingestHostedConversationMessageWake).toHaveBeenNthCalledWith(2, {
      runtime,
      vaultRoot,
      wake: telegramWake,
    });
    expect(mocks.ingestHostedConversationMessageWake).toHaveBeenNthCalledWith(3, {
      runtime,
      vaultRoot,
      wake: emailWake,
    });
    expect(linqResult).toEqual({
      bootstrapResult: null,
      conversationMetrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      ingressLane: "conversation-message",
      redactedLogEntries: [
        {
          component: "runtime.context",
          eventId: "evt_linq",
          level: "info",
          message: "Hosted Linq conversation context fingerprints captured.",
          phase: "wake.running",
          redacted: expect.objectContaining({
            actorPresent: true,
            channel: "linq",
            contextSource: "linq-conversation-message",
            identityPresent: true,
            primaryConversationScope: "thread",
            threadIsDirect: true,
            threadPresent: true,
          }),
        },
      ],
      shareImportResult: null,
      shareImportTitle: null,
      vaultSyncImportResult: null,
    });
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

    const result = await executeHostedIngressEvent({
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
      ingressLane: "member-channels-updated",
      redactedLogEntries: [],
      shareImportResult: null,
      shareImportTitle: null,
      vaultSyncImportResult: null,
    });
  });

  it("requires a hydrated share pack for hosted share acceptance", async () => {
    const wake = buildHostedExecutionVaultShareAcceptedWake({
      eventId: "evt_share",
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
      share: {
        ownerUserId: "member_sender",
        shareId: "share_123",
      },
    });

    await expect(
      executeHostedIngressEvent({
        wake,
        executionContext,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events",
      }),
    ).rejects.toThrow(
      "Hosted share accepted wake requires a hydrated runner sharePack.",
    );
    expect(mocks.handleHostedShareAcceptedWake).not.toHaveBeenCalled();
  });

});
