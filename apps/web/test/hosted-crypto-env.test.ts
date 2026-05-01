import assert from "node:assert/strict";

import { expect, test } from "vitest";

import { getHostedWebCryptoConfig } from "../src/lib/hosted-crypto/env";

const PUBLIC_JWK = {
  crv: "P-256",
  kty: "EC",
  x: "x-coordinate",
  y: "y-coordinate",
};

const BASE_ENV: Record<string, string> = {
  HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
  HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK: JSON.stringify(PUBLIC_JWK),
  HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV: "1",
  HOSTED_CRYPTO_ENV: "test",
  HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "local-dev-token",
  HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
  HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: "-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----",
  HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME: "projects/test/locations/global/keyRings/ring/cryptoKeys/wrap",
};

test("hosted crypto env accepts public recipient keys without requiring WIF when a local token is configured", () => {
  const config = getHostedWebCryptoConfig(buildEnv());

  assert.equal(config.env, "test");
  assert.equal(config.cloudflareAutomationRecipientKeyId, "cf-key-v1");
  assert.equal(config.recoveryPublicJwk, null);
  assert.equal(
    config.authoritySignPublicKeyPem,
    "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----",
  );
});

test("hosted crypto env rejects private components in public recipient keys", () => {
  expect(() =>
    getHostedWebCryptoConfig({
      ...buildEnv(),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK: JSON.stringify({
        ...PUBLIC_JWK,
        d: "private-material",
      }),
    }),
  ).toThrow(/must be a public P-256 EC JWK/u);

  expect(() =>
    getHostedWebCryptoConfig({
      ...buildEnv(),
      HOSTED_CRYPTO_RECOVERY_KEY_ID: "recovery-key-v1",
      HOSTED_CRYPTO_RECOVERY_PUBLIC_JWK: JSON.stringify({
        ...PUBLIC_JWK,
        d: "private-material",
      }),
    }),
  ).toThrow(/must be a public P-256 EC JWK/u);
});

test("hosted crypto env rejects partial optional recipient configuration", () => {
  expect(() =>
    getHostedWebCryptoConfig({
      ...buildEnv(),
      HOSTED_CRYPTO_RECOVERY_PUBLIC_JWK: JSON.stringify(PUBLIC_JWK),
    }),
  ).toThrow(/HOSTED_CRYPTO_RECOVERY_PUBLIC_JWK and HOSTED_CRYPTO_RECOVERY_KEY_ID/u);

  expect(() =>
    getHostedWebCryptoConfig({
      ...buildEnv(),
      HOSTED_CRYPTO_RECOVERY_KEY_ID: "recovery-key-v1",
    }),
  ).toThrow(/HOSTED_CRYPTO_RECOVERY_PUBLIC_JWK and HOSTED_CRYPTO_RECOVERY_KEY_ID/u);

  expect(() =>
    getHostedWebCryptoConfig({
      ...buildEnv(),
      HOSTED_CRYPTO_TEE_RUNTIME_KEY_ID: "tee-runtime-v1",
      HOSTED_CRYPTO_TEE_RUNTIME_PUBLIC_JWK: JSON.stringify(PUBLIC_JWK),
    }),
  ).toThrow(/HOSTED_CRYPTO_TEE_RUNTIME_POLICY_ID/u);

  expect(() =>
    getHostedWebCryptoConfig({
      ...buildEnv(),
      HOSTED_CRYPTO_TEE_RUNTIME_POLICY_ID: "tee-policy-v1",
    }),
  ).toThrow(/HOSTED_CRYPTO_TEE_RUNTIME_PUBLIC_JWK/u);
});

test("hosted crypto env rejects static GCP access tokens in production by default", () => {
  expect(() =>
    getHostedWebCryptoConfig(buildEnv({
      NODE_ENV: "production",
    })),
  ).toThrow(/HOSTED_CRYPTO_GCP_ACCESS_TOKEN is not allowed in production/u);
});

function buildEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...BASE_ENV,
    ...overrides,
  };
}
