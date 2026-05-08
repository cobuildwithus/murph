import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedSecureBoxAad,
  sealHostedSecureBox,
  serializeHostedSecureBoxEnvelope,
} from "@murphai/runtime-state";
import {
  listHostedBundleArtifacts,
  readHostedBundleTextFile,
  createHostedPortableWorkspaceManifestFromBundle,
  readHostedPortableWorkspaceManifestFromBundle,
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
  snapshotHostedPortableWorkspaceDelta,
  writeHostedWorkspaceSkippedInlineFiles,
} from "@murphai/runtime-state/node";
import {
  buildHostedMailboxPayloadScope,
  buildHostedMailboxPayloadSecureBoxAad,
  HOSTED_WORKSPACE_CHECKPOINT_REASONS,
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  type HostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
} from "@murphai/hosted-execution/bundles";

import {
  createHostedMailboxEncryptionEnvironmentFromIngressRoot,
} from "../src/hosted-mailbox-encryption.ts";
import {
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "../src/runtime-bridge-workspace.ts";

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })
  ));
});

describe("createHostedWorkspaceRuntimeBridgeJobOptions", () => {
  it("rejects every non-idle checkpoint reason before snapshot side effects", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const readWorkspace = vi.fn(async () => createWorkspaceReadResponse({ version: "7" }));
    const writeBrowserVaultReplica = vi.fn(async (input: { replica: unknown }) =>
      createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(input.replica)));
    const createOptions = () => createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace,
        writeBrowserVaultReplica,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    for (const reason of HOSTED_WORKSPACE_CHECKPOINT_REASONS.filter((reason) =>
      reason !== "idle_shutdown"
    )) {
      await expect(createOptions().createCheckpointSnapshot(createCheckpointInput(reason)))
        .rejects.toThrow("Hosted workspace checkpoint snapshots are idle-shutdown only.");
    }

    expect(readWorkspace).not.toHaveBeenCalled();
    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
  });

  it("lets web CAS own workspace version conflicts", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({ version: "7" }),
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "6",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef).toEqual(expect.objectContaining({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(putArtifact).toHaveBeenCalled();
  });

  it("writes idle shutdown full snapshots without the browser-vault replica port", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const artifactBundles = new Map<string, Uint8Array>();
    const baseSnapshotRef = await createStoredBaseSnapshotRef({
      artifactBundles,
      vaultRoot,
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        omitBrowserVaultReplicaPort: true,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: baseSnapshotRef,
          version: "7",
        }),
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(putArtifact).toHaveBeenCalledWith(expect.objectContaining({
      sha256: snapshotRef.hash,
    }));
  });

  it("writes full seed checkpoints when there is no base snapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox", "intent.json"),
      "{\"intent\":\"ready\"}\n",
      "utf8",
    );
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeBrowserVaultReplica = vi.fn(async (input: { replica: unknown }) =>
      createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(input.replica)));
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => ({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          workspace: {
            checkpointedAt: null,
            createdAt: "2026-05-01T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: null,
            snapshotRef: null,
            updatedAt: "2026-05-01T00:00:00.000Z",
            userId: "member_1",
            version: "0",
          },
        }),
        writeBrowserVaultReplica,
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "0",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "0",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef.key).toMatch(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u);
    expect(putArtifact).toHaveBeenCalledWith(expect.objectContaining({
      sha256: snapshotRef.hash,
    }));
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(writeLog).toHaveBeenCalled();
  });

  it("skips idle shutdown full snapshots that have dangling Codex resume state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    cleanupPaths.push(vaultRoot, baseVaultRoot);
    await writeFile(path.join(baseVaultRoot, "note.md"), "committed base\n", "utf8");
    const artifactBundles = new Map<string, Uint8Array>();
    const baseSnapshotRef = await createStoredBaseSnapshotRef({
      artifactBundles,
      vaultRoot: baseVaultRoot,
    });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          providerSessionId: "00000000-0000-4000-8000-000000000031",
          resumeRouteId: "route-ready",
        },
      }),
      "utf8",
    );
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const browserVaultReplicaRef = createBrowserVaultReplicaRef(baseSnapshotRef.hash);
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => ({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          workspace: {
            browserVaultReplicaRef,
            checkpointedAt: "2026-05-01T00:00:00.000Z",
            createdAt: "2026-05-01T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: null,
            snapshotRef: baseSnapshotRef,
            updatedAt: "2026-05-01T00:00:00.000Z",
            userId: "member_1",
            version: "8",
          },
        }),
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "idle_shutdown_checkpoint",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .resolves.toEqual({
        snapshotRef: baseSnapshotRef,
      });

    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          attemptId: "attempt_1",
          component: "workspace",
          eventCode: "checkpoint.idle_shutdown_snapshot_skipped",
          leaseGeneration: "4",
          level: "warn",
          phase: "checkpoint",
          redactedJson: {
            checkpointReason: "idle_shutdown",
            codexResumeArchivedUnsupportedCount: 0,
            codexResumeFlushFailed: false,
            codexResumeInvalidPathCount: 1,
            codexResumeMissingRolloutCount: 0,
            codexResumeRolloutBytes: 0,
            codexResumeRolloutFileBytes: [],
            codexResumeRolloutRelHashes: [],
            codexResumeThreadCount: 1,
            continuityReason: "codex_home_missing",
            errorMessage: "Hosted Codex continuity snapshot is missing required rollout state.",
            errorName: "HostedWorkspaceSnapshotContinuityIncompleteError",
            skipReason: "codex_continuity_incomplete",
          },
          workspaceVersion: "8",
        }),
      ],
    });
  });

  it("skips idle shutdown compaction when current committed snapshot state is unavailable", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "local filesystem only\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const baseSnapshotRef = createBundleRef("e");
    const browserVaultReplicaRef = createBrowserVaultReplicaRef(baseSnapshotRef.hash);
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          browserVaultReplicaRef,
          snapshotRef: baseSnapshotRef,
          version: "8",
        }),
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "idle_shutdown_checkpoint",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .resolves.toEqual({
        snapshotRef: baseSnapshotRef,
      });

    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          eventCode: "checkpoint.idle_shutdown_snapshot_skipped",
          redactedJson: expect.objectContaining({
            checkpointReason: "idle_shutdown",
            errorName: "HostedWorkspaceIdleCompactionPreservedStateUnavailableError",
            skipReason: "preserved_state_unavailable",
          }),
        }),
      ],
    });
  });

  it("aborts idle shutdown full snapshot publication when the checkpoint lease goes stale", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await mkdir(path.join(vaultRoot, "raw", "captures"), { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    await writeFile(path.join(vaultRoot, "raw", "captures", "large.bin"), new Uint8Array(512 * 1024));
    const putArtifact = vi.fn(async () => {});
    let leaseReadCount = 0;
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
      }),
      readCurrentLease: () => {
        leaseReadCount += 1;
        return {
          attemptId: leaseReadCount > 1 ? "attempt_stale" : "attempt_1",
          leaseGeneration: "4",
          userId: "member_1",
          workspaceVersion: "8",
        };
      },
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "idle_shutdown_checkpoint",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .rejects.toThrow("Hosted runtime bridge checkpoint lease validation failed before_bundle_write.");

    expect(leaseReadCount).toBe(2);
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("compacts legacy working refs during idle shutdown without writing a new working delta", async () => {
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(baseVaultRoot, vaultRoot);
    await writeFile(path.join(baseVaultRoot, "note.md"), "committed base\n", "utf8");
    await writeFile(path.join(vaultRoot, "note.md"), "latest working state\n", "utf8");

    const artifactBundles = new Map<string, Uint8Array>();
    const legacyWorkingRef = await createLegacyWorkingSnapshotFixture({
      artifactBundles,
      baseVaultRoot,
      vaultRoot,
    });

    const putArtifact = vi.fn(async ({ bytes, sha256 }) => {
      artifactBundles.set(sha256, bytes);
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: legacyWorkingRef,
          version: "8",
        }),
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "idle_shutdown_checkpoint",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const fullRef = requireBundleRef(result.snapshotRef);
    expect(fullRef.key).toMatch(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u);
    expect(fullRef.key).not.toContain("workspace-deltas");
    expect(readHostedBundleTextFile({
      bytes: artifactBundles.get(fullRef.hash) ?? null,
      expectedKind: "vault",
      path: "note.md",
      root: "vault",
    })).toBe("latest working state\n");
    expect(putArtifact).toHaveBeenCalledWith(expect.objectContaining({
      sha256: fullRef.hash,
    }));
  });

  it("compacts legacy layered refs during idle shutdown with hot preserved inline files", async () => {
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    const hotVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-hot-workspace-"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(baseVaultRoot, hotVaultRoot, vaultRoot);
    const preservedPath = path.join("raw", "layered-preserved.txt");
    const preservedBytes = Buffer.from("layered hot preserved\n");
    await mkdir(path.join(hotVaultRoot, "raw"), { recursive: true });
    await writeFile(path.join(baseVaultRoot, "note.md"), "committed base\n", "utf8");
    await writeFile(path.join(hotVaultRoot, preservedPath), preservedBytes);
    await writeHostedWorkspaceSkippedInlineFiles({
      files: [{
        path: preservedPath,
        root: "vault",
        sha256: sha256HostedBundleHex(preservedBytes),
        size: preservedBytes.byteLength,
      }],
      vaultRoot,
    });

    const artifactBundles = new Map<string, Uint8Array>();
    const legacyLayeredRef = await createLegacyLayeredSnapshotFixture({
      artifactBundles,
      baseVaultRoot,
      hotVaultRoot,
    });
    const putArtifact = vi.fn(async ({ bytes, sha256 }) => {
      artifactBundles.set(sha256, bytes);
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: legacyLayeredRef,
          version: "8",
        }),
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "idle_shutdown_checkpoint",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const fullRef = requireBundleRef(result.snapshotRef);
    expect(fullRef.key).toMatch(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u);
    const fullBundle = artifactBundles.get(fullRef.hash) ?? null;
    expect(readHostedBundleTextFile({
      bytes: fullBundle,
      expectedKind: "vault",
      path: preservedPath,
      root: "vault",
    })).toBeNull();
    expect(listHostedBundleArtifacts({
      bytes: fullBundle,
      expectedKind: "vault",
    })).toContainEqual({
      path: preservedPath,
      ref: {
        byteSize: preservedBytes.byteLength,
        sha256: sha256HostedBundleHex(preservedBytes),
      },
      root: "vault",
    });
    expect(Buffer.from(artifactBundles.get(sha256HostedBundleHex(preservedBytes)) ?? []))
      .toEqual(preservedBytes);
  });

  it("logs hashed Codex home snapshot diagnostics when checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    cleanupPaths.push(vaultRoot, baseVaultRoot);
    const operatorHomeRoot = `${vaultRoot}-operator-home`;
    const threadId = "00000000-0000-4000-8000-000000000004";
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "cache"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions"), { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
      "{\"rollout\":\"kept\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "cache", "scratch.json"),
      "{\"cache\":true}\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", ".env"),
      "SHOULD_NOT_APPEAR=1\n",
      "utf8",
    );
    const artifactBundles = new Map<string, Uint8Array>();
    await writeFile(path.join(baseVaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const baseSnapshotRef = await createStoredBaseSnapshotRef({
      artifactBundles,
      vaultRoot: baseVaultRoot,
    });
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact: async ({ bytes, sha256 }) => {
          artifactBundles.set(sha256, bytes);
        },
        readWorkspace: async () => ({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          workspace: {
            browserVaultReplicaRef: null,
            checkpointedAt: "2026-05-01T00:00:00.000Z",
            createdAt: "2026-05-01T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: null,
            snapshotRef: baseSnapshotRef,
            updatedAt: "2026-05-01T00:00:00.000Z",
            userId: "member_1",
            version: "7",
          },
        }),
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {
        forwardedEnv: {
          HOSTED_LOG_FINGERPRINT_SECRET: "diagnostic-secret",
        },
      },
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          attemptId: "attempt_1",
          component: "workspace",
          eventCode: "workspace.codex_home_snapshot",
          leaseGeneration: "4",
          level: "info",
          phase: "checkpoint",
          redactedJson: {
            codexResumeArchivedUnsupportedCount: 0,
            codexResumeFlushFailed: false,
            codexResumeInvalidPathCount: 0,
            codexResumeMissingRolloutCount: 0,
            codexResumeRolloutBytes: "{\"rollout\":\"kept\"}\n".length,
            codexResumeRolloutFileBytes: ["{\"rollout\":\"kept\"}\n".length],
            codexResumeRolloutRelHashes: [
              expect.stringMatching(/^h1_[a-f0-9]{24}$/u),
            ],
            codexResumeThreadCount: 1,
          },
          workspaceVersion: "7",
        }),
      ],
    });
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain(threadId);
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("SHOULD_NOT_APPEAR");
  });

  it("logs redacted full checkpoint size diagnostics for idle shutdown snapshots", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const operatorHomeRoot = `${vaultRoot}-operator-home`;
    await mkdir(path.join(vaultRoot, "raw", "captures"), { recursive: true });
    await mkdir(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions"),
      { recursive: true },
    );
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "rollouts"), {
      recursive: true,
    });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
      "{\"status\":\"active\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "rollouts", "state.json"),
      "{\"state\":\"kept\"}\n",
      "utf8",
    );
    const rawArtifactBytes = 300 * 1024;
    await writeFile(
      path.join(vaultRoot, "raw", "captures", "large-video.bin"),
      new Uint8Array(rawArtifactBytes),
    );
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact: async () => {},
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {
        forwardedEnv: {
          HOSTED_LOG_FINGERPRINT_SECRET: "diagnostic-secret",
        },
      },
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const entries = writeLog.mock.calls.flatMap(([request]) => request.entries);
    const progressLog = entries.find((entry) =>
      typeof entry === "object"
      && entry !== null
      && "eventCode" in entry
      && entry.eventCode === "checkpoint.snapshot_size_progress");
    const snapshotLog = entries.find((entry) =>
      typeof entry === "object"
      && entry !== null
      && "eventCode" in entry
      && entry.eventCode === "checkpoint.snapshot_finished");
    expect(progressLog).toEqual(expect.objectContaining({
      eventCode: "checkpoint.snapshot_size_progress",
      redactedJson: expect.objectContaining({
        checkpointReason: "idle_shutdown",
        checkpointPolicy: "full",
        workspaceSnapshotExternalArtifactBytes: rawArtifactBytes,
        workspaceSnapshotExternalArtifactCount: 1,
        workspaceSnapshotFingerprintStatus: "enabled",
        workspaceSnapshotLargestFiles: expect.arrayContaining([
          expect.stringMatching(
            /^class=raw,root=vault,bytes=307200,external=1,ext=\.bin,depth=3,relHash=h1_[a-f0-9]{24}$/u,
          ),
        ]),
      }),
    }));
    expect(snapshotLog).toEqual(expect.objectContaining({
      eventCode: "checkpoint.snapshot_finished",
      redactedJson: expect.objectContaining({
        checkpointReason: "idle_shutdown",
        checkpointPolicy: "full",
        externalArtifactPutBytes: rawArtifactBytes,
        externalArtifactPutCount: 1,
        workspaceSnapshotClassSummary: expect.arrayContaining([
          `class=raw,files=1,inlineBytes=0,externalBytes=${rawArtifactBytes},externalCount=1`,
          expect.stringMatching(
            /^class=runtime-assistant,files=1,inlineBytes=\d+,externalBytes=0,externalCount=0$/u,
          ),
        ]),
        workspaceSnapshotExternalArtifactBytes: rawArtifactBytes,
        workspaceSnapshotExternalArtifactCount: 1,
        workspaceSnapshotFingerprintStatus: "enabled",
        workspaceSnapshotIncludedFileCount: 3,
        workspaceSnapshotLargestFiles: expect.arrayContaining([
          expect.stringMatching(
            /^class=raw,root=vault,bytes=307200,external=1,ext=\.bin,depth=3,relHash=h1_[a-f0-9]{24}$/u,
          ),
        ]),
        workspaceSnapshotMaxFileBytes: rawArtifactBytes,
        workspaceSnapshotMaxFileClass: "raw",
      }),
    }));
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("large-video");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("session.json");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("state.json");
  });

  it("decrypts sidecar mailbox payloads through the bridge using the sidecar payload schema", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const rootKeyId = "udrk:ingress:bridge-sidecar";
    const item = {
      createdAt: "2026-05-01T00:00:00.000Z",
      dedupeKey: "event:member-channels-sidecar",
      expiresAt: null,
      id: "mailbox_item_bridge_sidecar",
      kind: "member.channels.updated" as const,
      lane: "system" as const,
      laneSeq: "1",
      occurredAt: "2026-05-01T00:00:00.000Z",
      payloadBytes: 128,
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_bridge_sidecar",
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      updatedAt: "2026-05-01T00:00:00.000Z",
      userId: "member_bridge_sidecar",
    };
    const metadata = {
      dedupeKey: item.dedupeKey,
      itemId: item.id,
      kind: item.kind,
      lane: item.lane,
      laneSeq: item.laneSeq,
      occurredAt: item.occurredAt,
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      payloadStorage: "sidecar" as const,
      userId: item.userId,
    };
    const payload = {
      eventId: item.dedupeKey,
      kind: item.kind,
      memberChannels: {
        email: true,
        linq: false,
        telegram: false,
      },
      occurredAt: item.occurredAt,
      userId: item.userId,
    };
    const scope = buildHostedMailboxPayloadScope(metadata.payloadStorage);
    const payloadCiphertext = serializeHostedSecureBoxEnvelope(await sealHostedSecureBox({
      aad: buildHostedSecureBoxAad({
        ...buildHostedMailboxPayloadSecureBoxAad(metadata),
        domain: "ingress",
        lane: "mailbox-payload",
        scope,
        userId: item.userId,
      }),
      domain: "ingress",
      lane: "mailbox-payload",
      plaintext: new TextEncoder().encode(JSON.stringify(payload)),
      rootKey,
      rootKeyId,
      scope,
    }));
    const readEncryptionUsers: string[] = [];
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({ putArtifact: async () => {} }),
      readEncryptionEnvironment: ({ userId }) => {
        readEncryptionUsers.push(userId);
        return createHostedMailboxEncryptionEnvironmentFromIngressRoot({
          rootKey,
          rootKeyId,
        });
      },
      requireMailboxPayloadDecoder: false,
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: item.userId,
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.importItem({
      item,
      payload: {
        payloadCiphertext,
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        requestId: "request_bridge_sidecar",
        source: "sidecar",
        status: "resolved",
      },
      route: {
        action: "apply-member-channels-update",
        advanceProgress: true,
        itemRef: {
          id: item.id,
          kind: item.kind,
          lane: item.lane,
          laneSeq: item.laneSeq,
        },
        state: "route",
      },
    })).resolves.toEqual({
      reasonCode: "system_mailbox.queued",
      status: "imported",
    });
    expect(readEncryptionUsers).toEqual([item.userId]);
  });

  it("prefers mailbox payload decoders over encryption readers for system mailbox imports", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const item = createSystemMailboxItem("member_bridge_decoder_system");
    const wake = {
      eventId: item.dedupeKey,
      kind: item.kind,
      memberChannels: {
        email: true,
        linq: false,
        telegram: false,
      },
      occurredAt: item.occurredAt,
      userId: item.userId,
    };
    const decodeMailboxPayload = {
      decode: vi.fn(async () => ({
        status: "decoded" as const,
        wake,
      })),
    };
    const readEncryptionEnvironment = vi.fn(() => {
      throw new Error("legacy decrypt should not run");
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      decodeMailboxPayload,
      platform: createPlatform({ putArtifact: async () => {} }),
      readEncryptionEnvironment,
      request: createBridgeRequest(item.userId),
      runtime: {
        platformEnv: {},
      },
      vaultRoot,
    });

    await expect(options.importItem(createSystemMailboxImportItem({
      item,
      payloadCiphertext: "opaque-ciphertext",
      payloadSource: "sidecar",
    }))).resolves.toEqual({
      reasonCode: "system_mailbox.queued",
      status: "imported",
    });

    expect(decodeMailboxPayload.decode).toHaveBeenCalledWith({
      itemRef: {
        dedupeKey: item.dedupeKey,
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
        occurredAt: item.occurredAt,
        userId: item.userId,
      },
      payloadCiphertext: "opaque-ciphertext",
      payloadRequestId: "request_bridge_decoder",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      payloadSource: "sidecar",
    });
    expect(readEncryptionEnvironment).not.toHaveBeenCalled();
  });

  it("fails closed when mailbox decoding is required but no decoder is provided", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const readEncryptionEnvironment = vi.fn(() => {
      throw new Error("legacy decrypt should not be constructed");
    });

    expect(() => createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({ putArtifact: async () => {} }),
      readEncryptionEnvironment,
      requireMailboxPayloadDecoder: true,
      request: createBridgeRequest("member_bridge_decoder_required"),
      runtime: {
        platformEnv: {
          HOSTED_RUNTIME_CRYPTO_CONTEXT_PRIVATE_JWK: "legacy-jwk",
        },
      },
      vaultRoot,
    })).toThrow("Hosted mailbox payload decoder is required for this invocation.");
    expect(readEncryptionEnvironment).not.toHaveBeenCalled();
  });

  it("imports conversation mailbox items with empty platform env when a decoder is provided", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "vault.json"), "{}", "utf8");
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_bridge_decoder_conversation",
      linqMessage: {
        chatId: "chat_bridge_decoder",
        from: "+15550100000",
        isFromMe: false,
        messageId: "msg_bridge_decoder",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      occurredAt: "2026-05-01T00:00:00.000Z",
      phoneLookupKey: "phone_lookup_bridge_decoder",
      userId: "member_bridge_decoder_conversation",
    });
    const item = createConversationMailboxItem(wake);
    const decodeMailboxPayload = {
      decode: vi.fn(async () => ({
        status: "decoded" as const,
        wake,
      })),
    };
    const readEncryptionEnvironment = vi.fn(() => {
      throw new Error("legacy decrypt should not run");
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      decodeMailboxPayload,
      platform: createPlatform({ putArtifact: async () => {} }),
      readEncryptionEnvironment,
      request: createBridgeRequest(item.userId),
      runtime: {
        platformEnv: {},
      },
      vaultRoot,
    });

    await expect(options.importItem({
      item,
      payload: {
        payloadCiphertext: "opaque-conversation-ciphertext",
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        requestId: "request_bridge_decoder_conversation",
        source: "inline",
        status: "resolved",
      },
      route: {
        action: "import-conversation-message",
        advanceProgress: true,
        itemRef: {
          id: item.id,
          kind: item.kind,
          lane: item.lane,
          laneSeq: item.laneSeq,
        },
        state: "route",
      },
    })).resolves.toMatchObject({
      status: "imported",
    });

    expect(decodeMailboxPayload.decode).toHaveBeenCalledWith({
      itemRef: {
        dedupeKey: item.dedupeKey,
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
        occurredAt: item.occurredAt,
        userId: item.userId,
      },
      payloadCiphertext: "opaque-conversation-ciphertext",
      payloadRequestId: "request_bridge_decoder_conversation",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      payloadSource: "inline",
    });
    expect(readEncryptionEnvironment).not.toHaveBeenCalled();
  });

  it("captures server-owned return targets from decoded conversation wakes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const rootKeyId = "udrk:ingress:bridge-return-target";
    const wake = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "evt_bridge_return_target",
      occurredAt: "2026-05-01T00:00:00.000Z",
      telegramMessage: {
        messageId: "msg_bridge_return_target",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "thread_bridge_return_target",
      },
      userId: "member_bridge_return_target",
    });
    const item = {
      createdAt: wake.occurredAt,
      dedupeKey: wake.eventId,
      expiresAt: null,
      id: "mailbox_item_bridge_return_target",
      kind: "conversation.message" as const,
      lane: "conversation" as const,
      laneSeq: "1",
      occurredAt: wake.occurredAt,
      payloadBytes: 256,
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_bridge_return_target",
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      updatedAt: wake.occurredAt,
      userId: wake.userId,
    };
    const route = {
      action: "import-conversation-message",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    } as const;
    const payloadCiphertext = serializeHostedSecureBoxEnvelope(await sealHostedSecureBox({
      aad: buildHostedSecureBoxAad({
        ...buildHostedMailboxPayloadSecureBoxAad({
          dedupeKey: item.dedupeKey,
          itemId: item.id,
          kind: item.kind,
          lane: item.lane,
          laneSeq: item.laneSeq,
          occurredAt: item.occurredAt,
          payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
          payloadStorage: "inline",
          userId: item.userId,
        }),
        domain: "ingress",
        lane: "mailbox-payload",
        scope: buildHostedMailboxPayloadScope("inline"),
        userId: item.userId,
      }),
      domain: "ingress",
      lane: "mailbox-payload",
      plaintext: new TextEncoder().encode(JSON.stringify(wake)),
      rootKey,
      rootKeyId,
      scope: buildHostedMailboxPayloadScope("inline"),
    }));
    const recordedReturnTargets: Array<"imessage" | "telegram" | null> = [];
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({ putArtifact: async () => {} }),
      readEncryptionEnvironment: () =>
        createHostedMailboxEncryptionEnvironmentFromIngressRoot({
          rootKey,
          rootKeyId,
        }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: item.userId,
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.importItem({
      item,
      payload: {
        payloadCiphertext,
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        requestId: "request_bridge_return_target",
        source: "inline",
        status: "resolved",
      },
      route,
    }, {
      recordMessagingReturnTarget(target) {
        recordedReturnTargets.push(target);
      },
    })).rejects.toThrow();

    expect(recordedReturnTargets).toEqual(["telegram"]);
  });

});

