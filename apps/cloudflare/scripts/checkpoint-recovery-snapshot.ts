import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateVault, walkVaultFiles, statAndHashVaultFile } from "@murphai/core";
import { readAssistantOnboardingState } from "@murphai/assistant-engine/assistant-state";
import { collectHostedWorkspaceSnapshotArchivePlan } from "@murphai/runtime-state/node";
import { hostedWorkspaceSnapshotObjectKey } from "@murphai/hosted-execution/storage-paths";
import { parseHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import { buildHostedWorkspaceSnapshotV2Aad, createHostedWorkspaceSnapshotV2DataKey,
  encodeHostedWorkspaceSnapshotV2DataKey, unwrapHostedWorkspaceSnapshotV2DataKey, wrapHostedWorkspaceSnapshotV2DataKey,
  readHostedWorkspaceSnapshotV2DataKeyWrapRootKeyId, HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  type HostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/workspace-snapshot-v2";
import { createEncryptedWorkspaceSnapshotFile, restoreEncryptedWorkspaceSnapshotFromEncryptedStream } from "../src/workspace-snapshot-local.ts";
import { rebuildPartialRecoveryVault } from "./checkpoint-recovery-rebuild.ts";

async function fileInventory(root: string, signal: AbortSignal): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let entries = 0;
  async function visit(relative: string) {
    signal.throwIfAborted();
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (++entries > 20_000) throw new Error("recovery_inventory_limit");
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(path.join(root, name), { signal })) hash.update(chunk);
        files.set(name, hash.digest("hex"));
      } else throw new Error("recovery_inventory_unsupported_entry");
    }
  }
  await visit("");
  return files;
}

/** Private scratch lifetime encloses optional publication. All original surviving
 * files must round-trip byte-for-byte through the normal encrypted archive path.
 * The only emitted plaintext evidence is bounded counts and validation booleans. */
