import { decryptHostedWebString, encryptHostedWebString } from "../../hosted-crypto/secure-box";
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

export async function encryptHostedConnectionSecret(input: {
  connectionId: string;
  provider: string;
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
  const encrypted = await encryptHostedWebString({
    aad: buildHostedDeviceSyncSecretAad({
      connectionId: input.connectionId,
      field: descriptor.field,
      provider: input.provider,
      purpose: input.purpose,
      tokenVersion: input.tokenVersion,
    }),
    lane: descriptor.lane,
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
): Promise<HostedStoredConnectionTokenBundle | null> {
  if (normalizeHostedDeviceSyncCredentialKind(record.credentialKind) !== "oauth_tokens") {
    return null;
  }

  const accessTokenEncrypted = normalizeNullableString(record.accessTokenEncrypted);
  const keyVersion = normalizeNullableString(record.keyVersion) ?? HOSTED_DEVICE_SYNC_SECURE_BOX_KEY_VERSION;
  const tokenVersion = typeof record.tokenVersion === "number" ? record.tokenVersion : null;

  if (!accessTokenEncrypted || !tokenVersion) {
    return null;
  }

  return {
    accessToken: await decryptHostedConnectionSecret({
      connectionId: record.id,
      provider: record.provider,
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
): Promise<string | null> {
  const payload = normalizeNullableString(record.externalAccountIdEncrypted);

  if (!payload) {
    return null;
  }

  return await decryptHostedConnectionSecret({
    connectionId: record.id,
    provider: record.provider,
    purpose: "device-sync-external-account-id",
    testCodec,
    tokenVersion: null,
    userId: record.userId,
    value: payload,
  });
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
  const decrypted = await decryptHostedWebString({
    aad: buildHostedDeviceSyncSecretAad({
      connectionId: input.connectionId,
      field: descriptor.field,
      provider: input.provider,
      purpose: input.purpose,
      tokenVersion: input.tokenVersion,
    }),
    lane: descriptor.lane,
    scope: descriptor.scope,
    userId: input.userId,
    value: input.value,
  });

  return decrypted ?? "";
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
