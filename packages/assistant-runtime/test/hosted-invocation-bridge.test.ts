import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionAssistantAskCompletedWake,
  buildHostedExecutionAssistantAskRequestedWake,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionAssistantAskCompletedWake,
  HostedExecutionAssistantAskRequestedWake,
  HostedExecutionSystemWake,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceInvocationRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  createAssistantOutboxIntent,
} from "@murphai/assistant-engine/assistant-outbox";
import {
  readAssistantInputEvent,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import {
  saveAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";
import {
  withCanonicalWriteLock,
} from "@murphai/core";
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from "@murphai/runtime-state/assistant-generated-deliveries";
import {
  readHostedWorkspaceSkippedInlineFiles,
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
  writeHostedWorkspaceSkippedInlineFiles,
} from "@murphai/runtime-state/node";

import {
  HostedRuntimeCheckpointInterruptedByWakeError,
  type HostedRuntimePlatform,
  type HostedWorkspaceRuntimeJobOptions,
} from "../src/hosted-runtime.ts";
import {
  HostedRuntimeBridgeCheckpointLeaseError,
  type HostedRuntimeBridgeCheckpointLease,
  type HostedRuntimeBridgeCheckpointLeaseErrorCode,
  type HostedRuntimeBridgeCheckpointLeaseStage,
} from "../src/hosted-runtime/checkpoint-bridge.ts";
import {
  createHostedWorkspaceRuntimeBridgeJobOptions,
  type HostedRuntimeBridgeReadCurrentLease,
  type HostedWorkspaceMailboxPayloadDecodeResult,
  type HostedWorkspaceMailboxPayloadDecoder,
  type HostedWorkspaceSnapshotArchiveBuilder,
} from "../src/hosted-runtime/snapshot-bridge.ts";
import {
  enqueueHostedPendingAssistantInputId,
} from "../src/hosted-runtime/pending-input-index.ts";

const TEST_REQUEST = {
  attemptId: "attempt_bridge",
  leaseGeneration: "4",
  providerEgressToken: "provider-egress-token-bridge",
  userId: "member_bridge",
  workspaceVersion: "7",
} satisfies HostedWorkspaceInvocationRequest;

const WRITE_OPERATION_SCHEMA_VERSION = "murph.write-operation.v1";

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanupPaths.splice(0).map(async (target) => {
    await rm(target, { force: true, recursive: true });
  }));
});

