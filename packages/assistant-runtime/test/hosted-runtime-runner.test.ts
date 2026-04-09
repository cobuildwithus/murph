import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedExecutionTelegramMessageReceivedDispatch,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  commitHostedExecutionResult: vi.fn(),
  completeHostedExecutionAfterCommit: vi.fn(),
  createHostedArtifactResolver: vi.fn(),
  decodeHostedBundleBase64: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  executeHostedDispatchForCommit: vi.fn(),
  materializeHostedExecutionArtifacts: vi.fn(),
  normalizeHostedAssistantRuntimeConfig: vi.fn(),
  parseCanonicalLinqMessageReceivedEvent: vi.fn(),
  parseLinqWebhookEvent: vi.fn(),
  restoreHostedExecutionContext: vi.fn(),
  resumeHostedCommittedExecution: vi.fn(),
  startLinqChatTypingIndicator: vi.fn(),
  stopLinqChatTypingIndicator: vi.fn(),
  withHostedProcessEnvironment: vi.fn(),
}));

vi.mock("@murphai/runtime-state/node", () => ({
  decodeHostedBundleBase64: mocks.decodeHostedBundleBase64,
  materializeHostedExecutionArtifacts: mocks.materializeHostedExecutionArtifacts,
  restoreHostedExecutionContext: mocks.restoreHostedExecutionContext,
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

vi.mock("@murphai/messaging-ingress/linq-webhook", () => ({
  parseCanonicalLinqMessageReceivedEvent:
    mocks.parseCanonicalLinqMessageReceivedEvent,
  parseLinqWebhookEvent: mocks.parseLinqWebhookEvent,
}));

vi.mock("@murphai/operator-config/linq-runtime", () => ({
  startLinqChatTypingIndicator: mocks.startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator: mocks.stopLinqChatTypingIndicator,
}));

vi.mock("../src/hosted-runtime/callbacks.ts", () => ({
  commitHostedExecutionResult: mocks.commitHostedExecutionResult,
  resumeHostedCommittedExecution: mocks.resumeHostedCommittedExecution,
}));

vi.mock("../src/hosted-runtime/artifacts.ts", () => ({
  createHostedArtifactResolver: mocks.createHostedArtifactResolver,
}));

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
  completeHostedExecutionAfterCommit: mocks.completeHostedExecutionAfterCommit,
  executeHostedDispatchForCommit: mocks.executeHostedDispatchForCommit,
}));

import {
  formatHostedRuntimeChildResult,
  parseHostedRuntimeChildResult,
  runHostedAssistantRuntimeJobInProcess,
  runHostedAssistantRuntimeJobInProcessDetailed,
} from "../src/hosted-runtime.ts";
import {
  createHostedRuntimeEffectsPortStub,
} from "./hosted-runtime-test-helpers.ts";

