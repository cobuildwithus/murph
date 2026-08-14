import { execFile } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";
import { access, chmod, link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";

import {
  buildHostedWorkspaceSnapshotV2Aad,
  decodeHostedWorkspaceSnapshotV2DataKey,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  serializeHostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  getQueryProjectionStatus,
  listBloodTests,
  rebuildQueryProjection,
} from "@murphai/query";
import {
  collectHostedWorkspaceSnapshotArchivePlan,
} from "@murphai/runtime-state/node";
import {
  createEncryptedWorkspaceSnapshotFile,
  readHostedWorkspaceSnapshotProcessFailureDiagnostics,
  type EncryptedWorkspaceSnapshotFile,
  restoreEncryptedWorkspaceSnapshot,
  restoreEncryptedWorkspaceSnapshotFromEncryptedStream,
  waitForHostedWorkspaceSnapshotProcessPipe,
} from "../src/workspace-snapshot-local.js";

const execFileAsync = promisify(execFile);

describe("workspace snapshot process pipes", () => {
  it("ignores premature stream closes when the child commands exit cleanly", async () => {
    await expect(waitForHostedWorkspaceSnapshotProcessPipe(
      Promise.reject(Object.assign(new Error("Premature close"), {
        code: "ERR_STREAM_PREMATURE_CLOSE",
      })),
      [Promise.resolve(), Promise.resolve()],
    )).resolves.toBeUndefined();
  });

  it("keeps the child command failure when a premature stream close accompanies it", async () => {
    const processError = new Error("Hosted workspace snapshot zstd command failed with exit code 1.");
    const processExit = Promise.reject(processError);
    processExit.catch(() => undefined);

    await expect(waitForHostedWorkspaceSnapshotProcessPipe(
      Promise.reject(Object.assign(new Error("Premature close"), {
        code: "ERR_STREAM_PREMATURE_CLOSE",
      })),
      [Promise.resolve(), processExit],
    )).rejects.toBe(processError);
  });

  it("does not hide ordinary stream errors", async () => {
    await expect(waitForHostedWorkspaceSnapshotProcessPipe(
      Promise.reject(new Error("snapshot stream transform failed")),
      [Promise.resolve(), Promise.resolve()],
    )).rejects.toThrow("snapshot stream transform failed");
  });
});

describe("workspace snapshot local restore", () => {
  it("round-trips selected portable workspace state and Codex continuity", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
    const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
    const restoredDurableRoot = path.join(tempRoot, "restored", "durable");
    const providerSessionId = "00000000-0000-4000-8000-000000000071";
    const rolloutRelativePath =
      `sessions/2026/05/20/rollout-2026-05-20T01-02-03-${providerSessionId}.jsonl`;
    const snapshotId = "snapshot_round_trip";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_round_trip.snapshot.enc";
    const userId = "member_123";
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const retainedDeviceSyncWakeState = {
      schema: "murph.hosted-system-mailbox-state.v1",
      schemaVersion: 1,
      value: {
        pending: [{
          attemptCount: 1,
          itemId: "mailbox_item_device_sync_exact_retry",
          lastAttemptAt: "2026-05-20T01:02:03.000Z",
          lastErrorCode: null,
          lastErrorMessage: null,
          mailboxDedupeKey: "device-sync.wake:exact-retry",
          mailboxLaneSeq: "7",
          nextAttemptAt: "2026-05-20T01:02:18.000Z",
          occurredAt: "2026-05-20T01:02:03.000Z",
          postCheckpointRecord: null,
          requestId: null,
          routeAction: "run-device-sync-wake",
          status: "pending",
          wake: {
            connectionId: "dsc_exact_retry",
            eventId: "device-sync.wake:exact-retry",
            expectedConnectedAt: "2026-05-20T01:02:03.000Z",
            hint: {
              jobs: [{
                dedupeKey: "initial-history",
                kind: "resource",
                maxAttempts: 5,
                payload: {
                  windowEnd: "2026-05-20T01:02:03.000Z",
                  windowStart: "2025-11-21T01:02:03.000Z",
                },
              }],
            },
            kind: "device-sync.wake",
            occurredAt: "2026-05-20T01:02:03.000Z",
            provider: "oura",
            reason: "connected",
            userId,
          },
        }],
      },
    };

    try {
      await mkdir(path.join(sourceVaultRoot, ".runtime", "operations", "assistant", "sessions"), {
        recursive: true,
      });
      await mkdir(path.join(sourceVaultRoot, ".runtime", "operations", "device-sync"), {
        recursive: true,
      });
      await mkdir(path.join(sourceVaultRoot, ".runtime", "projections"), { recursive: true });
      await mkdir(path.join(sourceVaultRoot, ".runtime", "cache"), { recursive: true });
      await mkdir(path.join(sourceVaultRoot, ".git"), { recursive: true });
      await mkdir(path.join(sourceVaultRoot, "derived", "vault-share"), { recursive: true });
      await mkdir(path.join(sourceVaultRoot, "derived", "vault-share-notes"), { recursive: true });
      await mkdir(path.join(sourceVaultRoot, "vault-share"), { recursive: true });
      await mkdir(path.join(sourceOperatorHomeRoot, ".codex-hosted", path.dirname(rolloutRelativePath)), {
        recursive: true,
      });
      await mkdir(path.join(sourceOperatorHomeRoot, ".codex-hosted", "cache"), { recursive: true });
      await writeFile(path.join(sourceVaultRoot, "note.md"), "selected workspace\n", "utf8");
      await writeFile(
        path.join(sourceVaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
        JSON.stringify({
          resumeState: {
            codexRolloutRelativePath: rolloutRelativePath,
            providerSessionId,
            resumeRouteId: "route-ready",
          },
        }) + "\n",
        "utf8",
      );
      await writeFile(
        path.join(
          sourceVaultRoot,
          ".runtime",
          "operations",
          "assistant",
          "hosted-system-mailbox.json",
        ),
        `${JSON.stringify(retainedDeviceSyncWakeState)}\n`,
        "utf8",
      );
      await writeFile(
        path.join(sourceVaultRoot, ".runtime", "operations", "device-sync", "state.sqlite"),
        "machine-local device sync execution cache\n",
        "utf8",
      );
      await writeFile(path.join(sourceVaultRoot, ".runtime", "projections", "query.sqlite"), "projection\n", "utf8");
      await writeFile(path.join(sourceVaultRoot, ".runtime", "projections", "query.sqlite-shm"), "projection-shm\n", "utf8");
      await writeFile(path.join(sourceVaultRoot, ".runtime", "projections", "query.sqlite-wal"), "projection-wal\n", "utf8");
      await writeFile(path.join(sourceVaultRoot, ".runtime", "projections", "inboxd.sqlite"), "other-projection\n", "utf8");
      await writeFile(path.join(sourceVaultRoot, ".runtime", "cache", "cache.txt"), "cache\n", "utf8");
      await writeFile(path.join(sourceVaultRoot, ".git", "config"), "git config\n", "utf8");
      await writeFile(
        path.join(sourceVaultRoot, "derived", "vault-share", "projections.json"),
        "legacy derived share\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceVaultRoot, "vault-share", "projections.json"),
        "abandoned direct-child share\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceVaultRoot, "derived", "vault-share-notes", "keep.md"),
        "unrelated sibling\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceOperatorHomeRoot, ".codex-hosted", rolloutRelativePath),
        "{\"type\":\"rollout\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceOperatorHomeRoot, ".codex-hosted", "cache", "runtime-cache.txt"),
        "runtime cache\n",
        "utf8",
      );

      const aad = buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      });
      const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot: sourceDurableRoot,
        operatorHomeRoot: sourceOperatorHomeRoot,
        vaultRoot: sourceVaultRoot,
      });
      expect(archivePlan.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          archivePath: "vault/.runtime/operations/assistant/hosted-system-mailbox.json",
          kind: "file",
        }),
        expect.objectContaining({
          archivePath: "vault/derived/vault-share/projections.json",
          kind: "file",
        }),
        expect.objectContaining({
          archivePath: "vault/vault-share/projections.json",
          kind: "file",
        }),
      ]));
      expect(archivePlan.entries).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          archivePath: "vault/.runtime/operations/device-sync/state.sqlite",
        }),
      ]));
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: archivePlan.entries,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: sourceDurableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      });
      const ref = createHostedWorkspaceSnapshotTestRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      });

      const restoreTimings = await restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: restoredDurableRoot,
        encryptedFilePath: encrypted.encryptedFilePath,
        ref,
      });

      for (const key of [
        "decryptMs",
        "archiveExtractMs",
        "durableRootReplaceMs",
        "cleanupMs",
        "extractMs",
      ] as const) {
        expect(typeof restoreTimings[key]).toBe("number");
        expect(Number.isFinite(restoreTimings[key])).toBe(true);
        expect(restoreTimings[key]).toBeGreaterThanOrEqual(0);
      }

      const restoredVaultRoot = path.join(restoredDurableRoot, "vault");
      const restoredOperatorHomeRoot = path.join(restoredDurableRoot, "home");
      await expect(readFile(path.join(restoredVaultRoot, "note.md"), "utf8"))
        .resolves.toBe("selected workspace\n");
      await expect(readFile(
        path.join(
          restoredVaultRoot,
          ".runtime",
          "operations",
          "assistant",
          "hosted-system-mailbox.json",
        ),
        "utf8",
      )).resolves.toBe(`${JSON.stringify(retainedDeviceSyncWakeState)}\n`);
      await expect(access(
        path.join(restoredVaultRoot, ".runtime", "operations", "device-sync", "state.sqlite"),
      )).rejects.toThrow();
      await expect(readFile(
        path.join(restoredVaultRoot, "derived", "vault-share-notes", "keep.md"),
        "utf8",
      )).resolves.toBe("unrelated sibling\n");
      await expect(readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", rolloutRelativePath), "utf8"))
        .resolves.toBe("{\"type\":\"rollout\"}\n");
      await expect(access(path.join(restoredVaultRoot, "derived", "vault-share")))
        .rejects.toThrow();
      await expect(access(path.join(restoredVaultRoot, "vault-share")))
        .rejects.toThrow();
      await expect(readFile(path.join(restoredVaultRoot, ".runtime", "projections", "query.sqlite"), "utf8"))
        .resolves.toBe("projection\n");
      await expect(readFile(path.join(restoredVaultRoot, ".runtime", "projections", "query.sqlite-shm"), "utf8"))
        .resolves.toBe("projection-shm\n");
      await expect(readFile(path.join(restoredVaultRoot, ".runtime", "projections", "query.sqlite-wal"), "utf8"))
        .resolves.toBe("projection-wal\n");
      await expect(access(path.join(restoredVaultRoot, ".runtime", "projections", "inboxd.sqlite")))
        .rejects.toThrow();
      await expect(access(path.join(restoredVaultRoot, ".runtime", "cache", "cache.txt")))
        .rejects.toThrow();
      await expect(access(path.join(restoredVaultRoot, ".git", "config"))).rejects.toThrow();
      await expect(access(path.join(restoredOperatorHomeRoot, ".codex-hosted", "cache", "runtime-cache.txt")))
        .rejects.toThrow();
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("keeps a real fractional-mtime query projection fresh across encrypted restore", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-query-projection-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
    const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
    const restoredDurableRoot = path.join(tempRoot, "restored", "durable");
    const vaultManifestPath = path.join(sourceVaultRoot, "vault.json");
    const eventPath = path.join(sourceVaultRoot, "ledger", "events", "2026", "2026-04.jsonl");
    const snapshotId = "snapshot_query_projection_fresh";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_query_projection_fresh.snapshot.enc";
    const userId = "member_123";
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 41);

    try {
      await mkdir(path.dirname(eventPath), { recursive: true });
      await mkdir(sourceOperatorHomeRoot, { recursive: true });
      await writeFile(
        vaultManifestPath,
        `${JSON.stringify({
          formatVersion: CURRENT_VAULT_FORMAT_VERSION,
          vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4B",
          createdAt: "2026-04-07T00:00:00.000Z",
          title: "Query projection restore fixture",
          timezone: "UTC",
        })}\n`,
        "utf8",
      );
      await writeFile(
        eventPath,
        `${JSON.stringify({
          schemaVersion: "murph.event.v1",
          id: "evt_01K72NW6HB9Y8M6W6VNZG4TF4M",
          kind: "test",
          occurredAt: "2026-04-07T08:15:00.000Z",
          recordedAt: "2026-04-07T08:15:00.000Z",
          dayKey: "2026-04-07",
          source: "import",
          title: "Cardiometabolic panel",
          testCategory: "blood",
          testName: "cardiometabolic_panel",
          resultStatus: "normal",
          results: [{
            analyte: "Apolipoprotein B",
            biomarkerSlug: "apob",
            value: 87,
            unit: "mg/dL",
            flag: "normal",
          }],
        })}\n`,
        "utf8",
      );

      const fractionalMtimeSeconds = 1_777_000_000.123;
      await utimes(vaultManifestPath, fractionalMtimeSeconds, fractionalMtimeSeconds);
      await utimes(eventPath, fractionalMtimeSeconds + 0.25, fractionalMtimeSeconds + 0.25);
      expect((await stat(eventPath)).mtimeMs % 1_000).not.toBe(0);

      await rebuildQueryProjection(sourceVaultRoot);
      const sourceStatus = await getQueryProjectionStatus(sourceVaultRoot);
      expect(sourceStatus?.fresh).toBe(true);

      const aad = buildHostedWorkspaceSnapshotV2Aad({ objectKey, snapshotId, userId });
      const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot: sourceDurableRoot,
        operatorHomeRoot: sourceOperatorHomeRoot,
        vaultRoot: sourceVaultRoot,
      });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: archivePlan.entries,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: sourceDurableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 30))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      });
      const ref = createHostedWorkspaceSnapshotTestRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      });

      await restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: restoredDurableRoot,
        encryptedFilePath: encrypted.encryptedFilePath,
        ref,
      });

      const restoredVaultRoot = path.join(restoredDurableRoot, "vault");
      const restoredStatus = await getQueryProjectionStatus(restoredVaultRoot);
      expect(restoredStatus?.fresh).toBe(true);
      expect(restoredStatus?.builtAt).toBe(sourceStatus?.builtAt);

      const projectionPath = path.join(restoredVaultRoot, ".runtime", "projections", "query.sqlite");
      const projectionMtimeBefore = (await stat(projectionPath)).mtimeMs;
      const records = await listBloodTests(restoredVaultRoot, {
        limit: 1,
        text: "Apolipoprotein B",
      });
      expect(records).toHaveLength(1);
      expect(records[0]?.data.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ analyte: "Apolipoprotein B", value: 87 }),
      ]));
      expect((await stat(projectionPath)).mtimeMs).toBe(projectionMtimeBefore);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("keeps restore compatible with older ustar workspace archives", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-legacy-ustar-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const restoredDurableRoot = path.join(tempRoot, "restored", "durable");
    const notePath = path.join(sourceDurableRoot, "vault", "note.md");
    const snapshotId = "snapshot_legacy_ustar";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_legacy_ustar.snapshot.enc";
    const userId = "member_123";
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 61);

    try {
      await mkdir(path.dirname(notePath), { recursive: true });
      await writeFile(notePath, "legacy workspace archive\n", "utf8");
      const aad = buildHostedWorkspaceSnapshotV2Aad({ objectKey, snapshotId, userId });
      const encrypted = await createLegacyUstarEncryptedSnapshot({
        aad,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: sourceDurableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 50))
          .toString("base64url"),
        notePath,
        outputDir: path.join(tempRoot, "scratch"),
      });
      const ref = createHostedWorkspaceSnapshotTestRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      });

      await restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: restoredDurableRoot,
        encryptedFilePath: encrypted.encryptedFilePath,
        ref,
      });

      await expect(readFile(path.join(restoredDurableRoot, "vault", "note.md"), "utf8"))
        .resolves.toBe("legacy workspace archive\n");
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("round-trips ordinary planned paths with spaces and long names", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
    const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
    const restoredDurableRoot = path.join(tempRoot, "restored", "durable");
    const longFileName =
      "2026-06-21 path with spaces and enough length to exercise tar list handling.md";
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 21);
    const snapshotId = "snapshot_ordinary_paths";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_ordinary_paths.snapshot.enc";
    const userId = "member_123";

    try {
      await mkdir(path.join(sourceVaultRoot, "journal", "2026"), { recursive: true });
      await mkdir(sourceOperatorHomeRoot, { recursive: true });
      await writeFile(
        path.join(sourceVaultRoot, "journal", "2026", longFileName),
        "ordinary planned path\n",
        "utf8",
      );
      const aad = buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      });
      const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot: sourceDurableRoot,
        operatorHomeRoot: sourceOperatorHomeRoot,
        vaultRoot: sourceVaultRoot,
      });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: archivePlan.entries,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: sourceDurableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 30))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      });
      const ref = createHostedWorkspaceSnapshotTestRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      });

      await restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: restoredDurableRoot,
        encryptedFilePath: encrypted.encryptedFilePath,
        ref,
      });

      await expect(readFile(
        path.join(restoredDurableRoot, "vault", "journal", "2026", longFileName),
        "utf8",
      )).resolves.toBe("ordinary planned path\n");
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("rejects snapshots at the encrypted size limit before preparing restore roots", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-limit-test-"));
    const durableRoot = path.join(tempRoot, "restored", "durable");
    const encryptedFilePath = path.join(tempRoot, "snapshot.enc");
    const snapshotId = "snapshot_size_limit";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_size_limit.snapshot.enc";
    const userId = "member_123";
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId,
      userId,
    });
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await writeFile(encryptedFilePath, "");
      await truncate(encryptedFilePath, HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES);

      const ref: HostedWorkspaceSnapshotV2Ref = {
        archive: {
          compression: "zstd",
          encryptedByteSize: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
          encryptedObjectSha256: "0".repeat(64),
          fileCount: 0,
          format: "tar",
          plaintextArchiveSha256: "0".repeat(64),
          totalPlainBytes: 0,
        },
        createdAt: "2026-05-20T00:00:00.000Z",
        encryption: {
          aad,
          ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
            .toString("base64url"),
          rootKeyId: "root_key_test",
          scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
          wrappedDataKey: "wrapped_data_key_test",
        },
        objectKey,
        schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
        snapshotId,
        upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
        userId,
      };

      await expect(restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        encryptedFilePath,
        ref,
      })).rejects.toThrow("Hosted workspace snapshot exceeds the single-part size limit.");
      await expect(access(durableRoot)).rejects.toThrow();
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("rejects snapshots at the total plain size limit before preparing restore roots", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-plain-limit-test-"));
    const durableRoot = path.join(tempRoot, "restored", "durable");
    const encryptedFilePath = path.join(tempRoot, "snapshot.enc");
    const snapshotId = "snapshot_plain_size_limit";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_plain_size_limit.snapshot.enc";
    const userId = "member_123";
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId,
      userId,
    });
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await writeFile(encryptedFilePath, Buffer.alloc(17));

      const ref: HostedWorkspaceSnapshotV2Ref = {
        archive: {
          compression: "zstd",
          encryptedByteSize: 17,
          encryptedObjectSha256: "0".repeat(64),
          fileCount: 1,
          format: "tar",
          plaintextArchiveSha256: "0".repeat(64),
          totalPlainBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
        },
        createdAt: "2026-05-20T00:00:00.000Z",
        encryption: {
          aad,
          ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
            .toString("base64url"),
          rootKeyId: "root_key_test",
          scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
          wrappedDataKey: "wrapped_data_key_test",
        },
        objectKey,
        schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
        snapshotId,
        upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
        userId,
      };

      await expect(restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        encryptedFilePath,
        ref,
      })).rejects.toThrow("Hosted workspace snapshot exceeds the total plain size limit.");
      await expect(access(durableRoot)).rejects.toThrow();
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("rejects snapshot creation at the total plain size limit before archiving", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-create-plain-limit-test-"));
    const durableRoot = path.join(tempRoot, "source", "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const largeFilePath = path.join(vaultRoot, "large.bin");
    const outputDir = path.join(tempRoot, "scratch");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const snapshotId = "snapshot_create_plain_size_limit";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_create_plain_size_limit.snapshot.enc";
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId,
      userId: "member_123",
    });

    try {
      await mkdir(vaultRoot, { mode: 0o700, recursive: true });
      await writeFile(largeFilePath, "");
      await truncate(largeFilePath, HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES);

      await expect(createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: [{
          absolutePath: largeFilePath,
          archivePath: "vault/large.bin",
          kind: "file",
        }],
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
        outputDir,
      })).rejects.toThrow("Hosted workspace snapshot exceeds the total plain size limit.");
      await expect(readdir(outputDir)).resolves.toEqual([]);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("preserves snapshot construction cancellation and removes temporary output", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-abort-test-"));
    const durableRoot = path.join(tempRoot, "source", "durable");
    const outputDir = path.join(tempRoot, "scratch");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const snapshotId = "snapshot_construction_abort";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_construction_abort.snapshot.enc";
    const abortController = new AbortController();
    const abortReason = new Error("foreground wake interrupted snapshot construction");

    try {
      const construction = createEncryptedWorkspaceSnapshotFile({
        aad: buildHostedWorkspaceSnapshotV2Aad({
          objectKey,
          snapshotId,
          userId: "member_123",
        }),
        archiveEntries: [],
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
        outputDir,
        signal: abortController.signal,
      });

      abortController.abort(abortReason);

      await expect(construction).rejects.toBe(abortReason);
      await expect(readdir(outputDir)).resolves.toEqual([]);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("preserves a child-process failure when a wake arrives during process cleanup", async () => {
    const tempRoot = await mkdtemp(path.join(
      tmpdir(),
      "workspace-snapshot-local-process-race-test-",
    ));
    const durableRoot = path.join(tempRoot, "source", "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const notePath = path.join(vaultRoot, "note.md");
    const outputDir = path.join(tempRoot, "scratch");
    const wrapperDir = path.join(tempRoot, "bin");
    const zstdReadyPath = path.join(tempRoot, "zstd-ready");
    const cleanupMarkerPath = path.join(tempRoot, "zstd-cleanup-started");
    const cleanupReleasePath = path.join(tempRoot, "zstd-cleanup-release");
    const originalPath = process.env.PATH;
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const snapshotId = "snapshot_process_failure_wake_race";
    const objectKey =
      "users/hsn_test/workspace-snapshots/snapshot_process_failure_wake_race.snapshot.enc";
    const abortController = new AbortController();
    const wakeError = new Error("runtime wake arrived during process cleanup");

    try {
      await mkdir(vaultRoot, { recursive: true });
      await mkdir(wrapperDir, { recursive: true });
      await writeFile(notePath, "note\n", "utf8");
      await writeFile(path.join(wrapperDir, "tar"), `#!/bin/sh
while [ ! -e "\${MURPH_TEST_ZSTD_READY:?}" ]; do sleep 0.01; done
printf '%s\\n' 'intentional tar failure' >&2
exit 17
`, { mode: 0o700 });
      await writeFile(path.join(wrapperDir, "zstd"), `#!/bin/sh
trap 'touch "\${MURPH_TEST_ZSTD_CLEANUP_MARKER:?}"; while [ ! -e "\${MURPH_TEST_ZSTD_CLEANUP_RELEASE:?}" ]; do sleep 0.01; done; exit 143' TERM
touch "\${MURPH_TEST_ZSTD_READY:?}"
while :; do sleep 0.01; done
`, { mode: 0o700 });
      process.env.MURPH_TEST_ZSTD_READY = zstdReadyPath;
      process.env.MURPH_TEST_ZSTD_CLEANUP_MARKER = cleanupMarkerPath;
      process.env.MURPH_TEST_ZSTD_CLEANUP_RELEASE = cleanupReleasePath;
      process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath ?? ""}`;

      const construction = createEncryptedWorkspaceSnapshotFile({
        aad: buildHostedWorkspaceSnapshotV2Aad({
          objectKey,
          snapshotId,
          userId: "member_123",
        }),
        archiveEntries: [{
          absolutePath: notePath,
          archivePath: "vault/note.md",
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
      construction.catch(() => undefined);
      await vi.waitFor(async () => {
        await expect(access(cleanupMarkerPath)).resolves.toBeUndefined();
      }, { timeout: 5_000 });

      abortController.abort(wakeError);
      await writeFile(cleanupReleasePath, "release\n", "utf8");

      try {
        await construction;
        throw new Error("Snapshot construction unexpectedly succeeded.");
      } catch (error) {
        expect(error).not.toBe(wakeError);
        expect(readHostedWorkspaceSnapshotProcessFailureDiagnostics(error)).toMatchObject({
          exitCode: 17,
          label: "tar",
        });
      }
      await expect(readdir(outputDir)).resolves.toEqual([]);
    } finally {
      process.env.PATH = originalPath;
      delete process.env.MURPH_TEST_ZSTD_READY;
      delete process.env.MURPH_TEST_ZSTD_CLEANUP_MARKER;
      delete process.env.MURPH_TEST_ZSTD_CLEANUP_RELEASE;
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("restores encrypted snapshots from an encrypted byte stream", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-stream-test-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
    const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
    const restoredDurableRoot = path.join(tempRoot, "restored", "durable");
    const snapshotId = "snapshot_stream_restore";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_stream_restore.snapshot.enc";
    const userId = "member_123";
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await mkdir(sourceVaultRoot, { recursive: true });
      await mkdir(sourceOperatorHomeRoot, { recursive: true });
      await writeFile(path.join(sourceVaultRoot, "note.md"), "stream restored\n", "utf8");

      const aad = buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      });
      const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot: sourceDurableRoot,
        operatorHomeRoot: sourceOperatorHomeRoot,
        vaultRoot: sourceVaultRoot,
      });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: archivePlan.entries,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: sourceDurableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      });
      const encryptedBytes = await readFile(encrypted.encryptedFilePath);
      const ref = createHostedWorkspaceSnapshotTestRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      });

      const restoreTimings = await restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: restoredDurableRoot,
        encryptedStream: streamEncryptedChunks(splitEncryptedSnapshotAcrossAuthTagBoundary(encryptedBytes)),
        ref,
      });

      expect(typeof restoreTimings.decryptMs).toBe("number");
      expect(Number.isFinite(restoreTimings.decryptMs)).toBe(true);
      await expect(readFile(path.join(restoredDurableRoot, "vault", "note.md"), "utf8"))
        .resolves.toBe("stream restored\n");
      await expect(readdir(path.dirname(restoredDurableRoot))).resolves.toEqual(["durable"]);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("rejects encrypted stream auth failures without replacing durable state", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-stream-auth-test-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
    const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
    const durableRoot = path.join(tempRoot, "durable");
    const existingDurableFile = path.join(durableRoot, "existing.txt");
    const snapshotId = "snapshot_stream_auth_fail";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_stream_auth_fail.snapshot.enc";
    const userId = "member_123";
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await mkdir(sourceVaultRoot, { recursive: true });
      await mkdir(sourceOperatorHomeRoot, { recursive: true });
      await writeFile(path.join(sourceVaultRoot, "note.md"), "should not restore\n", "utf8");
      await mkdir(durableRoot, { mode: 0o700, recursive: true });
      await writeFile(existingDurableFile, "existing durable root\n", { mode: 0o600 });

      const aad = buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      });
      const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot: sourceDurableRoot,
        operatorHomeRoot: sourceOperatorHomeRoot,
        vaultRoot: sourceVaultRoot,
      });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: archivePlan.entries,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: sourceDurableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      });
      const encryptedBytes = await readFile(encrypted.encryptedFilePath);
      const tamperedEncryptedBytes = Buffer.from(encryptedBytes);
      tamperedEncryptedBytes[tamperedEncryptedBytes.byteLength - 1] ^= 0xff;
      const ref = createHostedWorkspaceSnapshotTestRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      });

      await expect(restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        encryptedStream: streamEncryptedChunks([
          tamperedEncryptedBytes.subarray(0, tamperedEncryptedBytes.byteLength - 2),
          tamperedEncryptedBytes.subarray(tamperedEncryptedBytes.byteLength - 2),
        ]),
        ref,
      })).rejects.toThrow();

      await expect(readFile(existingDurableFile, "utf8")).resolves.toBe("existing durable root\n");
      await expect(access(path.join(durableRoot, "vault", "note.md"))).rejects.toThrow();
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("rejects selected archive entries that traverse symlink parents or path aliases", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const outputDir = path.join(tempRoot, "scratch");
    const externalRoot = path.join(tempRoot, "external");
    const snapshotId = "snapshot_selected_entry_reject";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_selected_entry_reject.snapshot.enc";
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await mkdir(path.join(durableRoot, "vault"), { recursive: true });
      await mkdir(externalRoot, { recursive: true });
      await writeFile(path.join(durableRoot, "vault", "note.md"), "note\n", "utf8");
      await writeFile(path.join(durableRoot, "vault", ".env"), "placeholder=true\n", "utf8");
      await writeFile(path.join(externalRoot, "file.txt"), "external\n", "utf8");
      await symlink(externalRoot, path.join(durableRoot, "vault", "link"));

      const baseInput = {
        aad,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir,
      };
      await expect(createEncryptedWorkspaceSnapshotFile({
        ...baseInput,
        archiveEntries: [{
          absolutePath: path.join(durableRoot, "vault", "link", "file.txt"),
          archivePath: "vault/link/file.txt",
          kind: "file",
        }],
      })).rejects.toThrow("Hosted workspace snapshot durable root contains symlinks.");
      await expect(createEncryptedWorkspaceSnapshotFile({
        ...baseInput,
        archiveEntries: [{
          absolutePath: path.join(durableRoot, "vault", "note.md"),
          archivePath: "vault/./note.md",
          kind: "file",
        }],
      })).rejects.toThrow("Hosted workspace snapshot path is unsafe.");

      await expect(createEncryptedWorkspaceSnapshotFile({
        ...baseInput,
        archiveEntries: [
          {
            absolutePath: path.join(durableRoot, "vault", "note.md"),
            archivePath: "vault/note.md",
            kind: "file",
          },
          {
            absolutePath: path.join(durableRoot, "vault", "note.md"),
            archivePath: "./vault//note.md",
            kind: "file",
          },
        ],
      })).rejects.toThrow("Hosted workspace snapshot archive contains duplicate entries.");
      await expect(createEncryptedWorkspaceSnapshotFile({
        ...baseInput,
        archiveEntries: [{
          absolutePath: path.join(durableRoot, "vault", ".env"),
          archivePath: "vault/.env",
          kind: "file",
        }],
      })).rejects.toThrow("Hosted workspace snapshot durable root contains environment files.");

      const hardlinkPath = path.join(durableRoot, "vault", "note-hardlink.md");
      await link(path.join(durableRoot, "vault", "note.md"), hardlinkPath);
      await expect(createEncryptedWorkspaceSnapshotFile({
        ...baseInput,
        archiveEntries: [{
          absolutePath: hardlinkPath,
          archivePath: "vault/note-hardlink.md",
          kind: "file",
        }],
      })).rejects.toThrow("Hosted workspace snapshot durable root contains hardlinks.");

      const fifoPath = path.join(durableRoot, "vault", "snapshot.fifo");
      await execFileAsync("mkfifo", [fifoPath]);
      await expect(createEncryptedWorkspaceSnapshotFile({
        ...baseInput,
        archiveEntries: [{
          absolutePath: fifoPath,
          archivePath: "vault/snapshot.fifo",
          kind: "file",
        }],
      })).rejects.toThrow("Hosted workspace snapshot durable root contains unsupported special files.");
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("creates and restores with only the archive and compression processes", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const notePath = path.join(vaultRoot, "note.md");
    const wrapperDir = path.join(tempRoot, "bin");
    const processMarkerPath = path.join(tempRoot, "snapshot-processes");
    const zstdArgumentsMarkerPath = path.join(tempRoot, "snapshot-zstd-arguments");
    const originalPath = process.env.PATH;
    const realTarPath = (await execFileAsync("which", ["tar"])).stdout.trim();
    const realZstdPath = (await execFileAsync("which", ["zstd"])).stdout.trim();
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_processes.snapshot.enc";
    const snapshotId = "snapshot_processes";
    const userId = "member_123";

    try {
      await mkdir(vaultRoot, { recursive: true });
      await mkdir(wrapperDir, { recursive: true });
      await writeFile(notePath, "note\n", "utf8");
      await writeFile(
        path.join(wrapperDir, "tar"),
        `#!/bin/sh
case " $* " in
  *" -xf "*) operation=tar-extract ;;
  *) operation=tar-create ;;
esac
printf '%s\\n' "$operation" >> "\${MURPH_TEST_SNAPSHOT_PROCESS_MARKER:?}"
exec "\${MURPH_TEST_REAL_TAR:?}" "$@"
`,
        { mode: 0o700 },
      );
      await writeFile(
        path.join(wrapperDir, "zstd"),
        `#!/bin/sh
case "\${1:-}" in
  --version) operation=zstd-version ;;
  -d) operation=zstd-decompress ;;
  *) operation=zstd-compress ;;