describe("createHostedWorkspaceRuntimeBridgeJobOptions", () => {
  it("fails closed when the mailbox decoder is missing", () => {
    const { platform } = createRuntimePlatform();

    expect(() => createHostedWorkspaceRuntimeBridgeJobOptions({
      platform,
      request: TEST_REQUEST,
      runtime: {},
      snapshotArchiveBuilder: createSnapshotArchiveBuilder(),
      vaultRoot: path.join(tmpdir(), "hosted-invocation-bridge-unused"),
      waitForBackgroundAssistantWork: async () => undefined,
    })).toThrow("Hosted mailbox payload decoder is required for this invocation.");
  });

  it("waits for assistant background work before snapshot publication", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    let releaseBackgroundWork!: () => void;
    const backgroundWorkFinished = new Promise<void>((resolve) => {
      releaseBackgroundWork = resolve;
    });
    const waitForBackgroundAssistantWork = vi.fn(
      async () => await backgroundWorkFinished,
    );
    const options = createBridgeOptions({
      platform,
      vaultRoot,
      waitForBackgroundAssistantWork,
    });

    const checkpoint = options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    );
    await vi.waitFor(() => {
      expect(waitForBackgroundAssistantWork).toHaveBeenCalledExactlyOnceWith(null);
    });
    expect(calls.startSnapshotSession).not.toHaveBeenCalled();

    releaseBackgroundWork();
    await expect(checkpoint).resolves.toMatchObject({
      snapshotRef: {
        snapshotId: "snapshot_bridge",
      },
    });
    expect(calls.startSnapshotSession).toHaveBeenCalledOnce();
  });

  it("forwards checkpoint interruption without opening a snapshot session", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const checkpointAbort = new AbortController();
    const interruption = new Error("checkpoint interrupted");
    const waitForBackgroundAssistantWork = vi.fn(
      async (signal: AbortSignal | null) => {
        expect(signal).toBe(checkpointAbort.signal);
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    );
    const options = createBridgeOptions({
      platform,
      vaultRoot,
      waitForBackgroundAssistantWork,
    });

    const checkpoint = options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: checkpointAbort.signal },
    );
    await vi.waitFor(() => {
      expect(waitForBackgroundAssistantWork).toHaveBeenCalledExactlyOnceWith(
        checkpointAbort.signal,
      );
    });

    checkpointAbort.abort(interruption);
    await expect(checkpoint).rejects.toBe(interruption);
    expect(calls.startSnapshotSession).not.toHaveBeenCalled();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
  });

  it("retains background work across checkpoint interruption before publishing the retry", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    let releaseBackgroundWork!: () => void;
    const retainedBackgroundWork = new Promise<void>((resolve) => {
      releaseBackgroundWork = resolve;
    });
    const waitForBackgroundAssistantWork = vi.fn(
      async (signal: AbortSignal | null) => {
        if (!signal) {
          await retainedBackgroundWork;
          return;
        }
        await Promise.race([
          retainedBackgroundWork,
          new Promise<void>((_resolve, reject) => {
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
        ]);
      },
    );
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
      waitForBackgroundAssistantWork,
    });
    const firstCheckpointAbort = new AbortController();
    const interruption = new Error("checkpoint interrupted");

    const firstCheckpoint = options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: firstCheckpointAbort.signal },
    );
    await vi.waitFor(() => {
      expect(waitForBackgroundAssistantWork).toHaveBeenCalledExactlyOnceWith(
        firstCheckpointAbort.signal,
      );
    });
    firstCheckpointAbort.abort(interruption);
    await expect(firstCheckpoint).rejects.toBe(interruption);

    const retryCheckpoint = options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    );
    await vi.waitFor(() => {
      expect(waitForBackgroundAssistantWork).toHaveBeenCalledTimes(2);
    });
    expect(waitForBackgroundAssistantWork).toHaveBeenLastCalledWith(null);
    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).not.toHaveBeenCalled();
    expect(calls.startSnapshotSession).not.toHaveBeenCalled();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();

    releaseBackgroundWork();
    await expect(retryCheckpoint).resolves.toMatchObject({
      snapshotRef: {
        snapshotId: "snapshot_bridge",
      },
    });
    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).toHaveBeenCalledOnce();
    expect(calls.startSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.putSnapshotObjectDirect).toHaveBeenCalledOnce();
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
  });

  it("rejects non-idle checkpoints before opening a snapshot session", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const options = createBridgeOptions({
      platform,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("import"),
    )).rejects.toThrow(
      "Hosted workspace snapshot construction is idle-shutdown only.",
    );
    await expect(options.createCheckpointSnapshot(
      // @ts-expect-error Intentionally verifies the JavaScript boundary fails closed.
      createCheckpointInput("canonical_runtime_commit"),
    )).rejects.toThrow(
      "Hosted workspace snapshot construction is idle-shutdown only.",
    );

    expect(calls.startSnapshotSession).not.toHaveBeenCalled();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();
  });

  const staleLeaseMutations = [
    {
      code: "stale_attempt",
      mutate: (lease: HostedRuntimeBridgeCheckpointLease) => ({
        ...lease,
        attemptId: "attempt_stale",
      }),
    },
    {
      code: "stale_lease_generation",
      mutate: (lease: HostedRuntimeBridgeCheckpointLease) => ({
        ...lease,
        leaseGeneration: "5",
      }),
    },
    {
      code: "stale_workspace_version",
      mutate: (lease: HostedRuntimeBridgeCheckpointLease) => ({
        ...lease,
        workspaceVersion: "8",
      }),
    },
    {
      code: "stale_user",
      mutate: (lease: HostedRuntimeBridgeCheckpointLease) => ({
        ...lease,
        userId: "member_stale",
      }),
    },
  ] satisfies readonly {
    code: HostedRuntimeBridgeCheckpointLeaseErrorCode;
    mutate(lease: HostedRuntimeBridgeCheckpointLease): HostedRuntimeBridgeCheckpointLease;
  }[];

  const staleLeaseStages = [
    {
      expectedAbortCount: 0,
      expectedCompleteCount: 0,
      expectedPutCount: 0,
      expectedStartCount: 0,
      staleReadIndex: 1,
      stage: "before_snapshot",
    },
    {
      expectedAbortCount: 1,
      expectedCompleteCount: 0,
      expectedPutCount: 0,
      expectedStartCount: 1,
      staleReadIndex: 2,
      stage: "before_direct_r2_put",
    },
    {
      expectedAbortCount: 1,
      expectedCompleteCount: 0,
      expectedPutCount: 1,
      expectedStartCount: 1,
      staleReadIndex: 3,
      stage: "before_web_checkpoint",
    },
  ] satisfies readonly {
    expectedAbortCount: number;
    expectedCompleteCount: number;
    expectedPutCount: number;
    expectedStartCount: number;
    staleReadIndex: number;
    stage: HostedRuntimeBridgeCheckpointLeaseStage;
  }[];

  for (const stageCase of staleLeaseStages) {
    for (const staleMutation of staleLeaseMutations) {
      it(`rejects ${staleMutation.code} at ${stageCase.stage}`, async () => {
        const vaultRoot = await createVaultRoot();
        const { calls, platform } = createRuntimePlatform();
        let readCount = 0;
        const currentLease = createLease();
        const readCurrentLease = vi.fn(async () => {
          readCount += 1;
          return readCount === stageCase.staleReadIndex
            ? staleMutation.mutate(currentLease)
            : currentLease;
        });
        const options = createBridgeOptions({
          platform,
          readCurrentLease,
          vaultRoot,
        });

        await expectLeaseFailure(
          options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")),
          {
            code: staleMutation.code,
            stage: stageCase.stage,
          },
        );

        expect(calls.startSnapshotSession).toHaveBeenCalledTimes(
          stageCase.expectedStartCount,
        );
        expect(calls.putSnapshotObjectDirect).toHaveBeenCalledTimes(
          stageCase.expectedPutCount,
        );
        expect(calls.completeSnapshotSession).toHaveBeenCalledTimes(
          stageCase.expectedCompleteCount,
        );
        expect(calls.abortSnapshotSession).toHaveBeenCalledTimes(
          stageCase.expectedAbortCount,
        );
      });
    }
  }

  it("aborts the snapshot session when archive construction fails before checkpoint", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async () => {
        throw new Error("Synthetic archive failure.");
      }),
    };
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    )).rejects.toThrow("Synthetic archive failure.");

    expect(calls.startSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
    expect(calls.abortSnapshotSession).toHaveBeenCalledOnce();
  });

  it("does not let snapshot-session abort cleanup block checkpoint interruption", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    calls.abortSnapshotSession.mockImplementationOnce(async () => {
      return await new Promise<never>(() => {});
    });
    const controller = new AbortController();
    const interruption = new HostedRuntimeCheckpointInterruptedByWakeError({
      message: "private checkpoint wake detail",
    });
    let resolveArchiveStarted: (() => void) | undefined;
    const archiveStarted = new Promise<void>((resolve) => {
      resolveArchiveStarted = resolve;
    });
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async (input) => {
        expect(input.signal).toBe(controller.signal);
        resolveArchiveStarted?.();
        const signal = input.signal;
        if (!signal) {
          throw new Error("Checkpoint signal was not propagated to archive construction.");
        }
        return await new Promise<never>((_resolve, reject) => {
          const rejectWithInterruption = () => {
            reject(signal.reason);
          };
          if (signal.aborted) {
            rejectWithInterruption();
            return;
          }
          signal.addEventListener("abort", rejectWithInterruption, {
            once: true,
          });
        });
      }),
    };
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    const snapshot = Promise.resolve(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    ));
    const snapshotOutcome = snapshot.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );
    await archiveStarted;
    controller.abort(interruption);
    let promptRejectionTimeout: ReturnType<typeof setTimeout> | undefined;
    const promptOutcome = await Promise.race([
      snapshotOutcome,
      new Promise<{ status: "timeout" }>((resolve) => {
        promptRejectionTimeout = setTimeout(() => {
          resolve({ status: "timeout" });
        }, 250);
      }),
    ]);
    if (promptRejectionTimeout) {
      clearTimeout(promptRejectionTimeout);
    }
    expect(promptOutcome.status).toBe("rejected");
    if (promptOutcome.status === "rejected") {
      expect(promptOutcome.error).toBe(interruption);
    }

    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).toHaveBeenCalledOnce();
    expect(calls.startSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
      expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_preempted"))
        .toBe(true);
    });
    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    const preemptionEntry = entries.find(
      (entry) => entry.eventCode === "checkpoint.snapshot_preempted",
    );
    expect(preemptionEntry).toMatchObject({
      errorCode: "runtime_wake_during_checkpoint",
      eventCode: "checkpoint.snapshot_preempted",
      level: "info",
      redactedJson: expect.objectContaining({
        errorCode: "runtime_wake_during_checkpoint",
        snapshotInterruptedBeforeCommit: true,
        snapshotOutcomeKind: "expected_preemption",
        snapshotPreemptionKind: "runtime_wake",
      }),
    });
    expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_failed"))
      .toBe(false);
    expect(JSON.stringify(preemptionEntry)).not.toContain(
      "private checkpoint wake detail",
    );
  });

  it("keeps a real archive failure actionable when a runtime wake races it", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const controller = new AbortController();
    const interruption = new HostedRuntimeCheckpointInterruptedByWakeError();
    const snapshotFailure = new Error("snapshot construction failed independently");
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async () => {
        controller.abort(interruption);
        throw snapshotFailure;
      }),
    };
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    )).rejects.toBe(interruption);

    await vi.waitFor(() => {
      const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
      expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_failed"))
        .toBe(true);
    });
    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
        level: "warn",
        redactedJson: expect.objectContaining({
          errorCode: "runtime_error",
          snapshotInterruptedBeforeCommit: true,
        }),
      }),
    ]));
    expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_preempted"))
      .toBe(false);
  });

  it("keeps a distinct runtime-wake error instance actionable", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const controller = new AbortController();
    const activeInterruption =
      new HostedRuntimeCheckpointInterruptedByWakeError();
    const distinctFailure = new HostedRuntimeCheckpointInterruptedByWakeError({
      message: "distinct checkpoint failure",
    });
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async () => {
        controller.abort(activeInterruption);
        throw distinctFailure;
      }),
    };
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    )).rejects.toBe(activeInterruption);

    await vi.waitFor(() => {
      const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
      expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_failed"))
        .toBe(true);
    });
    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
        level: "warn",
        redactedJson: expect.objectContaining({
          snapshotInterruptedBeforeCommit: true,
        }),
      }),
    ]));
    expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_preempted"))
      .toBe(false);
  });

  it("returns a runtime wake before a raced completion-failure log settles", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const controller = new AbortController();
    const interruption = new HostedRuntimeCheckpointInterruptedByWakeError();
    const completionFailure = new Error("snapshot completion transport failed");
    let releaseFailureLog!: () => void;
    const failureLogGate = new Promise<void>((resolve) => {
      releaseFailureLog = resolve;
    });
    let settledFailureLogWrites = 0;
    calls.logWrite.mockImplementation(async (request) => {
      if (request.entries.some((entry) =>
        entry.eventCode === "checkpoint.snapshot_failed"
      )) {
        await failureLogGate;
        settledFailureLogWrites += 1;
      }
      return { loggedCount: request.entries.length };
    });
    calls.completeSnapshotSession.mockImplementationOnce(async () => {
      controller.abort(interruption);
      throw completionFailure;
    });
    const options = createBridgeOptions({
      platform,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    )).rejects.toBe(interruption);
    expect(settledFailureLogWrites).toBe(0);

    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    const failureEntries = entries.filter((entry) =>
      entry.eventCode === "checkpoint.snapshot_failed"
    );
    expect(failureEntries).toEqual([
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
        level: "error",
        redactedJson: expect.objectContaining({
          errorCode: "runtime_error",
        }),
      }),
    ]);
    expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_preempted"))
      .toBe(false);
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();

    releaseFailureLog();
    await vi.waitFor(() => {
      expect(settledFailureLogWrites).toBe(1);
    });
  });

  it("propagates checkpoint interruption into runtime-owned symlink cleanup", async () => {
    const vaultRoot = await createVaultRoot();
    const workspaceRoot = path.dirname(path.dirname(vaultRoot));
    const runtimeRoot = path.join(
      workspaceRoot,
      "durable",
      "home",
      ".codex-hosted",
      "nested",
    );
    const symlinkTarget = path.join(workspaceRoot, "runtime-symlink-target.txt");
    const symlinkPaths = [
      path.join(runtimeRoot, "first-link"),
      path.join(runtimeRoot, "second-link"),
    ];
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(symlinkTarget, "runtime-owned symlink target\n", "utf8");
    await Promise.all(symlinkPaths.map(async (symlinkPath) => {
      await symlink(symlinkTarget, symlinkPath);
    }));

    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const controller = new AbortController();
    const interruption = new Error("Synthetic foreground cleanup interruption.");
    const nativeThrowIfAborted = controller.signal.throwIfAborted.bind(
      controller.signal,
    );
    let untouchedPathAtInterruption: string | null = null;
    Object.defineProperty(controller.signal, "throwIfAborted", {
      configurable: true,
      value() {
        const remainingPaths = symlinkPaths.filter((symlinkPath) =>
          existsSync(symlinkPath)
        );
        if (!controller.signal.aborted && remainingPaths.length === 1) {
          [untouchedPathAtInterruption] = remainingPaths;
          controller.abort(interruption);
        }
        nativeThrowIfAborted();
      },
    });
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    )).rejects.toBe(interruption);

    expect(symlinkPaths.filter((symlinkPath) => existsSync(symlinkPath)))
      .toEqual([untouchedPathAtInterruption]);
    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).not.toHaveBeenCalled();
    expect(calls.startSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
  });

  it("publishes legacy skipped-inline files atomically before surfacing a wake", async () => {
    const vaultRoot = await createVaultRoot();
    const workspaceRoot = path.dirname(path.dirname(vaultRoot));
    const sourceVaultRoot = path.join(workspaceRoot, "legacy-source");
    const firstRelativePath = "raw/legacy/first.txt";
    const secondRelativePath = "raw/legacy/second.txt";
    const firstBytes = Buffer.from("first legacy bytes\n", "utf8");
    const secondBytes = Buffer.from("second legacy bytes\n", "utf8");
    await mkdir(path.dirname(path.join(sourceVaultRoot, firstRelativePath)), {
      recursive: true,
    });
    await writeFile(path.join(sourceVaultRoot, firstRelativePath), firstBytes);
    await writeFile(path.join(sourceVaultRoot, secondRelativePath), secondBytes);
    const baseBundle = await snapshotHostedBundleRoots({
      kind: "vault",
      roots: [{
        root: sourceVaultRoot,
        rootKey: "vault",
      }],
    });
    expect(baseBundle).not.toBeNull();
    if (!baseBundle) {
      throw new Error("Expected a legacy hosted workspace bundle.");
    }
    const baseHash = sha256HostedBundleHex(baseBundle);
    const legacySnapshotRef = {
      hash: baseHash,
      key: `legacy/${baseHash}.bundle`,
      size: baseBundle.byteLength,
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const skippedInlineFiles = [
      {
        path: firstRelativePath,
        root: "vault",
        sha256: sha256HostedBundleHex(firstBytes),
        size: firstBytes.byteLength,
      },
      {
        path: secondRelativePath,
        root: "vault",
        sha256: sha256HostedBundleHex(secondBytes),
        size: secondBytes.byteLength,
      },
    ] as const;
    await writeHostedWorkspaceSkippedInlineFiles({
      files: skippedInlineFiles,
      vaultRoot,
    });
    const { calls, platform: basePlatform } = createRuntimePlatform();
    const legacyWorkspace = createCheckpointResponse({
      snapshotRef: legacySnapshotRef,
      userId: TEST_REQUEST.userId,
      version: TEST_REQUEST.workspaceVersion,
    }).workspace;
    const platform: HostedRuntimePlatform = {
      ...basePlatform,
      artifactStore: {
        get: async (sha256) => sha256 === baseHash ? baseBundle : null,
        put: async () => {},
      },
      workspacePort: {
        checkpoint: async () => ({
          checkpointed: true,
          workspace: legacyWorkspace,
        }),
        read: async () => ({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          workspace: legacyWorkspace,
        }),
      },
    };
    const controller = new AbortController();
    const interruption = new Error("Synthetic wake after legacy migration commit.");
    const baseArchiveBuilder = createSnapshotArchiveBuilder();
    let archiveAttempt = 0;
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async (input) => {
        archiveAttempt += 1;
        if (archiveAttempt === 1) {
          controller.abort(interruption);
          throw interruption;
        }
        return await baseArchiveBuilder.buildEncryptedSnapshot(input);
      }),
    };
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    )).rejects.toBe(interruption);

    expect(await readFile(path.join(vaultRoot, firstRelativePath), "utf8"))
      .toBe("first legacy bytes\n");
    expect(await readFile(path.join(vaultRoot, secondRelativePath), "utf8"))
      .toBe("second legacy bytes\n");
    expect(await readHostedWorkspaceSkippedInlineFiles({ vaultRoot })).toEqual([]);
    expect(await readdir(path.join(workspaceRoot, "scratch"))).toEqual([]);
    expect(calls.abortSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();

    await rm(path.join(vaultRoot, firstRelativePath));
    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    await expectMissing(path.join(vaultRoot, firstRelativePath));
    expect(await readFile(path.join(vaultRoot, secondRelativePath), "utf8"))
      .toBe("second legacy bytes\n");
    expect(await readHostedWorkspaceSkippedInlineFiles({ vaultRoot })).toEqual([]);
    expect(await readdir(path.join(workspaceRoot, "scratch"))).toEqual([]);
    expect(calls.startSnapshotSession).toHaveBeenCalledTimes(2);
    expect(calls.abortSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
  });

  it("redacts snapshot lifecycle safe error messages before writing runtime logs", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const rawPath = "/tmp/private-hosted-runtime/token";
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async () => {
        throw new Error(
          `HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON must be configured for ${rawPath}.`,
        );
      }),
    };
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      {
        ...createCheckpointInput("idle_shutdown"),
        handledConversationFrontierSelected: true,
      },
    )).rejects.toThrow("HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON");

    const failureEntry = calls.logWrite.mock.calls
      .flatMap(([request]) => request.entries)
      .find((entry) => entry.eventCode === "checkpoint.snapshot_failed");
    const redactedJson = failureEntry?.redactedJson ?? {};
    expect(redactedJson).toMatchObject({
      handledConversationFrontierSelected: true,
    });
    expect(redactedJson).not.toHaveProperty("webCheckpointAccepted");
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
    expect(JSON.stringify(redactedJson)).not.toContain(rawPath);
    expect(JSON.stringify(redactedJson)).toContain("<redacted-path>");
  });

  it("marks the local workspace clean for warm reuse after successful v2 checkpoint", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const options = createBridgeOptions({
      platform,
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    );

    expect(result.localWorkspaceCleanForWarmReuse).toBe(true);
    expect(calls.putSnapshotObjectDirect).toHaveBeenCalledOnce();
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();
  });

  it("excludes unreferenced Codex rollouts without deleting live local state", async () => {
    const vaultRoot = await createVaultRoot();
    const operatorHomeRoot = path.join(path.dirname(vaultRoot), "home");
    const rolloutRelativePath = path.join(
      ".codex-hosted",
      "sessions",
      "2026",
      "07",
      "13",
      "rollout-2026-07-13T20-00-00-00000000-0000-4000-8000-000000000542.jsonl",
    );
    const rolloutPath = path.join(operatorHomeRoot, rolloutRelativePath);
    await mkdir(path.dirname(rolloutPath), { recursive: true });
    await writeFile(
      rolloutPath,
      '{"membership":"private-membership-sentinel"}\n',
      "utf8",
    );
    const { platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    await expectPresent(rolloutPath);
    const archiveInput = vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot)
      .mock.calls[0]?.[0];
    expect(archiveInput?.archiveEntries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: rolloutRelativePath.split(path.sep).join(path.posix.sep),
        root: "operator-home",
      }),
    ]));
  });

  it("holds the canonical write lock through snapshot publication", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    let signalArchiveStarted: () => void = () => undefined;
    const archiveStarted = new Promise<void>((resolve) => {
      signalArchiveStarted = resolve;
    });
    let releaseArchive: () => void = () => undefined;
    const archiveBlocked = new Promise<void>((resolve) => {
      releaseArchive = resolve;
    });
    const baseArchiveBuilder = createSnapshotArchiveBuilder();
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async (input) => {
        signalArchiveStarted();
        await archiveBlocked;
        return await baseArchiveBuilder.buildEncryptedSnapshot(input);
      }),
    };
    let signalPublicationStarted: () => void = () => undefined;
    const publicationStarted = new Promise<void>((resolve) => {
      signalPublicationStarted = resolve;
    });
    let releasePublication: () => void = () => undefined;
    const publicationBlocked = new Promise<void>((resolve) => {
      releasePublication = resolve;
    });
    calls.completeSnapshotSession.mockImplementationOnce(async (input) => {
      signalPublicationStarted();
      await publicationBlocked;
      return {
        checkpoint: createCheckpointResponse({
          snapshotRef: input.ref,
          userId: TEST_REQUEST.userId,
          version: TEST_REQUEST.workspaceVersion,
        }),
        snapshotRef: input.ref,
      };
    });
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    const snapshot = options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    );
    await archiveStarted;

    let canonicalWriterEntered = false;
    const canonicalWrite = withCanonicalWriteLock(vaultRoot, async () => {
      canonicalWriterEntered = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(canonicalWriterEntered).toBe(false);

    releaseArchive();
    await publicationStarted;
    expect(canonicalWriterEntered).toBe(false);

    releasePublication();
    await snapshot;
    await canonicalWrite;
    expect(canonicalWriterEntered).toBe(true);
  });

  it("carries idle checkpoint trigger metadata through the production bridge snapshot path", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const options = createBridgeOptions({
      platform,
      vaultRoot,
    });

    await options.createCheckpointSnapshot({
      ...createCheckpointInput("idle_shutdown"),
      handledConversationFrontierSelected: true,
      handledConversationMailboxItemIds: ["item_terminal_7"],
      idleCheckpointTrigger: "shutdown_signal",
      runtimeWakePendingAtCheckpoint: false,
    });

    const checkpointRequest =
      calls.completeSnapshotSession.mock.calls[0]?.[0].checkpointRequest;
    expect(checkpointRequest?.handledConversationMailboxItemIds).toEqual([
      "item_terminal_7",
    ]);
    expect(checkpointRequest).not.toHaveProperty(
      "handledConversationFrontierSelected",
    );
    expect(checkpointRequest?.idleCheckpointTrigger).toBe("shutdown_signal");
    expect(checkpointRequest?.runtimeWakePendingAtCheckpoint).toBe(false);

    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(JSON.stringify(entries)).not.toContain("item_terminal_7");
    for (const eventCode of [
      "checkpoint.snapshot_plan",
      "checkpoint.snapshot_started",
      "checkpoint.snapshot_finished",
    ]) {
      const entry = entries.find((candidate) => candidate.eventCode === eventCode);
      expect(entry?.redactedJson).toMatchObject({
        handledConversationFrontierSelected: true,
        handledConversationMailboxItemCount: 1,
        idleCheckpointTrigger: "shutdown_signal",
        runtimeWakePendingAtCheckpoint: false,
      });
      if (eventCode === "checkpoint.snapshot_finished") {
        expect(entry?.redactedJson).toMatchObject({
          webCheckpointAccepted: true,
        });
      } else {
        expect(entry?.redactedJson).not.toHaveProperty("webCheckpointAccepted");
      }
    }
  });

  it("uses the current checkpoint expected workspace version for bridge snapshots", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const advancedLease = {
      ...createLease(),
      workspaceVersion: "8",
    };
    const options = createBridgeOptions({
      platform,
      readCurrentLease: async () => advancedLease,
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot({
      ...createCheckpointInput("idle_shutdown"),
      expectedWorkspaceVersion: "8",
    });

    expect(result.localWorkspaceCleanForWarmReuse).toBe(true);
    expect(calls.startSnapshotSession).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedWorkspaceVersion: "8",
      }),
    );
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();
  });

  it("prunes stale terminal write-operation records before v2 snapshot archive planning", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const staleOperationPaths = await writeManyStaleCommittedOperationRecords(vaultRoot);
    const activeOperationPath = await writeOperationRecord(vaultRoot, {
      operationId: "op_active_protected",
      status: "staged",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    const uncheckpointedCommittedOperationPath = await writeOperationRecord(vaultRoot, {
      operationId: "op_uncheckpointed_committed",
      status: "committed",
      updatedAt: "2026-06-10T00:00:00.000Z",
    });
    const uncheckpointedCommittedStageRoot =
      ".runtime/operations/op_uncheckpointed_committed";
    const uncheckpointedCommittedPayloadPath =
      `${uncheckpointedCommittedStageRoot}/payloads/residue.txt`;
    await mkdir(path.join(vaultRoot, uncheckpointedCommittedStageRoot, "payloads"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, uncheckpointedCommittedPayloadPath),
      "uncheckpointed residue\n",
      "utf8",
    );
    const request = createInvocationRequestWithWorkspaceCheckpoint("2026-06-10T00:00:00.000Z");
    const options = createBridgeOptions({
      platform,
      request,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const archiveEntries =
      vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mock.calls[0]?.[0]
        .archiveEntries ?? [];
    expect(archiveEntries.some((entry) => entry.relativePath === staleOperationPaths.oldest)).toBe(false);
    expect(archiveEntries.some((entry) => entry.relativePath === staleOperationPaths.newest)).toBe(true);
    expect(archiveEntries.some((entry) => entry.relativePath === activeOperationPath)).toBe(true);
    expect(archiveEntries.some((entry) => entry.relativePath === uncheckpointedCommittedOperationPath)).toBe(true);
    expect(archiveEntries.some((entry) => entry.relativePath === uncheckpointedCommittedPayloadPath)).toBe(true);
    await expectMissing(path.join(vaultRoot, staleOperationPaths.oldest));
    await expectPresent(path.join(vaultRoot, staleOperationPaths.newest));
    await expectPresent(path.join(vaultRoot, activeOperationPath));
    await expectPresent(path.join(vaultRoot, uncheckpointedCommittedOperationPath));
    await expectPresent(path.join(vaultRoot, uncheckpointedCommittedStageRoot));
  });

  it("prunes settled assistant runtime residue before v2 snapshot archive planning", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const residuePaths = await writeSettledAssistantInputResidue(vaultRoot);
    const options = createBridgeOptions({
      platform,
      request: createInvocationRequestWithWorkspaceCheckpoint("2026-06-10T00:00:00.000Z"),
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const archiveEntries =
      vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mock.calls[0]?.[0]
        .archiveEntries ?? [];
    expect(archiveEntries.some((entry) => entry.relativePath === residuePaths.inputEvent)).toBe(false);
    expect(archiveEntries.some((entry) => entry.relativePath === residuePaths.evidence)).toBe(false);
    await expectMissing(path.join(vaultRoot, residuePaths.inputEvent));
    await expectMissing(path.join(vaultRoot, residuePaths.evidence));
  });

  it("keeps disabled-channel nonterminal input residue in an idle snapshot", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const residuePaths = await writeDisabledPendingAssistantInputResidue(vaultRoot);
    const options = createBridgeOptions({
      platform,
      request: createInvocationRequestWithWorkspaceCheckpoint("2026-06-10T00:00:00.000Z"),
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const archiveEntries =
      vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mock.calls[0]?.[0]
        .archiveEntries ?? [];
    expect(archiveEntries.some((entry) => entry.relativePath === residuePaths.inputEvent)).toBe(true);
    expect(archiveEntries.some((entry) => entry.relativePath === residuePaths.pendingIndex)).toBe(true);
    await expectPresent(path.join(vaultRoot, residuePaths.inputEvent));
    await expectPresent(path.join(vaultRoot, residuePaths.pendingIndex));
    await expect(readAssistantInputEvent({
      inputId: residuePaths.inputId,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      replyTarget: {
        channel: "linq",
        threadId: "thread-disabled-residue",
      },
    });
  });

  it("prunes only quiescent runtime deliveries before archive planning", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const orphanRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/orphan.pdf`;
    const orphanContents = Buffer.from("unreferenced generated delivery\n");
    const activeRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/active.pdf`;
    const activeContents = Buffer.from("active generated delivery\n");
    const legacyRef = "exports/assistant-deliveries/base-era.pdf";
    const legacyContents = Buffer.from("ordinary pre-existing vault file\n");
    await mkdir(path.dirname(path.join(vaultRoot, orphanRef)), { recursive: true });
    await mkdir(path.dirname(path.join(vaultRoot, legacyRef)), { recursive: true });
    await writeFile(path.join(vaultRoot, orphanRef), orphanContents);
    await writeFile(path.join(vaultRoot, activeRef), activeContents);
    await writeFile(path.join(vaultRoot, legacyRef), legacyContents);
    await createAssistantOutboxIntent({
      channel: "linq",
      identityId: "identity-generated-delivery",
      media: [{
        approvalGeneration: null,
        approvalId: null,
        contentType: "application/pdf",
        filename: "active.pdf",
        kind: "vault_file",
        ref: activeRef,
        sha256: createHash("sha256").update(activeContents).digest("hex"),
        sizeBytes: activeContents.byteLength,
      }],
      message: "Generated delivery",
      sessionId: "session-generated-delivery",
      threadId: "thread-generated-delivery",
      threadIsDirect: true,
      turnId: "turn-generated-delivery",
      vault: vaultRoot,
    });
    const options = createBridgeOptions({
      platform,
      request: createInvocationRequestWithWorkspaceCheckpoint("2026-06-10T00:00:00.000Z"),
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const archiveEntries =
      vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mock.calls[0]?.[0]
        .archiveEntries ?? [];
    expect(archiveEntries.some((entry) => entry.relativePath === orphanRef)).toBe(false);
    expect(archiveEntries.some((entry) => entry.relativePath === activeRef)).toBe(true);
    expect(archiveEntries.some((entry) => entry.relativePath === legacyRef)).toBe(true);
    await expectMissing(path.join(vaultRoot, orphanRef));
    await expectPresent(path.join(vaultRoot, activeRef));
    await expectPresent(path.join(vaultRoot, legacyRef));

    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(entries.some((entry) =>
      entry.redactedJson?.prunedAssistantRuntimeGeneratedDeliveryFileCount === 1
      && entry.redactedJson?.prunedAssistantRuntimeGeneratedDeliveryBytes
        === orphanContents.byteLength
    )).toBe(true);
  });

  it("continues checkpoint publication when assistant runtime residue pruning fails", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const pendingInputsPath = path.join(
      vaultRoot,
      ".runtime",
      "operations",
      "assistant",
      "hosted-pending-inputs.json",
    );
    await mkdir(path.dirname(pendingInputsPath), { recursive: true });
    await writeFile(pendingInputsPath, "{ not-json", "utf8");
    const options = createBridgeOptions({
      platform,
      request: createInvocationRequestWithWorkspaceCheckpoint("2026-06-10T00:00:00.000Z"),
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).toHaveBeenCalledOnce();
    expect(calls.putSnapshotObjectDirect).toHaveBeenCalledOnce();
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();
  });

  it("continues checkpoint publication when terminal write-operation pruning fails", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const staleOperationPaths = await writeManyStaleCommittedOperationRecords(vaultRoot);
    const operationDirectory = path.join(vaultRoot, ".runtime", "operations");
    const request = createInvocationRequestWithWorkspaceCheckpoint("2026-06-10T00:00:00.000Z");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const options = createBridgeOptions({
      platform,
      request,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await chmod(operationDirectory, 0o500);
    try {
      await expect(options.createCheckpointSnapshot(
        createCheckpointInput("idle_shutdown"),
      )).resolves.toMatchObject({
        localWorkspaceCleanForWarmReuse: true,
      });
    } finally {
      await chmod(operationDirectory, 0o700);
    }

    const archiveEntries =
      vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mock.calls[0]?.[0]
        .archiveEntries ?? [];
    expect(archiveEntries.some((entry) => entry.relativePath === staleOperationPaths.oldest)).toBe(true);
    await expectPresent(path.join(vaultRoot, staleOperationPaths.oldest));
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.some(([payload]) =>
      typeof payload === "string" &&
      payload.includes("Hosted workspace terminal write-operation cleanup failed.")
    )).toBe(true);
  });

  it("keeps mailbox decode mismatches blocked and route mismatches deferred", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const options = createBridgeOptions({
      mailboxPayloadDecoder: createMailboxPayloadDecoder({
        status: "decoded",
        wake: createMemberChannelsWake({
          userId: "member_other",
        }),
      }),
      platform,
      vaultRoot,
    });

    await expect(options.importItem(createSystemMailboxImportItem())).resolves.toEqual({
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    });
    await expect(options.importItem(createSystemMailboxImportItem({
      routeAction: "import-conversation-message",
    }))).resolves.toEqual({
      reasonCode: "cloudflare_bridge.unhandled_mailbox_route",
      status: "deferred",
    });
  });

  it.each([
    ["vault-share.delivery", "import-vault-share-delivery"],
    ["vault-share.revoke", "import-vault-share-revoke"],
  ] as const)(
    "consumes retired %s rows without decoding or recreating local shared data",
    async (kind, routeAction) => {
      const vaultRoot = await createVaultRoot();
      const { platform } = createRuntimePlatform();
      const mailboxPayloadDecoder: HostedWorkspaceMailboxPayloadDecoder = {
        decode: vi.fn(async () => {
          throw new Error("Retired vault-share payloads must not be decoded.");
        }),
      };
      const options = createBridgeOptions({
        mailboxPayloadDecoder,
        platform,
        vaultRoot,
      });

      await expect(options.importItem(
        createRetiredVaultShareMailboxImportItem({ kind, routeAction }),
      )).resolves.toEqual({
        reasonCode: "vault_share.retired_direct_snapshot",
        status: "skipped",
      });
      expect(mailboxPayloadDecoder.decode).not.toHaveBeenCalled();
      await expect(access(path.join(vaultRoot, "derived", "vault-share")))
        .rejects.toThrow();
      await expect(access(path.join(vaultRoot, "vault-share")))
        .rejects.toThrow();
    },
  );

  it("consumes retired newsletter rows without decoding or importing them", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const mailboxPayloadDecoder: HostedWorkspaceMailboxPayloadDecoder = {
      decode: vi.fn(async () => {
        throw new Error("Retired newsletter payloads must not be decoded.");
      }),
    };
    const options = createBridgeOptions({
      mailboxPayloadDecoder,
      platform,
      vaultRoot,
    });

    await expect(options.importItem(
      createRetiredNewsletterMailboxImportItem(),
    )).resolves.toEqual({
      reasonCode: "legacy_group_newsletter_email_needed.retired",
      status: "skipped",
    });
    expect(mailboxPayloadDecoder.decode).not.toHaveBeenCalled();
  });

  it("binds paired Assistant Ask payloads to the mailbox row id and expiry", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const wakes = [
      createAssistantAskRequestedWake(),
      createAssistantAskCompletedWake(),
    ];

    for (const wake of wakes) {
      const options = createBridgeOptions({
        mailboxPayloadDecoder: createMailboxPayloadDecoder({
          status: "decoded",
          wake,
        }),
        platform,
        vaultRoot,
      });

      await expect(options.importItem(createAssistantAskMailboxImportItem(wake, {
        id: `${wake.eventId}_different_row`,
      }))).resolves.toEqual({
        reasonCode: "payload.decode_mismatch",
        retryable: false,
        status: "blocked",
      });
      await expect(options.importItem(createAssistantAskMailboxImportItem(wake, {
        expiresAt: "2026-07-15T12:11:00.000Z",
      }))).resolves.toEqual({
        reasonCode: "payload.decode_mismatch",
        retryable: false,
        status: "blocked",
      });

      const matchingResult = await options.importItem(
        createAssistantAskMailboxImportItem(wake),
      );
      expect(matchingResult).not.toMatchObject({
        reasonCode: "payload.decode_mismatch",
      });
    }
  });

  it("admits only joined-group asks on the dirty-window fast path", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const consentedWake = createConsentedMemberAssistantAskRequestedWake();
    const consentedOptions = createBridgeOptions({
      mailboxPayloadDecoder: createMailboxPayloadDecoder({
        status: "decoded",
        wake: consentedWake,
      }),
      platform,
      vaultRoot,
    });

    await expect(consentedOptions.importItem(
      createAssistantAskMailboxImportItem(consentedWake),
      { assistantAskRequestTargetKind: "joined_group" },
    )).resolves.toEqual({
      reasonCode: "assistant_ask.target_not_admitted",
      status: "deferred",
    });

    const joinedWake = createAssistantAskRequestedWake();
    const joinedOptions = createBridgeOptions({
      mailboxPayloadDecoder: createMailboxPayloadDecoder({
        status: "decoded",
        wake: joinedWake,
      }),
      platform,
      vaultRoot,
    });
    await expect(joinedOptions.importItem(
      createAssistantAskMailboxImportItem(joinedWake),
      { assistantAskRequestTargetKind: "joined_group" },
    )).resolves.toMatchObject({ status: "imported" });
  });

  it("admits every accepted-input completion on the dirty-window fast path", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const reviewedWake = buildHostedExecutionAssistantAskCompletedWake({
      ask: {
        expiresAt: "2026-07-15T12:10:00.000Z",
        origin: {
          assistantInputId: "ain_0123456789abcdef0123456789abcdef",
          kind: "accepted_input",
          sessionId: "session_group",
        },
        question: "What exercises are assigned today?",
        requestId: "haask_consented_request_bridge",
        result: {
          answer: "Three sets of squats.",
          outcome: "answered",
        },
        targetLabel: null,
      },
      eventId: "haask_reviewed_completion_bridge",
      memberId: TEST_REQUEST.userId,
      occurredAt: "2026-07-15T12:05:00.000Z",
    });
    const reviewedOptions = createBridgeOptions({
      mailboxPayloadDecoder: createMailboxPayloadDecoder({
        status: "decoded",
        wake: reviewedWake,
      }),
      platform,
      vaultRoot,
    });

    await expect(reviewedOptions.importItem(
      createAssistantAskMailboxImportItem(reviewedWake),
    )).resolves.toMatchObject({ status: "imported" });

    const joinedWake = createAssistantAskCompletedWake();
    const joinedOptions = createBridgeOptions({
      mailboxPayloadDecoder: createMailboxPayloadDecoder({
        status: "decoded",
        wake: joinedWake,
      }),
      platform,
      vaultRoot,
    });
    await expect(joinedOptions.importItem(
      createAssistantAskMailboxImportItem(joinedWake),
    )).resolves.toMatchObject({ status: "imported" });
  });
});

