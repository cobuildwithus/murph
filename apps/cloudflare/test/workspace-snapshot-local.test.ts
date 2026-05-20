import { createCipheriv, createHash } from "node:crypto";
import { writeFile, mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  serializeHostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  restoreEncryptedWorkspaceSnapshot,
} from "../src/workspace-snapshot-local.js";

describe("workspace snapshot local restore", () => {
  it("rejects unsafe tar member paths before extraction", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const encryptedFilePath = path.join(tempRoot, "snapshot.enc");
    const snapshotId = "snapshot_unsafe_tar";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_unsafe_tar.snapshot.enc";
    const userId = "member_123";
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId,
      userId,
    });
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 10);
    const plaintextArchive = gzipSync(createTarArchive([{
      body: Buffer.from("outside\n", "utf8"),
      name: "../escape.txt",
    }]));
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(dataKey), Buffer.from(iv));
    cipher.setAAD(Buffer.from(serializeHostedWorkspaceSnapshotV2Aad(aad)));
    const encryptedBody = Buffer.concat([
      cipher.update(plaintextArchive),
      cipher.final(),
    ]);
    const encryptedObject = Buffer.concat([encryptedBody, cipher.getAuthTag()]);
    await writeFile(encryptedFilePath, encryptedObject, { mode: 0o600 });
    const ref: HostedWorkspaceSnapshotV2Ref = {
      archive: {
        compression: "gzip",
        encryptedByteSize: encryptedObject.byteLength,
        encryptedObjectSha256: sha256Hex(encryptedObject),
        fileCount: 1,
        format: "tar",
        plaintextArchiveSha256: sha256Hex(plaintextArchive),
      },
      createdAt: "2026-05-20T00:00:00.000Z",
      encryption: {
        aad,
        ivBase64: Buffer.from(iv).toString("base64url"),
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

    try {
      await expect(restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        encryptedFilePath,
        ref,
      })).rejects.toThrow("Hosted workspace snapshot tar entry path is unsafe.");
      await expect(access(path.join(tempRoot, "escape.txt"))).rejects.toThrow();
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });
});

function createTarArchive(entries: Array<{ body: Buffer; name: string }>): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(createTarHeader(entry.name, entry.body.byteLength));
    chunks.push(entry.body);
    const padding = (512 - (entry.body.byteLength % 512)) % 512;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function createTarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar", 257, 5, "ascii");
  header.write("00", 263, 2, "ascii");

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function writeTarOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, "0");
  buffer.write(text, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
