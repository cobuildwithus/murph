import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
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
  type HostedRuntimePlatform,
  type RuntimeWakeNotification,
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

const TEST_REQUEST = {
  attemptId: "attempt_bridge",
  leaseGeneration: "4",
  providerEgressToken: "provider-egress-token-bridge",
  userId: "member_bridge",
  workspaceVersion: "7",
} satisfies HostedWorkspaceInvocationRequest;

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
    })).toThrow("Hosted mailbox payload decoder is required for this invocation.");
  });

  it("rejects non-idle checkpoints before opening a snapshot session", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const options = createBridgeOptions({
      platform,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("canonical_runtime_commit"),
    )).rejects.toThrow("Hosted workspace snapshot construction is idle-shutdown only.");

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

  for (const wakeCallIndex of [1, 2]) {
    it(`interrupts checkpoint publication when runtime wake is pending on check ${wakeCallIndex}`, async () => {
      const vaultRoot = await createVaultRoot();
      const { calls, platform } = createRuntimePlatform();
      let wakeReadCount = 0;
      const wakeNotification = { notifiedAtEpochMs: 1_777_010_000_000 + wakeCallIndex };
      const consumePendingRuntimeWake = vi.fn(() => {
        wakeReadCount += 1;
        return wakeReadCount === wakeCallIndex ? wakeNotification : null;
      });
      const options = createBridgeOptions({
        consumePendingRuntimeWake,
        platform,
        vaultRoot,
      });

      await expect(options.createCheckpointSnapshot(
        createCheckpointInput("idle_shutdown"),
      )).rejects.toMatchObject({
        notification: wakeNotification,
      });

      expect(consumePendingRuntimeWake).toHaveBeenCalledTimes(wakeCallIndex);
      expect(calls.putSnapshotObjectDirect).toHaveBeenCalledOnce();
      expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
      expect(calls.abortSnapshotSession).toHaveBeenCalledOnce();
    });
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
});

function createBridgeOptions(input: {
  consumePendingRuntimeWake?: () => RuntimeWakeNotification | null;
  mailboxPayloadDecoder?: HostedWorkspaceMailboxPayloadDecoder;
  platform: HostedRuntimePlatform;
  readCurrentLease?: HostedRuntimeBridgeReadCurrentLease;
  request?: HostedWorkspaceInvocationRequest;
  snapshotArchiveBuilder?: HostedWorkspaceSnapshotArchiveBuilder;
  vaultRoot: string;
}): HostedWorkspaceRuntimeJobOptions {
  const request = input.request ?? TEST_REQUEST;
  return createHostedWorkspaceRuntimeBridgeJobOptions({
    consumePendingRuntimeWake: input.consumePendingRuntimeWake,
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
  });
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

function createCheckpointInput(
  reason: "canonical_runtime_commit" | "idle_shutdown" = "idle_shutdown",
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

function createRuntimePlatform(): {
  calls: {
    abortSnapshotSession: ReturnType<typeof vi.fn<WorkspaceSnapshotPort["abortSnapshotSession"]>>;
    completeSnapshotSession: ReturnType<typeof vi.fn<WorkspaceSnapshotPort["completeSnapshotSession"]>>;
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

  return {
    calls: {
      abortSnapshotSession,
      completeSnapshotSession,
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
