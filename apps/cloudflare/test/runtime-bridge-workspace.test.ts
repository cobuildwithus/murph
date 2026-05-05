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
  buildHostedMailboxPayloadScope,
  buildHostedMailboxPayloadSecureBoxAad,
  HOSTED_WORKSPACE_CHECKPOINT_REASONS,
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  type HostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
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
  it("writes full local workspace snapshots through the artifact store for maintenance checkpoints", async () => {
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

    const result = await options.createCheckpointSnapshot(createCheckpointInput("maintenance"));
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

    const result = await options.createCheckpointSnapshot(createCheckpointInput("maintenance"));

    expect(result.snapshotRef).toEqual(expect.objectContaining({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(putArtifact).toHaveBeenCalled();
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
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
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
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef.key).toMatch(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u);
    expect(writeBrowserVaultReplica).toHaveBeenCalledTimes(1);
    expect(result.browserVaultReplicaRef).toEqual(expect.objectContaining({
      sourceBundleHash: snapshotRef.hash,
    }));
  });

  it("writes full snapshots for system mailbox receipt checkpoints", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeBrowserVaultReplica = vi.fn(async (input: { replica: unknown }) =>
      createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(input.replica)));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => ({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          workspace: {
            checkpointedAt: "2026-05-01T00:00:00.000Z",
            createdAt: "2026-05-01T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: null,
            snapshotRef: createBundleRef("d"),
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
    const snapshotRef = requireBundleRef(result.snapshotRef);

    expect(snapshotRef.key).toMatch(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u);
    expect(writeBrowserVaultReplica).toHaveBeenCalledTimes(1);
    expect(result.browserVaultReplicaRef).toEqual(expect.objectContaining({
      sourceBundleHash: snapshotRef.hash,
    }));
  });

  it("pins the checkpoint snapshot policy for every supported checkpoint reason", async () => {
    const fullReasons = new Set(["maintenance", "system_mailbox_receipt"]);

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

      if (fullReasons.has(reason)) {
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

    await options.createCheckpointSnapshot(createCheckpointInput("maintenance"));

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

function createCheckpointInput(
  reason: (typeof HOSTED_WORKSPACE_CHECKPOINT_REASONS)[number] = "idle",
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

function createPlatform(input: {
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
    browserVaultReplicaPort: {
      write: input.writeBrowserVaultReplica
        ?? (async (payload: { replica: unknown }) =>
          createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(payload.replica))),
    },
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
