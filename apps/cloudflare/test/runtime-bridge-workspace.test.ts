import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  restoreHostedBundleRoots,
  restoreHostedExecutionContext,
  restoreHostedWorkspaceWorkingDelta,
  sha256HostedBundleHex,
  snapshotHostedAssistantRuntimeHotState,
  snapshotHostedExecutionContext,
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
  it("writes activation bootstrap checkpoints as full base snapshots", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "state"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "state", "activation.json"),
      "{\"activated\":true}\n",
      "utf8",
    );
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeBrowserVaultReplica = vi.fn(async (input: { replica: unknown }) =>
      createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(input.replica)));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({ version: "7" }),
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

    const result = await options.createCheckpointSnapshot(createCheckpointInput("activation_bootstrap"));
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef).toEqual(expect.objectContaining({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      key: expect.stringMatching(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u),
      size: expect.any(Number),
    }));
    expect(putArtifact).toHaveBeenCalledWith(expect.objectContaining({
      sha256: snapshotRef.hash,
    }));
    expect(writeBrowserVaultReplica).toHaveBeenCalledTimes(1);
    expect(result.browserVaultReplicaRef).toEqual(expect.objectContaining({
      sourceBundleHash: snapshotRef.hash,
    }));
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

    const result = await options.createCheckpointSnapshot(createCheckpointInput("activation_bootstrap"));
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef).toEqual(expect.objectContaining({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(putArtifact).toHaveBeenCalled();
  });

  it("keeps full checkpoint snapshots when the browser-vault replica port is unavailable", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        omitBrowserVaultReplicaPort: true,
        putArtifact,
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
    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          component: "workspace",
          eventCode: "checkpoint.optional_sidecar_degraded",
          level: "warn",
          phase: "checkpoint",
          redactedJson: expect.objectContaining({
            degradedBy: "replica-port-missing",
            sidecar: "browser-vault-replica",
          }),
        }),
      ],
    });
  });

  it("keeps full checkpoint snapshots when browser-vault replica publishing fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeBrowserVaultReplica = vi.fn(async () => {
      throw new Error("replica unavailable");
    });
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        writeBrowserVaultReplica,
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
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(writeBrowserVaultReplica).toHaveBeenCalledTimes(1);
    expect(snapshotRef.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          component: "workspace",
          eventCode: "checkpoint.optional_sidecar_degraded",
          level: "warn",
          phase: "checkpoint",
          redactedJson: expect.objectContaining({
            degradedBy: "replica-write",
            sidecar: "browser-vault-replica",
          }),
        }),
      ],
    });
  });

  it("degrades a published browser-vault replica ref for a different snapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact: async () => {},
        writeLog,
        writeBrowserVaultReplica: async () => createBrowserVaultReplicaRef("b".repeat(64)),
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

    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          component: "workspace",
          eventCode: "checkpoint.optional_sidecar_degraded",
          level: "warn",
          phase: "checkpoint",
          redactedJson: expect.objectContaining({
            degradedBy: "replica-ref-mismatch",
            sidecar: "browser-vault-replica",
          }),
        }),
      ],
    });
  });

  it("writes hot user-path snapshots with externalized Codex continuity and no browser-vault replica", async () => {
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
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions"), {
      recursive: true,
    });
    const threadId = "00000000-0000-4000-8000-000000000021";
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-ready",
        },
      }) + "\n",
      "utf8",
    );
    const operatorHomeRoot = path.join(
      path.dirname(vaultRoot),
      `${path.basename(vaultRoot)}-operator-home`,
    );
    cleanupPaths.push(operatorHomeRoot);
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions"), {
      recursive: true,
    });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06"), {
      recursive: true,
    });
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread.jsonl"),
      "{\"thread\":\"ready\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
      "{\"thread\":\"ready\"}\n",
      "utf8",
    );
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifacts: Array<{ bytes: Uint8Array; sha256: string }> = [];
    const putArtifact = vi.fn(async (payload: { bytes: Uint8Array; sha256: string }) => {
      putArtifacts.push(payload);
    });
    const writeBrowserVaultReplica = vi.fn(async (input: { replica: unknown }) =>
      createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(input.replica)));
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const baseSnapshotRef = createBundleRef("c");
    const browserVaultReplicaRef = createBrowserVaultReplicaRef(baseSnapshotRef.hash);
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
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
            version: "7",
          },
        }),
        writeBrowserVaultReplica,
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
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("import"));
    const snapshotRef = requireLayeredSnapshotRef(result.snapshotRef);
    const hotBundleBytes = putArtifacts.find((artifact) =>
      artifact.sha256 === snapshotRef.hot?.hash
    )?.bytes ?? null;
    const externalCodexArtifactPuts = putArtifacts.filter((artifact) =>
      artifact.sha256 !== snapshotRef.hot?.hash
    );

    expect(snapshotRef.base).toEqual(baseSnapshotRef);
    expect(snapshotRef.hot).toEqual(expect.objectContaining({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      key: expect.stringMatching(/^cloudflare-workspace-hot-state\/[a-f0-9]{64}\.bundle$/u),
      size: expect.any(Number),
    }));
    expect(putArtifact).toHaveBeenCalledTimes(2);
    expect(putArtifact).toHaveBeenCalledWith(expect.objectContaining({
      sha256: snapshotRef.hot?.hash,
    }));
    expect(externalCodexArtifactPuts).toHaveLength(1);
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(readHostedBundleTextFile({
      bytes: hotBundleBytes,
      expectedKind: "vault",
      path: ".runtime/operations/assistant/outbox/intent.json",
      root: "vault",
    })).toBe("{\"intent\":\"ready\"}\n");
    expect(readHostedBundleTextFile({
      bytes: hotBundleBytes,
      expectedKind: "vault",
      path: "note.md",
      root: "vault",
    })).toBeNull();
    expect(readHostedBundleTextFile({
      bytes: hotBundleBytes,
      expectedKind: "vault",
      path: ".codex-hosted/sessions/thread.jsonl",
      root: "operator-home",
    })).toBeNull();
    expect(readHostedBundleTextFile({
      bytes: hotBundleBytes,
      expectedKind: "vault",
      path: `.codex-hosted/${rolloutRelativePath}`,
      root: "operator-home",
    })).toBeNull();
    expect(listHostedBundleArtifacts({
      bytes: hotBundleBytes,
      expectedKind: "vault",
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: `.codex-hosted/${rolloutRelativePath}`,
        ref: {
          byteSize: "{\"thread\":\"ready\"}\n".length,
          sha256: externalCodexArtifactPuts[0]?.sha256,
        },
        root: "operator-home",
      }),
    ]));
    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          component: "workspace",
          eventCode: "checkpoint.snapshot_finished",
          phase: "checkpoint",
          redactedJson: expect.objectContaining({
            bundlePutCount: 1,
            checkpointPolicy: "hot",
            checkpointReason: "import",
            externalArtifactPutBytes: "{\"thread\":\"ready\"}\n".length,
            externalArtifactPutCount: 1,
            leaseCheckCount: 2,
            snapshotMode: "hot",
          }),
        }),
      ],
    });
  });

  it("reuses current hot Codex continuity artifact refs when import state is unchanged", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const operatorHomeRoot = path.join(
      path.dirname(vaultRoot),
      `${path.basename(vaultRoot)}-operator-home`,
    );
    cleanupPaths.push(operatorHomeRoot);
    const threadId = "00000000-0000-4000-8000-000000000022";
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
    const rolloutText = "{\"thread\":\"unchanged\"}\n";
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-ready",
        },
      }) + "\n",
      "utf8",
    );
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", path.dirname(rolloutRelativePath)), {
      recursive: true,
    });
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
      rolloutText,
      "utf8",
    );

    const artifactBundles = new Map<string, Uint8Array>();
    const previousHotSnapshot = await snapshotHostedAssistantRuntimeHotState({
      codexContinuityArtifactSink: async (artifact) => {
        artifactBundles.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot,
      vaultRoot,
    });
    const previousHotHash = sha256HostedBundleHex(previousHotSnapshot.bundle);
    artifactBundles.set(previousHotHash, previousHotSnapshot.bundle);
    const previousCodexArtifactRef = listHostedBundleArtifacts({
      bytes: previousHotSnapshot.bundle,
      expectedKind: "vault",
    }).find((artifact) =>
      artifact.root === "operator-home"
      && artifact.path === `.codex-hosted/${rolloutRelativePath}`
    )?.ref;
    expect(previousCodexArtifactRef).toEqual({
      byteSize: rolloutText.length,
      sha256: sha256HostedBundleHex(Buffer.from(rolloutText)),
    });

    const putArtifacts: Array<{ bytes: Uint8Array; sha256: string }> = [];
    const putArtifact = vi.fn(async (payload: { bytes: Uint8Array; sha256: string }) => {
      putArtifacts.push(payload);
      artifactBundles.set(payload.sha256, payload.bytes);
    });
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const baseSnapshotRef = createBundleRef("e");
    const previousSnapshotRef = {
      base: baseSnapshotRef,
      hot: {
        hash: previousHotHash,
        key: `cloudflare-workspace-hot-state/${previousHotHash}.bundle`,
        size: previousHotSnapshot.bundle.byteLength,
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
    } as const;
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => ({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          workspace: {
            browserVaultReplicaRef: null,
            checkpointedAt: "2026-05-01T00:00:00.000Z",
            createdAt: "2026-05-01T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: null,
            snapshotRef: previousSnapshotRef,
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
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("import"));
    const snapshotRef = requireLayeredSnapshotRef(result.snapshotRef);
    const hotBundleBytes = putArtifacts.find((artifact) =>
      artifact.sha256 === snapshotRef.hot?.hash
    )?.bytes ?? null;

    expect(snapshotRef.base).toEqual(baseSnapshotRef);
    expect(putArtifact).toHaveBeenCalledTimes(1);
    expect(putArtifacts[0]?.sha256).toBe(snapshotRef.hot?.hash);
    expect(listHostedBundleArtifacts({
      bytes: hotBundleBytes,
      expectedKind: "vault",
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: `.codex-hosted/${rolloutRelativePath}`,
        ref: previousCodexArtifactRef,
        root: "operator-home",
      }),
    ]));
    expect(readHostedBundleTextFile({
      bytes: hotBundleBytes,
      expectedKind: "vault",
      path: `.codex-hosted/${rolloutRelativePath}`,
      root: "operator-home",
    })).toBeNull();
    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          component: "workspace",
          eventCode: "checkpoint.snapshot_finished",
          phase: "checkpoint",
          redactedJson: expect.objectContaining({
            checkpointPolicy: "hot",
            checkpointReason: "import",
            externalArtifactPutCount: 0,
            snapshotMode: "hot",
          }),
        }),
      ],
    });
  });

  it("writes hot checkpoints when there is no base snapshot", async () => {
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

    const result = await options.createCheckpointSnapshot(createCheckpointInput("import"));
    const snapshotRef = requireLayeredSnapshotRef(result.snapshotRef);

    expect(snapshotRef.base).toBeNull();
    expect(snapshotRef.hot?.key).toMatch(/^cloudflare-workspace-hot-state\/[a-f0-9]{64}\.bundle$/u);
    expect(putArtifact).toHaveBeenCalledWith(expect.objectContaining({
      sha256: snapshotRef.hot?.hash,
    }));
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(writeLog).toHaveBeenCalled();
  });

  it("writes hot checkpoints without fresh browser replicas", async () => {
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
    const baseSnapshotRef = createBundleRef("g");
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
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
        writeBrowserVaultReplica,
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
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("import"));
    const snapshotRef = requireLayeredSnapshotRef(result.snapshotRef);

    expect(snapshotRef.base).toEqual(baseSnapshotRef);
    expect(snapshotRef.hot?.key).toMatch(/^cloudflare-workspace-hot-state\/[a-f0-9]{64}\.bundle$/u);
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(writeLog).toHaveBeenCalled();
  });

  it("writes hot checkpoints without carrying stale browser replicas", async () => {
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
    const baseSnapshotRef = createBundleRef("h");
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => ({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          workspace: {
            browserVaultReplicaRef: createBrowserVaultReplicaRef("i".repeat(64)),
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
        writeBrowserVaultReplica,
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
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("import"));
    const snapshotRef = requireLayeredSnapshotRef(result.snapshotRef);

    expect(snapshotRef.base).toEqual(baseSnapshotRef);
    expect(snapshotRef.hot?.key).toMatch(/^cloudflare-workspace-hot-state\/[a-f0-9]{64}\.bundle$/u);
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(writeLog).toHaveBeenCalled();
  });

  it("fails live hot checkpoints instead of falling back when current refs are unavailable", async () => {
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
        readWorkspace: async () => {
          throw new Error("workspace read unavailable");
        },
        writeBrowserVaultReplica,
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
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("import")))
      .rejects.toThrow("workspace read unavailable");
    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
    expect(writeLog).not.toHaveBeenCalled();
  });

  it("fails hot checkpoints that exceed the bounded runtime-state budget", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox", "large.json"),
      "x".repeat(17 * 1024 * 1024),
      "utf8",
    );
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeBrowserVaultReplica = vi.fn(async (input: { replica: unknown }) =>
      createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(input.replica)));
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const baseSnapshotRef = createBundleRef("e");
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => ({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          workspace: {
            browserVaultReplicaRef: createBrowserVaultReplicaRef(baseSnapshotRef.hash),
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
        writeBrowserVaultReplica,
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
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("import")))
      .rejects.toThrow("Hosted assistant runtime hot-state snapshot exceeded its budget.");
    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
  });

  it("fails hot snapshots that have dangling Codex resume state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          providerSessionId: "thread-ready",
          resumeRouteId: "route-ready",
        },
      }),
      "utf8",
    );
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const baseSnapshotRef = createBundleRef("f");
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
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
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("canonical_runtime_commit")))
      .rejects.toThrow("missing required rollout state");

    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          attemptId: "attempt_1",
          component: "workspace",
          eventCode: "workspace.codex_home_snapshot_failed",
          leaseGeneration: "4",
          level: "error",
          phase: "checkpoint",
          redactedJson: {
            checkpointReason: "canonical_runtime_commit",
            codexResumeArchivedUnsupportedCount: 0,
            codexResumeFlushFailed: false,
            codexResumeInvalidPathCount: 1,
            codexResumeMissingRolloutCount: 0,
            codexResumeRolloutBytes: 0,
            codexResumeRolloutFileBytes: [],
            codexResumeRolloutRelHashes: [],
            codexResumeThreadCount: 1,
            errorMessage: "Hosted Codex continuity snapshot is missing required rollout state.",
            errorName: "HostedWorkspaceSnapshotContinuityIncompleteError",
            snapshotMode: "hot",
          },
          workspaceVersion: "8",
        }),
      ],
    });
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("skips idle shutdown full snapshots that have dangling Codex resume state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
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
    const baseSnapshotRef = createBundleRef("d");
    const browserVaultReplicaRef = createBrowserVaultReplicaRef(baseSnapshotRef.hash);
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
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
        browserVaultReplicaRef,
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

  it("aborts idle shutdown full snapshot walks when the checkpoint lease goes stale", async () => {
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
          attemptId: leaseReadCount > 2 ? "attempt_stale" : "attempt_1",
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
      .rejects.toThrow("Hosted runtime bridge checkpoint lease validation failed before_snapshot.");

    expect(leaseReadCount).toBeGreaterThan(2);
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("writes outbox sending checkpoints as hot commits without provider continuity", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox", "sending.json"),
      "{\"intent\":\"ready\"}\n",
      "utf8",
    );
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifacts: Array<{ bytes: Uint8Array; sha256: string }> = [];
    const putArtifact = vi.fn(async (artifact: { bytes: Uint8Array; sha256: string }) => {
      putArtifacts.push(artifact);
    });
    const writeBrowserVaultReplica = vi.fn(async (input: { replica: unknown }) =>
      createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(input.replica)));
    const baseSnapshotRef = createBundleRef("f");
    const browserVaultReplicaRef = createBrowserVaultReplicaRef(baseSnapshotRef.hash);
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
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
        writeBrowserVaultReplica,
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
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("outbox_sending"));
    const snapshotRef = requireLayeredSnapshotRef(result.snapshotRef);

    expect(snapshotRef.base).toEqual(baseSnapshotRef);
    expect(snapshotRef.hot?.key).toMatch(/^cloudflare-workspace-hot-state\/[a-f0-9]{64}\.bundle$/u);
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(putArtifacts).toHaveLength(1);
    expect(readHostedBundleTextFile({
      bytes: putArtifacts[0]?.bytes ?? null,
      expectedKind: "vault",
      path: ".codex-hosted/sessions/thread.jsonl",
      root: "operator-home",
    })).toBeNull();
  });

  it("writes hot snapshots for system mailbox receipt checkpoints when base sidecars exist", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeBrowserVaultReplica = vi.fn(async (input: { replica: unknown }) =>
      createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(input.replica)));
    const baseSnapshotRef = createBundleRef("d");
    const browserVaultReplicaRef = createBrowserVaultReplicaRef(baseSnapshotRef.hash);
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
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
        writeBrowserVaultReplica,
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
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(
      createCheckpointInput("system_mailbox_receipt"),
    );
    const snapshotRef = requireLayeredSnapshotRef(result.snapshotRef);

    expect(snapshotRef.base).toEqual(baseSnapshotRef);
    expect(snapshotRef.hot?.key).toMatch(/^cloudflare-workspace-hot-state\/[a-f0-9]{64}\.bundle$/u);
    expect(putArtifact).toHaveBeenCalledWith(expect.objectContaining({
      sha256: snapshotRef.hot?.hash,
    }));
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
  });

  it("pins the checkpoint snapshot policy for every supported checkpoint reason", async () => {
    for (const reason of HOSTED_WORKSPACE_CHECKPOINT_REASONS) {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
      cleanupPaths.push(vaultRoot);
      await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox"), {
        recursive: true,
      });
      await writeFile(
        path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox", `${reason}.json`),
        "{\"intent\":\"ready\"}\n",
        "utf8",
      );
      await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
      const baseSnapshot = await snapshotHostedExecutionContext({ vaultRoot });
      const baseBundleHash = sha256HostedBundleHex(baseSnapshot.bundle);
      const artifactBundles = new Map<string, Uint8Array>([
        [baseBundleHash, baseSnapshot.bundle],
      ]);
      const putArtifact = vi.fn(async ({ bytes, sha256 }: { bytes: Uint8Array; sha256: string }) => {
        artifactBundles.set(sha256, bytes);
      });
      const writeBrowserVaultReplica = vi.fn(async (input: { replica: unknown }) =>
        createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(input.replica)));
      const baseSnapshotRef = {
        hash: baseBundleHash,
        key: `cloudflare-workspace-snapshots/${baseBundleHash}.bundle`,
        size: baseSnapshot.bundle.byteLength,
        updatedAt: "2026-05-01T00:00:00.000Z",
      };
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
          writeBrowserVaultReplica,
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
          reason: "nudge",
          userId: "member_1",
          workspaceVersion: "8",
        },
        runtime: {},
        vaultRoot,
      });

      const result = await options.createCheckpointSnapshot(createCheckpointInput(reason));

      if (expectedCheckpointSnapshotMode(reason) === "full") {
        const snapshotRef = requireBundleRef(result.snapshotRef);
        expect(snapshotRef.key).toMatch(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u);
        expect(writeBrowserVaultReplica).toHaveBeenCalledTimes(1);
        expect(result.browserVaultReplicaRef).toEqual(expect.objectContaining({
          sourceBundleHash: snapshotRef.hash,
        }));
      } else {
        const snapshotRef = requireLayeredSnapshotRef(result.snapshotRef);
        expect(snapshotRef.base).toEqual(baseSnapshotRef);
        expect(snapshotRef.hot?.key).toMatch(/^cloudflare-workspace-hot-state\/[a-f0-9]{64}\.bundle$/u);
        expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
        expect(result).not.toHaveProperty("browserVaultReplicaRef");
      }
    }
  });

  it("does not rescue direct canonical writes through live hot checkpoints", async () => {
    const nonHotRelativePath = path.join("bank", "device-sync", "observation.json");
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    const restoreRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-restore-"));
    cleanupPaths.push(baseVaultRoot, vaultRoot, restoreRoot);

    await mkdir(path.dirname(path.join(baseVaultRoot, nonHotRelativePath)), { recursive: true });
    await writeFile(path.join(baseVaultRoot, nonHotRelativePath), "{\"status\":\"old\"}\n", "utf8");
    const baseSnapshot = await snapshotHostedExecutionContext({
      vaultRoot: baseVaultRoot,
    });
    const baseBundleHash = sha256HostedBundleHex(baseSnapshot.bundle);
    const baseSnapshotRef = {
      hash: baseBundleHash,
      key: `cloudflare-workspace-snapshots/${baseBundleHash}.bundle`,
      size: baseSnapshot.bundle.byteLength,
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const browserVaultReplicaRef = createBrowserVaultReplicaRef(baseBundleHash);
    const artifactBundles = new Map<string, Uint8Array>([
      [baseBundleHash, baseSnapshot.bundle],
    ]);

    await mkdir(path.dirname(path.join(vaultRoot, nonHotRelativePath)), { recursive: true });
    await writeFile(path.join(vaultRoot, nonHotRelativePath), "{\"status\":\"latest\"}\n", "utf8");
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox", "intent.json"),
      "{\"intent\":\"ready\"}\n",
      "utf8",
    );

    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact: async ({ bytes, sha256 }) => {
          artifactBundles.set(sha256, bytes);
        },
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
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("canonical_runtime_commit"));
    const restored = await restoreCheckpointSnapshotForTest({
      artifactBundles,
      snapshotRef: result.snapshotRef,
      workspaceRoot: restoreRoot,
    });

    await expect(readFile(
      path.join(restored.vaultRoot, nonHotRelativePath),
      "utf8",
    )).resolves.toBe("{\"status\":\"old\"}\n");
  });

  it("keeps protocol-backed experiment repairs out of live hot checkpoint restore", async () => {
    const experimentRelativePath = path.join(
      "bank",
      "experiments",
      "finnish-dry-sauna-may-2026.md",
    );
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    const restoreRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-restore-"));
    cleanupPaths.push(baseVaultRoot, vaultRoot, restoreRoot);

    await writeExperimentMarkdown(baseVaultRoot, {
      includeProtocolFields: false,
      relativePath: experimentRelativePath,
    });
    const baseRawBytes = Buffer.concat([
      Buffer.from("%PDF-base-sauna\n", "utf8"),
      Buffer.alloc(300 * 1024, "s"),
    ]);
    await mkdir(path.join(baseVaultRoot, "raw", "captures"), {
      recursive: true,
    });
    await writeFile(path.join(baseVaultRoot, "raw", "captures", "sauna.pdf"), baseRawBytes);
    const artifactBundles = new Map<string, Uint8Array>();
    const baseSnapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifactBundles.set(artifact.ref.sha256, artifact.bytes);
      },
      vaultRoot: baseVaultRoot,
    });
    const baseBundleHash = sha256HostedBundleHex(baseSnapshot.bundle);
    const baseSnapshotRef = {
      hash: baseBundleHash,
      key: `cloudflare-workspace-snapshots/${baseBundleHash}.bundle`,
      size: baseSnapshot.bundle.byteLength,
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const browserVaultReplicaRef = createBrowserVaultReplicaRef(baseBundleHash);
    artifactBundles.set(baseBundleHash, baseSnapshot.bundle);

    await writeExperimentMarkdown(vaultRoot, {
      includeProtocolFields: true,
      relativePath: experimentRelativePath,
    });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "state"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "state", "turn.json"),
      "{\"status\":\"accepted\"}\n",
      "utf8",
    );

    const hotOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact: async ({ bytes, sha256 }) => {
          artifactBundles.set(sha256, bytes);
        },
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
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    const hotResult = await hotOptions.createCheckpointSnapshot(
      createCheckpointInput("assistant_runtime_commit"),
    );
    const hotSnapshotRef = requireLayeredSnapshotRef(hotResult.snapshotRef);
    expect(hotSnapshotRef.base).toEqual(baseSnapshotRef);
    expect(hotSnapshotRef.hot?.key).toMatch(/^cloudflare-workspace-hot-state\/[a-f0-9]{64}\.bundle$/u);
    expect(hotResult).not.toHaveProperty("browserVaultReplicaRef");

    const restored = await restoreCheckpointSnapshotForTest({
      artifactBundles,
      snapshotRef: hotResult.snapshotRef,
      workspaceRoot: restoreRoot,
    });
    const restoredExperiment = await readFile(
      path.join(restored.vaultRoot, experimentRelativePath),
      "utf8",
    );

    expect(restoredExperiment).not.toContain("commonsProtocolRef:");
    expect(restoredExperiment).not.toContain("effectiveProtocolSnapshot:");

    const checkpointReplicas: unknown[] = [];
    const fullOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
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
            snapshotRef: hotResult.snapshotRef,
            updatedAt: "2026-05-01T00:00:00.000Z",
            userId: "member_1",
            version: "9",
          },
        }),
        writeBrowserVaultReplica: async ({ replica }) => {
          checkpointReplicas.push(replica);
          return createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(replica));
        },
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_2",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "9",
      }),
      request: {
        attemptId: "attempt_2",
        leaseGeneration: "4",
        reason: "idle_shutdown_checkpoint",
        userId: "member_1",
        workspaceVersion: "9",
      },
      runtime: {},
      vaultRoot,
    });

    const fullResult = await fullOptions.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const fullRef = requireBundleRef(fullResult.snapshotRef);
    expect(listHostedBundleArtifacts({
      bytes: requireStoredBundle(artifactBundles, fullRef.hash),
      expectedKind: "vault",
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "raw/captures/sauna.pdf",
        root: "vault",
      }),
    ]));

    const checkpointExperiment = findBrowserVaultReplicaEntity(
      checkpointReplicas[0],
      "exp_01KQQYJGP8XF78MBXD9R2RAG14",
    );
    expect(checkpointExperiment?.attributes.commonsProtocolRef).toEqual(expect.objectContaining({
      key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    }));
    expect(checkpointExperiment?.attributes.effectiveProtocolSnapshot).toEqual(expect.objectContaining({
      effectiveSpecHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    }));
  });

  it("logs hashed Codex home snapshot diagnostics when checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
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
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact: async () => {},
        readWorkspace: async () => ({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          workspace: {
            browserVaultReplicaRef: null,
            checkpointedAt: "2026-05-01T00:00:00.000Z",
            createdAt: "2026-05-01T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: null,
            snapshotRef: createBundleRef("a"),
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

    await options.createCheckpointSnapshot(createCheckpointInput("canonical_runtime_commit"));

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

type CheckpointReason = (typeof HOSTED_WORKSPACE_CHECKPOINT_REASONS)[number];

function expectedCheckpointSnapshotMode(reason: CheckpointReason): "full" | "hot" {
  switch (reason) {
    case "activation_bootstrap":
    case "idle_shutdown":
      return "full";
    case "active_turn_acceptance":
    case "active_turn_input":
    case "assistant_runtime_commit":
    case "canonical_runtime_commit":
    case "import":
    case "outbox_receipt":
    case "outbox_sending":
    case "provider_cleanup":
    case "system_mailbox_receipt":
      return "hot";
  }

  const exhaustive: never = reason;
  return exhaustive;
}

async function restoreCheckpointSnapshotForTest(input: {
  artifactBundles: ReadonlyMap<string, Uint8Array>;
  snapshotRef: unknown;
  workspaceRoot: string;
}) {
  if (isLayeredSnapshotRefForTest(input.snapshotRef)) {
    const snapshotRef = requireLayeredSnapshotRef(input.snapshotRef);
    if (!snapshotRef.base) {
      throw new Error("Layered checkpoint snapshot is missing its base bundle ref.");
    }

    const restored = await restoreHostedExecutionContext({
      bundle: requireStoredBundle(input.artifactBundles, snapshotRef.base.hash),
      shouldRestoreArtifact: () => false,
      workspaceRoot: input.workspaceRoot,
    });
    if (snapshotRef.hot) {
      await restoreHostedBundleRoots({
        bytes: requireStoredBundle(input.artifactBundles, snapshotRef.hot.hash),
        expectedKind: "vault",
        roots: {
          "operator-home": restored.operatorHomeRoot,
          vault: restored.vaultRoot,
        },
      });
    }

    return restored;
  }

  if (isWorkingSnapshotRefForTest(input.snapshotRef)) {
    const snapshotRef = requireWorkingSnapshotRef(input.snapshotRef);
    const baseBundle = requireStoredBundle(input.artifactBundles, snapshotRef.base.hash);
    const restored = await restoreHostedExecutionContext({
      bundle: baseBundle,
      shouldRestoreArtifact: () => false,
      workspaceRoot: input.workspaceRoot,
    });
    await restoreHostedWorkspaceWorkingDelta({
      baseManifest:
        readHostedPortableWorkspaceManifestFromBundle(baseBundle)
          ?? createHostedPortableWorkspaceManifestFromBundle(baseBundle),
      baseSnapshotHash: snapshotRef.base.hash,
      bundle: requireStoredBundle(input.artifactBundles, snapshotRef.delta.hash),
      roots: {
        "operator-home": restored.operatorHomeRoot,
        vault: restored.vaultRoot,
      },
    });
    return restored;
  }

  const snapshotRef = requireBundleRef(input.snapshotRef);
  return await restoreHostedExecutionContext({
    bundle: requireStoredBundle(input.artifactBundles, snapshotRef.hash),
    workspaceRoot: input.workspaceRoot,
  });
}

function isLayeredSnapshotRefForTest(value: unknown): boolean {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && (value as Record<string, unknown>).schema === HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  );
}

function isWorkingSnapshotRefForTest(value: unknown): boolean {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && (value as Record<string, unknown>).schema === HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
  );
}

function requireStoredBundle(
  artifactBundles: ReadonlyMap<string, Uint8Array>,
  hash: string,
): Uint8Array {
  const bytes = artifactBundles.get(hash);
  if (!bytes) {
    throw new Error(`Missing test bundle for hash ${hash}.`);
  }

  return bytes;
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

function findBrowserVaultReplicaEntity(replica: unknown, id: string): {
  attributes: Record<string, unknown>;
} | null {
  if (!replica || typeof replica !== "object" || Array.isArray(replica)) {
    throw new TypeError("Browser vault replica must be an object.");
  }

  const entities = (replica as Record<string, unknown>).entities;
  if (!Array.isArray(entities)) {
    throw new TypeError("Browser vault replica entities must be an array.");
  }

  for (const entity of entities) {
    if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
      continue;
    }
    const record = entity as Record<string, unknown>;
    if (record.id !== id) {
      continue;
    }
    const attributes = record.attributes;
    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
      throw new TypeError("Browser vault replica entity attributes must be an object.");
    }
    return {
      attributes: attributes as Record<string, unknown>,
    };
  }

  return null;
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

function requireLayeredSnapshotRef(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("schema" in value)) {
    throw new TypeError("Expected a hosted execution layered snapshot ref.");
  }

  const record = value as Record<string, unknown>;
  if (record.schema !== HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA) {
    throw new TypeError("Hosted execution layered snapshot schema is malformed.");
  }

  return {
    base: record.base === null ? null : requireBundleRef(record.base),
    hot: record.hot === null ? null : requireBundleRef(record.hot),
    schema: record.schema,
  };
}

function requireWorkingSnapshotRef(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("schema" in value)) {
    throw new TypeError("Expected a hosted execution working snapshot ref.");
  }

  const record = value as Record<string, unknown>;
  if (record.schema !== HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA) {
    throw new TypeError("Hosted execution working snapshot schema is malformed.");
  }

  return {
    base: requireBundleRef(record.base),
    delta: requireBundleRef(record.delta),
    schema: record.schema,
  };
}