function createBridgeOptions(input: {
  mailboxPayloadDecoder?: HostedWorkspaceMailboxPayloadDecoder;
  platform: HostedRuntimePlatform;
  readCurrentLease?: HostedRuntimeBridgeReadCurrentLease;
  request?: HostedWorkspaceInvocationRequest;
  snapshotArchiveBuilder?: HostedWorkspaceSnapshotArchiveBuilder;
  vaultRoot: string;
  waitForBackgroundAssistantWork?: (signal: AbortSignal | null) => Promise<void>;
}): HostedWorkspaceRuntimeJobOptions {
  const request = input.request ?? TEST_REQUEST;
  return createHostedWorkspaceRuntimeBridgeJobOptions({
    decodeMailboxPayload: input.mailboxPayloadDecoder ?? createMailboxPayloadDecoder({
      status: "decoded",
      wake: createMemberChannelsWake(),
    }),
    platform: input.platform,
    readCurrentLease: input.readCurrentLease ?? (() => createLease(request)),
    request,
    runtime: {},
    snapshotArchiveBuilder: input.snapshotArchiveBuilder ?? createSnapshotArchiveBuilder(),
    snapshotDiagnosticsHashSecret: "f".repeat(64),
    vaultRoot: input.vaultRoot,
    waitForBackgroundAssistantWork:
      input.waitForBackgroundAssistantWork ?? (async () => undefined),
  });
}

