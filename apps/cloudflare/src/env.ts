import {
  parseHostedUserRecipientPrivateKeyJwk,
  parseHostedUserRecipientPublicKeyJwk,
  type HostedUserRecipientPrivateKeyJwk,
  type HostedUserRecipientPublicKeyJwk,
} from "@murphai/runtime-state";
import {
  normalizeHostedExecutionString,
} from "@murphai/hosted-execution/env";

import {
  requireHostedExecutionVercelOidcValidationEnvironment,
  type HostedExecutionVercelOidcValidationEnvironment,
} from "./auth-adapter.ts";
import { decodeBase64Key } from "./base64.js";
import {
  assertHostedExecutionOptionalJwkPairConfigured,
  readHostedExecutionWorkerEnvironment,
  type HostedExecutionWorkerEnvironment,
} from "./hosted-execution-worker-env.ts";
import {
  readHostedWebCallbackSigningEnvironment,
  type HostedWebCallbackSigningEnvironment,
} from "./web-callback-auth.ts";
import {
  readHostedMailboxEncryptionEnvironment,
  type HostedMailboxEncryptionEnvironment,
} from "./hosted-mailbox-encryption.ts";
import type {
  HostedWorkerCryptoEnv,
} from "./hosted-crypto/runtime-crypto-context.ts";
import {
  assertHostedLocalInternalProxyEnvironment,
} from "./local-loopback-proxy.ts";
import type { StringEnvSource } from "./string-env.ts";

export type HostedExecutionEnvironment = Omit<
  HostedExecutionWorkerEnvironment,
  | "automationRecipientPrivateJwkJson"
  | "automationRecipientPrivateKeyringJson"
  | "automationRecipientPublicJwkJson"
  | "hostedWakeEncryptionKey"
  | "hostedWakeEncryptionKeyVersion"
  | "hostedWakeEncryptionKeyringJson"
  | "recoveryRecipientPublicJwkJson"
  | "teeAutomationRecipientPublicJwkJson"
  | "platformEnvelopeKeyBase64"
  | "platformEnvelopeKeyringJson"
> & {
  automationRecipientPrivateKey: HostedUserRecipientPrivateKeyJwk;
  automationRecipientPrivateKeysById: Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>>;
  hostedWebBaseUrl: string;
  hostedCrypto: HostedWorkerCryptoEnv | null;
  hostedMailboxEncryption: HostedMailboxEncryptionEnvironment;
  automationRecipientPublicKey: HostedUserRecipientPublicKeyJwk;
  platformEnvelopeKey: Uint8Array;
  platformEnvelopeKeysById: Readonly<Record<string, Uint8Array>>;
  recoveryRecipientPublicKey: HostedUserRecipientPublicKeyJwk;
  teeAutomationRecipientPublicKey: HostedUserRecipientPublicKeyJwk | null;
  vercelOidcValidation: HostedExecutionVercelOidcValidationEnvironment;
  webCallbackSigning: HostedWebCallbackSigningEnvironment;
};

