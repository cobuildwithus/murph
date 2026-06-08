import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimePlatform,
  HostedRuntimeWorkspaceSnapshotPort,
} from "@murphai/assistant-runtime";
import {
  createHostedWorkspaceRuntimeBridgeJobOptions as createPackageHostedWorkspaceRuntimeBridgeJobOptions,
  type HostedWorkspaceMailboxPayloadDecoder,
  type HostedWorkspaceRuntimeBridgeOptionsInput,
} from "@murphai/assistant-runtime/hosted-invocation-testkit";
import type {
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceInvocationRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  parseHostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/parsers";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import {
  handleRunnerOutboundRequest,
  type RunnerOutboundEnvironmentSource,
} from "../src/runner-outbound.ts";
import {
  createCloudflareHostedWorkspaceSnapshotArchiveBuilder,
} from "../src/workspace-snapshot-archive-builder.ts";
import {
  hostedWorkspaceSnapshotObjectKey,
} from "../src/storage-paths.ts";
import {
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";

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

describe("direct-R2 hard-cut guards", () => {
  it("produces v2 snapshots through direct R2 without artifact sidecar writes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-direct-r2-hard-cut-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");

    const directPuts: SanitizedDirectPut[] = [];
    const putArtifact = vi.fn(async () => {
      throw new Error("v2 workspace snapshots must not call artifactStore.put.");
    });
    const platform = createDirectR2GuardPlatform({
      directPuts,
      putArtifact,
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform,
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      } satisfies HostedWorkspaceInvocationRequest,
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createIdleCheckpointInput());
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);

    expect(snapshotRef).toEqual(expect.objectContaining({
      schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
      upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    }));
    expect(directPuts).toEqual([
      {
        encryptedByteSize: snapshotRef.archive.encryptedByteSize,
        encryptedObjectSha256: snapshotRef.archive.encryptedObjectSha256,
        snapshotId: snapshotRef.snapshotId,
      },
    ]);
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("rejects legacy Worker snapshot body upload routes before reading bodies", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const env = createRunnerOutboundGuardEnv(validateRuntimeWriteFence);

    for (const route of [
      {
        expectedStatus: 405,
        url: "http://workspace-snapshots.worker/workspace-snapshots/snapshot_no_body_upload",
      },
      {
        expectedStatus: 404,
        url: "http://workspace-snapshots.worker/__test/r2-presigned-put/users/member_123/snapshot.enc",
      },
    ] as const) {
      const request = new Request(route.url, {
        body: new Uint8Array([1, 2, 3, 4]),
        headers: {
          "content-type": "application/octet-stream",
        },
        method: "PUT",
      });
      const arrayBufferSpy = vi.spyOn(request, "arrayBuffer");

      const response = await handleRunnerOutboundRequest(request, env, "member_123");

      expect(response.status).toBe(route.expectedStatus);
      expect(arrayBufferSpy).not.toHaveBeenCalled();
      expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    }
  });
});

interface SanitizedDirectPut {
  encryptedByteSize: number;
  encryptedObjectSha256: string;
  snapshotId: string;
}

function createIdleCheckpointInput() {
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
    reason: "idle_shutdown" as const,
    redactedStatus: {},
    state,
  };
}

function createDirectR2GuardPlatform(input: {
  directPuts: SanitizedDirectPut[];
  putArtifact: (payload: { bytes: Uint8Array; sha256: string }) => Promise<void>;
}): HostedRuntimePlatform {
  let snapshotOrdinal = 0;
  const workspaceSnapshotPort: HostedRuntimeWorkspaceSnapshotPort = {
    abortSnapshotSession: async () => undefined,
    completeSnapshotSession: async ({ checkpointRequest, ref }) => ({
      checkpoint: createCheckpointResponse(ref, checkpointRequest.expectedWorkspaceVersion),
      snapshotRef: ref,
    }),
    putSnapshotObjectDirect: async (request) => {
      const bytes = await readFile(request.sourceFilePath);
      if (bytes.byteLength !== request.encryptedByteSize) {
        throw new Error("Direct R2 guard test encrypted byte count mismatch.");
      }
      input.directPuts.push({
        encryptedByteSize: request.encryptedByteSize,
        encryptedObjectSha256: request.encryptedObjectSha256,
        snapshotId: request.snapshotId,
      });
    },
    restoreWorkspaceSnapshot: async () => {
      throw new Error("Direct R2 guard test does not restore snapshots.");
    },
    startSnapshotSession: async () => {
      snapshotOrdinal += 1;
      const snapshotId = `snapshot_guard_${snapshotOrdinal}`;
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
          dataKeyBase64: encodeHostedWorkspaceSnapshotV2DataKey(
            Uint8Array.from({ length: 32 }, (_, index) => index + 1),
          ),
          ivBase64: "AQIDBAUGBwgJCgsM",
          rootKeyId: "root_key_guard",
          scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
          wrappedDataKey: "wrapped_data_key_guard",
        },
        limits: {
          maxSinglePartEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
          warnEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
        },
        objectKey,
        snapshotId,
      };
    },
  };

  return {
    artifactStore: {
      get: async () => null,
      put: input.putArtifact,
    },
    effectsPort: {
      readRawEmailMessage: async () => null,
      sendEmail: async () => undefined,
    },
    workspaceSnapshotPort,
  };
}

function createCheckpointResponse(
  snapshotRef: HostedWorkspaceSnapshotV2Ref,
  version: string,
): HostedWorkspaceCheckpointResponse {
  return {
    checkpointed: true,
    workspace: {
      checkpointedAt: "2026-05-20T00:00:00.000Z",
      createdAt: "2026-05-20T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef,
      updatedAt: "2026-05-20T00:00:00.000Z",
      userId: "member_1",
      version,
    },
  };
}

function createRunnerOutboundGuardEnv(
  validateRuntimeWriteFence: (input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion?: string | null;
  }) => Promise<boolean>,
): RunnerOutboundEnvironmentSource {
  return {
    ...createHostedExecutionTestEnv({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "r2_access_fixture_test",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "r2accounttest",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bundles-test",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "r2_signing_fixture_test",
    }),
    BUNDLES: {
      get: async () => null,
      put: async () => undefined,
    },
    USER_RUNNER: {
      getByName() {
        return {
          validateRuntimeWriteFence,
        };
      },
    },
  };
}

function requireWorkspaceSnapshotV2Ref(value: unknown): HostedWorkspaceSnapshotV2Ref {
  try {
    return parseHostedWorkspaceSnapshotV2Ref(value);
  } catch {
    throw new TypeError("Expected a hosted workspace snapshot v2 ref.");
  }
}
