import { promisify } from "node:util";
import { zstdCompress, zstdDecompress } from "node:zlib";

import type { Prisma } from "@prisma/client";
import {
  getHostedCryptoDomainForLane,
  type HostedCryptoDomain,
} from "@murphai/runtime-state";

import {
  prepareHostedDomainRootForWeb,
  readPreparedHostedDomainRootForWebLocal,
  revalidatePreparedHostedDomainRootForWebTx,
  type PreparedHostedDomainRootForWeb,
} from "../../hosted-crypto/domain-root-store";
import {
  isHostedSecureBoxStringTestCodecConfiguredForTests,
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
  sealHostedUserSecureBoxStringFromPreparedRoot,
  type HostedSecureBoxPrismaClient,
} from "../../hosted-crypto/secure-box";

const zstdCompressAsync = promisify(zstdCompress);
const zstdDecompressAsync = promisify(zstdDecompress);

const HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_SCHEMA = "murph.hosted-device-sync-dirty-payload.v1";
const HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_DOMAIN =
  getHostedCryptoDomainForLane("device-sync-payload");

type PreparedHostedDeviceSyncDirtyPayloadCryptoDetails =
  | { mode: "test-codec" }
  | {
      mode: "prepared-root";
      preparedRoot: PreparedHostedDomainRootForWeb;
    };

const preparedHostedDeviceSyncDirtyPayloadCrypto = new WeakMap<
  PreparedHostedDeviceSyncDirtyPayloadCrypto,
  PreparedHostedDeviceSyncDirtyPayloadCryptoDetails
>();

export interface PreparedHostedDeviceSyncDirtyPayloadCrypto {
  readonly domain: HostedCryptoDomain;
  readonly rootKeyId: string;
  readonly userId: string;
}

type HostedDeviceSyncDirtyPayloadEnvelopeV1 = {
  data: string;
  compression: "zstd";
  encoding: "base64url";
  schema: typeof HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_SCHEMA;
};

export async function prepareHostedDeviceSyncDirtyPayloadCrypto(input: {
  prisma: HostedSecureBoxPrismaClient;
  userId: string;
}): Promise<PreparedHostedDeviceSyncDirtyPayloadCrypto> {
  if (isHostedSecureBoxStringTestCodecConfiguredForTests()) {
    const prepared = Object.freeze({
      domain: HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_DOMAIN,
      rootKeyId: "test-codec",
      userId: input.userId,
    });
    preparedHostedDeviceSyncDirtyPayloadCrypto.set(prepared, {
      mode: "test-codec",
    });
    return prepared;
  }

  const preparedRoot = await prepareHostedDomainRootForWeb({
    domain: HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_DOMAIN,
    prepareMissing: false,
    prisma: input.prisma,
    reason: "device-sync.dirty-payload",
    userId: input.userId,
  });
  const prepared = Object.freeze({
    domain: HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_DOMAIN,
    rootKeyId: preparedRoot.rootKeyId,
    userId: input.userId,
  });
  preparedHostedDeviceSyncDirtyPayloadCrypto.set(prepared, {
    mode: "prepared-root",
    preparedRoot,
  });
  return prepared;
}