function createInvocationRequestWithWorkspaceCheckpoint(
  checkpointedAt: string,
): HostedWorkspaceInvocationRequest {
  return {
    ...TEST_REQUEST,
    workspace: {
      checkpointedAt,
      createdAt: "2026-05-01T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: checkpointedAt,
      userId: TEST_REQUEST.userId,
      version: TEST_REQUEST.workspaceVersion,
    },
  };
}

async function createVaultRoot(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-invocation-bridge-"));
  cleanupPaths.push(workspaceRoot);
  const vaultRoot = path.join(workspaceRoot, "durable", "vault");
  await mkdir(path.join(workspaceRoot, "durable", "home"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "scratch"), { recursive: true });
  await mkdir(vaultRoot, { recursive: true });
  await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
  return vaultRoot;
}

async function writeManyStaleCommittedOperationRecords(
  vaultRoot: string,
): Promise<{ newest: string; oldest: string }> {
  let newest = "";
  let oldest = "";
  for (let index = 0; index < 101; index += 1) {
    const relativePath = await writeOperationRecord(vaultRoot, {
      operationId: `op_stale_terminal_${String(index).padStart(3, "0")}`,
      status: "committed",
      updatedAt: new Date(Date.UTC(2026, 5, 1, 0, index, 0)).toISOString(),
    });
    if (index === 0) {
      oldest = relativePath;
    }
    newest = relativePath;
  }
  return { newest, oldest };
}

