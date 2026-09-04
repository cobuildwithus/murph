import {
  createPhaseInput,
  createPhaseWorkspace,
  mocks,
  setPendingAutomationDeliveryIntentForTest,
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
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  runHostedWorkspaceAssistantPhase as runHostedWorkspaceAssistantPhaseWithoutDrain,
  type HostedWorkspaceRuntimeAssistantPhaseInput,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";
import { drainHostedRuntimeLogWritesBestEffort } from "../src/hosted-runtime/runtime-logs.ts";

afterEach(async () => {
  await drainHostedRuntimeLogWritesBestEffort();
});

async function runHostedWorkspaceAssistantPhase(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
) {
  try {
    return await runHostedWorkspaceAssistantPhaseWithoutDrain(input);
  } finally {
    await drainHostedRuntimeLogWritesBestEffort();
  }
}

describe("runHostedWorkspaceAssistantPhase runtime logs", () => {it("checkpoints hosted managed automation changes before continuing assistant work", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const events: string[] = [];
    mocks.applyMurphManagedAutomations.mockImplementationOnce(async (input) => {
      events.push("managed-automation");
      input.onOnboardingFollowupDiagnostic?.({
        action: "migrated_three_day_window",
        activeUntil: "2026-04-30T15:00:00.000Z",
        firstOccurrenceAt: "2026-04-28T13:30:00.000Z",
        onboardingStateCreatedAt: null,
        onboardingStateSource: "default_missing",
        onboardingStateStatus: "open",
        onboardingStateUpdatedAt: null,
        opportunityDays: 3,
        previousScheduleKind: "at",
        scheduleKind: "dailyLocal",
      });
      return {
        created: 1,
        skipped: 0,
        updated: 0,
      };
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      events.push("automation-lane");
      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
      operatorHomeRoot: "/tmp/murph-hosted-operator-home",
      vaultRoot: "/tmp/murph-hosted-vault",
    }));

    expect(mocks.applyMurphManagedAutomations).toHaveBeenCalledWith({
      now: new Date("2026-04-27T00:00:00.000Z"),
      onDiagnosticStage: expect.any(Function),
      onOnboardingFollowupDiagnostic: expect.any(Function),
      operatorHomeRoot: "/tmp/murph-hosted-operator-home",
      routeValidationProfile: "hosted",
      runtimeEnv: {},
      shouldYield: null,
      vaultRoot: "/tmp/murph-hosted-vault",
    });
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["managed-automation", "automation-lane"]);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 1,
        murphManagedAutomationSkipped: 0,
        murphManagedAutomationUpdated: 0,
      }),
    }));
    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        component: "runtime",
        eventCode: "assistant.onboarding_followup_reconciled",
        level: "info",
        redactedJson: {
          onboardingFollowupAction: "migrated_three_day_window",
          onboardingFollowupActiveUntil: "2026-04-30T15:00:00.000Z",
          onboardingFollowupFirstOccurrenceAt: "2026-04-28T13:30:00.000Z",
          onboardingFollowupOpportunityDays: 3,
          onboardingFollowupPreviousScheduleKind: "at",
          onboardingFollowupScheduleKind: "dailyLocal",
          onboardingStateCreatedAt: null,
          onboardingStateSource: "default_missing",
          onboardingStateStatus: "open",
          onboardingStateUpdatedAt: null,
        },
      }),
    );
    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        component: "runtime",
        eventCode: "assistant.pass_finished",
        level: "info",
        redactedJson: expect.objectContaining({
          murphManagedAutomationCreated: 1,
          murphManagedAutomationSkipped: 0,
          murphManagedAutomationUpdated: 0,
        }),
      }),
    );
  });

  it("runs deterministic reminder availability in the hosted background pass", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-reminder-availability-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const actualAssistantEngine = await vi.importActual<
      typeof import("@murphai/assistant-engine")
    >("@murphai/assistant-engine");
    const connectedApps = {
      request: vi.fn(async () => ({
        result: {
          data: {
            items: [{
              description: "Private provider content",
              end: { dateTime: "2026-07-30T15:00:00.000Z" },
              start: { dateTime: "2026-07-30T14:00:00.000Z" },
              summary: "Private event title",
            }],
          },
        },
      })),
    };
    try {
      await initializeVault({
        createdAt: "2026-07-29T00:00:00.000Z",
        vaultRoot,
      });
      await upsertAutomation({
        continuityPolicy: "fresh",
        instructions: [
          "Send one flexible reminder.",
          "Availability conflict policy: skip-when-busy",
          "Availability source policy: calendar-only",
          "Availability calendar account: googlecalendar / calendar-account",
        ].join("\n"),
        now: new Date("2026-07-29T00:00:00.000Z"),
        route: {
          channel: "linq",
          deliveryTarget: "direct-thread",
          identityId: null,
          participantId: null,
          threadId: null,
          threadIsDirect: true,
        },
        schedule: { kind: "dailyLocal", localTime: "16:00" },
        slug: "hosted-reminder-availability",
        status: "active",
        title: "Hosted reminder availability",
        vaultRoot,
      });
      mocks.refreshReminderAvailability.mockImplementationOnce(
        actualAssistantEngine.refreshReminderAvailability,
      );

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => "2026-07-30T00:00:00.000Z",
        runtimeConnectedApps: connectedApps,
        vaultRoot,
      }));

      expect(mocks.refreshReminderAvailability).toHaveBeenCalledWith({
        connectedApps,
        now: new Date("2026-07-30T00:00:00.000Z"),
        shouldYield: null,
        signal: null,
        vaultRoot,
      });
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: "2026-07-30T23:00:00.000Z",
        progressed: true,
        redactedStatus: expect.objectContaining({
          reminderAvailabilityMaintenanceAttempted: 1,
          reminderAvailabilityMaintenanceFailed: 0,
          reminderAvailabilityMaintenanceRefreshed: 1,
        }),
      }));
      const reminder = await showAutomation({
        slug: "hosted-reminder-availability",
        vaultRoot,
      });
      expect(reminder).not.toBeNull();
      expect(reminder?.instructions).not.toContain("Private event title");
      expect(splitAutomationAvailabilityConflictBlock(
        reminder?.instructions ?? "",
      ).block).toContain(
        "- 2026-07-30T14:00:00.000Z / 2026-07-30T15:00:00.000Z",
      );
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("preempts an in-flight reminder availability read without logging a provider failure", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-reminder-availability-abort-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const backgroundController = new AbortController();
    const logRequests: HostedRuntimeLogRequest[] = [];
    let foregroundWaiting = false;
    let markRequestStarted: () => void = () => undefined;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const connectedApps: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["connectedApps"]
    > = {
      request: vi.fn(async (_request, context) => {
        const signal = context?.signal ?? null;
        expect(signal).toBe(backgroundController.signal);
        markRequestStarted();
        return await new Promise<never>((_resolve, reject) => {
          const rejectFromAbort = () => reject(signal?.reason);
          if (!signal) {
            reject(new Error("Expected a background maintenance signal."));
          } else if (signal.aborted) {
            rejectFromAbort();
          } else {
            signal.addEventListener("abort", rejectFromAbort, { once: true });
          }
        });
      }),
    };
    const actualAssistantEngine = await vi.importActual<
      typeof import("@murphai/assistant-engine")
    >("@murphai/assistant-engine");
    try {
      await initializeVault({
        createdAt: "2026-07-29T00:00:00.000Z",
        vaultRoot,
      });
      await upsertAutomation({
        continuityPolicy: "fresh",
        instructions: [
          "Send one flexible reminder.",
          "Availability conflict policy: skip-when-busy",
          "Availability source policy: calendar-only",
          "Availability calendar account: googlecalendar / calendar-account",
        ].join("\n"),
        now: new Date("2026-07-29T00:00:00.000Z"),
        route: {
          channel: "linq",
          deliveryTarget: "direct-thread",
          identityId: null,
          participantId: null,
          threadId: null,
          threadIsDirect: true,
        },
        schedule: { kind: "dailyLocal", localTime: "16:00" },
        slug: "hosted-reminder-availability-abort",
        status: "active",
        title: "Hosted reminder availability abort",
        vaultRoot,
      });
      mocks.refreshReminderAvailability.mockImplementationOnce(
        actualAssistantEngine.refreshReminderAvailability,
      );

      const phasePromise = runHostedWorkspaceAssistantPhase(createPhaseInput({
        backgroundMaintenanceSignal: backgroundController.signal,
        logRequests,
        now: () => "2026-07-30T00:00:00.000Z",
        runtimeConnectedApps: connectedApps,
        shouldYieldBackgroundMaintenance: () => foregroundWaiting,
        vaultRoot,
      }));
      await requestStarted;
      foregroundWaiting = true;
      backgroundController.abort(
        new DOMException(
          "Foreground conversation input preempted background maintenance.",
          "AbortError",
        ),
      );

      await expect(phasePromise).resolves.toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: "2026-07-30T00:00:00.000Z",
        progressed: true,
        redactedStatus: expect.objectContaining({
          reminderAvailabilityMaintenanceYielded: true,
        }),
      }));
      expect(
        logRequests.flatMap((request) => request.entries).some((entry) =>
          entry.redactedJson?.reminderAvailabilityMaintenanceFailed === true
        ),
      ).toBe(false);
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("falls back to the runtime shutdown signal for reminder availability", async () => {
    const shutdownController = new AbortController();
    const shutdownReason = new DOMException(
      "Synthetic hosted runtime shutdown.",
      "AbortError",
    );
    let markRefreshStarted: () => void = () => undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    mocks.refreshReminderAvailability.mockImplementationOnce(async (input) => {
      expect(input.signal).toBe(shutdownController.signal);
      markRefreshStarted();
      return await new Promise<never>((_resolve, reject) => {
        const rejectFromAbort = () => reject(input.signal?.reason);
        if (!input.signal) {
          reject(new Error("Expected the runtime shutdown signal."));
        } else if (input.signal.aborted) {
          rejectFromAbort();
        } else {
          input.signal.addEventListener("abort", rejectFromAbort, { once: true });
        }
      });
    });

    const phasePromise = runHostedWorkspaceAssistantPhase(createPhaseInput({
      signal: shutdownController.signal,
    }));
    await refreshStarted;
    shutdownController.abort(shutdownReason);

    await expect(phasePromise).rejects.toBe(shutdownReason);
  });

  it("checkpoints a retry wake after logging partial managed setup failures", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const stableKeyFailure = new VaultCliError(
      "MURPH_MANAGED_AUTOMATION_SETUP_TRANSIENT",
      "metadata unavailable",
      { retryable: true },
    );
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 1,
      stableKeyFailure,
      stableKeyRetryNeeded: true,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 1,
        murphManagedAutomationFailed: true,
        murphManagedAutomationSkipped: 1,
        murphManagedAutomationUpdated: 0,
      }),
    }));

    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        component: "runtime",
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: expect.objectContaining({
          errorCode: "runtime_error",
          murphManagedAutomationCreated: 1,
          murphManagedAutomationFailed: true,
          murphManagedAutomationSkipped: 1,
          murphManagedAutomationUpdated: 0,
          safeErrorMessage: "Hosted execution runtime failed.",
        }),
      }),
    );
  });

  it("reports a degraded experiment lifecycle stage without failing the pass", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 2,
      experimentLifecycleFailure: new Error("Experiment storage rejected an entry."),
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    // The automations that do not depend on the experiment scan still landed.
    expect(result).toEqual(expect.objectContaining({
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 2,
        murphManagedAutomationFailed: false,
      }),
    }));
    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        component: "runtime",
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: expect.objectContaining({
          murphManagedAutomationExperimentLifecycleFailed: true,
          murphManagedAutomationStage: "experiment_lifecycle",
        }),
      }),
    );
  });

  it("keeps the bounded retry ladder for a transient experiment lifecycle failure", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const transient = Object.assign(new Error("experiment snapshot busy"), {
      code: "EBUSY",
    });
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 2,
      experimentLifecycleFailure: transient,
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    // First rung of the existing 30s / 2m / 10m ladder, with the unrelated
    // automations that already landed preserved in the status.
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 2,
        murphManagedAutomationExperimentLifecycleFailed: true,
        murphManagedAutomationSetupRetryAttempt: 1,
        murphManagedAutomationSetupRetryable: true,
      }),
    }));
    // It must not also report the pass as a clean success.
    expect(result.redactedStatus).not.toEqual(expect.objectContaining({
      murphManagedAutomationFailed: false,
    }));
  });

  it("does not retry a deterministic experiment storage failure", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 2,
      experimentLifecycleFailure: Object.assign(
        new Error("Experiment storage contains an entry that could hold an experiment document."),
        { code: "EXPERIMENT_STORAGE_INVALID" },
      ),
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    // Retrying an unchanged vault every 30 seconds would buy nothing.
    expect(result).not.toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
    }));
    expect(result).toEqual(expect.objectContaining({
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 2,
      }),
    }));
  });

  it("logs stable-key metadata failures when background setup stays idle", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const stableKeyFailure = new Error("metadata unavailable");
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 0,
      skipped: 1,
      stableKeyFailure,
      stableKeyRetryNeeded: true,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    expect(result).not.toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
    }));
    expect(result).not.toEqual(expect.objectContaining({
      redactedStatus: expect.objectContaining({
        murphManagedAutomationFailed: true,
      }),
    }));
    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        component: "runtime",
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: expect.objectContaining({
          errorCode: "runtime_error",
          murphManagedAutomationCreated: 0,
          murphManagedAutomationFailed: true,
          murphManagedAutomationSkipped: 1,
          murphManagedAutomationUpdated: 0,
          safeErrorMessage: "Hosted execution runtime failed.",
        }),
      }),
    );
  });

  it("persists bounded retries for a zero-change typed transient stable-key failure", async () => {
    const stableKeyFailure = new VaultCliError(
      "MURPH_MANAGED_AUTOMATION_SETUP_TRANSIENT",
      "workspace metadata is temporarily unavailable",
      { retryable: true },
    );
    mocks.applyMurphManagedAutomations.mockResolvedValue({
      created: 0,
      skipped: 1,
      stableKeyFailure,
      stableKeyRetryNeeded: true,
      updated: 0,
    });

    const firstRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    expect(firstRetry).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 0,
        murphManagedAutomationSetupRetryAttempt: 1,
        murphManagedAutomationSetupRetryable: true,
        murphManagedAutomationUpdated: 0,
      }),
    }));

    const secondRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:01:00.000Z",
      workspace: createPhaseWorkspace({
        redactedStatus: {
          murphManagedAutomationSetupRetryAttempt: 1,
        },
      }),
    }));
    expect(secondRetry).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:03:00.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationSetupRetryAttempt: 2,
      }),
    }));

    const thirdRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:04:00.000Z",
      workspace: createPhaseWorkspace({
        redactedStatus: {
          murphManagedAutomationSetupRetryAttempt: 2,
        },
      }),
    }));
    expect(thirdRetry).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationSetupRetryAttempt: 3,
      }),
    }));
  });

  it("checkpoints partial managed changes without retrying a permanent stable-key failure", async () => {
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 1,
      stableKeyFailure: new Error("vault metadata failed schema validation"),
      stableKeyRetryNeeded: true,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 1,
        murphManagedAutomationFailed: true,
        murphManagedAutomationSetupRetryAttempt: 0,
        murphManagedAutomationSetupRetryable: false,
      }),
    }));
    expect(result).not.toHaveProperty("nextWakeAt", expect.any(String));
  });

  it("does not schedule a retry loop for an unclassified managed setup failure", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const setupFailure = Object.assign(
      new TypeError("private managed automation failure detail"),
      {
        code: "MANAGED_SEED_SCHEMA_INVALID",
        statusCode: 409,
      },
    );
    mocks.applyMurphManagedAutomations.mockImplementationOnce(async (input) => {
      input.onDiagnosticStage?.({
        seedCount: 7,
        seedPosition: 3,
        stage: "managed_seed",
      });
      throw setupFailure;
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationFailed: true,
        murphManagedAutomationSetupRetryAttempt: 0,
        murphManagedAutomationSetupRetryExhausted: false,
        murphManagedAutomationSetupRetryable: false,
      }),
    }));
    expect(result).not.toHaveProperty("nextWakeAt", "2026-04-27T00:00:30.000Z");
    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        component: "runtime",
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: expect.objectContaining({
          errorCodeDetail: "MANAGED_SEED_SCHEMA_INVALID",
          errorDetailPresent: true,
          errorName: "TypeError",
          errorStatus: 409,
          murphManagedAutomationFailed: true,
          murphManagedAutomationSeedCount: 7,
          murphManagedAutomationSeedPosition: 3,
          murphManagedAutomationStage: "managed_seed",
          safeErrorMessage: "Hosted execution runtime failed.",
        }),
      }),
    );
    expect(JSON.stringify(logRequests)).not.toContain(
      "private managed automation failure detail",
    );
  });

  it("backs off typed transient managed setup failures and exhausts the retry budget", async () => {
    const setupFailure = new VaultCliError(
      "MURPH_MANAGED_AUTOMATION_SETUP_TRANSIENT",
      "workspace metadata is temporarily unavailable",
      { retryable: true },
    );
    mocks.applyMurphManagedAutomations.mockRejectedValue(setupFailure);

    const firstRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    expect(firstRetry).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationSetupRetryAttempt: 1,
        murphManagedAutomationSetupRetryExhausted: false,
        murphManagedAutomationSetupRetryable: true,
      }),
    }));

    const secondRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:01:00.000Z",
      workspace: createPhaseWorkspace({
        redactedStatus: {
          murphManagedAutomationSetupRetryAttempt: 1,
        },
      }),
    }));
    expect(secondRetry).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:03:00.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationSetupRetryAttempt: 2,
        murphManagedAutomationSetupRetryExhausted: false,
      }),
    }));

    const thirdRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:04:00.000Z",
      workspace: createPhaseWorkspace({
        redactedStatus: {
          murphManagedAutomationSetupRetryAttempt: 2,
        },
      }),
    }));
    expect(thirdRetry).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationSetupRetryAttempt: 3,
        murphManagedAutomationSetupRetryExhausted: false,
      }),
    }));

    const exhaustedRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:12:00.000Z",
      workspace: createPhaseWorkspace({
        redactedStatus: {
          murphManagedAutomationSetupRetryAttempt: 3,
        },
      }),
    }));
    expect(exhaustedRetry).toEqual(expect.objectContaining({
      redactedStatus: expect.objectContaining({
        murphManagedAutomationSetupRetryAttempt: 3,
        murphManagedAutomationSetupRetryExhausted: true,
        murphManagedAutomationSetupRetryable: true,
      }),
    }));
    expect(exhaustedRetry).not.toHaveProperty("nextWakeAt", expect.any(String));
  });

  it("clears the managed setup retry budget after a later successful pass", async () => {
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 0,
      skipped: 1,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:03:00.000Z",
      workspace: createPhaseWorkspace({
        redactedStatus: {
          murphManagedAutomationFailed: true,
          murphManagedAutomationSetupRetryAttempt: 2,
          murphManagedAutomationSetupRetryable: true,
        },
      }),
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationFailed: false,
        murphManagedAutomationSetupRetryAttempt: 0,
        murphManagedAutomationSetupRetryExhausted: false,
        murphManagedAutomationSetupRetryable: false,
      }),
    }));
    expect(result).not.toHaveProperty("nextWakeAt", expect.any(String));
  });

  it("skips hosted managed automation work when background maintenance yields", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: expect.any(String),
      nextWakeReason: "assistant",
      progressed: false,
    }));
  });

  it("reschedules partial managed maintenance when foreground input arrives mid-pass", async () => {
    let shouldYieldNow = false;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYieldNow);
    mocks.applyMurphManagedAutomations.mockImplementationOnce(async (input) => {
      expect(input.shouldYield).toBe(shouldYieldBackgroundMaintenance);
      shouldYieldNow = true;
      return {
        created: 1,
        skipped: 0,
        updated: 0,
        yielded: true,
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      shouldYieldBackgroundMaintenance,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 1,
        murphManagedAutomationUpdated: 0,
        murphManagedAutomationYielded: true,
      }),
    }));
  });

  it("runs the automation lane for fresh conversation input even when background maintenance yields", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.resolveHostedPendingAssistantInputWakeAt).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
      }),
    );
  });

  it("uses the fresh hosted conversation route for managed automation seeding", async () => {
    const seededNextWakeAt = "2026-04-30T17:00:00.000Z";
    const defaultRoute = {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "chat_synthetic_seed_route",
      identityId: "identity_synthetic_seed_route",
      participantId: "participant_synthetic_seed_route",
      threadIsDirect: true,
      threadId: "thread_synthetic_seed_route",
    };
    mocks.readAssistantInputEvent.mockResolvedValueOnce({
      conversation: {
        accountId: defaultRoute.identityId,
        actorId: defaultRoute.participantId,
        actorIsSelf: false,
        source: defaultRoute.channel,
        threadId: defaultRoute.threadId,
        threadIsDirect: true,
      },
      replyTarget: {
        channel: defaultRoute.channel,
        messageId: "message_synthetic_seed_route",
        threadId: defaultRoute.deliveryTarget,
      },
    });
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 0,
      updated: 0,
    });
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 0,
      enabledJobs: 1,
      nextRunAt: seededNextWakeAt,
      runningJobs: 0,
      totalJobs: 1,
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(mocks.readAssistantInputEvent).not.toHaveBeenCalled();
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.readAssistantInputEvent).toHaveBeenCalledWith({
      inputId: "ain_00000000000000000000000000000001",
      vault: "/tmp/murph-vault",
    });
    expect(mocks.applyMurphManagedAutomations).toHaveBeenCalledWith({
      defaultRoute,
      now: new Date("2026-04-27T00:00:00.000Z"),
      onDiagnosticStage: expect.any(Function),
      onOnboardingFollowupDiagnostic: expect.any(Function),
      operatorHomeRoot: "/tmp/murph-operator-home",
      routeValidationProfile: "hosted",
      runtimeEnv: {},
      shouldYield: null,
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: seededNextWakeAt,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 1,
        murphManagedAutomationSkipped: 0,
        murphManagedAutomationUpdated: 0,
      }),
    }));
  });

  it("does not wait on fresh managed automation cron status after foreground yield starts", async () => {
    vi.useFakeTimers();
    try {
      let shouldYield = false;
      const retryWakeAt = "2026-04-27T00:00:30.000Z";
      const defaultRoute = {
        channel: "linq",
        deliverySource: null,
        deliveryTarget: "chat_synthetic_seed_route",
        identityId: "identity_synthetic_seed_route",
        participantId: "participant_synthetic_seed_route",
        threadIsDirect: true,
        threadId: "thread_synthetic_seed_route",
      };
      mocks.readAssistantInputEvent.mockResolvedValueOnce({
        conversation: {
          accountId: defaultRoute.identityId,
          actorId: defaultRoute.participantId,
          actorIsSelf: false,
          source: defaultRoute.channel,
          threadId: defaultRoute.threadId,
          threadIsDirect: true,
        },
        replyTarget: {
          channel: defaultRoute.channel,
          messageId: "message_synthetic_seed_route",
          threadId: defaultRoute.deliveryTarget,
        },
      });
      mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
        created: 1,
        skipped: 0,
        updated: 0,
      });
      mocks.getAssistantCronStatus.mockImplementationOnce(() => {
        setTimeout(() => {
          shouldYield = true;
        }, 0);
        return new Promise(() => undefined);
      });
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 1,
        now: () => "2026-04-27T00:00:00.000Z",
        shouldYieldBackgroundMaintenance: () => shouldYield,
      }));

      expect(result.afterCheckpoint).toEqual(expect.any(Function));
      const postCheckpointPromise = result.afterCheckpoint?.();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(150);
      const postCheckpoint = await postCheckpointPromise;

      expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(1);
      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: retryWakeAt,
        redactedStatus: expect.objectContaining({
          murphManagedAutomationCreated: 1,
          murphManagedAutomationSkipped: 0,
          murphManagedAutomationUpdated: 0,
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the recorded provider-cleanup wake when fresh managed automation seeding replaces the phase wake", async () => {
    // Regression: a fresh Linq inbound records deferred provider cleanup into
    // hosted-provider-cleanup.json, the single owner of the next cleanup
    // wake. The managed-automation post-checkpoint result replaces the phase
    // wake in the workspace runner, so it must include the owner's scheduled
    // wake instead of stranding the deletion until the next unrelated cron
    // wake.
    const cronNextWakeAt = "2026-04-27T17:00:00.000Z";
    const providerCleanupWakeAt = "2026-04-27T00:05:00.000Z";
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      providerCleanupWakeAt,
    );
    const defaultRoute = {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "chat_synthetic_seed_route",
      identityId: "identity_synthetic_seed_route",
      participantId: "participant_synthetic_seed_route",
      threadId: "thread_synthetic_seed_route",
    };
    mocks.readAssistantInputEvent.mockResolvedValueOnce({
      conversation: {
        accountId: defaultRoute.identityId,
        actorId: defaultRoute.participantId,
        actorIsSelf: false,
        source: defaultRoute.channel,
        threadId: defaultRoute.threadId,
        threadIsDirect: true,
      },
      replyTarget: {
        channel: defaultRoute.channel,
        messageId: "message_synthetic_seed_route",
        threadId: defaultRoute.deliveryTarget,
      },
    });
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 3,
      skipped: 0,
      updated: 0,
    });
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 0,
      enabledJobs: 3,
      nextRunAt: cronNextWakeAt,
      runningJobs: 0,
      totalJobs: 3,
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      assistantAutomationTerminalLinqCleanup: ["linq_inbound_regression"],
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: providerCleanupWakeAt,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 3,
      }),
    }));
  });

  it("keeps the re-armed provider-cleanup wake when the persisted checkpoint is stale", async () => {
    // Regression: prepareHostedProviderCleanupPlan's deferred branch re-arms
    // a null/stale persisted checkpoint by writing the deferred wake back
    // into hosted-provider-cleanup.json. The managed-automation
    // post-checkpoint result must carry that durably re-armed owner wake.
    const cronNextWakeAt = "2026-04-27T17:00:00.000Z";
    const reArmedProviderCleanupWakeAt = "2026-04-27T00:05:00.000Z";
    const defaultRoute = {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "chat_synthetic_seed_route",
      identityId: "identity_synthetic_seed_route",
      participantId: "participant_synthetic_seed_route",
      threadId: "thread_synthetic_seed_route",
    };
    mocks.readAssistantInputEvent.mockResolvedValueOnce({
      conversation: {
        accountId: defaultRoute.identityId,
        actorId: defaultRoute.participantId,
        actorIsSelf: false,
        source: defaultRoute.channel,
        threadId: defaultRoute.threadId,
        threadIsDirect: true,
      },
      replyTarget: {
        channel: defaultRoute.channel,
        messageId: "message_synthetic_seed_route",
        threadId: defaultRoute.deliveryTarget,
      },
    });
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 3,
      skipped: 0,
      updated: 0,
    });
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 0,
      enabledJobs: 3,
      nextRunAt: cronNextWakeAt,
      runningJobs: 0,
      totalJobs: 3,
    });
    // Persisted owner state is stale: pending ids with a null checkpoint.
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValue({
      nextWakeAt: null,
    });
    // After the deferred plan re-arms the stale checkpoint durably, the
    // owner file resolves to the re-armed wake.
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      reArmedProviderCleanupWakeAt,
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: reArmedProviderCleanupWakeAt,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 3,
      }),
    }));
  });

  it("keeps an earlier assistant wake when fresh managed automation work is a no-op", async () => {
    const assistantWakeAt = "2026-04-27T00:05:00.000Z";
    const providerCleanupWakeAt = "2026-04-27T00:14:00.000Z";
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      providerCleanupWakeAt,
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: assistantWakeAt,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      afterCheckpoint: expect.any(Function),
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: assistantWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toBeNull();
    expect(mocks.readAssistantInputEvent).toHaveBeenCalledWith({
      inputId: "ain_00000000000000000000000000000001",
      vault: "/tmp/murph-vault",
    });
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
  });

  it("does not add a cleanup wake to fresh managed automation post-checkpoint status", async () => {
    const assistantWakeAt = "2026-04-27T00:05:00.000Z";
    const providerCleanupWakeAt = "2026-04-27T00:14:00.000Z";
    const defaultRoute = {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "chat_synthetic_seed_route",
      identityId: "identity_synthetic_seed_route",
      participantId: "participant_synthetic_seed_route",
      threadId: "thread_synthetic_seed_route",
    };
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      providerCleanupWakeAt,
    );
    mocks.readAssistantInputEvent.mockResolvedValueOnce({
      conversation: {
        accountId: defaultRoute.identityId,
        actorId: defaultRoute.participantId,
        actorIsSelf: false,
        source: defaultRoute.channel,
        threadId: defaultRoute.threadId,
        threadIsDirect: true,
      },
      replyTarget: {
        channel: defaultRoute.channel,
        messageId: "message_synthetic_seed_route",
        threadId: defaultRoute.deliveryTarget,
      },
    });
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 0,
      updated: 0,
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: assistantWakeAt,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      afterCheckpoint: expect.any(Function),
      nextWakeAt: assistantWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 1,
        murphManagedAutomationSkipped: 0,
        murphManagedAutomationUpdated: 0,
      }),
    }));
    // A status-only post-checkpoint result never manufactures a wake, even
    // when the cleanup owner has one scheduled; the phase result already
    // carries the owner wake and the runner keeps it.
    expect(postCheckpoint).not.toHaveProperty("nextWakeAt");
  });

  it("preserves a current inbound result and schedules managed setup retry after its checkpoint", async () => {
    const defaultRoute = {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "chat_synthetic_seed_route",
      identityId: "identity_synthetic_seed_route",
      participantId: "participant_synthetic_seed_route",
      threadId: "thread_synthetic_seed_route",
    };
    mocks.readAssistantInputEvent.mockResolvedValueOnce({
      conversation: {
        accountId: defaultRoute.identityId,
        actorId: defaultRoute.participantId,
        actorIsSelf: false,
        source: defaultRoute.channel,
        threadId: defaultRoute.threadId,
        threadIsDirect: true,
      },
      replyTarget: {
        channel: defaultRoute.channel,
        messageId: "message_synthetic_seed_route",
        threadId: defaultRoute.deliveryTarget,
      },
    });
    const stableKeyFailure = new VaultCliError(
      "MURPH_MANAGED_AUTOMATION_SETUP_TRANSIENT",
      "metadata unavailable",
      { retryable: true },
    );
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 0,
      skipped: 1,
      stableKeyFailure,
      stableKeyRetryNeeded: true,
      updated: 0,
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    // The current inbound phase completes and can be checkpointed before
    // background managed-automation setup is attempted.
    expect(result).toEqual(expect.objectContaining({
      afterCheckpoint: expect.any(Function),
      progressed: true,
    }));
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    await expect(result.afterCheckpoint?.()).resolves.toEqual(
      expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: "2026-04-27T00:00:30.000Z",
        redactedStatus: expect.objectContaining({
          murphManagedAutomationFailed: true,
        }),
      }),
    );
  });

  it("fails closed for mixed fresh hosted inputs when any reply target lacks a route", async () => {
    const routedEvent = {
      conversation: {
        accountId: "identity_synthetic_mixed_route",
        actorId: "participant_synthetic_mixed_route",
        actorIsSelf: false,
        source: "linq",
        threadId: "thread_synthetic_mixed_route",
        threadIsDirect: true,
      },
      replyTarget: {
        channel: "linq",
        messageId: "message_synthetic_mixed_route",
        threadId: "chat_synthetic_mixed_route",
      },
    };
    const routeLessReplyEvent = {
      conversation: {
        accountId: "identity_synthetic_mixed_route",
        actorId: "participant_synthetic_mixed_route",
        actorIsSelf: false,
        source: "linq",
        threadId: "thread_synthetic_mixed_route",
        threadIsDirect: true,
      },
      replyTarget: {
        channel: "linq",
        messageId: "message_synthetic_mixed_routeless",
        threadId: null,
      },
    };
    mocks.readAssistantInputEvent
      .mockResolvedValueOnce(routedEvent)
      .mockResolvedValueOnce(routeLessReplyEvent);
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [
        "ain_00000000000000000000000000000001",
        "ain_00000000000000000000000000000002",
      ],
      importedCount: 2,
    }));

    expect(result.afterCheckpoint).toBeUndefined();
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    mocks.readAssistantInputEvent
      .mockReset()
      .mockResolvedValueOnce(routedEvent)
      .mockResolvedValueOnce(routeLessReplyEvent);
    const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    const operationScope = laneInput?.operationScope as
      | AssistantAutomationOperationScope
      | undefined;
    if (!laneInput?.executionContext || !operationScope) {
      throw new Error("Expected hosted automation operation scope.");
    }
    await operationScope.runAutoReplyGroup({
      executionContext: laneInput.executionContext,
      inputIds: [
        "ain_00000000000000000000000000000001",
        "ain_00000000000000000000000000000002",
      ],
      operation: async (
        executionContext,
        _turnEnvironment,
        providerStartCriticalPath,
      ) => {
        expect(executionContext.hosted?.automationTool).toBeUndefined();
        expect(executionContext.hosted?.groupSharedReader).toBeUndefined();
        expect(providerStartCriticalPath).toEqual(expect.objectContaining({
          automationGroupAndOperationScopeDoneAtMonotonicMs: expect.any(Number),
          mailboxImportDoneAtMonotonicMs: 0,
        }));
      },
      providerStartCriticalPath: {
        mailboxImportDoneAtMonotonicMs: 0,
      },
      turnEnvironment: null,
    });
  });

  it("fails closed for mixed fresh hosted inputs when any reply target is null", async () => {
    const routedEvent = {
      conversation: {
        accountId: "identity_synthetic_null_mixed_route",
        actorId: "participant_synthetic_null_mixed_route",
        actorIsSelf: false,
        source: "linq",
        threadId: "thread_synthetic_null_mixed_route",
        threadIsDirect: true,
      },
      replyTarget: {
        channel: "linq",
        messageId: "message_synthetic_null_mixed_route",
        threadId: "chat_synthetic_null_mixed_route",
      },
    };
    const contextOnlyEvent = {
      conversation: {
        accountId: "identity_synthetic_null_mixed_route",
        actorId: "participant_synthetic_null_mixed_route",
        actorIsSelf: false,
        source: "linq",
        threadId: "thread_synthetic_null_mixed_route",
        threadIsDirect: true,
      },
      replyTarget: null,
    };
    mocks.readAssistantInputEvent
      .mockResolvedValueOnce(routedEvent)
      .mockResolvedValueOnce(contextOnlyEvent);
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [
        "ain_00000000000000000000000000000001",
        "ain_00000000000000000000000000000002",
      ],
      importedCount: 2,
    }));

    expect(result.afterCheckpoint).toBeUndefined();
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
  });

  it("routes accepted group inputs through the production operation scope to the supported access surface", async () => {
    const inputIds = {
      imessage: "ain_10101010101010101010101010101010",
      mixedRcs: "ain_20202020202020202020202020202020",
      mixedSms: "ain_30303030303030303030303030303030",
      sms: "ain_40404040404040404040404040404040",
      telegram: "ain_50505050505050505050505050505050",
    } as const;
    const syntheticGroup: HostedRuntimeGroupSummary = {
      displayName: null,
      id: "synthetic_group",
      kind: "friends",
      memberCount: 0,
      members: [],
      requestedVaultShareProjectionKinds: ["steps-days.v0"],
      requestedVaultShareProjectionScopes: [
        { projectionKind: "steps-days.v0" },
      ],
      status: "active",
    };
    const groupToolRequests: HostedRuntimeGroupToolRequest[] = [];
    const groupToolPort: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
    > = {
      async request(request) {
        groupToolRequests.push(request);
        if (request.action === "post_join_offer") {
          return "linqThread" in request
            ? {
                action: "post_join_offer" as const,
                result: {
                  group: syntheticGroup,
                  joinUrl: "https://example.test/private-native-url",
                  status: "sent" as const,
                },
              }
            : {
                action: "post_join_offer" as const,
                result: {
                  group: null,
                  status: "unavailable" as const,
                  unavailableReason: "linq_thread_unavailable",
                },
              };
        }
        if (request.action === "create_join_link") {
          return {
            action: "create_join_link" as const,
            result: {
              group: syntheticGroup,
              joinUrl: "https://example.test/groups/join/exact",
              status: "ok" as const,
            },
          };
        }
        throw new Error(`Unexpected group tool request: ${request.action}`);
      },
    };
    const buildGroupEvent = (input: {
      channel: "linq" | "telegram";
      service?: string;
      threadId: string;
    }) => ({
      conversation: {
        accountId: `${input.channel}_identity`,
        actorId: `${input.channel}_participant`,
        actorIsSelf: false,
        source: input.channel,
        threadId: input.threadId,
        threadIsDirect: false,
      },
      replyTarget: {
        channel: input.channel,
        messageId: `${input.threadId}_message`,
        threadId: input.threadId,
      },
      sourceMetadata: input.channel === "linq"
        ? {
            externalThreadRouteAuthorityPresent: true,
            kind: "linq" as const,
            partCount: 0,
            reactionEligible: false,
            replyToMessageId: null,
            senderHandle: "+15555550123",
            service: input.service ?? null,
          }
        : {
            externalThreadRouteAuthorityPresent: true,
            kind: "telegram" as const,
            mediaGroupId: null,
            replyContext: null,
            senderHandle: "1234567890",
            senderUsername: "example_user",
          },
    });
    mocks.readAssistantInputEvent.mockImplementation(async ({ inputId }) => {
      if (inputId === inputIds.imessage) {
        return buildGroupEvent({
          channel: "linq",
          service: "iMessage",
          threadId: "imessage_group_chat",
        });
      }
      if (inputId === inputIds.sms) {
        return buildGroupEvent({
          channel: "linq",
          service: "SMS",
          threadId: "sms_group_chat",
        });
      }
      if (inputId === inputIds.telegram) {
        return buildGroupEvent({
          channel: "telegram",
          threadId: "telegram_group_chat",
        });
      }
      return buildGroupEvent({
        channel: "linq",
        service: inputId === inputIds.mixedSms ? "SMS" : "RCS",
        threadId: "mixed_group_chat",
      });
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: Object.values(inputIds),
      importedCount: Object.values(inputIds).length,
      runtimeGroupToolPort: groupToolPort,
    }));
    const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    const operationScope = laneInput?.operationScope as
      | AssistantAutomationOperationScope
      | undefined;
    if (!laneInput?.executionContext || !operationScope) {
      throw new Error("Expected hosted automation operation scope.");
    }
    const offer = {
      action: "post_join_offer" as const,
      joinOffer: { projectionKinds: ["steps-days.v0" as const] },
    };
    const runOffer = async (
      ids: readonly string[],
      request: Extract<HostedRuntimeGroupToolRequest, {
        action: "post_join_offer";
      }> = offer,
    ) =>
      await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: ids,
        operation: async (executionContext) =>
          await executionContext.hosted?.groupTool?.request(request),
        turnEnvironment: null,
      });

    await expect(runOffer([inputIds.imessage])).resolves.toMatchObject({
      action: "post_join_offer",
      result: { status: "sent" },
    });
    await expect(runOffer([inputIds.sms])).resolves.toMatchObject({
      action: "create_join_link",
      result: {
        joinUrl: "https://example.test/groups/join/exact",
        status: "ok",
      },
    });
    await expect(runOffer([inputIds.telegram])).resolves.toMatchObject({
      action: "create_join_link",
      result: {
        joinUrl: "https://example.test/groups/join/exact",
        status: "ok",
      },
    });
    const emptyOffer = {
      action: "post_join_offer" as const,
      joinOffer: { projectionScopes: [] },
    };
    await expect(runOffer([inputIds.sms], emptyOffer)).resolves.toMatchObject({
      action: "create_join_link",
      result: { status: "ok" },
    });
    await expect(runOffer([inputIds.telegram], emptyOffer)).resolves.toMatchObject({
      action: "create_join_link",
      result: { status: "ok" },
    });
    await expect(runOffer([inputIds.mixedSms, inputIds.mixedRcs]))
      .resolves.toMatchObject({
        action: "post_join_offer",
        result: { status: "unavailable" },
      });

    expect(groupToolRequests).toEqual([
      expect.objectContaining({
        action: "post_join_offer",
        linqThread: expect.objectContaining({ chatId: "imessage_group_chat" }),
      }),
      {
        action: "create_join_link",
        joinLink: { requestedVaultShareProjectionKinds: ["steps-days.v0"] },
      },
      {
        action: "create_join_link",
        joinLink: { requestedVaultShareProjectionKinds: ["steps-days.v0"] },
      },
      {
        action: "create_join_link",
        joinLink: { requestedVaultShareProjectionScopes: [] },
      },
      {
        action: "create_join_link",
        joinLink: { requestedVaultShareProjectionScopes: [] },
      },
      offer,
    ]);
  });

  it("carries persisted direct Linq service through the real operation scope to referral tools", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-referral-service-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const referralRequests: HostedRuntimeGroupToolRequest[] = [];
    const groupToolPort: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
    > = {
      async request(request) {
        referralRequests.push(request);
        if (request.action === "read_usage_referral") {
          return {
            action: request.action,
            result: {
              referral: null,
              status: "unavailable" as const,
              unavailableReason: "synthetic_web_unavailable",
            },
          };
        }
        if (request.action === "arm_usage_referral") {
          return {
            action: request.action,
            result: {
              referral: null,
              status: "unavailable" as const,
              unavailableReason: "synthetic_web_unavailable",
            },
          };
        }
        throw new Error(`Unexpected group tool request: ${request.action}`);
      },
    };
    const serviceCases = [
      { expected: "imessage", observed: "iMessage" },
      { expected: "sms", observed: "SMS" },
      { expected: "rcs", observed: "RCS" },
      { expected: null, observed: null },
    ] as const;

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      const persistedInputs = await Promise.all(serviceCases.map(async (serviceCase, index) =>
        await upsertAssistantInputEvent({
          event: {
            content: {
              text: `direct referral service ${index}`,
              transcriptText: `direct referral service ${index}`,
              userMessageContent: [{
                text: `direct referral service ${index}`,
                type: "text" as const,
              }],
            },
            conversation: {
              accountId: `hid_${"1".repeat(32)}`,
              actorId: `hid_${"2".repeat(32)}`,
              actorIsSelf: false,
              source: "linq",
              threadId: `hid_${"3".repeat(32)}`,
              threadIsDirect: true,
            },
            occurredAt: `2026-04-27T00:00:0${index}.000Z`,
            receivedAt: `2026-04-27T00:00:0${index}.500Z`,
            replyTarget: {
              channel: "linq",
              messageId: `message_direct_referral_${index}`,
              threadId: "chat_direct_referral",
            },
            sourceMetadata: {
              externalThreadRouteAuthorityPresent: false,
              kind: "linq" as const,
              partCount: 0,
              reactionEligible: false,
              replyToMessageId: null,
              senderHandle: "+15555550123",
              service: serviceCase.observed,
            },
            sourceRef: {
              dedupeKey: `dedupe_direct_referral_${index}`,
              eventId: `event_direct_referral_${index}`,
              itemId: `mailbox_item_direct_referral_${index}`,
              kind: "hosted-mailbox" as const,
              lane: "conversation" as const,
              laneSeq: String(index),
              payloadSchema: "murph.hosted-mailbox-payload.v1",
              payloadSource: "inline" as const,
              source: "hosted-mailbox" as const,
              wakeSchema: "murph.hosted-execution-wake.v1",
            },
          },
          vault: vaultRoot,
        })
      ));
      const assistantAutomation = await vi.importActual<
        typeof import("@murphai/assistant-engine/assistant-automation")
      >("@murphai/assistant-engine/assistant-automation");
      mocks.readAssistantInputEvent.mockImplementation(
        assistantAutomation.readAssistantInputEvent,
      );

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: persistedInputs.map((persisted) => persisted.inputId),
        importedCount: persistedInputs.length,
        runtimeGroupToolPort: groupToolPort,
        vaultRoot,
      }));

      const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
      const operationScope = laneInput?.operationScope as
        | AssistantAutomationOperationScope
        | undefined;
      if (!laneInput?.executionContext || !operationScope) {
        throw new Error("Expected hosted automation operation scope.");
      }

      for (const [index, persisted] of persistedInputs.entries()) {
        const requestCountBefore = referralRequests.length;
        await operationScope.runAutoReplyGroup({
          executionContext: laneInput.executionContext,
          inputIds: [persisted.inputId],
          operation: async (executionContext) => {
            const groupTool = executionContext.hosted?.groupTool;
            if (!groupTool) {
              throw new Error("Expected operation-scoped group tool.");
            }
            await groupTool.request({ action: "read_usage_referral" });
            await groupTool.request({
              action: "arm_usage_referral",
              policyCodes: ["new_person_activation_v1"],
            });
          },
          turnEnvironment: null,
        });

        const expectedService = serviceCases[index]?.expected ?? null;
        const expectedSourceConversation = {
          channel: "linq" as const,
          ...(expectedService ? { linqService: expectedService } : {}),
          threadId: expect.stringMatching(/^hid_[a-f0-9]{32}$/u),
          threadIsDirect: true,
        };
        expect(referralRequests.slice(requestCountBefore)).toEqual([
          {
            action: "read_usage_referral",
            sourceConversation: expectedSourceConversation,
          },
          {
            action: "arm_usage_referral",
            policyCodes: ["new_person_activation_v1"],
            sourceConversation: expectedSourceConversation,
          },
        ]);
      }

      const requestCountBeforeMixed = referralRequests.length;
      await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: persistedInputs.slice(0, 2).map((persisted) => persisted.inputId),
        operation: async (executionContext) => {
          await executionContext.hosted?.groupTool?.request({
            action: "read_usage_referral",
          });
        },
        turnEnvironment: null,
      });
      expect(referralRequests.slice(requestCountBeforeMixed)).toEqual([{
        action: "read_usage_referral",
        sourceConversation: {
          channel: "linq",
          threadId: expect.stringMatching(/^hid_[a-f0-9]{32}$/u),
          threadIsDirect: true,
        },
      }]);
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("binds a persisted direct iMessage route to generated contact cards through the real operation scope", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-contact-card-route-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const contactCardRequests: HostedRuntimeGroupToolRequest[] = [];
    const contactCardImageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/contact-card.jpg?exp=2000000000`;
    const groupToolPort: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
    > = {
      async request(request) {
        contactCardRequests.push(request);
        if (request.action === "share_contact_card") {
          return {
            action: "share_contact_card" as const,
            result: { status: "sent" as const },
          };
        }
        throw new Error(`Unexpected group tool request: ${request.action}`);
      },
    };
    const buildContactCardEvent = (input: {
      index: number;
      threadIsDirect: boolean;
    }) => ({
      content: {
        text: `contact card request ${input.index}`,
        transcriptText: `contact card request ${input.index}`,
        userMessageContent: [{
          text: `contact card request ${input.index}`,
          type: "text" as const,
        }],
      },
      conversation: {
        accountId: `hid_${"1".repeat(32)}`,
        actorId: `hid_${"2".repeat(32)}`,
        actorIsSelf: false,
        source: "linq",
        threadId: `hid_${"3".repeat(32)}`,
        threadIsDirect: input.threadIsDirect,
      },
      occurredAt: `2026-04-27T00:00:0${input.index}.000Z`,
      receivedAt: `2026-04-27T00:00:0${input.index}.500Z`,
      replyTarget: {
        channel: "linq",
        messageId: `message_contact_card_${input.index}`,
        threadId: input.threadIsDirect
          ? "chat_direct_contact_card"
          : "chat_group_contact_card",
      },
      sourceMetadata: {
        // An ordinary direct wake carries no external thread-route authority:
        // its route lives in the member's own routing record. A group wake
        // does. This is the exact shape the production webhook persists.
        externalThreadRouteAuthorityPresent: !input.threadIsDirect,
        kind: "linq" as const,
        partCount: 0,
        reactionEligible: false,
        replyToMessageId: null,
        senderHandle: "+15555550123",
        service: "iMessage",
      },
      sourceRef: {
        dedupeKey: `dedupe_contact_card_${input.index}`,
        eventId: `event_contact_card_${input.index}`,
        itemId: `mailbox_item_contact_card_${input.index}`,
        kind: "hosted-mailbox" as const,
        lane: "conversation" as const,
        laneSeq: String(input.index),
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        payloadSource: "inline" as const,
        source: "hosted-mailbox" as const,
        wakeSchema: "murph.hosted-execution-wake.v1",
      },
    });

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      const directInput = await upsertAssistantInputEvent({
        event: buildContactCardEvent({ index: 0, threadIsDirect: true }),
        vault: vaultRoot,
      });
      const groupInput = await upsertAssistantInputEvent({
        event: buildContactCardEvent({ index: 1, threadIsDirect: false }),
        vault: vaultRoot,
      });
      const assistantAutomation = await vi.importActual<
        typeof import("@murphai/assistant-engine/assistant-automation")
      >("@murphai/assistant-engine/assistant-automation");
      mocks.readAssistantInputEvent.mockImplementation(
        assistantAutomation.readAssistantInputEvent,
      );

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [directInput.inputId, groupInput.inputId],
        importedCount: 2,
        runtimeGroupToolPort: groupToolPort,
        vaultRoot,
      }));

      const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
      const operationScope = laneInput?.operationScope as
        | AssistantAutomationOperationScope
        | undefined;
      if (!laneInput?.executionContext || !operationScope) {
        throw new Error("Expected hosted automation operation scope.");
      }

      const routeStatuses: unknown[] = [];
      const runShare = async (inputId: string) =>
        await operationScope.runAutoReplyGroup({
          executionContext: laneInput.executionContext,
          inputIds: [inputId],
          operation: async (executionContext) => {
            const groupTool = executionContext.hosted?.groupTool;
            if (!groupTool) {
              throw new Error("Expected operation-scoped group tool.");
            }
            routeStatuses.push(groupTool.directAttachmentRouteStatus?.());
            return await groupTool.request({
              action: "share_contact_card",
              contactCardImageUrl,
              contactCardShareKey: inputId,
            });
          },
          turnEnvironment: null,
        });

      await expect(runShare(directInput.inputId)).resolves.toMatchObject({
        action: "share_contact_card",
        result: { status: "sent" },
      });
      // A group input must not read as a direct attachment route or
      // forward a partial personalized transport request.
      await expect(runShare(groupInput.inputId)).resolves.toEqual({
        action: "share_contact_card",
        result: {
          status: "unavailable",
          unavailableReason: "direct_attachment_route_unavailable",
        },
      });

      expect(routeStatuses).toEqual([
        { status: "ok" },
        {
          status: "unavailable",
          unavailableReason: "direct_attachment_route_unavailable",
        },
      ]);
      expect(contactCardRequests).toEqual([
        // The trusted host's exact direct chat, carried without any group
        // thread-route authority, which a direct home chat cannot have.
        {
          action: "share_contact_card",
          contactCardImageUrl,
          contactCardShareKey: directInput.inputId,
          directLinqChatId: "chat_direct_contact_card",
        },
      ]);
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("scopes automation and group mutation authority to each durable accepted input", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-automation-tool-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const emailInputId = "ain_00000000000000000000000000000001";
    const linqInputId = "ain_00000000000000000000000000000002";
    const telegramInputId = "ain_00000000000000000000000000000003";
    const groupRequestMock = vi.fn(async (request: HostedRuntimeGroupToolRequest) =>
      request.action === "read_shared"
        ? {
            action: request.action,
            result: {
              members: [] as const,
              requestedProjectionScopeKeys: ["steps-days.v0"] as const,
              status: "none" as const,
            },
          }
        : {
            action: "update_display_name" as const,
            result: {
              group: null,
              status: "unavailable" as const,
              unavailableReason: "test_backend_unavailable",
            },
          });
    const groupRequest: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
    >["request"] = groupRequestMock;
    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      mocks.readAssistantInputEvent.mockImplementation(async ({ inputId }) => {
        if (inputId === emailInputId) {
          return {
              conversation: {
                accountId: "email_identity",
                actorId: null,
                actorIsSelf: false,
                source: "email",
                threadId: "email_thread",
                threadIsDirect: false,
              },
              replyTarget: {
                channel: "email",
                messageId: "email_message",
                threadId: "email_delivery_thread",
              },
            };
        }
        if (inputId === telegramInputId) {
          return {
            conversation: {
              accountId: "telegram_identity",
              actorId: "telegram_participant",
              actorIsSelf: false,
              source: "telegram",
              threadId: "telegram_group_thread",
              threadIsDirect: false,
            },
            replyTarget: {
              channel: "telegram",
              messageId: "telegram_message",
              threadId: "telegram_group_chat",
            },
            sourceMetadata: {
              externalThreadRouteAuthorityPresent: true,
              kind: "telegram",
              mediaGroupId: null,
              replyContext: null,
              senderHandle: "1234567890",
              senderUsername: "alice_example",
            },
          };
        }
        return {
              conversation: {
                accountId: "linq_identity",
                actorId: "linq_participant",
                actorIsSelf: false,
                source: "linq",
                threadId: "linq_thread",
                threadIsDirect: false,
              },
              replyTarget: {
                channel: "linq",
                messageId: "linq_message",
                threadId: "linq_group_chat",
              },
              sourceMetadata: {
                externalThreadRouteAuthorityPresent: true,
                kind: "linq",
                partCount: 0,
                reactionEligible: false,
                replyToMessageId: null,
                senderHandle: "+15555550123",
                service: "imessage",
              },
            };
      });

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [emailInputId, linqInputId, telegramInputId],
        importedCount: 3,
        runtimeGroupToolPort: { request: groupRequest },
        vaultRoot,
      }));

      const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
      const operationScope = laneInput?.operationScope as
        | AssistantAutomationOperationScope
        | undefined;
      if (!laneInput?.executionContext || !operationScope) {
        throw new Error("Expected hosted automation operation scope.");
      }

      const emailHandoffResult = await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [emailInputId],
        operation: async (executionContext) =>
          executionContext.hosted?.groupTool?.request({
            action: "handoff",
            context: "Email cannot hand off private context.",
            membershipId: "hgm_private_member",
            originAssistantInputId: emailInputId,
          }),
        turnEnvironment: null,
      });
      expect(emailHandoffResult).toEqual({
        action: "handoff",
        result: {
          status: "unavailable",
          unavailableReason: "authenticated_sender_required",
        },
      });

      const emailResult = await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [emailInputId],
        operation: async (executionContext, turnEnvironment) => {
          expect(turnEnvironment?.env).toEqual({ BASE_ENV: "preserved" });
          expect(executionContext.hosted?.automationTool).toBeUndefined();
          expect(executionContext.hosted?.groupSharedReader).toEqual(
            expect.objectContaining({ request: expect.any(Function) }),
          );
          return await executionContext.hosted?.groupTool?.request({
            action: "update_display_name",
            updateDisplayName: { displayName: "Email cannot rename" },
          });
        },
        turnEnvironment: { env: { BASE_ENV: "preserved" } },
      });
      expect(emailResult).toEqual({
        action: "update_display_name",
        result: {
          group: null,
          status: "unavailable",
          unavailableReason: "authenticated_sender_required",
        },
      });
      expect(groupRequestMock).not.toHaveBeenCalled();

      const linqResult = await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [linqInputId],
        operation: async (executionContext, turnEnvironment) => {
          expect(turnEnvironment?.env).toEqual({ BASE_ENV: "preserved" });
          expect(executionContext.hosted?.groupSharedReader).toEqual(
            expect.objectContaining({ request: expect.any(Function) }),
          );
          await expect(executionContext.hosted?.groupSharedReader?.request({
            projectionScopes: [{ projectionKind: "steps-days.v0" }],
          })).resolves.toMatchObject({ status: "none" });
          const saved = await executionContext.hosted?.automationTool?.request({
            action: "save",
            activeUntil: "2099-08-01T00:00:00.000Z",
            contextReferences: [
              { entityId: "wfmt_group_check_in", entityKind: "workout_format" },
              { entityId: "exp_group_check_in", entityKind: "experiment" },
            ],
            instructions: "Ask for one lightweight group check-in.",
            schedule: {
              kind: "dailyLocal",
              localTime: "21:00",
              timeZone: "America/Chicago",
            },
            slug: "group-check-in",
            supportKind: "check_in",
            supportSeriesId: "habit:group-check-in",
            title: "Group check-in",
          });
          if (!saved || saved.action !== "save") {
            throw new Error("Expected saved automation.");
          }
          const newsletter = await executionContext.hosted?.automationTool?.request({
            action: "save",
            continuityPolicy: "fresh",
            instructions: [
              "Read and follow the group-newsletter skill before every execution.",
              "Delivery: current_chat",
              "Health scopes: steps-days.v0, sleep-duration-days.v0",
              "Tone: supportive",
            ].join("\n"),
            schedule: { expression: "0 13 * * 1", kind: "cron" },
            slug: "group-health-newsletter",
            title: "Family weekly health newsletter",
          });
          if (!newsletter || newsletter.action !== "save") {
            throw new Error("Expected saved group newsletter.");
          }
          await expect(executionContext.hosted?.automationTool?.request({
            action: "save",
            automationId: newsletter.automationId,
            instructions: "Replace the group newsletter with free-form instructions.",
            schedule: { expression: "0 13 * * 1", kind: "cron" },
            title: "Family weekly health newsletter",
          })).rejects.toMatchObject({ code: "VAULT_AUTOMATION_CONFLICT" });
          await expect(executionContext.hosted?.automationTool?.request({
            action: "save",
            instructions: "Replace the group newsletter by slug.",
            schedule: { expression: "0 13 * * 1", kind: "cron" },
            slug: "group-health-newsletter",
            title: "Family weekly health newsletter",
          })).rejects.toMatchObject({ code: "VAULT_AUTOMATION_CONFLICT" });
          const rescheduledNewsletter = await executionContext.hosted?.automationTool?.request({
            action: "patch",
            expectedUpdatedAt: newsletter.updatedAt,
            lookup: "group-health-newsletter",
            schedule: { expression: "0 14 * * 1", kind: "cron" },
          });
          expect(rescheduledNewsletter).toMatchObject({
            action: "patch",
            routeBinding: "preserved",
          });
          if (!rescheduledNewsletter || rescheduledNewsletter.action !== "patch") {
            throw new Error("Expected rescheduled group newsletter.");
          }
          await expect(executionContext.hosted?.automationTool?.request({
            action: "patch",
            expectedUpdatedAt: rescheduledNewsletter.updatedAt,
            lookup: "group-health-newsletter",
            status: "paused",
          })).resolves.toEqual(expect.objectContaining({
            action: "patch",
            routeBinding: "preserved",
            status: "paused",
          }));

          const reminderRoot = await executionContext.hosted?.automationTool?.request({
            action: "save",
            instructions: "Send the synthetic mobility reminder.",
            schedule: { kind: "dailyLocal", localTime: "08:00" },
            title: "Mobility reminder",
          });
          if (!reminderRoot || reminderRoot.action !== "save") {
            throw new Error("Expected root reminder save.");
          }
          await executionContext.hosted?.automationTool?.request({
            action: "patch",
            expectedUpdatedAt: reminderRoot.updatedAt,
            lookup: reminderRoot.automationId,
            status: "archived",
          });
          const repeatedTitleReminder =
            await executionContext.hosted?.automationTool?.request({
            action: "save",
            instructions: "Send the new mobility reminder.",
            schedule: { kind: "dailyLocal", localTime: "08:15" },
            title: "Mobility reminder",
          });
          if (
            !repeatedTitleReminder
            || repeatedTitleReminder.action !== "save"
          ) {
            throw new Error("Expected repeated-title reminder save.");
          }
          expect(repeatedTitleReminder).toEqual(expect.objectContaining({
            created: true,
            lookupId: repeatedTitleReminder.automationId
              .toLowerCase()
              .replace("_", "-"),
            status: "active",
          }));
          expect(repeatedTitleReminder.automationId).not.toBe(
            reminderRoot.automationId,
          );
          const reservedTitleReminder =
            await executionContext.hosted?.automationTool?.request({
              action: "save",
              instructions: "Send this ordinary synthetic reminder.",
              schedule: { kind: "dailyLocal", localTime: "08:30" },
              title: "Onboarding first personal read",
            });
          expect(reservedTitleReminder).toEqual(expect.objectContaining({
            action: "save",
            created: true,
            status: "active",
          }));
          if (!reservedTitleReminder || reservedTitleReminder.action !== "save") {
            throw new Error("Expected ordinary reserved-title reminder save.");
          }
          expect(reservedTitleReminder.automationId).not.toBe(
            MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
          );
          const archivedReminder =
            await executionContext.hosted?.automationTool?.request({
              action: "inspect",
              lookup: reminderRoot.automationId,
            });
          if (!archivedReminder || archivedReminder.action !== "inspect") {
            throw new Error("Expected archived reminder inspection.");
          }
          expect(archivedReminder).toEqual(expect.objectContaining({
            automationId: reminderRoot.automationId,
            lookupId: reminderRoot.automationId.toLowerCase().replace("_", "-"),
            status: "archived",
          }));

          const stale = await executionContext.hosted?.automationTool?.request({
            action: "save",
            instructions: "Archive this stale group check-in.",
            schedule: { kind: "dailyLocal", localTime: "08:45" },
            slug: "stale-group-check-in",
            supportKind: "check_in",
            supportSeriesId: "habit:group-check-in",
            title: "Stale group check-in",
          });
          const paused = await executionContext.hosted?.automationTool?.request({
            action: "save",
            instructions: "Keep this user-paused group check-in paused.",
            schedule: { kind: "dailyLocal", localTime: "09:00" },
            slug: "paused-group-check-in",
            status: "paused",
            supportKind: "check_in",
            supportSeriesId: "habit:group-check-in",
            title: "Paused group check-in",
          });
          const otherSeries = await executionContext.hosted?.automationTool?.request({
            action: "save",
            instructions: "Keep this separate support series active.",
            schedule: { kind: "dailyLocal", localTime: "09:15" },
            slug: "other-group-check-in",
            supportKind: "check_in",
            supportSeriesId: "habit:other-group-check-in",
            title: "Other group check-in",
          });
          if (
            stale?.action !== "save"
            || paused?.action !== "save"
            || otherSeries?.action !== "save"
          ) {
            throw new Error("Expected support-series fixture automations.");
          }
          await expect(executionContext.hosted?.automationTool?.request({
            action: "reconcile",
            desiredAutomationIds: [saved.automationId],
            supportSeriesId: "habit:group-check-in",
          })).resolves.toEqual({
            action: "reconcile",
            archivedCount: 1,
            matchedCount: 3,
            missingDesiredAutomationIds: [],
            supportSeriesId: "habit:group-check-in",
            unchangedCount: 2,
          });
          await expect(executionContext.hosted?.automationTool?.request({
            action: "save",
            instructions: "This request must fail before persistence.",
            schedule: { kind: "dailyLocal", localTime: "08:30" },
            tags: ["system:support-series:habit:model-controlled"],
            title: "Invalid support tag",
          })).rejects.toThrow(
            "Reserved automation support tags must be set through supportSeriesId.",
          );
          await executionContext.hosted?.groupTool?.request({
            action: "update_display_name",
            updateDisplayName: { displayName: "Linq can rename" },
          });
          return saved;
        },
        turnEnvironment: { env: { BASE_ENV: "preserved" } },
      });
      expect(linqResult).toEqual(expect.objectContaining({
        action: "save",
        created: true,
        contextReferences: [
          { entityId: "wfmt_group_check_in", entityKind: "workout_format" },
          { entityId: "exp_group_check_in", entityKind: "experiment" },
        ],
        effectiveTimeZone: "America/Chicago",
        lookupId: "group-check-in",
        occurrenceProjection: {
          nextOccurrenceAt: expect.any(String),
          status: 'resolved' as const,
        },
        routeBinding: "current_conversation",
        schedule: {
          kind: "dailyLocal",
          localTime: "21:00",
          timeZone: "America/Chicago",
        },
        status: "active",
      }));
      const telegramResult = await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [telegramInputId],
        operation: async (executionContext) => {
          // Telegram group evidence must survive operation-scope
          // reconstruction and reach Web channel-qualified.
          await executionContext.hosted?.groupTool?.request({
            action: "read_shared",
            projectionScopes: [{ projectionKind: "steps-days.v0" }],
          });
          const current = await showAutomation({
            slug: "group-health-newsletter",
            vaultRoot,
          });
          if (!current) {
            throw new Error("Expected current group newsletter.");
          }
          return await executionContext.hosted?.automationTool?.request({
            action: "patch",
            expectedUpdatedAt: current.updatedAt,
            lookup: "group-health-newsletter",
            retargetToCurrentConversation: true,
            title: "Telegram group health newsletter",
          });
        },
        turnEnvironment: null,
      });
      expect(groupRequestMock).toHaveBeenCalledWith({
        action: "read_shared",
        telegramSenderHandles: ["1234567890"],
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      expect(telegramResult).toEqual(expect.objectContaining({
        action: "patch",
        created: false,
        lookupId: "group-health-newsletter",
        routeBinding: "current_conversation",
        status: "paused",
      }));
      expect(groupRequestMock).toHaveBeenCalledWith({
        action: "read_shared",
        linqSenderHandles: ["+15555550123"],
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      expect(groupRequestMock).toHaveBeenCalledWith({
        action: "update_display_name",
        updateDisplayName: { displayName: "Linq can rename" },
        linqThread: {
          authority: {
            channel: "linq",
            containerMemberId: "member_synthetic_phase",
            threadId: "linq_group_chat",
          },
          chatId: "linq_group_chat",
        },
      });
      await expect(showAutomation({
        slug: "group-check-in",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({
        activeUntil: "2099-08-01T00:00:00.000Z",
        contextReferences: [
          { entityId: "wfmt_group_check_in", entityKind: "workout_format" },
          { entityId: "exp_group_check_in", entityKind: "experiment" },
        ],
        route: expect.objectContaining({
          channel: "linq",
          deliveryTarget: "linq_group_chat",
          threadIsDirect: false,
        }),
        supportKind: "check_in",
        schedule: {
          kind: "dailyLocal",
          localTime: "21:00",
          timeZone: "America/Chicago",
        },
        tags: expect.arrayContaining([
          "system:support-series:habit:group-check-in",
        ]),
      }));
      await expect(showAutomation({
        slug: "group-health-newsletter",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({
        continuityPolicy: "fresh",
        route: expect.objectContaining({
          channel: "telegram",
          deliveryTarget: "telegram_group_chat",
          threadIsDirect: false,
        }),
        instructions: expect.stringContaining("group-newsletter skill"),
        status: "paused",
      }));
      await expect(showAutomation({
        slug: "stale-group-check-in",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({ status: "archived" }));
      await expect(showAutomation({
        slug: "paused-group-check-in",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({ status: "paused" }));
      await expect(showAutomation({
        slug: "other-group-check-in",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({ status: "active" }));
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("distinguishes pending scheduler work, stale recurrences, and resolved occurrences after reminder patches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-automation-timing-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const inputId = "ain_44444444444444444444444444444444";

    try {
      await initializeVault({
        createdAt: "2026-08-01T12:00:00.000Z",
        timezone: "America/New_York",
        vaultRoot,
      });
      mocks.readAssistantInputEvent.mockResolvedValue({
        conversation: {
          accountId: "linq_identity_timing",
          actorId: "linq_participant_timing",
          actorIsSelf: false,
          source: "linq",
          threadId: "linq_thread_timing",
          threadIsDirect: true,
        },
        replyTarget: {
          channel: "linq",
          messageId: "linq_message_timing",
          threadId: "linq_chat_timing",
        },
      });

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [inputId],
        importedCount: 1,
        vaultRoot,
      }));
      const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
      const operationScope = laneInput?.operationScope as
        | AssistantAutomationOperationScope
        | undefined;
      if (!laneInput?.executionContext || !operationScope) {
        throw new Error("Expected hosted automation operation scope.");
      }

      const requestAutomation = async (
        request: Parameters<
          NonNullable<
            NonNullable<AssistantExecutionContext["hosted"]>["automationTool"]
          >["request"]
        >[0],
      ) => await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          return await automationTool.request(request);
        },
        turnEnvironment: null,
      });

      const nextWorkout = await requestAutomation({
        action: "save",
        instructions: "Ask how the next workout felt.",
        schedule: {
          activityKind: "workout",
          after: "2026-08-01T12:00:00.000Z",
          kind: "deviceActivity",
          source: "whoop",
        },
        slug: "next-workout-check-in",
        title: "Next workout check-in",
      });
      if (nextWorkout.action !== "save") {
        throw new Error("Expected next-workout save result.");
      }
      expect(nextWorkout).toEqual(expect.objectContaining({
        effectiveTimeZone: null,
        occurrenceProjection: {
          nextOccurrenceAt: null,
          status: "resolved",
        },
        schedule: {
          activityKind: "workout",
          after: "2026-08-01T12:00:00.000Z",
          kind: "deviceActivity",
          source: "whoop",
        },
        status: "active",
      }));
      await expect(requestAutomation({
        action: "patch",
        expectedUpdatedAt: nextWorkout.updatedAt,
        instructions: "Ask briefly how the next workout felt.",
        lookup: "next-workout-check-in",
      })).resolves.toEqual(expect.objectContaining({
        occurrenceProjection: {
          nextOccurrenceAt: null,
          status: 'resolved' as const,
        },
        schedule: expect.objectContaining({ kind: "deviceActivity" }),
        status: "active",
      }));

      const dailyEveningReminder = await requestAutomation({
        action: "save",
        instructions: "Send the daily evening reminder.",
        schedule: {
          kind: "dailyLocal",
          localTime: "21:00",
          timeZone: "America/Chicago",
        },
        slug: "daily-evening-reminder",
        status: "paused",
        title: "Daily evening reminder",
      });
      if (dailyEveningReminder.action !== "save") {
        throw new Error("Expected daily reminder save result.");
      }
      expect(dailyEveningReminder).toEqual(expect.objectContaining({
        occurrenceProjection: {
          nextOccurrenceAt: null,
          status: 'resolved' as const,
        },
        status: "paused",
      }));

      const oneTimeEveningReminder = await requestAutomation({
        action: "save",
        instructions: "Send the one-time evening reminder.",
        schedule: {
          at: "2026-08-01T13:00:00.000Z",
          kind: "at",
        },
        slug: "one-time-evening-reminder",
        status: "paused",
        title: "One-time evening reminder",
      });
      if (oneTimeEveningReminder.action !== "save") {
        throw new Error("Expected one-time reminder save result.");
      }
      expect(oneTimeEveningReminder).toEqual(expect.objectContaining({
        occurrenceProjection: {
          nextOccurrenceAt: null,
          status: 'resolved' as const,
        },
        status: "paused",
      }));

      const finiteOneTimeReminder = await requestAutomation({
        action: "save",
        activeUntil: "2026-08-01T12:45:00.000Z",
        instructions: "Send the finite one-time reminder.",
        schedule: {
          at: "2026-08-01T12:30:00.000Z",
          kind: "at",
        },
        slug: "finite-one-time-reminder",
        status: "paused",
        title: "Finite one-time reminder",
      });
      if (finiteOneTimeReminder.action !== "save") {
        throw new Error("Expected finite reminder save result.");
      }
      expect(finiteOneTimeReminder).toEqual(expect.objectContaining({
        occurrenceProjection: {
          nextOccurrenceAt: null,
          status: 'resolved' as const,
        },
        status: "paused",
      }));

      const recurringIntervalReminder = await requestAutomation({
        action: "save",
        instructions: "Send the recurring interval reminder.",
        schedule: {
          everyMs: 86_400_000,
          kind: "every",
        },
        slug: "recurring-interval-reminder",
        title: "Recurring interval reminder",
      });
      if (recurringIntervalReminder.action !== "save") {
        throw new Error("Expected recurring reminder save result.");
      }
      expect(recurringIntervalReminder).toEqual(expect.objectContaining({
        occurrenceProjection: {
          nextOccurrenceAt: "2026-08-02T12:00:00.000Z",
          status: 'resolved' as const,
        },
        status: "active",
      }));

      const inFlightRecurringReminder = await requestAutomation({
        action: "save",
        instructions: "Send the recurring in-flight reminder.",
        schedule: {
          everyMs: 43_200_000,
          kind: "every",
        },
        slug: "in-flight-recurring-reminder",
        title: "In-flight recurring reminder",
      });
      if (inFlightRecurringReminder.action !== "save") {
        throw new Error("Expected in-flight recurring reminder save result.");
      }
      const initializedInFlightRecurringReminder =
        await setAssistantCronJobEnabled(
          vaultRoot,
          inFlightRecurringReminder.automationId,
          true,
        );
      await setPendingAutomationDeliveryIntentForTest({
        automationId: inFlightRecurringReminder.automationId,
        intentId: "intent_in_flight_recurring_reminder",
        vaultRoot,
      });
      const inFlightProjectionCallsBefore =
        mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length;
      await expect(requestAutomation({
        action: "patch",
        expectedUpdatedAt: initializedInFlightRecurringReminder.updatedAt,
        instructions: "Send the revised recurring in-flight reminder.",
        lookup: "in-flight-recurring-reminder",
      })).resolves.toEqual(expect.objectContaining({
        occurrenceProjection: { status: "pending" },
        schedule: {
          everyMs: 43_200_000,
          kind: "every",
        },
        status: "active",
      }));
      expect(
        mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length
        - inFlightProjectionCallsBefore,
      ).toBe(1);

      vi.setSystemTime(new Date("2026-08-01T13:00:00.000Z"));
      await expect(requestAutomation({
        action: "patch",
        expectedUpdatedAt: finiteOneTimeReminder.updatedAt,
        lookup: "finite-one-time-reminder",
        status: "active",
      })).resolves.toEqual(expect.objectContaining({
        occurrenceProjection: {
          nextOccurrenceAt: null,
          status: 'resolved' as const,
        },
        status: "active",
      }));

      vi.setSystemTime(new Date("2026-08-10T00:27:19.000Z"));
      const staleProjectionCallsBefore =
        mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length;
      await expect(requestAutomation({
        action: "patch",
        expectedUpdatedAt: recurringIntervalReminder.updatedAt,
        instructions: "Send the revised recurring interval reminder.",
        lookup: "recurring-interval-reminder",
      })).resolves.toEqual(expect.objectContaining({
        occurrenceProjection: {
          issues: ["stale_recurring_occurrence"],
          status: "unavailable",
        },
        schedule: {
          everyMs: 86_400_000,
          kind: "every",
        },
        status: "active",
      }));
      expect(
        mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length
        - staleProjectionCallsBefore,
      ).toBe(2);
      const staleInspectCallsBefore =
        mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length;
      await expect(requestAutomation({
        action: "inspect",
        lookup: "recurring-interval-reminder",
      })).resolves.toEqual(expect.objectContaining({
        action: "inspect",
        occurrenceProjection: {
          issues: ["stale_recurring_occurrence"],
          status: "unavailable",
        },
        schedule: {
          everyMs: 86_400_000,
          kind: "every",
        },
        status: "active",
      }));
      expect(
        mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length
        - staleInspectCallsBefore,
      ).toBe(1);
      await expect(requestAutomation({
        action: "patch",
        expectedUpdatedAt: oneTimeEveningReminder.updatedAt,
        lookup: "one-time-evening-reminder",
        status: "active",
      })).resolves.toEqual(expect.objectContaining({
        occurrenceProjection: {
          nextOccurrenceAt: null,
          status: 'resolved' as const,
        },
        schedule: {
          at: "2026-08-01T13:00:00.000Z",
          kind: "at",
        },
        status: "active",
      }));
      const dailyReactivated = await requestAutomation({
        action: "patch",
        expectedUpdatedAt: dailyEveningReminder.updatedAt,
        lookup: "daily-evening-reminder",
        status: "active",
      });
      if (dailyReactivated.action !== "patch") {
        throw new Error("Expected daily reminder patch result.");
      }
      expect(dailyReactivated).toEqual(expect.objectContaining({
        effectiveTimeZone: "America/Chicago",
        occurrenceProjection: {
          nextOccurrenceAt: "2026-08-10T02:00:00.000Z",
          status: 'resolved' as const,
        },
      }));
      await expect(getAssistantCronJob(
        vaultRoot,
        "daily-evening-reminder",
      )).resolves.toMatchObject({
        state: { nextRunAt: "2026-08-10T02:00:00.000Z" },
      });

      vi.setSystemTime(new Date("2026-08-10T00:28:19.000Z"));
      const dailyRevised = await requestAutomation({
        action: "patch",
        expectedUpdatedAt: dailyReactivated.updatedAt,
        lookup: "daily-evening-reminder",
        schedule: {
          kind: "dailyLocal",
          localTime: "22:00",
          timeZone: "America/Chicago",
        },
      });
      if (dailyRevised.action !== "patch") {
        throw new Error("Expected daily revised patch result.");
      }
      expect(dailyRevised).toEqual(expect.objectContaining({
        occurrenceProjection: {
          nextOccurrenceAt: "2026-08-10T03:00:00.000Z",
          status: 'resolved' as const,
        },
        schedule: {
          kind: "dailyLocal",
          localTime: "22:00",
          timeZone: "America/Chicago",
        },
      }));
      await expect(getAssistantCronJob(
        vaultRoot,
        "daily-evening-reminder",
      )).resolves.toMatchObject({
        state: { nextRunAt: "2026-08-10T03:00:00.000Z" },
      });

      const beforeInspect = await showAutomation({
        slug: "daily-evening-reminder",
        vaultRoot,
      });
      if (!beforeInspect) {
        throw new Error("Expected daily reminder before inspection.");
      }
      const recordPath = path.join(vaultRoot, beforeInspect.relativePath);
      const recordBytesBeforeInspect = await readFile(recordPath, "utf8");
      await expect(requestAutomation({
        action: "inspect",
        lookup: "daily-evening-reminder",
      })).resolves.toEqual({
        action: "inspect",
        automationId: beforeInspect.automationId,
        contextReferences: [],
        effectiveTimeZone: "America/Chicago",
        lookupId: "daily-evening-reminder",
        occurrenceProjection: {
          nextOccurrenceAt: "2026-08-10T03:00:00.000Z",
          status: 'resolved' as const,
        },
        routeBinding: "preserved",
        schedule: {
          kind: "dailyLocal",
          localTime: "22:00",
          timeZone: "America/Chicago",
        },
        status: "active",
        updatedAt: dailyRevised.updatedAt,
      });
      await expect(readFile(recordPath, "utf8")).resolves.toBe(
        recordBytesBeforeInspect,
      );
      await expect(showAutomation({
        slug: "daily-evening-reminder",
        vaultRoot,
      })).resolves.toEqual(beforeInspect);

      mocks.resolveAssistantCronDefaultTimeZoneProjection.mockResolvedValueOnce({
        timeZone: "America/New_York",
        vaultTimeZoneVerified: false,
      });
      const dailyPreservedTimeZone = await requestAutomation({
        action: "patch",
        expectedUpdatedAt: dailyRevised.updatedAt,
        lookup: "daily-evening-reminder",
        schedule: {
          kind: "dailyLocal",
          localTime: "23:00",
        },
      });
      if (dailyPreservedTimeZone.action !== "patch") {
        throw new Error("Expected daily preserved-timezone patch result.");
      }
      expect(dailyPreservedTimeZone).toEqual(expect.objectContaining({
        action: "patch",
        effectiveTimeZone: "America/Chicago",
        occurrenceProjection: {
          nextOccurrenceAt: "2026-08-10T04:00:00.000Z",
          status: 'resolved' as const,
        },
        schedule: {
          kind: "dailyLocal",
          localTime: "23:00",
          timeZone: "America/Chicago",
        },
      }));

      await expect(requestAutomation({
        action: "patch",
        activeUntil: "2026-08-10T02:30:00.000Z",
        expectedUpdatedAt: dailyPreservedTimeZone.updatedAt,
        lookup: "daily-evening-reminder",
      })).resolves.toEqual(expect.objectContaining({
        action: "patch",
        occurrenceProjection: {
          nextOccurrenceAt: null,
          status: 'resolved' as const,
        },
      }));
      await expect(getAssistantCronJob(
        vaultRoot,
        "daily-evening-reminder",
      )).resolves.toMatchObject({
        state: { nextRunAt: "2026-08-10T02:30:00.000Z" },
      });

      vi.setSystemTime(new Date("2026-08-11T01:00:00.000Z"));
      const implicitTimeZoneReminder = await requestAutomation({
        action: "save",
        instructions: "Send the implicit-timezone reminder.",
        schedule: {
          kind: "dailyLocal",
          localTime: "02:00",
        },
        slug: "implicit-timezone-reminder",
        title: "Implicit timezone reminder",
      });
      if (implicitTimeZoneReminder.action !== "save") {
        throw new Error("Expected implicit-timezone reminder save result.");
      }
      expect(implicitTimeZoneReminder).toEqual(expect.objectContaining({
        effectiveTimeZone: "America/New_York",
        occurrenceProjection: {
          nextOccurrenceAt: "2026-08-11T06:00:00.000Z",
          status: "resolved",
        },
      }));

      vi.setSystemTime(new Date("2026-08-11T03:01:00.000Z"));
      mocks.resolveAssistantCronDefaultTimeZoneProjection.mockResolvedValueOnce({
        timeZone: "UTC",
        vaultTimeZoneVerified: false,
      });
      await expect(requestAutomation({
        action: "inspect",
        lookup: "implicit-timezone-reminder",
      })).resolves.toEqual(expect.objectContaining({
        action: "inspect",
        effectiveTimeZone: "UTC",
        occurrenceProjection: {
          issues: ["default_timezone_unverified"],
          status: "unavailable",
        },
        schedule: {
          kind: "dailyLocal",
          localTime: "02:00",
        },
        status: "active",
      }));
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("logs content-free timing verification failure and recovery details", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T01:00:00.000Z"));
    const parentRoot = await mkdtemp(path.join(
      tmpdir(),
      "hosted-automation-verification-telemetry-",
    ));
    const vaultRoot = path.join(parentRoot, "vault");
    const inputId = "ain_45454545454545454545454545454545";
    const logRequests: HostedRuntimeLogRequest[] = [];

    try {
      await initializeVault({
        createdAt: "2026-08-13T01:00:00.000Z",
        timezone: "America/New_York",
        vaultRoot,
      });
      mocks.readAssistantInputEvent.mockResolvedValue({
        conversation: {
          accountId: "linq_identity_verification_telemetry",
          actorId: "linq_participant_verification_telemetry",
          actorIsSelf: false,
          source: "linq",
          threadId: "linq_thread_verification_telemetry",
          threadIsDirect: true,
        },
        replyTarget: {
          channel: "linq",
          messageId: "linq_message_verification_telemetry",
          threadId: "linq_chat_verification_telemetry",
        },
      });
      mocks.resolveAssistantCronDefaultTimeZoneProjection
        .mockResolvedValueOnce({
          timeZone: "America/New_York",
          vaultTimeZoneVerified: false,
        })
        .mockResolvedValue({
          timeZone: "America/New_York",
          vaultTimeZoneVerified: true,
        });
      mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
        await laneInput.operationScope.runAutoReplyGroup({
          executionContext: laneInput.executionContext,
          inputIds: [inputId],
          operation: async (executionContext: AssistantExecutionContext) => {
            const automationTool = executionContext.hosted?.automationTool;
            if (!automationTool) {
              throw new Error("Expected scoped hosted automation tool.");
            }
            const recoveredProjectionCallsBefore =
              mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length;
            const saved = await automationTool.request({
              action: "save",
              instructions: "Send the synthetic private reminder payload.",
              schedule: {
                kind: "dailyLocal",
                localTime: "22:30",
              },
              slug: "synthetic-private-verification-reminder",
              title: "Synthetic private verification reminder",
            });
            expect(saved).toEqual(expect.objectContaining({
              occurrenceProjection: expect.objectContaining({
                status: "resolved",
              }),
            }));
            expect(
              mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length
              - recoveredProjectionCallsBefore,
            ).toBe(2);

            mocks.resolveAssistantCronDefaultTimeZoneProjection.mockResolvedValue({
              timeZone: "America/New_York",
              vaultTimeZoneVerified: false,
            });
            const persistentProjectionCallsBefore =
              mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length;
            await expect(automationTool.request({
              action: "save",
              instructions: "Send another synthetic private reminder payload.",
              schedule: {
                kind: "dailyLocal",
                localTime: "23:30",
              },
              slug: "synthetic-private-persistent-verification-reminder",
              title: "Synthetic private persistent verification reminder",
            })).resolves.toEqual(expect.objectContaining({
              occurrenceProjection: {
                issues: ["default_timezone_unverified"],
                status: "unavailable",
              },
            }));
            expect(
              mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length
              - persistentProjectionCallsBefore,
            ).toBe(2);

            mocks.resolveAssistantCronDefaultTimeZoneProjection
              .mockImplementationOnce(async () => {
                const current = await showAutomation({
                  slug: "synthetic-readback-mismatch-reminder",
                  vaultRoot,
                });
                if (!current) {
                  throw new Error("Expected the readback mismatch fixture.");
                }
                await patchAutomation({
                  expectedUpdatedAt: current.updatedAt,
                  lookup: current.automationId,
                  schedule: {
                    kind: "dailyLocal",
                    localTime: "08:45",
                  },
                  vaultRoot,
                });
                return {
                  timeZone: "America/New_York",
                  vaultTimeZoneVerified: false,
                };
              })
              .mockResolvedValue({
                timeZone: "America/New_York",
                vaultTimeZoneVerified: true,
              });
            await expect(automationTool.request({
              action: "save",
              instructions: "Send the original synthetic mismatch reminder.",
              schedule: {
                kind: "dailyLocal",
                localTime: "08:30",
              },
              slug: "synthetic-readback-mismatch-reminder",
              title: "Synthetic readback mismatch reminder",
            })).resolves.toEqual(expect.objectContaining({
              occurrenceProjection: {
                issues: expect.arrayContaining(["record_readback_mismatch"]),
                status: "unavailable",
              },
            }));

            mocks.resolveAssistantCronDefaultTimeZoneProjection
              .mockImplementationOnce(async () => {
                const current = await showAutomation({
                  slug: "synthetic-projection-failure-reminder",
                  vaultRoot,
                });
                if (!current) {
                  throw new Error("Expected the projection failure fixture.");
                }
                await rm(path.join(vaultRoot, current.relativePath));
                return {
                  timeZone: "America/New_York",
                  vaultTimeZoneVerified: true,
                };
              });
            await expect(automationTool.request({
              action: "save",
              instructions: "Send the synthetic projection failure reminder.",
              schedule: {
                kind: "dailyLocal",
                localTime: "07:30",
              },
              slug: "synthetic-projection-failure-reminder",
              title: "Synthetic projection failure reminder",
            })).resolves.toEqual(expect.objectContaining({
              occurrenceProjection: {
                issues: expect.arrayContaining([
                  "projection_unavailable",
                  "record_readback_mismatch",
                ]),
                status: "unavailable",
              },
            }));

            const staleRecurring = await automationTool.request({
              action: "save",
              instructions: "Send the synthetic recurring reminder.",
              schedule: {
                everyMs: 86_400_000,
                kind: "every",
              },
              slug: "synthetic-stale-recurring-reminder",
              title: "Synthetic stale recurring reminder",
            });
            if (staleRecurring.action !== "save") {
              throw new Error("Expected the stale recurring save result.");
            }
            vi.setSystemTime(new Date("2026-08-15T02:01:00.000Z"));
            await expect(automationTool.request({
              action: "patch",
              expectedUpdatedAt: staleRecurring.updatedAt,
              instructions: "Send the revised synthetic recurring reminder.",
              lookup: "synthetic-stale-recurring-reminder",
            })).resolves.toEqual(expect.objectContaining({
              occurrenceProjection: {
                issues: ["stale_recurring_occurrence"],
                status: "unavailable",
              },
            }));
          },
          turnEnvironment: null,
        });
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: true,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      });

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [inputId],
        importedCount: 1,
        logRequests,
        vaultRoot,
      }));
      const verificationEntries = logRequests
        .flatMap((request) => request.entries)
        .filter((entry) =>
          entry.eventCode === "assistant.automation_detail"
          && entry.redactedJson?.schema
            === "murph.hosted-automation-timing-verification.v1"
        );
      expect(verificationEntries).toHaveLength(10);
      expect(verificationEntries[0]).toEqual(expect.objectContaining({
        errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED",
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationAction: "save",
          automationTimingVerificationIssues: ["default_timezone_unverified"],
          automationTimingVerificationRecovered: false,
          automationTimingVerificationStage: "initial",
          detailComponent: "automation.tool",
        }),
      }));
      expect(verificationEntries[1]).toEqual(expect.objectContaining({
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationAction: "save",
          automationTimingVerificationRecovered: true,
          automationTimingVerificationStage: "readback",
          detailComponent: "automation.tool",
        }),
      }));
      expect(verificationEntries[2]).toEqual(expect.objectContaining({
        errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED",
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationAction: "save",
          automationTimingVerificationRecovered: false,
          automationTimingVerificationStage: "initial",
        }),
      }));
      expect(verificationEntries[3]).toEqual(expect.objectContaining({
        errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED",
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationAction: "save",
          automationTimingVerificationRecovered: false,
          automationTimingVerificationStage: "readback",
        }),
      }));
      expect(verificationEntries[5]).toEqual(expect.objectContaining({
        errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED",
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationIssues: expect.arrayContaining([
            "record_readback_mismatch",
          ]),
          automationTimingVerificationRecovered: false,
          automationTimingVerificationStage: "readback",
        }),
      }));
      expect(verificationEntries[7]).toEqual(expect.objectContaining({
        errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED",
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationIssues: expect.arrayContaining([
            "projection_unavailable",
            "record_readback_mismatch",
          ]),
          automationTimingVerificationRecovered: false,
          automationTimingVerificationStage: "readback",
        }),
      }));
      expect(verificationEntries[8]).toEqual(expect.objectContaining({
        errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED",
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationAction: "patch",
          automationTimingVerificationIssues: ["stale_recurring_occurrence"],
          automationTimingVerificationRecovered: false,
          automationTimingVerificationStage: "initial",
        }),
      }));
      expect(verificationEntries[9]).toEqual(expect.objectContaining({
        errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED",
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationAction: "patch",
          automationTimingVerificationIssues: ["stale_recurring_occurrence"],
          automationTimingVerificationRecovered: false,
          automationTimingVerificationStage: "readback",
        }),
      }));
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic-private-verification-reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic private reminder payload",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "Synthetic private verification reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic-private-persistent-verification-reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "another synthetic private reminder payload",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "Synthetic private persistent verification reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic-readback-mismatch-reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "original synthetic mismatch reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "Synthetic readback mismatch reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain("08:45");
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic-projection-failure-reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic projection failure reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "Synthetic projection failure reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain("07:30");
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic-stale-recurring-reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "revised synthetic recurring reminder",
      );
      expect(() => logRequests.forEach(parseHostedRuntimeLogRequest)).not.toThrow();
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("reuses the production-scoped Linq speaker reader across ordinary warm turns", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "hosted-warm-speaker-cache-",
    ));
    try {
      const firstInputId = "ain_81818181818181818181818181818181";
      const secondInputId = "ain_82828282828282828282828282828282";
      const senderHandle = "+15558880001";
      const groupRequest = vi.fn(async (
        request: HostedRuntimeGroupToolRequest,
      ) => {
        if (request.action !== "read_participant_display_names") {
          throw new Error(`Unexpected group action: ${request.action}`);
        }
        return {
          action: "read_participant_display_names" as const,
          result: {
            participants: [{
              displayName: "Warm Speaker",
              displayNameSource: "profile-name" as const,
              senderHandle,
            }],
            status: "ok" as const,
          },
        };
      });
      mocks.readAssistantInputEvent.mockImplementation(async ({ inputId }) => ({
        conversation: {
          accountId: "linq_identity_warm_speaker",
          actorId: "linq_participant_warm_speaker",
          actorIsSelf: false,
          source: "linq",
          threadId: "linq_hidden_warm_speaker_thread",
          threadIsDirect: false,
        },
        replyTarget: {
          channel: "linq",
          messageId: inputId === firstInputId
            ? "linq_warm_speaker_message_one"
            : "linq_warm_speaker_message_two",
          threadId: "linq_warm_speaker_chat",
        },
        sourceMetadata: {
          externalThreadRouteAuthorityPresent: true,
          kind: "linq",
          partCount: 1,
          reactionEligible: true,
          replyToMessageId: null,
          senderHandle,
          service: "imessage",
        },
      }));

      const runOrdinaryTurn = async (inputId: string) => {
        await runHostedWorkspaceAssistantPhase(createPhaseInput({
          assistantInputIds: [inputId],
          conversationImportedCount: 1,
          importedCount: 1,
          runtimeGroupToolPort: { request: groupRequest },
          vaultRoot,
        }));
        const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
        const operationScope = laneInput?.operationScope as
          | AssistantAutomationOperationScope
          | undefined;
        if (!laneInput?.executionContext || !operationScope) {
          throw new Error("Expected hosted automation operation scope.");
        }
        return await operationScope.runAutoReplyGroup({
          executionContext: laneInput.executionContext,
          inputIds: [inputId],
          operation: async (executionContext) => {
            const reader =
              executionContext.hosted?.groupParticipantDisplayNameReader;
            if (!reader) {
              throw new Error("Expected the production-scoped speaker reader.");
            }
            return await reader.read({
              channel: "linq",
              senderHandles: [senderHandle],
            });
          },
          turnEnvironment: null,
        });
      };

      await expect(runOrdinaryTurn(firstInputId)).resolves.toEqual([{
        displayName: "Warm Speaker",
        displayNameSource: "profile-name",
        senderHandle,
      }]);
      await expect(runOrdinaryTurn(secondInputId)).resolves.toEqual([{
        displayName: "Warm Speaker",
        displayNameSource: "profile-name",
        senderHandle,
      }]);
      expect(groupRequest).toHaveBeenCalledTimes(1);
      expect(groupRequest).toHaveBeenCalledWith({
        action: "read_participant_display_names",
        linqSenderHandles: [senderHandle],
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("scopes the group port through the scheduled group tool factory", async () => {
    const groupRequest = vi.fn(async () => {
      throw new Error("The scheduled scope boundary test must not call the port.");
    });
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeGroupToolPort: { request: groupRequest },
    }));

    const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    const createScheduledGroupTools =
      laneInput?.executionContext.hosted?.createScheduledGroupTools;
    if (!createScheduledGroupTools) {
      throw new Error("Expected hosted scheduled group tools.");
    }

    expect(createScheduledGroupTools({
      channel: "linq",
      target: "chat_current_group",
      threadIsDirect: false,
    })?.groupTool).toEqual({ request: groupRequest });
    expect(createScheduledGroupTools({
      channel: "linq",
      target: "chat_direct",
      threadIsDirect: true,
    })).toBeNull();
    expect(createScheduledGroupTools({
      channel: "telegram",
      target: "chat_other",
      threadIsDirect: null,
    })).toBeNull();
    expect(groupRequest).not.toHaveBeenCalled();
  });

  it("preserves an automation route unless the accepted current conversation explicitly retargets it", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-automation-retarget-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const inputId = "ain_11111111111111111111111111111111";
    const availabilityBase = [
      "Send the existing reminder.",
      "Availability conflict policy: skip-when-busy",
      "Availability source policy: calendar-only",
      "Availability calendar account: googlecalendar / calendar-account",
    ].join("\n");
    const availabilityBlock = [
      "<!-- murph:availability-conflicts:start -->",
      "Availability conflict snapshot:",
      "- generatedAt: 2026-07-30T03:15:00.000Z",
      "- expiresAt: 2026-08-06T03:15:00.000Z",
      "- 2026-07-30T14:00:00.000Z / 2026-07-30T15:00:00.000Z",
      "<!-- murph:availability-conflicts:end -->",
    ].join("\n");
    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      await upsertAutomation({
        assistantTargetOverride: {
          model: "gpt-5.6-terra",
          reasoningEffort: "medium",
        },
        continuityPolicy: "preserve",
        instructions: `${availabilityBase}\n\n${availabilityBlock}`,
        route: {
          channel: "telegram",
          deliveryTarget: "telegram_existing_chat",
          identityId: null,
          participantId: null,
          threadId: "telegram_existing_chat",
          threadIsDirect: true,
        },
        schedule: { kind: "dailyLocal", localTime: "09:00" },
        slug: "existing-reminder",
        status: "active",
        title: "Existing reminder",
        vaultRoot,
      });
      mocks.readAssistantInputEvent.mockResolvedValue({
        conversation: {
          accountId: "linq_identity_current",
          actorId: "linq_participant_current",
          actorIsSelf: false,
          source: "linq",
          threadId: "linq_thread_current",
          threadIsDirect: true,
        },
        replyTarget: {
          channel: "linq",
          messageId: "linq_message_current",
          threadId: "linq_chat_current",
        },
      });

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [inputId],
        importedCount: 1,
        vaultRoot,
      }));
      const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
      const operationScope = laneInput?.operationScope as
        | AssistantAutomationOperationScope
        | undefined;
      if (!laneInput?.executionContext || !operationScope) {
        throw new Error("Expected hosted automation operation scope.");
      }

      const patchThroughScope = async (retargetToCurrentConversation: boolean) =>
        await operationScope.runAutoReplyGroup({
          executionContext: laneInput.executionContext,
          inputIds: [inputId],
          operation: async (executionContext) => {
            expect(executionContext.hosted?.groupSharedReader).toBeUndefined();
            const automationTool = executionContext.hosted?.automationTool;
            if (!automationTool) {
              throw new Error("Expected scoped hosted automation tool.");
            }
            const current = await showAutomation({
              slug: "existing-reminder",
              vaultRoot,
            });
            if (!current) {
              throw new Error("Expected existing reminder.");
            }
            return await automationTool.request({
              action: "patch",
              expectedUpdatedAt: current.updatedAt,
              lookup: "existing-reminder",
              retargetToCurrentConversation,
              title: retargetToCurrentConversation
                ? "Retargeted reminder"
                : "Preserved reminder",
            });
          },
          turnEnvironment: null,
        });

      await expect(patchThroughScope(false)).resolves.toEqual(expect.objectContaining({
        action: "patch",
        routeBinding: "preserved",
        status: "active",
      }));
      await expect(showAutomation({
        slug: "existing-reminder",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({
        assistantTargetOverride: {
          model: "gpt-5.6-terra",
          reasoningEffort: "medium",
        },
        route: expect.objectContaining({
          channel: "telegram",
          deliveryTarget: "telegram_existing_chat",
        }),
      }));

      await expect(patchThroughScope(true)).resolves.toEqual(expect.objectContaining({
        action: "patch",
        routeBinding: "current_conversation",
        status: "active",
      }));
      await expect(showAutomation({
        slug: "existing-reminder",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({
        route: expect.objectContaining({
          channel: "linq",
          deliveryTarget: "linq_chat_current",
          threadIsDirect: true,
        }),
      }));

      await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          const current = await showAutomation({
            slug: "existing-reminder",
            vaultRoot,
          });
          if (!current) {
            throw new Error("Expected existing reminder.");
          }
          return await automationTool.request({
            action: "patch",
            expectedUpdatedAt: current.updatedAt,
            lookup: "existing-reminder",
            schedule: { at: "2026-08-01T13:00:00.000Z", kind: "at" },
          });
        },
        turnEnvironment: null,
      });
      const exactReminder = await showAutomation({
        slug: "existing-reminder",
        vaultRoot,
      });
      expect(exactReminder).toEqual(expect.objectContaining({
        schedule: { at: "2026-08-01T13:00:00.000Z", kind: "at" },
      }));
      expect(exactReminder?.instructions).toBe([
        "Send the existing reminder.",
        "Availability conflict policy: fixed",
      ].join("\n"));

      await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          const current = await showAutomation({
            slug: "existing-reminder",
            vaultRoot,
          });
          if (!current) {
            throw new Error("Expected existing reminder.");
          }
          return await automationTool.request({
            action: "patch",
            expectedUpdatedAt: current.updatedAt,
            instructions: `${availabilityBase.replace(
              "Availability conflict policy: skip-when-busy",
              "Availability conflict policy: fixed",
            )}\n\n${availabilityBlock}`,
            lookup: "existing-reminder",
          });
        },
        turnEnvironment: null,
      });
      await expect(showAutomation({
        slug: "existing-reminder",
        vaultRoot,
      })).resolves.toMatchObject({
        instructions: [
          "Send the existing reminder.",
          "Availability conflict policy: fixed",
        ].join("\n"),
      });
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("creates the first personal read only on one private answered-completion transition", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-first-read-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const inputId = "ain_22222222222222222222222222222222";
    try {
      await initializeVault({
        createdAt: "2026-08-06T20:00:00.000Z",
        vaultRoot,
      });
      mocks.readAssistantInputEvent.mockResolvedValue({
        conversation: {
          accountId: "linq_identity_current",
          actorId: "linq_participant_current",
          actorIsSelf: false,
          source: "linq",
          threadId: "linq_thread_current",
          threadIsDirect: true,
        },
        replyTarget: {
          channel: "linq",
          messageId: "linq_message_current",
          threadId: "linq_chat_current",
        },
      });

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [inputId],
        importedCount: 1,
        vaultRoot,
      }));
      const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
      const operationScope = laneInput?.operationScope as
        | AssistantAutomationOperationScope
        | undefined;
      if (!laneInput?.executionContext || !operationScope) {
        throw new Error("Expected hosted automation operation scope.");
      }
      const firstReadRequest =
        buildOnboardingFirstPersonalReadAutomationSaveRequest({
          now: new Date("2026-08-06T21:00:00.000Z"),
        });
      const genericFixedIdentityRequests = [
        {
          action: "save" as const,
          automationId: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
          instructions: "Replace the fixed first-read policy.",
          schedule: {
            at: "2026-08-06T21:02:00.000Z",
            kind: "at" as const,
          },
          title: "Replacement by identifier",
        },
        {
          action: "save" as const,
          instructions: "Replace the fixed first-read policy.",
          schedule: {
            at: "2026-08-06T21:02:00.000Z",
            kind: "at" as const,
          },
          slug: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
          title: "Replacement by slug",
        },
      ];
      for (const request of genericFixedIdentityRequests) {
        await expect(operationScope.runAutoReplyGroup({
          executionContext: laneInput.executionContext,
          inputIds: [inputId],
          operation: async (executionContext) => {
            const automationTool = executionContext.hosted?.automationTool;
            if (!automationTool) {
              throw new Error("Expected scoped hosted automation tool.");
            }
            return await automationTool.request(request);
          },
          turnEnvironment: null,
        })).rejects.toThrow(
          "only once during its answered-completion transition",
        );
      }
      await expect(operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          return await automationTool.request(genericFixedIdentityRequests[0], {
            onboardingFirstReadCompletionTransition: true,
          });
        },
        turnEnvironment: null,
      })).rejects.toThrow(
        "only once during its answered-completion transition",
      );
      await expect(showAutomation({
        slug: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
        vaultRoot,
      })).resolves.toBeNull();

      const unrelated = await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          return await automationTool.request({
            action: "save",
            instructions: "Send the unrelated reminder.",
            schedule: {
              at: "2026-08-07T13:00:00.000Z",
              kind: "at",
            },
            title: "Unrelated reminder",
          });
        },
        turnEnvironment: null,
      });
      expect(unrelated).toEqual(expect.objectContaining({
        action: "save",
        created: true,
      }));
      await expect(operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          return await automationTool.request(firstReadRequest, {
            onboardingFirstReadCompletionTransition: true,
          });
        },
        turnEnvironment: null,
      })).rejects.toThrow(
        "only once during its answered-completion transition",
      );
      await completeAssistantOnboarding({
        completedAt: "2026-08-06T21:00:00.000Z",
        reason: "user_answered",
        vault: vaultRoot,
      });

      const saved = await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          await expect(automationTool.request(firstReadRequest)).rejects.toThrow(
            "only once during its answered-completion transition",
          );
          const result = await automationTool.request(firstReadRequest, {
            onboardingFirstReadCompletionTransition: true,
          });
          await expect(automationTool.request(firstReadRequest, {
            onboardingFirstReadCompletionTransition: true,
          })).rejects.toThrow(
            "only once during its answered-completion transition",
          );
          return result;
        },
        turnEnvironment: null,
      });
      expect(saved).toEqual(expect.objectContaining({
        action: "save",
        created: true,
        routeBinding: "current_conversation",
        status: "active",
      }));
      if (saved.action !== "save") {
        throw new Error("Expected first-read save result.");
      }
      await expect(showAutomation({
        slug: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({
        route: expect.objectContaining({
          channel: "linq",
          deliveryTarget: "linq_chat_current",
          threadIsDirect: true,
        }),
      }));

      await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          return await automationTool.request({
            action: "patch",
            expectedUpdatedAt: saved.updatedAt,
            lookup: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
            status: "archived",
          });
        },
        turnEnvironment: null,
      });
      await expect(operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          return await automationTool.request(firstReadRequest, {
            onboardingFirstReadCompletionTransition: true,
          });
        },
        turnEnvironment: null,
      })).rejects.toThrow(
        "only once during its answered-completion transition",
      );
      await expect(showAutomation({
        slug: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({ status: "archived" }));
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  });
