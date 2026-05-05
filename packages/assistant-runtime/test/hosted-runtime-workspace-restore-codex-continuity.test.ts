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
} from "../src/hosted-runtime/workspace-restore.ts";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime-contracts.ts";

describe("hosted workspace restore Codex continuity", () => {
  test("preserves base Codex provider continuity when hot state omits Codex home", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-restore-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const sourceBaseOperatorHomeRoot = path.join(workspaceRoot, "base-operator-home");
      const sourceHotVaultRoot = path.join(workspaceRoot, "hot-vault");
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
        JSON.stringify({
          resumeState: {
            providerSessionId: "thread-latest",
            resumeRouteId: "route-latest",
          },
          session: "latest",
        }) + "\n",
        "utf8",
      );
      const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
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
        "{\"resumeState\":{\"providerSessionId\":\"thread-latest\",\"resumeRouteId\":\"route-latest\"},\"session\":\"latest\"}\n",
      );
      const restoredOperatorHomeRoot = path.join(
        path.dirname(restoredVaultRoot),
        `${path.basename(restoredVaultRoot)}-operator-home`,
      );
      assert.equal(
        await readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", "sessions", "old-only.json"), "utf8"),
        "{\"codex\":\"old\"}\n",
      );
      await assert.rejects(
        readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", "sessions", "latest.json"), "utf8"),
      );
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
      assert.equal(logRequests.length, 1);
      assert.deepEqual(logRequests[0]?.entries.map((entry) => entry.eventCode), [
        "workspace.legacy_codex_resume_repaired",
      ]);
      assert.equal(logRequests[0]?.entries[0]?.redactedJson?.snapshotLayer, "base");
      assert.equal(logRequests[0]?.entries[0]?.redactedJson?.nativeResumeDisabled, true);
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
      assert.equal(logRequests.length, 1);
      assert.deepEqual(logRequests[0]?.entries.map((entry) => entry.eventCode), [
        "workspace.legacy_codex_resume_repaired",
      ]);
      assert.equal(logRequests[0]?.entries[0]?.redactedJson?.snapshotLayer, "hot");
      assert.equal(logRequests[0]?.entries[0]?.redactedJson?.nativeResumeDisabled, true);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

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
