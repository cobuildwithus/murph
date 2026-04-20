import { Buffer } from "node:buffer";

import {
  buildHostedSecretAad,
  createHostedSecretCodec,
  decodeHostedEncryptionKey,
  decodeHostedEncryptionKeyring,
  type HostedSecretCodec,
} from "../device-sync/crypto";
import { normalizeNullableString } from "../primitives";

const HOSTED_WAKE_ENCRYPTION_KEY_ENV_KEYS = [
  "HOSTED_WAKE_ENCRYPTION_KEY",
] as const;
const HOSTED_WAKE_ENCRYPTION_KEY_VERSION_ENV_KEYS = [
  "HOSTED_WAKE_ENCRYPTION_KEY_VERSION",
] as const;
const HOSTED_WAKE_ENCRYPTION_KEYRING_JSON_ENV_KEYS = [
  "HOSTED_WAKE_ENCRYPTION_KEYRING_JSON",
] as const;

interface HostedIngressEncryptionEnvironment {
  encryptionKey: Buffer;
  encryptionKeyVersion: string;
  encryptionKeysByVersion: Readonly<Record<string, Buffer>>;
}

interface HostedIngressConfigurationErrorInput {
  code: string;
  httpStatus: number;
  message: string;
}

const globalForHostedIngressEncryption = globalThis as typeof globalThis & {
  __murphHostedIngressEncryptionCodec?: HostedSecretCodec;
};

export class HostedIngressConfigurationError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(input: HostedIngressConfigurationErrorInput) {
    super(input.message);
    this.name = "HostedIngressConfigurationError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
  }
}

export function hostedIngressConfigurationError(
  input: HostedIngressConfigurationErrorInput,
): HostedIngressConfigurationError {
  return new HostedIngressConfigurationError(input);
}

export function isHostedIngressConfigurationError(
  error: unknown,
): error is HostedIngressConfigurationError {
  return error instanceof HostedIngressConfigurationError;
}

export function getHostedIngressEncryptionCodec(): HostedSecretCodec {
  if (globalForHostedIngressEncryption.__murphHostedIngressEncryptionCodec) {
    return globalForHostedIngressEncryption.__murphHostedIngressEncryptionCodec;
  }

  const environment = readHostedIngressEncryptionEnvironment();
  const codec = createHostedSecretCodec({
    key: environment.encryptionKey,
    keyVersion: environment.encryptionKeyVersion,
    keysByVersion: environment.encryptionKeysByVersion,
  });

  if (process.env.NODE_ENV !== "test") {
    globalForHostedIngressEncryption.__murphHostedIngressEncryptionCodec = codec;
  }

  return codec;
}

export function encryptHostedIngressNullableString(input: {
  field: string;
  userId: string;
  value: string | null | undefined;
}): string | null {
  const normalized = normalizeNullableString(input.value);

  if (!normalized) {
    return null;
  }

  return getHostedIngressEncryptionCodec().encrypt(
    normalized,
    buildHostedIngressFieldCipherOptions(input),
  );
}

export function decryptHostedIngressNullableString(input: {
  field: string;
  userId: string;
  value: string | null | undefined;
}): string | null {
  const normalized = normalizeNullableString(input.value);

  if (!normalized) {
    return null;
  }

  return normalizeNullableString(
    getHostedIngressEncryptionCodec().decrypt(normalized, buildHostedIngressFieldCipherOptions(input)),
  );
}

function buildHostedIngressFieldCipherOptions(input: {
  field: string;
  userId: string;
}) {
  return {
    aad: buildHostedSecretAad({
      field: input.field,
      memberId: input.userId,
      purpose: "hosted-ingress-payload",
    }),
    keyScope: `hosted-ingress-payload:${input.field}`,
  } as const;
}

function readHostedIngressEncryptionEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): HostedIngressEncryptionEnvironment {
  try {
    const encryptionKeyValue = readEnv(source, HOSTED_WAKE_ENCRYPTION_KEY_ENV_KEYS);
    const encryptionKeyVersion =
      readEnv(source, HOSTED_WAKE_ENCRYPTION_KEY_VERSION_ENV_KEYS) ?? "v1";
    const encryptionKeyringJson = readEnv(source, HOSTED_WAKE_ENCRYPTION_KEYRING_JSON_ENV_KEYS);
    const encryptionKey = encryptionKeyValue
      ? decodeHostedEncryptionKey(encryptionKeyValue)
      : readRequiredHostedIngressEncryptionKey();

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
    throw toHostedIngressConfigurationError(error);
  }
}

function readRequiredHostedIngressEncryptionKey(): never {
  throw hostedIngressConfigurationError({
    code: "HOSTED_WAKE_ENCRYPTION_KEY_REQUIRED",
    httpStatus: 500,
    message: "HOSTED_WAKE_ENCRYPTION_KEY must be configured for hosted ingress payload encryption.",
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

function toHostedIngressConfigurationError(error: unknown): HostedIngressConfigurationError | never {
  if (isHostedIngressConfigurationError(error)) {
    return error;
  }

  if (error instanceof TypeError || error instanceof RangeError) {
    return hostedIngressConfigurationError({
      code: "HOSTED_WAKE_ENCRYPTION_CONFIG_INVALID",
      httpStatus: 500,
      message: error.message,
    });
  }

  throw error;
}
