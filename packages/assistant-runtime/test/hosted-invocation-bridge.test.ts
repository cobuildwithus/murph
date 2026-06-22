import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";

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
    await expectMissing(path.join(vaultRoot, staleOperationPaths.oldest));
    await expectPresent(path.join(vaultRoot, staleOperationPaths.newest));
    await expectPresent(path.join(vaultRoot, activeOperationPath));
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
