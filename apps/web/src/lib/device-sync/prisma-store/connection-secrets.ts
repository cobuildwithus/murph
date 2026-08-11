import {
  openHostedUserSecureBoxString,
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxString,
  type HostedSecureBoxPrismaClient,
} from "../../hosted-crypto/secure-box";
import { runWithHostedDomainRootUnwrapCache } from "../../hosted-crypto/domain-root-unwrap-cache";
import { maybeIsoTimestamp, normalizeNullableString } from "../shared";
import {
  normalizeHostedDeviceSyncCredentialKind,
  type HostedConnectionRecord,
} from "./connection-records";

export const HOSTED_DEVICE_SYNC_SECURE_BOX_KEY_VERSION = "hosted-device-secure-box:v1";

export type HostedDeviceSyncSecretPurpose =
  | "device-sync-access-token"
  | "device-sync-external-account-id"
  | "device-sync-refresh-token";

export type HostedDeviceSyncSecretField =
  | "accessToken"
  | "externalAccountId"
  | "refreshToken";

export interface HostedDeviceSyncSecretTestCodec {
  readonly keyVersion: string;
  decrypt(value: string): string;
  encrypt(value: string): string;
}

export type HostedStoredConnectionTokenBundle = {
  accessToken: string;
  accessTokenExpiresAt: string | null;
  keyVersion: string;
  refreshToken: string | null;
  tokenVersion: number;
};

export interface HostedRuntimeConnectionSecretMaterial {
  externalAccountId: string | null;
  tokenBundle: HostedStoredConnectionTokenBundle | null;
}

export async function encryptHostedConnectionSecret(input: {
  connectionId: string;
  provider: string;
  prisma?: HostedSecureBoxPrismaClient;
  purpose: HostedDeviceSyncSecretPurpose;
  testCodec?: HostedDeviceSyncSecretTestCodec | null;
  tokenVersion?: number | null;
  userId: string;
  value: string;
}): Promise<string> {
  const testCodec = normalizeHostedDeviceSyncSecretTestCodec(input.testCodec);
  if (testCodec) {
    return testCodec.encrypt(input.value);
  }

  const descriptor = resolveHostedDeviceSyncSecretDescriptor(input.purpose, input.connectionId);
  const encrypted = await sealHostedUserSecureBoxString({
    aad: buildHostedDeviceSyncSecretAad({
      connectionId: input.connectionId,
      field: descriptor.field,
      provider: input.provider,
      purpose: input.purpose,
      tokenVersion: input.tokenVersion,
    }),
    lane: descriptor.lane,
    prisma: input.prisma,
    scope: descriptor.scope,
    userId: input.userId,
    value: input.value,
  });

  if (!encrypted) {
    throw new TypeError("Hosted device-sync secure-box encryption returned an empty ciphertext.");
  }

  return encrypted;
}

export async function readHostedStoredTokenBundle(
  record: HostedConnectionRecord,
  testCodec?: HostedDeviceSyncSecretTestCodec | null,
  prisma?: HostedSecureBoxPrismaClient,
): Promise<HostedStoredConnectionTokenBundle | null> {
  if (normalizeHostedDeviceSyncCredentialKind(record.credentialKind) !== "oauth_tokens") {
    return null;
  }

  const accessTokenEncrypted = normalizeNullableString(record.accessTokenEncrypted);
  const keyVersion = normalizeNullableString(record.keyVersion) ?? HOSTED_DEVICE_SYNC_SECURE_BOX_KEY_VERSION;
  const tokenVersion = typeof record.tokenVersion === "number" ? record.tokenVersion : null;

  if (!accessTokenEncrypted || tokenVersion === null) {
    return null;
  }
  if (!Number.isInteger(tokenVersion) || tokenVersion <= 0) {
    throw new TypeError("Hosted device-sync tokenVersion must be a positive integer.");
  }

  return {
    accessToken: await decryptHostedConnectionSecret({
      connectionId: record.id,
      provider: record.provider,
      prisma,
      purpose: "device-sync-access-token",
      testCodec,
      tokenVersion,
      userId: record.userId,
      value: accessTokenEncrypted,
    }),
    accessTokenExpiresAt: maybeIsoTimestamp(record.accessTokenExpiresAt),
    keyVersion,
    refreshToken: normalizeNullableString(record.refreshTokenEncrypted)
      ? await decryptHostedConnectionSecret({
        connectionId: record.id,
        provider: record.provider,
        prisma,
        purpose: "device-sync-refresh-token",
        testCodec,
        tokenVersion,
        userId: record.userId,
        value: normalizeNullableString(record.refreshTokenEncrypted)!,
      })
      : null,
    tokenVersion,
  };
}