function createBridgeRequest(userId: string) {
  return {
    attemptId: "attempt_1",
    leaseGeneration: "4",
    reason: "nudge" as const,
    userId,
    workspaceVersion: "7",
  };
}

function createWorkspaceReadResponse(input: {
  browserVaultReplicaRef?: NonNullable<HostedWorkspaceReadResponse["workspace"]>["browserVaultReplicaRef"];
  snapshotRef?: NonNullable<HostedWorkspaceReadResponse["workspace"]>["snapshotRef"];
  version?: string;
} = {}): HostedWorkspaceReadResponse {
  return {
    fetchedAt: "2026-05-01T00:00:00.000Z",
    workspace: {
      browserVaultReplicaRef: input.browserVaultReplicaRef ?? null,
      checkpointedAt: "2026-05-01T00:00:00.000Z",
      createdAt: "2026-05-01T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: input.snapshotRef ?? null,
      updatedAt: "2026-05-01T00:00:00.000Z",
      userId: "member_1",
      version: input.version ?? "7",
    },
  };
}

function createSystemMailboxItem(userId: string) {
  return {
    createdAt: "2026-05-01T00:00:00.000Z",
    dedupeKey: "event:member-channels-decoder",
    expiresAt: null,
    id: "mailbox_item_bridge_decoder",
    kind: "member.channels.updated" as const,
    lane: "system" as const,
    laneSeq: "1",
    occurredAt: "2026-05-01T00:00:00.000Z",
    payloadBytes: 128,
    payloadInlineCiphertext: null,
    payloadRef: "hosted-mailbox-payload:mailbox_item_bridge_decoder",
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: "2026-05-01T00:00:00.000Z",
    userId,
  };
}

