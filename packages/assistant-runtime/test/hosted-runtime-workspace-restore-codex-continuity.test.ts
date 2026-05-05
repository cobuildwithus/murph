import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  HostedWorkspaceSnapshotContinuityIncompleteError,
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  snapshotHostedAssistantRuntimeHotState,
  snapshotHostedBundleRoots,
  type HostedExecutionBundleRef,
} from "@murphai/runtime-state/node";
import {
  buildHostedExecutionLayeredSnapshotRef,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { describe, test } from "vitest";

import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
} from "../src/hosted-runtime/workspace-restore.ts";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime-contracts.ts";

describe("hosted workspace restore Codex continuity", () => {
  test("restores live Codex provider continuity as authoritative over base state", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-restore-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const sourceBaseOperatorHomeRoot = path.join(workspaceRoot, "base-operator-home");
      const sourceHotVaultRoot = path.join(workspaceRoot, "hot-vault");
      const sourceHotOperatorHomeRoot = path.join(workspaceRoot, "hot-operator-home");
      const baseAssistantRoot = resolveAssistantStatePaths(sourceBaseVaultRoot).assistantStateRoot;
      await mkdir(path.join(baseAssistantRoot, "outbox"), { recursive: true });
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
      await writeFile(
        path.join(baseAssistantRoot, "outbox", "intent-old.json"),
        "{\"intent\":\"old\"}\n",
        "utf8",
      );
      await mkdir(path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", "sessions"), {
        recursive: true,
      });
      await writeFile(
        path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", "sessions", "old-only.json"),
        "{\"codex\":\"old\"}\n",
        "utf8",
      );
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
          {
            root: sourceBaseOperatorHomeRoot,
            rootKey: "operator-home",
          },
        ],
      });
      assert.ok(baseBundle);

      const hotAssistantRoot = resolveAssistantStatePaths(sourceHotVaultRoot).assistantStateRoot;
      await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
      await writeFile(
        path.join(hotAssistantRoot, "sessions", "session-latest.json"),
        "{\"providerSessionId\":\"thread-latest\",\"session\":\"latest\"}\n",
        "utf8",
      );
      await mkdir(path.join(sourceHotOperatorHomeRoot, ".codex-hosted", "sessions"), {
        recursive: true,
      });
      await writeFile(
        path.join(sourceHotOperatorHomeRoot, ".codex-hosted", "sessions", "latest.json"),
        "{\"codex\":\"latest\"}\n",
        "utf8",
      );
      const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        operatorHomeRoot: sourceHotOperatorHomeRoot,
        vaultRoot: sourceHotVaultRoot,
      });
      const baseHash = sha256HostedBundleHex(baseBundle);
      const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
      const artifactGetCalls: string[] = [];

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map([
            [baseHash, baseBundle],
            [hotHash, hotSnapshot.bundle],
          ]),
          artifactGetCalls,
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: buildHostedExecutionLayeredSnapshotRef({
            base: createBundleRef({
              hash: baseHash,
              key: "users/bundles/member-synthetic/base.bundle.json",
              size: baseBundle.byteLength,
            }),
            hot: createBundleRef({
              hash: hotHash,
              key: "users/bundles/member-synthetic/hot.bundle.json",
              size: hotSnapshot.bundle.byteLength,
            }),
          }),
        }),
      });

      assert.deepEqual(artifactGetCalls, [baseHash, hotHash]);
      assert.equal(await readFile(path.join(restoredVaultRoot, "note.md"), "utf8"), "base note\n");
      await assert.rejects(
        readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "outbox", "intent-old.json"),
          "utf8",
        ),
      );
      assert.equal(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session-latest.json"),
          "utf8",
        ),
        "{\"providerSessionId\":\"thread-latest\",\"session\":\"latest\"}\n",
      );
      const restoredOperatorHomeRoot = path.join(
        path.dirname(restoredVaultRoot),
        `${path.basename(restoredVaultRoot)}-operator-home`,
      );
      await assert.rejects(
        readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", "sessions", "old-only.json"), "utf8"),
      );
      assert.equal(
        await readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", "sessions", "latest.json"), "utf8"),
        "{\"codex\":\"latest\"}\n",
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("rejects incomplete base Codex resume state before restore completes", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-base-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const baseAssistantRoot = resolveAssistantStatePaths(sourceBaseVaultRoot).assistantStateRoot;
      await mkdir(path.join(baseAssistantRoot, "sessions"), { recursive: true });
      await writeFile(
        path.join(baseAssistantRoot, "sessions", "session.json"),
        "{\"providerSessionId\":\"thread-test\"}\n",
        "utf8",
      );
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);

      await assert.rejects(
        restoreHostedWorkspaceRuntimeJobWorkspace({
          platform: createRestorePlatform({
            artifactBytesByHash: new Map([[baseHash, baseBundle]]),
          }),
          vaultRoot: restoredVaultRoot,
          workspace: createWorkspaceState({
            snapshotRef: createBundleRef({
              hash: baseHash,
              key: "users/bundles/member-synthetic/base-incomplete.bundle.json",
              size: baseBundle.byteLength,
            }),
          }),
        }),
        HostedWorkspaceSnapshotContinuityIncompleteError,
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("rejects incomplete hot Codex resume state before overlaying base Codex home", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-hot-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const sourceBaseOperatorHomeRoot = path.join(workspaceRoot, "base-operator-home");
      const sourceHotVaultRoot = path.join(workspaceRoot, "hot-vault");
      await mkdir(sourceBaseVaultRoot, { recursive: true });
      await mkdir(path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", "sessions"), {
        recursive: true,
      });
      await writeFile(
        path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", "sessions", "old-only.json"),
        "{\"codex\":\"old\"}\n",
        "utf8",
      );
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
          {
            root: sourceBaseOperatorHomeRoot,
            rootKey: "operator-home",
          },
        ],
      });
      assert.ok(baseBundle);

      const hotAssistantRoot = resolveAssistantStatePaths(sourceHotVaultRoot).assistantStateRoot;
      await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
      await writeFile(
        path.join(hotAssistantRoot, "sessions", "session.json"),
        "{\"providerSessionId\":\"thread-test\"}\n",
        "utf8",
      );
      const hotBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceHotVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(hotBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const hotHash = sha256HostedBundleHex(hotBundle);

      await assert.rejects(
        restoreHostedWorkspaceRuntimeJobWorkspace({
          platform: createRestorePlatform({
            artifactBytesByHash: new Map([
              [baseHash, baseBundle],
              [hotHash, hotBundle],
            ]),
          }),
          vaultRoot: restoredVaultRoot,
          workspace: createWorkspaceState({
            snapshotRef: buildHostedExecutionLayeredSnapshotRef({
              base: createBundleRef({
                hash: baseHash,
                key: "users/bundles/member-synthetic/base-incomplete-hot.bundle.json",
                size: baseBundle.byteLength,
              }),
              hot: createBundleRef({
                hash: hotHash,
                key: "users/bundles/member-synthetic/hot-incomplete.bundle.json",
                size: hotBundle.byteLength,
              }),
            }),
          }),
        }),
        HostedWorkspaceSnapshotContinuityIncompleteError,
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

function createBundleRef(input: {
  hash: string;
  key: string;
  size: number;
}): HostedExecutionBundleRef {
  return {
    ...input,
    updatedAt: "2026-05-05T00:00:00.000Z",
  };
}

function createRestorePlatform(input: {
  artifactBytesByHash: ReadonlyMap<string, Uint8Array>;
  artifactGetCalls?: string[];
}): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get(sha256) {
        input.artifactGetCalls?.push(sha256);
        return input.artifactBytesByHash.get(sha256) ?? null;
      },
      async put() {
        return undefined;
      },
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
    },
  };
}

function createWorkspaceState(input: {
  snapshotRef: HostedWorkspaceState["snapshotRef"];
}): HostedWorkspaceState {
  return {
    createdAt: "2026-05-05T00:00:00.000Z",
    snapshotRef: input.snapshotRef,
    updatedAt: "2026-05-05T00:00:00.000Z",
    userId: "member_synthetic_workspace_restore",
    version: "9",
  };
}
