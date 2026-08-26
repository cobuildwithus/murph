import {
  createDeliveryEffect,
  createDueAssistantWorkspace,
  createNoDirtyRuntimeDeviceSyncPortMethods,
  createPhaseInput,
  createSystemMailboxItem,
  expectAssistantLaneCallWithoutDeviceSyncOptions,
  mocks,
  withoutAssistantTurnTimingLogs,
  writeHostedPhaseExperimentSource,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";

import type {
  RuntimeClinicalRecordsPort,
  RuntimeDeviceSyncConnectLinkRequest,
  RuntimeDeviceSyncPort,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type HostedMailboxItem,
  type HostedRuntimeGroupSummary,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeLatencyTraceRequest,
  type HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";
import { parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
} from "@murphai/hosted-execution/orchestration-control";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeVault,
  patchAutomation,
  showAutomation,
  splitAutomationAvailabilityConflictBlock,
  upsertAutomation,
} from "@murphai/core";
import {
  buildOnboardingFirstPersonalReadAutomationSaveRequest,
  completeAssistantOnboarding,
  getAssistantCronJob,
  markAssistantContextSnapshotDirty,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
  readAssistantContextSnapshotState,
  saveAssistantAutomationState,
  saveAssistantSession,
  setAssistantCronJobEnabled,
  upsertAssistantInputEvent,
  type AssistantAutomationOperationScope,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import {
  runHostedWorkspaceAssistantPhase,
  type HostedWorkspaceRuntimeAssistantPhaseInput,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";

describe("runHostedWorkspaceAssistantPhase runtime logs", () => {it("skips system mailbox maintenance after foreground input arrives during the run", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: expect.any(String),
      nextWakeReason: "assistant",
      progressed: false,
    }));
  });

  it("skips the assistant lane when foreground input arrives during system mailbox preparation", async () => {
    let shouldYield = false;
    let fetchSnapshotCalls = 0;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYield);
    const deviceSyncPort = {
      ...createNoDirtyRuntimeDeviceSyncPortMethods(),
      async applyUpdates() {
        return {
          appliedAt: "2026-04-29T00:00:00.000Z",
          updates: [],
          userId: "member_synthetic_phase",
        };
      },
      async createConnectLink() {
        throw new Error("createConnectLink should not be called.");
      },
      async fetchSnapshot() {
        fetchSnapshotCalls += 1;
        throw new Error("fetchSnapshot should not run after foreground preemption.");
      },
    } satisfies RuntimeDeviceSyncPort;
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      shouldYield = true;
      return {
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_processed",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["whoop_v2"],
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(fetchSnapshotCalls).toBe(0);
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();

    await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: expect.objectContaining({
        itemId: "system_mailbox_item_processed",
      }),
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("keeps foreground imports active while recording a clinical outcome", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: {
        ...createSystemMailboxItem(),
        postCheckpointRecord: {
          kind: "clinical-records.outcome-recorded" as const,
          request: {
            counts: {
              createdCount: 0,
              executableDecisionCount: 0,
              fetchedPageCount: 1,
              fetchedResourceFamilyCount: 1,
              rawFileCount: 2,
              retractedCount: 0,
              reviewDecisionCount: 0,
              skippedExistingCount: 0,
              supersededCount: 0,
            },
            generation: 1,
            runId: "clinical_run_1",
            status: "completed" as const,
          },
        },
        routeAction: "run-clinical-records-sync" as const,
        status: "recording" as const,
        wake: {
          eventId: "clinical-records.sync-requested:phase-test",
          generation: 1,
          kind: "clinical-records.sync-requested" as const,
          occurredAt: "2026-04-27T00:00:00.000Z",
          runId: "clinical_run_1",
          userId: "member_synthetic_phase",
        },
      },
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "clinical-records",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      shouldYieldBackgroundMaintenance,
    }));

    expect(result.afterCheckpointKeepsForegroundImportLoop).toBe(true);
    await result.afterCheckpoint?.();
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: expect.objectContaining({
        routeAction: "run-clinical-records-sync",
      }),
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      signal: expect.any(AbortSignal),
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("defers due provider cleanup when foreground input arrives during system mailbox preparation", async () => {
    let shouldYield = false;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYield);
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:08:00.000Z",
    });
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      "2026-04-27T00:14:00.000Z",
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      shouldYield = true;
      return {
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_processed",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:09:00.000Z",
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    // The due checkpoint re-arms durably into the cleanup owner state.
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:09:00.000Z",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: expect.objectContaining({
        itemId: "system_mailbox_item_processed",
      }),
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
  });

  it("keeps provider cleanup deferred when foreground-yield input is not ingested yet", async () => {
    let shouldYield = false;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYield);
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:08:00.000Z",
    });
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      "2026-04-27T00:14:00.000Z",
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      shouldYield = true;
      return {
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_processed",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      activeTurnInputIngested: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:09:00.000Z",
      shouldYieldBackgroundMaintenance,
    }));

    // The due checkpoint re-arms durably into the cleanup owner state.
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:09:00.000Z",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: expect.objectContaining({
        itemId: "system_mailbox_item_processed",
      }),
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
  });

  it("checkpoints a consumed alarm wake when foreground input was ingested", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
    }));
  });

  it("defers cleanup planning when the foreground-yield hook is already tripped", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:09:00.000Z",
      shouldYieldBackgroundMaintenance: () => true,
    }));

    expect(result).toBeDefined();
    for (const call of mocks.prepareHostedProviderCleanupPlan.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ deferred: true }));
    }
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
  });

  it("durably queues cleanup with a future wake when a foreground turn terminalizes Linq input without delivery effects", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      assistantAutomationTerminalLinqCleanup: ["linq_terminal_1"],
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(mocks.prepareHostedProviderCleanupPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        deferred: true,
        terminalCleanupMessageIds: ["linq_terminal_1"],
      }),
    );
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: ["linq_terminal_1"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
  });

  it("lets assistant work consume a legacy assistant-labeled alarm without running device-sync", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: true,
      }),
    }));
    expect("nextWakeReason" in result).toBe(false);
  });

  it("services a queued device-sync wake after a legacy assistant alarm has no work", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    const assistantContinuationAt = "2026-04-27T00:03:00.000Z";
    const deviceContinuationAt = "2026-04-27T00:05:00.000Z";
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "device-sync.wake:assistant-shadow-recovery",
        kind: "device-sync.wake" as const,
        occurredAt: dueAt,
        reason: "reconcile_due" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.getAssistantCronStatus
      .mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 1,
        nextRunAt: dueAt,
        runningJobs: 0,
        totalJobs: 1,
      })
      .mockResolvedValue({
        dueJobs: 0,
        enabledJobs: 1,
        nextRunAt: "2026-04-28T00:00:00.000Z",
        runningJobs: 0,
        totalJobs: 1,
      });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: assistantContinuationAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_assistant_shadow_recovery",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        deviceSyncProcessed: 1,
        deviceSyncSkipped: false,
        mailboxLane: "device-sync",
        nextWakeAt: deviceContinuationAt,
        nextWakeReason: "device-sync.reconcile",
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => dueAt,
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      shouldYieldBackgroundMaintenance,
      workspace: createDueAssistantWorkspace(),
    }));

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: ["run-device-sync-wake"],
        allowedWakeKinds: ["device-sync.wake"],
        runtimeLogContext: {
          attemptId: "attempt_synthetic_phase",
          leaseGeneration: "3",
          workspaceVersion: "8",
        },
        shouldYieldBackgroundMaintenance,
      }),
    );
    expect(
      mocks.runHostedAssistantAutomationLane.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.invocationCallOrder[0] ?? 0,
    );
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      deviceSyncMaintenanceRan: true,
      nextWakeAt: assistantContinuationAt,
      progressed: true,
    }));
    expect("nextWakeReason" in result).toBe(false);
    await result.afterCheckpoint?.();
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        item: deviceSyncItem,
      }),
    );
  });

  it("leaves unrelated maintenance untouched when shadow recovery finds no device wake", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-shadow-recovery-"));
    const vaultRoot = path.join(parentRoot, "vault");
    mocks.getAssistantCronStatus
      .mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 1,
        nextRunAt: dueAt,
        runningJobs: 0,
        totalJobs: 1,
      })
      .mockResolvedValue({
        dueJobs: 0,
        enabledJobs: 1,
        nextRunAt: "2026-04-28T00:00:00.000Z",
        runningJobs: 0,
        totalJobs: 1,
      });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });
    mocks.queueHostedAssistantPendingMessageVolumeReceiptsForVault.mockResolvedValueOnce(1);

    try {
      await initializeVault({
        createdAt: dueAt,
        timezone: "America/New_York",
        vaultRoot,
      });
      await writeHostedPhaseExperimentSource(vaultRoot);
      await markAssistantContextSnapshotDirty({
        domains: ["experiments"],
        vaultRoot,
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        now: () => dueAt,
        resolvedDeviceSync: {
          providerConfigs: {
            whoop: {
              clientId: "synthetic-whoop-client",
              clientSecret: "synthetic-whoop-secret",
            },
          },
          publicBaseUrl: "https://device-sync.example.test",
          secret: "synthetic-device-sync-secret",
        },
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));

      expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
      expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
      expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedRouteActions: ["run-device-sync-wake"],
          allowedWakeKinds: ["device-sync.wake"],
        }),
      );
      expect(mocks.queueHostedAssistantPendingMessageVolumeReceiptsForVault)
        .not.toHaveBeenCalled();
      expect(mocks.resolveHostedSystemMailboxNextWakeCandidate).not.toHaveBeenCalledWith(
        expect.objectContaining({
          allowedRouteActions: ["apply-member-preferences"],
        }),
      );
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      expect("deviceSyncMaintenanceRan" in result).toBe(false);
      expect(result.redactedStatus).toEqual(expect.objectContaining({
        hostedSystemMailboxPrepared: 0,
      }));
      await expect(readAssistantContextSnapshotState(vaultRoot)).resolves.toMatchObject({
        pendingDirtyDomains: ["experiments"],
      });
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("keeps queued device-sync recovery behind real assistant progress", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    mocks.getAssistantCronStatus
      .mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 1,
        nextRunAt: dueAt,
        runningJobs: 0,
        totalJobs: 1,
      })
      .mockResolvedValue({
        dueJobs: 0,
        enabledJobs: 1,
        nextRunAt: "2026-04-28T00:00:00.000Z",
        runningJobs: 0,
        totalJobs: 1,
      });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: {
        ...createSystemMailboxItem(),
        routeAction: "run-device-sync-wake" as const,
        wake: {
          eventId: "device-sync.wake:assistant-progress-priority",
          kind: "device-sync.wake" as const,
          occurredAt: dueAt,
          reason: "reconcile_due" as const,
          userId: "member_synthetic_phase",
        },
      },
      itemId: "system_mailbox_item_assistant_progress_priority",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        deviceSyncProcessed: 1,
        deviceSyncSkipped: false,
        mailboxLane: "device-sync",
        nextWakeAt: "2026-04-27T00:05:00.000Z",
        nextWakeReason: "device-sync.reconcile",
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => dueAt,
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: createDueAssistantWorkspace(),
    }));

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ progressed: true }));
  });

  it("keeps queued device-sync recovery behind fresh assistant input", async () => {
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: {
        ...createSystemMailboxItem(),
        routeAction: "run-device-sync-wake" as const,
        wake: {
          eventId: "device-sync.wake:fresh-input-priority",
          kind: "device-sync.wake" as const,
          occurredAt: "2026-04-27T00:00:00.000Z",
          reason: "reconcile_due" as const,
          userId: "member_synthetic_phase",
        },
      },
      itemId: "system_mailbox_item_fresh_input_priority",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        deviceSyncProcessed: 1,
        deviceSyncSkipped: false,
        mailboxLane: "device-sync",
        nextWakeAt: "2026-04-27T00:05:00.000Z",
        nextWakeReason: "device-sync.reconcile",
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-device-sync-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: createDueAssistantWorkspace(),
    }));

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
  });

  it("does not run deferred device-sync work from an assistant-labeled wake", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      shouldYieldBackgroundMaintenance,
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      nextWakeReason: "assistant",
      progressed: false,
    }));
  });

  it("does not pass foreground-input yield hooks into the assistant lane", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      shouldYieldBackgroundMaintenance,
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
  });

  it("lets assistant work consume a legacy null-labeled alarm without running device-sync", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: null,
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: true,
      }),
    }));
    expect("nextWakeReason" in result).toBe(false);
  });

  it("does not re-arm a stale assistant wake as a skipped device-sync retry during a foreground nudge", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: true,
      }),
    }));
    expect("nextWakeReason" in result).toBe(false);
  });

  it("does not run legacy assistant-labeled device-sync before assistant work", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
    }));
    expect("nextWakeReason" in result).toBe(false);
  });

  it("drops stale assistant automation wakes before reporting scheduled work", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: "2026-04-26T23:59:59.000Z",
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual({
      progressed: false,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: false,
      }),
    });
  });

  it("does not label an aggregate reminder as invocation-local foreground work", async () => {
    const reminderWakeAt = "2026-04-27T06:00:00.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      assistantAutomationSelectedInputWakeAt: null,
      nextWakeAt: reminderWakeAt,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result.nextWakeAt).toBe(reminderWakeAt);
    expect(result).not.toHaveProperty("invocationLocalAssistantWakeAt");
  });

  it("labels a selected foreground retry as invocation-local work", async () => {
    const retryWakeAt = "2026-04-27T00:00:30.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      assistantAutomationSelectedInputWakeAt: retryWakeAt,
      nextWakeAt: retryWakeAt,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result.nextWakeAt).toBe(retryWakeAt);
    expect(result.invocationLocalAssistantWakeAt).toBe(retryWakeAt);
  });

  it("does not checkpoint no-op alarms only because automation returned a future wake", async () => {
    const nextWakeAt = "2026-04-27T00:01:00.000Z";
    const existingWakeAt = "2026-04-27T00:05:00.000Z";
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: existingWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: nextWakeAt,
        hostedAssistantProgressed: true,
      }),
    });
    expect(logRequests.at(-1)?.entries[0]).toEqual(expect.objectContaining({
      eventCode: "assistant.pass_finished",
      redactedJson: expect.objectContaining({
        assistantAutomationProgressed: false,
        nextWakeAtPresent: true,
        progressed: true,
      }),
    }));
  });

  it("checkpoints a new future automation wake from manual runtime maintenance", async () => {
    const nextWakeAt = "2026-04-27T00:05:00.000Z";
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: null,
    }));

    expect(result).toEqual({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: nextWakeAt,
        hostedAssistantProgressed: true,
      }),
    });
    expect(logRequests.at(-1)?.entries[0]).toEqual(expect.objectContaining({
      eventCode: "assistant.pass_finished",
      redactedJson: expect.objectContaining({
        assistantAutomationProgressed: false,
        nextWakeAtPresent: true,
        progressed: true,
      }),
    }));
  });

  it("checkpoints a consumed alarm wake when automation advances it", async () => {
    const nextWakeAt = "2026-04-27T00:01:00.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: nextWakeAt,
        hostedAssistantProgressed: true,
      }),
    }));
    expect("nextWakeReason" in result).toBe(false);
  });

  it("preserves an existing workspace wake when active input skips device-sync work", async () => {
    const nextWakeAt = "2026-04-27T00:05:00.000Z";

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      foregroundReplyFailed: 0,
      nextWakeAt,
      progressed: false,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: nextWakeAt,
        hostedAssistantProgressed: false,
      }),
    }));
  });

  it("schedules a near follow-up wake when active input consumes a due alarm and skips device sync", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
    }));
  });

  it("does not treat assistant-labeled nudge wakes as device-sync retries", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual({
      progressed: false,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: false,
      }),
    });
  });

  it("runs device-sync work for a due device-sync alarm without active input", async () => {
    const nextWakeAt = "2026-04-27T00:01:00.000Z";
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDirtyPendingFetch: false,
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("drains due provider cleanup after idle device-sync-only work", async () => {
    const nextWakeAt = "2026-04-27T00:01:00.000Z";
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: createDueAssistantWorkspace({
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: {
          nextWakeAt: null,
        },
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      redactedStatus: expect.objectContaining({
        hostedProviderCleanupAttemptedLinqItems: 1,
        hostedProviderCleanupDeletedLinqItems: 1,
        hostedProviderCleanupFailedLinqItems: 0,
      }),
    }));
  });

  it("defers due provider cleanup when foreground input appears before post-checkpoint cleanup", async () => {
    let shouldYield = false;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYield);
    const deviceSyncWakeAt = "2026-04-27T00:10:00.000Z";
    // The re-armed first-deferred wake (mocked as now + 5 minutes) recorded
    // into the cleanup owner state when the yielded drain defers.
    const providerCleanupWakeAt = "2026-04-27T00:05:00.000Z";
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValue({
      nextWakeAt: null,
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: deviceSyncWakeAt,
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      shouldYieldBackgroundMaintenance,
      workspace: createDueAssistantWorkspace({
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: deviceSyncWakeAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));

    shouldYield = true;
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    // The yielded drain re-arms the due checkpoint durably into the cleanup
    // owner state instead of carrying a plan-only wake.
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: providerCleanupWakeAt,
      },
      linqMessageIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
      nextWakeAt: providerCleanupWakeAt,
      nextWakeReason: "assistant",
    }));
  });

  it("preserves durable outbox wakes after idle device-sync-only work", async () => {
    const outboxWakeAt = "2026-04-27T00:05:00.000Z";
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValue(outboxWakeAt);
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: createDueAssistantWorkspace({
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: outboxWakeAt,
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      progressed: true,
    }));
  });

  it("checkpoints a consumed due device-sync alarm when no follow-up work remains", async () => {
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: null,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: true,
      }),
    }));
    expect("nextWakeReason" in result).toBe(false);
  });

  it("preserves a skipped due device-sync alarm reason when fresh input owns the hot path", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("keeps an earlier skipped device-sync retry before a later local schedule", async () => {
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce("2026-04-27T01:00:00.000Z");
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: createDueAssistantWorkspace({
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("uses a skipped device-sync retry instead of a stale local schedule", async () => {
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce("2026-04-26T23:59:59.000Z");
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("uses the local schedule when a due device-sync wake already ran in the invocation", async () => {
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce("2026-04-27T00:10:00.000Z");
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      deviceSyncWorkspaceWakeHandled: {
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
      },
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: createDueAssistantWorkspace({
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("re-arms a newer due device-sync retry when an earlier wake already ran in the invocation", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      deviceSyncWorkspaceWakeHandled: {
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
      },
      importedCount: 1,
      now: () => "2026-04-27T00:00:30.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:00:30.000Z",
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("preserves a future skipped device-sync retry after same-invocation maintenance", async () => {
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce("2026-04-27T01:00:00.000Z");
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      deviceSyncWorkspaceWakeHandled: {
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
      },
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:00:30.000Z",
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("exposes safe hosted device list, connect, and reconcile actions from the platform port", async () => {
    const connectLinkRequests: RuntimeDeviceSyncConnectLinkRequest[] = [];
    const noDataOutreachRequests: Array<
      Parameters<NonNullable<RuntimeDeviceSyncPort["configureNoDataOutreach"]>>[0]
    > = [];
    const fetchSnapshotRequests: Array<Parameters<RuntimeDeviceSyncPort["fetchSnapshot"]>[0]> = [];
    const reconcileRequests: Array<Parameters<NonNullable<RuntimeDeviceSyncPort["reconcileAccount"]>>[0]> = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const accountSnapshots = Array.from({ length: 33 }, (_, index) => ({
      connection: {
        accessTokenExpiresAt: "2026-05-01T00:00:00.000Z",
        connectedAt: "2026-04-28T00:00:00.000Z",
        createdAt: new Date(Date.parse("2026-04-28T00:00:00.000Z") - index * 1_000)
          .toISOString(),
        displayName: index === 0 ? "Training wearable" : `Training wearable ${index + 1}`,
        externalAccountId: `external-account-not-for-assistant-${index + 1}`,
        id: index === 0
          ? "conn_synthetic_whoop"
          : `conn_synthetic_whoop_${String(index + 1).padStart(2, "0")}`,
        metadata: { privateProviderDetail: "not-for-assistant" },
        provider: "whoop",
        scopes: ["read:recovery"],
        status: "active" as const,
      },
      credential: {
        credentialMetadata: { privateCredentialDetail: "not-for-assistant" },
        kind: "none" as const,
      },
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-29T00:00:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-28T23:59:00.000Z",
        lastWebhookAt: "2026-04-28T23:58:00.000Z",
        nextReconcileAt: null,
      },
    }));
    const accountCursor = {
      createdAt: accountSnapshots[31]!.connection.createdAt,
      id: accountSnapshots[31]!.connection.id,
    };
    const deviceSyncPort = {
      ...createNoDirtyRuntimeDeviceSyncPortMethods(),
      async applyUpdates() {
        return {
          appliedAt: "2026-04-29T00:00:00.000Z",
          updates: [],
          userId: "member_synthetic_phase",
        };
      },
      async createConnectLink(request) {
        connectLinkRequests.push(request);
        return {
          authorizationUrl: `https://connect.example.test/${request.connectTarget}`,
          connectUrl: `https://connect.example.test/${request.connectTarget}`,
          expiresAt: "2026-04-29T00:05:00.000Z",
          provider: request.connectTarget,
          providerLabel: "WHOOP",
        };
      },
      async configureNoDataOutreach(request) {
        noDataOutreachRequests.push(request);
        return {
          action: "configure_no_data_outreach" as const,
          effectiveAfterDays: request.mode === "off"
            ? null
            : request.mode === "after_days"
              ? request.afterDays
              : 5,
          setting: request.mode === "off"
            ? "off" as const
            : request.mode === "after_days"
              ? "custom" as const
              : "default" as const,
          sourceProviderSlug: request.sourceProviderSlug,
          status: "saved" as const,
        };
      },
      async fetchSnapshot(request) {
        const pageIndex = fetchSnapshotRequests.length;
        fetchSnapshotRequests.push(request);
        return {
          connections: pageIndex === 0
            ? accountSnapshots.slice(0, 32)
            : accountSnapshots.slice(32),
          generatedAt: "2026-04-29T00:00:00.000Z",
          nextCursor: pageIndex === 0 ? accountCursor : null,
          userId: "member_synthetic_phase",
        };
      },
      async reconcileAccount(request) {
        reconcileRequests.push(request);
        return {
          connectionId: request.connectionId,
          occurredAt: "2026-04-29T00:01:00.000Z",
          status: "queued" as const,
        };
      },
    } satisfies RuntimeDeviceSyncPort;

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      deviceSyncMessagingReturnTarget: "telegram",
      logRequests,
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["fitbit", "dexcom_v3", "dexcom"],
            region: "us",
          },
          strava: {
            clientId: "synthetic-strava-client",
            clientSecret: "synthetic-strava-secret",
          },
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
    }));

    const hydratedContext = mocks.hydrateHostedExecutionDefaultTarget.mock.calls[0]?.[0];
    expect(hydratedContext).toEqual({
      hosted: expect.objectContaining({
        deviceConnectProviders: [
          { label: "WHOOP", provider: "whoop" },
          { label: "Fitbit", provider: "fitbit" },
          { label: "Dexcom (G6 and older)", provider: "dexcom" },
        ],
        deviceTool: expect.objectContaining({ request: expect.any(Function) }),
        memberId: "member_synthetic_phase",
      }),
    });
    const deviceTool = hydratedContext?.hosted?.deviceTool;
    if (!deviceTool) {
      throw new Error("Expected hosted device tool.");
    }
    const abortController = new AbortController();
    await expect(deviceTool.request({
      action: "list_accounts",
      provider: " whoop ",
      sourceProvider: " whoop_v2 ",
    }, { signal: abortController.signal })).resolves.toEqual({
      accounts: accountSnapshots.map(({ connection, localState }) => ({
        accountId: connection.id,
        displayName: connection.displayName,
        lastErrorCode: localState.lastErrorCode,
        lastSyncCompletedAt: localState.lastSyncCompletedAt,
        provider: connection.provider,
        status: connection.status,
      })),
      action: "list_accounts",
      provider: "whoop",
      sourceProvider: "whoop_v2",
    });
    expect(fetchSnapshotRequests).toEqual([
      {
        includeCredentialMaterial: false,
        provider: "whoop",
        signal: abortController.signal,
        sourceProviderSlug: "whoop_v2",
      },
      {
        cursor: accountCursor,
        includeCredentialMaterial: false,
        limit: 32,
        provider: "whoop",
        signal: abortController.signal,
        sourceProviderSlug: "whoop_v2",
      },
    ]);
    await expect(
      deviceTool.request({
        action: "connect",
        provider: "whoop",
      }),
    ).resolves.toEqual({
      action: "connect",
      link: {
        authorizationUrl: "https://connect.example.test/whoop",
        connectUrl: "https://connect.example.test/whoop",
        expiresAt: "2026-04-29T00:05:00.000Z",
        provider: "whoop",
        providerLabel: "WHOOP",
      },
    });
    expect(connectLinkRequests).toEqual([
      { connectTarget: "whoop", messagingReturnTarget: "telegram" },
    ]);
    await expect(deviceTool.request({
      accountId: "conn_synthetic_whoop",
      action: "reconcile",
    }, { signal: abortController.signal })).resolves.toEqual({
      accountId: "conn_synthetic_whoop",
      action: "reconcile",
      occurredAt: "2026-04-29T00:01:00.000Z",
      status: "queued",
    });
    expect(reconcileRequests).toEqual([{
      connectionId: "conn_synthetic_whoop",
      signal: abortController.signal,
    }]);
    await expect(deviceTool.request({
      action: "configure_no_data_outreach",
      afterDays: 10,
      mode: "after_days",
      sourceProvider: "garmin",
    })).rejects.toThrow("current private member input");
    await expect(deviceTool.request({
      action: "configure_no_data_outreach",
      afterDays: 10,
      mode: "after_days",
      sourceProvider: "garmin",
    }, {
      acceptedInputAuthority: {
        assistantInputId: "ain_00000000000000000000000000000001",
      },
      signal: abortController.signal,
    })).resolves.toEqual({
      action: "configure_no_data_outreach",
      effectiveAfterDays: 10,
      setting: "custom",
      sourceProvider: "garmin",
      status: "saved",
    });
    expect(noDataOutreachRequests).toEqual([{
      afterDays: 10,
      assistantInputId: "ain_00000000000000000000000000000001",
      mode: "after_days",
      signal: abortController.signal,
      sourceProviderSlug: "garmin",
    }]);
    await expect(deviceTool.request({
      action: "connect",
      provider: "unconfigured-provider",
    })).rejects.toThrow("not available to connect");
    await expect(deviceTool.request({
      action: "connect",
      provider: "strava",
    })).rejects.toThrow("not available to connect");
    await expect(deviceTool.request({
      action: "connect",
      provider: "dexcom_v3",
    })).rejects.toThrow("not available to connect");
    await expect(deviceTool.request({
      action: "connect",
      provider: "dexcom",
    })).resolves.toEqual({
      action: "connect",
      link: expect.objectContaining({ provider: "dexcom" }),
    });
    expect(connectLinkRequests).toEqual([
      { connectTarget: "whoop", messagingReturnTarget: "telegram" },
      { connectTarget: "dexcom", messagingReturnTarget: "telegram" },
    ]);
    await Promise.resolve();
    const deviceConnectLogs = logRequests
      .flatMap((request) => request.entries)
      .filter((entry) => entry.eventCode === "assistant.device_connect");
    expect(deviceConnectLogs.map((entry) => entry.redactedJson)).toEqual([
      expect.objectContaining({
        deviceConnectIssueLinkAvailable: true,
        deviceConnectPortPresent: true,
        deviceConnectProviderCount: 3,
        deviceConnectProviders: ["whoop", "fitbit", "dexcom"],
        deviceConnectStage: "context",
        deviceConnectStatus: "available",
      }),
      expect.objectContaining({
        deviceConnectStage: "request",
        deviceConnectStatus: "requested",
        deviceConnectReturnTarget: "telegram",
        provider: "whoop",
      }),
      expect.objectContaining({
        deviceConnectStage: "request",
        deviceConnectStatus: "issued",
        deviceConnectReturnTarget: "telegram",
        expiresAtPresent: true,
        provider: "whoop",
      }),
      expect.objectContaining({
        deviceConnectStage: "request",
        deviceConnectStatus: "requested",
        deviceConnectReturnTarget: "telegram",
        provider: "dexcom",
      }),
      expect.objectContaining({
        deviceConnectStage: "request",
        deviceConnectStatus: "issued",
        deviceConnectReturnTarget: "telegram",
        expiresAtPresent: true,
        provider: "dexcom",
      }),
    ]);
    expect(JSON.stringify(deviceConnectLogs)).not.toContain("connect.example.test");
    expect(JSON.stringify(deviceConnectLogs)).not.toContain("synthetic-whoop-secret");
    expect(JSON.stringify(await deviceTool.request({ action: "list_accounts" })))
      .not.toContain("not-for-assistant");
  });

  it("exposes the existing Clinical Records link method to the hosted assistant context", async () => {
    const createConnectLink = vi.fn<
      NonNullable<RuntimeClinicalRecordsPort["createConnectLink"]>
    >(async () => ({
      connectUrl:
        `https://app.example.test/records/connect#clinicalRecordsIntent=cr_${"a".repeat(32)}`,
      expiresAt: "2026-07-16T12:15:00.000Z",
      ok: true,
    }));
    const clinicalRecordsPort: RuntimeClinicalRecordsPort = {
      createConnectLink,
      async fetchPage() {
        throw new Error("Clinical Records link test should not fetch a page.");
      },
      async readRun() {
        throw new Error("Clinical Records link test should not read a run.");
      },
      async recordOutcome() {
        throw new Error("Clinical Records link test should not record an outcome.");
      },
    };

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeClinicalRecordsPort: clinicalRecordsPort,
    }));

    const hydratedContext = mocks.hydrateHostedExecutionDefaultTarget.mock.calls[0]?.[0];
    const controller = new AbortController();
    await expect(
      hydratedContext?.hosted?.clinicalRecordsConnectLinkTool?.createConnectLink({
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(createConnectLink).toHaveBeenCalledWith({ signal: controller.signal });
  });

  it("injects active hosted device connection status as dynamic context for due cron lanes", async () => {
    const fetchSnapshotRequests: Array<Parameters<RuntimeDeviceSyncPort["fetchSnapshot"]>[0]> = [];
    const deviceSyncPort = {
      ...createNoDirtyRuntimeDeviceSyncPortMethods(),
      async applyUpdates() {
        return {
          appliedAt: "2026-04-29T00:00:00.000Z",
          updates: [],
          userId: "member_synthetic_phase",
        };
      },
      async createConnectLink() {
        throw new Error("createConnectLink should not be called.");
      },
      async fetchSnapshot(request) {
        fetchSnapshotRequests.push(request);
        return {
          connections: [
            {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-29T00:00:00.000Z",
                createdAt: "2026-04-29T00:00:00.000Z",
                displayName: null,
                externalAccountId: "synthetic-external-account",
                id: "conn_synthetic_whoop",
                metadata: {},
                provider: "junction",
                scopes: [],
                setupPhase: "source_confirmed",
                status: "active",
              },
              credential: {
                credentialMetadata: {},
                kind: "provider_config",
                providerConfigKey: "junction",
              },
              localState: {
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: "2026-04-22T00:00:00.000Z",
                lastSyncErrorAt: null,
                lastSyncStartedAt: "2026-04-29T00:00:00.000Z",
                lastWebhookAt: null,
                nextReconcileAt: null,
              },
              sources: [
                {
                  displayName: null,
                  firstSeenAt: "2026-04-22T00:00:00.000Z",
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  lastSeenAt: "2026-04-29T00:00:00.000Z",
                  lastDataAt: null,
                  resourceCount: 0,
                  sourceProviderSlug: "whoop_v2",
                  status: "connected",
                },
              ],
            },
          ],
          generatedAt: "2026-04-29T00:00:00.000Z",
          userId: "member_synthetic_phase",
        };
      },
    } satisfies RuntimeDeviceSyncPort;
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: null,
      runningJobs: 0,
      totalJobs: 1,
    });
    let dynamicContextPrompt: string | null | undefined;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      dynamicContextPrompt =
        await laneInput.buildBackgroundDynamicContextPrompt?.({});
      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    expect(fetchSnapshotRequests).toEqual([]);
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["fitbit", "garmin", "oura", "withings", "whoop_v2"],
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
    }));

    const assistantLaneCall = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    expect(assistantLaneCall?.executionContext.hosted?.automationTool).toBeUndefined();
    expect(assistantLaneCall?.executionContext.hosted?.groupTool).toBeUndefined();
    expect(assistantLaneCall?.executionContext.hosted?.groupSharedReader).toBeUndefined();
    expect(assistantLaneCall?.executionContext.hosted?.createScheduledGroupTools)
      .toEqual(expect.any(Function));
    expect(assistantLaneCall?.executionContext.hosted?.deviceTool).toEqual(
      expect.objectContaining({ request: expect.any(Function) }),
    );
    expect(fetchSnapshotRequests).toEqual([
      {
        includeCredentialMaterial: false,
        signal: expect.any(AbortSignal),
      },
    ]);
    for (const request of fetchSnapshotRequests) {
      expect(request).not.toHaveProperty("limit");
    }
    expect(assistantLaneCall?.signal).toBeUndefined();
    expect(assistantLaneCall).not.toHaveProperty("suppressActiveTurnInputRefresh");
    expect(assistantLaneCall?.executionContext.hosted?.dynamicContextPrompts)
      .toBeUndefined();
    expect(dynamicContextPrompt).toContain("WHOOP has an active connection");
    expect(dynamicContextPrompt).toContain(
      "Do not offer initial wearable connection",
    );
    expect(dynamicContextPrompt).not.toContain("member_alpha");
    expect(dynamicContextPrompt).not.toContain("member_beta");
    expect(dynamicContextPrompt).not.toContain("needs reconnect");
    expect(dynamicContextPrompt).not.toContain("synthetic-external-account");
    expect(dynamicContextPrompt).not.toContain("refresh failed");
    expect(dynamicContextPrompt).not.toContain("Private household label");
    expect(dynamicContextPrompt).not.toContain("group_private_runtime_identifier");
    expect(dynamicContextPrompt).not.toContain("<REDACTED_PHONE>");
    expect(dynamicContextPrompt).not.toContain("<REDACTED_EMAIL>");
  });

  it("does not read the current group when no background work is due", async () => {
    const request = vi.fn(async () => {
      throw new Error("Group reads should remain lazy when no background work is due.");
    });
    let dynamicContextPrompt: string | null | undefined;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      dynamicContextPrompt =
        await laneInput.buildBackgroundDynamicContextPrompt?.({});
      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeGroupToolPort: { request },
    }));

    expect(dynamicContextPrompt).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("omits Junction source commands when the public connect target resolves direct", async () => {
    const deviceSyncPort = {
      ...createNoDirtyRuntimeDeviceSyncPortMethods(),
      async applyUpdates() {
        return {
          appliedAt: "2026-04-29T00:00:00.000Z",
          updates: [],
          userId: "member_synthetic_phase",
        };
      },
      async createConnectLink() {
        throw new Error("createConnectLink should not be called.");
      },
      async fetchSnapshot() {
        return {
          connections: [
            {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-29T00:00:00.000Z",
                createdAt: "2026-04-29T00:00:00.000Z",
                displayName: null,
                externalAccountId: "synthetic-external-account",
                id: "conn_synthetic_oura_junction",
                metadata: {},
                provider: "junction",
                scopes: [],
                setupPhase: "source_confirmed",
                status: "active",
              },
              credential: {
                credentialMetadata: {},
                kind: "provider_config",
                providerConfigKey: "junction",
              },
              localState: {
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: "2026-04-22T00:00:00.000Z",
                lastSyncErrorAt: null,
                lastSyncStartedAt: "2026-04-29T00:00:00.000Z",
                lastWebhookAt: null,
                nextReconcileAt: null,
              },
              sources: [
                {
                  displayName: null,
                  firstSeenAt: "2026-04-22T00:00:00.000Z",
                  lastErrorCode: "TOKEN_REFRESH_FAILED",
                  lastErrorMessage: "refresh failed",
                  lastSeenAt: "2026-04-29T00:00:00.000Z",
                  lastDataAt: null,
                  resourceCount: 0,
                  sourceProviderSlug: "oura",
                  status: "error",
                },
              ],
            },
            {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-28T00:00:00.000Z",
                createdAt: "2026-04-28T00:00:00.000Z",
                displayName: null,
                externalAccountId: "synthetic-strava-account",
                id: "conn_synthetic_strava",
                metadata: {},
                provider: "strava",
                scopes: ["activity:read"],
                setupPhase: "source_confirmed",
                status: "reauthorization_required",
              },
              credential: {
                credentialMetadata: {},
                kind: "none",
              },
              localState: {
                lastErrorCode: "TOKEN_REFRESH_FAILED",
                lastErrorMessage: "refresh failed",
                lastSyncCompletedAt: "2026-04-22T00:00:00.000Z",
                lastSyncErrorAt: "2026-04-29T00:00:00.000Z",
                lastSyncStartedAt: "2026-04-29T00:00:00.000Z",
                lastWebhookAt: null,
                nextReconcileAt: null,
              },
            },
          ],
          generatedAt: "2026-04-29T00:00:00.000Z",
          userId: "member_synthetic_phase",
        };
      },
    } satisfies RuntimeDeviceSyncPort;

    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: null,
      runningJobs: 0,
      totalJobs: 1,
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["oura"],
            region: "us",
          },
          oura: {
            clientId: "synthetic-oura-client",
            clientSecret: "synthetic-oura-secret",
          },
          strava: {
            clientId: "synthetic-strava-client",
            clientSecret: "synthetic-strava-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
    }));

    const assistantLaneCall = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    const prompt =
      await assistantLaneCall?.buildBackgroundDynamicContextPrompt?.({}) ?? "";

    expect(prompt).toContain("Oura currently needs reconnect");
    expect(prompt).toContain("source `oura`");
    expect(prompt).toContain("generic device-connect command is ambiguous");
    expect(prompt).not.toContain("vault-cli device connect oura --format json");
    expect(prompt).toContain("Strava currently needs reconnect");
    expect(prompt).toContain("Reconnect is not currently available for this wearable/source");
    expect(prompt).toContain("Do not offer or issue a reconnect link");
    expect(prompt).not.toContain("vault-cli device connect strava --format json");
  });

  it("skips lazy device context when pending input appears before the automation lane", async () => {
    const fetchSnapshot = vi.fn(async () => ({
      connections: [],
      generatedAt: "2026-04-29T00:00:00.000Z",
      userId: "member_synthetic_phase",
    }));
    const deviceSyncPort = {
      ...createNoDirtyRuntimeDeviceSyncPortMethods(),
      async applyUpdates() {
        return {
          appliedAt: "2026-04-29T00:00:00.000Z",
          updates: [],
          userId: "member_synthetic_phase",
        };
      },
      async createConnectLink() {
        throw new Error("createConnectLink should not be called.");
      },
      fetchSnapshot,
    } satisfies RuntimeDeviceSyncPort;

    mocks.resolveHostedPendingAssistantInputWakeAt
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("2026-04-29T00:00:00.000Z");
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        nextWakeAt: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: null,
      runningJobs: 0,
      totalJobs: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["whoop_v2"],
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
    }));

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-29T00:00:00.000Z",
      progressed: true,
    }));
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("skips lazy hosted device sync status reads after foreground preemption", async () => {
    let shouldYield = false;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYield);
    const deviceSyncPort = {
      ...createNoDirtyRuntimeDeviceSyncPortMethods(),
      async applyUpdates() {
        return {
          appliedAt: "2026-04-29T00:00:00.000Z",
          updates: [],
          userId: "member_synthetic_phase",
        };
      },
      async createConnectLink() {
        throw new Error("createConnectLink should not be called.");
      },
      async fetchSnapshot() {
        throw new Error("fetchSnapshot should not run after foreground preemption.");
      },
    } satisfies RuntimeDeviceSyncPort;

    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: null,
      runningJobs: 0,
      totalJobs: 1,
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["whoop_v2"],
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
      shouldYieldBackgroundMaintenance,
    }));

    const assistantLaneCall = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    shouldYield = true;
    const prompt = await assistantLaneCall?.buildBackgroundDynamicContextPrompt?.({});
    expect(prompt).toBeNull();
    expect(assistantLaneCall?.executionContext.hosted?.dynamicContextPrompts).toBeUndefined();
  });

  it("uses an abortable signal for optional hosted device sync status reads before scheduled assistant work", async () => {
    let fetchSnapshotCalls = 0;
    let fetchSnapshotSignal: AbortSignal | null | undefined;
    const deviceSyncPort = {
      ...createNoDirtyRuntimeDeviceSyncPortMethods(),
      async applyUpdates() {
        return {
          appliedAt: "2026-04-29T00:00:00.000Z",
          updates: [],
          userId: "member_synthetic_phase",
        };
      },
      async createConnectLink() {
        throw new Error("createConnectLink should not be called.");
      },
      async fetchSnapshot(request) {
        fetchSnapshotCalls += 1;
        fetchSnapshotSignal = request?.signal;
        return {
          connections: [],
          generatedAt: "2026-04-29T00:00:00.000Z",
          userId: "member_synthetic_phase",
        };
      },
    } satisfies RuntimeDeviceSyncPort;

    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: null,
      runningJobs: 0,
      totalJobs: 1,
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["whoop_v2"],
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
    }));

    const assistantLaneCall = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    const prompt = await assistantLaneCall?.buildBackgroundDynamicContextPrompt?.({});
    expect(fetchSnapshotCalls).toBe(1);
    expect(fetchSnapshotSignal).toBeInstanceOf(AbortSignal);
    expect(prompt).toBeNull();
    expect(assistantLaneCall?.executionContext.hosted?.dynamicContextPrompts).toBeUndefined();
  });

  it("logs hosted device connect helper failures without leaking response details", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const deviceSyncPort = {
      ...createNoDirtyRuntimeDeviceSyncPortMethods(),
      async applyUpdates() {
        return {
          appliedAt: "2026-04-29T00:00:00.000Z",
          updates: [],
          userId: "member_synthetic_phase",
        };
      },
      async createConnectLink() {
        const error = new Error(
          "Connect link failed for https://connect.example.test/oauth?state=opaque-secret",
        );
        Object.defineProperty(error, "status", {
          enumerable: true,
          value: 401,
        });
        throw error;
      },
      async fetchSnapshot() {
        return {
          connections: [],
          generatedAt: "2026-04-29T00:00:00.000Z",
          userId: "member_synthetic_phase",
        };
      },
    } satisfies RuntimeDeviceSyncPort;

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      deviceSyncMessagingReturnTarget: "telegram",
      logRequests,
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
    }));

    const hydratedContext = mocks.hydrateHostedExecutionDefaultTarget.mock.calls[0]?.[0];
    await expect(
      hydratedContext?.hosted?.deviceTool?.request({
        action: "connect",
        provider: "whoop",
      }),
    ).rejects.toThrow("Connect link failed");
    const failedLog = logRequests
      .flatMap((request) => request.entries)
      .find((entry) =>
        entry.eventCode === "assistant.device_connect"
        && entry.redactedJson?.deviceConnectStatus === "failed"
      );
    expect(failedLog).toEqual(expect.objectContaining({
      errorCode: "authorization_error",
      level: "warn",
      redactedJson: expect.objectContaining({
        deviceConnectStage: "request",
        deviceConnectStatus: "failed",
        deviceConnectReturnTarget: "telegram",
        errorCode: "authorization_error",
        errorStatus: 401,
        provider: "whoop",
        safeErrorMessage: "Hosted execution authorization failed.",
      }),
    }));
    expect(JSON.stringify(logRequests)).not.toContain("connect.example.test");
    expect(JSON.stringify(logRequests)).not.toContain("opaque-secret");
    expect(JSON.stringify(logRequests)).not.toContain("synthetic-whoop-secret");
  });

  it("writes a durable assistant pass summary without requiring local log storage", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      nextWakeAt: "2026-04-27T00:05:00.000Z",
      redactedLogEntries: [{
        component: "runtime",
        level: "info",
        message: "Hosted assistant automation pass finished.",
        phase: "wake.running",
        redacted: {
          assistantProviderRequest: {
            model: "not-allowed-nested",
          },
          autoReplyChannels: "linq",
          localPathPreview: "/tmp/not-allowed",
          replyConsidered: 1,
        },
      }],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(result.progressed).toBe(true);
    expect(filteredLogRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.automation_detail",
      "assistant.pass_finished",
    ]);
    expect(filteredLogRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      attemptId: "attempt_synthetic_phase",
      component: "assistant",
      eventCode: "assistant.automation_detail",
      leaseGeneration: "3",
      phase: "invoke",
      redactedJson: expect.objectContaining({
        autoReplyChannels: "linq",
        detailComponent: "runtime",
        detailLabel: "Hosted assistant automation pass finished.",
        localPathPreview: "<REDACTED_PATH>",
        replyConsidered: 1,
      }),
      workspaceVersion: "8",
    }));
    expect(filteredLogRequests[0]?.entries[0]?.redactedJson).not.toEqual(expect.objectContaining({
      assistantProviderRequest: expect.anything(),
    }));
    expect(filteredLogRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      attemptId: "attempt_synthetic_phase",
      component: "assistant",
      eventCode: "assistant.pass_finished",
      leaseGeneration: "3",
      phase: "invoke",
      redactedJson: expect.objectContaining({
        automationLogCount: 1,
        deliveryEffectCount: 0,
        nextWakeAtPresent: true,
        parserProcessed: 0,
        progressed: true,
      }),
      workspaceVersion: "8",
    }));
  });

  it("flushes buffered automation detail logs before rethrowing assistant failures", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const failure = new Error("automation failed after timing trace");
    Object.defineProperty(failure, "hostedAssistantAutomationRedactedLogEntries", {
      configurable: true,
      value: [{
        component: "runtime.provider",
        level: "error",
        message: "Hosted assistant automation pass failed.",
        phase: "failed",
        redacted: {
          errorCode: "authorization_error",
          errorCodeDetail: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
          safeErrorMessage: "Hosted execution authorization failed.",
          schema: "murph.assistant-turn-timing.v1",
          type: "assistant.turn.timing",
          turnTimingDeliveryIntentId: "intent_timing_failure",
          turnTimingElapsedMs: 41,
          turnTimingProviderRequestElapsedMs: 31,
          turnTimingSinceProviderResultMs: 10,
          turnTimingStage: "reply-dispatched",
        },
      }],
    });
    mocks.runHostedAssistantAutomationLane.mockRejectedValueOnce(failure);

    await expect(
      runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests })),
    ).rejects.toThrow("automation failed after timing trace");

    expect(logRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "assistant",
      errorCode: "authorization_error",
      eventCode: "assistant.automation_detail",
      redactedJson: expect.objectContaining({
        errorCode: "authorization_error",
        errorCodeDetail: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
        detailComponent: "runtime.provider",
        schema: "murph.assistant-turn-timing.v1",
        safeErrorMessage: "Hosted execution authorization failed.",
        turnTimingDeliveryIntentId: "intent_timing_failure",
        turnTimingElapsedMs: 41,
        turnTimingProviderRequestElapsedMs: 31,
        turnTimingSinceProviderResultMs: 10,
        turnTimingStage: "reply-dispatched",
      }),
    }));
    expect(() => parseHostedRuntimeLogRequest(logRequests[0])).not.toThrow();
  });

  it("persists redacted full Codex failure diagnostics in assistant detail logs", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      nextWakeAt: "2026-05-03T14:56:05.548Z",
      redactedLogEntries: [{
        component: "runtime",
        level: "info",
        message: "Hosted assistant automation event: input.reply-failed.",
        phase: "wake.running",
        redacted: {
          ...Object.fromEntries(
            Array.from({ length: 48 }, (_, index) => [
              `genericOverflow${index}Count`,
              index,
            ]),
          ),
          errorCode: "ASSISTANT_CODEX_FAILED",
          failureCodexAbortRequested: false,
          failureCodexDiagnosticsPresent: true,
          failureCodexExitCode: 1,
          failureCodexExitSignal: "SIGKILL",
          failureCodexFailureDetailPresent: true,
          failureCodexFailureStage: "process_exit",
          failureCodexJsonEventCount: 3,
          failureCodexLifecycleStage: "turn_running",
          failureCodexLiveTurnOpen: true,
          failureCodexPendingRpcCount: 1,
          failureCodexPendingRpcMethod: "turn/start",
          failureCodexProcessGroupPresent: true,
          failureCodexProcessLifetimeMs: 2041,
          failureCodexProviderRequestStarted: true,
          failureCodexShutdownRequested: false,
          failureCodexRetryable: false,
          failureCodexStderrPresent: true,
          failureCodexStderrBytes: 128,
          failureCodexTerminationSignalSent: null,
          failureProviderActionCount: 4,
          failureFieldsPresent: true,
          failureRetryable: false,
          requestId: "hosted-workspace-invocation:workspace-invocation-16:assistant",
          safeDetails: "provider usage limit reached (ASSISTANT_CODEX_FAILED)",
          safeErrorLength:
            "Codex app-server failed.\ndetails:\n- usage limit reached; try again later\n- workspace: <HOME_DIR>/project".length,
          safeErrorMessage:
            "Codex app-server failed.\ndetails:\n- usage limit reached; try again later\n- workspace: <HOME_DIR>/project",
          safeErrorPresent: true,
          type: "input.reply-failed",
        },
      }],
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);
    expect(filteredLogRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "assistant",
      errorCode: "ASSISTANT_CODEX_FAILED",
      eventCode: "assistant.automation_detail",
      redactedJson: expect.objectContaining({
        errorCode: "ASSISTANT_CODEX_FAILED",
        failureCodexAbortRequested: false,
        failureCodexExitCode: 1,
        failureCodexExitSignal: "SIGKILL",
        failureCodexFailureDetailPresent: true,
        failureCodexFailureStage: "process_exit",
        failureCodexJsonEventCount: 3,
        failureCodexLifecycleStage: "turn_running",
        failureCodexLiveTurnOpen: true,
        failureCodexPendingRpcCount: 1,
        failureCodexPendingRpcMethod: "turn/start",
        failureCodexProcessGroupPresent: true,
        failureCodexProcessLifetimeMs: 2041,
        failureCodexProviderRequestStarted: true,
        failureCodexShutdownRequested: false,
        failureCodexRetryable: false,
        failureCodexStderrPresent: true,
        failureCodexStderrBytes: 128,
        failureCodexTerminationSignalSent: null,
        failureProviderActionCount: 4,
        failureRetryable: false,
        safeDetails: "provider usage limit reached (ASSISTANT_CODEX_FAILED)",
        safeErrorMessage:
          "Codex app-server failed. details: - usage limit reached; try again later - workspace: <REDACTED_PATH>",
        type: "input.reply-failed",
      }),
    }));
    const serializedLogRequests = JSON.stringify(logRequests);
    expect(serializedLogRequests).not.toContain('"itemId"');
    expect(serializedLogRequests).not.toContain('"mailboxDedupeKey"');
    expect(serializedLogRequests).not.toContain('"requestId"');
  });

  it("redacts unsafe diagnostic error text before persistence", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      nextWakeAt: null,
      redactedLogEntries: [{
        component: "runtime",
        level: "info",
        message: "Hosted assistant automation event: input.reply-failed.",
        phase: "wake.running",
        redacted: {
          errorCode: "ASSISTANT_CODEX_FAILED",
          safeErrorMessage:
            "Bearer raw-token-value https://api.openai.com/v1/responses",
          safeErrorPresent: true,
          safeErrorLength:
            "Bearer raw-token-value https://api.openai.com/v1/responses".length,
          type: "input.reply-failed",
        },
      }],
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests[0]?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      errorCode: "ASSISTANT_CODEX_FAILED",
      safeErrorLength:
        "Bearer raw-token-value https://api.openai.com/v1/responses".length,
      safeErrorMessage: "Bearer [redacted] <REDACTED_URL>",
      safeErrorPresent: true,
      type: "input.reply-failed",
    }));
    expect(JSON.stringify(logRequests)).not.toContain("raw-token-value");
    expect(JSON.stringify(logRequests)).not.toContain("api.openai.com");
  });

  it("persists diagnostics when Codex context is missing and error text needs path redaction", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      nextWakeAt: null,
      redactedLogEntries: [{
        component: "runtime",
        level: "info",
        message: "Hosted assistant automation event: input.reply-failed.",
        phase: "wake.running",
        redacted: {
          errorCode: "ASSISTANT_CODEX_FAILED",
          assistantExceptionDetail: "Unhandled provider exception at /tmp/provider",
          failureCodexDiagnosticsPresent: false,
          failureFieldsPresent: true,
          providerFailureReason: "authorization: Bearer raw-provider-token",
          providerFailureRawPayloadReason: "raw payload should not persist",
          safeDetails: "assistant provider failed (ASSISTANT_CODEX_FAILED)",
          safeErrorLength: "Codex app-server failed at /tmp/workspace".length,
          safeErrorMessage: "Codex app-server failed at /tmp/workspace",
          safeErrorPresent: true,
          type: "input.reply-failed",
        },
      }],
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      errorCode: "ASSISTANT_CODEX_FAILED",
      redactedJson: expect.objectContaining({
        errorCode: "ASSISTANT_CODEX_FAILED",
        assistantExceptionDetail: "Unhandled provider exception at <REDACTED_PATH>",
        failureCodexDiagnosticsPresent: false,
        failureFieldsPresent: true,
        providerFailureReason: "authorization [redacted]",
        safeDetails: "assistant provider failed (ASSISTANT_CODEX_FAILED)",
        safeErrorLength: "Codex app-server failed at /tmp/workspace".length,
        safeErrorMessage: "Codex app-server failed at <REDACTED_PATH>",
        safeErrorPresent: true,
        type: "input.reply-failed",
      }),
    }));
    expect(filteredLogRequests[0]?.entries[0]?.redactedJson).not.toEqual(expect.objectContaining({
      providerFailureRawPayloadReason: expect.anything(),
    }));
    expect(JSON.stringify(logRequests)).not.toContain("raw-provider-token");
    expect(JSON.stringify(logRequests)).not.toContain("raw payload should not persist");
  });

  it("writes an outbox delivery summary after committed delivery effects drain", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const deliveryEffect = {
      ...createDeliveryEffect(),
      payload: {
        ...createDeliveryEffect().payload,
        media: [
          {
            alt: "Start",
            kind: "image" as const,
            source: "exercise_catalog:movement:1",
            url: "https://cdn.example.test/exercises/start.png",
          },
          {
            alt: "Finish",
            contentType: "image/png" as const,
            filename: "finish.png",
            kind: "vault_image" as const,
            ref: "generated/finish.png",
            sha256: "a".repeat(64),
            sizeBytes: 1234,
            source: "murph.generate_image",
          },
        ],
      },
    };
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_synthetic",
        providerMessageIds: [],
        providerThreadId: null,
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.pass_finished",
      "outbox.delivery_finished",
    ]);
    expect(filteredLogRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: "info",
      phase: "outbox",
      redactedJson: expect.objectContaining({
        attempted: 1,
        failed: 0,
        imageBearingIntentCount: 1,
        imageMediaItemCount: 2,
        maxMediaItemsPerIntent: 2,
        maxMessageLength: "Synthetic delivery".length,
        mediaItemCount: 2,
        mediaKindSummary: "image:1,vault_image:1",
        privateImageMediaItemCount: 1,
        publicImageMediaItemCount: 1,
        retryable: 0,
        sent: 1,
        statusSummary: "sent:1",
        totalImageAltTextLength: "Start".length + "Finish".length,
        totalMessageLength: "Synthetic delivery".length,
        vaultFileMediaItemCount: 0,
        voiceMemoMediaItemCount: 0,
      }),
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupAfterDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomes: [expect.objectContaining({
          deliveryChannel: "telegram",
          providerMessageId: "provider_synthetic",
        })],
        vaultRoot: "/tmp/murph-vault",
      }),
    );
  });

  });