function createConversationMailboxItem(
  wake: ReturnType<typeof buildHostedExecutionLinqConversationMessageWake>,
) {
  return {
    createdAt: wake.occurredAt,
    dedupeKey: wake.eventId,
    expiresAt: null,
    id: "mailbox_item_bridge_decoder_conversation",
    kind: "conversation.message" as const,
    lane: "conversation" as const,
    laneSeq: "1",
    occurredAt: wake.occurredAt,
    payloadBytes: 128,
    payloadInlineCiphertext: "inline",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: wake.occurredAt,
    userId: wake.userId,
  };
}

function createSystemMailboxImportItem(input: {
  item: ReturnType<typeof createSystemMailboxItem>;
  payloadCiphertext: string;
  payloadSource: "inline" | "sidecar";
}) {
  return {
    item: input.item,
    payload: {
      payloadCiphertext: input.payloadCiphertext,
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      requestId: "request_bridge_decoder",
      source: input.payloadSource,
      status: "resolved" as const,
    },
    route: {
      action: "apply-member-channels-update" as const,
      advanceProgress: true as const,
      itemRef: {
        id: input.item.id,
        kind: input.item.kind,
        lane: input.item.lane,
        laneSeq: input.item.laneSeq,
      },
      state: "route" as const,
    },
  };
}

