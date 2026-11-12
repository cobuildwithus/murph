import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import type { HostedRuntimeLogRequest } from "@murphai/hosted-execution/runtime-control";
import {
  createPhaseInput,
  mocks,
  runHostedWorkspaceAssistantPhase,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";
import {
  loadHostedDeviceSyncMaintenanceModule,
} from "../src/hosted-runtime/device-sync-maintenance-import.ts";

const deviceSync = {
  providerConfigs: {},
  publicBaseUrl: "https://device-sync.example.test",
  secret: "synthetic-device-sync-secret",
};

function foregroundRow(requests: HostedRuntimeLogRequest[]) {
  return requests.flatMap((request) => request.entries)
    .find((entry) => entry.redactedJson?.turnTimingStage === "foreground-delivery-phase-started")
    ?.redactedJson;
}

afterEach(() => vi.restoreAllMocks());

describe("pre-foreground planning timing", () => {
  it("attributes delayed owners without repeating, reordering or changing wake planning", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const calls: string[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const lane = mocks.runHostedAssistantAutomationLane.getMockImplementation()!;
    mocks.runHostedAssistantAutomationLane.mockImplementation(async (...args) => {
      calls.push("automation");
      return lane(...args);
    });
    const nextWakeAt = "2026-11-03T00:00:00.000Z";
    mocks.resolveHostedDeviceSyncNextWakeAt.mockImplementation(() => {
      calls.push("device");
      clock += 7;
      return nextWakeAt;
    });
    const mailbox = mocks.resolveHostedSystemMailboxNextWakeCandidate.getMockImplementation()!;
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
      // The projection with no route/kind filter is the post-automation owner.
      if (Object.keys(input).length === 1) {
        calls.push("mailbox");
        clock += 11;
      }
      return mailbox(input);
    });
    const cleanup = mocks.prepareHostedProviderCleanupPlan.getMockImplementation()!;
    mocks.prepareHostedProviderCleanupPlan.mockImplementation(async (input) => {
      calls.push("cleanup");
      clock += 13;
      return cleanup(input);
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      logRequests,
      now: () => "2026-11-02T00:00:00.000Z",
      resolvedDeviceSync: deviceSync,
    }));

    expect(calls).toEqual(["automation", "device", "mailbox", "cleanup"]);
    // A queued reply never waits on the deferred maintenance module (provider
    // registry and SDK); the wake read comes from the light projection module.
    expect(loadHostedDeviceSyncMaintenanceModule).not.toHaveBeenCalled();
    expect(foregroundRow(logRequests)).toMatchObject({
      turnTimingPreForegroundMs: 31,
      turnTimingPreForegroundPreludeMs: 0,
      turnTimingDeviceWakeProjectionMs: 7,
      turnTimingSystemMailboxWakeProjectionMs: 11,
      turnTimingProviderCleanupPlanningMs: 13,
    });
    const addedFields = Object.fromEntries(Object.entries(foregroundRow(logRequests) ?? {})
      .filter(([key]) => [
        "turnTimingPreForegroundMs", "turnTimingPreForegroundPreludeMs",
        "turnTimingDeviceWakeProjectionMs",
        "turnTimingSystemMailboxWakeProjectionMs", "turnTimingProviderCleanupPlanningMs",
      ].includes(key)));
    expect(foregroundRow(logRequests.map(parseHostedRuntimeLogRequest)))
      .toMatchObject(addedFields);
    expect(Object.keys(addedFields)).toHaveLength(5);
    expect(Buffer.byteLength(JSON.stringify(addedFields))).toBeLessThan(400);
    expect(mocks.prepareHostedProviderCleanupPlan).toHaveBeenCalledOnce();
    expect(mocks.prepareHostedProviderCleanupPlan).toHaveBeenCalledWith(
      expect.objectContaining({ deferred: true }),
    );
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toMatchObject({ nextWakeAt, nextWakeReason: "device-sync.reconcile" });
    const stages = logRequests.flatMap((request) => request.entries)
      .map((entry) => entry.redactedJson?.turnTimingStage).filter(Boolean);
    expect(stages).toEqual([
      "automation-pass-finished", "foreground-delivery-phase-started", "foreground-delivery-phase-finished",
    ]);
  });

  it("retains an executed no-op projection when device sync is unconfigured", async () => {
    vi.spyOn(performance, "now").mockReturnValue(50);
    const logRequests: HostedRuntimeLogRequest[] = [];
    await runHostedWorkspaceAssistantPhase(createPhaseInput({ importedCount: 1, logRequests }));
    expect(mocks.resolveHostedDeviceSyncNextWakeAt).not.toHaveBeenCalled();
    expect(foregroundRow(logRequests)).toMatchObject({
      turnTimingPreForegroundMs: 0,
      turnTimingDeviceWakeProjectionMs: 0,
    });
  });

  it("preserves a projection error without fabricating foreground completion", async () => {
    const failure = new Error("Synthetic wake projection failure");
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
      if (Object.keys(input).length === 1) throw failure;
      return { at: null, reason: null };
    });
    const logRequests: HostedRuntimeLogRequest[] = [];
    await expect(runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1, logRequests,
    }))).rejects.toBe(failure);
    expect(foregroundRow(logRequests)).toBeUndefined();
    expect(mocks.prepareHostedProviderCleanupPlan).not.toHaveBeenCalled();
  });
});
