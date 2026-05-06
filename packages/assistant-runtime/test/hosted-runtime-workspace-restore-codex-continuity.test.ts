import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  parseAssistantSessionRecord,
  type AssistantSessionResumeState,
  type AssistantSessionBinding,
  type AssistantModelTarget,
} from "@murphai/operator-config/assistant-cli-contracts";
import {
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  snapshotHostedAssistantRuntimeHotState,
  snapshotHostedBundleRoots,
  writeHostedBundleTextFile,
  type HostedExecutionBundleRef,
} from "@murphai/runtime-state/node";
import {
  buildHostedExecutionLayeredSnapshotRef,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeLogRequest,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { describe, test } from "vitest";

import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
  writeHostedWorkspaceHotRestoreCacheForSnapshotRefBestEffort,
} from "../src/hosted-runtime/workspace-restore.ts";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime-contracts.ts";

describe("hosted workspace restore Codex continuity", () => {
  test("preserves Codex provider continuity when hot state includes its exact rollout", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-restore-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const sourceBaseOperatorHomeRoot = path.join(workspaceRoot, "base-operator-home");
      const sourceHotVaultRoot = path.join(workspaceRoot, "hot-vault");
      const sourceHotOperatorHomeRoot = path.join(workspaceRoot, "hot-operator-home");
      const baseAssistantRoot = resolveAssistantStatePaths(sourceBaseVaultRoot).assistantStateRoot;
      const threadId = "00000000-0000-4000-8000-000000000005";
      const rolloutRelativePath =
        `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
      const resumeState = {
        codexRolloutRelativePath: rolloutRelativePath,
        providerSessionId: threadId,
        resumeRouteId: "route-latest",
      };
      await mkdir(path.join(baseAssistantRoot, "outbox"), { recursive: true });
      await mkdir(path.join(baseAssistantRoot, "sessions"), { recursive: true });
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
      await writeFile(
        path.join(baseAssistantRoot, "outbox", "intent-old.json"),
        "{\"intent\":\"old\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(baseAssistantRoot, "sessions", "session-latest.json"),
        JSON.stringify({
          resumeState,
          session: "base",
        }) + "\n",
        "utf8",
      );
      await mkdir(path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06"), {
        recursive: true,
      });
      await mkdir(path.join(sourceBaseOperatorHomeRoot, ".murph"), { recursive: true });
      const baseRolloutJson = "{\"codex\":\"old\"}\n";
      await writeFile(
        path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", rolloutRelativePath),
        baseRolloutJson,
        "utf8",
      );
      await writeFile(
        path.join(sourceBaseOperatorHomeRoot, ".murph", "hosted-codex-continuity.json"),
        JSON.stringify({
          schema: "murph.hosted-codex-continuity.v1",
          threads: [{
            codexRolloutRelativePath: rolloutRelativePath,
            providerSessionId: threadId,
            rolloutBlob: {
              byteSize: Buffer.byteLength(baseRolloutJson),
              sha256: sha256HostedBundleHex(Buffer.from(baseRolloutJson)),
              storage: "hosted-bundle.v1",
            },
          }],
        }) + "\n",
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
        JSON.stringify({
          resumeState,
          session: "latest",
        }) + "\n",
        "utf8",
      );
      await mkdir(path.join(sourceHotOperatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06"), {
        recursive: true,
      });
      await writeFile(
        path.join(sourceHotOperatorHomeRoot, ".codex-hosted", rolloutRelativePath),
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
      const logRequests: HostedRuntimeLogRequest[] = [];

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map([
            [baseHash, baseBundle],
            [hotHash, hotSnapshot.bundle],
          ]),
          artifactGetCalls,
          logRequests,
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
              key: `cloudflare-workspace-hot-state/${hotHash}.bundle`,
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
        JSON.stringify({
          resumeState,
          session: "latest",
        }) + "\n",
      );
      const restoredOperatorHomeRoot = path.join(
        path.dirname(restoredVaultRoot),
        `${path.basename(restoredVaultRoot)}-operator-home`,
      );
      assert.equal(
        await readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", rolloutRelativePath), "utf8"),
        "{\"codex\":\"latest\"}\n",
      );
      await assert.rejects(
        readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", "sessions", "old-only.json"), "utf8"),
      );
      assert.deepEqual(flattenLogEntries(logRequests), []);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("skips unchanged base snapshot restore when warm local roots already contain it", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-base-cache-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const sourceBaseOperatorHomeRoot = path.join(workspaceRoot, "base-operator-home");
      await mkdir(sourceBaseVaultRoot, { recursive: true });
      await mkdir(path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", "sessions"), {
        recursive: true,
      });
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
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

      const firstHotSnapshot = await createHotStateSnapshot({
        sessionName: "first",
        threadId: "00000000-0000-4000-8000-000000000011",
        workspaceRoot,
      });
      const secondHotSnapshot = await createHotStateSnapshot({
        sessionName: "second",
        threadId: "00000000-0000-4000-8000-000000000012",
        workspaceRoot,
      });
      const baseHash = sha256HostedBundleHex(baseBundle);
      const firstHotHash = sha256HostedBundleHex(firstHotSnapshot.bundle);
      const secondHotHash = sha256HostedBundleHex(secondHotSnapshot.bundle);
      const artifactGetCalls: string[] = [];
      const logRequests: HostedRuntimeLogRequest[] = [];
      const platform = createRestorePlatform({
        artifactBytesByHash: new Map([
          [baseHash, baseBundle],
          [firstHotHash, firstHotSnapshot.bundle],
          [secondHotHash, secondHotSnapshot.bundle],
        ]),
        artifactGetCalls,
        logRequests,
      });
      const baseRef = createBundleRef({
        hash: baseHash,
        key: "users/bundles/member-synthetic/base-cache.bundle.json",
        size: baseBundle.byteLength,
      });
      const secondSnapshotRef = buildHostedExecutionLayeredSnapshotRef({
        base: baseRef,
        hot: createBundleRef({
          hash: secondHotHash,
          key: `cloudflare-workspace-hot-state/${secondHotHash}.bundle`,
          size: secondHotSnapshot.bundle.byteLength,
        }),
      });

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: buildHostedExecutionLayeredSnapshotRef({
            base: baseRef,
            hot: createBundleRef({
              hash: firstHotHash,
              key: `cloudflare-workspace-hot-state/${firstHotHash}.bundle`,
              size: firstHotSnapshot.bundle.byteLength,
            }),
          }),
        }),
      });

      assert.deepEqual(artifactGetCalls, [baseHash, firstHotHash]);
      artifactGetCalls.length = 0;
      logRequests.length = 0;

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: secondSnapshotRef,
        }),
      });

      assert.deepEqual(artifactGetCalls, [secondHotHash]);
      assert.equal(await readFile(path.join(restoredVaultRoot, "note.md"), "utf8"), "base note\n");
      assert.equal(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session-latest.json"),
          "utf8",
        ),
        JSON.stringify({
          resumeState: secondHotSnapshot.resumeState,
          session: "second",
        }) + "\n",
      );
      assert.deepEqual(flattenLogEntries(logRequests), []);

      await writeHostedWorkspaceHotRestoreCacheForSnapshotRefBestEffort({
        snapshotRef: secondSnapshotRef,
        vaultRoot: restoredVaultRoot,
      });
      const rolloutRelativePath = secondHotSnapshot.resumeState.codexRolloutRelativePath;
      assert.ok(rolloutRelativePath);
      artifactGetCalls.length = 0;
      logRequests.length = 0;

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: secondSnapshotRef,
        }),
      });

      assert.deepEqual(artifactGetCalls, []);
      assert.equal(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session-latest.json"),
          "utf8",
        ),
        JSON.stringify({
          resumeState: secondHotSnapshot.resumeState,
          session: "second",
        }) + "\n",
      );
      assert.deepEqual(flattenLogEntries(logRequests), []);

      await writeFile(
        path.join(
          path.dirname(restoredVaultRoot),
          `${path.basename(restoredVaultRoot)}-operator-home`,
          ".codex-hosted",
          rolloutRelativePath,
        ),
        "{\"session\":\"corrupted\"}\n",
        "utf8",
      );
      await writeHostedWorkspaceHotRestoreCacheForSnapshotRefBestEffort({
        snapshotRef: secondSnapshotRef,
        vaultRoot: restoredVaultRoot,
      });

      await assert.rejects(
        restoreHostedWorkspaceRuntimeJobWorkspace({
          platform,
          vaultRoot: restoredVaultRoot,
          workspace: createWorkspaceState({
            snapshotRef: secondSnapshotRef,
          }),
        }),
        /mismatch/u,
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("fails hosted runtime restore when restored Codex rollout fails manifest integrity", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-integrity-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const hotSnapshot = await createHotStateSnapshot({
        sessionName: "integrity",
        threadId: "00000000-0000-4000-8000-000000000013",
        workspaceRoot,
      });
      const rolloutRelativePath = hotSnapshot.resumeState.codexRolloutRelativePath;
      assert.ok(rolloutRelativePath);
      const tamperedBundle = writeHostedBundleTextFile({
        bytes: hotSnapshot.bundle,
        kind: "vault",
        path: `.codex-hosted/${rolloutRelativePath}`,
        root: "operator-home",
        text: "{\"session\":\"tampered\"}\n",
      });
      const tamperedHash = sha256HostedBundleHex(tamperedBundle);

      await assert.rejects(
        restoreHostedWorkspaceRuntimeJobWorkspace({
          platform: createRestorePlatform({
            artifactBytesByHash: new Map([[tamperedHash, tamperedBundle]]),
          }),
          vaultRoot: restoredVaultRoot,
          workspace: createWorkspaceState({
            snapshotRef: createBundleRef({
              hash: tamperedHash,
              key: `cloudflare-workspace-hot-state/${tamperedHash}.bundle`,
              size: tamperedBundle.byteLength,
            }),
          }),
        }),
        /mismatch/u,
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("fails hosted runtime restore cache hit when Codex manifest is missing", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-cache-missing-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      await mkdir(sourceBaseVaultRoot, { recursive: true });
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
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
      const hotSnapshot = await createHotStateSnapshot({
        sessionName: "cache-missing",
        threadId: "00000000-0000-4000-8000-000000000028",
        workspaceRoot,
      });
      const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
      const snapshotRef = buildHostedExecutionLayeredSnapshotRef({
        base: createBundleRef({
          hash: baseHash,
          key: `cloudflare-workspace-base/${baseHash}.bundle`,
          size: baseBundle.byteLength,
        }),
        hot: createBundleRef({
          hash: hotHash,
          key: `cloudflare-workspace-hot-state/${hotHash}.bundle`,
          size: hotSnapshot.bundle.byteLength,
        }),
      });
      const artifactGetCalls: string[] = [];
      const platform = createRestorePlatform({
        artifactBytesByHash: new Map([
          [baseHash, baseBundle],
          [hotHash, hotSnapshot.bundle],
        ]),
        artifactGetCalls,
      });

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef,
        }),
      });
      await writeHostedWorkspaceHotRestoreCacheForSnapshotRefBestEffort({
        snapshotRef,
        vaultRoot: restoredVaultRoot,
      });
      artifactGetCalls.length = 0;

      const restoredOperatorHomeRoot = path.join(
        path.dirname(restoredVaultRoot),
        `${path.basename(restoredVaultRoot)}-operator-home`,
      );
      await rm(
        path.join(restoredOperatorHomeRoot, ".murph", "hosted-codex-continuity.json"),
        { force: true },
      );

      await assert.rejects(
        restoreHostedWorkspaceRuntimeJobWorkspace({
          platform,
          vaultRoot: restoredVaultRoot,
          workspace: createWorkspaceState({
            snapshotRef,
          }),
        }),
        /manifest is missing/u,
      );
      assert.deepEqual(artifactGetCalls, []);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("repairs incomplete legacy base Codex resume state during restore", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-base-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const baseAssistantRoot = resolveAssistantStatePaths(sourceBaseVaultRoot).assistantStateRoot;
      await mkdir(path.join(baseAssistantRoot, "sessions"), { recursive: true });
      const legacySession = createCodexSessionRecord({
        alias: "primary",
        resumeState: {
          providerSessionId: "thread-test",
          resumeRouteId: "route-test",
        },
        sessionId: "session",
      });
      await writeFile(
        path.join(baseAssistantRoot, "sessions", "session.json"),
        JSON.stringify({
          ...legacySession,
          providerSessionId: "legacy-thread",
        }) + "\n",
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
      const logRequests: HostedRuntimeLogRequest[] = [];

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map([[baseHash, baseBundle]]),
          logRequests,
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: createBundleRef({
            hash: baseHash,
            key: "users/bundles/member-synthetic/base-incomplete.bundle.json",
            size: baseBundle.byteLength,
          }),
        }),
      });

      assert.equal(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
          "utf8",
        ),
        JSON.stringify({
          ...legacySession,
          resumeState: null,
        }) + "\n",
      );
      assert.equal(
        parseAssistantSessionRecord(JSON.parse(
          await readFile(
            path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
            "utf8",
          ),
        )).resumeState,
        null,
      );
      const repairLogs = flattenLogEntries(logRequests).filter((entry) =>
        entry.eventCode === "workspace.legacy_codex_resume_repaired"
      );
      assert.equal(repairLogs.length, 1);
      assert.equal(repairLogs[0]?.redactedJson?.snapshotLayer, "base");
      assert.equal(repairLogs[0]?.redactedJson?.nativeResumeDisabled, true);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("repairs incomplete legacy hot Codex resume state and clears stale base Codex home", async () => {
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
        JSON.stringify({
          providerSessionId: "thread-test",
          session: "latest",
        }) + "\n",
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
      const logRequests: HostedRuntimeLogRequest[] = [];

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map([
            [baseHash, baseBundle],
            [hotHash, hotBundle],
          ]),
          logRequests,
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
      });

      assert.equal(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
          "utf8",
        ),
        "{\"session\":\"latest\"}\n",
      );
      const restoredOperatorHomeRoot = path.join(
        path.dirname(restoredVaultRoot),
        `${path.basename(restoredVaultRoot)}-operator-home`,
      );
      await assert.rejects(
        readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", "sessions", "old-only.json"), "utf8"),
      );
      const repairLogs = flattenLogEntries(logRequests).filter((entry) =>
        entry.eventCode === "workspace.legacy_codex_resume_repaired"
      );
      assert.equal(repairLogs.length, 1);
      assert.equal(repairLogs[0]?.redactedJson?.snapshotLayer, "hot");
      assert.equal(repairLogs[0]?.redactedJson?.nativeResumeDisabled, true);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

function flattenLogEntries(
  requests: readonly HostedRuntimeLogRequest[],
): HostedRuntimeLogRequest["entries"] {
  return requests.flatMap((request) => request.entries);
}

async function createHotStateSnapshot(input: {
  sessionName: string;
  threadId: string;
  workspaceRoot: string;
}): Promise<{
  bundle: Uint8Array;
  resumeState: AssistantSessionResumeState;
}> {
  const sourceHotVaultRoot = path.join(input.workspaceRoot, `hot-vault-${input.sessionName}`);
  const sourceHotOperatorHomeRoot = path.join(input.workspaceRoot, `hot-operator-home-${input.sessionName}`);
  const hotAssistantRoot = resolveAssistantStatePaths(sourceHotVaultRoot).assistantStateRoot;
  const rolloutRelativePath =
    `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${input.threadId}.jsonl`;
  const resumeState = {
    codexRolloutRelativePath: rolloutRelativePath,
    providerSessionId: input.threadId,
    resumeRouteId: `route-${input.sessionName}`,
  };
  await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
  await mkdir(path.join(sourceHotOperatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06"), {
    recursive: true,
  });
  await writeFile(
    path.join(hotAssistantRoot, "sessions", "session-latest.json"),
    JSON.stringify({
      resumeState,
      session: input.sessionName,
    }) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(sourceHotOperatorHomeRoot, ".codex-hosted", rolloutRelativePath),
    JSON.stringify({
      session: input.sessionName,
    }) + "\n",
    "utf8",
  );
  const snapshot = await snapshotHostedAssistantRuntimeHotState({
    operatorHomeRoot: sourceHotOperatorHomeRoot,
    vaultRoot: sourceHotVaultRoot,
  });
  return {
    bundle: snapshot.bundle,
    resumeState,
  };
}

function createCodexSessionRecord(input: {
  alias?: string | null;
  resumeState?: AssistantSessionResumeState | null;
  sessionId: string;
}): {
  alias: string | null;
  binding: AssistantSessionBinding;
  createdAt: string;
  lastTurnAt: string | null;
  resumeState: AssistantSessionResumeState | null;
  schema: "murph.assistant-session.v1";
  sessionId: string;
  target: AssistantModelTarget;
  turnCount: number;
  updatedAt: string;
} {
  return {
    alias: input.alias ?? null,
    binding: createEmptyAssistantSessionBinding(),
    createdAt: "2026-05-05T00:00:00.000Z",
    lastTurnAt: null,
    resumeState: input.resumeState ?? null,
    schema: "murph.assistant-session.v1",
    sessionId: input.sessionId,
    target: createHostedCodexSessionTarget(),
    turnCount: 0,
    updatedAt: "2026-05-05T00:00:00.000Z",
  };
}

function createHostedCodexSessionTarget(): AssistantModelTarget {
  return {
    adapter: "codex-cli",
    approvalPolicy: "never",
    codexCommand: null,
    codexHome: null,
    model: "gpt-5.5",
    modelProvider: "openai",
    oss: false,
    profile: null,
    reasoningEffort: "medium",
    sandbox: "danger-full-access",
  };
}

function createEmptyAssistantSessionBinding(): AssistantSessionBinding {
  return {
    actorId: null,
    channel: null,
    conversationKey: null,
    delivery: null,
    identityId: null,
    threadId: null,
    threadIsDirect: null,
  };
}

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
  logRequests?: HostedRuntimeLogRequest[];
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
    logPort: {
      async write(request) {
        input.logRequests?.push(request);
        return {
          loggedCount: request.entries.length,
        };
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
