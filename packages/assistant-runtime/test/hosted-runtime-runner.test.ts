import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedExecutionAssistantCronTickWake,
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

function buildCronWake(
  eventId: string,
  reason: "alarm" | "device-sync" | "manual" = "manual",
) {
  return buildHostedExecutionAssistantCronTickWake({
    eventId,
    occurredAt: "2026-04-08T00:00:00.000Z",
    reason,
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
        wakeId: `wake_${wake.eventId}`,
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
  materializeHostedExecutionArtifacts: vi.fn(),
  normalizeHostedAssistantRuntimeConfig: vi.fn(),
  restoreHostedExecutionContext: vi.fn(),
  startLinqChatTypingIndicator: vi.fn(),
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
  phase: "committed",
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
  mocks.stopLinqChatTypingIndicator.mockResolvedValue(undefined);
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
        path: "vault/raw/a.bin",
        root: "vault",
      }),
    ).toBe(true);
    expect(
      mocks.materializeHostedExecutionArtifacts.mock.calls[0]?.[0].shouldRestoreArtifact({
        path: "vault/raw/c.bin",
        root: "vault",
      }),
    ).toBe(false);
    expect(
      mocks.materializeHostedExecutionArtifacts.mock.calls[0]?.[0].shouldRestoreArtifact({
        path: "vault/raw/a.bin",
        root: "operator-home",
      }),
    ).toBe(false);
    expect(
      mocks.restoreHostedExecutionContext.mock.calls[0]?.[0].shouldRestoreArtifact({
        path: "vault/raw/a.bin",
        root: "vault",
      }),
    ).toBe(false);
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
              buildCronWake("evt_runtime_normalization_failure"),
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

  it("fails closed when a caller bypasses the parser and omits runDrain", async () => {
    await expect(
      runHostedAssistantRuntimeJobInProcessDetailed(
        {
          request: {
            bundle: "incoming-bundle",
            run: HOSTED_RUN_CONTEXT,
            runDrain: undefined as never,
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
    ).rejects.toThrow(
      "Hosted runtime jobs must use runDrain; single-wake execution was removed.",
    );

    expect(mocks.executeHostedRunDrainForCommit).not.toHaveBeenCalled();
    expect(mocks.completeHostedRunDrainAfterCommit).not.toHaveBeenCalled();
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
          runDrain: createSingleWakeRunDrain(buildCronWake("evt_dedupe_artifacts")),
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

  it("does not block hosted execution while Linq typing startup is in flight and stops after the committed first pass", async () => {
    const steps: string[] = [];
    let resolveTypingStart!: () => void;
    mocks.startLinqChatTypingIndicator.mockImplementation(() => {
      steps.push("start");
      return new Promise<void>((resolve) => {
        resolveTypingStart = resolve;
      });
    });
    mocks.executeHostedRunDrainForCommit.mockImplementation(async () => {
      steps.push("execute");
      return committedExecution;
    });
    mocks.stopLinqChatTypingIndicator.mockImplementation(async () => {
      steps.push("stop");
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
      expect(mocks.executeHostedRunDrainForCommit).toHaveBeenCalledTimes(1);
    });
    expect(mocks.stopLinqChatTypingIndicator).not.toHaveBeenCalled();

    resolveTypingStart();
    await runPromise;

    expect(mocks.startLinqChatTypingIndicator).toHaveBeenCalledWith(
      {
        chatId: "chat_123",
      },
      {
        env: {
          LINQ_API_TOKEN: "linq-token",
        },
      },
    );
    expect(mocks.stopLinqChatTypingIndicator).toHaveBeenCalledWith(
      {
        chatId: "chat_123",
      },
      {
        env: {
          LINQ_API_TOKEN: "linq-token",
        },
      },
    );
    expect(steps).toEqual(["start", "execute", "stop"]);
  });

  it("passes a null artifact materializer when the decoded bundle is absent", async () => {
    mocks.decodeHostedBundleBase64.mockReturnValueOnce(null);

    await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: createSingleWakeRunDrain(buildCronWake("evt_no_bundle")),
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
    mocks.startLinqChatTypingIndicator.mockRejectedValueOnce(
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
    expect(mocks.stopLinqChatTypingIndicator).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Hosted Linq typing indicator could not be started.",
        phase: "wake.running",
      }),
    );
  });

  it("does not block hosted execution while Telegram typing startup is in flight and stops after the committed first pass", async () => {
    const steps: string[] = [];
    let resolveTypingStart!: () => void;
    let typingSignal!: AbortSignal;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        steps.push("start");
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) {
          throw new Error("expected Telegram typing fetch to receive an abort signal");
        }
        typingSignal = signal;
        await new Promise<void>((resolve) => {
          resolveTypingStart = resolve;
        });
        return new Response(JSON.stringify({
          ok: true,
        }), {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        });
      }),
      writable: true,
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
          forwardedEnv: {
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
      expect(mocks.executeHostedRunDrainForCommit).toHaveBeenCalledTimes(1);
    });
    expect(typingSignal.aborted).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    resolveTypingStart();
    await runPromise;

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(["start", "execute"]);
  });

  it("swallows Telegram typing startup failures and still completes the hosted run", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: vi.fn(async () => new Response(JSON.stringify({
        description: "telegram typing start failed",
        ok: false,
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      })),
      writable: true,
    });

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
          forwardedEnv: {
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
