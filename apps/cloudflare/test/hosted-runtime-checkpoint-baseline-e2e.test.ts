import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedWorkspaceRuntimeBridgeJobOptions as createPackageHostedWorkspaceRuntimeBridgeJobOptions,
  type HostedWorkspaceMailboxPayloadDecoder,
  type HostedWorkspaceRuntimeBridgeOptionsInput,
} from "@murphai/assistant-runtime/hosted-invocation-testkit";
import type {
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import {
  createCloudflareHostedWorkspaceSnapshotArchiveBuilder,
} from "../src/workspace-snapshot-archive-builder.ts";
import {
  hostedWorkspaceSnapshotObjectKey,
} from "../src/storage-paths.ts";
import {
  restoreEncryptedWorkspaceSnapshot,
} from "../src/workspace-snapshot-local.ts";

type HostedCheckpointSnapshotInput =
  Parameters<ReturnType<typeof createHostedWorkspaceRuntimeBridgeJobOptions>["createCheckpointSnapshot"]>[0];

const cleanupPaths: string[] = [];
const blockedMailboxPayloadDecoder: HostedWorkspaceMailboxPayloadDecoder = {
  async decode() {
    return {
      reasonCode: "test.mailbox_payload_decoder_not_configured",
      retryable: false,
      status: "blocked",
    };
  },
};
const testDataKey = encodeHostedWorkspaceSnapshotV2DataKey(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
);

function createHostedWorkspaceRuntimeBridgeJobOptions(
  input: Omit<
    HostedWorkspaceRuntimeBridgeOptionsInput,
    "decodeMailboxPayload" | "snapshotArchiveBuilder"
  >,
) {
  return createPackageHostedWorkspaceRuntimeBridgeJobOptions({
    ...input,
    decodeMailboxPayload: blockedMailboxPayloadDecoder,
    snapshotArchiveBuilder: createCloudflareHostedWorkspaceSnapshotArchiveBuilder(),
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })
  ));
});

describe("hosted runtime checkpoint baseline", () => {
  it("writes idle shutdown checkpoints as direct-R2 encrypted snapshot objects", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-checkpoint-baseline-"));
    const restoreRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-checkpoint-restore-"));
    cleanupPaths.push(vaultRoot, restoreRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "idle compacted state\n", "utf8");
    const uploadedObjects = new Map<string, Uint8Array>();
    const putArtifact = vi.fn(async () => {});
    const writeBrowserVaultReplica = vi.fn(async () => {
      throw new Error("Browser-vault replica writes are not part of idle checkpoint baseline.");
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: null,
          version: "7",
        }),
        uploadedObjects,
        writeBrowserVaultReplica,
      }),
      readCurrentLease: () => createLease({ workspaceVersion: "7" }),
      request: createInvocationRequest({
        workspaceVersion: "7",
      }),
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput());
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);
    const encryptedBytes = uploadedObjects.get(snapshotRef.objectKey);

    expect(snapshotRef).toEqual(expect.objectContaining({
      objectKey: expect.stringMatching(
        /^users\/hsn_[0-9a-f]{24}\/workspace-snapshots\/snapshot_[A-Za-z0-9._-]+\.snapshot\.enc$/u,
      ),
      schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
      upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    }));
    expect(encryptedBytes).toBeDefined();
    expect(encryptedBytes?.byteLength).toBe(snapshotRef.archive.encryptedByteSize);
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();

    const encryptedScratchRoot = path.join(vaultRoot, ".runtime", "tmp");
    await mkdir(encryptedScratchRoot, { recursive: true });
    const encryptedFilePath = path.join(encryptedScratchRoot, "workspace.snapshot.enc");
    await writeFile(encryptedFilePath, encryptedBytes!);
    await restoreEncryptedWorkspaceSnapshot({
      dataKey: testDataKey,
      durableRoot: restoreRoot,
      encryptedFilePath,
      ref: snapshotRef,
    });
    await expect(readFile(path.join(restoreRoot, "note.md"), "utf8"))
      .resolves.toBe("idle compacted state\n");
  });
});