function createCheckpointInput(
  reason: (typeof HOSTED_WORKSPACE_CHECKPOINT_REASONS)[number] = "canonical_runtime_commit",
) {
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
    reason,
    redactedStatus: {},
    state,
  };
}

async function writeExperimentMarkdown(inputVaultRoot: string, input: {
  includeProtocolFields: boolean;
  relativePath: string;
}): Promise<void> {
  await mkdir(path.dirname(path.join(inputVaultRoot, input.relativePath)), {
    recursive: true,
  });
  await writeFile(
    path.join(inputVaultRoot, input.relativePath),
    createExperimentMarkdown({ includeProtocolFields: input.includeProtocolFields }),
    "utf8",
  );
}

function createExperimentMarkdown(input: { includeProtocolFields: boolean }): string {
  const protocolFields = input.includeProtocolFields
    ? `commonsProtocolRef:
  key: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  pageRevisionId: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  runSpecRevisionId: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  testPlanId: rhr-21d
effectiveProtocolSnapshot:
  effectiveSpecHash: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  doseSignature: 15-20 min dry sauna, 3 sessions/week
  modality: dry sauna
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 15
    max: 20
  targetSessions: 9
  minimumUsefulSessions: 6
`
    : "";

  return `---
schemaVersion: murph.frontmatter.experiment.v1
docType: experiment
experimentId: exp_01KQQYJGP8XF78MBXD9R2RAG14
slug: finnish-dry-sauna-may-2026
status: active
title: Finnish Dry Sauna May 2026
startedOn: "2026-05-01"
${protocolFields}---
# Finnish Dry Sauna May 2026

## Plan

Run the sauna protocol and review the resulting biomarker trend.
`;
}

