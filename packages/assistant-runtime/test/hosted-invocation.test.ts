import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runHostedWorkspaceRuntimeJobInProcess: vi.fn(),
}));

vi.mock("../src/hosted-runtime.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/hosted-runtime.ts")>(
    "../src/hosted-runtime.ts",
  );
  return {
    ...actual,
    runHostedWorkspaceRuntimeJobInProcess:
      mocks.runHostedWorkspaceRuntimeJobInProcess,
  };
});

import type {
  HostedExecutionSystemWake,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import {
  createHostedWorkspaceInvocationLease,
  runHostedWorkspaceInvocation,
  type HostedWorkspaceMailboxPayloadDecoder,
  type HostedWorkspaceSnapshotArchiveBuilder,
} from "../src/hosted-invocation.ts";
import type {
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedRuntimePlatform,
  HostedWorkspaceRuntimeJobOptions,
  RuntimeWakeSignal,
} from "../src/hosted-runtime.ts";

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, { force: true, recursive: true });
    }),
  );
});

describe("runHostedWorkspaceInvocation", () => {
  it("wires package bridge options into the in-process runtime", async () => {
    const durableRoot = await mkdtemp(path.join(tmpdir(), "hosted-invocation-"));
    cleanupPaths.push(durableRoot);
    const vaultRoot = path.join(durableRoot, "durable", "vault");
    await mkdir(vaultRoot, { recursive: true });
    const result = {
      nextWakeAt: null,
      redactedStatus: null,
      status: "idle" as const,
    };
    const capturedRuntimeCalls: Array<{
      job: HostedAssistantWorkspaceRuntimeJobInput;
      options: HostedWorkspaceRuntimeJobOptions;
    }> = [];
    mocks.runHostedWorkspaceRuntimeJobInProcess.mockImplementation(
      async (
        job: HostedAssistantWorkspaceRuntimeJobInput,
        options: HostedWorkspaceRuntimeJobOptions,
      ) => {
        capturedRuntimeCalls.push({ job, options });
        return result;
      },
    );
    const job = createWorkspaceJob();
    const runtimeWakeSignal = createTestRuntimeWakeSignal();
    const abortController = new AbortController();
    const decodeMailboxPayload = createMailboxPayloadDecoder();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const platform = createRuntimePlatform();

    await expect(runHostedWorkspaceInvocation({
      job,
      mailboxPayloadDecoder: decodeMailboxPayload,
      platform,
      readCurrentLease: () => ({
        attemptId: job.request.attemptId,
        leaseGeneration: job.request.leaseGeneration,
        userId: job.request.userId,
        workspaceVersion: job.request.workspaceVersion,
      }),
      runtimeWakeSignal,
      signal: abortController.signal,
      snapshotArchiveBuilder,
      snapshotDiagnosticsHashSecret: "f".repeat(64),
      vaultRoot,
    })).resolves.toBe(result);

    expect(capturedRuntimeCalls).toHaveLength(1);
    const captured = capturedRuntimeCalls[0];
    expect(captured?.job).toBe(job);
    expect(captured?.options.platform).toBe(platform);
    expect(captured?.options.runtimeWakeSignal).toBe(runtimeWakeSignal);
    expect(captured?.options.signal).toBe(abortController.signal);
    expect(captured?.options.vaultRoot).toBe(vaultRoot);

    await expect(captured?.options.importItem(
      createMailboxImportItem(),
    )).resolves.toEqual({
      reasonCode: "system_mailbox.queued",
      status: "imported",
    });
    expect(decodeMailboxPayload.decode).toHaveBeenCalledWith(expect.objectContaining({
      payloadCiphertext: "opaque-mailbox-payload",
      payloadRequestId: "request_invocation_mailbox",
      payloadSource: "sidecar",
    }));

    const checkpointResult = await captured?.options.createCheckpointSnapshot({
      reason: "idle_shutdown",
    });
    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        dataKey: "data-key-base64",
        durableRoot: path.join(durableRoot, "durable"),
        ivBase64: "iv-base64",
        maxEncryptedBytes: 1024,
        outputDir: path.join(durableRoot, "scratch"),
      }),
    );
    expect(runtimeWakeSignal.consumePending).toHaveBeenCalled();
    expect(checkpointResult?.checkpoint?.workspace.version).toBe("8");
    expect(checkpointResult?.snapshotRef).toEqual(expect.objectContaining({
      snapshotId: "snapshot_invocation",
      userId: job.request.userId,
    }));
  });

  it("fails before runtime launch when the current lease reader is missing", async () => {
    mocks.runHostedWorkspaceRuntimeJobInProcess.mockClear();
    const durableRoot = await mkdtemp(path.join(tmpdir(), "hosted-invocation-"));
    cleanupPaths.push(durableRoot);
    const vaultRoot = path.join(durableRoot, "durable", "vault");
    await mkdir(vaultRoot, { recursive: true });
    const job = createWorkspaceJob();
    const input = {
      job,
      mailboxPayloadDecoder: createMailboxPayloadDecoder(),
      platform: createRuntimePlatform(),
      runtimeWakeSignal: createTestRuntimeWakeSignal(),
      snapshotArchiveBuilder: createSnapshotArchiveBuilder(),
      vaultRoot,
    };

    // @ts-expect-error Intentionally verifies the JavaScript boundary fails closed.
    await expect(runHostedWorkspaceInvocation(input)).rejects.toThrow(
      "runHostedWorkspaceInvocation requires readCurrentLease.",
    );
    expect(mocks.runHostedWorkspaceRuntimeJobInProcess).not.toHaveBeenCalled();
  });

  it("fails before runtime launch when the runtime wake signal is missing", async () => {
    mocks.runHostedWorkspaceRuntimeJobInProcess.mockClear();
    const durableRoot = await mkdtemp(path.join(tmpdir(), "hosted-invocation-"));
    cleanupPaths.push(durableRoot);
    const vaultRoot = path.join(durableRoot, "durable", "vault");
    await mkdir(vaultRoot, { recursive: true });
    const job = createWorkspaceJob();

    await expect(runHostedWorkspaceInvocation({
      job,
      mailboxPayloadDecoder: createMailboxPayloadDecoder(),
      platform: createRuntimePlatform(),
      readCurrentLease: () => ({
        attemptId: job.request.attemptId,
        leaseGeneration: job.request.leaseGeneration,
        userId: job.request.userId,
        workspaceVersion: job.request.workspaceVersion,
      }),
      // @ts-expect-error Intentionally verifies the JavaScript boundary fails closed.
      runtimeWakeSignal: null,
      snapshotArchiveBuilder: createSnapshotArchiveBuilder(),
      vaultRoot,
    })).rejects.toThrow("runHostedWorkspaceInvocation requires runtimeWakeSignal.");
    expect(mocks.runHostedWorkspaceRuntimeJobInProcess).not.toHaveBeenCalled();
  });

  it("creates a lease from the workspace invocation request", () => {
    const job = createWorkspaceJob();

    expect(createHostedWorkspaceInvocationLease(job)).toEqual({
      attemptId: job.request.attemptId,
      leaseGeneration: job.request.leaseGeneration,
      userId: job.request.userId,
      workspaceVersion: job.request.workspaceVersion,
    });
  });
});