async function writeOperationRecord(
  vaultRoot: string,
  input: {
    operationId: string;
    status: "committed" | "rolled_back" | "staged";
    updatedAt: string;
  },
): Promise<string> {
  const operationDirectory = path.join(vaultRoot, ".runtime", "operations");
  await mkdir(operationDirectory, { recursive: true });
  const relativePath = `.runtime/operations/${input.operationId}.json`;
  await writeFile(
    path.join(vaultRoot, relativePath),
    `${JSON.stringify({
      actions: [],
      createdAt: input.updatedAt,
      occurredAt: input.updatedAt,
      operationId: input.operationId,
      operationType: "test_operation",
      schemaVersion: WRITE_OPERATION_SCHEMA_VERSION,
      status: input.status,
      summary: "test operation",
      updatedAt: input.updatedAt,
    }, null, 2)}\n`,
    "utf8",
  );
  return relativePath;
}

async function writeSettledAssistantInputResidue(
  vaultRoot: string,
): Promise<{ evidence: string; inputEvent: string }> {
  const recordedAt = "2026-01-01T00:00:00.000Z";
  const event = await upsertAssistantInputEvent({
    now: new Date(recordedAt),
    vault: vaultRoot,
    event: {
      content: {
        text: "old hosted input",
      },
      conversation: {
        accountId: null,
        actorId: "actor-residue",
        actorIsSelf: false,
        source: "email",
        threadId: "thread-residue",
        threadIsDirect: true,
      },
      occurredAt: recordedAt,
      receivedAt: recordedAt,
      replyTarget: {
        channel: "email",
        messageId: "message-residue",
        threadId: "thread-residue",
      },
      sourceRef: {
        dedupeKey: "dedupe-residue",
        eventId: "event-residue",
        itemId: "item-residue",
        kind: "hosted-mailbox",
        lane: "conversation",
        laneSeq: "1",
        payloadSchema: "test-payload",
        payloadSource: "inline",
        source: "hosted-mailbox",
        wakeSchema: "test-wake",
      },
    },
  });
  const inputEvent = `.runtime/operations/assistant/input-events/${event.inputId}.json`;
  const evidence = `.runtime/operations/assistant/auto-reply/evidence/${encodeURIComponent(event.inputId)}.json`;
  await mkdir(path.dirname(path.join(vaultRoot, evidence)), { recursive: true });
  await writeFile(
    path.join(vaultRoot, evidence),
    `${JSON.stringify({
      captureId: event.inputId,
      groupCaptureIds: [event.inputId],
      groupId: `group_${event.inputId}`,
      groupInputIds: [event.inputId],
      inputId: event.inputId,
      primaryCaptureId: event.inputId,
      primaryInputId: event.inputId,
      providerCleanup: {
        linqMessageIds: [],
        queuedAt: null,
      },
      recordedAt,
      schema: "murph.assistant-auto-reply-terminal-evidence.v1",
      terminal: {
        kind: "suppressed",
        reason: "already-handled",
      },
    })}\n`,
    "utf8",
  );
  return { evidence, inputEvent };
}