const incomingBundle = Uint8Array.from([1, 2, 3]);
const originalFetch = globalThis.fetch;
const committedExecution = {
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
  committedSideEffects: [
    {
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      intentId: "intent_123",
      kind: "assistant.delivery",
    },
  ],
};
const finalResult = {
  finalGatewayProjectionSnapshot: {
    schema: "murph.gateway-projection-snapshot.v1",
    generatedAt: "2026-04-08T00:05:00.000Z",
    conversations: [],
    messages: [],
    permissions: [],
  },
  result: {
    bundle: "final-bundle",
    result: {
      eventsHandled: 1,
      nextWakeAt: null,
      summary: "final summary",
    },
  },
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
    userEnv: { ...(runtime?.userEnv ?? {}) },
  }));
  mocks.parseLinqWebhookEvent.mockImplementation((rawBody: string) => JSON.parse(rawBody));
  mocks.parseCanonicalLinqMessageReceivedEvent.mockReturnValue({
    data: {
      chat_id: "chat_123",
    },
  });
  mocks.restoreHostedExecutionContext.mockResolvedValue({
    operatorHomeRoot: "/tmp/operator-home",
    vaultRoot: "/tmp/vault-root",
  });
  mocks.withHostedProcessEnvironment.mockImplementation(
    async (
      _input: unknown,
      callback: () => Promise<unknown>,
    ) => callback(),
  );
  mocks.executeHostedDispatchForCommit.mockResolvedValue(committedExecution);
  mocks.resumeHostedCommittedExecution.mockReturnValue(committedExecution);
  mocks.completeHostedExecutionAfterCommit.mockResolvedValue(finalResult);
  mocks.commitHostedExecutionResult.mockResolvedValue(undefined);
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
  it("runs the commit path, materializes requested artifacts once, and returns the final result", async () => {
    const deviceSyncPort = {
      applyUpdates: vi.fn(),
      createConnectLink: vi.fn(async ({ provider }: { provider: string }) => ({
        provider,
        url: `https://connect.example.test/${provider}`,
      })),
      fetchSnapshot: vi.fn(),
    };

    mocks.executeHostedDispatchForCommit.mockImplementation(async (input) => {
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
          commit: {
            bundleRef: {
              hash: "hash_123",
              key: "bundles/member/vault.json",
              size: 42,
              updatedAt: "2026-04-08T00:00:00.000Z",
            },
          },
          dispatch: {
            event: {
              kind: "member.activated",
              userId: "member_123",
            },
            eventId: "evt_123",
            occurredAt: "2026-04-08T00:00:00.000Z",
          },
        },
        runtime: {
          commitTimeoutMs: 45_000,
          forwardedEnv: {
            OPENAI_API_KEY: "secret",
          },
          userEnv: {
            HOSTED_USER_VERIFIED_EMAIL: "member@example.com",
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
          deviceSyncPort,
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
      },
    );

    assert.deepEqual(result, finalResult);
    expect(deviceSyncPort.createConnectLink).toHaveBeenCalledWith({
      provider: "oura",
    });
    expect(mocks.executeHostedDispatchForCommit).toHaveBeenCalledTimes(1);
    expect(mocks.resumeHostedCommittedExecution).not.toHaveBeenCalled();
    expect(mocks.commitHostedExecutionResult).toHaveBeenCalledWith({
      commit: {
        bundleRef: {
          hash: "hash_123",
          key: "bundles/member/vault.json",
          size: 42,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_123",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: expect.any(Object),
      gatewayProjectionSnapshot: committedExecution.committedGatewayProjectionSnapshot,
      result: committedExecution.committedResult,
      sideEffects: committedExecution.committedSideEffects,
    });
    expect(mocks.completeHostedExecutionAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        committedExecution,
        materializedArtifactPaths: new Set(["vault/raw/a.bin", "vault/raw/b.bin"]),
      }),
    );
    expect(mocks.withHostedProcessEnvironment).toHaveBeenCalledWith(
      {
        envOverrides: {
          HOSTED_USER_VERIFIED_EMAIL: "member@example.com",
          OPENAI_API_KEY: "secret",
        },
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      expect.any(Function),
    );
    expect(mocks.materializeHostedExecutionArtifacts).toHaveBeenCalledTimes(1);
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

  it("skips rematerialization when every requested artifact path is already materialized", async () => {
    mocks.executeHostedDispatchForCommit.mockImplementation(async (input) => {
      await input.artifactMaterializer?.(["vault/raw/a.bin"]);
      await input.artifactMaterializer?.(["vault/raw/a.bin", "vault/raw/a.bin"]);
      return committedExecution;
    });

    await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          dispatch: {
            event: {
              kind: "assistant.cron.tick",
              reason: "manual",
              userId: "member_123",
            },
            eventId: "evt_dedupe_artifacts",
            occurredAt: "2026-04-08T00:00:00.000Z",
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

    expect(mocks.materializeHostedExecutionArtifacts).toHaveBeenCalledTimes(1);
    expect(mocks.completeHostedExecutionAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        materializedArtifactPaths: new Set(["vault/raw/a.bin"]),
      }),
    );
  });

  it("does not block hosted execution while Linq typing startup is in flight and stops after committed delivery draining", async () => {
    const steps: string[] = [];
    let resolveTypingStart!: () => void;
    mocks.startLinqChatTypingIndicator.mockImplementation(() => {
      steps.push("start");
      return new Promise<void>((resolve) => {
        resolveTypingStart = resolve;
      });
    });
    mocks.executeHostedDispatchForCommit.mockImplementation(async () => {
      steps.push("execute");
      return committedExecution;
    });
    mocks.completeHostedExecutionAfterCommit.mockImplementation(async () => {
      steps.push("complete");
      return finalResult;
    });
    mocks.stopLinqChatTypingIndicator.mockImplementation(async () => {
      steps.push("stop");
    });

    const runPromise = runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          dispatch: {
            event: {
              kind: "linq.message.received",
              linqEvent: {
                data: {
                  message: {
                    parts: [],
                  },
                },
                event_type: "message.received",
              },
              linqMessageId: "msg_123",
              phoneLookupKey: "phone_123",
              userId: "member_123",
            },
            eventId: "evt_linq_typing",
            occurredAt: "2026-04-08T00:00:00.000Z",
          },
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
      expect(mocks.executeHostedDispatchForCommit).toHaveBeenCalledTimes(1);
      expect(mocks.completeHostedExecutionAfterCommit).toHaveBeenCalledTimes(1);
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
    expect(steps).toEqual(["start", "execute", "complete", "stop"]);
  });

  it("passes a null artifact materializer when the decoded bundle is absent", async () => {
    mocks.decodeHostedBundleBase64.mockReturnValueOnce(null);

    await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          dispatch: {
            event: {
              kind: "assistant.cron.tick",
              reason: "manual",
              userId: "member_123",
            },
            eventId: "evt_no_bundle",
            occurredAt: "2026-04-08T00:00:00.000Z",
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

    expect(mocks.restoreHostedExecutionContext).toHaveBeenCalledWith(
      expect.objectContaining({
        bundle: null,
      }),
    );
    expect(mocks.executeHostedDispatchForCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactMaterializer: null,
      }),
    );
    expect(mocks.materializeHostedExecutionArtifacts).not.toHaveBeenCalled();
  });

  it("uses the committed resume payload without re-running dispatch or commit callbacks", async () => {
    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          dispatch: {
            event: {
              kind: "assistant.cron.tick",
              reason: "manual",
              userId: "member_123",
            },
            eventId: "evt_resume",
            occurredAt: "2026-04-08T00:00:00.000Z",
          },
          resume: {
            committedResult: {
              result: committedExecution.committedResult.result,
              sideEffects: committedExecution.committedSideEffects,
            },
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
    expect(mocks.resumeHostedCommittedExecution).toHaveBeenCalledTimes(1);
    expect(mocks.executeHostedDispatchForCommit).not.toHaveBeenCalled();
    expect(mocks.commitHostedExecutionResult).not.toHaveBeenCalled();
    expect(mocks.completeHostedExecutionAfterCommit).toHaveBeenCalledTimes(1);
  });

  it("swallows Linq typing startup failures and still completes the hosted run", async () => {
    mocks.startLinqChatTypingIndicator.mockRejectedValueOnce(
      new Error("typing start failed"),
    );

    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          dispatch: {
            event: {
              kind: "linq.message.received",
              linqEvent: {
                data: {
                  message: {
                    parts: [],
                  },
                },
                event_type: "message.received",
              },
              linqMessageId: "msg_123",
              phoneLookupKey: "phone_123",
              userId: "member_123",
            },
            eventId: "evt_linq_typing_start_failure",
            occurredAt: "2026-04-08T00:00:00.000Z",
          },
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

    assert.deepEqual(result, finalResult);
    expect(mocks.executeHostedDispatchForCommit).toHaveBeenCalledTimes(1);
    expect(mocks.completeHostedExecutionAfterCommit).toHaveBeenCalledTimes(1);
    expect(mocks.stopLinqChatTypingIndicator).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Hosted Linq typing indicator could not be started.",
        phase: "dispatch.running",
      }),
    );
  });

  it("does not block hosted execution while Telegram typing startup is in flight and stops after committed delivery draining", async () => {
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
    mocks.executeHostedDispatchForCommit.mockImplementation(async () => {
      steps.push("execute");
      return committedExecution;
    });
    mocks.completeHostedExecutionAfterCommit.mockImplementation(async () => {
      steps.push("complete");
      return finalResult;
    });

    const runPromise = runHostedAssistantRuntimeJobInProcessDetailed(
      {
        request: {
          bundle: "incoming-bundle",
          dispatch: buildHostedExecutionTelegramMessageReceivedDispatch({
            eventId: "evt_telegram_typing",
            occurredAt: "2026-04-08T00:00:00.000Z",
            telegramMessage: {
              messageId: "tg_message_77",
              schema: "murph.hosted-telegram-message.v1",
              threadId: "123456",
            },
            userId: "member_123",
          }),
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
      expect(mocks.executeHostedDispatchForCommit).toHaveBeenCalledTimes(1);
      expect(mocks.completeHostedExecutionAfterCommit).toHaveBeenCalledTimes(1);
    });
    expect(typingSignal.aborted).toBe(false);

    resolveTypingStart();
    await runPromise;

    expect(typingSignal.aborted).toBe(true);
    expect(steps).toEqual(["start", "execute", "complete"]);
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
          dispatch: buildHostedExecutionTelegramMessageReceivedDispatch({
            eventId: "evt_telegram_typing_start_failure",
            occurredAt: "2026-04-08T00:00:00.000Z",
            telegramMessage: {
              messageId: "tg_message_77",
              schema: "murph.hosted-telegram-message.v1",
              threadId: "123456",
            },
            userId: "member_123",
          }),
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

    assert.deepEqual(result, finalResult);
    expect(mocks.executeHostedDispatchForCommit).toHaveBeenCalledTimes(1);
    expect(mocks.completeHostedExecutionAfterCommit).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Hosted Telegram typing indicator could not be started.",
        phase: "dispatch.running",
      }),
    );
  });

  it("fails closed when hosted device links are requested without a configured control plane", async () => {
    mocks.executeHostedDispatchForCommit.mockImplementation(async (input) => {
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
            dispatch: {
              event: {
                kind: "member.activated",
                userId: "member_123",
              },
              eventId: "evt_missing_device_sync",
              occurredAt: "2026-04-08T00:00:00.000Z",
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
    ).rejects.toThrow(/device-sync control plane is not configured/u);

    expect(mocks.commitHostedExecutionResult).not.toHaveBeenCalled();
    expect(mocks.completeHostedExecutionAfterCommit).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runtime failed.",
        phase: "failed",
      }),
    );
  });

  it("returns the bare runner result from the convenience wrapper", async () => {
    mocks.completeHostedExecutionAfterCommit.mockResolvedValueOnce(finalResult);

    const result = await runHostedAssistantRuntimeJobInProcess(
      {
        request: {
          bundle: "incoming-bundle",
          dispatch: {
            event: {
              kind: "assistant.cron.tick",
              reason: "manual",
              userId: "member_123",
            },
            eventId: "evt_wrapper",
            occurredAt: "2026-04-08T00:00:00.000Z",
          },
          resume: {
            committedResult: {
              result: committedExecution.committedResult.result,
              sideEffects: committedExecution.committedSideEffects,
            },
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
