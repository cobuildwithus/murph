import {
  buildHostedConnectionTokenCipherOptions,
  type HostedSecretCodec,
} from "../crypto";
import { maybeIsoTimestamp, normalizeNullableString } from "../shared";
import {
  normalizeHostedDeviceSyncCredentialKind,
  type HostedConnectionRecord,
} from "./connection-records";

export type HostedStoredConnectionTokenBundle = {
  accessToken: string;
  accessTokenExpiresAt: string | null;
  keyVersion: string;
  refreshToken: string | null;
  tokenVersion: number;
};

export function encryptHostedConnectionSecret(input: {
  codec: HostedSecretCodec;
  connectionId: string;
  provider: string;
  purpose:
    | "device-sync-access-token"
    | "device-sync-external-account-id"
    | "device-sync-refresh-token";
  value: string;
}): string {
  return input.codec.encrypt(
    input.value,
    buildHostedConnectionTokenCipherOptions({
      connectionId: input.connectionId,
      provider: input.provider,
      purpose: input.purpose,
    }),
  );
}

export function readHostedStoredTokenBundle(
  record: HostedConnectionRecord,
  codec: HostedSecretCodec | null,
): HostedStoredConnectionTokenBundle | null {
  if (normalizeHostedDeviceSyncCredentialKind(record.credentialKind) !== "oauth_tokens") {
    return null;
  }

  const accessTokenEncrypted = normalizeNullableString(record.accessTokenEncrypted);
  const keyVersion = normalizeNullableString(record.keyVersion);
  const tokenVersion = typeof record.tokenVersion === "number" ? record.tokenVersion : null;

  if (!codec || !accessTokenEncrypted || !keyVersion || !tokenVersion) {
    return null;
  }

  return {
    accessToken: decryptHostedConnectionSecret({
      codec,
      connectionId: record.id,
      provider: record.provider,
      purpose: "device-sync-access-token",
      value: accessTokenEncrypted,
    }),
    accessTokenExpiresAt: maybeIsoTimestamp(record.accessTokenExpiresAt),
    keyVersion,
    refreshToken: normalizeNullableString(record.refreshTokenEncrypted)
      ? decryptHostedConnectionSecret({
        codec,
        connectionId: record.id,
        provider: record.provider,
        purpose: "device-sync-refresh-token",
        value: normalizeNullableString(record.refreshTokenEncrypted)!,
      })
      : null,
    tokenVersion,
  };
}

export function readHostedStoredExternalAccountId(
  record: HostedConnectionRecord,
  codec: HostedSecretCodec | null,
): string | null {
  const payload = normalizeNullableString(record.externalAccountIdEncrypted);

  if (!codec || !payload) {
    return null;
  }

  return decryptHostedConnectionSecret({
    codec,
    connectionId: record.id,
    provider: record.provider,
    purpose: "device-sync-external-account-id",
    value: payload,
  });
}

export function requireHostedSecretCodec(codec: HostedSecretCodec | null): HostedSecretCodec {
  if (!codec) {
    throw new TypeError("Hosted device-sync secret codec is required.");
  }

  return codec;
}

function decryptHostedConnectionSecret(input: {
  codec: HostedSecretCodec;
  connectionId: string;
  provider: string;
  purpose:
    | "device-sync-access-token"
    | "device-sync-external-account-id"
    | "device-sync-refresh-token";
  value: string;
}): string {
  return input.codec.decrypt(
    input.value,
    buildHostedConnectionTokenCipherOptions({
      connectionId: input.connectionId,
      provider: input.provider,
      purpose: input.purpose,
    }),
  );
}
