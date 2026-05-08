export const HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES = 50 * 1024 * 1024;

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
