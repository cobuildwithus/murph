import { rm } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AssistantDeliveryError,
  AssistantBindingDelivery,
  AssistantProviderSessionOptions,
  AssistantResponseMedia,
  AssistantSession,
  AssistantTranscriptEntry,
} from "@murphai/operator-config/assistant-cli-contracts";
import { createAssistantModelTarget } from "@murphai/operator-config/assistant-backend";
import { serializeAssistantProviderSessionOptions } from "@murphai/operator-config/assistant/provider-config";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";
import type { CodexThreadIdentity } from "../src/assistant/codex-thread-route.ts";
import type {
  AssistantNoReplyDisposition,
  AssistantProviderUsage,
} from "../src/assistant/providers/types.ts";
import type {
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from "../src/assistant/service-contracts.ts";
import type {
  AssistantTranscriptEntryInput,
} from "../src/assistant/store/types.ts";
import { ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE } from "../src/assistant/first-contact-welcome.ts";
import { createTempVaultContext } from "./test-helpers.ts";

const seamMocks = vi.hoisted(() => ({
  buildAssistantCliGuidanceText: vi.fn(),
  buildResolveAssistantSessionInput: vi.fn(),
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
  sendAssistantOutboxDispatchMessage: vi.fn(),
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

  return actual;
});

vi.mock("@murphai/hosted-execution/assistant-usage", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@murphai/hosted-execution/assistant-usage")
  >();

  return {
    ...actual,
    ASSISTANT_USAGE_SCHEMA: "murph.assistant-usage.v1",
    createAssistantUsageId: seamMocks.createAssistantUsageId,
    resolveAssistantUsageCredentialSource:
      seamMocks.resolveAssistantUsageCredentialSource,
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
    sendAssistantOutboxDispatchMessage: seamMocks.sendAssistantOutboxDispatchMessage,
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
  deliverAssistantPrecedingReplies,
  deliverAssistantReply,
  deliverAssistantProgressUpdate,
  finalizeAssistantTurnFromDeliveryOutcome,
} from "../src/assistant/delivery-service.ts";
import {
  type AssistantGeneratedImageCapturePersistence,
  normalizeAssistantExecutionContext,
  resolveAssistantExecutionDefaultTarget,
  resolveAssistantExecutionOperatorDefaults,
} from "../src/assistant/execution-context.ts";
import {
  createAssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.ts";
import {
  resolveAssistantTurnRoute,
  resolveAssistantTurnRouteForMessage,
} from "../src/assistant/service-turn-routes.ts";
import {
  recordAdditionalAssistantUsageEvents,
  recordAssistantUsageEvent,
} from "../src/assistant/service-usage.ts";
import { ASSISTANT_TRANSCRIPT_AUDIT_TEXT_PREFIX } from "../src/assistant/transcript-audit.ts";
import {
  ASSISTANT_GENERATED_IMAGE_DELIVERY_TRANSCRIPT_MARKER_PREFIX,
  readAssistantGeneratedImageDeliveryTranscriptMarker,
  resolveAssistantGeneratedImageDelivery,
} from "../src/assistant/response-media.ts";
import {
  ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX,
  buildAssistantNoReplyTranscriptMarkerText,
  persistAssistantNoReplyTranscriptMarkers,
  persistAssistantTurnAndSession,
} from "../src/assistant/turn-finalizer.ts";

type RuntimeStateStub = ReturnType<typeof createRuntimeStateStub>;

let runtimeState: RuntimeStateStub;
const tempRoots: string[] = [];

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
    codexRoute: createRoute(),
  });
  seamMocks.resolveAssistantSession.mockReset();
  seamMocks.resolveAssistantUsageCredentialSource
    .mockReset()
    .mockReturnValue("member");
  seamMocks.sendAssistantOutboxDispatchMessage.mockReset().mockResolvedValue({
    delivery: {
      channel: "telegram",
      idempotencyKey: "progress-key",
      messageLength: 10,
      providerMessageId: "progress-provider-message",
      providerThreadId: null,
      sentAt: "2026-04-08T11:00:00.000Z",
      target: "thread-1",
      targetKind: "thread",
    },
    deliveryTransportIdempotent: false,
    session: null,
  });

  runtimeState = createRuntimeStateStub();
  seamMocks.createAssistantRuntimeStateService
    .mockReset()
    .mockReturnValue(runtimeState);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  );
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

describe("assistant service turn route", () => {
  it("builds the Codex route from the resolved session execution plan", () => {
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
          routeFingerprint: "route-existing",
          threadId: "provider-session-existing",
        },
      }),
    };
    const input = {
      assistantTargetOverride: {
        reasoningEffort: "high" as const,
      },
      model: "gpt-5-mini",
      prompt: "Summarize today.",
      provider: "codex-cli" as const,
      vault: "/vault",
    };
    const route = createRoute({ routeId: "route-primary" });
    seamMocks.resolveAssistantExecutionPlan.mockReturnValue({
      codexRoute: route,
    });

    const result = resolveAssistantTurnRoute(input, defaults, resolved);

    expect(result).toBe(route);
    expect(seamMocks.resolveAssistantExecutionPlan).toHaveBeenCalledWith({
      defaults,
      override: expect.objectContaining({
        model: "gpt-5-mini",
        reasoningEffort: "high",
      }),
      sessionTarget: resolved.session.target,
    });
  });

  it("resolves the message route from an existing session when present", async () => {
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
      codexRoute: createRoute({ routeId: "route-session" }),
    });

    const result = await resolveAssistantTurnRouteForMessage(
      {
        prompt: "hello",
        vault: "/vault",
      },
      null,
      null
    );

    expect(result).toEqual(createRoute({ routeId: "route-session" }));
    expect(seamMocks.resolveAssistantSession).toHaveBeenCalledWith({
      ...builtInput,
      createIfMissing: false,
    });
    expect(seamMocks.resolveAssistantExecutionPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionTarget: resolved.session.target,
      })
    );
  });

  it("falls back to boundary defaults when the session is missing and rethrows other errors", async () => {
    seamMocks.resolveAssistantSession.mockRejectedValueOnce({
      code: "ASSISTANT_SESSION_NOT_FOUND",
    });
    seamMocks.resolveAssistantExecutionPlan.mockReturnValueOnce({
      codexRoute: createRoute({ routeId: "route-fallback" }),
    });

    await expect(
      resolveAssistantTurnRouteForMessage(
        {
          prompt: "hello",
          vault: "/vault",
        },
        null,
        createAssistantSession().target
      )
    ).resolves.toEqual(createRoute({ routeId: "route-fallback" }));

    seamMocks.resolveAssistantSession.mockRejectedValueOnce(
      new Error("session store exploded")
    );

    await expect(
      resolveAssistantTurnRouteForMessage(
        {
          prompt: "hello",
          vault: "/vault",
        },
        null,
        null
      )
    ).rejects.toThrow("session store exploded");
  });

});

