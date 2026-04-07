import { Buffer } from "node:buffer";

import {
  buildHostedSecretAad,
  createHostedSecretCodec,
  decodeHostedEncryptionKey,
  decodeHostedEncryptionKeyring,
  type HostedSecretCodec,
} from "../device-sync/crypto";
import { normalizeNullableString } from "../device-sync/shared";

const HOSTED_WEB_ENCRYPTION_KEY_ENV_KEYS = [
  "HOSTED_WEB_ENCRYPTION_KEY",
] as const;
const HOSTED_WEB_ENCRYPTION_KEY_VERSION_ENV_KEYS = [
  "HOSTED_WEB_ENCRYPTION_KEY_VERSION",
] as const;
const HOSTED_WEB_ENCRYPTION_KEYRING_JSON_ENV_KEYS = [
  "HOSTED_WEB_ENCRYPTION_KEYRING_JSON",
] as const;
const TEST_HOSTED_WEB_ENCRYPTION_KEY = Buffer.from(
  "vitest-hosted-web-encryption-key",
  "utf8",
);

interface HostedWebEncryptionEnvironment {
  encryptionKey: Buffer;
  encryptionKeyVersion: string;
  encryptionKeysByVersion: Readonly<Record<string, Buffer>>;
}

interface HostedWebConfigurationErrorInput {
  code: string;
  httpStatus: number;
  message: string;
}

const globalForHostedWebEncryption = globalThis as typeof globalThis & {
  __murphHostedWebEncryptionCodec?: HostedSecretCodec;
};

export class HostedWebConfigurationError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(input: HostedWebConfigurationErrorInput) {
    super(input.message);
    this.name = "HostedWebConfigurationError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
  }
}

export function hostedWebConfigurationError(
  input: HostedWebConfigurationErrorInput,
): HostedWebConfigurationError {
  return new HostedWebConfigurationError(input);
}

export function isHostedWebConfigurationError(
  error: unknown,
): error is HostedWebConfigurationError {
  return error instanceof HostedWebConfigurationError;
}

export function getHostedWebEncryptionCodec(): HostedSecretCodec {
  if (globalForHostedWebEncryption.__murphHostedWebEncryptionCodec) {
    return globalForHostedWebEncryption.__murphHostedWebEncryptionCodec;
  }

  const environment = readHostedWebEncryptionEnvironment();
  const codec = createHostedSecretCodec({
    key: environment.encryptionKey,
    keyVersion: environment.encryptionKeyVersion,
    keysByVersion: environment.encryptionKeysByVersion,
  });

  if (!isHostedWebEncryptionTestMode()) {
    globalForHostedWebEncryption.__murphHostedWebEncryptionCodec = codec;
  }

  return codec;
}

export function encryptHostedWebNullableString(input: {
  field: string;
  memberId: string;
  value: string | null | undefined;
}): string | null {
  const normalized = normalizeNullableString(input.value);

  if (!normalized) {
    return null;
  }

  return getHostedWebEncryptionCodec().encrypt(
    normalized,
    buildHostedWebFieldCipherOptions(input),
  );
}

export function decryptHostedWebNullableString(input: {
  field: string;
  memberId: string;
  value: string | null | undefined;
}): string | null {
  const normalized = normalizeNullableString(input.value);

  if (!normalized) {
    return null;
  }

  return normalizeNullableString(
    getHostedWebEncryptionCodec().decrypt(normalized, buildHostedWebFieldCipherOptions(input)),
  );
}

function buildHostedWebFieldCipherOptions(input: {
  field: string;
  memberId: string;
}) {
  return {
    aad: buildHostedSecretAad({
      field: input.field,
      memberId: input.memberId,
      purpose: "hosted-member-private-field",
    }),
    keyScope: `hosted-member-private-field:${input.field}`,
  } as const;
}

function readHostedWebEncryptionEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): HostedWebEncryptionEnvironment {
  try {
    const encryptionKeyValue = readEnv(source, HOSTED_WEB_ENCRYPTION_KEY_ENV_KEYS);
    const encryptionKeyVersion =
      readEnv(source, HOSTED_WEB_ENCRYPTION_KEY_VERSION_ENV_KEYS) ?? "v1";
    const encryptionKeyringJson = readEnv(source, HOSTED_WEB_ENCRYPTION_KEYRING_JSON_ENV_KEYS);
    const encryptionKey = encryptionKeyValue
      ? decodeHostedEncryptionKey(encryptionKeyValue)
      : readHostedWebTestEncryptionKey();

    return {
      encryptionKey,
      encryptionKeyVersion,
      encryptionKeysByVersion: decodeHostedEncryptionKeyring({
        currentKey: encryptionKey,
        currentKeyVersion: encryptionKeyVersion,
        keyringJson: encryptionKeyringJson,
        label: "HOSTED_WEB_ENCRYPTION_KEYRING_JSON",
      }),
    };
  } catch (error) {
    throw toHostedWebConfigurationError(error);
  }
}

function readHostedWebTestEncryptionKey(): Buffer {
  if (!isHostedWebEncryptionTestMode()) {
    throw hostedWebConfigurationError({
      code: "HOSTED_WEB_ENCRYPTION_KEY_REQUIRED",
      httpStatus: 500,
      message: "HOSTED_WEB_ENCRYPTION_KEY must be configured for hosted member private field encryption.",
    });
  }

  return TEST_HOSTED_WEB_ENCRYPTION_KEY;
}

function readEnv(
  source: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = normalizeNullableString(source[key]);

    if (value) {
      return value;
    }
  }

  return null;
}

function isHostedWebEncryptionTestMode(): boolean {
  return process.env.NODE_ENV === "test" || typeof process.env.VITEST === "string";
}

function toHostedWebConfigurationError(error: unknown): HostedWebConfigurationError | never {
  if (isHostedWebConfigurationError(error)) {
    return error;
  }

  if (error instanceof TypeError || error instanceof RangeError) {
    return hostedWebConfigurationError({
      code: "HOSTED_WEB_ENCRYPTION_CONFIG_INVALID",
      httpStatus: 500,
      message: error.message,
    });
  }

  throw error;
}
