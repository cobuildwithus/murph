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
    recoveryPublicJwk: readOptionalJsonWebKey(source, "HOSTED_CRYPTO_RECOVERY_PUBLIC_JWK"),
    recoveryRecipientKeyId: readOptionalEnv(source, "HOSTED_CRYPTO_RECOVERY_KEY_ID"),
    teeRuntimeAttestedPolicyId: readOptionalEnv(source, "HOSTED_CRYPTO_TEE_RUNTIME_POLICY_ID"),
    teeRuntimePublicJwk: readOptionalJsonWebKey(source, "HOSTED_CRYPTO_TEE_RUNTIME_PUBLIC_JWK"),
    teeRuntimeRecipientKeyId: readOptionalEnv(source, "HOSTED_CRYPTO_TEE_RUNTIME_KEY_ID"),
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
