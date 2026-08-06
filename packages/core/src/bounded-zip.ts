import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw, crc32 } from "node:zlib";

const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;
const ZIP_MAX_EOCD_SEARCH_BYTES = 65_557;
const ZIP_DEFAULT_MAX_ENTRY_COUNT = 20_000;
const ZIP_STREAM_CHUNK_BYTES = 64 * 1024;
const ZIP_DIRECTORY_YIELD_INTERVAL = 256;

export type BoundedZipErrorCode =
  | "ZIP_INVALID"
  | "ZIP_TOO_LARGE"
  | "ZIP_UNSUPPORTED";

export class BoundedZipError extends Error {
  readonly code: BoundedZipErrorCode;

  constructor(code: BoundedZipErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BoundedZipError";
    this.code = code;
  }
}

export interface BoundedZipEntry {
  centralCommentLength: number;
  centralExtraLength: number;
  compressedSize: number;
  compressionMethod: number;
  crc32: number;
  flags: number;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
}

export interface BoundedZipDirectory {
  centralDirectoryOffset: number;
  commentLength: number;
  entries: BoundedZipEntry[];
}

export interface BoundedZipEntryContents {
  bytes: Buffer;
  contentEnd: number;
  contentOffset: number;
  localExtraLength: number;
}

export async function readBoundedZipDirectory(
  archive: Buffer,
  options: {
    maxEntries?: number;
    signal?: AbortSignal | null;
  } = {},
): Promise<BoundedZipDirectory> {
  options.signal?.throwIfAborted();
  const eocdOffset = findZipEndOfCentralDirectory(archive);
  if (eocdOffset < 0) {
    throw new BoundedZipError(
      "ZIP_INVALID",
      "ZIP central directory is missing.",
    );
  }
  assertZipRange(archive, eocdOffset, 22);
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(eocdOffset + 6);
  const diskEntryCount = archive.readUInt16LE(eocdOffset + 8);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
  const commentLength = archive.readUInt16LE(eocdOffset + 20);
  const maxEntries = options.maxEntries ?? ZIP_DEFAULT_MAX_ENTRY_COUNT;
  if (
    diskNumber !== 0
    || centralDirectoryDisk !== 0
    || diskEntryCount !== entryCount
    || entryCount === ZIP64_MARKER_16
    || centralDirectorySize === ZIP64_MARKER_32
    || centralDirectoryOffset === ZIP64_MARKER_32
  ) {
    throw new BoundedZipError(
      "ZIP_UNSUPPORTED",
      "ZIP central directory uses an unsupported variant.",
    );
  }
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || entryCount > maxEntries) {
    throw new BoundedZipError(
      "ZIP_TOO_LARGE",
      "ZIP central directory exceeds the entry-count limit.",
    );
  }
  if (
    eocdOffset + 22 + commentLength !== archive.byteLength
    || centralDirectoryOffset + centralDirectorySize !== eocdOffset
  ) {
    throw new BoundedZipError(
      "ZIP_INVALID",
      "ZIP central directory range is invalid.",
    );
  }
  assertZipRange(archive, centralDirectoryOffset, centralDirectorySize);

  const entries: BoundedZipEntry[] = [];
  const names = new Set<string>();
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    options.signal?.throwIfAborted();
    if (index > 0 && index % ZIP_DIRECTORY_YIELD_INTERVAL === 0) {
      await yieldToEventLoop(options.signal);
    }
    assertZipRange(archive, offset, 46);
    if (archive.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new BoundedZipError(
        "ZIP_INVALID",
        "ZIP central directory entry is invalid.",
      );
    }
    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const entryCrc32 = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const centralExtraLength = archive.readUInt16LE(offset + 30);
    const centralCommentLength = archive.readUInt16LE(offset + 32);
    const diskNumberStart = archive.readUInt16LE(offset + 34);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    if (
      compressedSize === ZIP64_MARKER_32
      || uncompressedSize === ZIP64_MARKER_32
      || localHeaderOffset === ZIP64_MARKER_32
      || diskNumberStart !== 0
      || (flags & 0x1) !== 0
    ) {
      throw new BoundedZipError(
        "ZIP_UNSUPPORTED",
        "ZIP entry uses an unsupported variant.",
      );
    }
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    assertZipRange(
      archive,
      nameStart,
      fileNameLength + centralExtraLength + centralCommentLength,
    );
    const name = archive.subarray(nameStart, nameEnd).toString("utf8");
    if (
      name.length === 0
      || name.includes("\uFFFD")
      || name.includes("\u0000")
      || names.has(name)
    ) {
      throw new BoundedZipError("ZIP_INVALID", "ZIP entry name is invalid.");
    }
    names.add(name);
    entries.push({
      centralCommentLength,
      centralExtraLength,
      compressedSize,
      compressionMethod,
      crc32: entryCrc32,
      flags,
      localHeaderOffset,
      name,
      uncompressedSize,
    });
    offset = nameEnd + centralExtraLength + centralCommentLength;
  }
  if (offset !== eocdOffset) {
    throw new BoundedZipError(
      "ZIP_INVALID",
      "ZIP central directory size is invalid.",
    );
  }
  options.signal?.throwIfAborted();
  return { centralDirectoryOffset, commentLength, entries };
}

