import { Buffer } from "node:buffer";

import {
  createHostedSecretCodec,
  decodeHostedEncryptionKey,
  decodeHostedEncryptionKeyring,
  type HostedSecretCipherOptions,
  type HostedSecretCodec,
} from "./device-sync/crypto";
import { normalizeNullableString } from "./primitives";

export interface HostedEncryptionEnvironment {
  encryptionKey: Buffer;
  encryptionKeyVersion: string;
  encryptionKeysByVersion: Readonly<Record<string, Buffer>>;
}

interface HostedEncryptionEnvironmentInput {
  envKeys: {
    encryptionKey: readonly string[];
    encryptionKeyVersion: readonly string[];
    encryptionKeyringJson: readonly string[];
  };
  keyringLabel: string;
  readRequiredEncryptionKey: () => never;
  source?: NodeJS.ProcessEnv;
}

interface HostedSecretCodecCacheInput {
  cachedCodec: HostedSecretCodec | undefined;
  readEnvironment: () => HostedEncryptionEnvironment;
  setCachedCodec: (codec: HostedSecretCodec) => void;
  shouldCache: boolean;
}

interface HostedNullableStringEncryptionInput<Input extends { value: string | null | undefined }> {
  buildCipherOptions: (input: Input) => HostedSecretCipherOptions;
  getCodec: () => HostedSecretCodec;
}

export function createHostedNullableStringEncryption<
  Input extends { value: string | null | undefined },
>(config: HostedNullableStringEncryptionInput<Input>) {
  function encryptNullableString(input: Input): string | null {
    const normalized = normalizeNullableString(input.value);

    if (!normalized) {
      return null;
    }

    return config.getCodec().encrypt(normalized, config.buildCipherOptions(input));
  }

  function decryptNullableString(input: Input): string | null {
    const normalized = normalizeNullableString(input.value);

    if (!normalized) {
      return null;
    }

    return normalizeNullableString(
      config.getCodec().decrypt(normalized, config.buildCipherOptions(input)),
    );
  }

  return {
    decryptNullableString,
    encryptNullableString,
  } as const;
}

export function getOrCreateHostedSecretCodec(
  input: HostedSecretCodecCacheInput,
): HostedSecretCodec {
  if (input.cachedCodec) {
    return input.cachedCodec;
  }

  const environment = input.readEnvironment();
  const codec = createHostedSecretCodec({
    key: environment.encryptionKey,
    keyVersion: environment.encryptionKeyVersion,
    keysByVersion: environment.encryptionKeysByVersion,
  });

  if (input.shouldCache) {
    input.setCachedCodec(codec);
  }

  return codec;
}

export function readHostedEncryptionEnvironment(
  input: HostedEncryptionEnvironmentInput,
): HostedEncryptionEnvironment {
  const source = input.source ?? process.env;
  const encryptionKeyValue = readEnv(source, input.envKeys.encryptionKey);
  const encryptionKeyVersion =
    readEnv(source, input.envKeys.encryptionKeyVersion) ?? "v1";
  const encryptionKeyringJson = readEnv(source, input.envKeys.encryptionKeyringJson);
  const encryptionKey = encryptionKeyValue
    ? decodeHostedEncryptionKey(encryptionKeyValue)
    : input.readRequiredEncryptionKey();

  return {
    encryptionKey,
    encryptionKeyVersion,
    encryptionKeysByVersion: decodeHostedEncryptionKeyring({
      currentKey: encryptionKey,
      currentKeyVersion: encryptionKeyVersion,
      keyringJson: encryptionKeyringJson,
      label: input.keyringLabel,
    }),
  };
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
