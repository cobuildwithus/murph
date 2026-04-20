import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";

import {
  createHostedRuntimeArtifactStoreStub,
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";

const HOSTED_RUN_CONTEXT = {
  attempt: 1,
  runId: "run_123",
  startedAt: "2026-04-08T00:00:00.000Z",
} as const;

const mocks = vi.hoisted(() => ({
  assistantGatewayLocalProjectionSourceReader: Symbol(
    "assistantGatewayLocalProjectionSourceReader",
  ),
  collectHostedAssistantDeliverySideEffects: vi.fn(),
  createHostedArtifactUploadSink: vi.fn(),
  decodeHostedBundleBase64: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  encodeHostedBundleBase64: vi.fn(),
  executeHostedIngressEventAlias: vi.fn(),
  exportGatewayProjectionSnapshotLocal: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  listHostedBundleArtifacts: vi.fn(),
  runHostedAssistantRuntimeTimerLane: vi.fn(),
  runHostedDeviceSyncWakeLane: vi.fn(),
  runHostedNoopSystemWakeLane: vi.fn(),
  snapshotHostedExecutionContext: vi.fn(),
}));

vi.mock("@murphai/runtime-state/node", async () => {
  const actual = await vi.importActual<typeof import("@murphai/runtime-state/node")>(
    "@murphai/runtime-state/node",
  );

  return {
    ...actual,
    decodeHostedBundleBase64: mocks.decodeHostedBundleBase64,
    encodeHostedBundleBase64: mocks.encodeHostedBundleBase64,
    listHostedBundleArtifacts: mocks.listHostedBundleArtifacts,
    snapshotHostedExecutionContext: mocks.snapshotHostedExecutionContext,
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

vi.mock("@murphai/assistant-engine/gateway-local-adapter", () => ({
  assistantGatewayLocalProjectionSourceReader:
    mocks.assistantGatewayLocalProjectionSourceReader,
}));

vi.mock("@murphai/gateway-local", () => ({
  exportGatewayProjectionSnapshotLocal: mocks.exportGatewayProjectionSnapshotLocal,
}));

vi.mock("../src/hosted-runtime/artifacts.ts", () => ({
  createHostedArtifactUploadSink: mocks.createHostedArtifactUploadSink,
}));

vi.mock("../src/hosted-runtime/callbacks.ts", () => ({
  collectHostedAssistantDeliverySideEffects:
    mocks.collectHostedAssistantDeliverySideEffects,
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  hydrateHostedExecutionDefaultTarget:
    mocks.hydrateHostedExecutionDefaultTarget,
}));

vi.mock("../src/hosted-runtime/events.ts", () => ({
  executeHostedIngressEventAlias: mocks.executeHostedIngressEventAlias,
}));

vi.mock("../src/hosted-runtime/maintenance.ts", () => ({
  runHostedAssistantRuntimeTimerLane: mocks.runHostedAssistantRuntimeTimerLane,
  runHostedDeviceSyncWakeLane: mocks.runHostedDeviceSyncWakeLane,
  runHostedNoopSystemWakeLane: mocks.runHostedNoopSystemWakeLane,
}));

import {
  executeHostedRunDrainForCommit,
} from "../src/hosted-runtime/execution.ts";

const incomingBundle = Uint8Array.from([1, 2, 3]);
const committedBundle = Uint8Array.from([4, 5, 6]);

function createRuntime() {
  const { artifactStore } = createHostedRuntimeArtifactStoreStub();

  return {
    commitTimeoutMs: 45_000,
    platform: {
      artifactStore,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      usageExportPort: null,
    },
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  };
}

function createRestored() {
  return {
    assistantStateRoot: "/tmp/vault-root/.assistant-state",
    operatorHomeRoot: "/tmp/operator-home",
    vaultRoot: "/tmp/vault-root",
  };
}

function createExecutionContext() {
  return {
    hosted: {
      issueDeviceConnectLink: vi.fn(),
      memberId: "member_123",
      userEnvKeys: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.decodeHostedBundleBase64.mockImplementation((bundle: string | null) => {
    if (bundle === "incoming-bundle") {
      return incomingBundle;
    }

    if (bundle === "committed-bundle") {
      return committedBundle;
    }

    return null;
  });
  mocks.encodeHostedBundleBase64.mockImplementation((bytes: Uint8Array) =>
    Buffer.from(bytes).toString("base64"),
  );
  mocks.createHostedArtifactUploadSink.mockReturnValue(Symbol("artifact-sink"));
  mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([]);
  mocks.exportGatewayProjectionSnapshotLocal.mockResolvedValue({
    conversations: [],
    generatedAt: "2026-04-08T00:10:00.000Z",
    messages: [],
    permissions: [],
    schema: "murph.gateway-projection-snapshot.v1",
  });
  mocks.executeHostedIngressEventAlias.mockResolvedValue({
    bootstrapResult: null,
    conversationMetrics: null,
    followupExecution: "member-activated",
    shareImportResult: null,
    shareImportTitle: null,
  });
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (executionContext) =>
    executionContext,
  );
  mocks.listHostedBundleArtifacts.mockReturnValue([]);
  mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValue({
    deviceSyncProcessed: 2,
    deviceSyncSkipped: false,
    nextWakeAt: "2026-04-08T00:30:00.000Z",
    parserProcessed: 3,
  });
  mocks.runHostedDeviceSyncWakeLane.mockResolvedValue({
    deviceSyncProcessed: 1,
    deviceSyncSkipped: false,
    nextWakeAt: "2026-04-08T00:45:00.000Z",
    parserProcessed: 0,
  });
  mocks.runHostedNoopSystemWakeLane.mockReturnValue({
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: null,
    parserProcessed: 0,
  });
  mocks.snapshotHostedExecutionContext.mockResolvedValue({
    bundle: Uint8Array.from([9, 9, 9]),
  });
});

describe("executeHostedRunDrainForCommit", () => {
  it("fails closed when runDrain is missing", async () => {
    await expect(
      executeHostedRunDrainForCommit({
        executionContext: createExecutionContext(),
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          // Bypass the stricter runtime parser/type surface to prove the runtime helper fails closed too.
          runDrain: undefined as never,
        },
        restored: createRestored(),
        runtime: createRuntime(),
        runtimeEnv: {},
      }),
    ).rejects.toThrow(
      "Hosted runtime jobs must use runDrain; single-wake execution was removed.",
    );

    expect(mocks.executeHostedIngressEventAlias).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantRuntimeTimerLane).not.toHaveBeenCalled();
    expect(mocks.runHostedNoopSystemWakeLane).not.toHaveBeenCalled();
  });

  it("drains an empty run and schedules runtime maintenance", async () => {
    const result = await executeHostedRunDrainForCommit({
      executionContext: createExecutionContext(),
      request: {
        bundle: "incoming-bundle",
        run: HOSTED_RUN_CONTEXT,
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
      restored: createRestored(),
      runtime: createRuntime(),
      runtimeEnv: {},
    });

    expect(mocks.executeHostedIngressEventAlias).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedNoopSystemWakeLane).not.toHaveBeenCalled();
    assert.equal(result.committedResult.result.eventsHandled, 0);
    assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:30:00.000Z");
  });

  it("merges run-drain follow-up metrics across conversation and system wakes", async () => {
    mocks.executeHostedIngressEventAlias
      .mockResolvedValueOnce({
        bootstrapResult: {
          assistantConfigStatus: "missing",
          assistantConfigured: false,
          assistantProvider: null,
          assistantSeeded: false,
          emailAutoReplyEnabled: false,
          linqAutoReplyEnabled: false,
          telegramAutoReplyEnabled: false,
          vaultCreated: true,
        },
        conversationMetrics: {
          nextWakeAt: "2026-04-08T00:12:00.000Z",
          parserProcessed: 2,
        },
        followupExecution: "conversation-message",
        shareImportResult: {
          imported: 1,
        },
        shareImportTitle: "Shared note",
      })
      .mockResolvedValueOnce({
        bootstrapResult: null,
        conversationMetrics: null,
        followupExecution: "member-activated",
        shareImportResult: null,
        shareImportTitle: null,
      });

    const result = await executeHostedRunDrainForCommit({
      executionContext: createExecutionContext(),
      request: {
        bundle: "incoming-bundle",
        run: HOSTED_RUN_CONTEXT,
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          events: [
            {
              seq: "24",
              wake: buildHostedExecutionDeviceSyncWake({
                eventId: "evt_device_sync_followup",
                occurredAt: "2026-04-08T00:00:00.000Z",
                reason: "connected",
                userId: "member_123",
              }),
              wakeId: "wake_24",
            },
            {
              seq: "25",
              wake: buildHostedExecutionMemberActivatedWake({
                eventId: "evt_member_followup",
                memberChannels: {
                  email: false,
                  linq: false,
                  telegram: false,
                },
                memberId: "member_123",
                occurredAt: "2026-04-08T00:00:01.000Z",
              }),
              wakeId: "wake_25",
            },
          ],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_123",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
      },
      restored: createRestored(),
      runtime: createRuntime(),
      runtimeEnv: {},
    });

    expect(mocks.executeHostedIngressEventAlias).toHaveBeenCalledTimes(2);
    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedNoopSystemWakeLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    assert.equal(result.committedResult.result.eventsHandled, 2);
    assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:12:00.000Z");
    assert.match(result.committedResult.result.summary, /kinds=device-sync\.wake,member\.activated/u);
  });
});