function createPlatform(input: {
  getArtifact?: (hash: string) => Promise<Uint8Array | null>;
  omitBrowserVaultReplicaPort?: boolean;
  putArtifact: (payload: { bytes: Uint8Array; sha256: string }) => Promise<void>;
  readWorkspace?: () => Promise<HostedWorkspaceReadResponse>;
  writeBrowserVaultReplica?: (payload: { replica: unknown }) => Promise<ReturnType<typeof createBrowserVaultReplicaRef>>;
  writeLog?: (request: {
    entries: readonly unknown[];
  }) => Promise<{ loggedCount: number }>;
}) {
  return {
    artifactStore: {
      get: input.getArtifact ?? (async () => null),
      put: input.putArtifact,
    },
    ...(input.omitBrowserVaultReplicaPort
      ? {}
      : {
          browserVaultReplicaPort: {
            write: input.writeBrowserVaultReplica
              ?? (async (payload: { replica: unknown }) =>
                createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(payload.replica))),
          },
        }),
    effectsPort: {
      readRawEmailMessage: async () => null,
      sendEmail: async () => undefined,
    },
    ...(input.writeLog
      ? {
          logPort: {
            write: input.writeLog,
          },
        }
      : {}),
    ...(input.readWorkspace
      ? {
          workspacePort: {
            checkpoint: async () => {
              throw new Error("Workspace checkpoint is not used by bridge snapshot tests.");
            },
            read: input.readWorkspace,
          },
        }
      : {}),
  };
}

