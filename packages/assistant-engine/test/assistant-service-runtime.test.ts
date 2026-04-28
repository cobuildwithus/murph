import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AssistantDeliveryError,
  AssistantBindingDelivery,
  AssistantProviderSessionOptions,
  AssistantSession,
} from "@murphai/operator-config/assistant-cli-contracts";
import { createAssistantModelTarget } from "@murphai/operator-config/assistant-backend";
import { serializeAssistantProviderSessionOptions } from "@murphai/operator-config/assistant/provider-config";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";
import type { ResolvedAssistantFailoverRoute } from "../src/assistant/failover.ts";
import type { AssistantProviderUsage } from "../src/assistant/providers/types.ts";
import type {
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from "../src/assistant/service-contracts.ts";

const seamMocks = vi.hoisted(() => ({
  buildAssistantCliGuidanceText: vi.fn(),
  buildResolveAssistantSessionInput: vi.fn(),
  completeAssistantOnboarding: vi.fn(),
  createAssistantRuntimeStateService: vi.fn(),
  createAssistantUsageId: vi.fn(),
  isAssistantSessionNotFoundError: vi.fn(),
  local: {
    openAssistantConversationLocal: vi.fn(),
    sendAssistantNotificationLocal: vi.fn(),
    sendAssistantMessageLocal: vi.fn(),
    updateAssistantSessionOptionsLocal: vi.fn(),
  },
  markAssistantFirstContactSeen: vi.fn(),
  normalizeAssistantDeliveryError: vi.fn(),
  resolveAssistantExecutionPlan: vi.fn(),
  resolveAssistantSession: vi.fn(),
  resolveAssistantUsageCredentialSource: vi.fn(),
  writePendingAssistantUsageRecord: vi.fn(),
}));

vi.mock("../src/assistant/local-service.js", () => ({
  openAssistantConversationLocal:
    seamMocks.local.openAssistantConversationLocal,
  sendAssistantMessageLocal: seamMocks.local.sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal:
    seamMocks.local.updateAssistantSessionOptionsLocal,
}));
vi.mock("../src/assistant/notification-turn.js", () => ({
  sendAssistantNotificationLocal: seamMocks.local.sendAssistantNotificationLocal,
}));

vi.mock("../src/assistant/store.js", () => ({
  isAssistantSessionNotFoundError: seamMocks.isAssistantSessionNotFoundError,
  resolveAssistantSession: seamMocks.resolveAssistantSession,
}));

vi.mock("../src/assistant/session-resolution.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/assistant/session-resolution.ts")
  >("../src/assistant/session-resolution.ts");

  return {
    ...actual,
    buildResolveAssistantSessionInput:
      seamMocks.buildResolveAssistantSessionInput,
  };
});

vi.mock("../src/assistant/execution-plan.js", () => ({
  resolveAssistantExecutionPlan: seamMocks.resolveAssistantExecutionPlan,
}));

vi.mock("@murphai/runtime-state/node", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@murphai/runtime-state/node")
  >();

  return {
    ...actual,
    ASSISTANT_USAGE_SCHEMA: "murph.assistant-usage.v1",
    createAssistantUsageId: seamMocks.createAssistantUsageId,
    resolveAssistantUsageCredentialSource:
      seamMocks.resolveAssistantUsageCredentialSource,
    writePendingAssistantUsageRecord: seamMocks.writePendingAssistantUsageRecord,
  };
});

vi.mock("../src/assistant/first-contact.js", () => ({
  markAssistantFirstContactSeen: seamMocks.markAssistantFirstContactSeen,
}));

vi.mock("../src/assistant/onboarding-state.js", () => ({
  completeAssistantOnboarding: seamMocks.completeAssistantOnboarding,
}));

vi.mock("../src/assistant/outbox.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/assistant/outbox.ts")
  >("../src/assistant/outbox.ts");

  return {
    ...actual,
    normalizeAssistantDeliveryError: seamMocks.normalizeAssistantDeliveryError,
  };
});

vi.mock("../src/assistant/runtime-state-service.js", () => ({
  createAssistantRuntimeStateService:
    seamMocks.createAssistantRuntimeStateService,
}));

vi.mock("../src/assistant-cli-access.js", () => ({
  buildAssistantCliGuidanceText: seamMocks.buildAssistantCliGuidanceText,
}));

import * as assistantService from "../src/assistant/service.ts";
import {
  buildAssistantTurnDeliveryFinalizationPlan,
  deliverAssistantReply,
  finalizeAssistantTurnFromDeliveryOutcome,
} from "../src/assistant/delivery-service.ts";
import {
  normalizeAssistantExecutionContext,
  resolveAssistantExecutionDefaultTarget,
  resolveAssistantExecutionOperatorDefaults,
} from "../src/assistant/execution-context.ts";
import {
  resolveAssistantTurnRoutes,
  resolveAssistantTurnRoutesForMessage,
  selectAssistantTurnRouteOverride,
} from "../src/assistant/service-turn-routes.ts";
import { persistPendingAssistantUsageEvent } from "../src/assistant/service-usage.ts";
import { ASSISTANT_TRANSCRIPT_AUDIT_TEXT_PREFIX } from "../src/assistant/transcript-audit.ts";
import { persistAssistantTurnAndSession } from "../src/assistant/turn-finalizer.ts";

type RuntimeStateStub = ReturnType<typeof createRuntimeStateStub>;

let runtimeState: RuntimeStateStub;