export async function revalidatePreparedHostedDeviceSyncDirtyPayloadCryptoTx(input: {
  prepared: PreparedHostedDeviceSyncDirtyPayloadCrypto;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const details = requirePreparedHostedDeviceSyncDirtyPayloadCrypto(input.prepared);
  if (details.mode === "test-codec") {
    return;
  }
  await revalidatePreparedHostedDomainRootForWebTx({
    prepared: details.preparedRoot,
    tx: input.tx,
  });
}

export async function sealHostedDeviceSyncDirtyPayloadJson(input: {
  connectionId: string;
  dirtyRevision: bigint;
  payloadId: string;
  prisma?: HostedSecureBoxPrismaClient;
  provider: string;
  userId: string;
  value: unknown;
}): Promise<string> {
  const plaintext = Buffer.from(JSON.stringify(input.value), "utf8");
  const compressed = await zstdCompressAsync(plaintext);
  const envelope: HostedDeviceSyncDirtyPayloadEnvelopeV1 = {
    compression: "zstd",
    data: compressed.toString("base64url"),
    encoding: "base64url",
    schema: HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_SCHEMA,
  };
  const encrypted = await sealHostedUserSecureBoxString({
    aad: buildHostedDeviceSyncDirtyPayloadAad(input),
    lane: "device-sync-payload",
    prisma: input.prisma,
    scope: buildHostedDeviceSyncDirtyPayloadScope(input.payloadId),
    userId: input.userId,
    value: JSON.stringify(envelope),
  });

  if (!encrypted) {
    throw new TypeError("Hosted device-sync dirty payload encryption returned an empty ciphertext.");
  }

  return encrypted;
}

export async function sealHostedDeviceSyncDirtyPayloadJsonFromPreparedCrypto(input: {
  connectionId: string;
  dirtyRevision: bigint;
  payloadId: string;
  prepared: PreparedHostedDeviceSyncDirtyPayloadCrypto;
  provider: string;
  userId: string;
  value: unknown;
}): Promise<string> {
  const details = requirePreparedHostedDeviceSyncDirtyPayloadCrypto(input.prepared);
  if (
    input.prepared.domain !== HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_DOMAIN
    || input.prepared.userId !== input.userId
    || input.prepared.rootKeyId.trim().length === 0
  ) {
    throw new TypeError(
      "Hosted device-sync dirty payload prepared crypto identity does not match the payload.",
    );
  }

  const plaintext = Buffer.from(JSON.stringify(input.value), "utf8");
  const compressed = await zstdCompressAsync(plaintext);
  const envelope: HostedDeviceSyncDirtyPayloadEnvelopeV1 = {
    compression: "zstd",
    data: compressed.toString("base64url"),
    encoding: "base64url",
    schema: HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_SCHEMA,
  };
  const sealInput = {
    aad: buildHostedDeviceSyncDirtyPayloadAad(input),
    lane: "device-sync-payload" as const,
    scope: buildHostedDeviceSyncDirtyPayloadScope(input.payloadId),
    userId: input.userId,
    value: JSON.stringify(envelope),
  };
  const encrypted = details.mode === "test-codec"
    ? await sealHostedUserSecureBoxString(sealInput)
    : await sealHostedUserSecureBoxStringFromPreparedRoot({
        ...sealInput,
        preparedRoot: readPreparedHostedDomainRootForWebLocal(
          details.preparedRoot,
        ).root,
        preparedRootKeyId: input.prepared.rootKeyId,
      });

  if (!encrypted) {
    throw new TypeError("Hosted device-sync dirty payload encryption returned an empty ciphertext.");
  }
  return encrypted;
}

export async function openHostedDeviceSyncDirtyPayloadJson(input: {
  connectionId: string;
  dirtyRevision: bigint;
  payloadId: string;
  prisma?: HostedSecureBoxPrismaClient;
  provider: string;
  userId: string;
  value: string;
}): Promise<unknown> {
  const plaintext = await openHostedUserSecureBoxString({
    aad: buildHostedDeviceSyncDirtyPayloadAad(input),
    lane: "device-sync-payload",
    prisma: input.prisma,
    scope: buildHostedDeviceSyncDirtyPayloadScope(input.payloadId),
    userId: input.userId,
    value: input.value,
  });

  if (!plaintext) {
    throw new TypeError("Hosted device-sync dirty payload decryption returned an empty plaintext.");
  }

  const envelope = parseHostedDeviceSyncDirtyPayloadEnvelope(JSON.parse(plaintext));
  const compressed = Buffer.from(envelope.data, "base64url");
  const decompressed = await zstdDecompressAsync(compressed);
  return JSON.parse(decompressed.toString("utf8"));
}

function buildHostedDeviceSyncDirtyPayloadScope(payloadId: string): string {
  return `device-sync-dirty-payload:${payloadId}`;
}

function buildHostedDeviceSyncDirtyPayloadAad(input: {
  connectionId: string;
  dirtyRevision: bigint;
  payloadId: string;
  provider: string;
}) {
  return {
    field: "resource",
    objectKey: `${input.provider}:${input.connectionId}`,
    purpose: "device-sync-dirty-payload",
    rowId: input.payloadId,
    sequence: input.dirtyRevision,
    table: "device_sync_dirty_payload",
  };
}

function parseHostedDeviceSyncDirtyPayloadEnvelope(
  value: unknown,
): HostedDeviceSyncDirtyPayloadEnvelopeV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted device-sync dirty payload envelope must be an object.");
  }

  const record = value as Record<string, unknown>;
  if (
    record.schema !== HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_SCHEMA
    || record.compression !== "zstd"
    || record.encoding !== "base64url"
    || typeof record.data !== "string"
  ) {
    throw new TypeError("Hosted device-sync dirty payload envelope is invalid.");
  }

  return {
    compression: "zstd",
    data: record.data,
    encoding: "base64url",
    schema: HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_SCHEMA,
  };
}

function requirePreparedHostedDeviceSyncDirtyPayloadCrypto(
  prepared: PreparedHostedDeviceSyncDirtyPayloadCrypto,
): PreparedHostedDeviceSyncDirtyPayloadCryptoDetails {
  if (!prepared || typeof prepared !== "object") {
    throw new TypeError("Hosted device-sync dirty payload requires prepared crypto.");
  }
  const details = preparedHostedDeviceSyncDirtyPayloadCrypto.get(prepared);
  if (!details) {
    throw new TypeError(
      "Hosted device-sync dirty payload prepared crypto is not the exact request-local capability.",
    );
  }
  return details;
}
