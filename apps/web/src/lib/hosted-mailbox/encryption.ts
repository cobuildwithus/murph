import {
  buildHostedSecretAad,
  type HostedSecretCodec,
} from "../device-sync/crypto";
import {
  createHostedNullableStringEncryption,
  getOrCreateHostedSecretCodec,
  readHostedEncryptionEnvironment,
} from "../hosted-encryption-shared";

const HOSTED_MAILBOX_ENCRYPTION_KEY_ENV_KEYS = [
  "HOSTED_WAKE_ENCRYPTION_KEY",
] as const;
const HOSTED_MAILBOX_ENCRYPTION_KEY_VERSION_ENV_KEYS = [
  "HOSTED_WAKE_ENCRYPTION_KEY_VERSION",
] as const;
const HOSTED_MAILBOX_ENCRYPTION_KEYRING_JSON_ENV_KEYS = [
  "HOSTED_WAKE_ENCRYPTION_KEYRING_JSON",
] as const;

interface HostedMailboxConfigurationErrorInput {
  code: string;
  httpStatus: number;
  message: string;
}

const globalForHostedMailboxEncryption = globalThis as typeof globalThis & {
  __murphHostedMailboxEncryptionCodec?: HostedSecretCodec;
};

export class HostedMailboxConfigurationError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(input: HostedMailboxConfigurationErrorInput) {
    super(input.message);
    this.name = "HostedMailboxConfigurationError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
  }
}

export function hostedMailboxConfigurationError(
  input: HostedMailboxConfigurationErrorInput,
): HostedMailboxConfigurationError {
  return new HostedMailboxConfigurationError(input);
}

export function isHostedMailboxConfigurationError(
  error: unknown,
): error is HostedMailboxConfigurationError {
  return error instanceof HostedMailboxConfigurationError;
}

export function getHostedMailboxEncryptionCodec(): HostedSecretCodec {
  return getOrCreateHostedSecretCodec({
    cachedCodec: globalForHostedMailboxEncryption.__murphHostedMailboxEncryptionCodec,
    readEnvironment: readHostedMailboxEncryptionEnvironment,
    setCachedCodec(codec) {
      globalForHostedMailboxEncryption.__murphHostedMailboxEncryptionCodec = codec;
    },
    shouldCache: process.env.NODE_ENV !== "test",
  });
}

const hostedMailboxNullableStringEncryption = createHostedNullableStringEncryption<{
  field: string;
  userId: string;
  value: string | null | undefined;
}>({
  buildCipherOptions(input) {
    return {
      aad: buildHostedSecretAad({
        field: input.field,
        memberId: input.userId,
        purpose: "hosted-mailbox-payload",
      }),
      keyScope: `hosted-mailbox-payload:${input.field}`,
    } as const;
  },
  getCodec: getHostedMailboxEncryptionCodec,
});

export function encryptHostedMailboxNullableString(input: {
  field: string;
  userId: string;
  value: string | null | undefined;
}): string | null {
  return hostedMailboxNullableStringEncryption.encryptNullableString(input);
}

export function decryptHostedMailboxNullableString(input: {
  field: string;
  userId: string;
  value: string | null | undefined;
}): string | null {
  return hostedMailboxNullableStringEncryption.decryptNullableString(input);
}

function readHostedMailboxEncryptionEnvironment(
  source: NodeJS.ProcessEnv = process.env,
) {
  try {
    return readHostedEncryptionEnvironment({
      envKeys: {
        encryptionKey: HOSTED_MAILBOX_ENCRYPTION_KEY_ENV_KEYS,
        encryptionKeyVersion: HOSTED_MAILBOX_ENCRYPTION_KEY_VERSION_ENV_KEYS,
        encryptionKeyringJson: HOSTED_MAILBOX_ENCRYPTION_KEYRING_JSON_ENV_KEYS,
      },
      keyringLabel: "HOSTED_WAKE_ENCRYPTION_KEYRING_JSON",
      readRequiredEncryptionKey: readRequiredHostedMailboxEncryptionKey,
      source,
    });
  } catch (error) {
    throw toHostedMailboxConfigurationError(error);
  }
}

function readRequiredHostedMailboxEncryptionKey(): never {
  throw hostedMailboxConfigurationError({
    code: "HOSTED_WAKE_ENCRYPTION_KEY_REQUIRED",
    httpStatus: 500,
    message: "HOSTED_WAKE_ENCRYPTION_KEY must be configured for hosted mailbox payload encryption.",
  });
}

function toHostedMailboxConfigurationError(error: unknown): HostedMailboxConfigurationError | never {
  if (isHostedMailboxConfigurationError(error)) {
    return error;
  }

  if (error instanceof TypeError || error instanceof RangeError) {
    return hostedMailboxConfigurationError({
      code: "HOSTED_WAKE_ENCRYPTION_CONFIG_INVALID",
      httpStatus: 500,
      message: error.message,
    });
  }

  throw error;
}