beforeEach(() => {
  vi.useRealTimers();

  seamMocks.buildAssistantCliGuidanceText
    .mockReset()
    .mockReturnValue("CLI guidance block.");
  seamMocks.buildResolveAssistantSessionInput.mockReset().mockReturnValue({
    createIfMissing: true,
    sessionId: "session-from-builder",
    vault: "/vault",
  });
  seamMocks.completeAssistantOnboarding
    .mockReset()
    .mockResolvedValue({
      completedAt: "2026-04-08T12:30:00.000Z",
      completedReason: "concrete_request",
      createdAt: "2026-04-08T12:30:00.000Z",
      schemaVersion: "murph.assistant-onboarding.v1",
      status: "completed",
      updatedAt: "2026-04-08T12:30:00.000Z",
    });
  seamMocks.createAssistantUsageId
    .mockReset()
    .mockImplementation(
      ({
        attemptCount,
        providerRequestOrdinal,
        turnId,
      }: {
        attemptCount: number;
        providerRequestOrdinal?: number;
        turnId: string;
      }) => `${turnId}:${providerRequestOrdinal ?? 0}:${attemptCount}`
    );
  seamMocks.isAssistantSessionNotFoundError
    .mockReset()
    .mockImplementation((error: unknown) =>
      Boolean(
        error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ASSISTANT_SESSION_NOT_FOUND"
      )
    );
  seamMocks.local.openAssistantConversationLocal.mockReset();
  seamMocks.local.sendAssistantNotificationLocal.mockReset();
  seamMocks.local.sendAssistantMessageLocal.mockReset();
  seamMocks.local.updateAssistantSessionOptionsLocal.mockReset();
  seamMocks.markAssistantFirstContactSeen
    .mockReset()
    .mockResolvedValue(undefined);
  seamMocks.normalizeAssistantDeliveryError.mockReset().mockReturnValue(
    createDeliveryError({
      code: "ASSISTANT_DELIVERY_FAILED",
      message: "normalized delivery failure",
    })
  );
  seamMocks.resolveAssistantExecutionPlan.mockReset().mockReturnValue({
    routes: [createRoute()],
  });
  seamMocks.resolveAssistantSession.mockReset();
  seamMocks.resolveAssistantUsageCredentialSource
    .mockReset()
    .mockReturnValue("hosted-user-env");
  seamMocks.writePendingAssistantUsageRecord
    .mockReset()
    .mockResolvedValue(undefined);

  runtimeState = createRuntimeStateStub();
  seamMocks.createAssistantRuntimeStateService
    .mockReset()
    .mockReturnValue(runtimeState);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("assistant service wrapper seam", () => {
  it("delegates conversation and message flows to the local service", async () => {
    const conversationResult = {
      session: createAssistantSession(),
    };
    const messageResult = {
      response: "done",
    };
    seamMocks.local.openAssistantConversationLocal.mockResolvedValue(
      conversationResult
    );
    seamMocks.local.sendAssistantMessageLocal.mockResolvedValue(messageResult);

    await expect(
      assistantService.openAssistantConversation({
        sessionId: "session-1",
        vault: "/vault",
      })
    ).resolves.toBe(conversationResult);
    await expect(
      assistantService.sendAssistantMessage({
        prompt: "hello",
        vault: "/vault",
      })
    ).resolves.toBe(messageResult);

    expect(seamMocks.local.openAssistantConversationLocal).toHaveBeenCalledWith(
      {
        sessionId: "session-1",
        vault: "/vault",
      }
    );
    expect(seamMocks.local.sendAssistantMessageLocal).toHaveBeenCalledWith({
      prompt: "hello",
      vault: "/vault",
    });
  });

  it("delegates notification and session option updates to the local service", async () => {
    const notificationInput = {
      channel: "telegram",
      identityId: "identity-1",
      instructions: "Send the Murph signup welcome.",
      vault: "/vault",
    };
    const notificationResult = {
      decision: {
        kind: "send_message",
        privateSummary: "sent",
        text: "Welcome to Murph, your personal health assistant.",
      },
      response: "Welcome to Murph, your personal health assistant.",
      session: createAssistantSession(),
    };
    const updatedSession = createAssistantSession({
      providerOptions: createProviderOptions({
        model: "gpt-5-mini",
      }),
    });
    seamMocks.local.sendAssistantNotificationLocal.mockResolvedValue(
      notificationResult
    );
    seamMocks.local.updateAssistantSessionOptionsLocal.mockResolvedValue(
      updatedSession
    );

    await expect(
      assistantService.sendAssistantNotification(notificationInput)
    ).resolves.toBe(notificationResult);
    await expect(
      assistantService.updateAssistantSessionOptions({
        providerOptions: {
          provider: "codex-cli",
          model: "gpt-5-mini",
        },
        sessionId: "session-1",
        vault: "/vault",
      })
    ).resolves.toBe(updatedSession);

    expect(
      seamMocks.local.sendAssistantNotificationLocal
    ).toHaveBeenCalledWith(notificationInput);
    expect(
      seamMocks.local.updateAssistantSessionOptionsLocal
    ).toHaveBeenCalledWith({
      providerOptions: {
        provider: "codex-cli",
        model: "gpt-5-mini",
      },
      sessionId: "session-1",
      vault: "/vault",
    });
  });
});

describe("assistant service turn routes", () => {
  it("builds routes from the resolved session execution plan", () => {
    const defaults = {
      backend: null,
      identityId: null,
      selfDeliveryTargets: null,
    };
    const resolved = {
      created: false,
      paths: resolveAssistantStatePaths("/vault"),
      session: createAssistantSession({
        resumeState: {
          providerSessionId: "provider-session-existing",
          resumeRouteId: "route-existing",
        },
      }),
    };
    const input = {
      model: "gpt-5-mini",
      prompt: "Summarize today.",
      provider: "codex-cli" as const,
      vault: "/vault",
    };
    const routes = [createRoute({ routeId: "route-primary" })];
    seamMocks.resolveAssistantExecutionPlan.mockReturnValue({
      routes,
    });

    const result = resolveAssistantTurnRoutes(input, defaults, resolved);

    expect(result).toBe(routes);
    expect(seamMocks.resolveAssistantExecutionPlan).toHaveBeenCalledWith({
      defaults,
      override: expect.objectContaining({
        model: "gpt-5-mini",
        provider: "codex-cli",
      }),
      resumeState: resolved.session.resumeState,
      sessionTarget: resolved.session.target,
    });
  });

  it("resolves message routes from an existing session when present", async () => {
    const builtInput = {
      createIfMissing: true,
      sessionId: "session-1",
      vault: "/vault",
    };
    const resolved = {
      session: createAssistantSession(),
    };
    seamMocks.buildResolveAssistantSessionInput.mockReturnValue(builtInput);
    seamMocks.resolveAssistantSession.mockResolvedValue(resolved);
    seamMocks.resolveAssistantExecutionPlan.mockReturnValue({
      routes: [createRoute({ routeId: "route-session" })],
    });

    const result = await resolveAssistantTurnRoutesForMessage(
      {
        prompt: "hello",
        vault: "/vault",
      },
      null,
      null
    );

    expect(result).toEqual([createRoute({ routeId: "route-session" })]);
    expect(seamMocks.resolveAssistantSession).toHaveBeenCalledWith({
      ...builtInput,
      createIfMissing: false,
    });
    expect(seamMocks.resolveAssistantExecutionPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeState: resolved.session.resumeState,
        sessionTarget: resolved.session.target,
      })
    );
  });

  it("falls back to boundary defaults when the session is missing and rethrows other errors", async () => {
    seamMocks.resolveAssistantSession.mockRejectedValueOnce({
      code: "ASSISTANT_SESSION_NOT_FOUND",
    });
    seamMocks.resolveAssistantExecutionPlan.mockReturnValueOnce({
      routes: [createRoute({ routeId: "route-fallback" })],
    });

    await expect(
      resolveAssistantTurnRoutesForMessage(
        {
          prompt: "hello",
          vault: "/vault",
        },
        null,
        createAssistantSession().target
      )
    ).resolves.toEqual([createRoute({ routeId: "route-fallback" })]);

    seamMocks.resolveAssistantSession.mockRejectedValueOnce(
      new Error("session store exploded")
    );

    await expect(
      resolveAssistantTurnRoutesForMessage(
        {
          prompt: "hello",
          vault: "/vault",
        },
        null,
        null
      )
    ).rejects.toThrow("session store exploded");
  });

  it("returns route overrides only for non-primary selections", () => {
    const primary = createRoute({ routeId: "route-primary" });
    const backup = createRoute({
      provider: "codex-cli",
      providerOptions: createProviderOptions({
        approvalPolicy: "never",
        model: "gpt-5-codex",
        modelProvider: "vercel-ai-gateway",
        profile: "ops",
        sandbox: "danger-full-access",
      }),
      routeId: "route-backup",
    });

    expect(
      selectAssistantTurnRouteOverride(
        [primary, backup],
        (route) => route.routeId === "missing"
      )
    ).toEqual({
      providerOverride: null,
      route: null,
    });

    expect(
      selectAssistantTurnRouteOverride(
        [primary, backup],
        (route) => route.routeId === primary.routeId
      )
    ).toEqual({
      providerOverride: null,
      route: primary,
    });

    expect(
      selectAssistantTurnRouteOverride(
        [primary, backup],
        (route) => route.routeId === backup.routeId
      )
    ).toEqual({
      providerOverride: {
        approvalPolicy: backup.providerOptions.approvalPolicy ?? null,
        codexCommand: undefined,
        codexHome: backup.providerOptions.codexHome ?? null,
        model: backup.providerOptions.model ?? null,
        modelProvider: backup.providerOptions.modelProvider ?? null,
        oss: false,
        profile: backup.providerOptions.profile ?? null,
        provider: "codex-cli",
        reasoningEffort: backup.providerOptions.reasoningEffort ?? null,
        sandbox: backup.providerOptions.sandbox ?? null,
      },
      route: backup,
    });

    const nullableBackup = createRoute({
      providerOptions: {
        approvalPolicy: null,
        model: null,
        modelProvider: null,
        reasoningEffort: null,
        sandbox: null,
      },
      routeId: "route-nullable",
    });

    expect(
      selectAssistantTurnRouteOverride(
        [primary, nullableBackup],
        (route) => route.routeId === nullableBackup.routeId
      )
    ).toEqual({
      providerOverride: {
        approvalPolicy: null,
        codexCommand: undefined,
        codexHome: null,
        model: null,
        modelProvider: null,
        oss: false,
        profile: null,
        provider: "codex-cli",
        reasoningEffort: "medium",
        sandbox: null,
      },
      route: nullableBackup,
    });
  });
});

