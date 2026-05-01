import { createHostedGcpKmsClientFromEnv, type HostedGcpKmsClient } from "./gcp-kms";

export interface HostedWebCryptoConfig {
  authoritySignKeyVersionName: string;
  authoritySignPublicKeyPem: string;
  cloudflareAutomationPublicJwk: JsonWebKey;
  cloudflareAutomationRecipientKeyId: string;
  env: string;
  gcpKms: HostedGcpKmsClient;
  recoveryPublicJwk: JsonWebKey | null;
  recoveryRecipientKeyId: string | null;
  teeRuntimeAttestedPolicyId: string | null;
  teeRuntimePublicJwk: JsonWebKey | null;
  teeRuntimeRecipientKeyId: string | null;
  webWrapKmsKeyName: string;
}

let cachedConfig: HostedWebCryptoConfig | null = null;

export function getHostedWebCryptoConfig(
  source: NodeJS.ProcessEnv = process.env,
): HostedWebCryptoConfig {
  if (cachedConfig && source === process.env && process.env.NODE_ENV !== "test") {
    return cachedConfig;
  }
  const recoveryRecipient = readOptionalRecipientKeyPair(source, {
    keyIdEnv: "HOSTED_CRYPTO_RECOVERY_KEY_ID",
    publicJwkEnv: "HOSTED_CRYPTO_RECOVERY_PUBLIC_JWK",
  });
  const teeRuntimeRecipient = readOptionalTeeRuntimeRecipient(source);
  const config: HostedWebCryptoConfig = {
    authoritySignKeyVersionName: readRequiredEnv(
      source,
      "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION",
    ),
    authoritySignPublicKeyPem: readRequiredEnv(
      source,
      "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
    ).replace(/\\n/g, "\n"),
    cloudflareAutomationPublicJwk: readRequiredJsonWebKey(
      source,
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
    ),
    cloudflareAutomationRecipientKeyId: readRequiredEnv(
      source,
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
    ),
    env: readHostedCryptoEnv(source),
    gcpKms: createHostedGcpKmsClientFromEnv(source),
    recoveryPublicJwk: recoveryRecipient.publicJwk,
    recoveryRecipientKeyId: recoveryRecipient.keyId,
    teeRuntimeAttestedPolicyId: teeRuntimeRecipient.policyId,
    teeRuntimePublicJwk: teeRuntimeRecipient.publicJwk,
    teeRuntimeRecipientKeyId: teeRuntimeRecipient.keyId,
    webWrapKmsKeyName: readRequiredEnv(source, "HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME"),
  };
  if (source === process.env && process.env.NODE_ENV !== "test") {
    cachedConfig = config;
  }
  return config;
}

function readHostedCryptoEnv(source: NodeJS.ProcessEnv): string {
  return readRequiredEnv(source, "HOSTED_CRYPTO_ENV");
}

function readRequiredJsonWebKey(source: NodeJS.ProcessEnv, key: string): JsonWebKey {
  const jwk = readOptionalJsonWebKey(source, key);
  if (!jwk) {
    throw new TypeError(`${key} must be configured for hosted crypto.`);
  }
  return jwk;
}

function readOptionalTeeRuntimeRecipient(source: NodeJS.ProcessEnv): {
  keyId: string | null;
  policyId: string | null;
  publicJwk: JsonWebKey | null;
} {
  const recipient = readOptionalRecipientKeyPair(source, {
    keyIdEnv: "HOSTED_CRYPTO_TEE_RUNTIME_KEY_ID",
    publicJwkEnv: "HOSTED_CRYPTO_TEE_RUNTIME_PUBLIC_JWK",
  });
  const policyId = readOptionalEnv(source, "HOSTED_CRYPTO_TEE_RUNTIME_POLICY_ID");
  if (recipient.publicJwk && recipient.keyId && !policyId) {
    throw new TypeError(
      "HOSTED_CRYPTO_TEE_RUNTIME_POLICY_ID must be configured with hosted crypto TEE runtime recipient keys.",
    );
  }
  if ((!recipient.publicJwk || !recipient.keyId) && policyId) {
    throw new TypeError(
      "HOSTED_CRYPTO_TEE_RUNTIME_PUBLIC_JWK, HOSTED_CRYPTO_TEE_RUNTIME_KEY_ID, and HOSTED_CRYPTO_TEE_RUNTIME_POLICY_ID must be configured together for hosted crypto.",
    );
  }
  return {
    keyId: recipient.keyId,
    policyId,
    publicJwk: recipient.publicJwk,
  };
}

function readOptionalRecipientKeyPair(
  source: NodeJS.ProcessEnv,
  keys: { keyIdEnv: string; publicJwkEnv: string },
): { keyId: string | null; publicJwk: JsonWebKey | null } {
  const publicJwk = readOptionalJsonWebKey(source, keys.publicJwkEnv);
  const keyId = readOptionalEnv(source, keys.keyIdEnv);
  if ((publicJwk && !keyId) || (!publicJwk && keyId)) {
    throw new TypeError(
      `${keys.publicJwkEnv} and ${keys.keyIdEnv} must be configured together for hosted crypto.`,
    );
  }
  return { keyId, publicJwk };
}

function readOptionalJsonWebKey(source: NodeJS.ProcessEnv, key: string): JsonWebKey | null {
  const raw = readOptionalEnv(source, key);
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw) as JsonWebKey;
  if (
    parsed.kty !== "EC"
    || parsed.crv !== "P-256"
    || typeof parsed.x !== "string"
    || typeof parsed.y !== "string"
    || parsed.x.length === 0
    || parsed.y.length === 0
    || "d" in parsed
  ) {
    throw new TypeError(`${key} must be a public P-256 EC JWK.`);
  }
  return { crv: "P-256", kty: "EC", x: parsed.x, y: parsed.y };
}

function readRequiredEnv(source: NodeJS.ProcessEnv, ...keys: string[]): string {
  const value = readOptionalEnv(source, ...keys);
  if (!value) {
    throw new TypeError(`${keys.join(" or ")} must be configured for hosted crypto.`);
  }
  return value;
}

function readOptionalEnv(source: NodeJS.ProcessEnv, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}