async function writeDisabledPendingAssistantInputResidue(
  vaultRoot: string,
): Promise<{ inputEvent: string; inputId: string; pendingIndex: string }> {
  const recordedAt = "2026-01-01T00:00:00.000Z";
  await saveAssistantAutomationState(vaultRoot, {
    autoReply: [{
      channel: "linq",
      eligibleAfter: null,
      enabledAt: recordedAt,
    }],
    updatedAt: recordedAt,
    version: 1,
  });
  const event = await upsertAssistantInputEvent({
    now: new Date(recordedAt),
    vault: vaultRoot,
    event: {
      content: {
        text: "old disabled-channel hosted input",
      },
      conversation: {
        accountId: null,
        actorId: "actor-disabled-residue",
        actorIsSelf: false,
        source: "linq",
        threadId: "thread-disabled-residue",
        threadIsDirect: true,
      },
      occurredAt: recordedAt,
      receivedAt: recordedAt,
      replyTarget: {
        channel: "linq",
        messageId: "message-disabled-residue",
        threadId: "thread-disabled-residue",
      },
      sourceRef: {
        dedupeKey: "dedupe-disabled-residue",
        eventId: "event-disabled-residue",
        itemId: "item-disabled-residue",
        kind: "hosted-mailbox",
        lane: "conversation",
        laneSeq: "2",
        payloadSchema: "test-payload",
        payloadSource: "inline",
        source: "hosted-mailbox",
        wakeSchema: "test-wake",
      },
    },
  });
  await enqueueHostedPendingAssistantInputId({
    inputId: event.inputId,
    vaultRoot,
  });
  await saveAssistantAutomationState(vaultRoot, {
    autoReply: [],
    updatedAt: "2026-01-01T00:01:00.000Z",
    version: 1,
  });

  return {
    inputEvent: `.runtime/operations/assistant/input-events/${event.inputId}.json`,
    inputId: event.inputId,
    pendingIndex: ".runtime/operations/assistant/hosted-pending-inputs.json",
  };
}

