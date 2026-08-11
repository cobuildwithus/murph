import { parseSerializedHostedSecureBoxEnvelope } from "@murphai/runtime-state";

import { runWithHostedDomainRootUnwrapCache } from "../../hosted-crypto/domain-root-unwrap-cache";
import {
  openHostedUserSecureBoxString,
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxString,
  sealHostedUserSecureBoxStrings,
  type HostedSecureBoxPrismaClient,
} from "../../hosted-crypto/secure-box";
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

export interface HostedRuntimeApplyConnectionSecretMaterial {
  externalAccountId: string | null;
  tokenBundle: HostedStoredConnectionTokenBundle | null;
}

export interface HostedRuntimeApplyPreparedTokenWrite {
  accessTokenEncrypted: string | null;
  accessTokenExpiresAt: string | null;
  externalAccountIdEncrypted: string | null;
  keyVersion: string | null;
  refreshTokenEncrypted: string | null;
  rootKeyId: string | null;
  tokenVersion: number | null;
}

export interface HostedRuntimeApplyTokenWritePreparation {
  externalAccountId: string | null;
  record: HostedConnectionRecord;
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
 * Opens the complete bounded runtime-apply authority set before any
 * connection transaction starts. Secure-box roots are resolved as sets, and
 * the existing domain-root owner caps provider unwrap concurrency at four.
 */
export async function readHostedRuntimeApplyConnectionSecretMaterial(input: {
  prisma?: HostedSecureBoxPrismaClient;
  records: readonly HostedConnectionRecord[];
  testCodec?: HostedDeviceSyncSecretTestCodec | null;
}): Promise<Map<string, HostedRuntimeApplyConnectionSecretMaterial>> {
  const testCodec = normalizeHostedDeviceSyncSecretTestCodec(input.testCodec);
  const recordsById = new Map<string, HostedConnectionRecord>();
  const tokenEntries: Array<{
    connectionId: string;
    field: "accessToken" | "refreshToken";
    tokenVersion: number;
    value: string;
  }> = [];

  for (const record of input.records) {
    if (recordsById.has(record.id)) {
      throw new TypeError("Hosted device-sync runtime apply preparation contained a duplicate connection.");
    }
    recordsById.set(record.id, record);

    if (normalizeHostedDeviceSyncCredentialKind(record.credentialKind) !== "oauth_tokens") {
      continue;
    }
    const accessTokenEncrypted = normalizeNullableString(record.accessTokenEncrypted);
    const tokenVersion = record.tokenVersion;
    if (!accessTokenEncrypted || tokenVersion === null) {
      continue;
    }
    const normalizedTokenVersion = requireHostedRuntimeApplyTokenVersion(tokenVersion);
    tokenEntries.push({
      connectionId: record.id,
      field: "accessToken",
      tokenVersion: normalizedTokenVersion,
      value: accessTokenEncrypted,
    });
    const refreshTokenEncrypted = normalizeNullableString(record.refreshTokenEncrypted);
    if (refreshTokenEncrypted) {
      tokenEntries.push({
        connectionId: record.id,
        field: "refreshToken",
        tokenVersion: normalizedTokenVersion,
        value: refreshTokenEncrypted,
      });
    }
  }

  const read = async (): Promise<Map<string, HostedRuntimeApplyConnectionSecretMaterial>> => {
    const externalAccountIds = testCodec
      ? input.records.map((record) => {
          const ciphertext = normalizeNullableString(record.externalAccountIdEncrypted);
          return ciphertext ? testCodec.decrypt(ciphertext) : null;
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
            const record = recordsById.get(entry.connectionId);
            if (!record) {
              throw new TypeError("Hosted device-sync runtime apply token preparation lost its connection.");
            }
            const purpose = entry.field === "accessToken"
              ? "device-sync-access-token"
              : "device-sync-refresh-token";
            return {
              aad: buildHostedDeviceSyncSecretAad({
                connectionId: record.id,
                field: entry.field,
                provider: record.provider,
                purpose,
                tokenVersion: entry.tokenVersion,
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
      if (plaintext === null || plaintext === undefined || plaintext.length === 0) {
        throw new TypeError("Hosted device-sync secure-box decryption returned an empty plaintext.");
      }
      const tokens = tokensByConnectionId.get(entry.connectionId) ?? {
        accessToken: null,
        refreshToken: null,
      };
      tokens[entry.field] = plaintext;
      tokensByConnectionId.set(entry.connectionId, tokens);
    });

    const material = new Map<string, HostedRuntimeApplyConnectionSecretMaterial>();
    input.records.forEach((record, index) => {
      const tokens = tokensByConnectionId.get(record.id);
      const tokenVersion = record.tokenVersion;
      const accessTokenEncrypted = normalizeNullableString(record.accessTokenEncrypted);
      material.set(record.id, {
        externalAccountId: externalAccountIds[index] ?? null,
        tokenBundle: normalizeHostedDeviceSyncCredentialKind(record.credentialKind) === "oauth_tokens"
          && accessTokenEncrypted
          && tokenVersion !== null
          ? {
              accessToken: requireHostedRuntimeApplyTokenPlaintext(
                tokens?.accessToken,
                "access token",
              ),
              accessTokenExpiresAt: maybeIsoTimestamp(record.accessTokenExpiresAt),
              keyVersion: normalizeNullableString(record.keyVersion)
                ?? HOSTED_DEVICE_SYNC_SECURE_BOX_KEY_VERSION,
              refreshToken: tokens?.refreshToken ?? null,
              tokenVersion: requireHostedRuntimeApplyTokenVersion(tokenVersion),
            }
          : null,
      });
    });
    return material;
  };

  return testCodec ? read() : runWithHostedDomainRootUnwrapCache(read);
}

/**
 * Seals every requested runtime token mutation before the write transaction.
 * One active device root serves both device-secret lanes through the existing
 * request-scoped root memo; no root unwrap or provider work occurs after BEGIN.
 */
export async function prepareHostedRuntimeApplyTokenWrites(input: {
  entries: readonly HostedRuntimeApplyTokenWritePreparation[];
  prisma?: HostedSecureBoxPrismaClient;
  testCodec?: HostedDeviceSyncSecretTestCodec | null;
}): Promise<Map<string, HostedRuntimeApplyPreparedTokenWrite>> {
  if (input.entries.length === 0) {
    return new Map();
  }
  const testCodec = normalizeHostedDeviceSyncSecretTestCodec(input.testCodec);
  const recordsById = new Map<string, HostedConnectionRecord>();
  for (const entry of input.entries) {
    if (recordsById.has(entry.record.id)) {
      throw new TypeError("Hosted device-sync runtime apply token preparation contained a duplicate connection.");
    }
    recordsById.set(entry.record.id, entry.record);
  }

  const externalEntries = input.entries.flatMap((entry) =>
    entry.externalAccountId
      ? [{
          connectionId: entry.record.id,
          value: entry.externalAccountId,
        }]
      : []
  );
  const tokenEntries = input.entries.flatMap((entry) => {
    if (!entry.tokenBundle) {
      return [];
    }
    return [
      {
        connectionId: entry.record.id,
        field: "accessToken" as const,
        tokenVersion: entry.tokenBundle.tokenVersion,
        value: entry.tokenBundle.accessToken,
      },
      ...(entry.tokenBundle.refreshToken
        ? [{
            connectionId: entry.record.id,
            field: "refreshToken" as const,
            tokenVersion: entry.tokenBundle.tokenVersion,
            value: entry.tokenBundle.refreshToken,
          }]
        : []),
    ];
  });

  const seal = async (): Promise<Map<string, HostedRuntimeApplyPreparedTokenWrite>> => {
    const externalCiphertexts = testCodec
      ? externalEntries.map((entry) => testCodec.encrypt(entry.value))
      : await sealHostedUserSecureBoxStrings({
          entries: externalEntries.map((entry) => {
            const record = requireHostedRuntimeApplyPreparationRecord(recordsById, entry.connectionId);
            return {
              aad: buildHostedDeviceSyncSecretAad({
                connectionId: record.id,
                field: "externalAccountId",
                provider: record.provider,
                purpose: "device-sync-external-account-id",
                tokenVersion: null,
              }),
              scope: `device-sync-external-account-id:${record.id}`,
              value: entry.value,
            };
          }),
          lane: "device-sync-external-account-id",
          prisma: input.prisma,
          userId: requireHostedRuntimeApplySingleUser(input.entries),
        });
    const tokenCiphertexts = testCodec
      ? tokenEntries.map((entry) => testCodec.encrypt(entry.value))
      : await sealHostedUserSecureBoxStrings({
          entries: tokenEntries.map((entry) => {
            const record = requireHostedRuntimeApplyPreparationRecord(recordsById, entry.connectionId);
            const purpose = entry.field === "accessToken"
              ? "device-sync-access-token"
              : "device-sync-refresh-token";
            return {
              aad: buildHostedDeviceSyncSecretAad({
                connectionId: record.id,
                field: entry.field,
                provider: record.provider,
                purpose,
                tokenVersion: entry.tokenVersion,
              }),
              scope: `device-sync-token:${record.id}:${entry.field}`,
              value: entry.value,
            };
          }),
          lane: "device-sync-token",
          prisma: input.prisma,
          userId: requireHostedRuntimeApplySingleUser(input.entries),
        });

    const externalByConnectionId = new Map<string, string>();
    externalEntries.forEach((entry, index) => {
      const ciphertext = externalCiphertexts[index];
      if (!ciphertext) {
        throw new TypeError("Hosted device-sync secure-box encryption returned an empty ciphertext.");
      }
      externalByConnectionId.set(entry.connectionId, ciphertext);
    });
    const tokensByConnectionId = new Map<
      string,
      { accessTokenEncrypted: string | null; refreshTokenEncrypted: string | null }
    >();
    tokenEntries.forEach((entry, index) => {
      const ciphertext = tokenCiphertexts[index];
      if (!ciphertext) {
        throw new TypeError("Hosted device-sync secure-box encryption returned an empty ciphertext.");
      }
      const encrypted = tokensByConnectionId.get(entry.connectionId) ?? {
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
      };
      encrypted[entry.field === "accessToken" ? "accessTokenEncrypted" : "refreshTokenEncrypted"] = ciphertext;
      tokensByConnectionId.set(entry.connectionId, encrypted);
    });

    const prepared = new Map<string, HostedRuntimeApplyPreparedTokenWrite>();
    for (const entry of input.entries) {
      const encrypted = tokensByConnectionId.get(entry.record.id);
      const externalAccountIdEncrypted = externalByConnectionId.get(entry.record.id) ?? null;
      const accessTokenEncrypted = encrypted?.accessTokenEncrypted ?? null;
      const refreshTokenEncrypted = encrypted?.refreshTokenEncrypted ?? null;
      const rootKeyIds = testCodec
        ? []
        : [externalAccountIdEncrypted, accessTokenEncrypted, refreshTokenEncrypted]
            .filter((value): value is string => Boolean(value))
            .map((value) => parseSerializedHostedSecureBoxEnvelope(value).rootKeyId);
      const uniqueRootKeyIds = [...new Set(rootKeyIds)];
      if (uniqueRootKeyIds.length > 1) {
        throw new TypeError("Hosted device-sync runtime apply token preparation crossed active roots.");
      }
      prepared.set(entry.record.id, {
        accessTokenEncrypted,
        accessTokenExpiresAt: entry.tokenBundle?.accessTokenExpiresAt ?? null,
        externalAccountIdEncrypted,
        keyVersion: entry.tokenBundle
          ? testCodec?.keyVersion ?? HOSTED_DEVICE_SYNC_SECURE_BOX_KEY_VERSION
          : null,
        refreshTokenEncrypted,
        rootKeyId: uniqueRootKeyIds[0] ?? null,
        tokenVersion: entry.tokenBundle?.tokenVersion ?? null,
      });
    }
    return prepared;
  };

  return testCodec ? seal() : runWithHostedDomainRootUnwrapCache(seal);
}

function requireHostedRuntimeApplyPreparationRecord(
  recordsById: ReadonlyMap<string, HostedConnectionRecord>,
  connectionId: string,
): HostedConnectionRecord {
  const record = recordsById.get(connectionId);
  if (!record) {
    throw new TypeError("Hosted device-sync runtime apply token preparation lost its connection.");
  }
  return record;
}

function requireHostedRuntimeApplySingleUser(
  entries: readonly HostedRuntimeApplyTokenWritePreparation[],
): string {
  const userIds = [...new Set(entries.map((entry) => entry.record.userId))];
  if (userIds.length !== 1 || !userIds[0]) {
    throw new TypeError("Hosted device-sync runtime apply token preparation requires one user.");
  }
  return userIds[0];
}

function requireHostedRuntimeApplyTokenVersion(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("Hosted device-sync tokenVersion must be a positive integer.");
  }
  return value;
}

function requireHostedRuntimeApplyTokenPlaintext(
  value: string | null | undefined,
  label: string,
): string {
  if (value === null || value === undefined || value.length === 0) {
    throw new TypeError(`Hosted device-sync runtime OAuth credential is missing its ${label}.`);
  }
  return value;
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