export function readHostedExecutionEnvironment(
  source: StringEnvSource = process.env,
): HostedExecutionEnvironment {
  assertHostedLocalInternalProxyEnvironment(source);

  const {
    automationRecipientPrivateJwkJson,
    automationRecipientPrivateKeyringJson,
    automationRecipientPublicJwkJson,
    hostedWakeEncryptionKey,
    hostedWakeEncryptionKeyVersion,
    hostedWakeEncryptionKeyringJson,
    recoveryRecipientPublicJwkJson,
    teeAutomationRecipientPublicJwkJson,
    platformEnvelopeKeyBase64,
    platformEnvelopeKeyringJson,
    ...environment
  } = readHostedExecutionWorkerEnvironment(source);
  const platformEnvelopeKey = decodeBase64Key(platformEnvelopeKeyBase64);
  const automationRecipientPrivateKey = parseHostedUserRecipientPrivateKeyJwk(
    parseRequiredJsonObject(automationRecipientPrivateJwkJson, "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK"),
    "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK",
  );
  const automationRecipientPublicKey = parseHostedUserRecipientPublicKeyJwk(
    parseRequiredJsonObject(automationRecipientPublicJwkJson, "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK"),
    "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  );
  const recoveryRecipientPublicKey = parseHostedUserRecipientPublicKeyJwk(
    parseRequiredJsonObject(recoveryRecipientPublicJwkJson, "HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK"),
    "HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK",
  );

  assertHostedExecutionOptionalJwkPairConfigured({
    currentKeyId: environment.teeAutomationRecipientKeyId,
    currentPublicJwkJson: teeAutomationRecipientPublicJwkJson,
    keyIdLabel: "HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID",
    publicJwkLabel: "HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  });

  return {
    ...environment,
    automationRecipientPrivateKey,
    automationRecipientPrivateKeysById: decodeHostedExecutionAutomationKeyring({
      currentKey: automationRecipientPrivateKey,
      currentKeyId: environment.automationRecipientKeyId,
      keyringJson: automationRecipientPrivateKeyringJson,
    }),
    automationRecipientPublicKey,
    hostedCrypto: readOptionalHostedWorkerCryptoEnvironment(source),
    hostedMailboxEncryption: readHostedMailboxEncryptionEnvironment({
      HOSTED_WAKE_ENCRYPTION_KEY: hostedWakeEncryptionKey,
      HOSTED_WAKE_ENCRYPTION_KEYRING_JSON: hostedWakeEncryptionKeyringJson ?? undefined,
      HOSTED_WAKE_ENCRYPTION_KEY_VERSION: hostedWakeEncryptionKeyVersion,
    }),
    platformEnvelopeKey,
    platformEnvelopeKeysById: decodeHostedExecutionPlatformEnvelopeKeyring({
      platformEnvelopeKey,
      platformEnvelopeKeyId: environment.platformEnvelopeKeyId,
      platformEnvelopeKeyringJson,
    }),
    recoveryRecipientPublicKey,
    teeAutomationRecipientPublicKey: teeAutomationRecipientPublicJwkJson
      ? parseHostedUserRecipientPublicKeyJwk(
        parseRequiredJsonObject(
          teeAutomationRecipientPublicJwkJson,
          "HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK",
        ),
        "HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK",
      )
      : null,
    vercelOidcValidation: requireHostedExecutionVercelOidcValidationEnvironment(source),
    webCallbackSigning: readHostedWebCallbackSigningEnvironment(source),
  };
}

function readOptionalHostedWorkerCryptoEnvironment(
  source: StringEnvSource,
): HostedWorkerCryptoEnv | null {
  const authoritySignKeyVersion = normalizeHostedExecutionString(
    source.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
  );
  const authoritySignPublicKeyPem = normalizeHostedExecutionString(
    source.HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
  );
  const cloudflareAutomationKeyId = normalizeHostedExecutionString(
    source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
  );
  const cloudflareAutomationPrivateJwk = normalizeHostedExecutionString(
    source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK,
  );
  const env = normalizeHostedExecutionString(source.HOSTED_CRYPTO_ENV);

  if (
    !authoritySignKeyVersion
    && !authoritySignPublicKeyPem
    && !cloudflareAutomationKeyId
    && !cloudflareAutomationPrivateJwk
    && !env
  ) {
    return null;
  }

  return {
    ...(authoritySignKeyVersion
      ? { HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: authoritySignKeyVersion }
      : {}),
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: requireHostedCryptoString(
      authoritySignPublicKeyPem,
      "HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
    ),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: requireHostedCryptoString(
      cloudflareAutomationKeyId,
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
    ),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: requireHostedCryptoString(
      cloudflareAutomationPrivateJwk,
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
    ),
    HOSTED_CRYPTO_ENV: requireHostedCryptoString(env, "HOSTED_CRYPTO_ENV"),
  };
}

function requireHostedCryptoString(value: string | null | undefined, label: string): string {
  if (!value) {
    throw new TypeError(`${label} is required when hosted runtime crypto context is configured.`);
  }

  return value;
}

function decodeHostedExecutionPlatformEnvelopeKeyring(input: {
  platformEnvelopeKey: Uint8Array;
  platformEnvelopeKeyId: string;
  platformEnvelopeKeyringJson: string | null;
}): Readonly<Record<string, Uint8Array>> {
  const keysById: Record<string, Uint8Array> = {};
  if (input.platformEnvelopeKeyringJson) {
    const parsed = parseRequiredJsonObject(
      input.platformEnvelopeKeyringJson,
      "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON",
    );

    for (const [rawKeyId, encodedKey] of Object.entries(parsed)) {
      const keyId = rawKeyId.trim();

      if (keyId.length === 0) {
        throw new TypeError(
          "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON contains a blank keyId.",
        );
      }

      if (typeof encodedKey !== "string" || encodedKey.trim().length === 0) {
        throw new TypeError(
          `HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON entry ${keyId} must be a non-empty base64 string.`,
        );
      }

      keysById[keyId] = decodeBase64Key(encodedKey);
    }
  }

  const configuredCurrentKey = keysById[input.platformEnvelopeKeyId];

  if (!configuredCurrentKey) {
    keysById[input.platformEnvelopeKeyId] = input.platformEnvelopeKey;
  } else if (!sameBytes(configuredCurrentKey, input.platformEnvelopeKey)) {
    throw new TypeError(
      `HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID ${input.platformEnvelopeKeyId} must match the current platform envelope key.`,
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
    parsed = JSON.parse(value);
  } catch (error) {
    throw new TypeError(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return parsed;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
