import { randomBytes } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";

import { expect, test } from "vitest";

import {
  readBoundedZipDirectory,
  readBoundedZipEntry,
} from "../src/bounded-zip.ts";

test("bounded ZIP entry reading observes cancellation between chunks", async () => {
  const contents = randomBytes(8 * 1024 * 1024);
  const archive = createSingleEntryZip("payload.bin", contents);
  const directory = await readBoundedZipDirectory(archive);
  const entry = directory.entries[0];
  if (!entry) {
    throw new Error("Expected one ZIP entry.");
  }
  const controller = new AbortController();
  const read = readBoundedZipEntry(archive, entry, {
    maxOutputBytes: contents.byteLength,
    signal: controller.signal,
  });
  setImmediate(() => controller.abort());

  await expect(read).rejects.toMatchObject({ name: "AbortError" });
});

function createSingleEntryZip(name: string, contents: Buffer): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const compressed = deflateRawSync(contents);
  const entryCrc32 = crc32(contents) >>> 0;
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt32LE(entryCrc32, 14);
  localHeader.writeUInt32LE(compressed.byteLength, 18);
  localHeader.writeUInt32LE(contents.byteLength, 22);
  localHeader.writeUInt16LE(nameBytes.byteLength, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x0800, 8);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt32LE(entryCrc32, 16);
  centralHeader.writeUInt32LE(compressed.byteLength, 20);
  centralHeader.writeUInt32LE(contents.byteLength, 24);
  centralHeader.writeUInt16LE(nameBytes.byteLength, 28);

  const centralDirectory = Buffer.concat([centralHeader, nameBytes]);
  const centralDirectoryOffset = localHeader.byteLength
    + nameBytes.byteLength
    + compressed.byteLength;
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(1, 8);
  endOfCentralDirectory.writeUInt16LE(1, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.byteLength, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);

  return Buffer.concat([
    localHeader,
    nameBytes,
    compressed,
    centralDirectory,
    endOfCentralDirectory,
  ]);
}
