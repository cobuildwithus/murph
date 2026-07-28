import { describe, expect, it } from "vitest";

import {
  hostedArtifactObjectKey,
  hostedBundleObjectKey,
  hostedPrivateMediaObjectKey,
  hostedRunnerSecretsObjectKey,
  hostedWorkspaceSnapshotObjectKey,
  hostedWorkspaceSnapshotUserPrefix,
  isUserScopedHostedWorkspaceSnapshotObjectKey,
} from "../src/storage-paths.js";
import { expectOpaqueStrings } from "./object-key-assertions.js";

describe("hosted storage paths", () => {
  it("derives opaque user-scoped and transient object keys independently from encryption roots", async () => {
    const userId = "user_secret_123";
    const sha256 = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const hash = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    const artifactKey = await hostedArtifactObjectKey({ sha256, userId });
    const bundleKey = await hostedBundleObjectKey({ hash, kind: "vault", userId });
    const runnerSecretsKey = await hostedRunnerSecretsObjectKey({ userId });
    const privateMediaKey = await hostedPrivateMediaObjectKey({
      sha256,
      userId,
    });
    const workspaceSnapshotKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: "snapshot_01ABCxyz-9",
      userId,
    });
    const workspaceSnapshotPrefix = await hostedWorkspaceSnapshotUserPrefix({ userId });

    expect(artifactKey).toMatch(/^users\/hsn_[0-9a-f]{24}\/artifacts\/[0-9a-f]{48}\.artifact\.bin$/);
    expect(bundleKey).toMatch(/^users\/hsn_[0-9a-f]{24}\/bundles\/vault\/[0-9a-f]{48}\.bundle\.json$/);
    expect(runnerSecretsKey).toMatch(/^users\/hsn_[0-9a-f]{24}\/runner-secrets\.json$/);
    expect(privateMediaKey).toMatch(
      /^hosted-private-media\/images\/hsn_[0-9a-f]{24}\/[0-9a-f]{48}\.image\.enc$/,
    );
    expect(workspaceSnapshotKey).toMatch(/^users\/hsn_[0-9a-f]{24}\/workspace-snapshots\/snapshot_01ABCxyz-9\.snapshot\.enc$/);
    expect(workspaceSnapshotKey.startsWith(workspaceSnapshotPrefix)).toBe(true);
    expect(isUserScopedHostedWorkspaceSnapshotObjectKey(workspaceSnapshotKey)).toBe(true);
    expect(isUserScopedHostedWorkspaceSnapshotObjectKey("workspace-snapshots/snapshot_01ABCxyz-9.snapshot.enc")).toBe(false);

    expectOpaqueStrings(
      [
        artifactKey,
        bundleKey,
        privateMediaKey,
        runnerSecretsKey,
        workspaceSnapshotKey,
      ],
      [userId, sha256, hash],
    );
  });

  it("rejects snapshot ids that could escape the workspace snapshot prefix", async () => {
    await expect(hostedWorkspaceSnapshotObjectKey({
      snapshotId: "../snapshot",
      userId: "user_secret_123",
    })).rejects.toThrow(/snapshot id/u);
    await expect(hostedWorkspaceSnapshotObjectKey({
      snapshotId: "nested/snapshot",
      userId: "user_secret_123",
    })).rejects.toThrow(/snapshot id/u);
  });
});