describe("assistant pending usage seam", () => {
  it("skips persistence when usage data or a hosted member id is missing", async () => {
    await persistPendingAssistantUsageEvent({
      executionContext: {
        hosted: {
          memberId: "member-1",
          userEnvKeys: [],
        },
      },
      providerResult: {
        ...createProviderResult(),
        usage: null,
      },
      turnId: "turn-1",
      vault: "/vault",
    });

    await persistPendingAssistantUsageEvent({
      executionContext: {
        hosted: {
          memberId: "   ",
          userEnvKeys: [],
        },
      },
      providerResult: createProviderResult(),
      turnId: "turn-2",
      vault: "/vault",
    });

    expect(seamMocks.writePendingAssistantUsageRecord).not.toHaveBeenCalled();
  });

  it("persists hosted pending usage with normalized provider metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T10:00:00.000Z"));

    await persistPendingAssistantUsageEvent({
      executionContext: {
        hosted: {
          memberId: " member-42 ",
          userEnvKeys: [" CODEX_API_KEY ", "", "CUSTOM_KEY"],
        },
      },
      providerResult: createProviderResult({
        attemptCount: 3,
        providerSessionId: "provider-session-42",
        route: createRoute({ routeId: "route-usage" }),
        usage: {
          apiKeyEnv: " RUNTIME_KEY ",
          baseUrl: " https://usage.example.test/v1 ",
          cacheWriteTokens: 5,
          cachedInputTokens: 7,
          inputTokens: 11,
          outputTokens: 13,
          providerMetadataJson: '{"source":"runtime"}',
          providerName: " Runtime Provider ",
          providerRequestId: "request-42",
          rawUsageJson: '{"raw":true}',
          reasoningTokens: 17,
          requestedModel: "gpt-5",
          servedModel: "gpt-5-mini",
          totalTokens: 41,
        },
      }),
      turnId: "turn-usage",
      vault: "/vault",
    });

    expect(seamMocks.createAssistantUsageId).toHaveBeenCalledWith({
      attemptCount: 3,
      providerRequestOrdinal: 0,
      turnId: "turn-usage",
    });
    expect(
      seamMocks.resolveAssistantUsageCredentialSource
    ).toHaveBeenCalledWith({
      apiKeyEnv: "RUNTIME_KEY",
      headers: null,
      provider: "codex-cli",
      userEnvKeys: [" CODEX_API_KEY ", "", "CUSTOM_KEY"],
    });
    expect(seamMocks.writePendingAssistantUsageRecord).toHaveBeenCalledWith({
      vault: "/vault",
      record: {
        apiKeyEnv: "RUNTIME_KEY",
        attemptCount: 3,
        baseUrl: "https://usage.example.test/v1",
        cacheWriteTokens: 5,
        cachedInputTokens: 7,
        credentialSource: "hosted-user-env",
        featureKey: null,
        gatewayTags: [],
        inputTokens: 11,
        memberId: "member-42",
        occurredAt: "2026-04-08T10:00:00.000Z",
        outputTokens: 13,
        provider: "codex-cli",
        providerName: "Runtime Provider",
        providerRequestOrdinal: 0,
        reasoningTokens: 17,
        reportingUserId: null,
        requestedModel: "gpt-5",
        routeId: "route-usage",
        schema: "murph.assistant-usage.v1",
        servedModel: "gpt-5-mini",
        sessionId: "session-test",
        stripeMeterSource: "murph",
        surface: null,
        totalTokens: 41,
        triggerKind: null,
        turnId: "turn-usage",
        usageId: "turn-usage:0:3",
      },
    });
  });

  it("uses Codex provider options without legacy credential headers for fallback hosted usage attribution", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T10:02:00.000Z"));

    await persistPendingAssistantUsageEvent({
      executionContext: {
        hosted: {
          memberId: "member-42",
          userEnvKeys: [],
        },
      },
      providerResult: createProviderResult({
        providerOptions: createProviderOptions(),
      }),
      turnId: "turn-usage-header-fallback",
      vault: "/vault",
    });

    expect(
      seamMocks.resolveAssistantUsageCredentialSource
    ).toHaveBeenCalledWith({
      apiKeyEnv: null,
      headers: null,
      provider: "codex-cli",
      userEnvKeys: [],
    });
    expect(seamMocks.writePendingAssistantUsageRecord).toHaveBeenCalledWith({
      vault: "/vault",
      record: expect.objectContaining({
        credentialSource: "hosted-user-env",
        occurredAt: "2026-04-08T10:02:00.000Z",
        turnId: "turn-usage-header-fallback",
      }),
    });
  });

  it("falls back to provider options when usage-level provider metadata is absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T10:05:00.000Z"));

    await persistPendingAssistantUsageEvent({
      executionContext: {
        hosted: {
          memberId: "member-43",
          userEnvKeys: [],
        },
      },
      providerResult: createProviderResult({
        providerOptions: createProviderOptions({
          model: "gpt-5.5-fallback",
        }),
        usage: {
          apiKeyEnv: null,
          baseUrl: null,
          cacheWriteTokens: null,
          cachedInputTokens: null,
          inputTokens: 1,
          outputTokens: 2,
          providerMetadataJson: null,
          providerName: null,
          providerRequestId: null,
          rawUsageJson: null,
          reasoningTokens: null,
          requestedModel: null,
          servedModel: null,
          totalTokens: 3,
        },
      }),
      turnId: "turn-usage-fallback",
      vault: "/vault",
    });

    expect(seamMocks.writePendingAssistantUsageRecord).toHaveBeenLastCalledWith(
      {
        vault: "/vault",
        record: expect.objectContaining({
          apiKeyEnv: null,
          baseUrl: null,
          memberId: "member-43",
          occurredAt: "2026-04-08T10:05:00.000Z",
          providerName: null,
          requestedModel: "gpt-5.5-fallback",
        }),
      }
    );
  });
});

