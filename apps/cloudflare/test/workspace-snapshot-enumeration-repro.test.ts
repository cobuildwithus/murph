import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

// Opt-in diagnostic: these assertions describe the defect, not desired behavior.
// Run with MURPH_REPRO_SNAPSHOT_ENUMERATION=1; replace with regression assertions
// when correcting the collector's root-wide ENOENT catch.
describe.skipIf(process.env.MURPH_REPRO_SNAPSHOT_ENUMERATION !== "1")(
  "snapshot enumeration data-loss reproduction",
  () => {
    afterEach(() => {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    });

    it.each([false, true])(
      "round-trips an intact vault with transient-directory race=%s",
      async (race) => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), "snapshot-enumeration-repro-"));
        const durableRoot = path.join(tempRoot, "durable");
        const vaultRoot = path.join(durableRoot, "vault");
        const operatorHomeRoot = path.join(durableRoot, "home");
        const transientPath = path.join(vaultRoot, ".runtime", "cache");
        const metadataPath = path.join(vaultRoot, "vault.json");
        const metadata = JSON.stringify({
          createdAt: "2026-01-01T00:00:00.000Z",
          formatVersion: CURRENT_VAULT_FORMAT_VERSION,
          timezone: "UTC",
          title: "Synthetic vault",
          vaultId: "vault_01JY0000000000000000000000",
        });
        let removedAfterEnumeration = false;
        try {
          await mkdir(transientPath, { recursive: true });
          await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "memories"), {
            recursive: true,
          });
          await writeFile(metadataPath, metadata);
          await writeFile(path.join(vaultRoot, "CORE.md"), "# Synthetic vault\n");
          await writeFile(path.join(vaultRoot, "note.md"), "Preserve this synthetic note.\n");
          for (const name of ["MEMORY.md", "memory_summary.md", "raw_memories.md"]) {
            await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "memories", name), "Synthetic memory\n");
          }

          // Schedule real deletion after readdir observes the directory, before
          // the collector lstats it. All other filesystem operations remain real.
          vi.doMock("node:fs/promises", async () => {
            const actual = await vi.importActual<typeof import("node:fs/promises")>(
              "node:fs/promises",
            );
            return {
              ...actual,
              readdir: async (...args: Parameters<typeof actual.readdir>) => {
                const entries = await actual.readdir(...args);
                if (race && String(args[0]) === path.dirname(transientPath)
                  && !removedAfterEnumeration) {
                  removedAfterEnumeration = true;
                  await actual.rm(transientPath, { recursive: true, force: true });
                }
                return entries;
              },
            };
          });
          const { collectHostedWorkspaceSnapshotArchivePlan } = await import(
            "@murphai/runtime-state/node"
          );
          const { createEncryptedWorkspaceSnapshotFile, restoreEncryptedWorkspaceSnapshot } =
            await import("../src/workspace-snapshot-local.js");
          const plan = await collectHostedWorkspaceSnapshotArchivePlan({
            durableRoot, operatorHomeRoot, vaultRoot,
          });
          expect(removedAfterEnumeration).toBe(race);
          // No canonical file is deleted by the race.
          expect(await readFile(metadataPath, "utf8")).toBe(metadata);
          expect(await readFile(path.join(vaultRoot, "note.md"), "utf8"))
            .toBe("Preserve this synthetic note.\n");
          const vaultFiles = plan.entries.filter((entry) =>
            entry.root === "vault" && entry.kind === "file");
          expect(vaultFiles).toHaveLength(race ? 0 : 3);
          expect(plan.entries.filter((entry) =>
            entry.root === "operator-home" && entry.kind === "file")).toHaveLength(3);

          const userId = "member_synthetic";
          const snapshotId = "snapshot_enumeration_repro";
          const objectKey = "users/member_synthetic/workspace-snapshots/snapshot_enumeration_repro.snapshot.enc";
          const aad = buildHostedWorkspaceSnapshotV2Aad({ userId, snapshotId, objectKey });
          const dataKey = encodeHostedWorkspaceSnapshotV2DataKey(new Uint8Array(32).fill(7));
          const encrypted = await createEncryptedWorkspaceSnapshotFile({
            aad,
            archiveEntries: plan.entries,
            dataKey,
            durableRoot,
            ivBase64: Buffer.alloc(12, 11).toString("base64url"),
            maxEncryptedBytes: 1024 * 1024,
            outputDir: path.join(tempRoot, "scratch"),
          });
          // Restore over the same intact workspace, just as a cold invocation
          // replaces its durable root. Encryption/hash checks accept the archive.
          await restoreEncryptedWorkspaceSnapshot({
            dataKey,
            durableRoot,
            encryptedFilePath: encrypted.encryptedFilePath,
            ref: {
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
            },
          });
          if (race) {
            await expect(access(metadataPath)).rejects.toMatchObject({ code: "ENOENT" });
            await expect(access(path.join(vaultRoot, "note.md"))).rejects.toMatchObject({ code: "ENOENT" });
          } else {
            expect(await readFile(metadataPath, "utf8")).toBe(metadata);
          }
          expect(await readFile(path.join(operatorHomeRoot, ".codex-hosted", "memories", "MEMORY.md"), "utf8"))
            .toBe("Synthetic memory\n");
        } finally {
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
    );
  },
);
