import { describe, expect, it } from "vitest";

import {
  buildHostedWorkspaceSnapshotV2Aad,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import {
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
  parseHostedWorkspaceSnapshotUploadSession,
  readHostedWorkspaceSnapshotR2BucketRole,
} from "../src/workspace-snapshot-store.ts";

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const objectKey = "users/hsn_0123456789abcdef01234567/workspace-snapshots/snapshot_1.snapshot.enc";
  return {
    attemptId: "attempt_1",
    createdAt: "2026-07-28T12:00:00.000Z",
    encryption: {
      aad: buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId: "snapshot_1",
        userId: "member_1",
      }),
      ivBase64: "AQIDBAUGBwgJCgsM",
      rootKeyId: "root_1",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped",
    },
    expectedWorkspaceVersion: "7",
    expiresAt: "2026-07-28T13:00:00.000Z",
    leaseGeneration: "3",
    objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
    snapshotId: "snapshot_1",
    userId: "member_1",
    workspaceVersion: "7",
    ...overrides,
  };
}

describe("workspace snapshot R2 bucket-affine tickets", () => {
  it("treats a pre-bridge upload session as an OC ticket", () => {
    const parsed = parseHostedWorkspaceSnapshotUploadSession(session());

    expect(parsed.r2BucketRole).toBeUndefined();
    expect(readHostedWorkspaceSnapshotR2BucketRole(parsed)).toBe("source");
  });

  it("preserves the issued destination role and paired PUT drain deadlines", () => {
    const parsed = parseHostedWorkspaceSnapshotUploadSession(session({
      r2BucketRole: "destination",
      r2PutDrainUntil: "2026-07-28T12:20:00.000Z",
      r2PutExpiresAt: "2026-07-28T12:10:00.000Z",
    }));

    expect(readHostedWorkspaceSnapshotR2BucketRole(parsed)).toBe("destination");
    expect(parsed.r2PutExpiresAt).toBe("2026-07-28T12:10:00.000Z");
    expect(parsed.r2PutDrainUntil).toBe("2026-07-28T12:20:00.000Z");
  });

  it("rejects partial, reversed, or unknown ticket metadata", () => {
    expect(() => parseHostedWorkspaceSnapshotUploadSession(session({
      r2PutExpiresAt: "2026-07-28T12:10:00.000Z",
    }))).toThrow("recorded together");
    expect(() => parseHostedWorkspaceSnapshotUploadSession(session({
      r2PutDrainUntil: "2026-07-28T12:09:00.000Z",
      r2PutExpiresAt: "2026-07-28T12:10:00.000Z",
    }))).toThrow("must not precede");
    expect(() => parseHostedWorkspaceSnapshotUploadSession(session({
      r2BucketRole: "primary",
    }))).toThrow("source or destination");
  });
});