describe("assistant delivery orchestration seam", () => {
  it("returns not-requested without touching the outbox when delivery is disabled", async () => {
    const session = createAssistantSession();

    await expect(
      deliverAssistantReply({
        input: {
          deliverResponse: false,
          prompt: "hello",
          vault: "/vault",
        },
        response: "reply",
        session,
        sharedPlan: createSharedPlan(),
        turnId: "turn-1",
      })
    ).resolves.toEqual({
      kind: "not-requested",
      session,
    });

    expect(runtimeState.outbox.deliverMessage).not.toHaveBeenCalled();
  });

  it("delivers via the outbox with audience overrides and raw content", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "local",
        conversationKey: "binding-key",
        delivery: {
          kind: "participant",
          target: "binding-delivery",
        },
        identityId: "binding-identity",
        threadId: "binding-thread",
        threadIsDirect: true,
      },
    });
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "telegram",
        idempotencyKey: "idem-1",
        messageLength: 10,
        providerMessageId: "provider-1",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "explicit-audience-target",
        targetKind: "explicit",
      },
      intent: {
        intentId: "intent-1",
      },
      kind: "sent",
      session: null,
    });

    await expect(
      deliverAssistantReply({
        input: {
          deliverResponse: true,
          deliveryDispatchMode: "immediate",
          deliveryReplyToMessageId: "reply-input",
          deliveryTarget: "explicit-input-target",
          prompt: "hello",
          vault: "/vault",
        },
        response: "reply body",
        session,
        sharedPlan: createSharedPlan({
          conversationPolicy: {
            audience: {
              actorId: "audience-actor",
              bindingDelivery: {
                kind: "participant",
                target: "audience-delivery",
              },
              channel: "telegram",
              explicitTarget: "explicit-audience-target",
              identityId: "audience-identity",
              replyToMessageId: "reply-audience",
              threadId: "audience-thread",
              threadIsDirect: false,
            },
          },
        }),
        turnId: "turn-2",
      })
    ).resolves.toEqual({
      delivery: {
        channel: "telegram",
        idempotencyKey: "idem-1",
        messageLength: 10,
        providerMessageId: "provider-1",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "explicit-audience-target",
        targetKind: "explicit",
      },
      intentId: "intent-1",
      kind: "sent",
      session,
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith({
      actorId: "audience-actor",
      bindingDelivery: {
        kind: "participant",
        target: "audience-delivery",
      },
      channel: "telegram",
      deliveryIdempotencyKey: null,
      deliverySource: null,
      dependencies: undefined,
      dispatchMode: "immediate",
      explicitTarget: "explicit-audience-target",
      identityId: "audience-identity",
      message: "reply body",
      replyToMessageId: "reply-input",
      sessionId: session.sessionId,
      subject: null,
      threadId: "audience-thread",
      threadIsDirect: false,
      turnId: "turn-2",
    });
  });

  it("passes outbound delivery text through unchanged for user-facing channels", async () => {
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "email",
        idempotencyKey: "idem-visible-dev",
        messageLength: 32,
        providerMessageId: "provider-visible-dev",
        providerThreadId: null,
        sentAt: "2026-04-08T11:05:00.000Z",
        target: "person@example.com",
        targetKind: "explicit",
      },
      intent: {
        intentId: "intent-visible-dev",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        prompt: "hello",
        vault: "/vault",
      },
      response: "Visible reply\n\n[DEV] local note",
      session: createAssistantSession({
        binding: {
          actorId: "binding-actor",
          channel: "email",
          conversationKey: "binding-key",
          delivery: {
            kind: "participant",
            target: "binding-delivery",
          },
          identityId: "binding-identity",
          threadId: "binding-thread",
          threadIsDirect: true,
        },
      }),
      sharedPlan: createSharedPlan({
        conversationPolicy: {
          audience: {
            channel: "email",
          },
        },
      }),
      turnId: "turn-visible-dev",
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Visible reply\n\n[DEV] local note",
      }),
    );
  });

  it("maps queued, failed, and unknown delivery results into public outcomes", async () => {
    const session = createAssistantSession();

    runtimeState.outbox.deliverMessage.mockResolvedValueOnce({
      deliveryError: null,
      intent: {
        intentId: "intent-queued",
      },
      kind: "queued",
      session: createAssistantSession({
        sessionId: "session-queued",
      }),
    });

    await expect(
      deliverAssistantReply({
        input: {
          deliverResponse: true,
          prompt: "hello",
          vault: "/vault",
        },
        response: "reply",
        session,
        sharedPlan: createSharedPlan(),
        turnId: "turn-queued",
      })
    ).resolves.toEqual({
      error: null,
      intentId: "intent-queued",
      kind: "queued",
      session: expect.objectContaining({
        sessionId: "session-queued",
      }),
    });

    const deliveryError = createDeliveryError({
      code: "CHANNEL_UNAVAILABLE",
      message: "channel unavailable",
    });
    runtimeState.outbox.deliverMessage.mockResolvedValueOnce({
      deliveryError,
      intent: {
        intentId: "intent-failed",
      },
      kind: "failed",
      session: null,
    });

    await expect(
      deliverAssistantReply({
        input: {
          deliverResponse: true,
          prompt: "hello",
          vault: "/vault",
        },
        response: "reply",
        session,
        sharedPlan: createSharedPlan(),
        turnId: "turn-failed",
      })
    ).resolves.toEqual({
      error: deliveryError,
      intentId: "intent-failed",
      kind: "failed",
      session,
    });

    runtimeState.outbox.deliverMessage.mockResolvedValueOnce({
      intent: {
        intentId: "intent-unknown",
      },
      kind: "mystery",
      session: null,
    });

    await expect(
      deliverAssistantReply({
        input: {
          deliverResponse: true,
          prompt: "hello",
          vault: "/vault",
        },
        response: "reply",
        session,
        sharedPlan: createSharedPlan(),
        turnId: "turn-unknown",
      })
    ).resolves.toEqual({
      error: createDeliveryError({
        code: "ASSISTANT_DELIVERY_FAILED",
        message: "normalized delivery failure",
      }),
      intentId: "unknown",
      kind: "failed",
      session,
    });

    expect(seamMocks.normalizeAssistantDeliveryError).toHaveBeenCalledTimes(1);
  });

  it("builds receipt and diagnostic plans for every delivery disposition", () => {
    const session = createAssistantSession();

    expect(
      buildAssistantTurnDeliveryFinalizationPlan({
        completedAt: "2026-04-08T12:00:00.000Z",
        outcome: {
          kind: "not-requested",
          session,
        },
        response: "reply",
        turnId: "turn-not-requested",
      })
    ).toEqual({
      diagnostic: expect.objectContaining({
        counterDeltas: {
          turnsCompleted: 1,
        },
        kind: "turn.completed",
      }),
      receipt: expect.objectContaining({
        deliveryDisposition: "not-requested",
        status: "completed",
      }),
    });

    expect(
      buildAssistantTurnDeliveryFinalizationPlan({
        completedAt: "2026-04-08T12:00:00.000Z",
        outcome: {
          delivery: {
            channel: "telegram",
            idempotencyKey: null,
            messageLength: 5,
            providerMessageId: "provider-2",
            providerThreadId: null,
            sentAt: "2026-04-08T12:00:00.000Z",
            target: "thread-1",
            targetKind: "thread",
          },
          intentId: "intent-sent",
          kind: "sent",
          session,
        },
        response: "reply",
        turnId: "turn-sent",
      })
    ).toEqual({
      diagnostic: expect.objectContaining({
        intentId: "intent-sent",
        kind: "turn.completed",
      }),
      receipt: expect.objectContaining({
        deliveryDisposition: "sent",
        deliveryIntentId: "intent-sent",
        status: "completed",
      }),
    });

    const retryableError = createDeliveryError({
      code: "RETRYABLE",
      message: "try again",
    });
    expect(
      buildAssistantTurnDeliveryFinalizationPlan({
        completedAt: "2026-04-08T12:00:00.000Z",
        outcome: {
          error: retryableError,
          intentId: "intent-queued",
          kind: "queued",
          session,
        },
        response: "reply",
        turnId: "turn-queued",
      })
    ).toEqual({
      diagnostic: expect.objectContaining({
        code: "RETRYABLE",
        kind: "turn.deferred",
        level: "warn",
      }),
      receipt: expect.objectContaining({
        deliveryDisposition: "retryable",
        status: "deferred",
      }),
    });

    expect(
      buildAssistantTurnDeliveryFinalizationPlan({
        completedAt: "2026-04-08T12:00:00.000Z",
        outcome: {
          error: createDeliveryError({
            code: "DELIVERY_FAILED",
            message: "delivery failed",
          }),
          intentId: null,
          kind: "failed",
          session,
        },
        response: "reply",
        turnId: "turn-failed",
      })
    ).toEqual({
      diagnostic: expect.objectContaining({
        code: "DELIVERY_FAILED",
        kind: "turn.failed",
        level: "error",
      }),
      receipt: expect.objectContaining({
        deliveryDisposition: "failed",
        status: "failed",
      }),
    });
  });

  it("finalizes receipts, settles no-command onboarding completion, and marks first contact only for injected sent turns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T12:30:00.000Z"));

    await finalizeAssistantTurnFromDeliveryOutcome({
      onboardingCompletionFallbackReason: "concrete_request",
      onboardingGuidanceInjected: true,
      firstContactStateDocIds: ["doc-1", "doc-2"],
      outcome: {
        delivery: {
          channel: "telegram",
          idempotencyKey: null,
          messageLength: 5,
          providerMessageId: "provider-3",
          providerThreadId: null,
          sentAt: "2026-04-08T12:30:00.000Z",
          target: "thread-1",
          targetKind: "thread",
        },
        intentId: "intent-3",
        kind: "sent",
        session: createAssistantSession({
          sessionId: "session-sent",
        }),
      },
      response: "reply",
      turnId: "turn-finalize",
      vault: "/vault",
    });

    expect(runtimeState.turns.finalizeReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        completedAt: "2026-04-08T12:30:00.000Z",
        deliveryDisposition: "sent",
        status: "completed",
        turnId: "turn-finalize",
      })
    );
    expect(runtimeState.diagnostics.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        at: "2026-04-08T12:30:00.000Z",
        intentId: "intent-3",
        kind: "turn.completed",
        sessionId: "session-sent",
        turnId: "turn-finalize",
      })
    );
    expect(seamMocks.completeAssistantOnboarding).toHaveBeenCalledWith({
      completedAt: "2026-04-08T12:30:00.000Z",
      reason: "concrete_request",
      vault: "/vault",
    });
    expect(seamMocks.markAssistantFirstContactSeen).toHaveBeenCalledWith({
      docIds: ["doc-1", "doc-2"],
      seenAt: "2026-04-08T12:30:00.000Z",
      vault: "/vault",
    });

    seamMocks.completeAssistantOnboarding.mockClear();
    seamMocks.markAssistantFirstContactSeen.mockClear();

    await finalizeAssistantTurnFromDeliveryOutcome({
      onboardingGuidanceInjected: true,
      firstContactStateDocIds: ["doc-1"],
      outcome: {
        error: null,
        intentId: "intent-queued",
        kind: "queued",
        session: createAssistantSession({
          sessionId: "session-queued",
        }),
      },
      response: "reply",
      turnId: "turn-queued-finalize",
      vault: "/vault",
    });

    expect(seamMocks.completeAssistantOnboarding).not.toHaveBeenCalled();
    expect(seamMocks.markAssistantFirstContactSeen).not.toHaveBeenCalled();
  });
});

