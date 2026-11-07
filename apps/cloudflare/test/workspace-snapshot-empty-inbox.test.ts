import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { initializeVault, walkVaultFiles } from "@murphai/core";
import { collectHostedWorkspaceSnapshotArchivePlan, HOSTED_MEDIA_REFS_RELATIVE_PATH, type HostedWorkspaceSnapshotArchivePlan } from "@murphai/runtime-state/node";
import {
  openInboxRuntime,
  persistCanonicalInboxCapture,
  rebuildRuntimeFromVault,
  runInboxMediaRetention,
  runInboxTextRetention,
} from "@murphai/inboxd";
import { compactLegacyParserAttempts } from "@murphai/parsers";
import { startHostedWorkspaceRestorePreparation } from "@murphai/assistant-runtime/hosted-workspace-restore-preparation";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  createEncryptedWorkspaceSnapshotFile,
  restoreEncryptedWorkspaceSnapshot,
} from "../src/workspace-snapshot-local.ts";

async function directoryModes(root: string, relativePath = ""): Promise<Record<string, number>> {
  const absolutePath = path.join(root, relativePath);
  const modes: Record<string, number> = { [relativePath]: (await lstat(absolutePath)).mode & 0o777 };
  for (const entry of await readdir(absolutePath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      Object.assign(modes, await directoryModes(root, path.posix.join(relativePath, entry.name)));
    }
  }
  return modes;
}