function createBundleRef(hashCharacter: string) {
  const hash = hashCharacter.repeat(64);
  return {
    hash,
    key: `cloudflare-workspace-snapshots/${hash}.bundle`,
    size: 512,
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

async function createStoredBaseSnapshotRef(input: {
  artifactBundles: Map<string, Uint8Array>;
  vaultRoot: string;
}) {
  const snapshot = await snapshotHostedExecutionContext({
    vaultRoot: input.vaultRoot,
  });
  const hash = sha256HostedBundleHex(snapshot.bundle);
  input.artifactBundles.set(hash, snapshot.bundle);
  return {
    hash,
    key: `cloudflare-workspace-snapshots/${hash}.bundle`,
    size: snapshot.bundle.byteLength,
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

async function createLegacyWorkingSnapshotFixture(input: {
  artifactBundles: Map<string, Uint8Array>;
  baseVaultRoot: string;
  vaultRoot: string;
}) {
  const baseSnapshot = await snapshotHostedExecutionContext({
    vaultRoot: input.baseVaultRoot,
  });
  const baseSnapshotHash = sha256HostedBundleHex(baseSnapshot.bundle);
  input.artifactBundles.set(baseSnapshotHash, baseSnapshot.bundle);
  const baseSnapshotRef = {
    hash: baseSnapshotHash,
    key: `cloudflare-workspace-snapshots/${baseSnapshotHash}.bundle`,
    size: baseSnapshot.bundle.byteLength,
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  const baseManifest =
    readHostedPortableWorkspaceManifestFromBundle(baseSnapshot.bundle)
    ?? createHostedPortableWorkspaceManifestFromBundle(baseSnapshot.bundle);
  const deltaSnapshot = await snapshotHostedPortableWorkspaceDelta({
    baseManifest,
    baseSnapshotHash,
    vaultRoot: input.vaultRoot,
  });
  if (deltaSnapshot.kind !== "changed") {
    throw new Error("Expected synthetic legacy working delta fixture to change.");
  }

  const deltaSnapshotHash = sha256HostedBundleHex(deltaSnapshot.bundle);
  input.artifactBundles.set(deltaSnapshotHash, deltaSnapshot.bundle);
  return {
    base: baseSnapshotRef,
    delta: {
      hash: deltaSnapshotHash,
      key: `cloudflare-workspace-deltas/${deltaSnapshotHash}.bundle`,
      size: deltaSnapshot.bundle.byteLength,
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    schema: HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
  } as const;
}

async function createLegacyLayeredSnapshotFixture(input: {
  artifactBundles: Map<string, Uint8Array>;
  baseVaultRoot: string;
  hotVaultRoot: string;
}) {
  const baseSnapshotRef = await createStoredBaseSnapshotRef({
    artifactBundles: input.artifactBundles,
    vaultRoot: input.baseVaultRoot,
  });
  const hotSnapshot = await snapshotHostedExecutionContext({
    vaultRoot: input.hotVaultRoot,
  });
  const hotSnapshotHash = sha256HostedBundleHex(hotSnapshot.bundle);
  input.artifactBundles.set(hotSnapshotHash, hotSnapshot.bundle);
  return {
    base: baseSnapshotRef,
    hot: {
      hash: hotSnapshotHash,
      key: `cloudflare-workspace-hot-state/${hotSnapshotHash}.bundle`,
      size: hotSnapshot.bundle.byteLength,
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  } as const;
}

function readBrowserVaultReplicaSourceBundleHash(replica: unknown): string {
  if (!replica || typeof replica !== "object" || Array.isArray(replica)) {
    throw new TypeError("Browser vault replica must be an object.");
  }

  const source = (replica as Record<string, unknown>).source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Browser vault replica source must be an object.");
  }

  const sourceBundleHash = (source as Record<string, unknown>).sourceBundleHash;
  if (typeof sourceBundleHash !== "string") {
    throw new TypeError("Browser vault replica sourceBundleHash must be a string.");
  }

  return sourceBundleHash;
}

function createBrowserVaultReplicaRef(sourceBundleHash: string) {
  return {
    byteLength: 256,
    dataVersion: "workspace-bridge-test",
    generatedAt: "2026-05-01T00:00:00.000Z",
    keyId: "browser-key-workspace-bridge",
    objectKey: "browser-vault/member-test/replica.json",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:workspace-bridge",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  } as const;
}

function requireBundleRef(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("hash" in value)) {
    throw new TypeError("Expected a hosted execution bundle ref.");
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.hash !== "string"
    || typeof record.key !== "string"
    || typeof record.size !== "number"
    || typeof record.updatedAt !== "string"
  ) {
    throw new TypeError("Hosted execution bundle ref is malformed.");
  }

  return {
    hash: record.hash,
    key: record.key,
    size: record.size,
    updatedAt: record.updatedAt,
  };
}