describe("assistant execution context normalization", () => {
  it("drops hosted execution context when the hosted member id is blank", () => {
    expect(
      normalizeAssistantExecutionContext({
        hosted: {
          memberId: "   ",
          userEnvKeys: ["CODEX_API_KEY"],
        },
      })
    ).toEqual({
      hosted: null,
    });
  });

  it("normalizes hosted context and preserves callable helpers only", () => {
    const issueDeviceConnectLink = vi.fn();
    const defaultTarget = createAssistantModelTarget({
      model: "gpt-5.5",
      modelProvider: "vercel-ai-gateway",
      provider: "codex-cli",
    });

    expect(
      normalizeAssistantExecutionContext({
        hosted: {
          defaultTarget,
          deviceConnectProviders: [
            { label: " Oura ", provider: " OURA " },
            { label: "duplicate", provider: "oura" },
            { label: "bad", provider: "not allowed!" },
          ],
          issueDeviceConnectLink,
          memberId: " member-1 ",
          stripeCustomerId: " cus_123 ",
          userEnvKeys: [" CODEX_API_KEY ", "", " CUSTOM_KEY ", "   "],
        },
      })
    ).toEqual({
      hosted: {
        defaultTarget,
        deviceConnectProviders: [
          { label: "Oura", provider: "oura" },
        ],
        issueDeviceConnectLink,
        memberId: "member-1",
        stripeCustomerId: "cus_123",
        userEnvKeys: ["CODEX_API_KEY", "CUSTOM_KEY"],
      },
    });
  });

  it("keeps a valid hosted member id even when no hosted helper functions are injected", () => {
    expect(
      normalizeAssistantExecutionContext({
        hosted: {
          memberId: "member-plain",
          userEnvKeys: [],
        },
      })
    ).toEqual({
      hosted: {
        memberId: "member-plain",
        userEnvKeys: [],
      },
    });
  });

  it("falls back to the provided target when no hosted default target exists", () => {
    const fallbackTarget = createAssistantModelTarget({
      model: "gpt-5.5-mini",
      modelProvider: "vercel-ai-gateway",
      provider: "codex-cli",
    });
    if (!fallbackTarget) {
      throw new Error("expected fallback target");
    }

    expect(
      resolveAssistantExecutionDefaultTarget({
        executionContext: {
          hosted: {
            memberId: "member-plain",
            userEnvKeys: [],
          },
        },
        fallbackTarget,
      }),
    ).toEqual(fallbackTarget);
  });

  it("overlays the hosted default target onto operator defaults without dropping other defaults", () => {
    const hostedDefaultTarget = createAssistantModelTarget({
      model: "gpt-5.5-mini",
      modelProvider: "vercel-ai-gateway",
      provider: "codex-cli",
    });
    if (!hostedDefaultTarget) {
      throw new Error("expected hosted default target");
    }

    expect(
      resolveAssistantExecutionOperatorDefaults({
        defaults: {
          backend: {
            adapter: "codex-cli",
            approvalPolicy: "never",
            codexCommand: null,
            codexHome: null,
            model: "gpt-5.5",
            modelProvider: "vercel-ai-gateway",
            oss: false,
            profile: null,
            reasoningEffort: "medium",
            sandbox: "danger-full-access",
          },
          failoverRoutes: [
            {
              approvalPolicy: null,
              codexCommand: null,
              codexHome: null,
              cooldownMs: null,
              model: "gpt-5.5-backup",
              modelProvider: "vercel-ai-gateway",
              name: null,
              oss: false,
              profile: null,
              provider: "codex-cli",
              reasoningEffort: null,
              sandbox: null,
            },
          ],
          identityId: "identity-123",
          selfDeliveryTargets: null,
        },
        executionContext: {
          hosted: {
            defaultTarget: hostedDefaultTarget,
            memberId: "member-123",
            userEnvKeys: [],
          },
        },
      }),
    ).toEqual({
      backend: hostedDefaultTarget,
      failoverRoutes: [
        {
          approvalPolicy: null,
          codexCommand: null,
          codexHome: null,
          cooldownMs: null,
          model: "gpt-5.5-backup",
          modelProvider: "vercel-ai-gateway",
          name: null,
          oss: false,
          profile: null,
          provider: "codex-cli",
          reasoningEffort: null,
          sandbox: null,
        },
      ],
      identityId: "identity-123",
      selfDeliveryTargets: null,
    });
  });
});

