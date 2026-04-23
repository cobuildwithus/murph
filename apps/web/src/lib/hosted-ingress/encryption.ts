import {
  buildHostedSecretAad,
  type HostedSecretCodec,
} from "../device-sync/crypto";
import {
  createHostedNullableStringEncryption,
  getOrCreateHostedSecretCodec,
  readHostedEncryptionEnvironment,
} from "../hosted-encryption-shared";

const HOSTED_WAKE_ENCRYPTION_KEY_ENV_KEYS = [
  "HOSTED_WAKE_ENCRYPTION_KEY",
] as const;
const HOSTED_WAKE_ENCRYPTION_KEY_VERSION_ENV_KEYS = [
  "HOSTED_WAKE_ENCRYPTION_KEY_VERSION",
] as const;
const HOSTED_WAKE_ENCRYPTION_KEYRING_JSON_ENV_KEYS = [
  "HOSTED_WAKE_ENCRYPTION_KEYRING_JSON",
] as const;

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
  return getOrCreateHostedSecretCodec({
    cachedCodec: globalForHostedIngressEncryption.__murphHostedIngressEncryptionCodec,
    readEnvironment: readHostedIngressEncryptionEnvironment,
    setCachedCodec(codec) {
      globalForHostedIngressEncryption.__murphHostedIngressEncryptionCodec = codec;
    },
    shouldCache: process.env.NODE_ENV !== "test",
  });
}

const hostedIngressNullableStringEncryption = createHostedNullableStringEncryption<{
  field: string;
  userId: string;
  value: string | null | undefined;
}>({
  buildCipherOptions(input) {
    return buildHostedIngressFieldCipherOptions({
      field: input.field,
      memberId: input.userId,
    });
  },
  getCodec: getHostedIngressEncryptionCodec,
});

export function encryptHostedIngressNullableString(input: {
  field: string;
  userId: string;
  value: string | null | undefined;
}): string | null {
  return hostedIngressNullableStringEncryption.encryptNullableString(input);
}

export function decryptHostedIngressNullableString(input: {
  field: string;
  userId: string;
  value: string | null | undefined;
}): string | null {
  return hostedIngressNullableStringEncryption.decryptNullableString(input);
}

function buildHostedIngressFieldCipherOptions(input: {
  field: string;
  memberId: string;
}) {
  return {
    aad: buildHostedSecretAad({
      field: input.field,
      memberId: input.memberId,
      purpose: "hosted-ingress-payload",
    }),
    keyScope: `hosted-ingress-payload:${input.field}`,
  } as const;
}

function readHostedIngressEncryptionEnvironment(
  source: NodeJS.ProcessEnv = process.env,
) {
  try {
    return readHostedEncryptionEnvironment({
      envKeys: {
        encryptionKey: HOSTED_WAKE_ENCRYPTION_KEY_ENV_KEYS,
        encryptionKeyVersion: HOSTED_WAKE_ENCRYPTION_KEY_VERSION_ENV_KEYS,
        encryptionKeyringJson: HOSTED_WAKE_ENCRYPTION_KEYRING_JSON_ENV_KEYS,
      },
      keyringLabel: "HOSTED_WAKE_ENCRYPTION_KEYRING_JSON",
      readRequiredEncryptionKey: readRequiredHostedIngressEncryptionKey,
      source,
    });
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
