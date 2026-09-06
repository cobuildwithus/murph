import {
  constants,
  createGunzip,
  createGzip,
  createBrotliCompress,
  createBrotliDecompress,
  gunzipSync,
  gzipSync,
  brotliCompressSync,
  brotliDecompressSync,
} from "node:zlib";

export type ShardCompression = "gzip" | "brotli";

const BROTLI_COMPRESSION_OPTIONS = {
  params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
};

export function isShardCompression(kind: string): kind is ShardCompression {
  return kind === "gzip" || kind === "brotli";
}

export function shardCompressionFromPath(relativePath: string): ShardCompression {
  if (relativePath.endsWith(".gz")) return "gzip";
  if (relativePath.endsWith(".br")) return "brotli";
  throw new TypeError("Expected a gzip or Brotli shard path.");
}

export function compressShard(bytes: Uint8Array | string, kind: ShardCompression): Buffer {
  return kind === "gzip"
    ? gzipSync(bytes, { level: 6 })
    : brotliCompressSync(bytes, BROTLI_COMPRESSION_OPTIONS);
}

export function decompressShard(
  bytes: Uint8Array,
  kind: ShardCompression,
  maxOutputLength: number,
): Buffer {
  return kind === "gzip"
    ? gunzipSync(bytes, { maxOutputLength })
    : brotliDecompressSync(bytes, { maxOutputLength });
}

export function createShardCompressor(kind: ShardCompression) {
  return kind === "gzip"
    ? createGzip({ level: 6 })
    : createBrotliCompress(BROTLI_COMPRESSION_OPTIONS);
}

export function createShardDecompressor(kind: ShardCompression) {
  return kind === "gzip" ? createGunzip() : createBrotliDecompress();
}
