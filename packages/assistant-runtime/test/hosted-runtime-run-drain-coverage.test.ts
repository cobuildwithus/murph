import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionRuntimeTimerWake,
  buildHostedExecutionVaultSyncImportWake,
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
  executeHostedIngressEvent: vi.fn(),
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
  executeHostedIngressEvent: mocks.executeHostedIngressEvent,
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
    forwardedEnv: {},
    platform: {
      artifactStore,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      usageExportPort: null,
    },
    platformEnv: {},
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
  mocks.executeHostedIngressEvent.mockResolvedValue({
    bootstrapResult: null,
    conversationMetrics: null,
    ingressLane: "member-activated",
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
  it("drains an empty run and schedules runtime maintenance", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
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

      expect(mocks.executeHostedIngressEvent).not.toHaveBeenCalled();
      expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedNoopSystemWakeLane).not.toHaveBeenCalled();
      assert.equal(result.committedResult.result.eventsHandled, 0);
      assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:30:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("threads redacted notification lifecycle logs into the committed runner result", async () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "evt_notification",
      memberId: "member_123",
      notification: {
        instructions: "Send the update.",
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

    mocks.executeHostedIngressEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      ingressLane: "assistant-notification",
      redactedLogEntries: [
        {
          component: "runtime",
          eventId: "evt_notification",
          level: "warn",
          message: "Hosted assistant notification failed and was skipped so the hosted run can continue.",
          phase: "wake.running",
          redacted: {
            errorCode: "runtime_error",
            notificationRouteChannel: "linq",
            notificationRouteDeliveryKind: "thread",
          },
        },
      ],
      shareImportResult: null,
      shareImportTitle: null,
      vaultSyncImportResult: null,
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
              ingressEventId: "ingress-notification",
              seq: "24",
              wake,
            },
          ],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_123",
          triggerKind: "external_ingress",
          userId: "member_123",
        },
      },
      restored: createRestored(),
      runtime: createRuntime(),
      runtimeEnv: {},
    });

    expect(result.committedResult.result.redactedLogEntries).toEqual([
      {
        component: "runtime",
        eventId: "evt_notification",
        level: "warn",
        message: "Hosted assistant notification failed and was skipped so the hosted run can continue.",
        phase: "wake.running",
        redacted: {
          errorCode: "runtime_error",
          notificationRouteChannel: "linq",
          notificationRouteDeliveryKind: "thread",
        },
      },
    ]);
  });

  it("drains repeated immediate assistant follow-up work before snapshotting", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.runHostedAssistantRuntimeTimerLane
        .mockResolvedValueOnce({
          deviceSyncProcessed: 0,
          deviceSyncSkipped: true,
          nextWakeAt: "2026-04-08T00:00:00.000Z",
          parserProcessed: 0,
        })
        .mockResolvedValueOnce({
          deviceSyncProcessed: 0,
          deviceSyncSkipped: true,
          nextWakeAt: "2026-04-08T00:05:00.000Z",
          parserProcessed: 0,
        });
      mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
        deviceSyncProcessed: 1,
        deviceSyncSkipped: false,
        nextWakeAt: "2026-04-08T00:45:00.000Z",
        parserProcessed: 0,
      });

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

      expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledTimes(2);
      expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
      expect(mocks.snapshotHostedExecutionContext).toHaveBeenCalledTimes(1);
      assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:05:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("drains repeated immediate device-sync follow-up work before snapshotting", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: "2026-04-08T01:00:00.000Z",
        parserProcessed: 0,
      });
      mocks.runHostedDeviceSyncWakeLane
        .mockResolvedValueOnce({
          deviceSyncProcessed: 1,
          deviceSyncSkipped: false,
          nextWakeAt: "2026-04-08T00:00:00.000Z",
          parserProcessed: 0,
        })
        .mockResolvedValueOnce({
          deviceSyncProcessed: 1,
          deviceSyncSkipped: false,
          nextWakeAt: "2026-04-08T00:10:00.000Z",
          parserProcessed: 0,
        });

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

      expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(2);
      expect(mocks.snapshotHostedExecutionContext).toHaveBeenCalledTimes(1);
      assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:10:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("merges run-drain follow-up metrics across conversation and system wakes", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.executeHostedIngressEvent
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
          ingressLane: "conversation-message",
          shareImportResult: {
            imported: 1,
          },
          shareImportTitle: "Shared note",
        })
        .mockResolvedValueOnce({
          bootstrapResult: null,
          conversationMetrics: null,
          ingressLane: "member-activated",
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
                ingressEventId: "wake_24",
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
                ingressEventId: "wake_25",
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

      expect(mocks.executeHostedIngressEvent).toHaveBeenCalledTimes(2);
      expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedNoopSystemWakeLane).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      assert.equal(result.committedResult.result.eventsHandled, 2);
      assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:12:00.000Z");
      assert.match(result.committedResult.result.summary, /kinds=device-sync\.wake,member\.activated/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves redacted details for each vault-sync import handled in one run", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.executeHostedIngressEvent
        .mockResolvedValueOnce({
          bootstrapResult: null,
          conversationMetrics: null,
          ingressLane: "vault-sync-import",
          shareImportResult: null,
          shareImportTitle: null,
          vaultSyncImportResult: {
            conflictManifestPath: null,
            conflicts: [],
            imported: {
              jsonlRecords: 1,
              rawFiles: 0,
              textFiles: 2,
            },
            sessionId: "vsi_first",
            skipped: {
              duplicates: 0,
              excludedFiles: 1,
            },
          },
        })
        .mockResolvedValueOnce({
          bootstrapResult: null,
          conversationMetrics: null,
          ingressLane: "vault-sync-import",
          shareImportResult: null,
          shareImportTitle: null,
          vaultSyncImportResult: {
            conflictManifestPath: "raw/sync-imports/vsi_second/conflicts.json",
            conflicts: [
              {
                existingPath: "daily/2026-04-08.md",
                importPath: "daily/2026-04-08.md",
                preservedPath: "raw/sync-imports/vsi_second/daily/2026-04-08.md",
                reason: "different-content",
              },
            ],
            imported: {
              jsonlRecords: 0,
              rawFiles: 1,
              textFiles: 0,
            },
            sessionId: "vsi_second",
            skipped: {
              duplicates: 3,
              excludedFiles: 0,
            },
          },
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
                wake: buildHostedExecutionVaultSyncImportWake({
                  eventId: "evt_vault_sync_first",
                  memberId: "member_123",
                  occurredAt: "2026-04-08T00:00:00.000Z",
                  vaultSync: {
                    localManifestHash: "sha256:first",
                    sessionId: "vsi_first",
                  },
                }),
                ingressEventId: "wake_24",
              },
              {
                seq: "25",
                wake: buildHostedExecutionVaultSyncImportWake({
                  eventId: "evt_vault_sync_second",
                  memberId: "member_123",
                  occurredAt: "2026-04-08T00:00:01.000Z",
                  vaultSync: {
                    localManifestHash: "sha256:second",
                    sessionId: "vsi_second",
                  },
                }),
                ingressEventId: "wake_25",
              },
            ],
            inputCommittedSeq: "24",
            inputCursorVersion: "4",
            runId: "run_123",
            triggerKind: "external_ingress",
            userId: "member_123",
          },
        },
        restored: createRestored(),
        runtime: createRuntime(),
        runtimeEnv: {},
      });

      expect(result.committedResult.result.redactedDetails).toEqual({
        vaultSyncImports: [
          expect.objectContaining({
            conflictCount: 0,
            sessionId: "vsi_first",
          }),
          expect.objectContaining({
            conflictCount: 1,
            sessionId: "vsi_second",
          }),
        ],
      });
      expect(result.committedResult.result.redactedDetails).not.toHaveProperty("vaultSyncImport");
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs the assistant maintenance lane after member activation enables managed channels", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.executeHostedIngressEvent.mockResolvedValueOnce({
        bootstrapResult: {
          assistantConfigStatus: "hosted-env",
          assistantConfigured: true,
          assistantProvider: "openai-compatible",
          assistantSeeded: true,
          emailAutoReplyEnabled: false,
          linqAutoReplyEnabled: true,
          telegramAutoReplyEnabled: false,
          vaultCreated: true,
        },
        conversationMetrics: null,
        ingressLane: "member-activated",
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
                wake: buildHostedExecutionMemberActivatedWake({
                  eventId: "evt_member_activation_followup",
                  memberChannels: {
                    email: false,
                    linq: true,
                    telegram: false,
                  },
                  memberId: "member_123",
                  occurredAt: "2026-04-08T00:00:01.000Z",
                }),
                ingressEventId: "wake_24",
              },
            ],
            inputCommittedSeq: "24",
            inputCursorVersion: "4",
            runId: "run_123",
            triggerKind: "external_ingress",
            userId: "member_123",
          },
        },
        restored: createRestored(),
        runtime: createRuntime(),
        runtimeEnv: {},
      });

      expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedNoopSystemWakeLane).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      assert.equal(result.committedResult.result.eventsHandled, 1);
      assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:30:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs the assistant maintenance lane after member channel updates enable managed channels", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.executeHostedIngressEvent.mockResolvedValueOnce({
        bootstrapResult: null,
        conversationMetrics: null,
        ingressLane: "member-channels-updated",
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
                wake: buildHostedExecutionMemberChannelsUpdatedWake({
                  eventId: "evt_member_channels_updated_followup",
                  memberChannels: {
                    email: false,
                    linq: true,
                    telegram: false,
                  },
                  memberId: "member_123",
                  occurredAt: "2026-04-08T00:00:01.000Z",
                }),
                ingressEventId: "wake_24",
              },
            ],
            inputCommittedSeq: "24",
            inputCursorVersion: "4",
            runId: "run_123",
            triggerKind: "external_ingress",
            userId: "member_123",
          },
        },
        restored: createRestored(),
        runtime: createRuntime(),
        runtimeEnv: {},
      });

      expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedNoopSystemWakeLane).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      assert.equal(result.committedResult.result.eventsHandled, 1);
      assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:30:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to nextWakeAt when immediate assistant work exceeds the local drain budget", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.executeHostedIngressEvent.mockResolvedValueOnce({
        bootstrapResult: null,
        conversationMetrics: {
          nextWakeAt: null,
          parserProcessed: 0,
        },
        ingressLane: "conversation-message",
        shareImportResult: null,
        shareImportTitle: null,
      });
      mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValue({
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: "2026-04-08T00:00:00.000Z",
        parserProcessed: 0,
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
                wake: buildHostedExecutionLinqConversationMessageWake({
                  eventId: "evt_linq_budget",
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
                }),
                ingressEventId: "wake_24",
              },
            ],
            inputCommittedSeq: "24",
            inputCursorVersion: "4",
            runId: "run_123",
            triggerKind: "external_ingress",
            userId: "member_123",
          },
        },
        restored: createRestored(),
        runtime: createRuntime(),
        runtimeEnv: {},
      });

      expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledTimes(8);
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      expect(mocks.snapshotHostedExecutionContext).toHaveBeenCalledTimes(1);
      assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:00:00.000Z");
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "warn",
          message:
            "Hosted runtime exhausted the immediate maintenance drain budget; leaving remaining internal work on nextWakeAt.",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares the local drain budget across assistant and device-sync follow-up work", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValue({
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: "2026-04-08T00:00:00.000Z",
        parserProcessed: 0,
      });
      mocks.runHostedDeviceSyncWakeLane.mockResolvedValue({
        deviceSyncProcessed: 1,
        deviceSyncSkipped: false,
        nextWakeAt: "2026-04-08T00:00:00.000Z",
        parserProcessed: 0,
      });

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

      expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledTimes(4);
      expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(4);
      expect(mocks.snapshotHostedExecutionContext).toHaveBeenCalledTimes(1);
      assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:00:00.000Z");
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "warn",
          message:
            "Hosted runtime exhausted the immediate maintenance drain budget; leaving remaining internal work on nextWakeAt.",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
