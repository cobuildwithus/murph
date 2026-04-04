import {
  parseHostedUserRecipientPrivateKeyJwk,
  parseHostedUserRecipientPublicKeyJwk,
  type HostedUserRecipientPrivateKeyJwk,
  type HostedUserRecipientPublicKeyJwk,
} from "@murphai/runtime-state";
import {
  readHostedExecutionWorkerEnvironment,
  type HostedExecutionWorkerEnvironment,
} from "@murphai/hosted-execution";

import { decodeBase64Key } from "./base64.js";

export type HostedExecutionEnvironment = Omit<
  HostedExecutionWorkerEnvironment,
  | "automationRecipientPrivateJwkJson"
  | "automationRecipientPrivateKeyringJson"
  | "automationRecipientPublicJwkJson"
  | "bundleEncryptionKeyBase64"
  | "bundleEncryptionKeyringJson"
> & {
  automationRecipientPrivateKey: HostedUserRecipientPrivateKeyJwk;
  automationRecipientPrivateKeysById: Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>>;
  automationRecipientPublicKey: HostedUserRecipientPublicKeyJwk;
  bundleEncryptionKey: Uint8Array;
  bundleEncryptionKeysById: Readonly<Record<string, Uint8Array>>;
};

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedExecutionEnvironment(
  source: EnvSource = process.env,
): HostedExecutionEnvironment {
  const {
    automationRecipientPrivateJwkJson,
    automationRecipientPrivateKeyringJson,
    automationRecipientPublicJwkJson,
    bundleEncryptionKeyBase64,
    bundleEncryptionKeyringJson,
    ...environment
  } = readHostedExecutionWorkerEnvironment(source);
  const bundleEncryptionKey = decodeBase64Key(bundleEncryptionKeyBase64);
  const automationRecipientPrivateKey = parseHostedUserRecipientPrivateKeyJwk(
    parseRequiredJsonObject(automationRecipientPrivateJwkJson, "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK"),
    "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK",
  );
  const automationRecipientPublicKey = parseHostedUserRecipientPublicKeyJwk(
    parseRequiredJsonObject(automationRecipientPublicJwkJson, "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK"),
    "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  );

  return {
    ...environment,
    automationRecipientPrivateKey,
    automationRecipientPrivateKeysById: decodeHostedExecutionAutomationKeyring({
      currentKey: automationRecipientPrivateKey,
      currentKeyId: environment.automationRecipientKeyId,
      keyringJson: automationRecipientPrivateKeyringJson,
    }),
    automationRecipientPublicKey,
    bundleEncryptionKey,
    bundleEncryptionKeysById: decodeHostedExecutionBundleKeyring({
      bundleEncryptionKey,
      bundleEncryptionKeyId: environment.bundleEncryptionKeyId,
      bundleEncryptionKeyringJson,
    }),
  };
}

function decodeHostedExecutionBundleKeyring(input: {
  bundleEncryptionKey: Uint8Array;
  bundleEncryptionKeyId: string;
  bundleEncryptionKeyringJson: string | null;
}): Readonly<Record<string, Uint8Array>> {
  const keysById: Record<string, Uint8Array> = {};
  if (input.bundleEncryptionKeyringJson) {
    const parsed = parseRequiredJsonObject(
      input.bundleEncryptionKeyringJson,
      "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON",
    );

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

function decodeHostedExecutionAutomationKeyring(input: {
  currentKey: HostedUserRecipientPrivateKeyJwk;
  currentKeyId: string;
  keyringJson: string | null;
}): Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>> {
  const keysById: Record<string, HostedUserRecipientPrivateKeyJwk> = {};

  if (input.keyringJson) {
    const parsed = parseRequiredJsonObject(
      input.keyringJson,
      "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON",
    );

    for (const [rawKeyId, rawKey] of Object.entries(parsed)) {
      const keyId = rawKeyId.trim();

      if (keyId.length === 0) {
        throw new TypeError(
          "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON contains a blank keyId.",
        );
      }

      keysById[keyId] = parseHostedUserRecipientPrivateKeyJwk(
        rawKey,
        `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON.${keyId}`,
      );
    }
  }

  keysById[input.currentKeyId] = input.currentKey;
  return keysById;
}

function parseRequiredJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new TypeError(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
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