describe("assistant usage recording seam", () => {
  it("skips recording when usage data, a hosted member id, or a recorder is missing", async () => {
    const recordUsage = vi.fn(async () => undefined);

    await recordAssistantUsageEvent({
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
    });

    await recordAssistantUsageEvent({
      executionContext: {
        hosted: {
          memberId: "   ",
          usageRecorder: { recordUsage },
          userEnvKeys: [],
        },
      },
      providerResult: createProviderResult(),
      turnId: "turn-2",
    });

    await recordAssistantUsageEvent({
      executionContext: {
        hosted: {
          memberId: "member-1",
          userEnvKeys: [],
        },
      },
      providerResult: createProviderResult(),
      turnId: "turn-3",
    });

    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("records hosted usage with normalized provider metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T10:00:00.000Z"));
    const recordUsage = vi.fn(async () => undefined);

    await recordAssistantUsageEvent({
      executionContext: {
        hosted: {
          memberId: " member-42 ",
          usageRecorder: { recordUsage },
          userEnvKeys: [" CODEX_API_KEY ", "", "CUSTOM_KEY"],
        },
      },
      occurredAt: "2026-04-08T09:59:58.123Z",
      providerRequestAcceptedInputIds: ["assistant_input_a"],
      providerResult: createProviderResult({
        attemptCount: 3,
        codexThreadId: "provider-session-42",
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
          rawUsageJson: {
            input_tokens: 11,
            output_tokens: 13,
            total_tokens: 41,
          },
          rawUsageJsonHash: " sha256:runtime-usage-hash ",
          reasoningTokens: 17,
          requestedModel: "gpt-5",
          servedModel: "gpt-5-mini",
          tokenPricingBasis: "openai-flex",
          totalTokens: 41,
          usageExtractionSourcePath: " params.usage ",
          usageExtractionVersion: " codex-usage-v1 ",
        },
      }),
      turnId: "turn-usage",
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
      credentialSourceHint: null,
      effectiveEnv: undefined,
      headers: null,
      provider: "codex-cli",
      userEnvKeys: [" CODEX_API_KEY ", "", "CUSTOM_KEY"],
    });
    expect(recordUsage).toHaveBeenCalledWith({
        apiKeyEnv: "RUNTIME_KEY",
        attemptCount: 3,
        baseUrl: "https://usage.example.test/v1",
        cacheWriteTokens: 5,
        cachedInputTokens: 7,
        credentialSource: "member",
        featureKey: null,
        gatewayTags: [],
        inputTokens: 11,
        memberId: "member-42",
        occurredAt: "2026-04-08T09:59:58.123Z",
        outputTokens: 13,
        provider: "codex-cli",
        providerName: "Runtime Provider",
        providerRequestId: "request-42",
        providerRequestOutcome: "succeeded",
        providerRequestOrdinal: 0,
        rawUsageJson: {
          input_tokens: 11,
          output_tokens: 13,
          total_tokens: 41,
        },
        rawUsageJsonHash: "sha256:runtime-usage-hash",
        reasoningTokens: 17,
        reportingUserId: null,
        requestedModel: "gpt-5",
        routeId: "route-usage",
        schema: "murph.assistant-usage.v1",
        servedModel: "gpt-5-mini",
        sessionId: "session-test",
        stripeMeterSource: "murph",
        surface: null,
        tokenPricingBasis: "openai-flex",
        totalTokens: 41,
        triggerKind: null,
        turnId: "turn-usage",
        turnProfileJson: null,
        usageId: "turn-usage:0:3",
        usageExtractionSourcePath: "params.usage",
        usageExtractionVersion: "codex-usage-v1",
    }, ["assistant_input_a"]);
  });

  it("records each additional usage draft with its own provider, ordinal, and credential source", async () => {
    const recordUsage = vi.fn(async () => undefined);
    seamMocks.resolveAssistantUsageCredentialSource
      .mockReset()
      .mockReturnValue("platform");

    await recordAdditionalAssistantUsageEvents({
      additionalUsages: [
        {
          occurredAt: "2026-04-08T10:00:03.000Z",
          provider: "openai-images",
          providerRequestOrdinal: 2,
          providerRequestOutcome: "succeeded",
          usage: {
            apiKeyEnv: "OPENAI_API_KEY",
            baseUrl: "https://api.openai.com/v1",
            cacheWriteTokens: null,
            cachedInputTokens: null,
            inputTokens: 7,
            outputTokens: 11,
            providerMetadataJson: null,
            providerName: "OpenAI Images",
            providerRequestId: "req_image_notification",
            rawUsageJson: null,
            reasoningTokens: null,
            requestedModel: "gpt-image-2",
            servedModel: null,
            totalTokens: 18,
          },
        },
      ],
      effectiveEnv: { OPENAI_API_KEY: "" },
      executionContext: {
        hosted: {
          memberId: "member-42",
          usageRecorder: { recordUsage },
          userEnvKeys: [],
        },
      },
      providerRequestAcceptedInputIds: ["assistant_input_a", "assistant_input_b"],
      providerResult: {
        ...createProviderResult(),
        usageAttribution: {
          credentialSource: "member" as const,
          environment: "test",
          featureKey: "assistant-turn",
          gatewayTags: [],
          reportingUserId: null,
          surface: "assistant",
          stripeMeterSource: "murph" as const,
          triggerKind: "user-message",
        },
      },
      turnId: "turn-additional",
    });

    expect(
      seamMocks.resolveAssistantUsageCredentialSource,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyEnv: "OPENAI_API_KEY",
        effectiveEnv: { OPENAI_API_KEY: "" },
        provider: "openai-images",
      }),
    );
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialSource: "platform",
        occurredAt: "2026-04-08T10:00:03.000Z",
        inputTokens: 7,
        outputTokens: 11,
        provider: "openai-images",
        providerName: "OpenAI Images",
        providerRequestId: "req_image_notification",
        providerRequestOrdinal: 2,
        providerRequestOutcome: "succeeded",
        requestedModel: "gpt-image-2",
        totalTokens: 18,
        turnId: "turn-additional",
      }),
      ["assistant_input_a", "assistant_input_b"],
    );
  });

  it("uses Codex provider options without legacy credential headers for fallback hosted usage attribution", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T10:02:00.000Z"));
    const recordUsage = vi.fn(async () => undefined);

    await recordAssistantUsageEvent({
      executionContext: {
        hosted: {
          memberId: "member-42",
          usageRecorder: { recordUsage },
          userEnvKeys: [],
        },
      },
      providerResult: createProviderResult({
        providerOptions: createProviderOptions(),
      }),
      turnId: "turn-usage-header-fallback",
    });

    expect(
      seamMocks.resolveAssistantUsageCredentialSource
    ).toHaveBeenCalledWith({
      apiKeyEnv: null,
      credentialSourceHint: null,
      effectiveEnv: undefined,
      headers: null,
      provider: "codex-cli",
      userEnvKeys: [],
    });
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialSource: "member",
        occurredAt: "2026-04-08T10:02:00.000Z",
        turnId: "turn-usage-header-fallback",
      }),
    );
  });

  it("records custom core inference as member-funded without trusting upstream routing metadata", async () => {
    const recordUsage = vi.fn(async () => undefined);
    seamMocks.resolveAssistantUsageCredentialSource
      .mockReset()
      .mockReturnValue("member");

    await recordAssistantUsageEvent({
      executionContext: {
        hosted: {
          memberId: "member-42",
          usageRecorder: { recordUsage },
          userEnvKeys: [],
        },
      },
      providerResult: createProviderResult({
        providerOptions: createProviderOptions({
          model: "murph-custom-r7-ab12cd34",
          modelProvider: "hosted-custom-inference",
        }),
        usage: {
          apiKeyEnv: null,
          baseUrl: "https://untrusted-upstream.example/v1",
          inputTokens: 7,
          outputTokens: 11,
          providerName: "Untrusted upstream name",
          requestedModel: "murph-custom-r7-ab12cd34",
          servedModel: "untrusted-upstream-model",
          totalTokens: 18,
        },
      }),
      turnId: "turn-custom-inference",
    });

    expect(
      seamMocks.resolveAssistantUsageCredentialSource,
    ).toHaveBeenCalledWith(expect.objectContaining({
      apiKeyEnv: null,
      credentialSourceHint: "member",
      provider: "codex-cli",
    }));
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: null,
        credentialSource: "member",
        providerName: "hosted-custom-inference",
        requestedModel: "murph-custom-r7-ab12cd34",
        servedModel: null,
      }),
    );
  });

  it("records failure usage with the provider request outcome", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T10:03:00.000Z"));
    const recordUsage = vi.fn(async () => undefined);

    await recordAssistantUsageEvent({
      executionContext: {
        hosted: {
          memberId: "member-42",
          usageRecorder: { recordUsage },
          userEnvKeys: [],
        },
      },
      providerRequestOutcome: "failed",
      providerResult: createProviderResult({
        usage: {
          inputTokens: 21,
          outputTokens: 0,
          totalTokens: 21,
        },
      }),
      turnId: "turn-failed-usage",
    });

    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 21,
        outputTokens: 0,
        providerRequestOutcome: "failed",
        totalTokens: 21,
        turnId: "turn-failed-usage",
      }),
    );
  });

  it("falls back to provider options when usage-level provider metadata is absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T10:05:00.000Z"));
    const recordUsage = vi.fn(async () => undefined);

    await recordAssistantUsageEvent({
      executionContext: {
        hosted: {
          memberId: "member-43",
          usageRecorder: { recordUsage },
          userEnvKeys: [],
        },
      },
      providerResult: createProviderResult({
        providerOptions: createProviderOptions({
          model: "gpt-5.6-terra-fallback",
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
    });

    expect(recordUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({
          apiKeyEnv: null,
          baseUrl: null,
          memberId: "member-43",
          occurredAt: "2026-04-08T10:05:00.000Z",
          providerName: null,
          requestedModel: "gpt-5.6-terra-fallback",
        }),
    );
  });

  it("does not wait for best-effort hosted usage recording", async () => {
    let finishRecording: () => void = () => undefined;
    const recording = new Promise<void>((resolve) => {
      finishRecording = resolve;
    });
    const recordUsage = vi.fn(() => recording);

    await expect(
      recordAssistantUsageEvent({
        executionContext: {
          hosted: {
            memberId: "member-42",
            usageRecorder: { recordUsage },
            userEnvKeys: [],
          },
        },
        providerResult: createProviderResult(),
        turnId: "turn-usage-latency",
      }),
    ).resolves.toBeUndefined();

    expect(recordUsage).toHaveBeenCalledOnce();
    finishRecording();
    await recording;
  });

  it("leaves assistant turns non-fatal when direct usage recording fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const recordUsage = vi.fn(async () => {
      throw new Error("usage backend unavailable");
    });

    await expect(
      recordAssistantUsageEvent({
        executionContext: {
          hosted: {
            memberId: "member-42",
            usageRecorder: { recordUsage },
            userEnvKeys: [],
          },
        },
        providerResult: createProviderResult(),
        turnId: "turn-usage-warning",
      }),
    ).resolves.toBeUndefined();

    await Promise.resolve();

    expect(warning).toHaveBeenCalledWith(
      "Assistant usage recording failed; continuing without retry.",
      { errorName: "Error" },
    );
    warning.mockRestore();
  });
});

