import {
  buildHostedSecretAad,
  type HostedSecretCodec,
} from "../device-sync/crypto";
import {
  createHostedNullableStringEncryption,
  getOrCreateHostedSecretCodec,
  readHostedEncryptionEnvironment,
} from "../hosted-encryption-shared";

const HOSTED_WEB_ENCRYPTION_KEY_ENV_KEYS = [
  "HOSTED_WEB_ENCRYPTION_KEY",
] as const;
const HOSTED_WEB_ENCRYPTION_KEY_VERSION_ENV_KEYS = [
  "HOSTED_WEB_ENCRYPTION_KEY_VERSION",
] as const;
const HOSTED_WEB_ENCRYPTION_KEYRING_JSON_ENV_KEYS = [
  "HOSTED_WEB_ENCRYPTION_KEYRING_JSON",
] as const;

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
  return getOrCreateHostedSecretCodec({
    cachedCodec: globalForHostedWebEncryption.__murphHostedWebEncryptionCodec,
    readEnvironment: readHostedWebEncryptionEnvironment,
    setCachedCodec(codec) {
      globalForHostedWebEncryption.__murphHostedWebEncryptionCodec = codec;
    },
    shouldCache: process.env.NODE_ENV !== "test",
  });
}

const hostedWebNullableStringEncryption = createHostedNullableStringEncryption<{
  field: string;
  memberId: string;
  value: string | null | undefined;
}>({
  buildCipherOptions: buildHostedWebFieldCipherOptions,
  getCodec: getHostedWebEncryptionCodec,
});

export function encryptHostedWebNullableString(input: {
  field: string;
  memberId: string;
  value: string | null | undefined;
}): string | null {
  return hostedWebNullableStringEncryption.encryptNullableString(input);
}

export function decryptHostedWebNullableString(input: {
  field: string;
  memberId: string;
  value: string | null | undefined;
}): string | null {
  return hostedWebNullableStringEncryption.decryptNullableString(input);
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
) {
  try {
    return readHostedEncryptionEnvironment({
      envKeys: {
        encryptionKey: HOSTED_WEB_ENCRYPTION_KEY_ENV_KEYS,
        encryptionKeyVersion: HOSTED_WEB_ENCRYPTION_KEY_VERSION_ENV_KEYS,
        encryptionKeyringJson: HOSTED_WEB_ENCRYPTION_KEYRING_JSON_ENV_KEYS,
      },
      keyringLabel: "HOSTED_WEB_ENCRYPTION_KEYRING_JSON",
      readRequiredEncryptionKey: readRequiredHostedWebEncryptionKey,
      source,
    });
  } catch (error) {
    throw toHostedWebConfigurationError(error);
  }
}

function readRequiredHostedWebEncryptionKey(): never {
  throw hostedWebConfigurationError({
    code: "HOSTED_WEB_ENCRYPTION_KEY_REQUIRED",
    httpStatus: 500,
    message: "HOSTED_WEB_ENCRYPTION_KEY must be configured for hosted member private field encryption.",
  });
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