export async function readBoundedZipEntry(
  archive: Buffer,
  entry: BoundedZipEntry,
  options: {
    maxOutputBytes: number;
    signal?: AbortSignal | null;
  },
): Promise<BoundedZipEntryContents> {
  options.signal?.throwIfAborted();
  if (
    !Number.isSafeInteger(options.maxOutputBytes)
    || options.maxOutputBytes < 0
    || entry.uncompressedSize > options.maxOutputBytes
  ) {
    throw new BoundedZipError(
      "ZIP_TOO_LARGE",
      "ZIP entry exceeds the extraction limit.",
    );
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new BoundedZipError(
      "ZIP_UNSUPPORTED",
      "ZIP entry uses an unsupported compression method.",
    );
  }

  assertZipRange(archive, entry.localHeaderOffset, 30);
  if (archive.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new BoundedZipError("ZIP_INVALID", "ZIP local header is invalid.");
  }
  const localFlags = archive.readUInt16LE(entry.localHeaderOffset + 6);
  const localCompressionMethod = archive.readUInt16LE(entry.localHeaderOffset + 8);
  const fileNameLength = archive.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraLength = archive.readUInt16LE(entry.localHeaderOffset + 28);
  const nameStart = entry.localHeaderOffset + 30;
  const contentOffset = nameStart + fileNameLength + localExtraLength;
  const contentEnd = contentOffset + entry.compressedSize;
  assertZipRange(archive, nameStart, fileNameLength + localExtraLength);
  assertZipRange(archive, contentOffset, entry.compressedSize);
  if (
    localFlags !== entry.flags
    || localCompressionMethod !== entry.compressionMethod
    || archive.subarray(nameStart, nameStart + fileNameLength).toString("utf8") !== entry.name
  ) {
    throw new BoundedZipError(
      "ZIP_INVALID",
      "ZIP local and central entry metadata disagree.",
    );
  }

  const compressed = archive.subarray(contentOffset, contentEnd);
  const chunks: Buffer[] = [];
  let outputBytes = 0;
  let outputCrc32 = 0;
  const collect = async (source: AsyncIterable<Uint8Array>): Promise<void> => {
    for await (const rawChunk of source) {
      options.signal?.throwIfAborted();
      const chunk = Buffer.from(rawChunk);
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        throw new BoundedZipError(
          "ZIP_TOO_LARGE",
          "ZIP entry exceeds the extraction limit.",
        );
      }
      outputCrc32 = crc32(chunk, outputCrc32) >>> 0;
      chunks.push(chunk);
      await yieldToEventLoop(options.signal);
    }
  };

  if (entry.compressionMethod === 0) {
    await collect(readBufferChunks(compressed, options.signal));
  } else {
    try {
      await pipeline(
        Readable.from(readBufferChunks(compressed, options.signal), {
          objectMode: false,
        }),
        createInflateRaw(),
        collect,
        options.signal ? { signal: options.signal } : {},
      );
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof BoundedZipError) {
        throw error;
      }
      throw new BoundedZipError(
        "ZIP_INVALID",
        "ZIP entry contains invalid compressed data.",
        { cause: error },
      );
    }
  }

  options.signal?.throwIfAborted();
  if (outputBytes !== entry.uncompressedSize || outputCrc32 !== entry.crc32) {
    throw new BoundedZipError(
      "ZIP_INVALID",
      "ZIP entry integrity check failed.",
    );
  }
  const bytes = Buffer.concat(chunks, outputBytes);
  options.signal?.throwIfAborted();
  return { bytes, contentEnd, contentOffset, localExtraLength };
}

async function* readBufferChunks(
  value: Buffer,
  signal?: AbortSignal | null,
): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < value.byteLength; offset += ZIP_STREAM_CHUNK_BYTES) {
    signal?.throwIfAborted();
    yield value.subarray(
      offset,
      Math.min(value.byteLength, offset + ZIP_STREAM_CHUNK_BYTES),
    );
  }
}

function findZipEndOfCentralDirectory(archive: Buffer): number {
  const firstOffset = Math.max(
    0,
    archive.byteLength - ZIP_MAX_EOCD_SEARCH_BYTES,
  );
  for (let offset = archive.byteLength - 22; offset >= firstOffset; offset -= 1) {
    if (
      archive.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE
      && offset + 22 + archive.readUInt16LE(offset + 20) === archive.byteLength
    ) {
      return offset;
    }
  }
  return -1;
}

function assertZipRange(archive: Buffer, offset: number, length: number): void {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset + length > archive.byteLength
  ) {
    throw new BoundedZipError("ZIP_INVALID", "ZIP entry range is invalid.");
  }
}

async function yieldToEventLoop(signal?: AbortSignal | null): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  signal?.throwIfAborted();
}
