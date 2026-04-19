import { Buffer } from "node:buffer";

import {
  buildHostedSecretAad,
  createHostedSecretCodec,
  decodeHostedEncryptionKey,
  decodeHostedEncryptionKeyring,
  type HostedSecretCodec,
} from "../device-sync/crypto";
import { normalizeNullableString } from "../device-sync/shared";

const HOSTED_WAKE_ENCRYPTION_KEY_ENV_KEYS = [
  "HOSTED_WAKE_ENCRYPTION_KEY",
] as const;
const HOSTED_WAKE_ENCRYPTION_KEY_VERSION_ENV_KEYS = [
  "HOSTED_WAKE_ENCRYPTION_KEY_VERSION",
] as const;
const HOSTED_WAKE_ENCRYPTION_KEYRING_JSON_ENV_KEYS = [
  "HOSTED_WAKE_ENCRYPTION_KEYRING_JSON",
] as const;

interface HostedWakeEncryptionEnvironment {
  encryptionKey: Buffer;
  encryptionKeyVersion: string;
  encryptionKeysByVersion: Readonly<Record<string, Buffer>>;
}

interface HostedWakeConfigurationErrorInput {
  code: string;
  httpStatus: number;
  message: string;
}

const globalForHostedWakeEncryption = globalThis as typeof globalThis & {
  __murphHostedWakeEncryptionCodec?: HostedSecretCodec;
};

export class HostedWakeConfigurationError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(input: HostedWakeConfigurationErrorInput) {
    super(input.message);
    this.name = "HostedWakeConfigurationError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
  }
}

export function hostedWakeConfigurationError(
  input: HostedWakeConfigurationErrorInput,
): HostedWakeConfigurationError {
  return new HostedWakeConfigurationError(input);
}

export function isHostedWakeConfigurationError(
  error: unknown,
): error is HostedWakeConfigurationError {
  return error instanceof HostedWakeConfigurationError;
}

export function getHostedWakeEncryptionCodec(): HostedSecretCodec {
  if (globalForHostedWakeEncryption.__murphHostedWakeEncryptionCodec) {
    return globalForHostedWakeEncryption.__murphHostedWakeEncryptionCodec;
  }

  const environment = readHostedWakeEncryptionEnvironment();
  const codec = createHostedSecretCodec({
    key: environment.encryptionKey,
    keyVersion: environment.encryptionKeyVersion,
    keysByVersion: environment.encryptionKeysByVersion,
  });

  if (process.env.NODE_ENV !== "test") {
    globalForHostedWakeEncryption.__murphHostedWakeEncryptionCodec = codec;
  }

  return codec;
}

export function encryptHostedWakeNullableString(input: {
  field: string;
  userId: string;
  value: string | null | undefined;
}): string | null {
  const normalized = normalizeNullableString(input.value);

  if (!normalized) {
    return null;
  }

  return getHostedWakeEncryptionCodec().encrypt(
    normalized,
    buildHostedWakeFieldCipherOptions(input),
  );
}

export function decryptHostedWakeNullableString(input: {
  field: string;
  userId: string;
  value: string | null | undefined;
}): string | null {
  const normalized = normalizeNullableString(input.value);

  if (!normalized) {
    return null;
  }

  return normalizeNullableString(
    getHostedWakeEncryptionCodec().decrypt(normalized, buildHostedWakeFieldCipherOptions(input)),
  );
}

function buildHostedWakeFieldCipherOptions(input: {
  field: string;
  userId: string;
}) {
  return {
    aad: buildHostedSecretAad({
      field: input.field,
      memberId: input.userId,
      purpose: "hosted-wake-payload",
    }),
    keyScope: `hosted-wake-payload:${input.field}`,
  } as const;
}

function readHostedWakeEncryptionEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): HostedWakeEncryptionEnvironment {
  try {
    const encryptionKeyValue = readEnv(source, HOSTED_WAKE_ENCRYPTION_KEY_ENV_KEYS);
    const encryptionKeyVersion =
      readEnv(source, HOSTED_WAKE_ENCRYPTION_KEY_VERSION_ENV_KEYS) ?? "v1";
    const encryptionKeyringJson = readEnv(source, HOSTED_WAKE_ENCRYPTION_KEYRING_JSON_ENV_KEYS);
    const encryptionKey = encryptionKeyValue
      ? decodeHostedEncryptionKey(encryptionKeyValue)
      : readRequiredHostedWakeEncryptionKey();

    return {
      encryptionKey,
      encryptionKeyVersion,
      encryptionKeysByVersion: decodeHostedEncryptionKeyring({
        currentKey: encryptionKey,
        currentKeyVersion: encryptionKeyVersion,
        keyringJson: encryptionKeyringJson,
        label: "HOSTED_WAKE_ENCRYPTION_KEYRING_JSON",
      }),
    };
  } catch (error) {
    throw toHostedWakeConfigurationError(error);
  }
}

function readRequiredHostedWakeEncryptionKey(): never {
  throw hostedWakeConfigurationError({
    code: "HOSTED_WAKE_ENCRYPTION_KEY_REQUIRED",
    httpStatus: 500,
    message: "HOSTED_WAKE_ENCRYPTION_KEY must be configured for hosted wake payload encryption.",
  });
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

function toHostedWakeConfigurationError(error: unknown): HostedWakeConfigurationError | never {
  if (isHostedWakeConfigurationError(error)) {
    return error;
  }

  if (error instanceof TypeError || error instanceof RangeError) {
    return hostedWakeConfigurationError({
      code: "HOSTED_WAKE_ENCRYPTION_CONFIG_INVALID",
      httpStatus: 500,
      message: error.message,
    });
  }

  throw error;
}