export async function readHostedStoredExternalAccountId(
  record: HostedConnectionRecord,
  testCodec?: HostedDeviceSyncSecretTestCodec | null,
  prisma?: HostedSecureBoxPrismaClient,
): Promise<string | null> {
  const payload = normalizeNullableString(record.externalAccountIdEncrypted);

  if (!payload) {
    return null;
  }

  return await decryptHostedConnectionSecret({
    connectionId: record.id,
    provider: record.provider,
    prisma,
    purpose: "device-sync-external-account-id",
    testCodec,
    tokenVersion: null,
    userId: record.userId,
    value: payload,
  });
}

/**
 * Opens one runtime page's device secrets as two lane-aware secure-box sets.
 * Only connections whose token material can be emitted are admitted to the
 * token set; redacted, terminal, leased, and application-blocked rows never
 * have token ciphertext opened. The existing request-scoped root memo keeps
 * the two lane opens on one root-metadata read without introducing durable or
 * process-global cache state.
 */
export async function readHostedRuntimeConnectionSecretMaterial(input: {
  prisma?: HostedSecureBoxPrismaClient;
  records: readonly HostedConnectionRecord[];
  testCodec?: HostedDeviceSyncSecretTestCodec | null;
  tokenConnectionIds: ReadonlySet<string>;
}): Promise<Map<string, HostedRuntimeConnectionSecretMaterial>> {
  const testCodec = normalizeHostedDeviceSyncSecretTestCodec(input.testCodec);
  const recordsById = new Map(input.records.map((record) => [record.id, record] as const));
  for (const connectionId of input.tokenConnectionIds) {
    if (!recordsById.has(connectionId)) {
      throw new TypeError("Hosted device-sync runtime token projection referenced an unknown connection.");
    }
  }

  const tokenEntries: Array<{
    connectionId: string;
    field: "accessToken" | "refreshToken";
    value: string;
  }> = [];
  for (const record of input.records) {
    if (record.status === "active" && !normalizeNullableString(record.externalAccountIdEncrypted)) {
      throw new TypeError("Hosted active device-sync connection is missing its external account identity.");
    }
    if (!input.tokenConnectionIds.has(record.id)) {
      continue;
    }
    if (normalizeHostedDeviceSyncCredentialKind(record.credentialKind) !== "oauth_tokens") {
      throw new TypeError("Hosted device-sync runtime token projection requires OAuth credentials.");
    }
    requireHostedRuntimeTokenVersion(record.tokenVersion);
    const accessTokenEncrypted = normalizeNullableString(record.accessTokenEncrypted);
    if (!accessTokenEncrypted) {
      throw new TypeError("Hosted device-sync runtime OAuth credential is missing its access token.");
    }
    tokenEntries.push({
      connectionId: record.id,
      field: "accessToken",
      value: accessTokenEncrypted,
    });
    const refreshTokenEncrypted = normalizeNullableString(record.refreshTokenEncrypted);
    if (refreshTokenEncrypted) {
      tokenEntries.push({
        connectionId: record.id,
        field: "refreshToken",
        value: refreshTokenEncrypted,
      });
    }
  }

  const read = async (): Promise<Map<string, HostedRuntimeConnectionSecretMaterial>> => {
    const externalAccountIds = testCodec
      ? input.records.map((record) => {
          const encrypted = normalizeNullableString(record.externalAccountIdEncrypted);
          return encrypted ? testCodec.decrypt(encrypted) : null;
        })
      : await openHostedUserSecureBoxStrings({
          entries: input.records.map((record) => ({
            aad: buildHostedDeviceSyncSecretAad({
              connectionId: record.id,
              field: "externalAccountId",
              provider: record.provider,
              purpose: "device-sync-external-account-id",
              tokenVersion: null,
            }),
            scope: `device-sync-external-account-id:${record.id}`,
            userId: record.userId,
            value: record.externalAccountIdEncrypted,
          })),
          lane: "device-sync-external-account-id",
          prisma: input.prisma,
        });

    const tokenPlaintexts = testCodec
      ? tokenEntries.map((entry) => testCodec.decrypt(entry.value))
      : await openHostedUserSecureBoxStrings({
          entries: tokenEntries.map((entry) => {
            const record = recordsById.get(entry.connectionId)!;
            const tokenVersion = requireHostedRuntimeTokenVersion(record.tokenVersion);
            const purpose = entry.field === "accessToken"
              ? "device-sync-access-token"
              : "device-sync-refresh-token";
            return {
              aad: buildHostedDeviceSyncSecretAad({
                connectionId: record.id,
                field: entry.field,
                provider: record.provider,
                purpose,
                tokenVersion,
              }),
              scope: `device-sync-token:${record.id}:${entry.field}`,
              userId: record.userId,
              value: entry.value,
            };
          }),
          lane: "device-sync-token",
          prisma: input.prisma,
        });

    const tokensByConnectionId = new Map<
      string,
      { accessToken: string | null; refreshToken: string | null }
    >();
    tokenEntries.forEach((entry, index) => {
      const plaintext = tokenPlaintexts[index];
      if (plaintext === null) {
        throw new TypeError("Hosted device-sync secure-box decryption returned an empty plaintext.");
      }
      const values = tokensByConnectionId.get(entry.connectionId) ?? {
        accessToken: null,
        refreshToken: null,
      };
      values[entry.field] = plaintext;
      tokensByConnectionId.set(entry.connectionId, values);
    });

    const material = new Map<string, HostedRuntimeConnectionSecretMaterial>();
    input.records.forEach((record, index) => {
      const externalAccountId = externalAccountIds[index] ?? null;
      if (record.status === "active" && !externalAccountId) {
        throw new TypeError("Hosted active device-sync connection is missing its external account identity.");
      }
      const tokens = tokensByConnectionId.get(record.id);
      material.set(record.id, {
        externalAccountId,
        tokenBundle: input.tokenConnectionIds.has(record.id)
          ? {
              accessToken: requireHostedRuntimeTokenPlaintext(tokens?.accessToken, "access token"),
              accessTokenExpiresAt: maybeIsoTimestamp(record.accessTokenExpiresAt),
              keyVersion: normalizeNullableString(record.keyVersion)
                ?? HOSTED_DEVICE_SYNC_SECURE_BOX_KEY_VERSION,
              refreshToken: tokens?.refreshToken ?? null,
              tokenVersion: requireHostedRuntimeTokenVersion(record.tokenVersion),
            }
          : null,
      });
    });
    return material;
  };

  return testCodec ? read() : runWithHostedDomainRootUnwrapCache(read);
}