describe("assistant turn finalizer seam", () => {
  it("persists the user prompt after provider success when failure persistence is disabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T14:00:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      resumeState: {
        providerSessionId: "provider-session-existing",
        resumeRouteId: "route-existing",
      },
      turnCount: 2,
    });

    const saved = await persistAssistantTurnAndSession({
      input: {
        model: "gpt-5-mini",
        prompt: "What changed today?",
        vault: "/vault",
      },
      plan: createSharedPlan({
        persistUserPromptOnFailure: false,
      }),
      providerResult: createProviderResult({
        providerOptions: createProviderOptions({
          model: "gpt-5-mini",
        }),
        providerSessionId: "provider-session-existing",
        response: "Here is the summary.",
        route: createRoute({ routeId: "route-backup" }),
        session,
      }),
      session,
      turnContinuityPolicy: "continuous-provider-thread",
      turnCreatedAt: "2026-04-08T13:59:00.000Z",
      turnId: "turn-finalizer-1",
    });

    expect(runtimeState.transcripts.append).toHaveBeenNthCalledWith(
      1,
      session.sessionId,
      [
        {
          createdAt: "2026-04-08T13:59:00.000Z",
          kind: "user",
          text: "What changed today?",
        },
      ]
    );
    expect(runtimeState.turns.appendEvent).toHaveBeenCalledWith({
      at: "2026-04-08T13:59:00.000Z",
      detail: "user prompt persisted after provider completion",
      kind: "user.persisted",
      turnId: "turn-finalizer-1",
    });
    expect(runtimeState.transcripts.append).toHaveBeenNthCalledWith(
      2,
      session.sessionId,
      [
        {
          kind: "assistant",
          text: "Here is the summary.",
        },
      ]
    );
    expect(runtimeState.sessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lastTurnAt: "2026-04-08T14:00:00.000Z",
        provider: "codex-cli",
        providerOptions: expect.objectContaining({
          model: "gpt-5-mini",
        }),
        resumeState: expect.objectContaining({
          providerSessionId: "provider-session-existing",
          resumeRouteId: "route-backup",
        }),
        turnCount: 3,
        updatedAt: "2026-04-08T14:00:00.000Z",
      })
    );
    expect(saved.resumeState?.resumeRouteId).toBe("route-backup");
  });

  it("clears provider resume state when requested and only persists the assistant transcript", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T15:30:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      resumeState: {
        providerSessionId: "provider-session-existing",
        resumeRouteId: "route-existing",
      },
      turnCount: 2,
    });

    const saved = await persistAssistantTurnAndSession({
      assistantTranscriptText: "Send the reminder once.",
      input: {
        prompt: "Send the reminder once.",
        vault: "/vault",
      },
      plan: createSharedPlan({
        persistUserPromptOnFailure: false,
      }),
      persistUserPromptToTranscript: false,
      providerResult: createProviderResult({
        providerSessionId: "provider-session-existing",
        response: "raw provider output",
        route: createRoute({ routeId: "route-notification" }),
        session,
      }),
      session,
      turnContinuityPolicy: "murph-history-only",
      turnCreatedAt: "2026-04-08T15:29:00.000Z",
      turnId: "turn-finalizer-clear",
    });

    expect(runtimeState.turns.appendEvent).not.toHaveBeenCalled();
    expect(runtimeState.transcripts.append).toHaveBeenCalledTimes(1);
    expect(runtimeState.transcripts.append).toHaveBeenCalledWith(
      session.sessionId,
      [
        {
          kind: "assistant",
          text: "Send the reminder once.",
        },
      ]
    );
    expect(runtimeState.sessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lastTurnAt: "2026-04-08T15:30:00.000Z",
        resumeState: null,
        turnCount: 3,
        updatedAt: "2026-04-08T15:30:00.000Z",
      })
    );
    expect(saved.resumeState).toBeNull();
  });

  it("does not persist new provider resume state for Murph-history-only auto-reply turns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T15:45:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      resumeState: {
        providerSessionId: "provider-session-stale",
        resumeRouteId: "route-existing",
      },
      turnCount: 2,
    });

    const saved = await persistAssistantTurnAndSession({
      input: {
        prompt: "Reply to the inbound message.",
        turnTrigger: "automation-auto-reply",
        vault: "/vault",
      },
      plan: createSharedPlan({
        persistUserPromptOnFailure: false,
      }),
      providerResult: createProviderResult({
        providerSessionId: "provider-session-new",
        response: "Here is the reply.",
        route: createRoute({ routeId: "route-auto-reply" }),
        session,
      }),
      session,
      turnContinuityPolicy: "murph-history-only",
      turnCreatedAt: "2026-04-08T15:44:00.000Z",
      turnId: "turn-finalizer-auto-reply",
    });

    expect(runtimeState.sessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lastTurnAt: "2026-04-08T15:45:00.000Z",
        resumeState: null,
        turnCount: 3,
        updatedAt: "2026-04-08T15:45:00.000Z",
      })
    );
    expect(saved.resumeState).toBeNull();
  });

  it("does not persist provider resume state after explicit active-turn continuation history", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T15:50:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      resumeState: {
        providerSessionId: "provider-session-existing",
        resumeRouteId: "route-existing",
      },
      turnCount: 2,
    });

    const saved = await persistAssistantTurnAndSession({
      activeTurnUsedExplicitHistory: true,
      input: {
        prompt: "Late active-turn follow-up.",
        vault: "/vault",
      },
      plan: createSharedPlan({
        persistUserPromptOnFailure: false,
      }),
      providerResult: createProviderResult({
        providerSessionId: "provider-session-new",
        response: "Here is the revised answer.",
        route: createRoute({ routeId: "route-active-continuation" }),
        session,
      }),
      session,
      turnContinuityPolicy: "continuous-provider-thread",
      turnCreatedAt: "2026-04-08T15:49:00.000Z",
      turnId: "turn-finalizer-active-continuation",
    });

    expect(runtimeState.sessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lastTurnAt: "2026-04-08T15:50:00.000Z",
        resumeState: null,
        turnCount: 3,
        updatedAt: "2026-04-08T15:50:00.000Z",
      })
    );
    expect(saved.resumeState).toBeNull();
  });

  it("persists successful provider tool audit entries before the assistant transcript", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T15:45:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      turnCount: 2,
    });

    await persistAssistantTurnAndSession({
      assistantTranscriptText: "The experiment exists.",
      input: {
        prompt: "Create the experiment.",
        vault: "/vault",
      },
      plan: createSharedPlan({
        persistUserPromptOnFailure: false,
      }),
      persistUserPromptToTranscript: false,
      providerResult: createProviderResult({
        rawEvents: [
          {
            input: {
              apiKey: "synthetic-private-value",
              command: "vault-cli experiment create",
            },
            mode: "apply",
            tool: "vault.cli.run",
            type: "assistant.tool.succeeded",
          },
        ],
        route: createRoute({ routeId: "route-tool-audit" }),
        session,
      }),
      session,
      turnContinuityPolicy: "continuous-provider-thread",
      turnCreatedAt: "2026-04-08T15:44:00.000Z",
      turnId: "turn-finalizer-tool-audit",
    });

    expect(runtimeState.transcripts.append).toHaveBeenNthCalledWith(
      1,
      session.sessionId,
      [
        {
          kind: "status",
          text:
            `${ASSISTANT_TRANSCRIPT_AUDIT_TEXT_PREFIX}Tool vault.cli.run succeeded in apply mode. Input keys: apiKey, command.`,
        },
      ]
    );
    expect(runtimeState.transcripts.append).toHaveBeenNthCalledWith(
      2,
      session.sessionId,
      [
        {
          kind: "assistant",
          text: "The experiment exists.",
        },
      ]
    );
    expect(
      JSON.stringify(runtimeState.transcripts.append.mock.calls)
    ).not.toContain("synthetic-private-value");
  });

  it("skips duplicate user persistence when failure persistence already happened and rewrites the resume route on provider change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T15:00:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      resumeState: {
        providerSessionId: "provider-session-old",
        resumeRouteId: "route-old",
      },
    });

    const saved = await persistAssistantTurnAndSession({
      input: {
        prompt: "Hello again.",
        vault: "/vault",
      },
      plan: createSharedPlan({
        persistUserPromptOnFailure: true,
      }),
      providerResult: createProviderResult({
        providerSessionId: "provider-session-new",
        route: createRoute({ routeId: "route-new" }),
        session,
      }),
      session,
      turnContinuityPolicy: "continuous-provider-thread",
      turnCreatedAt: "2026-04-08T14:59:00.000Z",
      turnId: "turn-finalizer-2",
    });

    expect(runtimeState.turns.appendEvent).not.toHaveBeenCalled();
    expect(runtimeState.transcripts.append).toHaveBeenCalledTimes(1);
    expect(saved.resumeState?.providerSessionId).toBe("provider-session-new");
    expect(saved.resumeState?.resumeRouteId).toBe("route-new");
  });

  it("keeps the Codex session target when no provider override is supplied", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T16:00:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession();

    const saved = await persistAssistantTurnAndSession({
      input: {
        prompt: "No overrides here.",
        vault: "/vault",
      },
      plan: createSharedPlan(),
      providerResult: createProviderResult({
        providerSessionId: "provider-session-fallback",
        route: createRoute({ routeId: "route-fallback" }),
        session,
      }),
      session,
      turnContinuityPolicy: "continuous-provider-thread",
      turnCreatedAt: "2026-04-08T15:59:00.000Z",
      turnId: "turn-finalizer-fallback",
    });

    expect(saved.target).toEqual(session.target);
    expect(saved.provider).toBe("codex-cli");
  });
});

