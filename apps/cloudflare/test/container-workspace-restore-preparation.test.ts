import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createArtifactStore: vi.fn(),
  createInternalFetch: vi.fn(),
  createLogPort: vi.fn(),
  createSnapshotPort: vi.fn(),
  createTrustedInternalFetch: vi.fn(),
  createWorkspacePort: vi.fn(),
  prepareVaultRoot: vi.fn(),
  readCommitTimeoutMs: vi.fn(),
  resolveTransport: vi.fn(),
  startPreparation: vi.fn(),
}));

vi.mock("@murphai/assistant-runtime/hosted-workspace-restore-preparation", () => ({
  startHostedWorkspaceRestorePreparation: mocks.startPreparation,
}));

vi.mock("@murphai/assistant-runtime/hosted-runtime-worker-contracts", () => ({
  readHostedRunnerCommitTimeoutMs: mocks.readCommitTimeoutMs,
}));

vi.mock("../src/hosted-runner-warm-workspace.js", () => ({
  prepareHostedRunnerWarmWorkspaceVaultRoot: mocks.prepareVaultRoot,
}));

vi.mock("../src/runtime-platform/artifact-store.js", () => ({
  createCloudflareArtifactStore: mocks.createArtifactStore,
}));

vi.mock("../src/runtime-platform/log-port.js", () => ({
  createHostedWebRuntimeLogPort: mocks.createLogPort,
}));

vi.mock("../src/runtime-platform/provider-fetch.js", () => ({
  createCloudflareHostedInternalFetch: mocks.createInternalFetch,
  createCloudflareHostedTrustedInternalFetch: mocks.createTrustedInternalFetch,
}));

vi.mock("../src/runtime-platform/web-control-transport.js", () => ({
  resolveHostedWebControlTransport: mocks.resolveTransport,
}));

vi.mock("../src/runtime-platform/workspace-port.js", () => ({
  createHostedWebWorkspacePort: mocks.createWorkspacePort,
}));

vi.mock("../src/runtime-platform/workspace-snapshot-port.js", () => ({
  createCloudflareWorkspaceSnapshotPort: mocks.createSnapshotPort,
}));

import type {
  HostedWorkspaceRestorePreparation,
} from "@murphai/assistant-runtime/hosted-workspace-restore-preparation";
import {
  prepareHostedContainerWorkspaceRestore,
} from "../src/container-workspace-restore-preparation.js";
import type {
  HostedExecutionWorkspaceInvocationJobInput,
} from "../src/runner-job-transport.js";

function createPreparation(vaultRoot: string): HostedWorkspaceRestorePreparation {
  return {
    adoptRuntimeAbortGuard: vi.fn(),
    phaseLogger: {
      close: vi.fn(),
      emit: vi.fn(),
      failOpenPhases: vi.fn(() => []),
    },
    promise: new Promise<never>(() => undefined),
    runtimePhaseStartedAt: "2026-08-27T15:00:00.000Z",
    vaultRoot,
  };
}

function createJob(): HostedExecutionWorkspaceInvocationJobInput {
  return {
    kind: "workspace-invocation",
    preparedSnapshotRestore: {
      dataKey: "snapshot-data-key",
      getUrl: "https://snapshot.example.test/prepared",
      snapshotFingerprint: "a".repeat(64),
    },
    request: {
      attemptId: "attempt_restore_preparation",
      leaseGeneration: "7",
      providerEgressToken: "provider-egress-token",
      userId: "member_restore_preparation",
      workspaceVersion: "12",
    },
    runtime: {
      commitTimeoutMs: 4_321,
    },
  };
}

describe("container workspace restore preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepareVaultRoot.mockResolvedValue(
      "/tmp/murph-restore-preparation/durable/vault",
    );
    mocks.readCommitTimeoutMs.mockReturnValue(4_321);
    mocks.resolveTransport.mockReturnValue({ mode: "proxy" });
    mocks.createInternalFetch.mockReturnValue(fetch);
    mocks.createTrustedInternalFetch.mockReturnValue(fetch);
    mocks.createArtifactStore.mockReturnValue({ get: vi.fn(), put: vi.fn() });
    mocks.createLogPort.mockReturnValue({ write: vi.fn() });
    mocks.createWorkspacePort.mockReturnValue({ checkpoint: vi.fn(), read: vi.fn() });
    mocks.createSnapshotPort.mockReturnValue({ restoreWorkspaceSnapshot: vi.fn() });
  });

  it("starts the authoritative package preparation with one fenced restore platform", async () => {
    const job = createJob();
    const signal = new AbortController().signal;
    const preparation = createPreparation(
      "/tmp/murph-restore-preparation/durable/vault",
    );
    mocks.startPreparation.mockReturnValue(preparation);

    await expect(prepareHostedContainerWorkspaceRestore({
      job,
      signal,
    })).resolves.toBe(preparation);

    expect(mocks.prepareVaultRoot).toHaveBeenCalledOnce();
    expect(mocks.prepareVaultRoot).toHaveBeenCalledWith(job.request.userId);
    expect(mocks.readCommitTimeoutMs).toHaveBeenCalledWith(4_321);
    expect(mocks.startPreparation).toHaveBeenCalledOnce();
    expect(mocks.startPreparation).toHaveBeenCalledWith({
      job,
      platform: {
        artifactStore: mocks.createArtifactStore.mock.results[0]?.value,
        logPort: mocks.createLogPort.mock.results[0]?.value,
        workspacePort: mocks.createWorkspacePort.mock.results[0]?.value,
        workspaceSnapshotPort: mocks.createSnapshotPort.mock.results[0]?.value,
      },
      signal,
      vaultRoot: preparation.vaultRoot,
    });

    const workspacePortInput = mocks.createWorkspacePort.mock.calls[0]?.[0];
    expect(
      workspacePortInput.workspaceCheckpointBridge.readCurrentLease(),
    ).toEqual({
      attemptId: job.request.attemptId,
      leaseGeneration: job.request.leaseGeneration,
      providerEgressToken: job.request.providerEgressToken,
      userId: job.request.userId,
      workspaceVersion: job.request.workspaceVersion,
    });
    expect(mocks.createSnapshotPort).toHaveBeenCalledWith(expect.objectContaining({
      preparedSnapshotRestore: job.preparedSnapshotRestore,
      workspaceCheckpointBridge: workspacePortInput.workspaceCheckpointBridge,
    }));
  });
});
