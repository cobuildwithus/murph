import { readFile } from "node:fs/promises";
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
const blockedMailboxPayloadDecoder: HostedWorkspaceMailboxPayloadDecoder = {
  async decode() {
    return {
      reasonCode: "test.mailbox_payload_decoder_not_configured",
      retryable: false,
      status: "blocked",
    };
  },
};
export const testDataKey = encodeHostedWorkspaceSnapshotV2DataKey(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
);

export function createHostedWorkspaceRuntimeBridgeJobOptions(
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

export function createWorkspaceReadResponse(input: {
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

export function createPlatform(input: {
  userId?: string;
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
          userId: input.userId ?? "member_1",
        });

        return {
          encryption: {
            aad: buildHostedWorkspaceSnapshotV2Aad({
              objectKey,
              snapshotId,
              userId: input.userId ?? "member_1",
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