async function expectPresent(absolutePath: string): Promise<void> {
  await access(absolutePath);
}

async function expectMissing(absolutePath: string): Promise<void> {
  await expect(access(absolutePath)).rejects.toMatchObject({
    code: "ENOENT",
  });
}

function createLease(
  request: HostedWorkspaceInvocationRequest = TEST_REQUEST,
): HostedRuntimeBridgeCheckpointLease {
  return {
    attemptId: request.attemptId,
    leaseGeneration: request.leaseGeneration,
    providerEgressToken: request.providerEgressToken ?? null,
    userId: request.userId,
    workspaceVersion: request.workspaceVersion,
  };
}

function createCheckpointInput<const Reason extends HostedWorkspaceCheckpointRequest["reason"]>(
  reason: Reason,
) {
  const state = {
    recentStatuses: [],
    watermarks: {
      conversation: "0",
      system: "0",
    },
  };

  return {
    importResult: {
      blocked: [],
      consumedSeqByLane: {
        conversation: null,
        system: null,
      },
      fetchedCount: 0,
      importedCount: 0,
      state,
    },
    previousState: state,
    reason,
    redactedStatus: {},
    state,
  };
}

function createSnapshotArchiveBuilder(): HostedWorkspaceSnapshotArchiveBuilder {
  return {
    buildEncryptedSnapshot: vi.fn(async (input) => {
      const temporaryDirectoryPath = await mkdtemp(path.join(input.outputDir, "snapshot-"));
      const encryptedFilePath = path.join(temporaryDirectoryPath, "snapshot.enc");
      await writeFile(encryptedFilePath, "encrypted snapshot", "utf8");
      return {
        compression: HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
        encryptedByteSize: 18,
        encryptedFilePath,
        encryptedObjectSha256: "a".repeat(64),
        fileCount: input.archiveEntries.length,
        plaintextArchiveSha256: "b".repeat(64),
        temporaryDirectoryPath,
        totalPlainBytes: 9,
      };
    }),
  };
}

type WorkspaceSnapshotPort = NonNullable<HostedRuntimePlatform["workspaceSnapshotPort"]>;
type RuntimeLogPort = NonNullable<HostedRuntimePlatform["logPort"]>;

function createRuntimePlatform(): {
  calls: {
    abortSnapshotSession: ReturnType<typeof vi.fn<WorkspaceSnapshotPort["abortSnapshotSession"]>>;
    completeSnapshotSession: ReturnType<typeof vi.fn<WorkspaceSnapshotPort["completeSnapshotSession"]>>;
    logWrite: ReturnType<typeof vi.fn<RuntimeLogPort["write"]>>;
    putSnapshotObjectDirect: ReturnType<typeof vi.fn<WorkspaceSnapshotPort["putSnapshotObjectDirect"]>>;
    startSnapshotSession: ReturnType<typeof vi.fn<WorkspaceSnapshotPort["startSnapshotSession"]>>;
  };
  platform: HostedRuntimePlatform;
} {
  const objectKey = "users/member_bridge/workspace-snapshots/snapshot_bridge.snapshot.enc";
  const snapshotId = "snapshot_bridge";
  const startSnapshotSession = vi.fn(async (
    _input: Parameters<WorkspaceSnapshotPort["startSnapshotSession"]>[0],
  ) => ({
    encryption: {
      aad: buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId: TEST_REQUEST.userId,
      }),
      dataKeyBase64: "data-key-base64",
      ivBase64: "iv-base64",
      rootKeyId: "root_key_bridge",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped-data-key",
    },
    limits: {
      maxSinglePartEncryptedBytes: 1024,
      warnEncryptedBytes: 512,
    },
    objectKey,
    snapshotId,
  }));
  const putSnapshotObjectDirect = vi.fn(async (
    _input: Parameters<WorkspaceSnapshotPort["putSnapshotObjectDirect"]>[0],
  ) => ({
    snapshotDirectR2PresignElapsedMs: 1,
    snapshotDirectR2PutElapsedMs: 2,
  }));
  const completeSnapshotSession = vi.fn(async (
    input: Parameters<WorkspaceSnapshotPort["completeSnapshotSession"]>[0],
  ) => ({
    checkpoint: createCheckpointResponse({
      snapshotRef: input.ref,
      userId: TEST_REQUEST.userId,
      version: TEST_REQUEST.workspaceVersion,
    }),
    snapshotRef: input.ref,
  }));
  const abortSnapshotSession = vi.fn(async (
    _input: Parameters<WorkspaceSnapshotPort["abortSnapshotSession"]>[0],
  ) => {});
  const logWrite = vi.fn(async (
    input: Parameters<RuntimeLogPort["write"]>[0],
  ) => ({
    loggedCount: input.entries.length,
  }));

  return {
    calls: {
      abortSnapshotSession,
      completeSnapshotSession,
      logWrite,
      putSnapshotObjectDirect,
      startSnapshotSession,
    },
    platform: {
      artifactStore: {
        get: async () => null,
        put: async () => {},
      },
      effectsPort: {
        readRawEmailMessage: async () => null,
        sendEmail: async () => {},
      },
      logPort: {
        write: logWrite,
      },
      workspaceSnapshotPort: {
        abortSnapshotSession,
        completeSnapshotSession,
        putSnapshotObjectDirect,
        restoreWorkspaceSnapshot: async () => {},
        startSnapshotSession,
      },
    },
  };
}

