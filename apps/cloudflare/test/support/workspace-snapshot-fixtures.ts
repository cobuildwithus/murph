import { execFileSync } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";

import {
  buildHostedWorkspaceSnapshotV2Aad,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  serializeHostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

export interface TestTarEntry {
  content?: Buffer | string;
  groupName?: string;
  linkPath?: string;
  ownerName?: string;
  path: string;
  type: "0" | "1" | "2" | "5" | "6" | "7" | "x";
}

export async function createAuthenticatedTarSnapshotFixture(input: {
  dataKey: Uint8Array;
  entries: readonly TestTarEntry[];
  fileCount?: number;
  snapshotId: string;
  totalPlainBytes?: number;
}): Promise<{
  compressedArchive: Buffer;
  encryptedBytes: Buffer;
  ref: HostedWorkspaceSnapshotV2Ref;
}> {
  const tarArchive = createTestTarArchive(input.entries);
  let compressedArchive: Buffer;
  try {
    compressedArchive = execFileSync("zstd", ["-1", "--stdout"], {
      input: tarArchive,
      maxBuffer: 64 * 1024 * 1024,
    });
  } finally {
    tarArchive.fill(0);
  }
  const regularFiles = input.entries.filter((entry) => entry.type === "0");
  return createAuthenticatedSnapshotFixture({
    compressedArchive,
    dataKey: input.dataKey,
    fileCount: input.fileCount ?? regularFiles.length,
    snapshotId: input.snapshotId,
    totalPlainBytes: input.totalPlainBytes
      ?? regularFiles.reduce(
        (total, entry) => total + (entry.content === undefined
          ? 0
          : Buffer.byteLength(entry.content)),
        0,
      ),
  });
}

export function createAuthenticatedSnapshotFixture(input: {
  compressedArchive: Buffer;
  dataKey: Uint8Array;
  fileCount: number;
  snapshotId: string;
  totalPlainBytes: number;
}): {
  compressedArchive: Buffer;
  encryptedBytes: Buffer;
  ref: HostedWorkspaceSnapshotV2Ref;
} {
  const objectKey = `users/hsn_test/workspace-snapshots/${input.snapshotId}.snapshot.enc`;
  const userId = "member_123";
  const aad = buildHostedWorkspaceSnapshotV2Aad({
    objectKey,
    snapshotId: input.snapshotId,
    userId,
  });
  const ivBase64 = Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 121))
    .toString("base64url");
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(input.dataKey),
    Buffer.from(ivBase64, "base64url"),
  );
  cipher.setAAD(Buffer.from(serializeHostedWorkspaceSnapshotV2Aad(aad)));
  const encryptedBytes = Buffer.concat([
    cipher.update(input.compressedArchive),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    compressedArchive: input.compressedArchive,
    encryptedBytes,
    ref: {
      archive: {
        compression: "zstd",
        encryptedByteSize: encryptedBytes.byteLength,
        encryptedObjectSha256: createHash("sha256").update(encryptedBytes).digest("hex"),
        fileCount: input.fileCount,
        format: "tar",
        plaintextArchiveSha256: createHash("sha256")
          .update(input.compressedArchive)
          .digest("hex"),
        totalPlainBytes: input.totalPlainBytes,
      },
      createdAt: "2026-05-20T00:00:00.000Z",
      encryption: {
        aad,
        ivBase64,
        rootKeyId: "root_key_test",
        scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
        wrappedDataKey: "wrapped_data_key_test",
      },
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
      snapshotId: input.snapshotId,
      upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
      userId,
    },
  };
}

export function createTestPaxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let byteLength = Buffer.byteLength(body) + 1;
  while (true) {
    const record = `${byteLength}${body}`;
    const actualByteLength = Buffer.byteLength(record);
    if (actualByteLength === byteLength) {
      return record;
    }
    byteLength = actualByteLength;
  }
}

function createTestTarArchive(entries: readonly TestTarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = typeof entry.content === "string"
      ? Buffer.from(entry.content, "utf8")
      : entry.content ?? Buffer.alloc(0);
    const header = Buffer.alloc(512);
    writeTestTarString(header, 0, 100, entry.path);
    writeTestTarOctal(header, 100, 8, entry.type === "5" ? 0o755 : 0o600);
    writeTestTarOctal(header, 108, 8, 0);
    writeTestTarOctal(header, 116, 8, 0);
    const hasBody = entry.type === "0" || entry.type === "x";
    writeTestTarOctal(header, 124, 12, hasBody ? content.byteLength : 0);
    writeTestTarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header.write(entry.type, 156, 1, "ascii");
    writeTestTarString(header, 157, 100, entry.linkPath ?? "");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    writeTestTarString(header, 265, 32, entry.ownerName ?? "runner");
    writeTestTarString(header, 297, 32, entry.groupName ?? "runner");
    const checksum = header.reduce((total, byte) => total + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(header);
    if (hasBody) {
      blocks.push(content);
      const padding = (512 - (content.byteLength % 512)) % 512;
      if (padding > 0) {
        blocks.push(Buffer.alloc(padding));
      }
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function writeTestTarString(
  target: Buffer,
  offset: number,
  length: number,
  value: string,
): void {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength > length) {
    throw new Error("Test tar string exceeded its fixed field.");
  }
  encoded.copy(target, offset);
}

function writeTestTarOctal(
  target: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  target.write(value.toString(8).padStart(length - 1, "0"), offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}