describe("assistant delivery orchestration seam", () => {
  it("returns not-requested without touching the outbox when delivery is disabled", async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      "assistant-delivery-no-response-media-",
    );
    tempRoots.push(parentRoot);
    const session = createAssistantSession();
    const media = [{
      kind: "image" as const,
      url: "https://cdn.example.test/dead-bug/no-delivery.png",
      alt: null,
      source: null,
    }];

    await expect(
      deliverAssistantReply({
        input: {
          deliverResponse: false,
          prompt: "hello",
          vault: vaultRoot,
        },
        media,
        response: "reply",
        session,
        sharedPlan: createSharedPlan(),
        turnId: "turn-1",
      })
    ).resolves.toEqual({
      kind: "not-requested",
      media,
      session,
    });

    expect(runtimeState.outbox.deliverMessage).not.toHaveBeenCalled();
  });

  it("does not resolve hosted idempotency when final delivery is disabled", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "linq",
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

    await expect(
      deliverAssistantReply({
        input: {
          deliverResponse: false,
          executionContext: {
            hosted: {
              memberId: "member-hosted",
              userEnvKeys: [],
            },
          },
          prompt: "hello",
          vault: "/vault",
        },
        response: "reply",
        session,
        sharedPlan: createSharedPlan(),
        turnId: "turn-hosted-not-delivered",
      })
    ).resolves.toEqual({
      kind: "not-requested",
      media: [],
      session,
    });

    expect(runtimeState.outbox.deliverMessage).not.toHaveBeenCalled();
  });

  it("uses the final delivery idempotency key as the default outbox dedupe token", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "telegram",
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
        idempotencyKey: "delivery-final-key",
        messageLength: 5,
        providerMessageId: "provider-final-dedupe",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "binding-thread",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-final-dedupe",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        deliveryIdempotencyKey: "delivery-final-key",
        prompt: "hello",
        vault: "/vault",
      },
      response: "reply",
      session,
      sharedPlan: createSharedPlan(),
      turnId: "turn-final-dedupe",
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeToken: "delivery-final-key",
        deliveryIdempotencyKey: "delivery-final-key",
        message: "reply",
        turnId: "turn-final-dedupe",
      }),
    );
  });

  it("delivers linq delimiter replies as ordered bubbles with media on the final base-key send", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "linq-actor",
        channel: "linq",
        conversationKey: "linq-conversation",
        delivery: {
          kind: "thread",
          target: "linq-thread",
        },
        identityId: "linq-identity",
        threadId: "linq-thread",
        threadIsDirect: false,
      },
    });
    const media = [{
      kind: "image" as const,
      url: "https://cdn.example.test/reply-image.png",
      alt: null,
      source: null,
    }];
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "linq",
        idempotencyKey: "delivery-bubbles",
        messageLength: 8,
        providerMessageId: "provider-bubbles",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "linq-thread",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-bubbles",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        deliveryIdempotencyKey: "delivery-base",
        prompt: "hello",
        vault: "/vault",
      },
      media,
      response: "First move.\n---\nSecond move.\n---\nFinal question?",
      session,
      sharedPlan: createSharedPlan({
        conversationPolicy: {
          audience: {
            channel: "linq",
            threadIsDirect: false,
          },
        },
      }),
      turnId: "turn-linq-bubbles",
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledTimes(3);
    expect(
      runtimeState.outbox.deliverMessage.mock.calls.map((call) => ({
        answeredMailboxItemIds: call[0]?.answeredMailboxItemIds,
        dedupeToken: call[0]?.dedupeToken,
        deliveryIdempotencyKey: call[0]?.deliveryIdempotencyKey,
        media: call[0]?.media,
        message: call[0]?.message,
      })),
    ).toEqual([
      {
        answeredMailboxItemIds: [],
        dedupeToken: "delivery-base:bubble:0",
        deliveryIdempotencyKey: "delivery-base:bubble:0",
        media: [],
        message: "First move.",
      },
      {
        answeredMailboxItemIds: [],
        dedupeToken: "delivery-base:bubble:1",
        deliveryIdempotencyKey: "delivery-base:bubble:1",
        media: [],
        message: "Second move.",
      },
      {
        answeredMailboxItemIds: [],
        dedupeToken: "delivery-base",
        deliveryIdempotencyKey: "delivery-base",
        media,
        message: "Final question?",
      },
    ]);
  });

  it("keeps reviewed Assistant Ask replies in one proof-bound delivery", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "linq-actor",
        channel: "linq",
        conversationKey: "linq-conversation",
        delivery: {
          kind: "thread",
          target: "linq-thread",
        },
        identityId: "linq-identity",
        threadId: "linq-thread",
        threadIsDirect: false,
      },
    });
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "linq",
        idempotencyKey:
          "reviewed-assistant-ask-completion:aask_done_reviewed",
        messageLength: 20,
        providerMessageId: "provider-reviewed",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "linq-thread",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-reviewed",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantReply({
      input: {
        answeredMailboxItemIds: ["aask_done_reviewed"],
        deliverResponse: true,
        deliveryIdempotencyKey:
          "reviewed-assistant-ask-completion:aask_done_reviewed",
        prompt: "compose reviewed reply",
        reviewedAssistantAskCompletionExpiresAt:
          "2099-01-01T00:00:00.000Z",
        vault: "/vault",
      },
      response: "First point.\n---\nSecond point.",
      session,
      sharedPlan: createSharedPlan({
        conversationPolicy: {
          audience: {
            channel: "linq",
            threadIsDirect: false,
          },
        },
      }),
      turnId: "turn-reviewed",
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledTimes(1);
    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        answeredMailboxItemIds: ["aask_done_reviewed"],
        deliveryIdempotencyKey:
          "reviewed-assistant-ask-completion:aask_done_reviewed",
        message: "First point.\n\nSecond point.",
      }),
    );
  });

  it("delivers linq delimiter-only replies as the original literal text", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "linq-actor",
        channel: "linq",
        conversationKey: "linq-conversation",
        delivery: {
          kind: "thread",
          target: "linq-thread",
        },
        identityId: "linq-identity",
        threadId: "linq-thread",
        threadIsDirect: false,
      },
    });
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "linq",
        idempotencyKey: "delivery-linq-delimiter-only",
        messageLength: 13,
        providerMessageId: "provider-linq-delimiter-only",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "linq-thread",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-linq-delimiter-only",
      },
      kind: "sent",
      session: null,
    });

    const response = " \n---\n \n---\n";
    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        deliveryIdempotencyKey: "linq-delimiter-only",
        prompt: "hello",
        vault: "/vault",
      },
      response,
      session,
      sharedPlan: createSharedPlan({
        conversationPolicy: {
          audience: {
            channel: "linq",
            threadIsDirect: false,
          },
        },
      }),
      turnId: "turn-linq-delimiter-only",
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledTimes(1);
    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeToken: "linq-delimiter-only",
        deliveryIdempotencyKey: "linq-delimiter-only",
        message: response,
      }),
    );
  });

  it("delivers email delimiter lines byte-identically", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "email-actor",
        channel: "email",
        conversationKey: "email-conversation",
        delivery: {
          kind: "thread",
          target: "email-thread",
        },
        identityId: "email-identity",
        threadId: "email-thread",
        threadIsDirect: true,
      },
    });
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "email",
        idempotencyKey: "delivery-email-strip",
        messageLength: 18,
        providerMessageId: "provider-email-strip",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "email-thread",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-email-strip",
      },
      kind: "sent",
      session: null,
    });

    const response = "First.\n---\nSecond.";
    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        deliveryIdempotencyKey: "email-base",
        prompt: "hello",
        vault: "/vault",
      },
      response,
      session,
      sharedPlan: createSharedPlan({
        conversationPolicy: {
          audience: {
            channel: "email",
          },
        },
      }),
      turnId: "turn-email-strip",
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledTimes(1);
    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeToken: "email-base",
        deliveryIdempotencyKey: "email-base",
        message: response,
      }),
    );
  });

  it("stops bubble delivery after an earlier bubble fails", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "telegram-actor",
        channel: "telegram",
        conversationKey: "telegram-conversation",
        delivery: {
          kind: "thread",
          target: "telegram-thread",
        },
        identityId: "telegram-identity",
        threadId: "telegram-thread",
        threadIsDirect: true,
      },
    });
    const deliveryError = createDeliveryError({
      code: "CHANNEL_UNAVAILABLE",
      message: "channel unavailable",
    });
    runtimeState.outbox.deliverMessage.mockResolvedValueOnce({
      deliveryError,
      intent: {
        intentId: "intent-bubble-failed",
      },
      kind: "failed",
      session: null,
    });

    await expect(
      deliverAssistantReply({
        input: {
          deliverResponse: true,
          deliveryIdempotencyKey: "telegram-base",
          prompt: "hello",
          vault: "/vault",
        },
        response: "First.\n---\nSecond.\n---\nThird.",
        session,
        sharedPlan: createSharedPlan({
          conversationPolicy: {
            audience: {
              channel: "telegram",
            },
          },
        }),
        turnId: "turn-bubble-failure",
      }),
    ).resolves.toEqual({
      error: deliveryError,
      intentId: "intent-bubble-failed",
      kind: "failed",
      media: [],
      session,
    });
    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledTimes(1);
    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryIdempotencyKey: "telegram-base:bubble:0",
        message: "First.",
      }),
    );
  });

  it("queues bubble intents in message order and returns the final bubble outcome", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "telegram-actor",
        channel: "telegram",
        conversationKey: "telegram-conversation",
        delivery: {
          kind: "thread",
          target: "telegram-thread",
        },
        identityId: "telegram-identity",
        threadId: "telegram-thread",
        threadIsDirect: true,
      },
    });
    runtimeState.outbox.deliverMessage
      .mockResolvedValueOnce({
        deliveryError: null,
        intent: {
          intentId: "intent-bubble-one",
        },
        kind: "queued",
        session: null,
      })
      .mockResolvedValueOnce({
        deliveryError: null,
        intent: {
          intentId: "intent-bubble-two",
        },
        kind: "queued",
        session: null,
      })
      .mockResolvedValueOnce({
        deliveryError: null,
        intent: {
          intentId: "intent-bubble-three",
        },
        kind: "queued",
        session: null,
      });

    const outcome = await deliverAssistantReply({
      input: {
        deliverResponse: true,
        deliveryDispatchMode: "queue-only",
        prompt: "hello",
        vault: "/vault",
      },
      response: "First.\n---\nSecond.\n---\nThird.",
      session,
      sharedPlan: createSharedPlan({
        conversationPolicy: {
          audience: {
            channel: "telegram",
          },
        },
      }),
      turnId: "turn-bubble-queue",
    });

    expect(outcome).toEqual({
      error: null,
      intentId: "intent-bubble-three",
      kind: "queued",
      media: [],
      session,
    });
    expect(
      runtimeState.outbox.deliverMessage.mock.calls.map((call) => ({
        deliveryIdempotencyKey: call[0]?.deliveryIdempotencyKey,
        dispatchMode: call[0]?.dispatchMode,
        message: call[0]?.message,
      })),
    ).toEqual([
      {
        deliveryIdempotencyKey: "assistant-bubble:turn-bubble-queue:bubble:0",
        dispatchMode: "queue-only",
        message: "First.",
      },
      {
        deliveryIdempotencyKey: "assistant-bubble:turn-bubble-queue:bubble:1",
        dispatchMode: "queue-only",
        message: "Second.",
      },
      {
        deliveryIdempotencyKey: null,
        dispatchMode: "queue-only",
        message: "Third.",
      },
    ]);
  });

  it("suppresses Telegram auto-reply native reply anchors for final text delivery", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "telegram",
        conversationKey: "binding-key",
        delivery: {
          kind: "thread",
          target: "binding-thread",
        },
        identityId: "binding-identity",
        threadId: "binding-thread",
        threadIsDirect: true,
      },
    });
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "telegram",
        idempotencyKey: "delivery-telegram-auto",
        messageLength: 5,
        providerMessageId: "provider-telegram-auto",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "binding-thread",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-telegram-auto",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        deliveryReplyToMessageId: "telegram-inbound-message",
        prompt: "hello",
        turnTrigger: "automation-auto-reply",
        vault: "/vault",
      },
      response: "reply",
      session,
      sharedPlan: createSharedPlan(),
      turnId: "turn-telegram-auto-no-native-anchor",
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        message: "reply",
        replyToMessageId: null,
        turnTrigger: "automation-auto-reply",
      }),
    );
  });

  it("keeps one selected Telegram target and marker on every reply bubble", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "telegram",
        conversationKey: "binding-key",
        delivery: {
          kind: "thread",
          target: "binding-thread",
        },
        identityId: "binding-identity",
        threadId: "binding-thread",
        threadIsDirect: true,
      },
    });
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "telegram",
        idempotencyKey: "delivery-telegram-selected",
        messageLength: 5,
        providerMessageId: "provider-telegram-selected",
        providerThreadId: null,
        sentAt: "2026-07-16T12:00:00.000Z",
        target: "binding-thread",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-telegram-selected",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        deliveryNativeReplyRequested: true,
        deliveryReplyToMessageId: "4242",
        prompt: "hello",
        turnTrigger: "automation-auto-reply",
        vault: "/vault",
      },
      response: "First.\n---\nSecond.",
      session,
      sharedPlan: createSharedPlan(),
      turnId: "turn-telegram-selected-bubbles",
    });

    expect(
      runtimeState.outbox.deliverMessage.mock.calls.map(([call]) => ({
        message: call?.message,
        nativeReplyRequested: call?.nativeReplyRequested,
        replyToMessageId: call?.replyToMessageId,
      })),
    ).toEqual([
      {
        message: "First.",
        nativeReplyRequested: true,
        replyToMessageId: "4242",
      },
      {
        message: "Second.",
        nativeReplyRequested: true,
        replyToMessageId: "4242",
      },
    ]);
  });

  it("keeps explicit Telegram native reply anchors for manual final text delivery", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "telegram",
        conversationKey: "binding-key",
        delivery: {
          kind: "thread",
          target: "binding-thread",
        },
        identityId: "binding-identity",
        threadId: "binding-thread",
        threadIsDirect: true,
      },
    });
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "telegram",
        idempotencyKey: "delivery-telegram-manual",
        messageLength: 5,
        providerMessageId: "provider-telegram-manual",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "binding-thread",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-telegram-manual",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        deliveryReplyToMessageId: "manual-reply-message",
        prompt: "hello",
        turnTrigger: "manual-ask",
        vault: "/vault",
      },
      response: "reply",
      session,
      sharedPlan: createSharedPlan(),
      turnId: "turn-telegram-manual-native-anchor",
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        message: "reply",
        replyToMessageId: "manual-reply-message",
        turnTrigger: "manual-ask",
      }),
    );
  });

  it("sends progress directly without creating receipt-owning outbox intents", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "telegram",
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

    await deliverAssistantProgressUpdate({
      input: {
        deliverResponse: true,
        deliveryIdempotencyKey: "reply-key",
        prompt: "hello",
        vault: "/vault",
      },
      ordinal: 0,
      session,
      sharedPlan: createSharedPlan({
        conversationPolicy: {
          audience: {
            channel: "telegram",
            explicitTarget: "audience-target",
            replyToMessageId: "reply-audience",
          },
        },
      }),
      text: "Still extracting the PDF.",
      turnId: "turn-progress-direct",
    });

    expect(runtimeState.outbox.deliverMessage).not.toHaveBeenCalled();
    expect(seamMocks.sendAssistantOutboxDispatchMessage).toHaveBeenCalledWith(
      expect.objectContaining({
      deliveryIdempotencyKey: "reply-key:progress:0",
      explicitTarget: "audience-target",
      media: [],
      message: "Still extracting the PDF.",
      replyToMessageId: "reply-audience",
      sessionId: session.sessionId,
      subject: null,
      turnId: "turn-progress-direct",
      signal: undefined,
      vault: "/vault",
      }),
    );
  });

  it("suppresses Telegram auto-reply native reply anchors for progress text delivery", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "telegram",
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

    await deliverAssistantProgressUpdate({
      input: {
        deliverResponse: true,
        deliveryIdempotencyKey: "reply-key",
        prompt: "hello",
        turnTrigger: "automation-auto-reply",
        vault: "/vault",
      },
      ordinal: 0,
      session,
      sharedPlan: createSharedPlan({
        conversationPolicy: {
          audience: {
            channel: "telegram",
            explicitTarget: "audience-target",
            replyToMessageId: "reply-audience",
          },
        },
      }),
      text: "Still extracting the PDF.",
      turnId: "turn-progress-telegram-auto",
    });

    expect(runtimeState.outbox.deliverMessage).not.toHaveBeenCalled();
    expect(seamMocks.sendAssistantOutboxDispatchMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        deliveryIdempotencyKey: "reply-key:progress:0",
        explicitTarget: "audience-target",
        message: "Still extracting the PDF.",
        replyToMessageId: null,
        turnId: "turn-progress-telegram-auto",
      }),
    );
  });

  it("passes hosted channel delivery dependencies to progress sends", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "linq",
        conversationKey: "binding-key",
        delivery: {
          kind: "thread",
          target: "binding-delivery",
        },
        identityId: "binding-identity",
        threadId: "binding-thread",
        threadIsDirect: true,
      },
    });
    const dependencies = {
      sendLinq: vi.fn(async () => ({
        providerMessageId: "linq-progress-message",
        providerThreadId: "binding-thread",
        target: "binding-thread",
        targetKind: "thread" as const,
      })),
    };

    await deliverAssistantProgressUpdate({
      dependencies,
      input: {
        deliverResponse: true,
        deliveryIdempotencyKey: "reply-key",
        prompt: "hello",
        vault: "/vault",
      },
      ordinal: 0,
      session,
      sharedPlan: createSharedPlan(),
      text: "Still checking the iMessage thread.",
      turnId: "turn-progress-hosted-dependencies",
    });

    expect(seamMocks.sendAssistantOutboxDispatchMessage).toHaveBeenCalledWith(
      expect.objectContaining({
      dependencies,
      channel: "linq",
      deliveryIdempotencyKey: "reply-key:progress:0",
      media: [],
      message: "Still checking the iMessage thread.",
      replyToMessageId: null,
      sessionId: session.sessionId,
      subject: null,
      threadId: "binding-thread",
      turnId: "turn-progress-hosted-dependencies",
      signal: undefined,
      vault: "/vault",
      }),
    );
  });

  it("derives hosted progress idempotency from the final delivery base key", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "linq",
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

    await deliverAssistantProgressUpdate({
      input: {
        deliverResponse: true,
        executionContext: {
          hosted: {
            memberId: "member-hosted",
            userEnvKeys: [],
          },
        },
        hostedDeliveryIdempotency: {
          assistantTurnOrdinal: "assistant-reply:1",
          inboundMailboxItemIds: ["mailbox_item_123"],
        },
        prompt: "hello",
        vault: "/vault",
      },
      ordinal: 0,
      session,
      sharedPlan: createSharedPlan(),
      text: "Still checking the file.",
      turnId: "turn-progress-derived-key",
    });

    const firstProgressKey = seamMocks.sendAssistantOutboxDispatchMessage.mock.lastCall?.[0]
      .deliveryIdempotencyKey;
    expect(firstProgressKey).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}:progress:0$/u));
    expect(firstProgressKey).not.toContain("turn-progress-derived-key");

    await deliverAssistantProgressUpdate({
      input: {
        deliverResponse: true,
        executionContext: {
          hosted: {
            memberId: "member-hosted",
            userEnvKeys: [],
          },
        },
        hostedDeliveryIdempotency: {
          assistantTurnOrdinal: "assistant-reply:1",
          inboundMailboxItemIds: ["mailbox_item_123"],
        },
        prompt: "hello",
        vault: "/vault",
      },
      ordinal: 0,
      session,
      sharedPlan: createSharedPlan(),
      text: "Still checking the file.",
      turnId: "turn-progress-derived-key-retry",
    });

    expect(seamMocks.sendAssistantOutboxDispatchMessage.mock.lastCall?.[0])
      .toEqual(expect.objectContaining({
        deliveryIdempotencyKey: firstProgressKey,
      }));
  });

  it("fails closed for hosted progress without a deterministic Linq key", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "linq",
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
    seamMocks.sendAssistantOutboxDispatchMessage.mockClear();

    await expect(
      deliverAssistantProgressUpdate({
        input: {
          deliverResponse: true,
          executionContext: {
            hosted: {
              memberId: "member-hosted",
              userEnvKeys: [],
            },
          },
          prompt: "hello",
          vault: "/vault",
        },
        ordinal: 0,
        session,
        sharedPlan: createSharedPlan(),
        text: "Still checking the file.",
        turnId: "turn-progress-missing-key",
      })
    ).rejects.toThrow("Hosted outbound delivery requires a deterministic idempotency key.");

    expect(seamMocks.sendAssistantOutboxDispatchMessage).not.toHaveBeenCalled();
  });

  it("delivers preceding steered answers in order with segment idempotency keys", async () => {
    const session = createAssistantSession();
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "telegram",
        idempotencyKey: "idem-segment",
        messageLength: 10,
        providerMessageId: "provider-segment",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "thread-1",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-segment",
      },
      kind: "sent",
      session: null,
    });

    const outcomes = await deliverAssistantPrecedingReplies({
      input: {
        deliverResponse: true,
        prompt: "hello",
        vault: "/vault",
      },
      segments: [
        {
          response: "Answer one.",
          media: [],
        },
        {
          response: "Answer two.",
          media: [],
        },
      ],
      session,
      sharedPlan: createSharedPlan(),
      turnId: "turn-segments",
    });

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["sent", "sent"]);
    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledTimes(2);
    expect(runtimeState.outbox.deliverMessage.mock.calls[0]?.[0]).toMatchObject({
      dedupeToken: "assistant-segment:turn-segments:0",
      deliveryIdempotencyKey: "assistant-segment:turn-segments:0",
      media: [],
      message: "Answer one.",
      turnId: "turn-segments",
    });
    expect(runtimeState.outbox.deliverMessage.mock.calls[1]?.[0]).toMatchObject({
      dedupeToken: "assistant-segment:turn-segments:1",
      deliveryIdempotencyKey: "assistant-segment:turn-segments:1",
      media: [],
      message: "Answer two.",
      turnId: "turn-segments",
    });
  });

  it("derives preceding segment keys from an explicit delivery idempotency key", async () => {
    const session = createAssistantSession();
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "telegram",
        idempotencyKey: "idem-segment-base",
        messageLength: 10,
        providerMessageId: "provider-segment-base",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "thread-1",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-segment-base",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantPrecedingReplies({
      input: {
        deliverResponse: true,
        deliveryIdempotencyKey: "delivery-base",
        prompt: "hello",
        vault: "/vault",
      },
      segments: [
        {
          response: "Answer one.",
          media: [],
        },
        {
          response: "Answer two.",
          media: [],
        },
      ],
      session,
      sharedPlan: createSharedPlan(),
      turnId: "turn-segments-base",
    });

    expect(
      runtimeState.outbox.deliverMessage.mock.calls.map(
        (call) => call[0]?.deliveryIdempotencyKey
      )
    ).toEqual(["delivery-base:segment:0", "delivery-base:segment:1"]);
    expect(
      runtimeState.outbox.deliverMessage.mock.calls.map(
        (call) => call[0]?.dedupeToken
      )
    ).toEqual(["delivery-base:segment:0", "delivery-base:segment:1"]);
  });

  it("composes preceding segment and bubble idempotency keys", async () => {
    const session = createAssistantSession();
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "telegram",
        idempotencyKey: "idem-segment-bubble",
        messageLength: 10,
        providerMessageId: "provider-segment-bubble",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "thread-1",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-segment-bubble",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantPrecedingReplies({
      input: {
        deliverResponse: true,
        deliveryIdempotencyKey: "delivery-base",
        prompt: "hello",
        vault: "/vault",
      },
      segments: [
        {
          response: "Answer one.\n---\nAnswer two.",
          media: [],
        },
      ],
      session,
      sharedPlan: createSharedPlan({
        conversationPolicy: {
          audience: {
            channel: "telegram",
          },
        },
      }),
      turnId: "turn-segment-bubbles",
    });

    expect(
      runtimeState.outbox.deliverMessage.mock.calls.map((call) => ({
        dedupeToken: call[0]?.dedupeToken,
        deliveryIdempotencyKey: call[0]?.deliveryIdempotencyKey,
        message: call[0]?.message,
      })),
    ).toEqual([
      {
        dedupeToken: "delivery-base:segment:0:bubble:0",
        deliveryIdempotencyKey: "delivery-base:segment:0:bubble:0",
        message: "Answer one.",
      },
      {
        dedupeToken: "delivery-base:segment:0",
        deliveryIdempotencyKey: "delivery-base:segment:0",
        message: "Answer two.",
      },
    ]);
  });

  it("delivers preceding segments with their own delivery contexts", async () => {
    const session = createAssistantSession();
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "telegram",
        idempotencyKey: "idem-segment-context",
        messageLength: 10,
        providerMessageId: "provider-segment-context",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "thread-1",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-segment-context",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantPrecedingReplies({
      input: {
        deliverResponse: true,
        deliveryIdempotencyKey: "final-delivery",
        deliveryReplyToMessageId: "final-message",
        deliveryTarget: "final-thread",
        prompt: "hello",
        vault: "/vault",
      },
      segments: [
        {
          deliveryContext: {
            deliveryIdempotencyKey: "delivery-one",
            deliveryReplyToMessageId: "message-one",
            deliveryTarget: "thread-one",
          },
          response: "Answer one.",
          media: [],
        },
        {
          deliveryContext: {
            deliveryIdempotencyKey: "delivery-two",
            deliveryReplyToMessageId: "message-two",
            deliveryTarget: "thread-two",
          },
          response: "Answer two.",
          media: [],
        },
      ],
      session,
      sharedPlan: createSharedPlan(),
      turnId: "turn-segments-context",
    });

    expect(
      runtimeState.outbox.deliverMessage.mock.calls.map((call) => ({
        dedupeToken: call[0]?.dedupeToken,
        deliveryIdempotencyKey: call[0]?.deliveryIdempotencyKey,
        explicitTarget: call[0]?.explicitTarget,
        message: call[0]?.message,
        replyToMessageId: call[0]?.replyToMessageId,
      }))
    ).toEqual([
      {
        dedupeToken: "delivery-one:segment:0",
        deliveryIdempotencyKey: "delivery-one:segment:0",
        explicitTarget: "thread-one",
        message: "Answer one.",
        replyToMessageId: "message-one",
      },
      {
        dedupeToken: "delivery-two:segment:1",
        deliveryIdempotencyKey: "delivery-two:segment:1",
        explicitTarget: "thread-two",
        message: "Answer two.",
        replyToMessageId: "message-two",
      },
    ]);
  });

  it("continues preceding segment delivery after a thrown segment and preserves session progress", async () => {
    const session = createAssistantSession();
    const sessionAfterFirst = createAssistantSession({
      sessionId: "session-after-first-segment",
    });
    const sessionAfterThird = createAssistantSession({
      sessionId: "session-after-third-segment",
    });
    runtimeState.outbox.deliverMessage
      .mockResolvedValueOnce({
        delivery: {
          channel: "telegram",
          idempotencyKey: "idem-segment-one",
          messageLength: 10,
          providerMessageId: "provider-segment-one",
          providerThreadId: null,
          sentAt: "2026-04-08T11:00:00.000Z",
          target: "thread-1",
          targetKind: "thread",
        },
        intent: {
          intentId: "intent-segment-one",
        },
        kind: "sent",
        session: sessionAfterFirst,
      })
      .mockRejectedValueOnce(new Error("outbox write failed"))
      .mockResolvedValueOnce({
        delivery: {
          channel: "telegram",
          idempotencyKey: "idem-segment-three",
          messageLength: 12,
          providerMessageId: "provider-segment-three",
          providerThreadId: null,
          sentAt: "2026-04-08T11:00:02.000Z",
          target: "thread-1",
          targetKind: "thread",
        },
        intent: {
          intentId: "intent-segment-three",
        },
        kind: "sent",
        session: sessionAfterThird,
      });

    const outcomes = await deliverAssistantPrecedingReplies({
      input: {
        deliverResponse: true,
        prompt: "hello",
        vault: "/vault",
      },
      segments: [
        {
          response: "Answer one.",
          media: [],
        },
        {
          response: "Answer two.",
          media: [],
        },
        {
          response: "Answer three.",
          media: [],
        },
      ],
      session,
      sharedPlan: createSharedPlan(),
      turnId: "turn-segments-partial",
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledTimes(3);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      "sent",
      "failed",
      "sent",
    ]);
    expect(outcomes[0]?.session.sessionId).toBe("session-after-first-segment");
    expect(outcomes[1]?.session.sessionId).toBe("session-after-first-segment");
    expect(outcomes[2]?.session.sessionId).toBe("session-after-third-segment");
    expect(
      runtimeState.outbox.deliverMessage.mock.calls[2]?.[0]?.message
    ).toBe("Answer three.");
  });

  it("skips preceding steered answers when delivery is disabled", async () => {
    const session = createAssistantSession();

    await expect(
      deliverAssistantPrecedingReplies({
        input: {
          deliverResponse: false,
          prompt: "hello",
          vault: "/vault",
        },
        segments: [
          {
            response: "Answer one.",
            media: [],
          },
        ],
        session,
        sharedPlan: createSharedPlan(),
        turnId: "turn-segments-disabled",
      })
    ).resolves.toEqual([]);

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
      media: [],
      session,
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith({
      actorId: "audience-actor",
      answeredMailboxItemIds: [],
      automationAuthority: null,
      automationContextReferences: null,
      bindingDelivery: {
        kind: "participant",
        target: "audience-delivery",
      },
      card: null,
      channel: "telegram",
      dedupeToken: null,
      deliveryIdempotencyKey: null,
      deliverySource: null,
      deliveryTransportIdempotent: undefined,
      dependencies: undefined,
      dispatchMode: "immediate",
      explicitTarget: "explicit-input-target",
      externalThreadRouteAuthority: null,
      identityId: "audience-identity",
      media: [],
      message: "reply body",
      nativeReplyRequested: undefined,
      plannedOccurrenceAt: null,
      replyToMessageId: "reply-input",
      reviewedAssistantAskCompletionExpiresAt: null,
      scheduledOccurrenceAt: null,
      sessionId: session.sessionId,
      subject: null,
      threadId: "audience-thread",
      threadIsDirect: false,
      turnId: "turn-2",
      turnTrigger: null,
    });
  });

  it("passes provider response media to final delivery", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "linq",
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
    const media = [
      {
        kind: "image" as const,
        url: "https://cdn.example.test/dead-bug/setup.png",
        alt: "Dead bug setup",
        source: "dead-bug-setup",
      },
    ];
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "linq",
        idempotencyKey: "idem-media",
        messageLength: 10,
        providerMessageId: "provider-media",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "binding-delivery",
        targetKind: "participant",
      },
      intent: {
        intentId: "intent-media",
      },
      kind: "sent",
      session: null,
    });

    await expect(
      deliverAssistantReply({
        input: {
          deliverResponse: true,
          deliveryDispatchMode: "immediate",
          prompt: "hello",
          vault: "/vault",
        },
        media,
        response: "reply body",
        session,
        sharedPlan: createSharedPlan(),
        turnId: "turn-media-delivery",
      }),
    ).resolves.toEqual({
      delivery: {
        channel: "linq",
        idempotencyKey: "idem-media",
        messageLength: 10,
        providerMessageId: "provider-media",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "binding-delivery",
        targetKind: "participant",
      },
      intentId: "intent-media",
      kind: "sent",
      media,
      session,
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        media,
        message: "reply body",
        turnId: "turn-media-delivery",
      }),
    );
  });

  it("drops provider response media for channels that cannot deliver media", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "email",
        conversationKey: "binding-key",
        delivery: {
          kind: "thread",
          target: "binding-thread",
        },
        identityId: "binding-identity",
        threadId: "binding-thread",
        threadIsDirect: true,
      },
    });
    const media = [
      {
        kind: "image" as const,
        url: "https://cdn.example.test/dead-bug/email.png",
        alt: "Email unsupported image",
        source: "email-unsupported",
      },
    ];
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "email",
        idempotencyKey: null,
        messageLength: 10,
        providerMessageId: "provider-text-only",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "binding-thread",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-text-only",
      },
      kind: "sent",
      session: null,
    });

    await expect(
      deliverAssistantReply({
        input: {
          deliverResponse: true,
          prompt: "hello",
          vault: "/vault",
        },
        media,
        response: "reply body",
        session,
        sharedPlan: createSharedPlan(),
        turnId: "turn-media-unsupported",
      }),
    ).resolves.toEqual({
      delivery: {
        channel: "email",
        idempotencyKey: null,
        messageLength: 10,
        providerMessageId: "provider-text-only",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "binding-thread",
        targetKind: "thread",
      },
      intentId: "intent-text-only",
      kind: "sent",
      media: [],
      session,
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "email",
        media: [],
        message: "reply body",
        turnId: "turn-media-unsupported",
      }),
    );
  });

  it("marks hosted Linq deliveries with deterministic keys idempotent before outbox dispatch", async () => {
    const session = createAssistantSession({
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
    });
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "email",
        idempotencyKey: "sha256:hosted-email",
        messageLength: 10,
        providerMessageId: "provider-email",
        providerThreadId: null,
        sentAt: "2026-04-08T11:00:00.000Z",
        target: "binding-delivery",
        targetKind: "participant",
      },
      intent: {
        intentId: "intent-email",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        executionContext: {
          hosted: {
            memberId: "member-hosted",
            userEnvKeys: [],
          },
        },
        hostedDeliveryIdempotency: {
          assistantTurnOrdinal: "assistant-reply:1",
          inboundMailboxItemIds: ["mailbox_item_email"],
        },
        prompt: "hello",
        vault: "/vault",
      },
      response: "reply body",
      session,
      sharedPlan: createSharedPlan(),
      turnId: "turn-hosted-email",
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        channel: "email",
        deliveryIdempotencyKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        deliveryTransportIdempotent: false,
      }),
    );

    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "linq",
        idempotencyKey: "sha256:hosted-linq",
        messageLength: 10,
        providerMessageId: "provider-linq",
        providerThreadId: null,
        sentAt: "2026-04-08T11:01:00.000Z",
        target: "linq-thread",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-linq",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        deliveryIdempotencyKey: "sha256:hosted-linq",
        executionContext: {
          hosted: {
            memberId: "member-hosted",
            userEnvKeys: [],
          },
        },
        prompt: "hello",
        vault: "/vault",
      },
      response: "reply body",
      session: {
        ...session,
        binding: {
          ...session.binding,
          channel: "linq",
        },
      },
      sharedPlan: createSharedPlan(),
      turnId: "turn-hosted-linq",
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        channel: "linq",
        deliveryIdempotencyKey: "sha256:hosted-linq",
        deliveryTransportIdempotent: true,
      }),
    );

    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "linq",
        idempotencyKey: "sha256:derived-hosted-linq",
        messageLength: 10,
        providerMessageId: "provider-linq-derived-key",
        providerThreadId: null,
        sentAt: "2026-04-08T11:02:00.000Z",
        target: "linq-thread",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-linq-derived-key",
      },
      kind: "sent",
      session: null,
    });

    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        executionContext: {
          hosted: {
            memberId: "member-hosted",
            userEnvKeys: [],
          },
        },
        hostedDeliveryIdempotency: {
          assistantTurnOrdinal: "assistant-reply:1",
          inboundMailboxItemIds: ["mailbox_item_123"],
        },
        prompt: "hello",
        vault: "/vault",
      },
      response: "reply body",
      session: {
        ...session,
        binding: {
          ...session.binding,
          channel: "linq",
        },
      },
      sharedPlan: createSharedPlan(),
      turnId: "turn-hosted-linq-no-key",
    });

    expect(runtimeState.outbox.deliverMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        channel: "linq",
        deliveryIdempotencyKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        deliveryTransportIdempotent: true,
      }),
    );
    const firstDerivedLinqKey = runtimeState.outbox.deliverMessage.mock.lastCall?.[0]
      .deliveryIdempotencyKey;

    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        executionContext: {
          hosted: {
            memberId: "member-hosted",
            userEnvKeys: [],
          },
        },
        hostedDeliveryIdempotency: {
          assistantTurnOrdinal: "assistant-reply:1",
          inboundMailboxItemIds: ["mailbox_item_123"],
        },
        prompt: "hello",
        vault: "/vault",
      },
      response: "reply body",
      session: {
        ...session,
        binding: {
          ...session.binding,
          channel: "linq",
        },
      },
      sharedPlan: createSharedPlan(),
      turnId: "turn-hosted-linq-no-key-retry",
    });

    expect(runtimeState.outbox.deliverMessage.mock.lastCall?.[0])
      .toEqual(expect.objectContaining({
        deliveryIdempotencyKey: firstDerivedLinqKey,
      }));

    await deliverAssistantReply({
      input: {
        deliverResponse: true,
        executionContext: {
          hosted: {
            memberId: "member-hosted",
            userEnvKeys: [],
          },
        },
        hostedDeliveryIdempotency: {
          assistantTurnOrdinal: "assistant-reply:1",
          inboundMailboxItemIds: ["mailbox_item_older", "mailbox_item_123"],
        },
        prompt: "hello",
        vault: "/vault",
      },
      response: "reply body",
      session: {
        ...session,
        binding: {
          ...session.binding,
          channel: "linq",
        },
      },
      sharedPlan: createSharedPlan(),
      turnId: "turn-hosted-linq-replayed-batch",
    });

    expect(runtimeState.outbox.deliverMessage.mock.lastCall?.[0])
      .toEqual(expect.objectContaining({
        deliveryIdempotencyKey: firstDerivedLinqKey,
      }));

    await expect(
      deliverAssistantReply({
        input: {
          deliverResponse: true,
          executionContext: {
            hosted: {
              memberId: "member-hosted",
              userEnvKeys: [],
            },
          },
          prompt: "hello",
          vault: "/vault",
        },
        response: "reply body",
        session: {
          ...session,
          binding: {
            ...session.binding,
            channel: "linq",
          },
        },
        sharedPlan: createSharedPlan(),
        turnId: "turn-hosted-linq-missing-key",
      })
    ).rejects.toThrow("Hosted outbound delivery requires a deterministic idempotency key.");
  });

  it("fails closed for hosted email deliveries without a deterministic key", async () => {
    const session = createAssistantSession({
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
    });

    await expect(
      deliverAssistantReply({
        input: {
          deliverResponse: true,
          executionContext: {
            hosted: {
              memberId: "member-hosted",
              userEnvKeys: [],
            },
          },
          prompt: "hello",
          vault: "/vault",
        },
        response: "reply body",
        session,
        sharedPlan: createSharedPlan(),
        turnId: "turn-hosted-email-missing-key",
      })
    ).rejects.toThrow("Hosted outbound delivery requires a deterministic idempotency key.");
  });

  it("derives hosted idempotency from the resolved explicit delivery target", async () => {
    const session = createAssistantSession({
      binding: {
        actorId: "binding-actor",
        channel: "linq",
        conversationKey: "binding-key",
        delivery: {
          kind: "thread",
          target: "binding-thread-target",
        },
        identityId: "binding-identity",
        threadId: "binding-thread",
        threadIsDirect: true,
      },
    });
    const sharedPlan = createSharedPlan({
      conversationPolicy: {
        audience: {
          actorId: "audience-actor",
          bindingDelivery: {
            kind: "thread",
            target: "audience-binding-target",
          },
          channel: "linq",
          explicitTarget: "audience-explicit-target",
          identityId: "audience-identity",
          threadId: "audience-thread",
          threadIsDirect: false,
        },
      },
    });
    runtimeState.outbox.deliverMessage.mockResolvedValue({
      delivery: {
        channel: "linq",
        idempotencyKey: "provider-key",
        messageLength: 10,
        providerMessageId: "provider-target-key",
        providerThreadId: null,
        sentAt: "2026-04-08T11:03:00.000Z",
        target: "linq-target",
        targetKind: "thread",
      },
      intent: {
        intentId: "intent-target-key",
      },
      kind: "sent",
      session: null,
    });
    const baseInput = {
      deliverResponse: true,
      executionContext: {
        hosted: {
          memberId: "member-hosted",
          userEnvKeys: [],
        },
      },
      hostedDeliveryIdempotency: {
        assistantTurnOrdinal: "assistant-reply:target",
        inboundMailboxItemIds: ["mailbox_item_target"],
      },
      prompt: "hello",
      vault: "/vault",
    };

    await deliverAssistantReply({
      input: baseInput,
      response: "reply body",
      session,
      sharedPlan,
      turnId: "turn-hosted-target-audience",
    });
    const audienceCall = runtimeState.outbox.deliverMessage.mock.lastCall?.[0];
    const audienceKey = audienceCall?.deliveryIdempotencyKey;
    expect(audienceCall).toEqual(expect.objectContaining({
      explicitTarget: "audience-explicit-target",
      deliveryIdempotencyKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    }));

    await deliverAssistantReply({
      input: {
        ...baseInput,
        deliveryTarget: "input-explicit-target",
      },
      response: "reply body",
      session,
      sharedPlan,
      turnId: "turn-hosted-target-input",
    });
    const inputTargetCall = runtimeState.outbox.deliverMessage.mock.lastCall?.[0];
    const inputTargetKey = inputTargetCall?.deliveryIdempotencyKey;
    expect(inputTargetCall).toEqual(expect.objectContaining({
      explicitTarget: "input-explicit-target",
      deliveryIdempotencyKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    }));
    expect(inputTargetKey).not.toBe(audienceKey);

    await deliverAssistantReply({
      input: {
        ...baseInput,
        deliveryTarget: null,
      },
      response: "reply body",
      session,
      sharedPlan,
      turnId: "turn-hosted-target-clear",
    });
    const clearedTargetCall = runtimeState.outbox.deliverMessage.mock.lastCall?.[0];
    expect(clearedTargetCall).toEqual(expect.objectContaining({
      explicitTarget: null,
      deliveryIdempotencyKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    }));
    expect(clearedTargetCall?.deliveryIdempotencyKey).not.toBe(audienceKey);
    expect(clearedTargetCall?.deliveryIdempotencyKey).not.toBe(inputTargetKey);
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
        deliveryIdempotencyKey: "sha256:local-email",
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
        deliveryIdempotencyKey: "sha256:local-email",
        deliveryTransportIdempotent: undefined,
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
      media: [],
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
      media: [],
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
      media: [],
      session,
    });

    expect(seamMocks.normalizeAssistantDeliveryError).toHaveBeenCalledTimes(1);
  });

  it("preserves caller-provided response text in turn delivery receipts", () => {
    const session = createAssistantSession();
    const response = "First.\n---\nSecond.";

    expect(
      buildAssistantTurnDeliveryFinalizationPlan({
        completedAt: "2026-04-08T12:00:00.000Z",
        outcome: {
          delivery: {
            channel: "telegram",
            idempotencyKey: "receipt-bubbles",
            messageLength: 10,
            providerMessageId: "provider-receipt-bubbles",
            providerThreadId: null,
            sentAt: "2026-04-08T12:00:00.000Z",
            target: "thread-1",
            targetKind: "thread",
          },
          intentId: "intent-receipt-bubbles",
          kind: "sent",
          media: [],
          session,
        },
        response,
        turnId: "turn-receipt-bubbles",
      }).receipt,
    ).toMatchObject({
      deliveryDisposition: "sent",
      response,
      status: "completed",
    });
  });

  it("builds receipt and diagnostic plans for every delivery disposition", () => {
    const session = createAssistantSession();

    expect(
      buildAssistantTurnDeliveryFinalizationPlan({
        completedAt: "2026-04-08T12:00:00.000Z",
        outcome: {
          kind: "not-requested",
          media: [],
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
          media: [],
          session,
        },
        response: "reply",
        turnId: "turn-sent",
      })
    ).toEqual({
      diagnostic: expect.objectContaining({
        counterDeltas: {
          turnsCompleted: 1,
        },
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
          media: [],
          session,
        },
        response: "reply",
        turnId: "turn-queued",
      })
    ).toEqual({
      diagnostic: expect.objectContaining({
        code: "RETRYABLE",
        counterDeltas: {
          turnsDeferred: 1,
        },
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
          media: [],
          session,
        },
        response: "reply",
        turnId: "turn-failed",
      })
    ).toEqual({
      diagnostic: expect.objectContaining({
        code: "DELIVERY_FAILED",
        counterDeltas: {
          turnsFailed: 1,
        },
        kind: "turn.failed",
        level: "error",
      }),
      receipt: expect.objectContaining({
        deliveryDisposition: "failed",
        status: "failed",
      }),
    });
  });

  it("finalizes receipts and marks first contact for accepted injected turns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T12:30:00.000Z"));
    await finalizeAssistantTurnFromDeliveryOutcome({
      firstContactGuidanceInjected: true,
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
        media: [],
        session: createAssistantSession({
          sessionId: "session-sent",
        }),
      },
      response: ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
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
      firstContactGuidanceInjected: true,
      firstContactStateDocIds: ["doc-1"],
      outcome: {
        error: null,
        intentId: "intent-queued",
        kind: "queued",
        media: [],
        session: createAssistantSession({
          sessionId: "session-queued",
        }),
      },
      response: ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
      turnId: "turn-queued-finalize",
      vault: "/vault",
    });

    expect(seamMocks.markAssistantFirstContactSeen).toHaveBeenCalledWith({
      docIds: ["doc-1"],
      seenAt: "2026-04-08T12:30:00.000Z",
      vault: "/vault",
    });
    seamMocks.markAssistantFirstContactSeen.mockClear();

    // Any accepted non-empty reply is first contact, not just the canned
    // welcome text — an organic onboarding reply must supersede a queued
    // signup welcome for the same route.
    await finalizeAssistantTurnFromDeliveryOutcome({
      firstContactGuidanceInjected: true,
      firstContactStateDocIds: ["doc-organic-reply"],
      outcome: {
        delivery: {
          channel: "telegram",
          idempotencyKey: null,
          messageLength: 16,
          providerMessageId: "provider-organic-reply",
          providerThreadId: null,
          sentAt: "2026-04-08T12:30:00.000Z",
          target: "thread-1",
          targetKind: "thread",
        },
        intentId: "intent-organic-reply",
        kind: "sent",
        media: [],
        session: createAssistantSession({
          sessionId: "session-organic-reply",
        }),
      },
      response: "Happy to help.",
      turnId: "turn-organic-reply-finalize",
      vault: "/vault",
    });

    expect(seamMocks.markAssistantFirstContactSeen).toHaveBeenCalledWith({
      docIds: ["doc-organic-reply"],
      seenAt: "2026-04-08T12:30:00.000Z",
      vault: "/vault",
    });
    seamMocks.markAssistantFirstContactSeen.mockClear();

    await finalizeAssistantTurnFromDeliveryOutcome({
      firstContactGuidanceInjected: true,
      firstContactStateDocIds: ["doc-no-reply"],
      outcome: {
        kind: "not-requested",
        media: [],
        session: createAssistantSession({
          sessionId: "session-no-reply",
        }),
      },
      response: "",
      turnId: "turn-no-reply-finalize",
      vault: "/vault",
    });

    await finalizeAssistantTurnFromDeliveryOutcome({
      firstContactStateDocIds: ["doc-no-guidance"],
      outcome: {
        delivery: {
          channel: "telegram",
          idempotencyKey: null,
          messageLength: 16,
          providerMessageId: "provider-no-guidance",
          providerThreadId: null,
          sentAt: "2026-04-08T12:30:00.000Z",
          target: "thread-1",
          targetKind: "thread",
        },
        intentId: "intent-no-guidance",
        kind: "sent",
        media: [],
        session: createAssistantSession({
          sessionId: "session-no-guidance",
        }),
      },
      response: "Happy to help.",
      turnId: "turn-no-guidance-finalize",
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
          userEnvKeys: ["CODEX_API_KEY"],
        },
      })
    ).toEqual({
      hosted: null,
    });
  });

  it("normalizes hosted context and preserves callable helpers only", () => {
    const actionApprovalPort = { read: vi.fn(), request: vi.fn() };
    const deviceTool = { request: vi.fn() };
    const groupPermissionOfferTool = { request: vi.fn() };
    const groupSharedReader = { request: vi.fn() };
    const createScheduledGroupTools = vi.fn();
    const resolveScheduledLinqRoute = vi.fn();
    const defaultTarget = createAssistantModelTarget({
      model: "gpt-5.6-terra",
      modelProvider: "vercel-ai-gateway",
      provider: "codex-cli",
    });

    expect(
      normalizeAssistantExecutionContext({
        hosted: {
          actionApprovalPort,
          createScheduledGroupTools,
          defaultTarget,
          deviceConnectProviders: [
            { label: " Oura ", provider: " OURA " },
            { label: "duplicate", provider: "oura" },
            { label: "bad", provider: "not allowed!" },
          ],
          deviceTool,
          groupPermissionOfferTool,
          groupSharedReader,
          memberId: " member-1 ",
          resolveScheduledLinqRoute,
          userEnvKeys: [" CODEX_API_KEY ", "", " CUSTOM_KEY ", "   "],
        },
      })
    ).toEqual({
      hosted: {
        actionApprovalPort: {
          read: expect.any(Function),
          request: expect.any(Function),
        },
        createScheduledGroupTools,
        defaultTarget,
        deviceConnectProviders: [
          { label: "Oura", provider: "oura" },
        ],
        deviceTool: {
          request: expect.any(Function),
        },
        groupPermissionOfferTool: {
          request: expect.any(Function),
        },
        groupSharedReader: {
          request: expect.any(Function),
        },
        memberId: "member-1",
        resolveScheduledLinqRoute,
        userEnvKeys: ["CODEX_API_KEY", "CUSTOM_KEY"],
      },
    });
    expect(createScheduledGroupTools).not.toHaveBeenCalled();
  });

  it("preserves generated capture persistence into the hosted tool context", async () => {
    const persistGeneratedImageCapture: AssistantGeneratedImageCapturePersistence =
      async (write) => await write();
    const executionContext = normalizeAssistantExecutionContext({
      hosted: {
        memberId: "member-generated-capture",
        persistGeneratedImageCapture,
        userEnvKeys: [],
      },
    });
    const hostedToolContext = createAssistantHostedToolContext({
      executionContext: executionContext.hosted,
      messageInput: {
        prompt: "Generate a group avatar.",
        vault: "/vault",
      },
      session: createAssistantSession(),
    });
    const write = vi.fn(async () => "saved");

    expect(hostedToolContext.persistGeneratedImageCapture).toBe(
      persistGeneratedImageCapture,
    );
    await expect(
      hostedToolContext.persistGeneratedImageCapture?.(write, {
        retentionWakeAt: "2026-05-11T00:00:00.000Z",
      }),
    ).resolves.toBe("saved");
    expect(write).toHaveBeenCalledOnce();
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
      model: "gpt-5.6-terra-mini",
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
      model: "gpt-5.6-terra-mini",
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
            model: "gpt-5.6-terra",
            modelProvider: "vercel-ai-gateway",
            oss: false,
            profile: null,
            reasoningEffort: "medium",
            sandbox: "danger-full-access",
          },
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
        routeFingerprint: "route-existing",
        threadId: "provider-session-existing",
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
        assistantContractFingerprint:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        providerOptions: createProviderOptions({
          model: "gpt-5-mini",
        }),
        codexThreadId: "provider-session-existing",
        response: "Here is the summary.",
        route: createRoute({ routeId: "route-backup" }),
        session,
      }),
      providerResumeStateAction: "persist-from-provider-turn",
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
        provider: "codex-cli",
        providerOptions: expect.objectContaining({
          model: "gpt-5-mini",
        }),
        resumeState: expect.objectContaining({
          assistantContractFingerprint:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          routeFingerprint: "route-backup",
          threadId: "provider-session-existing",
        }),
        turnCount: 3,
        updatedAt: "2026-04-08T14:00:00.000Z",
      })
    );
    expect(saved.resumeState?.routeFingerprint).toBe("route-backup");
    expect(saved.resumeState?.assistantContractFingerprint).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
  });

  it("clears provider resume state when requested and only persists the assistant transcript", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T15:30:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      resumeState: {
        routeFingerprint: "route-existing",
        threadId: "provider-session-existing",
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
        codexThreadId: "provider-session-existing",
        response: "raw provider output",
        route: createRoute({ routeId: "route-notification" }),
        session,
      }),
      providerResumeStateAction: "clear",
      session,
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

  it("persists an internal no-reply completion marker when explicit no-reply clears resume", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T15:35:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      resumeState: {
        routeFingerprint: "route-existing",
        threadId: "provider-session-existing",
      },
      turnCount: 2,
    });

    const saved = await persistAssistantTurnAndSession({
      assistantTranscriptText: null,
      input: {
        prompt: "Log the medication, no need to reply.",
        vault: "/vault",
      },
      plan: createSharedPlan({
        persistUserPromptOnFailure: false,
      }),
      persistUserPromptToTranscript: false,
      providerResult: createProviderResult({
        acceptedNoReplyDeliveryContextOrdinals: [],
        codexThreadId: "provider-session-existing",
        finalAction: {
          kind: "none",
        },
        response: "",
        route: createRoute({ routeId: "route-no-reply" }),
        session,
      }),
      providerResumeStateAction: "clear",
      session,
      turnCreatedAt: "2026-04-08T15:34:00.000Z",
      turnId: "turn-finalizer-no-reply",
    });

    expect(runtimeState.transcripts.append).toHaveBeenCalledTimes(1);
    expect(runtimeState.transcripts.append).toHaveBeenCalledWith(
      session.sessionId,
      [
        expect.objectContaining({
          createdAt: "2026-04-08T15:34:00.000Z",
          kind: "status",
          text: expect.stringContaining(
            ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX
          ),
        }),
      ]
    );
    expect(runtimeState.sessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeState: null,
        turnCount: 3,
      })
    );
    expect(saved.resumeState).toBeNull();
  });

  it("persists accepted no-reply markers even when a later steered context has a visible answer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T15:45:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      resumeState: {
        routeFingerprint: "route-existing",
        threadId: "provider-session-existing",
      },
      turnCount: 2,
    });

    await persistAssistantTurnAndSession({
      assistantTranscriptText: "Visible answer for the newer input.",
      input: {
        prompt: "First input, then a later steer.",
        vault: "/vault",
      },
      plan: createSharedPlan({
        persistUserPromptOnFailure: false,
      }),
      persistUserPromptToTranscript: false,
      providerResult: createProviderResult({
        acceptedNoReplyDeliveryContextOrdinals: [0],
        codexThreadId: "provider-session-existing",
        response: "Visible answer for the newer input.",
        route: createRoute({ routeId: "route-steered-no-reply" }),
        session,
      }),
      providerResumeStateAction: "clear",
      session,
      turnCreatedAt: "2026-04-08T15:44:00.000Z",
      turnId: "turn-finalizer-steered-no-reply",
    });

    expect(runtimeState.transcripts.append).toHaveBeenCalledTimes(2);
    expect(runtimeState.transcripts.append).toHaveBeenNthCalledWith(
      1,
      session.sessionId,
      [
        {
          kind: "assistant",
          text: "Visible answer for the newer input.",
        },
      ]
    );
    expect(runtimeState.transcripts.append).toHaveBeenNthCalledWith(
      2,
      session.sessionId,
      [
        {
          createdAt: "2026-04-08T15:44:00.000Z",
          kind: "status",
          text: buildAssistantNoReplyTranscriptMarkerText({
            deliveryContextOrdinal: 0,
            turnId: "turn-finalizer-steered-no-reply",
          }),
        },
      ]
    );
  });

  it("persists exact generated completion provenance outside provider-authored transcript text", async () => {
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );
    const session = createAssistantSession({ turnCount: 2 });
    const media = {
      alt: "Generated group avatar",
      contentType: "image/png",
      filename: "generated-avatar.png",
      kind: "vault_image",
      ref: "raw/captures/2026/08/generated-avatar/generated-avatar.png",
      sha256: "a".repeat(64),
      sizeBytes: 123,
      source: "gpt-image-2",
    } as const;

    await persistAssistantTurnAndSession({
      assistantTranscriptText: "The image is ready.",
      input: {
        hostedImageCompletionEffectRestriction: {
          authorizedOriginAssistantInputId: `ain_${"1".repeat(32)}`,
          completionAssistantInputId: `ain_${"2".repeat(32)}`,
          exactMedia: [media],
        },
        prompt: "Trusted hosted image completion.",
        vault: "/vault",
      },
      plan: createSharedPlan({ persistUserPromptOnFailure: false }),
      persistUserPromptToTranscript: false,
      providerResult: createProviderResult({
        response: "The image is ready.",
        responseMedia: [media],
        session,
      }),
      providerResumeStateAction: "persist-from-provider-turn",
      session,
      turnCreatedAt: "2026-08-09T12:00:00.000Z",
      turnId: "turn-generated-avatar-completion",
    });

    expect(runtimeState.transcripts.append).toHaveBeenCalledTimes(1);
    expect(runtimeState.transcripts.append).toHaveBeenNthCalledWith(
      1,
      session.sessionId,
      [
        { kind: "assistant", text: "The image is ready." },
        expect.objectContaining({
          createdAt: "2026-08-09T12:00:00.000Z",
          kind: "status",
          text: expect.stringContaining(
            ASSISTANT_GENERATED_IMAGE_DELIVERY_TRANSCRIPT_MARKER_PREFIX
          ),
        }),
      ]
    );
    const markerEntry = runtimeState.transcripts.append.mock.calls[0]?.[1]?.[1];
    expect(markerEntry).toMatchObject({
      createdAt: "2026-08-09T12:00:00.000Z",
      kind: "status",
      text: expect.stringContaining(
        ASSISTANT_GENERATED_IMAGE_DELIVERY_TRANSCRIPT_MARKER_PREFIX
      ),
    });
    expect(
      readAssistantGeneratedImageDeliveryTranscriptMarker(
        markerEntry?.text ?? ""
      )
    ).toEqual({
      contentType: media.contentType,
      deliveryContextOrdinal: 0,
      ref: media.ref,
      sha256: media.sha256,
      sizeBytes: media.sizeBytes,
      turnId: "turn-generated-avatar-completion",
    });
    expect(runtimeState.transcripts.append.mock.calls[0]?.[1]?.[0]?.text)
      .not.toContain(media.ref);
  });

  it("persists generated provenance when a ready completion finishes without reply", async () => {
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );
    const session = createAssistantSession({ turnCount: 2 });
    const media = {
      alt: "Generated group avatar",
      contentType: "image/png",
      filename: "generated-avatar.png",
      kind: "vault_image",
      ref: "raw/captures/2026/08/generated-avatar/generated-avatar.png",
      sha256: "a".repeat(64),
      sizeBytes: 123,
      source: "gpt-image-2",
    } as const;

    const saved = await persistAssistantTurnAndSession({
      assistantTranscriptText: null,
      input: {
        hostedImageCompletionEffectRestriction: {
          authorizedOriginAssistantInputId: `ain_${"1".repeat(32)}`,
          completionAssistantInputId: `ain_${"2".repeat(32)}`,
          exactMedia: [media],
        },
        prompt: "Trusted hosted image completion.",
        vault: "/vault",
      },
      plan: createSharedPlan({ persistUserPromptOnFailure: false }),
      persistUserPromptToTranscript: false,
      providerResult: createProviderResult({
        acceptedNoReplyDeliveryContextOrdinals: [0],
        codexThreadId: "provider-session-generated-no-reply",
        finalAction: { kind: "none" },
        response: "",
        responseDeliveryContextOrdinal: 2,
        responseMedia: [],
        session,
      }),
      providerResumeStateAction: "persist-from-provider-turn",
      session,
      turnCreatedAt: "2026-08-09T12:00:00.000Z",
      turnId: "turn-generated-avatar-completion-no-reply",
    });

    const generatedMarkerEntry =
      runtimeState.transcripts.append.mock.calls[0]?.[1]?.[0];
    const generatedMarker = generatedMarkerEntry?.kind === "status"
      ? readAssistantGeneratedImageDeliveryTranscriptMarker(
          generatedMarkerEntry.text
        )
      : null;
    expect(generatedMarker).toEqual({
      contentType: media.contentType,
      deliveryContextOrdinal: 2,
      ref: media.ref,
      sha256: media.sha256,
      sizeBytes: media.sizeBytes,
      turnId: "turn-generated-avatar-completion-no-reply",
    });
    expect(resolveAssistantGeneratedImageDelivery({
      currentMedia: media,
      imageRef: media.ref,
      intents: [],
      sessionId: session.sessionId,
      transcriptEntries: [{
        schema: "murph.assistant-transcript-entry.v1",
        createdAt: "2026-08-09T12:00:00.000Z",
        kind: "status",
        text: generatedMarkerEntry?.text ?? "",
      }],
    })).toBe(false);
    expect(runtimeState.transcripts.append).toHaveBeenNthCalledWith(
      2,
      session.sessionId,
      [{
        createdAt: "2026-08-09T12:00:00.000Z",
        kind: "status",
        text: buildAssistantNoReplyTranscriptMarkerText({
          deliveryContextOrdinal: 0,
          turnId: "turn-generated-avatar-completion-no-reply",
        }),
      }]
    );
    expect(saved.resumeState).toMatchObject({
      threadId: "provider-session-generated-no-reply",
    });
  });

  it("keeps generated provenance distinct from mismatched response delivery", async () => {
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );
    const session = createAssistantSession({ turnCount: 2 });
    const expectedMedia = {
      alt: "Generated group avatar",
      contentType: "image/png",
      filename: "generated-avatar.png",
      kind: "vault_image",
      ref: "raw/captures/2026/08/generated-avatar/generated-avatar.png",
      sha256: "a".repeat(64),
      sizeBytes: 123,
      source: "gpt-image-2",
    } as const;
    const mismatchedMedia = {
      ...expectedMedia,
      ref: "raw/captures/2026/08/different-avatar/different-avatar.png",
      sha256: "b".repeat(64),
    } as const;

    await persistAssistantTurnAndSession({
      assistantTranscriptText: "The image is ready.",
      input: {
        hostedImageCompletionEffectRestriction: {
          authorizedOriginAssistantInputId: `ain_${"1".repeat(32)}`,
          completionAssistantInputId: `ain_${"2".repeat(32)}`,
          exactMedia: [expectedMedia],
        },
        prompt: "Trusted hosted image completion.",
        vault: "/vault",
      },
      plan: createSharedPlan({ persistUserPromptOnFailure: false }),
      persistUserPromptToTranscript: false,
      providerResult: createProviderResult({
        response: "The image is ready.",
        responseMedia: [mismatchedMedia],
        session,
      }),
      providerResumeStateAction: "persist-from-provider-turn",
      session,
      turnCreatedAt: "2026-08-09T12:00:00.000Z",
      turnId: "turn-generated-avatar-completion-mismatch",
    });

    expect(runtimeState.transcripts.append).toHaveBeenCalledTimes(1);
    const markerEntry = runtimeState.transcripts.append.mock.calls[0]?.[1]?.[1];
    expect(markerEntry?.kind === "status"
      ? readAssistantGeneratedImageDeliveryTranscriptMarker(markerEntry.text)
      : null).toEqual({
        contentType: expectedMedia.contentType,
        deliveryContextOrdinal: 0,
        ref: expectedMedia.ref,
        sha256: expectedMedia.sha256,
        sizeBytes: expectedMedia.sizeBytes,
        turnId: "turn-generated-avatar-completion-mismatch",
      });
    expect(resolveAssistantGeneratedImageDelivery({
      currentMedia: expectedMedia,
      imageRef: expectedMedia.ref,
      intents: [],
      sessionId: session.sessionId,
      transcriptEntries: [{
        schema: "murph.assistant-transcript-entry.v1",
        createdAt: "2026-08-09T12:00:00.000Z",
        kind: "status",
        text: markerEntry?.text ?? "",
      }],
    })).toBe(false);
  });

  it("deduplicates accepted no-reply markers within the current turn only", async () => {
    const markerText = buildAssistantNoReplyTranscriptMarkerText({
      deliveryContextOrdinal: 0,
      turnId: "turn-previous",
    });
    runtimeState.transcripts.list.mockImplementationOnce(async () => [
      {
        schema: "murph.assistant-transcript-entry.v1",
        createdAt: "2026-04-08T15:44:00.000Z",
        kind: "status",
        text: markerText,
      },
    ]);

    await persistAssistantNoReplyTranscriptMarkers({
      deliveryContextOrdinals: [0, 0],
      sessionId: "session-test",
      turnCreatedAt: "2026-04-08T15:44:00.000Z",
      turnId: "turn-current",
      vault: "/vault",
    });

    expect(runtimeState.transcripts.append).toHaveBeenCalledTimes(1);
    expect(runtimeState.transcripts.append).toHaveBeenCalledWith(
      "session-test",
      [
        {
          createdAt: "2026-04-08T15:44:00.000Z",
          kind: "status",
          text: buildAssistantNoReplyTranscriptMarkerText({
            deliveryContextOrdinal: 0,
            turnId: "turn-current",
          }),
        },
      ]
    );

    runtimeState.transcripts.list.mockImplementationOnce(async () => [
      {
        schema: "murph.assistant-transcript-entry.v1",
        createdAt: "2026-04-08T15:44:00.000Z",
        kind: "status",
        text: buildAssistantNoReplyTranscriptMarkerText({
          deliveryContextOrdinal: 0,
          turnId: "turn-current",
        }),
      },
    ]);

    await persistAssistantNoReplyTranscriptMarkers({
      deliveryContextOrdinals: [0],
      sessionId: "session-test",
      turnCreatedAt: "2026-04-08T15:44:00.000Z",
      turnId: "turn-current",
      vault: "/vault",
    });

    expect(runtimeState.transcripts.append).toHaveBeenCalledTimes(1);
  });

  it("preserves existing provider resume state for isolated provider turns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T15:45:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      providerOptions: createProviderOptions({
        model: "gpt-5.6-terra",
        modelProvider: "vercel-ai-gateway",
        reasoningEffort: "medium",
      }),
      resumeState: {
        routeFingerprint: "route-existing",
        threadId: "provider-session-stale",
      },
      turnCount: 2,
    });

    const saved = await persistAssistantTurnAndSession({
      input: {
        model: "gpt-5.6-terra-mini",
        prompt: "Reply to the inbound message.",
        reasoningEffort: "low",
        turnTrigger: "automation-auto-reply",
        vault: "/vault",
      },
      plan: createSharedPlan({
        persistUserPromptOnFailure: false,
      }),
      providerResult: createProviderResult({
        codexThreadId: "provider-session-new",
        response: "Here is the reply.",
        route: createRoute({ routeId: "route-auto-reply" }),
        session,
      }),
      providerResumeStateAction: "preserve-existing",
      session,
      turnCreatedAt: "2026-04-08T15:44:00.000Z",
      turnId: "turn-finalizer-auto-reply",
    });

    expect(runtimeState.sessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lastTurnAt: "2026-04-08T15:45:00.000Z",
        providerOptions: session.providerOptions,
        resumeState: {
          routeFingerprint: "route-existing",
          threadId: "provider-session-stale",
        },
        target: session.target,
        turnCount: 3,
        updatedAt: "2026-04-08T15:45:00.000Z",
      })
    );
    expect(saved.resumeState?.threadId).toBe("provider-session-stale");
    expect(saved.resumeState?.routeFingerprint).toBe("route-existing");
    expect(saved.providerOptions.model).toBe("gpt-5.6-terra");
    expect(saved.target.model).toBe("gpt-5.6-terra");
  });

  it("preserves existing provider resume state after active-turn fallback fork", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T15:50:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      resumeState: {
        routeFingerprint: "route-existing",
        threadId: "provider-session-existing",
      },
      turnCount: 2,
    });

    const saved = await persistAssistantTurnAndSession({
      input: {
        prompt: "Late active-turn follow-up.",
        vault: "/vault",
      },
      plan: createSharedPlan({
        persistUserPromptOnFailure: false,
      }),
      providerResult: createProviderResult({
        codexThreadId: "provider-session-new",
        response: "Here is the revised answer.",
        route: createRoute({ routeId: "route-active-continuation" }),
        session,
      }),
      providerResumeStateAction: "preserve-existing",
      session,
      turnCreatedAt: "2026-04-08T15:49:00.000Z",
      turnId: "turn-finalizer-active-continuation",
    });

    expect(runtimeState.sessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lastTurnAt: "2026-04-08T15:50:00.000Z",
        resumeState: {
          routeFingerprint: "route-existing",
          threadId: "provider-session-existing",
        },
        turnCount: 3,
        updatedAt: "2026-04-08T15:50:00.000Z",
      })
    );
    expect(saved.resumeState?.threadId).toBe(
      "provider-session-existing"
    );
    expect(saved.resumeState?.routeFingerprint).toBe("route-existing");
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
              command: "vault-cli experiment start",
            },
            mode: "apply",
            tool: "vault.cli.run",
            type: "assistant.tool.succeeded",
          },
        ],
        route: createRoute({ routeId: "route-tool-audit" }),
        session,
      }),
      providerResumeStateAction: "persist-from-provider-turn",
      session,
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

  it("persists pre-steer final answers before the final assistant entry in one transcript append", async () => {
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      turnCount: 2,
    });

    await persistAssistantTurnAndSession({
      assistantTranscriptText: "Final answer.",
      input: {
        prompt: "First question",
        vault: "/vault",
      },
      plan: createSharedPlan({
        persistUserPromptOnFailure: false,
      }),
      persistUserPromptToTranscript: false,
      precedingAssistantTranscriptTexts: ["Answer one.", "Answer two."],
      providerResult: createProviderResult({
        response: "Final answer.",
        route: createRoute({ routeId: "route-steered-finals" }),
        session,
      }),
      providerResumeStateAction: "persist-from-provider-turn",
      session,
      turnCreatedAt: "2026-04-08T15:44:00.000Z",
      turnId: "turn-finalizer-steered-finals",
    });

    expect(runtimeState.transcripts.append).toHaveBeenCalledTimes(1);
    expect(runtimeState.transcripts.append).toHaveBeenCalledWith(
      session.sessionId,
      [
        {
          kind: "assistant",
          text: "Answer one.",
        },
        {
          kind: "assistant",
          text: "Answer two.",
        },
        {
          kind: "assistant",
          text: "Final answer.",
        },
      ]
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
        routeFingerprint: "route-old",
        threadId: "provider-session-old",
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
        codexThreadId: "provider-session-new",
        route: createRoute({ routeId: "route-new" }),
        session,
      }),
      providerResumeStateAction: "persist-from-provider-turn",
      session,
      turnCreatedAt: "2026-04-08T14:59:00.000Z",
      turnId: "turn-finalizer-2",
    });

    expect(runtimeState.turns.appendEvent).not.toHaveBeenCalled();
    expect(runtimeState.transcripts.append).toHaveBeenCalledTimes(1);
    expect(saved.resumeState?.threadId).toBe("provider-session-new");
    expect(saved.resumeState?.routeFingerprint).toBe("route-new");
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
        codexThreadId: "provider-session-fallback",
        route: createRoute({ routeId: "route-fallback" }),
        session,
      }),
      providerResumeStateAction: "persist-from-provider-turn",
      session,
      turnCreatedAt: "2026-04-08T15:59:00.000Z",
      turnId: "turn-finalizer-fallback",
    });

    expect(saved.target).toEqual(session.target);
    expect(saved.provider).toBe("codex-cli");
  });

  it("keeps automation target overrides out of durable session targets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T16:05:00.000Z"));
    runtimeState.sessions.save.mockImplementation(
      async (session: AssistantSession) => session
    );

    const session = createAssistantSession({
      providerOptions: createProviderOptions({
        model: "gpt-5.6-terra",
        modelProvider: "vercel-ai-gateway",
        reasoningEffort: "low",
      }),
      resumeState: {
        routeFingerprint: "route-low",
        threadId: "provider-session-low",
      },
    });

    const saved = await persistAssistantTurnAndSession({
      input: {
        assistantTargetOverride: {
          reasoningEffort: "high",
        },
        prompt: "Run the high-effort automation turn.",
        turnTrigger: "automation-cron",
        vault: "/vault",
      },
      plan: createSharedPlan(),
      providerResult: createProviderResult({
        codexThreadId: "provider-session-high",
        route: createRoute({
          providerOptions: createProviderOptions({
            model: "gpt-5.6-terra",
            modelProvider: "vercel-ai-gateway",
            reasoningEffort: "high",
          }),
          routeId: "route-high",
        }),
        session,
      }),
      providerResumeStateAction: "persist-from-provider-turn",
      session,
      turnCreatedAt: "2026-04-08T16:04:00.000Z",
      turnId: "turn-finalizer-turn-scoped-provider",
    });

    expect(saved.target).toEqual(session.target);
    expect(saved.providerOptions).toEqual(session.providerOptions);
    expect(saved.resumeState).toBeNull();
    expect(saved.codexResume).toBeNull();
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
      append: vi.fn(async (
        _sessionId: string,
        _entries: readonly AssistantTranscriptEntryInput[]
      ) => [] as AssistantTranscriptEntry[]),
      list: vi.fn(async () => [] as AssistantTranscriptEntry[]),
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
    model: "gpt-5.6-terra",
    modelProvider: "vercel-ai-gateway",
    reasoningEffort: "medium",
    sandbox: "danger-full-access",
    ...overrides,
  });
}

