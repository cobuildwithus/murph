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
  readHostedBundleTextFile,
  restoreHostedBundleRoots,
  restoreHostedExecutionContext,
  sha256HostedBundleHex,
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
  it("writes full local workspace snapshots through the artifact store for canonical runtime commit checkpoints", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeBrowserVaultReplica = vi.fn(async (input: { replica: unknown }) =>
      createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(input.replica)));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({ putArtifact, writeBrowserVaultReplica }),
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

    const result = await options.createCheckpointSnapshot(createCheckpointInput("canonical_runtime_commit"));
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
      platform: createPlatform({ putArtifact }),
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

    const result = await options.createCheckpointSnapshot(createCheckpointInput("canonical_runtime_commit"));

    expect(result.snapshotRef).toEqual(expect.objectContaining({
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

    const result = await options.createCheckpointSnapshot(createCheckpointInput("canonical_runtime_commit"));
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.browserVaultReplicaRef).toBeNull();
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

    const result = await options.createCheckpointSnapshot(createCheckpointInput("canonical_runtime_commit"));
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(writeBrowserVaultReplica).toHaveBeenCalledTimes(1);
    expect(snapshotRef.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.browserVaultReplicaRef).toBeNull();
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

  it("rejects a published browser-vault replica ref for a different snapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact: async () => {},
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

    await expect(
      options.createCheckpointSnapshot(createCheckpointInput("canonical_runtime_commit")),
    ).rejects.toThrow("published a browser-vault replica for a different snapshot");
  });

  it("writes hot user-path snapshots without external artifacts or browser-vault replicas", async () => {
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
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
      "{\"providerSessionId\":\"thread-ready\"}\n",
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
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "sessions", "thread.jsonl"),
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

    expect(snapshotRef.base).toEqual(baseSnapshotRef);
    expect(snapshotRef.hot).toEqual(expect.objectContaining({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      key: expect.stringMatching(/^cloudflare-workspace-hot-state\/[a-f0-9]{64}\.bundle$/u),
      size: expect.any(Number),
    }));
    expect(putArtifact).toHaveBeenCalledTimes(1);
    expect(putArtifact).toHaveBeenCalledWith(expect.objectContaining({
      sha256: snapshotRef.hot?.hash,
    }));
    const hotBundle = putArtifacts[0]?.bytes ?? null;
    expect(readHostedBundleTextFile({
      bytes: hotBundle,
      expectedKind: "vault",
      path: ".codex-hosted/sessions/thread.jsonl",
      root: "operator-home",
    })).toBeNull();
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
    expect(result.browserVaultReplicaRef).toEqual(browserVaultReplicaRef);
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
            externalArtifactPutCount: 0,
            leaseCheckCount: 2,
            snapshotMode: "hot-state",
          }),
        }),
      ],
    });
  });

  it("falls back to a full snapshot when hot checkpointing has no base snapshot", async () => {
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
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef.key).toMatch(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u);
    expect(putArtifact).toHaveBeenCalledWith(expect.objectContaining({
      sha256: snapshotRef.hash,
    }));
    expect(writeBrowserVaultReplica).toHaveBeenCalledTimes(1);
    expect(result.browserVaultReplicaRef).toEqual(expect.objectContaining({
      sourceBundleHash: snapshotRef.hash,
    }));
    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          component: "workspace",
          eventCode: "checkpoint.hot_state_fallback",
          level: "warn",
          phase: "checkpoint",
          redactedJson: expect.objectContaining({
            fallbackReason: "missing_base",
          }),
        }),
      ],
    });
  });

  it("falls back to a full snapshot when hot checkpointing has no browser replica", async () => {
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
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef.key).toMatch(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u);
    expect(writeBrowserVaultReplica).toHaveBeenCalledTimes(1);
    expect(result.browserVaultReplicaRef).toEqual(expect.objectContaining({
      sourceBundleHash: snapshotRef.hash,
    }));
    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          component: "workspace",
          eventCode: "checkpoint.hot_state_fallback",
          level: "warn",
          phase: "checkpoint",
          redactedJson: expect.objectContaining({
            fallbackReason: "missing_replica",
          }),
        }),
      ],
    });
  });

  it("falls back to a full snapshot when hot checkpointing has a stale browser replica", async () => {
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
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef.key).toMatch(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u);
    expect(writeBrowserVaultReplica).toHaveBeenCalledTimes(1);
    expect(result.browserVaultReplicaRef).toEqual(expect.objectContaining({
      sourceBundleHash: snapshotRef.hash,
    }));
    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          component: "workspace",
          eventCode: "checkpoint.hot_state_fallback",
          level: "warn",
          phase: "checkpoint",
          redactedJson: expect.objectContaining({
            fallbackReason: "stale_replica",
          }),
        }),
      ],
    });
  });

  it("falls back to a full snapshot when hot checkpoint current refs are unavailable", async () => {
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

    const result = await options.createCheckpointSnapshot(createCheckpointInput("import"));
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef.key).toMatch(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u);
    expect(writeBrowserVaultReplica).toHaveBeenCalledTimes(1);
    expect(result.browserVaultReplicaRef).toEqual(expect.objectContaining({
      sourceBundleHash: snapshotRef.hash,
    }));
    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          component: "workspace",
          eventCode: "checkpoint.optional_sidecar_degraded",
          level: "warn",
          phase: "checkpoint",
          redactedJson: expect.objectContaining({
            degradedBy: "current-ref-read",
            sidecar: "hot-checkpoint-base",
          }),
        }),
      ],
    });
  });

  it("falls back to a full snapshot when hot-state exceeds its budget", async () => {
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

    const result = await options.createCheckpointSnapshot(createCheckpointInput("import"));
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef.key).toMatch(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u);
    expect(writeBrowserVaultReplica).toHaveBeenCalledTimes(1);
    expect(result.browserVaultReplicaRef).toEqual(expect.objectContaining({
      sourceBundleHash: snapshotRef.hash,
    }));
    expect(writeLog).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          component: "workspace",
          eventCode: "checkpoint.hot_state_fallback",
          level: "warn",
          phase: "checkpoint",
          redactedJson: expect.objectContaining({
            fallbackReason: "budget_exceeded",
          }),
        }),
      ],
    });
  });

  it("fails full fallback snapshots that have dangling Codex resume state", async () => {
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
      .rejects.toThrow("missing required provider continuity state");

    expect(writeLog).not.toHaveBeenCalledWith(expect.objectContaining({
      entries: [
        expect.objectContaining({
          eventCode: "checkpoint.hot_state_fallback",
        }),
      ],
    }));
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("keeps outbox sending checkpoints on the hot path without provider continuity", async () => {
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
    expect(result.browserVaultReplicaRef).toEqual(browserVaultReplicaRef);
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
    expect(result.browserVaultReplicaRef).toEqual(browserVaultReplicaRef);
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
      const putArtifact = vi.fn(async () => {});
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
        expect(result.browserVaultReplicaRef).toEqual(browserVaultReplicaRef);
      }
    }
  });

  it("keeps non-hot canonical runtime writes durable across a cold restore", async () => {
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
    )).resolves.toBe("{\"status\":\"latest\"}\n");
  });

  it("logs hashed Codex home snapshot diagnostics when checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const operatorHomeRoot = `${vaultRoot}-operator-home`;
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "rollouts"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "cache"), { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "rollouts", "rollout_1.json"),
      "{\"rollout\":\"kept\"}\n",
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
            codexHomeIncludedRelHashes: [
              expect.stringMatching(/^h1_[a-f0-9]{24}$/u),
            ],
            codexHomeSnapshotCandidateCount: 3,
            codexHomeSnapshotExcludedClassSummary: expect.arrayContaining([
              "environment:1",
              "unsafe-container:1",
            ]),
            codexHomeSnapshotIncludedCount: 1,
          },
          workspaceVersion: "7",
        }),
      ],
    });
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("rollout_1");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("SHOULD_NOT_APPEAR");
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

type CheckpointReason = (typeof HOSTED_WORKSPACE_CHECKPOINT_REASONS)[number];

function expectedCheckpointSnapshotMode(reason: CheckpointReason): "full" | "hot" {
  switch (reason) {
    case "idle_shutdown":
    case "activation_bootstrap":
    case "canonical_runtime_commit":
    case "maintenance":
      return "full";
    case "active_turn_acceptance":
    case "active_turn_input":
    case "assistant_runtime_commit":
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
      get: async () => null,
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
