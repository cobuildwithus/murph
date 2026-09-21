import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { auditRecordSchema } from "@murphai/contracts";
import { validateVault, walkVaultFiles, statAndHashVaultFile, VAULT_LAYOUT } from "@murphai/core";
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

type SurvivingFile = { sha256: string; bytes: number };

async function fileInventory(root: string, signal: AbortSignal): Promise<Map<string, SurvivingFile>> {
  const files = new Map<string, SurvivingFile>();
  let entries = 0;
  async function visit(relative: string) {
    signal.throwIfAborted();
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (++entries > 20_000) throw new Error("recovery_inventory_limit");
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        const hash = createHash("sha256");
        let bytes = 0;
        for await (const chunk of createReadStream(path.join(root, name), { signal })) { hash.update(chunk); bytes += chunk.length; }
        files.set(name, { sha256: hash.digest("hex"), bytes });
      } else throw new Error("recovery_inventory_unsupported_entry");
    }
  }
  await visit("");
  return files;
}

function validateRecoveryAuditAppend(appended: string, timestamp: string): void {
  const records = appended.trimEnd().split("\n").map(line => auditRecordSchema.parse(JSON.parse(line)));
  if (!appended.endsWith("\n") || records.length !== 2
    || records[0]?.commandName !== "core.initializeVault" || records[0]?.action !== "vault_init"
    || records[1]?.commandName !== "core.importDocument" || records[1]?.action !== "document_import"
    || records.some(record => record.occurredAt !== timestamp || record.status !== "success")) {
    throw new Error("recovery_snapshot_unexpected_audit_append");
  }
}

// Rebuilding adds exactly two canonical audit records. Only that shard may
// grow; its complete original prefix and every other survivor remain unchanged.
export async function assertRecoverySurvivingFiles(input: {
  original: ReadonlyMap<string, SurvivingFile>; verified: ReadonlyMap<string, SurvivingFile>;
  verifiedRoot: string; recoveredAt: string;
}): Promise<void> {
  const timestamp = new Date(input.recoveredAt).toISOString();
  const auditPath = path.join("vault", VAULT_LAYOUT.auditDirectory, timestamp.slice(0, 4), `${timestamp.slice(0, 7)}.jsonl`);
  for (const [name, original] of input.original) {
    const current = input.verified.get(name);
    if (current?.sha256 === original.sha256) continue;
    if (name !== auditPath || !current || current.bytes <= original.bytes || current.bytes - original.bytes > 64 * 1024) {
      throw new Error("recovery_snapshot_surviving_file_changed");
    }
    const file = path.join(input.verifiedRoot, name);
    const prefix = createHash("sha256");
    if (original.bytes > 0) for await (const chunk of createReadStream(file, { end: original.bytes - 1 })) prefix.update(chunk);
    if (prefix.digest("hex") !== original.sha256) {
      throw new Error("recovery_snapshot_surviving_file_changed");
    }
    const tail: Buffer[] = [];
    for await (const chunk of createReadStream(file, { start: original.bytes, end: current.bytes - 1 })) tail.push(chunk);
    const appended = Buffer.concat(tail).toString("utf8");
    validateRecoveryAuditAppend(appended, timestamp);
  }
}

/** Private scratch lifetime encloses optional publication. All original surviving
 * files must round-trip unchanged, allowing only verified canonical audit appends.
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
    await assertRecoverySurvivingFiles({ original, verified, verifiedRoot, recoveredAt: input.rebuild.recoveredAt });
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