function createWorkspaceJob(): HostedAssistantWorkspaceRuntimeJobInput {
  return {
    request: {
      attemptId: "attempt_invocation",
      leaseGeneration: "3",
      reason: "nudge",
      userId: "member_invocation",
      workspaceVersion: "7",
    },
    runtime: {},
  };
}

function createTestRuntimeWakeSignal(): RuntimeWakeSignal {
  return {
    consumePending: vi.fn(() => false),
    notify: vi.fn(),
    wait: vi.fn(async () => {}),
  };
}

function createMailboxPayloadDecoder(): HostedWorkspaceMailboxPayloadDecoder {
  const wake: HostedExecutionSystemWake = {
    eventId: "event_invocation_mailbox",
    kind: "member.channels.updated",
    memberChannels: {
      email: true,
      linq: false,
      telegram: false,
    },
    occurredAt: "2026-05-01T00:00:00.000Z",
    userId: "member_invocation",
  };
  return {
    decode: vi.fn(async () => ({
      status: "decoded" as const,
      wake,
    })),
  };
}

function createSnapshotArchiveBuilder(): HostedWorkspaceSnapshotArchiveBuilder {
  return {
    buildEncryptedSnapshot: vi.fn(async () => {
      const temporaryDirectoryPath = await mkdtemp(path.join(tmpdir(), "hosted-invocation-snapshot-"));
      cleanupPaths.push(temporaryDirectoryPath);
      return {
        compression: HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
        encryptedByteSize: 12,
        encryptedFilePath: "/tmp/hosted-invocation.snapshot.enc",
        encryptedObjectSha256: "a".repeat(64),
        fileCount: 1,
        plaintextArchiveSha256: "b".repeat(64),
        temporaryDirectoryPath,
        totalPlainBytes: 6,
      };
    }),
  };
}

