import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AssistantDeliveryError,
  AssistantBindingDelivery,
  AssistantProviderFailoverRoute,
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
  createAssistantRuntimeStateService: vi.fn(),
  createAssistantUsageId: vi.fn(),
  isAssistantSessionNotFoundError: vi.fn(),
  local: {
    openAssistantConversationLocal: vi.fn(),
    queueAssistantFirstContactWelcomeLocal: vi.fn(),
    sendAssistantFirstContactWelcomeLocal: vi.fn(),
    sendAssistantMessageLocal: vi.fn(),
    updateAssistantSessionOptionsLocal: vi.fn(),
  },
  markAssistantFirstContactSeen: vi.fn(),
  normalizeAssistantDeliveryError: vi.fn(),
  resolveAssistantExecutionPlan: vi.fn(),
  resolveAssistantSession: vi.fn(),
  resolveAssistantUsageCredentialSource: vi.fn(),
  sanitizeAssistantOutboundReply: vi.fn(),
  writePendingAssistantUsageRecord: vi.fn(),
}));

vi.mock("../src/assistant/local-service.js", () => ({
  openAssistantConversationLocal:
    seamMocks.local.openAssistantConversationLocal,
  queueAssistantFirstContactWelcomeLocal:
    seamMocks.local.queueAssistantFirstContactWelcomeLocal,
  sendAssistantFirstContactWelcomeLocal:
    seamMocks.local.sendAssistantFirstContactWelcomeLocal,
  sendAssistantMessageLocal: seamMocks.local.sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal:
    seamMocks.local.updateAssistantSessionOptionsLocal,
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

vi.mock("../src/assistant/outbox.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/assistant/outbox.ts")
  >("../src/assistant/outbox.ts");

  return {
    ...actual,
    normalizeAssistantDeliveryError: seamMocks.normalizeAssistantDeliveryError,
  };
});

vi.mock("../src/assistant/reply-sanitizer.js", () => ({
  sanitizeAssistantOutboundReply: seamMocks.sanitizeAssistantOutboundReply,
}));

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
import { normalizeAssistantExecutionContext } from "../src/assistant/execution-context.ts";
import {
  resolveAssistantTurnRoutes,
  resolveAssistantTurnRoutesForMessage,
  selectAssistantTurnRouteOverride,
} from "../src/assistant/service-turn-routes.ts";
import { persistPendingAssistantUsageEvent } from "../src/assistant/service-usage.ts";
import { persistAssistantTurnAndSession } from "../src/assistant/turn-finalizer.ts";
import { ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE } from "../src/assistant/first-contact-welcome.ts";

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
  seamMocks.createAssistantUsageId
    .mockReset()
    .mockImplementation(
      ({ attemptCount, turnId }: { attemptCount: number; turnId: string }) =>
        `${turnId}:${attemptCount}`
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
  seamMocks.local.queueAssistantFirstContactWelcomeLocal.mockReset();
  seamMocks.local.sendAssistantFirstContactWelcomeLocal.mockReset();
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
  seamMocks.sanitizeAssistantOutboundReply
    .mockReset()
    .mockImplementation((response: string) => `sanitized:${response}`);
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

  it("delegates first-contact flows and session option updates to the local service", async () => {
    const welcomeInput = {
      channel: "telegram",
      identityId: "identity-1",
      vault: "/vault",
    };
    const queued = {
      kind: "queued",
    };
    const sent = {
      kind: "sent",
    };
    const updatedSession = createAssistantSession({
      providerOptions: createProviderOptions({
        model: "gpt-5-mini",
      }),
    });
    seamMocks.local.queueAssistantFirstContactWelcomeLocal.mockResolvedValue(
      queued
    );
    seamMocks.local.sendAssistantFirstContactWelcomeLocal.mockResolvedValue(
      sent
    );
    seamMocks.local.updateAssistantSessionOptionsLocal.mockResolvedValue(
      updatedSession
    );

    await expect(
      assistantService.queueAssistantFirstContactWelcome(welcomeInput)
    ).resolves.toBe(queued);
    await expect(
      assistantService.sendAssistantFirstContactWelcome(welcomeInput)
    ).resolves.toBe(sent);
    await expect(
      assistantService.updateAssistantSessionOptions({
        providerOptions: {
          model: "gpt-5-mini",
        },
        sessionId: "session-1",
        vault: "/vault",
      })
    ).resolves.toBe(updatedSession);

    expect(
      seamMocks.local.queueAssistantFirstContactWelcomeLocal
    ).toHaveBeenCalledWith(welcomeInput);
    expect(
      seamMocks.local.sendAssistantFirstContactWelcomeLocal
    ).toHaveBeenCalledWith(welcomeInput);
    expect(
      seamMocks.local.updateAssistantSessionOptionsLocal
    ).toHaveBeenCalledWith({
      providerOptions: {
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
    const failoverRoutes: AssistantProviderFailoverRoute[] = [
      {
        apiKeyEnv: null,
        approvalPolicy: "never",
        cooldownMs: 60_000,
        codexCommand: null,
        codexHome: null,
        headers: null,
        provider: "codex-cli",
        model: "gpt-5-codex",
        name: "backup",
        oss: false,
        profile: null,
        reasoningEffort: "medium",
        sandbox: "danger-full-access",
      },
    ];
    const input = {
      failoverRoutes,
      model: "gpt-5-mini",
      prompt: "Summarize today.",
      provider: "openai-compatible" as const,
      vault: "/vault",
    };
    const routes = [createRoute({ routeId: "route-primary" })];
    seamMocks.resolveAssistantExecutionPlan.mockReturnValue({
      routes,
    });

    const result = resolveAssistantTurnRoutes(input, defaults, resolved);

    expect(result).toBe(routes);
    expect(seamMocks.resolveAssistantExecutionPlan).toHaveBeenCalledWith({
      backups: input.failoverRoutes,
      defaults,
      override: expect.objectContaining({
        model: "gpt-5-mini",
        provider: "openai-compatible",
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
        baseUrl: null,
        headers: null,
        model: "gpt-5-codex",
        profile: "ops",
        providerName: null,
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
        apiKeyEnv: backup.providerOptions.apiKeyEnv,
        approvalPolicy: backup.providerOptions.approvalPolicy ?? null,
        baseUrl: backup.providerOptions.baseUrl ?? null,
        codexCommand: undefined,
        codexHome: backup.providerOptions.codexHome ?? null,
        headers: backup.providerOptions.headers ?? null,
        model: backup.providerOptions.model ?? null,
        oss: false,
        presetId: null,
        profile: backup.providerOptions.profile ?? null,
        provider: "codex-cli",
        providerName: backup.providerOptions.providerName ?? null,
        reasoningEffort: backup.providerOptions.reasoningEffort ?? null,
        sandbox: backup.providerOptions.sandbox ?? null,
        webSearch: null,
        zeroDataRetention: backup.providerOptions.zeroDataRetention ?? null,
      },
      route: backup,
    });

    const nullableBackup = createRoute({
      providerOptions: createProviderOptions({
        model: null,
        reasoningEffort: null,
        sandbox: null,
      }),
      routeId: "route-nullable",
    });

    expect(
      selectAssistantTurnRouteOverride(
        [primary, nullableBackup],
        (route) => route.routeId === nullableBackup.routeId
      )
    ).toEqual({
      providerOverride: {
        apiKeyEnv: "OPENAI_API_KEY",
        approvalPolicy: null,
        baseUrl: "https://api.example.test/v1",
        codexCommand: undefined,
        codexHome: null,
        headers: null,
        model: null,
        oss: false,
        presetId: null,
        profile: null,
        provider: "openai-compatible",
        providerName: "murph-openai",
        reasoningEffort: null,
        sandbox: null,
        webSearch: null,
        zeroDataRetention: null,
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
          userEnvKeys: [" OPENAI_API_KEY ", "", "CUSTOM_KEY"],
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
      turnId: "turn-usage",
    });
    expect(
      seamMocks.resolveAssistantUsageCredentialSource
    ).toHaveBeenCalledWith({
      apiKeyEnv: "RUNTIME_KEY",
      provider: "openai-compatible",
      userEnvKeys: [" OPENAI_API_KEY ", "", "CUSTOM_KEY"],
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
        inputTokens: 11,
        memberId: "member-42",
        occurredAt: "2026-04-08T10:00:00.000Z",
        outputTokens: 13,
        provider: "openai-compatible",
        providerName: "Runtime Provider",
        reasoningTokens: 17,
        requestedModel: "gpt-5",
        routeId: "route-usage",
        schema: "murph.assistant-usage.v1",
        servedModel: "gpt-5-mini",
        sessionId: "session-test",
        totalTokens: 41,
        turnId: "turn-usage",
        usageId: "turn-usage:3",
      },
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
          apiKeyEnv: "FALLBACK_KEY",
          baseUrl: "https://fallback.example.test/v1",
          model: "gpt-4.1-fallback",
          providerName: "Fallback Provider",
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
          apiKeyEnv: "FALLBACK_KEY",
          baseUrl: "https://fallback.example.test/v1",
          memberId: "member-43",
          occurredAt: "2026-04-08T10:05:00.000Z",
          providerName: "Fallback Provider",
          requestedModel: "gpt-4.1-fallback",
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

  it("delivers via the outbox with audience overrides and sanitized content", async () => {
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

    expect(seamMocks.sanitizeAssistantOutboundReply).toHaveBeenCalledWith(
      "reply body",
      "local"
    );
    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith({
      actorId: "audience-actor",
      bindingDelivery: {
        kind: "participant",
        target: "audience-delivery",
      },
      channel: "telegram",
      dependencies: undefined,
      dispatchMode: "immediate",
      explicitTarget: "explicit-audience-target",
      identityId: "audience-identity",
      message: "sanitized:reply body",
      replyToMessageId: "reply-audience",
      sessionId: session.sessionId,
      threadId: "audience-thread",
      threadIsDirect: false,
      turnId: "turn-2",
    });
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

  it("finalizes receipts and marks first contact only for injected sent turns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T12:30:00.000Z"));

    await finalizeAssistantTurnFromDeliveryOutcome({
      firstTurnCheckInInjected: true,
      firstTurnCheckInStateDocIds: ["doc-1", "doc-2"],
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
    expect(seamMocks.markAssistantFirstContactSeen).toHaveBeenCalledWith({
      docIds: ["doc-1", "doc-2"],
      seenAt: "2026-04-08T12:30:00.000Z",
      vault: "/vault",
    });

    seamMocks.markAssistantFirstContactSeen.mockClear();

    await finalizeAssistantTurnFromDeliveryOutcome({
      firstTurnCheckInInjected: true,
      firstTurnCheckInStateDocIds: ["doc-1"],
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

    expect(seamMocks.markAssistantFirstContactSeen).not.toHaveBeenCalled();
  });
});

describe("assistant execution context normalization", () => {
  it("drops hosted execution context when the hosted member id is blank", () => {
    expect(
      normalizeAssistantExecutionContext({
        hosted: {
          memberId: "   ",
          userEnvKeys: ["OPENAI_API_KEY"],
        },
      })
    ).toEqual({
      hosted: null,
    });
  });

  it("normalizes hosted context and preserves callable helpers only", () => {
    const issueDeviceConnectLink = vi.fn();
    const issueShareLink = vi.fn();

    expect(
      normalizeAssistantExecutionContext({
        hosted: {
          issueDeviceConnectLink,
          issueShareLink,
          memberId: " member-1 ",
          userEnvKeys: [" OPENAI_API_KEY ", "", " CUSTOM_KEY ", "   "],
        },
      })
    ).toEqual({
      hosted: {
        issueDeviceConnectLink,
        issueShareLink,
        memberId: "member-1",
        userEnvKeys: ["OPENAI_API_KEY", "CUSTOM_KEY"],
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
        provider: "openai-compatible",
        providerBinding: expect.objectContaining({
          providerSessionId: "provider-session-existing",
          providerState: {
            resumeRouteId: "route-backup",
          },
        }),
        providerOptions: expect.objectContaining({
          model: "gpt-5-mini",
        }),
        turnCount: 3,
        updatedAt: "2026-04-08T14:00:00.000Z",
      })
    );
    expect(saved.providerBinding?.providerState?.resumeRouteId).toBe(
      "route-backup"
    );
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
      turnCreatedAt: "2026-04-08T14:59:00.000Z",
      turnId: "turn-finalizer-2",
    });

    expect(runtimeState.turns.appendEvent).not.toHaveBeenCalled();
    expect(runtimeState.transcripts.append).toHaveBeenCalledTimes(1);
    expect(saved.providerBinding?.providerSessionId).toBe(
      "provider-session-new"
    );
    expect(saved.providerBinding?.providerState?.resumeRouteId).toBe(
      "route-new"
    );
  });

  it("falls back to the existing session target when the merged provider config cannot build a new target", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T16:00:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const target = {
      adapter: "openai-compatible" as const,
      apiKeyEnv: null,
      endpoint: null,
      headers: null,
      model: null,
      presetId: null,
      providerName: null,
      reasoningEffort: null,
      webSearch: null,
    };
    const session = createAssistantSession({
      providerOptions: createProviderOptions({
        apiKeyEnv: null,
        baseUrl: null,
        headers: null,
        model: null,
        providerName: null,
        reasoningEffort: null,
      }),
      target,
    });

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
      turnCreatedAt: "2026-04-08T15:59:00.000Z",
      turnId: "turn-finalizer-fallback",
    });

    expect(saved.target).toEqual(target);
    expect(saved.provider).toBe("openai-compatible");
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
    provider: "openai-compatible",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.example.test/v1",
    headers: null,
    model: "gpt-4.1",
    providerName: "murph-openai",
    reasoningEffort: "high",
    zeroDataRetention: null,
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
    provider: input?.provider ?? "openai-compatible",
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
      provider:
        providerOptions.baseUrl ||
        providerOptions.apiKeyEnv ||
        providerOptions.providerName ||
        providerOptions.headers ||
        providerOptions.zeroDataRetention === true
          ? "openai-compatible"
          : "codex-cli",
      approvalPolicy: providerOptions.approvalPolicy,
      apiKeyEnv: providerOptions.apiKeyEnv ?? null,
      baseUrl: providerOptions.baseUrl ?? null,
      codexHome: providerOptions.codexHome ?? null,
      headers: providerOptions.headers ?? null,
      model: providerOptions.model,
      oss: providerOptions.oss,
      profile: providerOptions.profile,
      providerName: providerOptions.providerName ?? null,
      reasoningEffort: providerOptions.reasoningEffort ?? null,
      sandbox: providerOptions.sandbox,
      zeroDataRetention: providerOptions.zeroDataRetention ?? null,
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
    provider: target.adapter,
    providerBinding:
      input?.resumeState !== undefined && input.resumeState !== null
        ? {
            provider: target.adapter,
            providerOptions,
            providerSessionId: input.resumeState.providerSessionId,
            providerState:
              input.resumeState.resumeRouteId === null
                ? null
                : {
                    resumeRouteId: input.resumeState.resumeRouteId,
                  },
          }
        : null,
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
    firstTurnCheckInEligible: false,
    firstTurnCheckInStateDocIds: [],
    operatorAuthority: "direct-operator",
    persistUserPromptOnFailure: input?.persistUserPromptOnFailure ?? false,
    requestedWorkingDirectory: "/tmp/assistant-service-runtime",
  };
}

function createProviderResult(input?: {
  attemptCount?: number;
  providerOptions?: AssistantProviderSessionOptions;
  providerSessionId?: string | null;
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
    provider: "openai-compatible" as const,
    providerOptions: input?.providerOptions ?? createProviderOptions(),
    providerSessionId: input?.providerSessionId ?? "provider-session-1",
    rawEvents: [],
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
