import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

describe("workspace snapshot selected-entry interruption", () => {
  it("stops preflight after an in-flight path-segment lstat returns and cleans temporary output", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-preflight-interruption-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const firstFilePath = path.join(vaultRoot, "first.md");
    const secondFilePath = path.join(vaultRoot, "second.md");
    const outputDir = path.join(tempRoot, "scratch");
    const entered = createDeferred();
    const release = createDeferred();
    const visitedPaths: string[] = [];
    const abortController = new AbortController();
    const abortReason = new Error("foreground wake interrupted selected-entry preflight");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await mkdir(vaultRoot, { recursive: true });
      await writeFile(firstFilePath, "first\n", "utf8");
      await writeFile(secondFilePath, "second\n", "utf8");

      vi.doMock("node:fs/promises", async () => {
        const actual = await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
        return {
          ...actual,
          lstat: async (targetPath: string) => {
            visitedPaths.push(targetPath);
            const stats = await actual.lstat(targetPath);
            if (visitedPaths.length === 1) {
              entered.resolve();
              await release.promise;
            }
            return stats;
          },
        };
      });
      const { createEncryptedWorkspaceSnapshotFile } = await import(
        "../src/workspace-snapshot-local.ts"
      );

      const construction = createEncryptedWorkspaceSnapshotFile({
        aad: buildHostedWorkspaceSnapshotV2Aad({
          objectKey: "users/hsn_test/workspace-snapshots/interrupted.snapshot.enc",
          snapshotId: "snapshot_interrupted_preflight",
          userId: "member_123",
        }),
        archiveEntries: [
          {
            absolutePath: firstFilePath,
            archivePath: "vault/first.md",
            kind: "file",
          },
          {
            absolutePath: secondFilePath,
            archivePath: "vault/second.md",
            kind: "file",
          },
        ],
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
        outputDir,
        signal: abortController.signal,
      });
      await entered.promise;
      abortController.abort(abortReason);
      release.resolve();

      await expect(construction).rejects.toBe(abortReason);
      expect(visitedPaths).toEqual([vaultRoot]);
      await expect(readdir(outputDir)).resolves.toEqual([]);
    } finally {
      release.resolve();
      dataKey.fill(0);
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("stops postflight after an in-flight path-segment lstat returns and cleans the archive", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-postflight-interruption-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const filePath = path.join(vaultRoot, "entry.md");
    const outputDir = path.join(tempRoot, "scratch");
    const entered = createDeferred();
    const release = createDeferred();
    const visitedPaths: string[] = [];
    const abortController = new AbortController();
    const abortReason = new Error("foreground wake interrupted selected-entry postflight");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await mkdir(vaultRoot, { recursive: true });
      await writeFile(filePath, "entry\n", "utf8");

      vi.doMock("node:fs/promises", async () => {
        const actual = await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
        return {
          ...actual,
          lstat: async (targetPath: string) => {
            visitedPaths.push(targetPath);
            const stats = await actual.lstat(targetPath);
            if (visitedPaths.length === 3) {
              entered.resolve();
              await release.promise;
            }
            return stats;
          },
        };
      });
      const { createEncryptedWorkspaceSnapshotFile } = await import(
        "../src/workspace-snapshot-local.ts"
      );

      const construction = createEncryptedWorkspaceSnapshotFile({
        aad: buildHostedWorkspaceSnapshotV2Aad({
          objectKey: "users/hsn_test/workspace-snapshots/postflight.snapshot.enc",
          snapshotId: "snapshot_interrupted_postflight",
          userId: "member_123",
        }),
        archiveEntries: [{
          absolutePath: filePath,
          archivePath: "vault/entry.md",
          kind: "file",
        }],
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
        outputDir,
        signal: abortController.signal,
      });
      await entered.promise;
      abortController.abort(abortReason);
      release.resolve();

      await expect(construction).rejects.toBe(abortReason);
      expect(visitedPaths).toEqual([vaultRoot, filePath, vaultRoot]);
      await expect(readdir(outputDir)).resolves.toEqual([]);
    } finally {
      release.resolve();
      dataKey.fill(0);
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

function createDeferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}
