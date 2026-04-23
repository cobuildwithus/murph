import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionVaultShareAcceptedWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  handleHostedShareAcceptedWake: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  ingestHostedConversationMessageWake: vi.fn(),
  prepareHostedWakeContext: vi.fn(),
  sendAssistantNotification: vi.fn(),
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  hydrateHostedExecutionDefaultTarget: mocks.hydrateHostedExecutionDefaultTarget,
  prepareHostedWakeContext: mocks.prepareHostedWakeContext,
}));

vi.mock("@murphai/assistant-engine", () => ({
  sendAssistantNotification: mocks.sendAssistantNotification,
}));

vi.mock("@murphai/assistant-engine/gateway-local-adapter", () => ({
  assistantGatewayLocalMessageSender: Symbol("assistantGatewayLocalMessageSender"),
  assistantGatewayLocalProjectionSourceReader: Symbol(
    "assistantGatewayLocalProjectionSourceReader",
  ),
}));

vi.mock("@murphai/gateway-local", () => ({
  sendGatewayMessageLocal: vi.fn(),
}));

vi.mock("../src/hosted-runtime/events/conversation.ts", () => ({
  ingestHostedConversationMessageWake: mocks.ingestHostedConversationMessageWake,
}));

vi.mock("../src/hosted-runtime/events/share.ts", () => ({
  handleHostedShareAcceptedWake: mocks.handleHostedShareAcceptedWake,
}));

import { executeHostedIngressEvent } from "../src/hosted-runtime/events.ts";
import {
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";

const executionContext = {
  hosted: {
    memberId: "member_123",
    userEnvKeys: [],
  },
} as const;

function createRuntime() {
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
    userEnv: {},
  } as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (value) => value);
  mocks.prepareHostedWakeContext.mockResolvedValue(null);
  mocks.handleHostedShareAcceptedWake.mockResolvedValue({
    shareImportResult: null,
    shareImportTitle: null,
  });
  mocks.ingestHostedConversationMessageWake.mockResolvedValue({
    nextWakeAt: null,
    parserProcessed: 0,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("hosted runtime event coverage", () => {
  it("treats activation wakes as a noop ingress lane", async () => {
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "evt_member_activated",
      memberId: "member_123",
      memberChannels: {
        email: false,
        linq: false,
        telegram: false,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const result = await executeHostedIngressEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
    });

    expect(mocks.sendAssistantNotification).not.toHaveBeenCalled();
    assert.deepEqual(result, {
      bootstrapResult: null,
      conversationMetrics: null,
      ingressLane: "member-activated",
      redactedLogEntries: [],
      shareImportResult: null,
      shareImportTitle: null,
      vaultSyncImportResult: null,
    });
  });

  it("returns noop metrics for device-sync wakes", async () => {
    const runtime = createRuntime();
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });

    await expect(
      executeHostedIngressEvent({
        wake: deviceSyncWake,
        executionContext,
        runtime,
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).resolves.toEqual({
      bootstrapResult: null,
      conversationMetrics: null,
      ingressLane: "device-sync",
      redactedLogEntries: [],
      shareImportResult: null,
      shareImportTitle: null,
      vaultSyncImportResult: null,
    });
  });

  it("delegates hydrated share acceptance to the share handler", async () => {
    mocks.handleHostedShareAcceptedWake.mockResolvedValue({
      shareImportResult: "imported",
      shareImportTitle: "Shared export",
    });
    const wake = buildHostedExecutionVaultShareAcceptedWake({
      eventId: "evt_share",
      memberId: "member_123",
      occurredAt: "2026-04-08T00:15:00.000Z",
      share: {
        ownerUserId: "member_sender",
        shareId: "share_123",
      },
    });
    const sharePack = {
      ownerUserId: "member_sender",
      pack: {
        createdAt: "2026-04-08T00:15:00.000Z",
        entities: [],
        schemaVersion: "murph.share-pack.v1" as const,
        title: "Shared export",
      },
      shareId: "share_123",
    };

    const result = await executeHostedIngressEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      sharePack,
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
    });

    expect(mocks.handleHostedShareAcceptedWake).toHaveBeenCalledWith({
      wake,
      sharePack,
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
    });
    assert.deepEqual(result, {
      bootstrapResult: null,
      conversationMetrics: null,
      ingressLane: "vault-share-accepted",
      redactedLogEntries: [],
      shareImportResult: "imported",
      shareImportTitle: "Shared export",
      vaultSyncImportResult: null,
    });
  });

  it("fails closed on unexpected wake kinds", async () => {
    await expect(
      executeHostedIngressEvent({
        wake: {
          kind: "unexpected.event",
          eventId: "evt_unexpected",
          occurredAt: "2026-04-08T00:20:00.000Z",
          userId: "member_123",
        } as never,
        executionContext,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).rejects.toThrow(/Unsupported hosted system wake kind\./u);
  });
});
