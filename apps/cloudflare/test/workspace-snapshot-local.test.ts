import { createCipheriv, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile, mkdtemp, rm, access, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
  it.each([
    "../escape.txt",
    "/absolute.txt",
    "safe/..",
  ])("rejects unsafe tar member path %s before extraction", async (name) => {
    await expectUnsafeTarArchive({
      entries: [{
        body: Buffer.from("outside\n", "utf8"),
        name,
      }],
      expectedError: "Hosted workspace snapshot tar entry path is unsafe.",
    });
  });

  it.each([
    { name: "symlink", typeFlag: "2" },
    { name: "hardlink", typeFlag: "1" },
    { name: "fifo", typeFlag: "6" },
  ])("rejects unsafe tar $name entries before extraction", async ({ typeFlag }) => {
    await expectUnsafeTarArchive({
      entries: [{
        linkName: "target.txt",
        name: "link.txt",
        typeFlag,
      }],
      expectedError: "Hosted workspace snapshot tar entry type is unsafe.",
    });
  });

  it.each([
    {
      archiveOverride: ({ fileCount }: { fileCount: number; totalPlainBytes: number }) => ({
        fileCount: fileCount + 1,
      }),
      name: "file count",
    },
    {
      archiveOverride: ({ totalPlainBytes }: { fileCount: number; totalPlainBytes: number }) => ({
        totalPlainBytes: totalPlainBytes + 1,
      }),
      name: "plain byte count",
    },
  ])("rejects tar archives whose $name does not match the snapshot ref", async ({ archiveOverride }) => {
    await expectUnsafeTarArchive({
      archiveOverride,
      entries: [{
        body: Buffer.from("manifest mismatch\n", "utf8"),
        name: "safe/inside.txt",
      }],
      expectedError: "Hosted workspace snapshot restored state does not match its ref.",
      unwrittenRelativePath: "safe/inside.txt",
    });
  });

  it.each([
    {
      archiveOverride: ({ fileCount }: { fileCount: number; totalPlainBytes: number }) => ({
        fileCount: fileCount - 1,
      }),
      name: "file count",
    },
    {
      archiveOverride: ({ totalPlainBytes }: { fileCount: number; totalPlainBytes: number }) => ({
        totalPlainBytes: totalPlainBytes - 1,
      }),
      name: "plain byte count",
    },
  ])("rejects tar archives whose $name is understated before extraction", async ({ archiveOverride }) => {
    await expectUnsafeTarArchive({
      archiveOverride,
      entries: [{
        body: Buffer.from("manifest understatement\n", "utf8"),
        name: "safe/inside.txt",
      }],
      expectedError: "Hosted workspace snapshot archive manifest does not match its ref.",
      unwrittenRelativePath: "safe/inside.txt",
    });
  });

  it("rejects tar archives with too many empty directories before extraction", async () => {
    await expectUnsafeTarArchive({
      entries: Array.from({ length: 20_001 }, (_, index) => ({
        name: `empty-${index}/`,
        typeFlag: "5",
      })),
      expectedError: "Hosted workspace snapshot tar entry count is unsafe.",
    });
  });
});

async function expectUnsafeTarArchive(input: {
  archiveOverride?: (
    archive: { fileCount: number; totalPlainBytes: number },
  ) => Partial<HostedWorkspaceSnapshotV2Ref["archive"]>;
  entries: TarArchiveEntry[];
  expectedError: string;
  unwrittenRelativePath?: string;
}): Promise<void> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
  const durableRoot = path.join(tempRoot, "durable");
  const existingDurableFile = path.join(durableRoot, "existing.txt");
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
  const plaintextArchive = zstdCompress(createTarArchive(input.entries));
  const fileCount = input.entries
    .filter((entry) => entry.typeFlag === undefined || entry.typeFlag === "" || entry.typeFlag === "0")
    .length;
  const totalPlainBytes = input.entries
    .reduce((total, entry) => total + (entry.body?.byteLength ?? 0), 0);
  try {
    if (input.unwrittenRelativePath) {
      await mkdir(durableRoot, { mode: 0o700, recursive: true });
      await writeFile(existingDurableFile, "existing durable root\n", { mode: 0o600 });
    }
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
        compression: "zstd",
        encryptedByteSize: encryptedObject.byteLength,
        encryptedObjectSha256: sha256Hex(encryptedObject),
        fileCount,
        format: "tar",
        plaintextArchiveSha256: sha256Hex(plaintextArchive),
        totalPlainBytes,
        ...(input.archiveOverride?.({ fileCount, totalPlainBytes }) ?? {}),
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

    await expect(restoreEncryptedWorkspaceSnapshot({
      dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
      durableRoot,
      encryptedFilePath,
      ref,
    })).rejects.toThrow(input.expectedError);
    await expect(access(path.join(tempRoot, "escape.txt"))).rejects.toThrow();
    if (input.unwrittenRelativePath) {
      await expect(access(path.join(durableRoot, input.unwrittenRelativePath))).rejects.toThrow();
      await expect(readFile(existingDurableFile, "utf8")).resolves.toBe("existing durable root\n");
    }
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
    dataKey.fill(0);
  }
}

interface TarArchiveEntry {
  body?: Buffer;
  linkName?: string;
  name: string;
  typeFlag?: string;
}

function createTarArchive(entries: TarArchiveEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const body = entry.body ?? Buffer.alloc(0);
    chunks.push(createTarHeader(entry.name, body.byteLength, {
      linkName: entry.linkName,
      typeFlag: entry.typeFlag,
    }));
    chunks.push(body);
    const padding = (512 - (body.byteLength % 512)) % 512;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function createTarHeader(
  name: string,
  size: number,
  input: {
    linkName?: string;
    typeFlag?: string;
  } = {},
): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(input.typeFlag ?? "0", 156, 1, "ascii");
  if (input.linkName) {
    header.write(input.linkName, 157, 100, "utf8");
  }
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

function zstdCompress(bytes: Buffer): Buffer {
  return execFileSync("zstd", [
    "--fast=1",
    "--no-progress",
    "--stdout",
  ], {
    input: bytes,
  });
}
