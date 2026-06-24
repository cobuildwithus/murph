import { describe, expect, it } from "vitest";

import {
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  type HostedWorkspaceSnapshotV2Ref,
  buildHostedWorkspaceSnapshotV2Aad,
  buildHostedWorkspaceSnapshotV2FingerprintSha256,
  createHostedWorkspaceSnapshotV2DataKey,
  encodeHostedWorkspaceSnapshotV2DataKey,
  decodeHostedWorkspaceSnapshotV2DataKey,
  unwrapHostedWorkspaceSnapshotV2DataKey,
  wrapHostedWorkspaceSnapshotV2DataKey,
} from "../src/workspace-snapshot-v2.ts";
import {
  isHostedWorkspaceSnapshotV2Ref,
  parseHostedExecutionSnapshotRef,
  parseHostedWorkspaceSnapshotV2Ref,
  readHostedBrowserVaultSourceStateHash,
  readHostedExecutionSnapshotBaseRef,
} from "../src/parsers.ts";

describe("hosted workspace snapshot v2 refs", () => {
  it("keeps the encrypted snapshot object limit bounded for memory restore", () => {
    expect(HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES).toBe(512 * 1024 * 1024);
  });

  it("keeps the total plain snapshot limit bounded for restore extraction", () => {
    expect(HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES).toBe(1024 * 1024 * 1024);
  });

  it("parses the single encrypted object snapshot contract", () => {
    const ref = createWorkspaceSnapshotV2Ref();

    expect(parseHostedWorkspaceSnapshotV2Ref(ref)).toEqual(ref);
    expect(parseHostedExecutionSnapshotRef(ref)).toEqual(ref);
    expect(isHostedWorkspaceSnapshotV2Ref(parseHostedExecutionSnapshotRef(ref))).toBe(true);
    expect(readHostedExecutionSnapshotBaseRef(parseHostedExecutionSnapshotRef(ref))).toBeNull();
    expect(readHostedBrowserVaultSourceStateHash(parseHostedExecutionSnapshotRef(ref))).toBeNull();
  });

  it("builds a deterministic fingerprint for the complete v2 snapshot identity", () => {
    const ref = createWorkspaceSnapshotV2Ref();
    const fingerprint = buildHostedWorkspaceSnapshotV2FingerprintSha256(ref);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(buildHostedWorkspaceSnapshotV2FingerprintSha256(ref)).toBe(fingerprint);
    expect(buildHostedWorkspaceSnapshotV2FingerprintSha256({
      ...ref,
      archive: {
        ...ref.archive,
        encryptedObjectSha256: "c".repeat(64),
      },
    })).not.toBe(fingerprint);
  });

  it("rejects malformed archive metadata and AAD mismatches", () => {
    const ref = createWorkspaceSnapshotV2Ref();

    expect(() => parseHostedWorkspaceSnapshotV2Ref({
      ...ref,
      archive: {
        ...ref.archive,
        encryptedObjectSha256: "sha256:bad",
      },
    })).toThrow(/encryptedObjectSha256/u);

    expect(() => parseHostedWorkspaceSnapshotV2Ref({
      ...ref,
      archive: {
        ...ref.archive,
        encryptedByteSize: 0,
      },
    })).toThrow(/encryptedByteSize/u);

    expect(() => parseHostedWorkspaceSnapshotV2Ref({
      ...ref,
      archive: {
        ...ref.archive,
        compression: "gzip",
      },
    })).toThrow(/compression/u);

    expect(() => parseHostedWorkspaceSnapshotV2Ref({
      ...ref,
      createdAt: "2026-05-20T00:00:00Z",
    })).toThrow(/createdAt/u);

    expect(() => parseHostedWorkspaceSnapshotV2Ref({
      ...ref,
      encryption: {
        ...ref.encryption,
        aad: {
          ...ref.encryption.aad,
          objectKey: "users/hsn_bad/workspace-snapshots/snapshot_1.snapshot.enc",
        },
      },
    })).toThrow(/aad\.objectKey/u);

    expect(() => parseHostedWorkspaceSnapshotV2Ref({
      ...ref,
      snapshotId: "../snapshot",
    })).toThrow(/snapshotId/u);

    expect(() => parseHostedWorkspaceSnapshotV2Ref({
      ...ref,
      objectKey: "users/hsn_abcdef0123456789abcdef01/artifacts/snapshot_1.snapshot.enc",
    })).toThrow(/objectKey/u);

    expect(() => parseHostedWorkspaceSnapshotV2Ref({
      ...ref,
      objectKey: "users/hsn_abcdef0123456789abcdef01/workspace-snapshots/snapshot_2.snapshot.enc",
    })).toThrow(/objectKey/u);

    expect(() => parseHostedWorkspaceSnapshotV2Ref({
      ...ref,
      encryption: {
        ...ref.encryption,
        ivBase64: "base64url-iv",
      },
    })).toThrow(/ivBase64/u);
  });

  it("wraps snapshot data keys against AAD and the user runtime root", async () => {
    const ref = createWorkspaceSnapshotV2Ref();
    const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const dataKey = createHostedWorkspaceSnapshotV2DataKey();
    const wrappedDataKey = await wrapHostedWorkspaceSnapshotV2DataKey({
      aad: ref.encryption.aad,
      dataKey,
      rootKey,
      rootKeyId: ref.encryption.rootKeyId,
    });

    expect(decodeHostedWorkspaceSnapshotV2DataKey(
      encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
    )).toEqual(dataKey);
    await expect(unwrapHostedWorkspaceSnapshotV2DataKey({
      aad: ref.encryption.aad,
      rootKey,
      wrappedDataKey,
    })).resolves.toEqual(dataKey);
    await expect(unwrapHostedWorkspaceSnapshotV2DataKey({
      aad: {
        ...ref.encryption.aad,
        snapshotId: "snapshot_2",
      },
      rootKey,
      wrappedDataKey,
    })).rejects.toThrow();
  });
});

function createWorkspaceSnapshotV2Ref() {
  const userId = "member_123";
  const objectKey = "users/hsn_abcdef0123456789abcdef01/workspace-snapshots/snapshot_1.snapshot.enc";
  const snapshotId = "snapshot_1";

  return {
    archive: {
      compression: "zstd" as const,
      encryptedByteSize: 1024,
      encryptedObjectSha256: "b".repeat(64),
      fileCount: 12,
      format: "tar" as const,
      plaintextArchiveSha256: "a".repeat(64),
      totalPlainBytes: 2048,
    },
    createdAt: "2026-05-20T00:00:00.000Z",
    encryption: {
      aad: buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      }),
      ivBase64: "AQIDBAUGBwgJCgsM",
      rootKeyId: "udrk:runtime:test-root",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey: "base64url-wrapped-key",
    },
    objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
    snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId,
  } satisfies HostedWorkspaceSnapshotV2Ref;
}