function createMailboxPayloadDecoder(
  result: HostedWorkspaceMailboxPayloadDecodeResult,
): HostedWorkspaceMailboxPayloadDecoder {
  return {
    decode: vi.fn(async () => result),
  };
}

function createMemberChannelsWake(input: {
  eventId?: string;
  occurredAt?: string;
  userId?: string;
} = {}): HostedExecutionSystemWake {
  return {
    eventId: input.eventId ?? "event_bridge",
    kind: "member.channels.updated",
    memberChannels: {
      email: true,
      linq: false,
      telegram: false,
    },
    occurredAt: input.occurredAt ?? "2026-05-01T00:00:00.000Z",
    userId: input.userId ?? TEST_REQUEST.userId,
  };
}

function createAssistantAskRequestedWake(): HostedExecutionAssistantAskRequestedWake {
  return buildHostedExecutionAssistantAskRequestedWake({
    ask: {
      expiresAt: "2026-07-15T12:10:00.000Z",
      originAssistantInputId: "ain_0123456789abcdef0123456789abcdef",
      originSessionId: "session_private",
      question: "What exercises are assigned today?",
      target: {
        kind: "joined_group",
        membershipId: "hgrpm_generation_bridge",
        requestedLabel: "100 Club",
      },
    },
    eventId: "haask_request_bridge",
    memberId: TEST_REQUEST.userId,
    occurredAt: "2026-07-15T12:00:00.000Z",
  });
}

function createConsentedMemberAssistantAskRequestedWake():
HostedExecutionAssistantAskRequestedWake {
  return buildHostedExecutionAssistantAskRequestedWake({
    ask: {
      expiresAt: "2026-07-15T12:10:00.000Z",
      origin: {
        assistantInputId: "ain_0123456789abcdef0123456789abcdef",
        kind: "accepted_input",
        sessionId: "session_private",
      },
      question: "What exercises are assigned today?",
      target: {
        grantId: "grant_bridge",
        kind: "consented_member",
        membershipId: "hgrpm_generation_bridge",
        permissionDigest: "d".repeat(64),
      },
    },
    eventId: "haask_consented_request_bridge",
    memberId: TEST_REQUEST.userId,
    occurredAt: "2026-07-15T12:00:00.000Z",
  });
}

function createAssistantAskCompletedWake(): HostedExecutionAssistantAskCompletedWake {
  return buildHostedExecutionAssistantAskCompletedWake({
    ask: {
      expiresAt: "2026-07-15T12:10:00.000Z",
      originAssistantInputId: "ain_0123456789abcdef0123456789abcdef",
      originSessionId: "session_private",
      question: "What exercises are assigned today?",
      requestId: "haask_request_bridge",
      result: {
        answer: "Squats plus the pelvic sequence.",
        outcome: "answered",
      },
      targetLabel: "100 Club",
    },
    eventId: "haask_completion_bridge",
    memberId: TEST_REQUEST.userId,
    occurredAt: "2026-07-15T12:05:00.000Z",
  });
}

function createAssistantAskMailboxImportItem(
  wake: HostedExecutionAssistantAskRequestedWake | HostedExecutionAssistantAskCompletedWake,
  overrides: {
    expiresAt?: string;
    id?: string;
  } = {},
): Parameters<HostedWorkspaceRuntimeJobOptions["importItem"]>[0] {
  const routeAction = wake.kind === "assistant.ask.requested"
    ? "run-assistant-ask"
    : "continue-assistant-ask";
  const base = createSystemMailboxImportItem();
  return {
    ...base,
    item: {
      ...base.item,
      dedupeKey: wake.eventId,
      expiresAt: overrides.expiresAt ?? wake.ask.expiresAt,
      id: overrides.id ?? wake.eventId,
      kind: wake.kind,
      occurredAt: wake.occurredAt,
      userId: wake.userId,
    },
    route: {
      action: routeAction,
      advanceProgress: true,
      itemRef: {
        id: overrides.id ?? wake.eventId,
        kind: wake.kind,
        lane: "system",
        laneSeq: base.item.laneSeq,
      },
      state: "route",
    },
  };
}

function createSystemMailboxImportItem(input: {
  routeAction?: "apply-member-channels-update" | "import-conversation-message";
} = {}): Parameters<HostedWorkspaceRuntimeJobOptions["importItem"]>[0] {
  const routeAction = input.routeAction ?? "apply-member-channels-update";
  return {
    item: {
      createdAt: "2026-05-01T00:00:00.000Z",
      dedupeKey: "event_bridge",
      expiresAt: null,
      id: "mailbox_item_bridge",
      kind: "member.channels.updated",
      lane: "system",
      laneSeq: "1",
      occurredAt: "2026-05-01T00:00:00.000Z",
      payloadBytes: 32,
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_bridge",
      payloadSchema: "murph.hosted-mailbox-item-payload.v1",
      updatedAt: "2026-05-01T00:00:00.000Z",
      userId: TEST_REQUEST.userId,
    },
    payload: {
      payloadCiphertext: "opaque-mailbox-payload",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      requestId: "request_bridge_mailbox",
      source: "sidecar",
      status: "resolved",
    },
    route: {
      action: routeAction,
      advanceProgress: true,
      itemRef: {
        id: "mailbox_item_bridge",
        kind: "member.channels.updated",
        lane: "system",
        laneSeq: "1",
      },
      state: "route",
    },
  };
}

function createRetiredVaultShareMailboxImportItem(input: {
  kind: "vault-share.delivery" | "vault-share.revoke";
  routeAction: "import-vault-share-delivery" | "import-vault-share-revoke";
}): Parameters<HostedWorkspaceRuntimeJobOptions["importItem"]>[0] {
  const base = createSystemMailboxImportItem();
  const id = `retired_${input.kind.replaceAll(".", "_")}`;
  return {
    ...base,
    item: {
      ...base.item,
      dedupeKey: id,
      id,
      kind: input.kind,
    },
    route: {
      action: input.routeAction,
      advanceProgress: true,
      itemRef: {
        id,
        kind: input.kind,
        lane: "system",
        laneSeq: base.item.laneSeq,
      },
      state: "route",
    },
  };
}

function createRetiredNewsletterMailboxImportItem(): Parameters<
  HostedWorkspaceRuntimeJobOptions["importItem"]
>[0] {
  const base = createSystemMailboxImportItem();
  const id = "retired_group_newsletter_email_needed";
  return {
    ...base,
    item: {
      ...base.item,
      dedupeKey: id,
      id,
      kind: "group-newsletter.email-needed",
    },
    route: {
      action: "skip-retired-mailbox-item",
      advanceProgress: true,
      itemRef: {
        id,
        kind: "group-newsletter.email-needed",
        lane: "system",
        laneSeq: base.item.laneSeq,
      },
      state: "route",
    },
  };
}

function createCheckpointResponse(input: {
  snapshotRef: HostedWorkspaceCheckpointRequest["snapshotRef"];
  userId: string;
  version: string;
}): HostedWorkspaceCheckpointResponse {
  return {
    checkpointed: true,
    workspace: {
      checkpointedAt: "2026-05-01T00:00:01.000Z",
      createdAt: "2026-05-01T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: input.snapshotRef,
      updatedAt: "2026-05-01T00:00:01.000Z",
      userId: input.userId,
      version: input.version,
    },
  };
}

async function expectLeaseFailure(
  operation: unknown,
  expected: {
    code: HostedRuntimeBridgeCheckpointLeaseErrorCode;
    stage: HostedRuntimeBridgeCheckpointLeaseStage;
  },
): Promise<void> {
  let thrown: unknown;
  try {
    await operation;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(HostedRuntimeBridgeCheckpointLeaseError);
  if (!(thrown instanceof HostedRuntimeBridgeCheckpointLeaseError)) {
    throw new Error("Expected hosted runtime bridge checkpoint lease failure.");
  }
  expect(thrown.code).toBe(expected.code);
  expect(thrown.stage).toBe(expected.stage);
}