export async function withPartialRecoverySnapshot<T>(input: {
  userId: string;
  source: HostedWorkspaceSnapshotV2Ref;
  sourceEncryptedStream: AsyncIterable<Uint8Array>;
  rootKey: Uint8Array;
  rootKeyId: string;
  rebuild: Omit<Parameters<typeof rebuildPartialRecoveryVault>[0], "vaultRoot">;
  useCandidate: (candidate: { ref: HostedWorkspaceSnapshotV2Ref; encryptedFilePath: string;
    summary: Awaited<ReturnType<typeof rebuildPartialRecoveryVault>> & { archiveValidated: true; preservedFiles: number } }) => Promise<T>;
}): Promise<T> {
  const signal = input.rebuild.signal;
  signal.throwIfAborted();
  const source = parseHostedWorkspaceSnapshotV2Ref(input.source);
  if (source.userId !== input.userId || source.objectKey !== await hostedWorkspaceSnapshotObjectKey({ userId: input.userId, snapshotId: source.snapshotId })
    || source.encryption.rootKeyId !== input.rootKeyId
    || readHostedWorkspaceSnapshotV2DataKeyWrapRootKeyId(source.encryption.wrappedDataKey) !== input.rootKeyId) {
    throw new Error("recovery_snapshot_authority_mismatch");
  }
  const scratch = await mkdtemp(path.join(tmpdir(), "murph-recovery-snapshot-"));
  const sourceKey = await unwrapHostedWorkspaceSnapshotV2DataKey({ aad: source.encryption.aad,
    rootKey: input.rootKey, wrappedDataKey: source.encryption.wrappedDataKey }).catch(async error => {
    await rm(scratch, { recursive: true, force: true }); throw error;
  });
  const targetKey = createHostedWorkspaceSnapshotV2DataKey();
  try {
    const durableRoot = path.join(scratch, "candidate");
    await restoreEncryptedWorkspaceSnapshotFromEncryptedStream({ durableRoot, ref: source, signal,
      dataKey: encodeHostedWorkspaceSnapshotV2DataKey(sourceKey), encryptedStream: input.sourceEncryptedStream });
    const original = await fileInventory(durableRoot, signal);
    const vaultRoot = path.join(durableRoot, "vault");
    const rebuilt = await rebuildPartialRecoveryVault({ ...input.rebuild, vaultRoot });
    const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({ durableRoot, vaultRoot,
      operatorHomeRoot: path.join(durableRoot, "home"), signal });
    if (!archivePlan.entries.some(entry => entry.root === "vault" && entry.relativePath === "vault.json"
      && entry.kind === "file" && (entry.size ?? 0) > 0)) throw new Error("recovery_snapshot_vault_missing");
    const snapshotId = `recovery-${randomUUID()}`;
    const objectKey = await hostedWorkspaceSnapshotObjectKey({ userId: input.userId, snapshotId });
    const aad = buildHostedWorkspaceSnapshotV2Aad({ userId: input.userId, snapshotId, objectKey });
    const outputDir = path.join(scratch, "encrypted");
    await mkdir(outputDir, { mode: 0o700 });
    const encrypted = await createEncryptedWorkspaceSnapshotFile({ aad, archiveEntries: archivePlan.entries,
      dataKey: encodeHostedWorkspaceSnapshotV2DataKey(targetKey), durableRoot, ivBase64: randomBytes(12).toString("base64url"),
      maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES, outputDir, signal });
    const ref = parseHostedWorkspaceSnapshotV2Ref({ schema: "murph.hosted-workspace-snapshot.v2",
      userId: input.userId, snapshotId, objectKey, createdAt: new Date().toISOString(), upload: "direct-r2-presigned-put",
      archive: { compression: encrypted.compression, encryptedByteSize: encrypted.encryptedByteSize,
        encryptedObjectSha256: encrypted.encryptedObjectSha256, fileCount: encrypted.fileCount,
        format: "tar", plaintextArchiveSha256: encrypted.plaintextArchiveSha256, totalPlainBytes: encrypted.totalPlainBytes },
      encryption: { aad, ivBase64: encrypted.ivBase64, rootKeyId: input.rootKeyId,
        scheme: "murph.hosted-workspace-snapshot-single-object.v1",
        wrappedDataKey: await wrapHostedWorkspaceSnapshotV2DataKey({ aad, dataKey: targetKey,
          rootKey: input.rootKey, rootKeyId: input.rootKeyId }) } });
    // Verify the published wrapped key, not just the in-memory encryption key.
    const verifyKey = await unwrapHostedWorkspaceSnapshotV2DataKey({ aad, rootKey: input.rootKey, wrappedDataKey: ref.encryption.wrappedDataKey });
    const verifiedRoot = path.join(scratch, "verified");
    try {
      await restoreEncryptedWorkspaceSnapshotFromEncryptedStream({ durableRoot: verifiedRoot, ref, signal,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(verifyKey), encryptedStream: createReadStream(encrypted.encryptedFilePath, { signal }) });
    } finally { verifyKey.fill(0); }
    const verified = await fileInventory(verifiedRoot, signal);
    for (const [name, hash] of original) if (verified.get(name) !== hash) throw new Error("recovery_snapshot_surviving_file_changed");
    const verifiedVault = path.join(verifiedRoot, "vault");
    if (!(await validateVault({ vaultRoot: verifiedVault })).valid
      || input.rebuild.completedOnboarding && (await readAssistantOnboardingState(verifiedVault)).status !== "completed") {
      throw new Error("recovery_snapshot_validation_failed");
    }
    const raw = (await walkVaultFiles(verifiedVault, "raw")).filter(file => file.endsWith("/recovered-browser-vault.json"));
    const expectedHash = createHash("sha256").update(input.rebuild.sourceBytes).digest("hex");
    if (raw.length !== 1 || (await statAndHashVaultFile(verifiedVault, raw[0]!))?.sha256 !== expectedHash) {
      throw new Error("recovery_snapshot_source_missing");
    }
    signal.throwIfAborted();
    return await input.useCandidate({ ref, encryptedFilePath: encrypted.encryptedFilePath,
      summary: { ...rebuilt, archiveValidated: true, preservedFiles: original.size } });
  } finally {
    sourceKey.fill(0); targetKey.fill(0);
    await rm(scratch, { recursive: true, force: true });
  }
}
