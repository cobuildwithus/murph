import {
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
} from "@murphai/hosted-execution/browser-vault";

export {
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
};

const utf8Encoder = new TextEncoder();

export class HostedBrowserVaultReplicaTooLargeError extends Error {
  readonly byteLength: number;
  readonly maxBytes: number;

  constructor(input: {
    byteLength: number;
    maxBytes?: number;
  }) {
    const maxBytes = input.maxBytes ?? HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES;
    super(`Hosted browser vault replica exceeded the ${maxBytes} byte size limit.`);
    this.name = "HostedBrowserVaultReplicaTooLargeError";
    this.byteLength = input.byteLength;
    this.maxBytes = maxBytes;
  }
}

export function encodeHostedBrowserVaultReplicaJson(input: {
  maxBytes?: number;
  replica: unknown;
}): {
  byteLength: number;
  bytes: Uint8Array;
} {
  const bytes = utf8Encoder.encode(JSON.stringify(input.replica));
  assertHostedBrowserVaultReplicaByteLength({
    byteLength: bytes.byteLength,
    maxBytes: input.maxBytes,
  });
  return {
    byteLength: bytes.byteLength,
    bytes,
  };
}

export async function encodeHostedBrowserVaultReplicaShardJson(input: {
  maxBytes?: number;
  shard: unknown;
}): Promise<{
  byteLength: number;
  bytes: Uint8Array;
  contentEncoding: "gzip" | "identity";
  encodedByteLength: number;
}> {
  const decodedBytes = utf8Encoder.encode(JSON.stringify(input.shard));
  assertHostedBrowserVaultReplicaByteLength({
    byteLength: decodedBytes.byteLength,
    maxBytes: input.maxBytes,
  });
  const body = new Blob([toArrayBuffer(decodedBytes)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(body).arrayBuffer());
  if (bytes.byteLength >= decodedBytes.byteLength) {
    return {
      byteLength: decodedBytes.byteLength,
      bytes: decodedBytes,
      contentEncoding: "identity",
      encodedByteLength: decodedBytes.byteLength,
    };
  }
  return {
    byteLength: decodedBytes.byteLength,
    bytes,
    contentEncoding: "gzip",
    encodedByteLength: bytes.byteLength,
  };
}

export function measureHostedBrowserVaultReplicaBytes(replica: unknown): number {
  return utf8Encoder.encode(JSON.stringify(replica)).byteLength;
}

export function assertHostedBrowserVaultReplicaByteLength(input: {
  byteLength: number;
  maxBytes?: number;
}): void {
  const maxBytes = input.maxBytes ?? HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES;
  if (input.byteLength > maxBytes) {
    throw new HostedBrowserVaultReplicaTooLargeError({
      byteLength: input.byteLength,
      maxBytes,
    });
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
