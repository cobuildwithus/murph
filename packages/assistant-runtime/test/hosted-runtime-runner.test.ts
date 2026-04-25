import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_AI_USAGE_BILLING_MODE_ENV,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionRuntimeTimerWake,
  buildHostedExecutionTelegramConversationMessageWake,
  type HostedIngressEnvelope,
} from "@murphai/hosted-execution";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";
import type {
  HostedCommittedExecutionState,
  HostedAssistantRuntimeJobResult,
} from "../src/hosted-runtime/models.ts";

const HOSTED_RUN_CONTEXT = {
  attempt: 1,
  runId: "run_123",
  startedAt: "2026-04-08T00:00:00.000Z",
} as const;

function buildMemberActivatedWake(eventId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId,
    memberChannels: {
      email: false,
      linq: false,
      telegram: false,
    },
    memberId: "member_123",
    occurredAt: "2026-04-08T00:00:00.000Z",
  });
}

function buildSystemIngressWake(eventId: string) {
  return buildHostedExecutionDeviceSyncWake({
    eventId,
    occurredAt: "2026-04-08T00:00:00.000Z",
    reason: "connected",
    userId: "member_123",
  });
}

function buildRuntimeTimerWake(
  eventId: string,
  triggerKind: "manual_repair" | "retry_finalize" | "runtime_timer" = "runtime_timer",
) {
  return buildHostedExecutionRuntimeTimerWake({
    eventId,
    occurredAt: "2026-04-08T00:00:00.000Z",
    triggerKind,
    userId: "member_123",
  });
}

function buildLinqWake(eventId: string) {
  return buildHostedExecutionLinqConversationMessageWake({
    eventId,
    linqMessage: {
      chatId: "chat_123",
      from: "+15551234567",
      isFromMe: false,
      messageId: "msg_123",
      parts: [],
    },
    occurredAt: "2026-04-08T00:00:00.000Z",
    phoneLookupKey: "phone_123",
    userId: "member_123",
  });
}

function buildTelegramWake(eventId: string) {
  return buildHostedExecutionTelegramConversationMessageWake({
    eventId,
    occurredAt: "2026-04-08T00:00:00.000Z",
    telegramMessage: {
      messageId: "telegram_message_123",
      schema: "murph.hosted-telegram-message.v1",
      threadId: "telegram_thread_123",
    },
    userId: "member_123",
  });
}

function createSingleWakeRunDrain(
  wake: HostedIngressEnvelope,
  overrides: {
    resumeFinalize?: boolean;
    runId?: string;
    triggerKind?: "external_ingress" | "manual_repair" | "retry_finalize" | "runtime_timer";
  } = {},
) {
  return {
    acquiredAt: "2026-04-08T00:00:00.000Z",
    events: [
      {
        seq: "24",
        wake,
        ingressEventId: `wake_${wake.eventId}`,
      },
    ],
    inputCommittedSeq: "24",
    inputCursorVersion: "4",
    ...(overrides.resumeFinalize === undefined
      ? {}
      : { resumeFinalize: overrides.resumeFinalize }),
    runId: overrides.runId ?? HOSTED_RUN_CONTEXT.runId,
    triggerKind: overrides.triggerKind ?? "external_ingress",
    userId: wake.userId,
  };
}

const mocks = vi.hoisted(() => ({
  completeHostedRunDrainAfterCommit: vi.fn(),
  createHostedArtifactResolver: vi.fn(),
  decodeHostedBundleBase64: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  executeHostedRunDrainForCommit: vi.fn(),
  getAssistantChannelAdapter: vi.fn(),
  materializeHostedExecutionArtifacts: vi.fn(),
  normalizeHostedAssistantRuntimeConfig: vi.fn(),
  restoreHostedExecutionContext: vi.fn(),
  startLinqChatTypingIndicator: vi.fn(),
  startLinqTypingIndicator: vi.fn(),
  startTelegramTypingIndicator: vi.fn(),
  stopLinqChatTypingIndicator: vi.fn(),
  withHostedProcessEnvironment: vi.fn(),
}));

vi.mock("@murphai/runtime-state/node", async () => {
  const actual = await vi.importActual<typeof import("@murphai/runtime-state/node")>(
    "@murphai/runtime-state/node",
  );
  return {
    ...actual,
    decodeHostedBundleBase64: mocks.decodeHostedBundleBase64,
    materializeHostedExecutionArtifacts: mocks.materializeHostedExecutionArtifacts,
    restoreHostedExecutionContext: mocks.restoreHostedExecutionContext,
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

vi.mock("@murphai/operator-config/linq-runtime", () => ({
  startLinqChatTypingIndicator: mocks.startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator: mocks.stopLinqChatTypingIndicator,
}));

vi.mock("@murphai/assistant-engine/assistant-channel-adapters", () => ({
  getAssistantChannelAdapter: mocks.getAssistantChannelAdapter,
  startLinqTypingIndicator: mocks.startLinqTypingIndicator,
  startTelegramTypingIndicator: mocks.startTelegramTypingIndicator,
}));

vi.mock("../src/hosted-runtime/artifacts.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/hosted-runtime/artifacts.ts")>(
    "../src/hosted-runtime/artifacts.ts",
  );
  return {
    ...actual,
    createHostedArtifactResolver: mocks.createHostedArtifactResolver,
  };
});

vi.mock("../src/hosted-runtime/environment.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/hosted-runtime/environment.ts")>(
    "../src/hosted-runtime/environment.ts",
  );
  return {
    ...actual,
    normalizeHostedAssistantRuntimeConfig: mocks.normalizeHostedAssistantRuntimeConfig,
    withHostedProcessEnvironment: mocks.withHostedProcessEnvironment,
  };
});