function createRuntimeStateStub() {
  return {
    diagnostics: {
      recordEvent: vi.fn(async () => undefined),
    },
    outbox: {
      deliverMessage: vi.fn(),
    },
    sessions: {
      save: vi.fn(),
    },
    transcripts: {
      append: vi.fn(async () => []),
    },
    turns: {
      appendEvent: vi.fn(async () => undefined),
      finalizeReceipt: vi.fn(async () => undefined),
    },
  };
}

function createDeliveryError(
  overrides: Partial<AssistantDeliveryError> = {}
): AssistantDeliveryError {
  return {
    code: "ASSISTANT_DELIVERY_FAILED",
    message: "delivery failed",
    ...overrides,
  };
}

function createProviderOptions(
  overrides: Partial<AssistantProviderSessionOptions> = {}
): AssistantProviderSessionOptions {
  return serializeAssistantProviderSessionOptions({
    approvalPolicy: "never",
    provider: "codex-cli",
    model: "gpt-5.5",
    modelProvider: "vercel-ai-gateway",
    reasoningEffort: "medium",
    sandbox: "danger-full-access",
    ...overrides,
  });
}

function createRoute(input?: {
  provider?: ResolvedAssistantFailoverRoute["provider"];
  providerOptions?: Partial<AssistantProviderSessionOptions>;
  routeId?: string;
}): ResolvedAssistantFailoverRoute {
  return {
    codexCommand: null,
    cooldownMs: 60_000,
    label: "Primary",
    provider: input?.provider ?? "codex-cli",
    providerOptions: createProviderOptions(input?.providerOptions),
    routeId: input?.routeId ?? "route-primary",
  };
}

