import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { collectHostedWorkspaceSnapshotArchivePlan } from "@murphai/runtime-state/node";
import { hostedWorkspaceSnapshotObjectKey } from "@murphai/hosted-execution/storage-paths";
import { parseHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import { buildHostedWorkspaceSnapshotV2Aad, encodeHostedWorkspaceSnapshotV2DataKey, wrapHostedWorkspaceSnapshotV2DataKey } from "@murphai/hosted-execution/workspace-snapshot-v2";
import { createEncryptedWorkspaceSnapshotFile } from "../src/workspace-snapshot-local.ts";
import { withPartialRecoverySnapshot } from "../scripts/checkpoint-recovery-snapshot.ts";
import { createSyntheticBrowserVaultReplica } from "./fixtures/browser-vault-replica.ts";

const scratch: string[] = [];
afterEach(async () => { for (const directory of scratch.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "synthetic-recovery-archive-"));
  scratch.push(root);
  const durableRoot = path.join(root, "source");
  const vaultRoot = path.join(durableRoot, "vault");
  const mailbox = path.join(vaultRoot, ".runtime/operations/assistant/hosted-system-mailbox.json");
  await mkdir(path.dirname(mailbox), { recursive: true });
  await writeFile(mailbox, "{\"syntheticCursor\":9}\n");
  const userId = "synthetic-recovery-member";
  const snapshotId = "synthetic-before-repair";
  const objectKey = await hostedWorkspaceSnapshotObjectKey({ userId, snapshotId });
  const aad = buildHostedWorkspaceSnapshotV2Aad({ userId, snapshotId, objectKey });
  const dataKey = randomBytes(32);
  const rootKey = randomBytes(32);
  const rootKeyId = "synthetic-root";
  const plan = await collectHostedWorkspaceSnapshotArchivePlan({ durableRoot, vaultRoot });
  const encrypted = await createEncryptedWorkspaceSnapshotFile({ aad, archiveEntries: plan.entries, durableRoot,
    dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey), ivBase64: randomBytes(12).toString("base64url"),
    outputDir: root, maxEncryptedBytes: 32 * 1024 * 1024 });
  const source = parseHostedWorkspaceSnapshotV2Ref({ schema: "murph.hosted-workspace-snapshot.v2", userId, snapshotId,
    objectKey, createdAt: "2026-01-01T00:00:00.000Z", upload: "direct-r2-presigned-put",
    archive: { ...encrypted, format: "tar" }, encryption: { aad, ivBase64: encrypted.ivBase64, rootKeyId,
      scheme: "murph.hosted-workspace-snapshot-single-object.v1",
      wrappedDataKey: await wrapHostedWorkspaceSnapshotV2DataKey({ aad, dataKey, rootKey, rootKeyId }) } });
  dataKey.fill(0);
  const replica = createSyntheticBrowserVaultReplica(4);
  return { encrypted, input: { userId, source, rootKey, rootKeyId, sourceEncryptedStream: createReadStream(encrypted.encryptedFilePath),
    rebuild: { replica, sourceBytes: Buffer.from(JSON.stringify(replica)), timezone: "UTC", recoveredAt: "2026-02-01T00:00:00.000Z",
      completedOnboarding: true, signal: new AbortController().signal } } };
}

it("round-trips the partial rebuild through authenticated encryption before offering it for publication", async () => {
  const { input } = await fixture();
  let candidatePath = "";
  const result = await withPartialRecoverySnapshot({ ...input, useCandidate: async candidate => {
    candidatePath = candidate.encryptedFilePath;
    expect((await readFile(candidatePath)).byteLength).toBe(candidate.ref.archive.encryptedByteSize);
    expect(candidate.ref.snapshotId).not.toBe(input.source.snapshotId);
    return candidate.summary;
  } });
  expect(result).toMatchObject({ archiveValidated: true, preservedFiles: 1, validVault: true,
    onboardingCompleted: true, originalFilesRestored: false, restorationPerformed: false });
  await expect(readFile(candidatePath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("never offers a corrupted or wrong-member source for publication", async () => {
  const { input, encrypted } = await fixture();
  const useCandidate = vi.fn();
  const bytes = await readFile(encrypted.encryptedFilePath);
  bytes[0] = bytes[0]! ^ 1;
  async function* corrupted() { yield bytes; }
  await expect(withPartialRecoverySnapshot({ ...input, sourceEncryptedStream: corrupted(), useCandidate })).rejects.toThrow();
  await expect(withPartialRecoverySnapshot({ ...input, userId: "another-synthetic-member", useCandidate })).rejects.toThrow("authority_mismatch");
  expect(useCandidate).not.toHaveBeenCalled();
  input.sourceEncryptedStream.destroy();
});

it("removes candidate scratch if publication fails", async () => {
  const { input } = await fixture();
  let candidatePath = "";
  await expect(withPartialRecoverySnapshot({ ...input, useCandidate: async candidate => {
    candidatePath = candidate.encryptedFilePath;
    throw new Error("synthetic-publication-failure");
  } })).rejects.toThrow("synthetic-publication-failure");
  await expect(readFile(candidatePath)).rejects.toMatchObject({ code: "ENOENT" });
});