function createRoute(input?: {
  provider?: CodexThreadIdentity["provider"];
  providerOptions?: Partial<AssistantProviderSessionOptions>;
  routeId?: string;
}): CodexThreadIdentity {
  return {
    codexCommand: null,
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
    codexResume: input?.resumeState ?? null,
    codexTarget: target,
    conversationId: input?.sessionId ?? "session-test",
    createdAt: "2026-04-08T00:00:00.000Z",
    lastTurnAt: null,
    provider: "codex-cli",
    providerOptions,
    resumeState: input?.resumeState ?? null,
    schema: "murph.assistant-conversation.v2",
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
    cliAccess: {
      env: {},
      rawCommand: "vault-cli" as const,
      setupCommand: "murph",
    },
    conversationPolicy: {
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
  acceptedNoReplyDeliveryContextOrdinals?: readonly number[] | null;
  assistantContractFingerprint?: string;
  attemptCount?: number;
  providerOptions?: AssistantProviderSessionOptions;
  codexThreadId?: string | null;
  finalAction?: AssistantNoReplyDisposition;
  rawEvents?: unknown[];
  response?: string;
  responseDeliveryContextOrdinal?: number;
  responseMedia?: readonly AssistantResponseMedia[] | null;
  route?: CodexThreadIdentity;
  session?: AssistantSession;
  usage?: Partial<AssistantProviderUsage> | null;
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
    assistantContractFingerprint:
      input?.assistantContractFingerprint ??
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    attemptCount: input?.attemptCount ?? 1,
    provider: "codex-cli",
    codexContinuation: {
      kind: "explicit-structured-history",
    },
    providerOptions: input?.providerOptions ?? createProviderOptions(),
    codexThreadId: input?.codexThreadId ?? "provider-session-1",
    ...(input?.acceptedNoReplyDeliveryContextOrdinals
      ? {
          acceptedNoReplyDeliveryContextOrdinals:
            input.acceptedNoReplyDeliveryContextOrdinals,
        }
      : {}),
    ...(input?.finalAction ? { finalAction: input.finalAction } : {}),
    rawEvents: input?.rawEvents ?? [],
    response: input?.response ?? "provider response",
    responseDeliveryContextOrdinal: input?.responseDeliveryContextOrdinal ?? 0,
    responseMedia: input?.responseMedia ?? [],
    route: input?.route ?? createRoute(),
    session,
    stderr: "",
    stdout: "",
    transcriptResponse: input?.finalAction?.kind === "none"
      ? null
      : input?.response ?? "provider response",
    usage:
      input?.usage === undefined
        ? defaultUsage
        : input.usage === null
          ? null
          : { ...defaultUsage, ...input.usage },
    workingDirectory: "/tmp/assistant-service-runtime",
  };
}