function createRuntimePlatform(): HostedRuntimePlatform {
  const objectKey = "users/hsn_invocation/workspace-snapshots/snapshot_invocation.snapshot.enc";
  const snapshotId = "snapshot_invocation";
  const userId = "member_invocation";
  return {
    artifactStore: {
      get: async () => null,
      put: async () => {},
    },
    effectsPort: {
      readRawEmailMessage: async () => null,
      sendEmail: async () => {},
    },
    workspaceSnapshotPort: {
      abortSnapshotSession: async () => {},
      completeSnapshotSession: async ({ ref }) => ({
        checkpoint: createCheckpointResponse({
          snapshotRef: ref,
          userId,
          version: "8",
        }),
        snapshotRef: ref,
      }),
      putSnapshotObjectDirect: async () => ({
        snapshotDirectR2PresignElapsedMs: 1,
        snapshotDirectR2PutElapsedMs: 2,
      }),
      restoreWorkspaceSnapshot: async () => {},
      startSnapshotSession: async () => ({
        encryption: {
          aad: buildHostedWorkspaceSnapshotV2Aad({
            objectKey,
            snapshotId,
            userId,
          }),
          dataKeyBase64: "data-key-base64",
          ivBase64: "iv-base64",
          rootKeyId: "root_key_invocation",
          scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
          wrappedDataKey: "wrapped-data-key",
        },
        limits: {
          maxSinglePartEncryptedBytes: 1024,
          warnEncryptedBytes: 512,
        },
        objectKey,
        snapshotId,
      }),
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

function createMailboxImportItem(): Parameters<HostedWorkspaceRuntimeJobOptions["importItem"]>[0] {
  return {
    item: {
      createdAt: "2026-05-01T00:00:00.000Z",
      dedupeKey: "event_invocation_mailbox",
      expiresAt: null,
      id: "mailbox_item_invocation",
      kind: "member.channels.updated",
      lane: "system",
      laneSeq: "1",
      occurredAt: "2026-05-01T00:00:00.000Z",
      payloadBytes: 32,
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_invocation",
      payloadSchema: "murph.hosted-mailbox-item-payload.v1",
      updatedAt: "2026-05-01T00:00:00.000Z",
      userId: "member_invocation",
    },
    payload: {
      payloadCiphertext: "opaque-mailbox-payload",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      requestId: "request_invocation_mailbox",
      source: "sidecar",
      status: "resolved",
    },
    route: {
      action: "apply-member-channels-update",
      advanceProgress: true,
      itemRef: {
        id: "mailbox_item_invocation",
        kind: "member.channels.updated",
        lane: "system",
        laneSeq: "1",
      },
      state: "route",
    },
  };
}