function createWorkspaceReadResponse(input: {
  snapshotRef?: NonNullable<HostedWorkspaceReadResponse["workspace"]>["snapshotRef"];
  version: string;
}): HostedWorkspaceReadResponse {
  return {
    fetchedAt: "2026-05-01T00:00:00.000Z",
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: input.snapshotRef ? "2026-05-01T00:00:00.000Z" : null,
      createdAt: "2026-05-01T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: input.snapshotRef ?? null,
      updatedAt: "2026-05-01T00:00:00.000Z",
      userId: "member_1",
      version: input.version,
    },
  };
}

function createInvocationRequest(input: {
  workspaceVersion: string;
}) {
  return {
    attemptId: "attempt_1",
    leaseGeneration: "4",
    userId: "member_1",
    workspaceVersion: input.workspaceVersion,
  };
}

function createLease(input: { workspaceVersion: string }) {
  return {
    attemptId: "attempt_1",
    leaseGeneration: "4",
    userId: "member_1",
    workspaceVersion: input.workspaceVersion,
  };
}

function createCheckpointInput(): HostedCheckpointSnapshotInput {
  return {
    nextWakeAt: null,
    nextWakeReason: null,
    reason: "idle_shutdown",
    redactedStatus: null,
  };
}

function createPlatform(input: {
  putArtifact: (payload: { bytes: Uint8Array; sha256: string }) => Promise<void>;
  readWorkspace: () => Promise<HostedWorkspaceReadResponse>;
  uploadedObjects: Map<string, Uint8Array>;
  writeBrowserVaultReplica: () => Promise<never>;
}) {
  let uploadOrdinal = 0;

  return {
    artifactStore: {
      get: async () => null,
      put: input.putArtifact,
    },
    browserVaultReplicaPort: {
      write: input.writeBrowserVaultReplica,
    },
    effectsPort: {
      readRawEmailMessage: async () => null,
      sendEmail: async () => undefined,
    },
    workspacePort: {
      async checkpoint() {
        throw new Error("Workspace checkpoint is not used by baseline snapshot tests.");
      },
      read: input.readWorkspace,
    },
    workspaceSnapshotPort: {
      completeSnapshotSession: async (request: {
        checkpointRequest: HostedWorkspaceCheckpointRequest;
        ref: HostedWorkspaceSnapshotV2Ref;
      }) => ({
        checkpoint: {
          checkpointed: true,
          workspace: createWorkspaceReadResponse({
            snapshotRef: request.ref,
            version: request.checkpointRequest.expectedWorkspaceVersion,
          }).workspace!,
        },
        snapshotRef: request.ref,
      }),
      putSnapshotObjectDirect: async (request: {
        encryptedObjectSha256: string;
        objectKey: string;
        sourceFilePath: string;
        snapshotId: string;
      }) => {
        input.uploadedObjects.set(request.objectKey, await readFile(request.sourceFilePath));
      },
      abortSnapshotSession: async (request: {
        objectKey: string;
        snapshotId: string;
      }) => {
        input.uploadedObjects.delete(request.objectKey);
      },
      restoreWorkspaceSnapshot: async () => {
        throw new Error("Workspace snapshot restore is not used by baseline snapshot tests.");
      },
      startSnapshotSession: async (request: {
        expectedWorkspaceVersion: string;
        reason: "idle_shutdown";
      }) => {
        const snapshotId = `snapshot_baseline_${++uploadOrdinal}`;
        const objectKey = await hostedWorkspaceSnapshotObjectKey({
          snapshotId,
          userId: "member_1",
        });

        return {
          encryption: {
            aad: buildHostedWorkspaceSnapshotV2Aad({
              objectKey,
              snapshotId,
              userId: "member_1",
            }),
            dataKeyBase64: testDataKey,
            ivBase64: "AQIDBAUGBwgJCgsM",
            rootKeyId: "root_key_test",
            scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
            wrappedDataKey: "wrapped_data_key_test",
          },
          limits: {
            maxSinglePartEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
            warnEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
          },
          objectKey,
          snapshotId,
        };
      },
    },
  };
}

function requireWorkspaceSnapshotV2Ref(value: unknown): HostedWorkspaceSnapshotV2Ref {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected a hosted workspace snapshot v2 ref.");
  }
  const record = value as HostedWorkspaceSnapshotV2Ref;
  if (
    record.schema !== HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA
    || record.upload !== HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND
    || typeof record.objectKey !== "string"
    || typeof record.snapshotId !== "string"
  ) {
    throw new TypeError("Hosted workspace snapshot v2 ref is malformed.");
  }
  return record;
}
