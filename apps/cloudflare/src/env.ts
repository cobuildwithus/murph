import {
  readHostedExecutionWorkerEnvironment,
  type HostedExecutionWorkerEnvironment,
} from "@murphai/hosted-execution";

import { decodeBase64Key } from "./base64.js";

export type HostedExecutionEnvironment = Omit<
  HostedExecutionWorkerEnvironment,
  "bundleEncryptionKeyBase64" | "bundleEncryptionKeyringJson"
> & {
  bundleEncryptionKey: Uint8Array;
  bundleEncryptionKeysById: Readonly<Record<string, Uint8Array>>;
};

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedExecutionEnvironment(
  source: EnvSource = process.env,
): HostedExecutionEnvironment {
  const {
    bundleEncryptionKeyBase64,
    bundleEncryptionKeyringJson,
    ...environment
  } = readHostedExecutionWorkerEnvironment(source);
  const bundleEncryptionKey = decodeBase64Key(bundleEncryptionKeyBase64);

  return {
    ...environment,
    bundleEncryptionKey,
    bundleEncryptionKeysById: decodeHostedExecutionKeyring({
      bundleEncryptionKey,
      bundleEncryptionKeyId: environment.bundleEncryptionKeyId,
      bundleEncryptionKeyringJson,
    }),
  };
}

function decodeHostedExecutionKeyring(input: {
  bundleEncryptionKey: Uint8Array;
  bundleEncryptionKeyId: string;
  bundleEncryptionKeyringJson: string | null;
}): Readonly<Record<string, Uint8Array>> {
  const keysById: Record<string, Uint8Array> = {};
  if (input.bundleEncryptionKeyringJson) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(input.bundleEncryptionKeyringJson) as unknown;
    } catch (error) {
      throw new TypeError(
        `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON must be valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError(
        "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON must be a JSON object keyed by keyId.",
      );
    }

    for (const [rawKeyId, encodedKey] of Object.entries(parsed)) {
      const keyId = rawKeyId.trim();

      if (keyId.length === 0) {
        throw new TypeError(
          "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON contains a blank keyId.",
        );
      }

      if (typeof encodedKey !== "string" || encodedKey.trim().length === 0) {
        throw new TypeError(
          `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON entry ${keyId} must be a non-empty base64 string.`,
        );
      }

      keysById[keyId] = decodeBase64Key(encodedKey);
    }
  }

  const configuredCurrentKey = keysById[input.bundleEncryptionKeyId];

  if (!configuredCurrentKey) {
    keysById[input.bundleEncryptionKeyId] = input.bundleEncryptionKey;
  } else if (!sameBytes(configuredCurrentKey, input.bundleEncryptionKey)) {
    throw new TypeError(
      `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID ${input.bundleEncryptionKeyId} must match the current bundle encryption key.`,
    );
  }

  return keysById;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}