function createAssistantSession(input?: {
  binding?: AssistantSession["binding"];
  providerOptions?: AssistantProviderSessionOptions;
  resumeState?: AssistantSession["resumeState"];
  sessionId?: string;
  target?: AssistantSession["target"];
  turnCount?: number;
}): AssistantSession {
  const providerOptions = input?.providerOptions ?? createProviderOptions();
  const target =
    input?.target ??
    createAssistantModelTarget({
      provider: "codex-cli",
      approvalPolicy: providerOptions.approvalPolicy,
      codexHome: providerOptions.codexHome ?? null,
      model: providerOptions.model,
      modelProvider: providerOptions.modelProvider ?? null,
      oss: providerOptions.oss,
      profile: providerOptions.profile,
      reasoningEffort: providerOptions.reasoningEffort ?? null,
      sandbox: providerOptions.sandbox,
    });

  if (!target) {
    throw new Error("Expected assistant session target.");
  }

  return {
    alias: null,
    binding: input?.binding ?? {
      actorId: null,
      channel: null,
      conversationKey: null,
      delivery: null,
      identityId: null,
      threadId: null,
      threadIsDirect: null,
    },
    createdAt: "2026-04-08T00:00:00.000Z",
    lastTurnAt: null,
    provider: "codex-cli",
    providerOptions,
    resumeState: input?.resumeState ?? null,
    schema: "murph.assistant-session.v1",
    sessionId: input?.sessionId ?? "session-test",
    target,
    turnCount: input?.turnCount ?? 0,
    updatedAt: "2026-04-08T00:00:00.000Z",
  };
}

function createSharedPlan(input?: {
  conversationPolicy?: {
    audience: Partial<{
      actorId: string | null;
      bindingDelivery: AssistantBindingDelivery | null;
      channel: string | null;
      deliveryPolicy: "binding-target-only" | "explicit-target-override" | "not-requested";
      effectiveThreadIsDirect: boolean | null;
      explicitTarget: string | null;
      identityId: string | null;
      replyToMessageId: string | null;
      threadId: string | null;
      threadIsDirect: boolean | null;
    }> | null;
  };
  persistUserPromptOnFailure?: boolean;
}): AssistantTurnSharedPlan {
  return {
    allowSensitiveHealthContext: true,
    cliAccess: {
      env: {},
      rawCommand: "vault-cli" as const,
      setupCommand: "murph",
    },
    conversationPolicy: {
      allowSensitiveHealthContext: true,
      audience:
        input?.conversationPolicy?.audience
          ? {
              actorId: null,
              bindingDelivery: null,
              channel: null,
              deliveryPolicy: "not-requested",
              effectiveThreadIsDirect: null,
              explicitTarget: null,
              identityId: null,
              replyToMessageId: null,
              threadId: null,
              threadIsDirect: null,
              ...input.conversationPolicy.audience,
            }
          : {
          actorId: null,
          bindingDelivery: null,
          channel: null,
          deliveryPolicy: "not-requested",
          effectiveThreadIsDirect: null,
          explicitTarget: null,
          identityId: null,
          replyToMessageId: null,
          threadId: null,
          threadIsDirect: null,
        },
      operatorAuthority: "direct-operator",
    },
    onboardingGuidanceOpen: false,
    firstContactStateDocIds: [],
    operatorAuthority: "direct-operator",
    persistUserPromptOnFailure: input?.persistUserPromptOnFailure ?? false,
    requestedWorkingDirectory: "/tmp/assistant-service-runtime",
  };
}

function createProviderResult(input?: {
  attemptCount?: number;
  providerOptions?: AssistantProviderSessionOptions;
  providerSessionId?: string | null;
  rawEvents?: unknown[];
  response?: string;
  route?: ResolvedAssistantFailoverRoute;
  session?: AssistantSession;
  usage?: AssistantProviderUsage | null;
}): ExecutedAssistantProviderTurnResult {
  const session = input?.session ?? createAssistantSession();
  const defaultUsage: AssistantProviderUsage = {
    apiKeyEnv: null,
    baseUrl: null,
    cacheWriteTokens: null,
    cachedInputTokens: null,
    inputTokens: 5,
    outputTokens: 8,
    providerMetadataJson: null,
    providerName: null,
    providerRequestId: null,
    rawUsageJson: null,
    reasoningTokens: null,
    requestedModel: null,
    servedModel: null,
    totalTokens: 13,
  };
  return {
    attemptCount: input?.attemptCount ?? 1,
    provider: "codex-cli",
    providerContinuation: {
      kind: "explicit-structured-history",
    },
    providerOptions: input?.providerOptions ?? createProviderOptions(),
    providerSessionId: input?.providerSessionId ?? "provider-session-1",
    rawEvents: input?.rawEvents ?? [],
    response: input?.response ?? "provider response",
    route: input?.route ?? createRoute(),
    session,
    stderr: "",
    stdout: "",
    usage:
      input?.usage === undefined
        ? defaultUsage
        : input.usage === null
          ? null
          : { ...defaultUsage, ...input.usage },
    workingDirectory: "/tmp/assistant-service-runtime",
  };
}