vi.mock("../src/hosted-runtime/execution.ts", () => ({
  completeHostedRunDrainAfterCommit: mocks.completeHostedRunDrainAfterCommit,
  executeHostedRunDrainForCommit: mocks.executeHostedRunDrainForCommit,
}));

import {
  formatHostedRuntimeChildResult,
  parseHostedRuntimeChildResult,
  runHostedAssistantRuntimeJobInProcess,
  runHostedAssistantRuntimeJobInProcessDetailed,
} from "../src/hosted-runtime.ts";
import {
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";

const incomingBundle = Uint8Array.from([1, 2, 3]);
const originalFetch = globalThis.fetch;
const deliveryEffects = [
  {
    effectId: "intent_123",
    fingerprint: "dedupe_123",
    kind: "assistant.delivery" as const,
    payload: {
      actorId: "actor_123",
      bindingDeliveryKind: "participant" as const,
      bindingDeliveryTarget: "chat_123",
      channel: "telegram",
      explicitTarget: null,
      idempotencyKey: "assistant-outbox:intent_123",
      identityId: "identity_123",
      message: "hello from hosted",
      subject: null,
      replyToMessageId: null,
      sessionId: "session_123",
      threadId: "thread_123",
      threadIsDirect: true,
      transportIdempotent: false,
      turnId: "turn_123",
    },
  },
];
const committedExecution: HostedCommittedExecutionState = {
  committedGatewayProjectionSnapshot: {
    schema: "murph.gateway-projection-snapshot.v1",
    generatedAt: "2026-04-08T00:00:00.000Z",
    conversations: [],
    messages: [],
    permissions: [],
  },
  committedResult: {
    bundle: "committed-bundle",
    result: {
      eventsHandled: 1,
      nextWakeAt: null,
      summary: "committed summary",
    },
  },
  committedAssistantDeliveryEffects: deliveryEffects,
};
const finalResult: HostedAssistantRuntimeJobResult = {
  finalGatewayProjectionSnapshot: {
    schema: "murph.gateway-projection-snapshot.v1",
    generatedAt: "2026-04-08T00:05:00.000Z",
    conversations: [],
    messages: [],
    permissions: [],
  },
  phase: "completed",
  result: {
    bundle: "final-bundle",
    result: {
      eventsHandled: 1,
      nextWakeAt: null,
      summary: "final summary",
    },
  },
};
const committedFirstPassResult: HostedAssistantRuntimeJobResult = {
  committedAssistantDeliveryEffects: committedExecution.committedAssistantDeliveryEffects,
  committedGatewayProjectionSnapshot: committedExecution.committedGatewayProjectionSnapshot,
  phase: "prepared",
  result: committedExecution.committedResult,
};

function restoreFetch() {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
    writable: true,
  });
}

afterEach(() => {
  restoreFetch();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createHostedArtifactResolver.mockReturnValue(Symbol("artifact-resolver"));
  mocks.decodeHostedBundleBase64.mockReturnValue(incomingBundle);
  mocks.normalizeHostedAssistantRuntimeConfig.mockImplementation((runtime, platform) => ({
    commitTimeoutMs: runtime?.commitTimeoutMs ?? null,
    forwardedEnv: { ...(runtime?.forwardedEnv ?? {}) },
    platform,
    platformEnv: { ...(runtime?.platformEnv ?? {}) },
    resolvedConfig: createHostedRuntimeResolvedConfig(runtime?.resolvedConfig ?? {}),
    userEnv: { ...(runtime?.userEnv ?? {}) },
  }));
  mocks.restoreHostedExecutionContext.mockResolvedValue({
    assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
    operatorHomeRoot: "/tmp/operator-home",
    vaultRoot: "/tmp/vault-root",
  });
  mocks.withHostedProcessEnvironment.mockImplementation(
    async (
      _input: unknown,
      callback: () => Promise<unknown>,
    ) => callback(),
  );
  mocks.executeHostedRunDrainForCommit.mockResolvedValue(committedExecution);
  mocks.completeHostedRunDrainAfterCommit.mockResolvedValue(finalResult);
  mocks.materializeHostedExecutionArtifacts.mockResolvedValue(undefined);
  mocks.startLinqChatTypingIndicator.mockResolvedValue(undefined);
  mocks.startLinqTypingIndicator.mockResolvedValue({
    stop: vi.fn(async () => {}),
  });
  mocks.startTelegramTypingIndicator.mockResolvedValue({
    stop: vi.fn(async () => {}),
  });
  mocks.stopLinqChatTypingIndicator.mockResolvedValue(undefined);
  mocks.getAssistantChannelAdapter.mockImplementation((channel: string | null | undefined) => {
    if (channel === "linq") {
      return {
        channel: "linq",
        async startTypingIndicator(
          input: { explicitTarget: string | null },
          dependencies: { startLinqTyping?: (input: { target: string }) => Promise<unknown> },
        ) {
          if (!input.explicitTarget) {
            return null;
          }
          return (await dependencies.startLinqTyping?.({
            target: input.explicitTarget,
          })) ?? null;
        },
      };
    }

    if (channel === "telegram") {
      return {
        channel: "telegram",
        async startTypingIndicator(
          input: { explicitTarget: string | null },
          dependencies: { startTelegramTyping?: (input: { target: string }) => Promise<unknown> },
        ) {
          if (!input.explicitTarget) {
            return null;
          }
          return (await dependencies.startTelegramTyping?.({
            target: input.explicitTarget,
          })) ?? null;
        },
      };
    }

    if (channel === "email") {
      return {
        channel: "email",
      };
    }

    return null;
  });
  restoreFetch();
});

