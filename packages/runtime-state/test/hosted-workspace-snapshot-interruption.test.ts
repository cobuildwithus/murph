import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

describe("hosted workspace snapshot archive planning interruption", () => {
  it("stops root traversal after an in-flight lstat returns and preserves the exact abort reason", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-plan-interruption-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const childPath = path.join(vaultRoot, "journal", "entry.md");
    const entered = createDeferred();
    const release = createDeferred();
    const visitedPaths: string[] = [];
    const abortController = new AbortController();
    const abortReason = new Error("foreground wake interrupted archive planning");

    try {
      await mkdir(path.dirname(childPath), { recursive: true });
      await writeFile(childPath, "entry\n", "utf8");

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
      const { collectHostedWorkspaceSnapshotArchivePlan } = await import(
        "../src/hosted-bundles.ts"
      );

      const planning = collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot,
        signal: abortController.signal,
        vaultRoot,
      });
      await entered.promise;
      abortController.abort(abortReason);
      release.resolve();

      await expect(planning).rejects.toBe(abortReason);
      expect(visitedPaths).toEqual([vaultRoot]);
    } finally {
      release.resolve();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("stops the directly nested continuity inventory after a released session read", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-continuity-interruption-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const sessionPath = path.join(
      vaultRoot,
      ".runtime",
      "operations",
      "assistant",
      "sessions",
      "session.json",
    );
    const providerSessionId = "00000000-0000-4000-8000-000000000071";
    const rolloutRelativePath =
      `sessions/2026/07/14/rollout-2026-07-14T01-02-03-${providerSessionId}.jsonl`;
    const entered = createDeferred();
    const release = createDeferred();
    const inspectedPaths: string[] = [];
    const abortController = new AbortController();
    const abortReason = new Error("foreground wake interrupted continuity inventory");

    try {
      await mkdir(path.dirname(sessionPath), { recursive: true });
      await mkdir(path.join(operatorHomeRoot, ".codex-hosted", path.dirname(rolloutRelativePath)), {
        recursive: true,
      });
      await writeFile(
        sessionPath,
        `${JSON.stringify({
          resumeState: {
            codexRolloutRelativePath: rolloutRelativePath,
            providerSessionId,
          },
        })}\n`,
        "utf8",
      );
      await writeFile(
        path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
        "{}\n",
        "utf8",
      );

      vi.doMock("node:fs/promises", async () => {
        const actual = await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
        return {
          ...actual,
          lstat: async (targetPath: string) => {
            inspectedPaths.push(targetPath);
            return await actual.lstat(targetPath);
          },
          readFile: async (targetPath: string, encoding: BufferEncoding) => {
            const contents = await actual.readFile(targetPath, encoding);
            if (targetPath === sessionPath) {
              entered.resolve();
              await release.promise;
            }
            return contents;
          },
        };
      });
      const { collectHostedWorkspaceSnapshotArchivePlan } = await import(
        "../src/hosted-bundles.ts"
      );

      const planning = collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot,
        operatorHomeRoot,
        signal: abortController.signal,
        vaultRoot,
      });
      await entered.promise;
      abortController.abort(abortReason);
      release.resolve();

      await expect(planning).rejects.toBe(abortReason);
      expect(inspectedPaths.some((entryPath) => entryPath.startsWith(
        path.join(operatorHomeRoot, ".codex-hosted"),
      ))).toBe(false);
    } finally {
      release.resolve();
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