test.skipIf(path.sep === "\\").for(["raw", "derived"])(
  "rejects a literal backslash directory outside %s/inbox instead of omitting it",
  async (root, context) => {
    const scratchRoot = await mkdtemp(path.join(tmpdir(), "backslash-inbox-snapshot-"));
    const durableRoot = path.join(scratchRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const parent = path.join(vaultRoot, root);
    try {
      await mkdir(parent, { recursive: true });
      try {
        await mkdir(path.join(parent, "inbox\\empty"));
      } catch (error) {
        if (["EINVAL", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) {
          context.skip();
        }
        throw error;
      }
      const plan = await collectHostedWorkspaceSnapshotArchivePlan({ durableRoot, vaultRoot });
      await expect(createEncryptedWorkspaceSnapshotFile({
        aad: buildHostedWorkspaceSnapshotV2Aad({
          userId: "member_synthetic", snapshotId: "snapshot_backslash", objectKey: "synthetic.snapshot.enc",
        }),
        archiveEntries: plan.entries,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(new Uint8Array(32).fill(7)),
        durableRoot,
        ivBase64: Buffer.alloc(12, 11).toString("base64url"),
        maxEncryptedBytes: 1024 * 1024,
        outputDir: path.join(scratchRoot, "archive"),
      })).rejects.toThrow("Hosted workspace snapshot archive entry path escaped durableRoot.");
    } finally {
      await rm(scratchRoot, { recursive: true, force: true });
    }
  },
);

test("tar.zstd omits only inbox trees without included files and supports subsequent writers", async () => {
  const scratchRoot = await mkdtemp(path.join(tmpdir(), "empty-inbox-snapshot-"));
  const durableRoot = path.join(scratchRoot, "durable");
  const vaultRoot = path.join(durableRoot, "vault");
  const operatorHomeRoot = path.join(durableRoot, "home");
  const coldPath = "raw/inbox/cold/nested/video.mp4";
  const coldBytes = Buffer.from("synthetic cold attachment");
  const omitted = [
    "raw/inbox/empty", "raw/inbox/empty/deep", "raw/inbox/cold", "raw/inbox/cold/nested",
    "raw/inbox/live/empty", "derived/inbox/empty", "derived/inbox/empty/deep",
    "derived/inbox/live/empty",
  ];
  try {
    await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });
    await mkdir(operatorHomeRoot, { recursive: true, mode: 0o700 });
    for (const relativePath of [
      ...omitted, "raw/inbox/live/nested", "derived/inbox/live/nested",
      "raw/inbox-other/empty", "derived/inbox-other/empty", "raw/captures/empty",
      ".runtime/operations/assistant/state/empty",
    ]) {
      await mkdir(path.join(vaultRoot, relativePath), { recursive: true, mode: 0o700 });
    }
    const files = {
      "raw/inbox/live/nested/attachment.txt": "synthetic attachment",
      "derived/inbox/live/nested/result.json": "{}",
      ".runtime/operations/assistant/state/state.json": "{}",
    };
    for (const [relativePath, content] of Object.entries(files)) {
      await writeFile(path.join(vaultRoot, relativePath), content, { mode: 0o600 });
    }
    await writeFile(path.join(vaultRoot, coldPath), coldBytes, { mode: 0o600 });
    await writeFile(path.join(vaultRoot, HOSTED_MEDIA_REFS_RELATIVE_PATH), JSON.stringify({
      schema: "murph.hosted-media-refs.v1",
      entries: [{
        relativePath: coldPath,
        mediaId: createHash("sha256").update("synthetic-video").digest("hex"),
        byteSize: coldBytes.length,
        sha256: createHash("sha256").update(coldBytes).digest("hex"),
        mediaKind: "video",
        mimeType: "video/mp4",
        recordedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: null,
      }],
    }));
    // Exercise private runtime parents and distinct non-empty inbox parent modes.
    for (const relativePath of [".runtime", ".runtime/operations", "raw/inbox", "derived/inbox"]) {
      await chmod(path.join(vaultRoot, relativePath), 0o700);
    }
    await chmod(path.join(vaultRoot, "raw/inbox/live"), 0o750);
    await chmod(path.join(vaultRoot, "derived/inbox/live"), 0o710);
    const before = await directoryModes(vaultRoot);
    const options = { durableRoot, vaultRoot, operatorHomeRoot, excludedVaultPaths: [coldPath] };
    const plan = await collectHostedWorkspaceSnapshotArchivePlan(options);
    const plannedDirectories = plan.entries.filter(entry => entry.root === "vault" && entry.kind === "directory")
      .map(entry => entry.relativePath);
    const expectedDirectories = Object.keys(before).filter(relativePath => !omitted.includes(relativePath)
      // Existing runtime cache/projection exclusions are unrelated to this rule.
      && !relativePath.startsWith(".runtime/cache") && !relativePath.startsWith(".runtime/projections")
      && !relativePath.startsWith(".runtime/tmp") && !relativePath.startsWith(".runtime/locks"));
    expect(plannedDirectories.sort()).toEqual(expectedDirectories.sort());
    const encrypted = await roundTripWorkspaceSnapshot({ durableRoot, plan, scratchRoot });
    expect(encrypted.compression).toBe("zstd");
    expect(encrypted.fileCount).toBe(plan.fileCount);
    expect(await directoryModes(vaultRoot)).toEqual(Object.fromEntries(
      expectedDirectories.map(relativePath => [relativePath, before[relativePath]]),
    ));
    expect((await lstat(operatorHomeRoot)).mode & 0o777).toBe(0o700);
    for (const [relativePath, content] of Object.entries(files)) {
      expect(await readFile(path.join(vaultRoot, relativePath), "utf8")).toBe(content);
    }
    await expect(lstat(path.join(vaultRoot, coldPath))).rejects.toMatchObject({ code: "ENOENT" });
    const secondPlan = await collectHostedWorkspaceSnapshotArchivePlan(options);
    expect(secondPlan.entries).toEqual(plan.entries);
    const second = await roundTripWorkspaceSnapshot({ durableRoot, plan: secondPlan, scratchRoot });
    expect(second.fileCount).toBe(encrypted.fileCount);
    expect(second.totalPlainBytes).toBe(encrypted.totalPlainBytes);
    expect((await collectHostedWorkspaceSnapshotArchivePlan(options)).entries).toEqual(plan.entries);

    const workspace = {
      userId: second.ref.userId, version: "1", snapshotRef: second.ref,
      createdAt: second.ref.createdAt, updatedAt: second.ref.createdAt, checkpointedAt: second.ref.createdAt,
    };
    const unexpected = async (): Promise<never> => { throw new Error("Unexpected publication"); };
    const preparation = startHostedWorkspaceRestorePreparation({
      vaultRoot,
      job: { request: { attemptId: "attempt_synthetic", leaseGeneration: "1", userId: workspace.userId,
        workspaceVersion: workspace.version, workspace } },
      platform: {
        artifactStore: { get: async () => null, put: unexpected },
        mediaStore: { get: async () => coldBytes, put: unexpected },
        workspacePort: { read: async () => ({ workspace, fetchedAt: workspace.createdAt }), checkpoint: unexpected },
        workspaceSnapshotPort: {
          abortSnapshotSession: unexpected, completeSnapshotSession: unexpected,
          putSnapshotObjectDirect: unexpected, startSnapshotSession: unexpected,
          restoreWorkspaceSnapshot: second.restore,
        },
      },
    });
    const { restored } = await preparation.promise;
    expect(restored.restoreWasCold).toBe(true);

    for (const relativePath of omitted) expect(await walkVaultFiles(vaultRoot, relativePath)).toEqual([]);
    const sourcePath = path.join(scratchRoot, "attachment.txt");
    await writeFile(sourcePath, "later synthetic attachment");
    const persisted = await persistCanonicalInboxCapture({
      vaultRoot,
      captureId: "cap_synthetic_later",
      eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VA02",
      storedAt: "2026-01-02T00:00:00.000Z",
      input: {
        source: "email", accountId: "synthetic", externalId: "message_later",
        thread: { id: "thread_synthetic" }, actor: { isSelf: false }, text: "Synthetic capture",
        occurredAt: "2026-01-02T00:00:00.000Z", receivedAt: "2026-01-02T00:00:00.000Z", raw: {},
        attachments: [{ externalId: "attachment_later", kind: "document", mime: "text/plain",
          originalPath: sourcePath, fileName: "attachment.txt" }],
      },
    });
    const attachment = persisted.stored.attachments[0];
    expect(attachment?.storedPath).toBeTruthy();
    expect(await readFile(path.join(vaultRoot, attachment!.storedPath!), "utf8"))
      .toBe("later synthetic attachment");
    const runtime = await openInboxRuntime({ vaultRoot });
    try {
      await rebuildRuntimeFromVault({ vaultRoot, runtime, enqueueParserJobs: true });
      await runInboxMediaRetention({ vaultRoot, now: "2026-01-02T00:00:00.000Z" });
      const textRetention = await runInboxTextRetention({ vaultRoot, now: "2026-02-02T00:00:00.000Z" });
      expect(textRetention.expiredCaptures).toBe(1);
      await compactLegacyParserAttempts({ vaultRoot, apply: true });
    } finally {
      runtime.close();
    }
    const materialized = await restored.materializeWorkspaceArtifacts([coldPath]);
    expect([...materialized.materializedArtifactPaths]).toEqual([`vault:${coldPath}`]);
    expect(await readFile(path.join(vaultRoot, coldPath))).toEqual(coldBytes);
    for (const relativePath of ["raw/inbox/cold", "raw/inbox/cold/nested"]) {
      expect((await lstat(path.join(vaultRoot, relativePath))).mode & 0o777).toBe(0o700);
    }
    expect((await lstat(path.join(vaultRoot, coldPath))).mode & 0o777).toBe(0o600);
    expect((await collectHostedWorkspaceSnapshotArchivePlan(options)).entries
      .some(entry => entry.relativePath === "raw/inbox/cold")).toBe(false);
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
});

async function roundTripWorkspaceSnapshot(input: {
  durableRoot: string;
  plan: HostedWorkspaceSnapshotArchivePlan;
  scratchRoot: string;
}) {
  const userId = "member_synthetic";
  const snapshotId = "snapshot_empty_inbox";
  const objectKey = `users/${userId}/workspace-snapshots/${snapshotId}.snapshot.enc`;
  const aad = buildHostedWorkspaceSnapshotV2Aad({ userId, snapshotId, objectKey });
  const dataKey = encodeHostedWorkspaceSnapshotV2DataKey(new Uint8Array(32).fill(7));
  const encrypted = await createEncryptedWorkspaceSnapshotFile({
    aad,
    archiveEntries: input.plan.entries,
    dataKey,
    durableRoot: input.durableRoot,
    ivBase64: Buffer.alloc(12, 11).toString("base64url"),
    maxEncryptedBytes: 1024 * 1024,
    outputDir: path.join(input.scratchRoot, "archive"),
  });
  const ref: HostedWorkspaceSnapshotV2Ref = {
    archive: {
      compression: encrypted.compression,
      encryptedByteSize: encrypted.encryptedByteSize,
      encryptedObjectSha256: encrypted.encryptedObjectSha256,
      fileCount: encrypted.fileCount,
      format: "tar",
      plaintextArchiveSha256: encrypted.plaintextArchiveSha256,
      totalPlainBytes: encrypted.totalPlainBytes,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    encryption: {
      aad,
      ivBase64: encrypted.ivBase64,
      rootKeyId: "root_key_synthetic",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped_data_key_synthetic",
    },
    objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
    snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId,
  };
  const restore = () => restoreEncryptedWorkspaceSnapshot({
    dataKey, durableRoot: input.durableRoot, encryptedFilePath: encrypted.encryptedFilePath, ref,
  });
  await restore();
  return { ...encrypted, ref, restore };
}