describe("hosted runtime child payload helpers", () => {
  it("formats and parses the final child payload line", () => {
    const payload = {
      ok: true,
      result: finalResult,
    };

    const output = [
      "child stdout",
      formatHostedRuntimeChildResult({
        ok: false,
        error: {
          message: "stale result",
        },
      }),
      formatHostedRuntimeChildResult(payload),
    ].join("\n");

    assert.deepEqual(parseHostedRuntimeChildResult(output), payload);
  });

  it("fails closed when the child never emits a payload line", () => {
    assert.throws(
      () => parseHostedRuntimeChildResult("child stdout only"),
      /did not emit a result payload/u,
    );
  });
});

describe("runHostedAssistantRuntimeJobInProcessDetailed", () => {
  it("returns the committed first-pass result, materializes requested artifacts once, and defers resume-only finalization", async () => {
    const deviceSyncPort = {
      applyUpdates: vi.fn(),
      createConnectLink: vi.fn(async ({ provider }: { provider: string }) => ({
        authorizationUrl: `https://connect.example.test/${provider}`,
        expiresAt: "2026-04-08T00:30:00.000Z",
        provider,
        providerLabel: provider.toUpperCase(),
      })),
      fetchSnapshot: vi.fn(),
    };

    mocks.executeHostedRunDrainForCommit.mockImplementation(async (input) => {
      expect(input.executionContext.hosted.deviceConnectProviders).toEqual([
        { label: "Oura", provider: "oura" },
      ]);
      await input.executionContext.hosted.issueDeviceConnectLink({
        provider: "oura",
      });
      await input.artifactMaterializer?.([
        "vault/raw/a.bin",
        "vault/raw/a.bin",
        "vault/raw/b.bin",
      ]);
      return committedExecution;
    });

    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          currentBundleRef: {
            hash: "hash_123",
            key: "bundles/member/vault.json",
            size: 42,
            updatedAt: "2026-04-08T00:00:00.000Z",
          },
          runDrain: createSingleWakeRunDrain(buildMemberActivatedWake("evt_123")),
          run: HOSTED_RUN_CONTEXT,
        },
        runtime: {
          commitTimeoutMs: 45_000,
          forwardedEnv: {
            OPENAI_API_KEY: "secret",
          },
          resolvedConfig: createHostedRuntimeResolvedConfig({
            deviceSync: {
              providerConfigs: {
                oura: {
                  clientId: "oura-client",
                  clientSecret: "oura-secret",
                  scopes: ["daily", "sleep"],
                },
              },
              publicBaseUrl: "https://device-sync.example.test",
              secret: "secret_123",
            },
          }),
          userEnv: {},
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          deviceSyncPort,
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, committedFirstPassResult);
    expect(deviceSyncPort.createConnectLink).toHaveBeenCalledWith({
      provider: "oura",
    });
    expect(mocks.executeHostedRunDrainForCommit).toHaveBeenCalledTimes(1);
    expect(mocks.withHostedProcessEnvironment).toHaveBeenCalledWith(
      {
        envOverrides: {
          OPENAI_API_KEY: "secret",
        },
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      expect.any(Function),
    );
    expect(mocks.materializeHostedExecutionArtifacts).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          channelCapabilities: {
            emailSendReady: true,
            telegramBotConfigured: true,
          },
          commitTimeoutMs: 45_000,
          currentBundleRefPresent: true,
          forwardedEnvCategories: expect.objectContaining({
            assistantConfigured: true,
            hostedEmailConfigured: false,
            linqConfigured: false,
            parserToolingConfigured: false,
            telegramConfigured: false,
            webSearchConfigured: false,
          }),
          forwardedEnvKeyCount: 1,
          platformBindings: expect.objectContaining({
            artifactStoreBound: true,
            effectsPortBound: true,
            usageExportBound: false,
          }),
          runElapsedMs: expect.any(Number),
          userEnvCategories: {
            modelCredentialConfigured: false,
          },
          userEnvKeyCount: 0,
        }),
        message: "Hosted runtime starting.",
        phase: "runtime.starting",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          bundlePresent: true,
          restoreLatencyMs: expect.any(Number),
          runElapsedMs: expect.any(Number),
        }),
        message: "Hosted runtime restored execution context.",
        phase: "runtime.starting",
      }),
    );
    expect(
      mocks.materializeHostedExecutionArtifacts.mock.calls[0]?.[0].shouldRestoreArtifact({
        path: "raw/a.bin",
        root: "vault",
      }),
    ).toBe(true);
    expect(
      mocks.materializeHostedExecutionArtifacts.mock.calls[0]?.[0].shouldRestoreArtifact({
        path: "raw/c.bin",
        root: "vault",
      }),
    ).toBe(false);
    expect(
      mocks.materializeHostedExecutionArtifacts.mock.calls[0]?.[0].shouldRestoreArtifact({
        path: "raw/a.bin",
        root: "operator-home",
      }),
    ).toBe(false);
    expect(
      mocks.restoreHostedExecutionContext.mock.calls[0]?.[0].shouldRestoreArtifact({
        path: "raw/a.bin",
        root: "vault",
      }),
    ).toBe(false);
  });

  it("preserves null committed projections and logs minimal start details when device sync is absent", async () => {
    mocks.executeHostedRunDrainForCommit.mockResolvedValueOnce({
      ...committedExecution,
      committedGatewayProjectionSnapshot: null,
    });
    mocks.normalizeHostedAssistantRuntimeConfig.mockReturnValueOnce({
      commitTimeoutMs: null,
      forwardedEnv: {},
      platform: {
        artifactStore: null as never,
        effectsPort: null as never,
        usageExportPort: null,
      },
      resolvedConfig: createHostedRuntimeResolvedConfig({
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      }),
      userEnv: {},
    });

    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: createSingleWakeRunDrain(buildSystemIngressWake("evt_minimal_start")),
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, {
      committedAssistantDeliveryEffects: deliveryEffects,
      committedGatewayProjectionSnapshot: null,
      phase: "prepared",
      result: committedExecution.committedResult,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          channelCapabilities: {
            emailSendReady: false,
            telegramBotConfigured: false,
          },
          commitTimeoutMs: null,
          currentBundleRefPresent: false,
          deviceSync: expect.objectContaining({
            configured: false,
            providerNames: [],
            publicBaseUrlConfigured: false,
            secretConfigured: false,
          }),
          forwardedEnvCategories: expect.objectContaining({
            assistantConfigured: false,
            hostedEmailConfigured: false,
            linqConfigured: false,
            parserToolingConfigured: false,
            telegramConfigured: false,
            webSearchConfigured: false,
          }),
          forwardedEnvKeyCount: 0,
          platformBindings: expect.objectContaining({
            artifactStoreBound: false,
            effectsPortBound: false,
            usageExportBound: false,
          }),
          userEnvCategories: {
            modelCredentialConfigured: false,
          },
          userEnvKeyCount: 0,
        }),
        message: "Hosted runtime starting.",
        phase: "runtime.starting",
      }),
    );
  });

  it.each([
    {
      expectedMessagingReturnTarget: "imessage",
      label: "Linq/iMessage",
      wake: buildLinqWake("evt_linq_device_connect"),
    },
    {
      expectedMessagingReturnTarget: "telegram",
      label: "Telegram",
      wake: buildTelegramWake("evt_telegram_device_connect"),
    },
  ] as const)(
    "passes a $label messaging return target when issuing hosted device links from chat wakes",
    async ({ expectedMessagingReturnTarget, wake }) => {
      const deviceSyncPort = {
        applyUpdates: vi.fn(),
        createConnectLink: vi.fn(async ({
          provider,
        }: {
          messagingReturnTarget?: "imessage" | "telegram" | null;
          provider: string;
        }) => ({
          authorizationUrl: `https://connect.example.test/${provider}`,
          expiresAt: "2026-04-08T00:30:00.000Z",
          provider,
          providerLabel: provider.toUpperCase(),
        })),
        fetchSnapshot: vi.fn(),
      };

      mocks.executeHostedRunDrainForCommit.mockImplementationOnce(async (input) => {
        await input.executionContext.hosted.issueDeviceConnectLink({
          provider: "whoop",
        });
        return committedExecution;
      });

      await runHostedAssistantRuntimeJobInProcessDetailed(
        {
          request: {
            bundle: "incoming-bundle",
            run: HOSTED_RUN_CONTEXT,
            runDrain: createSingleWakeRunDrain(wake),
          },
          runtime: {
            resolvedConfig: createHostedRuntimeResolvedConfig({
              deviceSync: {
                providerConfigs: {
                  whoop: {
                    clientId: "whoop-client",
                    clientSecret: "whoop-secret",
                  },
                },
                publicBaseUrl: "https://device-sync.example.test",
                secret: "secret_123",
              },
            }),
          },
        },
        {
          platform: {
            artifactStore: {
              async get() {
                return null;
              },
              async put() {},
            },
            deviceSyncPort,
            effectsPort: createHostedRuntimeEffectsPortStub(),
          },
        },
      );

      expect(deviceSyncPort.createConnectLink).toHaveBeenCalledWith({
        messagingReturnTarget: expectedMessagingReturnTarget,
        provider: "whoop",
      });
    },
  );

  it("rejects unconfigured hosted device-link providers before the control-plane call", async () => {
    const deviceSyncPort = {
      applyUpdates: vi.fn(),
      createConnectLink: vi.fn(async ({ provider }: { provider: string }) => ({
        authorizationUrl: `https://connect.example.test/${provider}`,
        expiresAt: "2026-04-08T00:30:00.000Z",
        provider,
        providerLabel: provider.toUpperCase(),
      })),
      fetchSnapshot: vi.fn(),
    };

    mocks.executeHostedRunDrainForCommit.mockImplementationOnce(async (input) => {
      await input.executionContext.hosted.issueDeviceConnectLink({
        provider: "ottoai",
      });
      return committedExecution;
    });

    await expect(
      runHostedAssistantRuntimeJobInProcessDetailed(
        {
          request: {
            bundle: "incoming-bundle",
            run: HOSTED_RUN_CONTEXT,
            runDrain: createSingleWakeRunDrain(buildMemberActivatedWake("evt_bad_provider")),
          },
          runtime: {
            resolvedConfig: createHostedRuntimeResolvedConfig({
              deviceSync: {
                providerConfigs: {
                  oura: {
                    clientId: "oura-client",
                    clientSecret: "oura-secret",
                  },
                },
                publicBaseUrl: "https://device-sync.example.test",
                secret: "secret_123",
              },
            }),
          },
        },
        {
          platform: {
            artifactStore: {
              async get() {
                return null;
              },
              async put() {},
            },
            deviceSyncPort,
            effectsPort: createHostedRuntimeEffectsPortStub(),
          },
        },
      ),
    ).rejects.toThrow(/not configured in this hosted environment/u);

    expect(deviceSyncPort.createConnectLink).not.toHaveBeenCalled();
  });

  it("passes the delegated billing Stripe customer id into the hosted execution context for platform-funded Vercel AI Gateway runs", async () => {
    const billingPort = {
      resolveVercelAiGatewayStripeCustomerId: vi.fn(async () => ({
        stripeCustomerId: "cus_platform_123",
      })),
    };
    mocks.executeHostedRunDrainForCommit.mockImplementationOnce(async (input) => {
      expect(input.executionContext.hosted?.stripeCustomerId).toBe("cus_platform_123");
      return committedExecution;
    });

    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: createSingleWakeRunDrain(buildMemberActivatedWake("evt_billing_platform")),
        },
        runtime: {
          forwardedEnv: {
            [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "stripe_meter",
            HOSTED_ASSISTANT_BASE_URL: "https://ai-gateway.vercel.sh/v1",
            HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
            HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: "rk_test_123",
            HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: "true",
          },
          userEnv: {},
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          billingPort,
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, committedFirstPassResult);
    expect(billingPort.resolveVercelAiGatewayStripeCustomerId).toHaveBeenCalledTimes(1);
  });

  it("skips delegated billing lookup when hosted AI usage billing mode is disabled", async () => {
    const billingPort = {
      resolveVercelAiGatewayStripeCustomerId: vi.fn(async () => ({
        stripeCustomerId: "cus_platform_123",
      })),
    };
    mocks.executeHostedRunDrainForCommit.mockImplementationOnce(async (input) => {
      expect(input.executionContext.hosted?.stripeCustomerId).toBeNull();
      return committedExecution;
    });

    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: createSingleWakeRunDrain(buildMemberActivatedWake("evt_billing_disabled")),
        },
        runtime: {
          forwardedEnv: {
            [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "disabled",
            HOSTED_ASSISTANT_BASE_URL: "https://ai-gateway.vercel.sh/v1",
            HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
            HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: "rk_test_123",
            HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: "true",
          },
          userEnv: {},
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          billingPort,
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, committedFirstPassResult);
    expect(billingPort.resolveVercelAiGatewayStripeCustomerId).not.toHaveBeenCalled();
  });

  it("skips delegated billing lookup for member-funded Vercel AI Gateway runs", async () => {
    const billingPort = {
      resolveVercelAiGatewayStripeCustomerId: vi.fn(async () => ({
        stripeCustomerId: "cus_platform_123",
      })),
    };
    mocks.executeHostedRunDrainForCommit.mockImplementationOnce(async (input) => {
      expect(input.executionContext.hosted?.stripeCustomerId).toBeNull();
      return committedExecution;
    });

    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: createSingleWakeRunDrain(buildMemberActivatedWake("evt_billing_member")),
        },
        runtime: {
          forwardedEnv: {
            [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "stripe_meter",
            HOSTED_ASSISTANT_API_KEY_ENV: "VERCEL_AI_API_KEY",
            HOSTED_ASSISTANT_BASE_URL: "https://ai-gateway.vercel.sh/v1",
            HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
            HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: "rk_test_123",
            HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: "true",
          },
          userEnv: {
            VERCEL_AI_API_KEY: "member-key",
          },
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          billingPort,
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, committedFirstPassResult);
    expect(billingPort.resolveVercelAiGatewayStripeCustomerId).not.toHaveBeenCalled();
  });

  it("treats blank delegated billing API-key overrides as platform-funded Vercel AI Gateway runs", async () => {
    const billingPort = {
      resolveVercelAiGatewayStripeCustomerId: vi.fn(async () => ({
        stripeCustomerId: "cus_platform_123",
      })),
    };
    mocks.executeHostedRunDrainForCommit.mockImplementationOnce(async (input) => {
      expect(input.executionContext.hosted?.stripeCustomerId).toBe("cus_platform_123");
      return committedExecution;
    });

    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: createSingleWakeRunDrain(buildMemberActivatedWake("evt_billing_blank_override")),
        },
        runtime: {
          forwardedEnv: {
            [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "stripe_meter",
            HOSTED_ASSISTANT_API_KEY_ENV: "VERCEL_AI_API_KEY",
            HOSTED_ASSISTANT_BASE_URL: "https://ai-gateway.vercel.sh/v1",
            HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
            HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: "rk_test_123",
            HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: "true",
          },
          userEnv: {
            VERCEL_AI_API_KEY: "   ",
          },
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          billingPort,
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, committedFirstPassResult);
    expect(billingPort.resolveVercelAiGatewayStripeCustomerId).toHaveBeenCalledTimes(1);
  });

  it("still emits a failure log when runtime normalization fails before startup telemetry can be recorded", async () => {
    mocks.normalizeHostedAssistantRuntimeConfig.mockImplementationOnce(() => {
      throw new Error("missing hosted runtime config");
    });

    await expect(
      runHostedAssistantRuntimeJobInProcessDetailed(
        {
          request: {
            bundle: "incoming-bundle",
            run: HOSTED_RUN_CONTEXT,
            runDrain: createSingleWakeRunDrain(
              buildSystemIngressWake("evt_runtime_normalization_failure"),
            ),
          },
        },
        {
          platform: {
            artifactStore: {
              async get() {
                return null;
              },
              async put() {},
            },
            effectsPort: createHostedRuntimeEffectsPortStub(),
          },
        },
      ),
    ).rejects.toThrow(/missing hosted runtime config/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        message: "Hosted runtime failed.",
        phase: "failed",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "runtime.starting",
      }),
    );
  });

  it("logs configured device-sync details and finalizes correctly for run-drain requests", async () => {
    mocks.normalizeHostedAssistantRuntimeConfig.mockReturnValueOnce({
      commitTimeoutMs: 45_000,
      forwardedEnv: {},
      platform: {
        artifactStore: null as never,
        deviceSyncPort: {
          applyUpdates: vi.fn(),
          createConnectLink: vi.fn(),
          fetchSnapshot: vi.fn(),
        },
        effectsPort: null as never,
        usageExportPort: null,
      },
      resolvedConfig: createHostedRuntimeResolvedConfig({
        deviceSync: {
          providerConfigs: {
            oura: {
              clientId: "oura-client",
              clientSecret: "oura-secret",
              scopes: ["daily", "sleep"],
            } as never,
          },
          publicBaseUrl: "https://device-sync.example.test",
          secret: "secret_123",
        },
      }),
      userEnv: {},
    });

    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: {
            attempt: 1,
            runId: "run_123",
            startedAt: "2026-04-08T00:00:00.000Z",
          },
          runDrain: {
            acquiredAt: "2026-04-08T00:00:00.000Z",
            events: [],
            inputCommittedSeq: "24",
            inputCursorVersion: "4",
            resumeFinalize: true,
            runId: "run_123",
            triggerKind: "runtime_timer",
            userId: "member_123",
          },
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, finalResult);
    expect(mocks.completeHostedRunDrainAfterCommit).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          deviceSync: {
            configured: true,
            controlPortBound: true,
            providerNames: ["oura"],
            publicBaseUrlConfigured: true,
            secretConfigured: true,
          },
          runElapsedMs: expect.any(Number),
        }),
        message: "Hosted runtime starting.",
        phase: "runtime.starting",
        run: expect.objectContaining({
          attempt: 1,
          runId: "run_123",
          startedAt: "2026-04-08T00:00:00.000Z",
        }),
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          runElapsedMs: expect.any(Number),
        }),
        message: "Hosted runtime completed run-drain finalization.",
        phase: "completed",
        run: expect.objectContaining({
          attempt: 1,
          runId: "run_123",
          startedAt: "2026-04-08T00:00:00.000Z",
        }),
      }),
    );
    expect(mocks.stopLinqChatTypingIndicator).not.toHaveBeenCalled();
  });

  it("skips delegated billing lookup for resume-finalize drains", async () => {
    const billingPort = {
      resolveVercelAiGatewayStripeCustomerId: vi.fn(async () => ({
        stripeCustomerId: "cus_platform_123",
      })),
    };

    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: {
            ...createSingleWakeRunDrain(buildSystemIngressWake("evt_resume_finalize_skip"), {
              triggerKind: "runtime_timer",
            }),
            resumeFinalize: true,
          },
        },
        runtime: {
          forwardedEnv: {
            [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "stripe_meter",
            HOSTED_ASSISTANT_BASE_URL: "https://ai-gateway.vercel.sh/v1",
            HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
            HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: "rk_test_123",
            HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: "true",
          },
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          billingPort,
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, finalResult);
    expect(billingPort.resolveVercelAiGatewayStripeCustomerId).not.toHaveBeenCalled();
    expect(mocks.completeHostedRunDrainAfterCommit).toHaveBeenCalledTimes(1);
  });

  it("emits a failure log with run context when finalize-time normalization fails", async () => {
    mocks.normalizeHostedAssistantRuntimeConfig.mockImplementationOnce(() => {
      throw new Error("missing hosted runtime config");
    });

    await expect(
      runHostedAssistantRuntimeJobInProcessDetailed(
        {
          request: {
            bundle: "incoming-bundle",
            run: {
              attempt: 1,
              runId: "run_123",
              startedAt: "2026-04-08T00:00:00.000Z",
            },
            runDrain: {
              acquiredAt: "2026-04-08T00:00:00.000Z",
              events: [],
              inputCommittedSeq: "24",
              inputCursorVersion: "4",
              runId: "run_123",
              triggerKind: "runtime_timer",
              userId: "member_123",
            },
          },
        },
        {
          platform: {
            artifactStore: {
              async get() {
                return null;
              },
              async put() {},
            },
            effectsPort: createHostedRuntimeEffectsPortStub(),
          },
        },
      ),
    ).rejects.toThrow(/missing hosted runtime config/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        message: "Hosted runtime failed.",
        phase: "failed",
        run: expect.objectContaining({
          attempt: 1,
          runId: "run_123",
          startedAt: "2026-04-08T00:00:00.000Z",
        }),
      }),
    );
  });

  it("fails closed when runDrain is missing at the runtime entrypoint", async () => {
    await expect(
      Reflect.apply(runHostedAssistantRuntimeJobInProcessDetailed, undefined, [
        {
          request: {
            bundle: "incoming-bundle",
            run: HOSTED_RUN_CONTEXT,
          },
        },
        {
          platform: {
            artifactStore: {
              async get() {
                return null;
              },
              async put() {},
            },
            effectsPort: createHostedRuntimeEffectsPortStub(),
          },
        },
      ]),
    ).rejects.toThrow(/Hosted assistant runtime job request\.runDrain is required\./u);
  });

  it("skips rematerialization when every requested artifact path is already materialized", async () => {
    mocks.executeHostedRunDrainForCommit.mockImplementation(async (input) => {
      await input.artifactMaterializer?.(["vault/raw/a.bin"]);
      await input.artifactMaterializer?.(["vault/raw/a.bin", "vault/raw/a.bin"]);
      return committedExecution;
    });

    await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: createSingleWakeRunDrain(buildSystemIngressWake("evt_dedupe_artifacts")),
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    expect(mocks.materializeHostedExecutionArtifacts).toHaveBeenCalledTimes(1);
  });

  it("waits for Linq typing startup confirmation before executing the hosted run and stops after commit", async () => {
    const steps: string[] = [];
    const stopHandle = vi.fn(async () => {
      steps.push("stop");
    });
    let resolveTypingStart!: (value: { stop(): Promise<void> }) => void;
    mocks.startLinqTypingIndicator.mockImplementation(() => {
      steps.push("start");
      return new Promise<{ stop(): Promise<void> }>((resolve) => {
        resolveTypingStart = resolve;
      });
    });
    mocks.executeHostedRunDrainForCommit.mockImplementation(async () => {
      steps.push("execute");
      return committedExecution;
    });

    const runPromise = runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: createSingleWakeRunDrain(buildLinqWake("evt_linq_typing")),
        },
        runtime: {
          forwardedEnv: {
            LINQ_API_TOKEN: "linq-token",
          },
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    await vi.waitFor(() => {
      expect(mocks.startLinqTypingIndicator).toHaveBeenCalledTimes(1);
    });
    expect(mocks.executeHostedRunDrainForCommit).not.toHaveBeenCalled();

    resolveTypingStart({
      stop: stopHandle,
    });
    await vi.waitFor(() => {
      expect(mocks.executeHostedRunDrainForCommit).toHaveBeenCalledTimes(1);
    });
    await runPromise;

    expect(mocks.startLinqTypingIndicator).toHaveBeenCalledWith(
      {
        target: "chat_123",
      },
      {
        env: {
          LINQ_API_TOKEN: "linq-token",
        },
        refreshMs: undefined,
        signal: expect.any(AbortSignal),
      },
    );
    expect(stopHandle).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(["start", "execute", "stop"]);
  });

  it("passes a null artifact materializer when the decoded bundle is absent", async () => {
    mocks.decodeHostedBundleBase64.mockReturnValueOnce(null);

    await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: createSingleWakeRunDrain(buildSystemIngressWake("evt_no_bundle")),
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    expect(mocks.restoreHostedExecutionContext).toHaveBeenCalledWith(
      expect.objectContaining({
        bundle: null,
      }),
    );
    expect(mocks.executeHostedRunDrainForCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactMaterializer: null,
      }),
    );
    expect(mocks.materializeHostedExecutionArtifacts).not.toHaveBeenCalled();
  });

  it("uses the committed run-drain finalize payload without re-running dispatch or commit callbacks", async () => {
    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: {
            acquiredAt: "2026-04-08T00:00:00.000Z",
            events: [],
            inputCommittedSeq: "24",
            inputCursorVersion: "4",
            resumeFinalize: true,
            runId: "run_123",
            triggerKind: "runtime_timer",
            userId: "member_123",
          },
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, finalResult);
    expect(mocks.executeHostedRunDrainForCommit).not.toHaveBeenCalled();
    expect(mocks.completeHostedRunDrainAfterCommit).toHaveBeenCalledTimes(1);
  });

  it("swallows Linq typing startup failures and still completes the hosted run", async () => {
    mocks.startLinqTypingIndicator.mockRejectedValueOnce(
      new Error("typing start failed"),
    );

    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: createSingleWakeRunDrain(buildLinqWake("evt_linq_typing_start_failure")),
        },
        runtime: {
          forwardedEnv: {
            LINQ_API_TOKEN: "linq-token",
          },
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, committedFirstPassResult);
    expect(mocks.executeHostedRunDrainForCommit).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Hosted Linq typing indicator could not be started.",
        phase: "wake.running",
      }),
    );
  });

  it("waits for Telegram typing startup confirmation before executing the hosted run and stops after commit", async () => {
    const steps: string[] = [];
    const stopHandle = vi.fn(async () => {
      steps.push("stop");
    });
    let resolveTypingStart!: (value: { stop(): Promise<void> }) => void;
    mocks.startTelegramTypingIndicator.mockImplementation(() => {
      steps.push("start");
      return new Promise<{ stop(): Promise<void> }>((resolve) => {
        resolveTypingStart = resolve;
      });
    });
    mocks.executeHostedRunDrainForCommit.mockImplementation(async () => {
      steps.push("execute");
      return committedExecution;
    });

    const runPromise = runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: createSingleWakeRunDrain(buildHostedExecutionTelegramConversationMessageWake({
            eventId: "evt_telegram_typing",
            occurredAt: "2026-04-08T00:00:00.000Z",
            telegramMessage: {
              messageId: "tg_message_77",
              schema: "murph.hosted-telegram-message.v1",
              threadId: "123456",
            },
            userId: "member_123",
          })),
        },
        runtime: {
          platformEnv: {
            TELEGRAM_BOT_TOKEN: "telegram-token",
          },
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    await vi.waitFor(() => {
      expect(mocks.startTelegramTypingIndicator).toHaveBeenCalledTimes(1);
    });
    expect(mocks.executeHostedRunDrainForCommit).not.toHaveBeenCalled();

    resolveTypingStart({
      stop: stopHandle,
    });
    await vi.waitFor(() => {
      expect(mocks.executeHostedRunDrainForCommit).toHaveBeenCalledTimes(1);
    });
    await runPromise;

    expect(mocks.startTelegramTypingIndicator).toHaveBeenCalledWith(
      {
        target: "123456",
      },
      {
        env: {
          TELEGRAM_BOT_TOKEN: "telegram-token",
        },
        signal: expect.any(AbortSignal),
      },
    );
    expect(stopHandle).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(["start", "execute", "stop"]);
  });

  it("swallows Telegram typing startup failures and still completes the hosted run", async () => {
    mocks.startTelegramTypingIndicator.mockRejectedValueOnce(
      new Error("telegram typing start failed"),
    );

    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: createSingleWakeRunDrain(
            buildHostedExecutionTelegramConversationMessageWake({
              eventId: "evt_telegram_typing_start_failure",
              occurredAt: "2026-04-08T00:00:00.000Z",
              telegramMessage: {
                messageId: "tg_message_77",
                schema: "murph.hosted-telegram-message.v1",
                threadId: "123456",
              },
              userId: "member_123",
            }),
          ),
        },
        runtime: {
          platformEnv: {
            TELEGRAM_BOT_TOKEN: "telegram-token",
          },
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, committedFirstPassResult);
    expect(mocks.executeHostedRunDrainForCommit).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Hosted Telegram typing indicator could not be started.",
        phase: "wake.running",
      }),
    );
  });

  it("fails closed when run-drain finalize post-commit completion fails", async () => {
    mocks.completeHostedRunDrainAfterCommit.mockReset();
    mocks.completeHostedRunDrainAfterCommit.mockRejectedValueOnce(
      new Error("completion failed"),
    );

    await expect(
      runHostedAssistantRuntimeJobInProcessDetailed(
        {
          request: {
            bundle: "incoming-bundle",
            run: HOSTED_RUN_CONTEXT,
            runDrain: {
              acquiredAt: "2026-04-08T00:00:00.000Z",
              events: [],
              inputCommittedSeq: "24",
              inputCursorVersion: "4",
              resumeFinalize: true,
              runId: "run_123",
              triggerKind: "runtime_timer",
              userId: "member_123",
            },
          },
        },
        {
          platform: {
            artifactStore: {
              async get() {
                return null;
              },
              async put() {},
            },
            effectsPort: createHostedRuntimeEffectsPortStub(),
          },
        },
      ),
    ).rejects.toThrow(/completion failed/u);

    expect(mocks.executeHostedRunDrainForCommit).not.toHaveBeenCalled();
    expect(mocks.completeHostedRunDrainAfterCommit).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runtime failed.",
        phase: "failed",
      }),
    );
  });

  it("fails closed when hosted device links are requested without a configured control plane", async () => {
    mocks.executeHostedRunDrainForCommit.mockImplementation(async (input) => {
      await input.executionContext.hosted.issueDeviceConnectLink({
        provider: "oura",
      });
      return committedExecution;
    });

    await expect(
      runHostedAssistantRuntimeJobInProcessDetailed(
        {
          request: {
            bundle: "incoming-bundle",
            run: HOSTED_RUN_CONTEXT,
            runDrain: createSingleWakeRunDrain(buildMemberActivatedWake("evt_missing_device_sync")),
          },
        },
        {
          platform: {
            artifactStore: {
              async get() {
                return null;
              },
              async put() {},
            },
            effectsPort: createHostedRuntimeEffectsPortStub(),
          },
        },
      ),
    ).rejects.toThrow(/device-sync control plane is not configured/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runtime failed.",
        phase: "failed",
      }),
    );
  });

  it("returns the bare runner result from the convenience wrapper", async () => {
    mocks.completeHostedRunDrainAfterCommit.mockResolvedValueOnce(finalResult);

    const result = await runHostedAssistantRuntimeJobInProcess(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: {
            acquiredAt: "2026-04-08T00:00:00.000Z",
            events: [],
            inputCommittedSeq: "24",
            inputCursorVersion: "4",
            resumeFinalize: true,
            runId: "run_123",
            triggerKind: "runtime_timer",
            userId: "member_123",
          },
        },
      },
      {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, finalResult.result);
  });
});