function normalizeHostedDeviceSyncSecretTestCodec(
  codec: HostedDeviceSyncSecretTestCodec | null | undefined,
): HostedDeviceSyncSecretTestCodec | null {
  if (!codec) {
    return null;
  }

  if (!process.env.VITEST) {
    throw new TypeError("Hosted device-sync test secret codec can only be used under Vitest.");
  }

  return codec;
}

function requireHostedRuntimeTokenVersion(value: number | null): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    throw new TypeError("Hosted device-sync tokenVersion must be a positive integer.");
  }
  return value as number;
}

function requireHostedRuntimeTokenPlaintext(
  value: string | null | undefined,
  label: string,
): string {
  if (value === null || value === undefined || value.length === 0) {
    throw new TypeError(`Hosted device-sync runtime OAuth credential is missing its ${label}.`);
  }
  return value;
}

async function decryptHostedConnectionSecret(input: {
  connectionId: string;
  provider: string;
  prisma?: HostedSecureBoxPrismaClient;
  purpose: HostedDeviceSyncSecretPurpose;
  testCodec?: HostedDeviceSyncSecretTestCodec | null;
  tokenVersion?: number | null;
  userId: string;
  value: string;
}): Promise<string> {
  const testCodec = normalizeHostedDeviceSyncSecretTestCodec(input.testCodec);
  if (testCodec) {
    return testCodec.decrypt(input.value);
  }

  const descriptor = resolveHostedDeviceSyncSecretDescriptor(input.purpose, input.connectionId);
  const decrypted = await openHostedUserSecureBoxString({
    aad: buildHostedDeviceSyncSecretAad({
      connectionId: input.connectionId,
      field: descriptor.field,
      provider: input.provider,
      purpose: input.purpose,
      tokenVersion: input.tokenVersion,
    }),
    lane: descriptor.lane,
    prisma: input.prisma,
    scope: descriptor.scope,
    userId: input.userId,
    value: input.value,
  });

  if (decrypted === null) {
    throw new TypeError("Hosted device-sync secure-box decryption returned an empty plaintext.");
  }

  return decrypted;
}

function resolveHostedDeviceSyncSecretDescriptor(
  purpose: HostedDeviceSyncSecretPurpose,
  connectionId: string,
): {
  field: HostedDeviceSyncSecretField;
  lane: "device-sync-external-account-id" | "device-sync-token";
  scope: string;
} {
  switch (purpose) {
    case "device-sync-access-token":
      return {
        field: "accessToken",
        lane: "device-sync-token",
        scope: `device-sync-token:${connectionId}:accessToken`,
      };
    case "device-sync-refresh-token":
      return {
        field: "refreshToken",
        lane: "device-sync-token",
        scope: `device-sync-token:${connectionId}:refreshToken`,
      };
    case "device-sync-external-account-id":
      return {
        field: "externalAccountId",
        lane: "device-sync-external-account-id",
        scope: `device-sync-external-account-id:${connectionId}`,
      };
  }
}

function buildHostedDeviceSyncSecretAad(input: {
  connectionId: string;
  field: HostedDeviceSyncSecretField;
  provider: string;
  purpose: HostedDeviceSyncSecretPurpose;
  tokenVersion?: number | null;
}) {
  return {
    field: input.field,
    objectKey: input.provider,
    purpose: input.purpose,
    rowId: input.connectionId,
    sequence: input.tokenVersion ?? null,
    table: "device_connection",
  };
}