esac
printf '%s\\n' "$operation" >> "\${MURPH_TEST_SNAPSHOT_PROCESS_MARKER:?}"
printf '%s\\n' "$*" >> "\${MURPH_TEST_SNAPSHOT_ZSTD_ARGUMENTS_MARKER:?}"
exec "\${MURPH_TEST_REAL_ZSTD:?}" "$@"
`,
        { mode: 0o700 },
      );

      process.env.MURPH_TEST_REAL_TAR = realTarPath;
      process.env.MURPH_TEST_REAL_ZSTD = realZstdPath;
      process.env.MURPH_TEST_SNAPSHOT_PROCESS_MARKER = processMarkerPath;
      process.env.MURPH_TEST_SNAPSHOT_ZSTD_ARGUMENTS_MARKER = zstdArgumentsMarkerPath;
      process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath ?? ""}`;

      const aad = buildHostedWorkspaceSnapshotV2Aad({ objectKey, snapshotId, userId });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: [
          {
            absolutePath: vaultRoot,
            archivePath: "vault",
            kind: "directory",
          },
          {
            absolutePath: notePath,
            archivePath: "vault/note.md",
            kind: "file",
          },
        ],
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        ivBase64: Buffer.alloc(12, 9).toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      });
      await restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: path.join(tempRoot, "restored", "durable"),
        encryptedFilePath: encrypted.encryptedFilePath,
        ref: createHostedWorkspaceSnapshotTestRef({
          aad,
          encrypted,
          objectKey,
          snapshotId,
          userId,
        }),
      });

      const operations = (await readFile(processMarkerPath, "utf8"))
        .trim()
        .split("\n")
        .sort();
      expect(operations).toEqual([
        "tar-create",
        "tar-extract",
        "zstd-compress",
        "zstd-decompress",
      ]);
      const [compressArguments, decompressArguments] = (await readFile(
        zstdArgumentsMarkerPath,
        "utf8",
      )).trim().split("\n");
      expect(compressArguments?.split(" ")).toContain("-3");
      expect(compressArguments?.split(" ")).not.toContain("-1");
      expect(decompressArguments?.split(" ")).toContain("-d");
    } finally {
      process.env.PATH = originalPath;
      delete process.env.MURPH_TEST_REAL_TAR;
      delete process.env.MURPH_TEST_REAL_ZSTD;
      delete process.env.MURPH_TEST_SNAPSHOT_PROCESS_MARKER;
      delete process.env.MURPH_TEST_SNAPSHOT_ZSTD_ARGUMENTS_MARKER;
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("rejects emitted tar members that differ from the planned entry state", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const notePath = path.join(durableRoot, "vault", "note.md");
    const wrapperDir = path.join(tempRoot, "bin");
    const tarWrapperPath = path.join(wrapperDir, "tar");
    const tarMarkerPath = path.join(tempRoot, "tar-wrapper-used");
    const originalPath = process.env.PATH;
    const realTarPath = (await execFileAsync("which", ["tar"])).stdout.trim();
    const snapshotId = "snapshot_tar_race";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_tar_race.snapshot.enc";
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await mkdir(path.dirname(notePath), { recursive: true });
      await mkdir(wrapperDir, { recursive: true });
      await writeFile(notePath, "note\n", "utf8");
      await writeFile(
        tarWrapperPath,
        `#!/bin/sh
REAL_TAR="\${MURPH_TEST_REAL_TAR:?}"
ROOT="\${MURPH_TEST_DURABLE_ROOT:?}"
MARKER="\${MURPH_TEST_TAR_MARKER:?}"
NOTE="$ROOT/vault/note.md"
BACKUP="$ROOT/vault/note.md.before-tar"
if [ ! -e "$MARKER" ]; then
  : > "$MARKER" || exit 1
  mv "$NOTE" "$BACKUP" || exit 1
  ln -s /tmp "$NOTE" || { mv "$BACKUP" "$NOTE"; exit 1; }
  "$REAL_TAR" "$@"
  status=$?
  rm -f "$NOTE"
  mv "$BACKUP" "$NOTE"
  exit "$status"
fi
exec "$REAL_TAR" "$@"
`,
        { mode: 0o700 },
      );
      await chmod(tarWrapperPath, 0o700);

      process.env.MURPH_TEST_DURABLE_ROOT = durableRoot;
      process.env.MURPH_TEST_REAL_TAR = realTarPath;
      process.env.MURPH_TEST_TAR_MARKER = tarMarkerPath;
      process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath ?? ""}`;

      await expect(createEncryptedWorkspaceSnapshotFile({
        aad: buildHostedWorkspaceSnapshotV2Aad({
          objectKey,
          snapshotId,
          userId: "member_123",
        }),
        archiveEntries: [{
          absolutePath: notePath,
          archivePath: "vault/note.md",
          kind: "file",
        }],
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      })).rejects.toThrow("Hosted workspace snapshot tar entry type is unsafe.");
      await expect(readFile(notePath, "utf8")).resolves.toBe("note\n");
    } finally {
      process.env.PATH = originalPath;
      delete process.env.MURPH_TEST_DURABLE_ROOT;
      delete process.env.MURPH_TEST_REAL_TAR;
      delete process.env.MURPH_TEST_TAR_MARKER;
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it.each([
    {
      archivePatch: { encryptedObjectSha256: "0".repeat(64) },
      expectedError: "Hosted workspace snapshot encrypted digest does not match its ref.",
      name: "encrypted object digest",
    },
    {
      archivePatch: { plaintextArchiveSha256: "0".repeat(64) },
      expectedError: "Hosted workspace snapshot plaintext archive digest does not match its ref.",
      name: "plaintext archive digest",
    },
  ])("rejects $name mismatches without replacing the durable root", async ({
    archivePatch,
    expectedError,
  }) => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
    const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
    const restoredDurableRoot = path.join(tempRoot, "restored", "durable");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 41);
    const snapshotId = "snapshot_digest_mismatch";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_digest_mismatch.snapshot.enc";
    const userId = "member_123";

    try {
      await mkdir(sourceVaultRoot, { recursive: true });
      await mkdir(sourceOperatorHomeRoot, { recursive: true });
      await mkdir(restoredDurableRoot, { recursive: true });
      await writeFile(path.join(sourceVaultRoot, "note.md"), "new workspace\n", "utf8");
      await writeFile(path.join(restoredDurableRoot, "existing.txt"), "existing durable root\n", "utf8");
      const aad = buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      });
      const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot: sourceDurableRoot,
        operatorHomeRoot: sourceOperatorHomeRoot,
        vaultRoot: sourceVaultRoot,
      });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: archivePlan.entries,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: sourceDurableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 50))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      });
      const ref = createHostedWorkspaceSnapshotTestRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      });

      await expect(restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: restoredDurableRoot,
        encryptedFilePath: encrypted.encryptedFilePath,
        ref: {
          ...ref,
          archive: {
            ...ref.archive,
            ...archivePatch,
          },
        },
      })).rejects.toThrow(expectedError);

      await expect(readFile(path.join(restoredDurableRoot, "existing.txt"), "utf8"))
        .resolves.toBe("existing durable root\n");
      await expect(access(path.join(restoredDurableRoot, "vault", "note.md")))
        .rejects.toThrow();
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });
});

function createHostedWorkspaceSnapshotTestRef(input: {
  aad: HostedWorkspaceSnapshotV2Aad;
  encrypted: EncryptedWorkspaceSnapshotFile;
  objectKey: string;
  snapshotId: string;
  userId: string;
}): HostedWorkspaceSnapshotV2Ref {
  return {
    archive: {
      compression: input.encrypted.compression,
      encryptedByteSize: input.encrypted.encryptedByteSize,
      encryptedObjectSha256: input.encrypted.encryptedObjectSha256,
      fileCount: input.encrypted.fileCount,
      format: "tar",
      plaintextArchiveSha256: input.encrypted.plaintextArchiveSha256,
      totalPlainBytes: input.encrypted.totalPlainBytes,
    },
    createdAt: "2026-05-20T00:00:00.000Z",
    encryption: {
      aad: input.aad,
      ivBase64: input.encrypted.ivBase64,
      rootKeyId: "root_key_test",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped_data_key_test",
    },
    objectKey: input.objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
    snapshotId: input.snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId: input.userId,
  };
}

async function createLegacyUstarEncryptedSnapshot(input: {
  aad: HostedWorkspaceSnapshotV2Aad;
  dataKey: string;
  durableRoot: string;
  ivBase64: string;
  notePath: string;
  outputDir: string;
}): Promise<EncryptedWorkspaceSnapshotFile> {
  await mkdir(input.outputDir, { mode: 0o700, recursive: true });
  const temporaryDirectoryPath = await mkdtemp(path.join(input.outputDir, "legacy-ustar-"));
  const tarPath = path.join(temporaryDirectoryPath, "workspace.tar");
  const compressedPath = path.join(temporaryDirectoryPath, "workspace.tar.zst");
  const encryptedFilePath = path.join(temporaryDirectoryPath, "workspace.snapshot.enc");
  const key = decodeHostedWorkspaceSnapshotV2DataKey(input.dataKey);

  try {
    await execFileAsync("tar", [
      "-C",
      input.durableRoot,
      "--format=ustar",
      "-cf",
      tarPath,
      "./vault/note.md",
    ]);
    await execFileAsync("zstd", [
      "-1",
      "--no-progress",
      "-T2",
      "-f",
      tarPath,
      "-o",
      compressedPath,
    ]);
    const compressedArchive = await readFile(compressedPath);
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(key),
      Buffer.from(input.ivBase64, "base64url"),
    );
    cipher.setAAD(Buffer.from(serializeHostedWorkspaceSnapshotV2Aad(input.aad)));
    const encryptedBytes = Buffer.concat([
      cipher.update(compressedArchive),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    await writeFile(encryptedFilePath, encryptedBytes, { mode: 0o600 });

    return {
      compression: HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
      encryptedByteSize: encryptedBytes.byteLength,
      encryptedFilePath,
      encryptedObjectSha256: createHash("sha256").update(encryptedBytes).digest("hex"),
      fileCount: 1,
      ivBase64: input.ivBase64,
      plaintextArchiveSha256: createHash("sha256").update(compressedArchive).digest("hex"),
      temporaryDirectoryPath,
      totalPlainBytes: (await stat(input.notePath)).size,
    };
  } finally {
    key.fill(0);
  }
}

async function* streamEncryptedChunks(chunks: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

const TEST_HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES = 16;

function splitEncryptedSnapshotAcrossAuthTagBoundary(encryptedBytes: Buffer): Uint8Array[] {
  const ciphertextEnd =
    encryptedBytes.byteLength - TEST_HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES;
  const nearAuthTag = Math.max(1, ciphertextEnd - 3);
  return [
    encryptedBytes.subarray(0, 1),
    encryptedBytes.subarray(1, nearAuthTag),
    encryptedBytes.subarray(nearAuthTag, ciphertextEnd + 1),
    encryptedBytes.subarray(ciphertextEnd + 1, ciphertextEnd + 8),
    encryptedBytes.subarray(ciphertextEnd + 8),
  ].filter((chunk) => chunk.byteLength > 0);
}
