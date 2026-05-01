import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { createHostedGcpKmsClientFromEnv } from "../src/lib/hosted-crypto/gcp-kms";

const LOCAL_KMS_API_ROOT = "local://murph-hosted-kms";
const LOCAL_KMS_KEY_NAME =
  "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap";
const LOCAL_SIGN_KEY_VERSION =
  "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/authority-sign/cryptoKeyVersions/1";

describe("hosted crypto GCP KMS access-token guard", () => {
  it("rejects static GCP access tokens in production", () => {
    expect(() => createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ENV: "prod",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.static-token",
      NODE_ENV: "test",
    })).toThrow(/HOSTED_CRYPTO_GCP_ACCESS_TOKEN.*not allowed in production/i);
  });

  it("requires an explicit local-dev override for static GCP access tokens", () => {
    expect(() => createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ENV: "dev",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.static-token",
      NODE_ENV: "test",
    })).toThrow(/HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV=1/i);
  });

  it("allows static GCP access tokens only when explicitly marked as local dev", () => {
    expect(() => createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV: "1",
      HOSTED_CRYPTO_ENV: "dev",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.static-token",
      NODE_ENV: "test",
    })).not.toThrow();
  });

  it("rejects custom GCP endpoint overrides in production", () => {
    const productionBase = {
      HOSTED_CRYPTO_ENV: "prod",
      HOSTED_CRYPTO_GCP_PROJECT_NUMBER: "123456789",
      HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL: "hosted-crypto@example.test",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID: "pool",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "provider",
      NODE_ENV: "test",
    } satisfies NodeJS.ProcessEnv;

    for (const [key, value] of [
      ["HOSTED_CRYPTO_GCP_IAM_CREDENTIALS_API_ROOT", "https://iamcredentials.example.test/v1"],
      ["HOSTED_CRYPTO_GCP_KMS_API_ROOT", "https://kms.example.test/v1"],
      ["HOSTED_CRYPTO_GCP_STS_TOKEN_URI", "https://sts.example.test/v1/token"],
    ] as const) {
      expect(() => createHostedGcpKmsClientFromEnv({
        ...productionBase,
        [key]: value,
      })).toThrow(new RegExp(`${key}.*not allowed in production`, "u"));
    }
  });
});

describe("hosted crypto local KMS", () => {
  it("encrypts, decrypts, and signs without GCP credentials", async () => {
    const signingKey = await createLocalSigningKey();
    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: LOCAL_KMS_API_ROOT,
      HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: signingKey.privateJwkJson,
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
      NODE_ENV: "test",
    });

    const plaintext = new TextEncoder().encode("local hosted root");
    const encrypted = await client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: LOCAL_KMS_KEY_NAME,
      plaintext,
    });
    const decrypted = await client.decrypt({
      additionalAuthenticatedData: "domain=control",
      ciphertext: encrypted.ciphertext,
      keyName: LOCAL_KMS_KEY_NAME,
    });
    const signed = await client.asymmetricSign({
      keyVersionName: LOCAL_SIGN_KEY_VERSION,
      message: new TextEncoder().encode("sign me"),
    });

    expect(encrypted.ciphertext).toMatch(/^local-kms-v1:/u);
    expect(new TextDecoder().decode(decrypted.plaintext)).toBe("local hosted root");
    expect(signed.keyVersionName).toBe(LOCAL_SIGN_KEY_VERSION);
    await expect(
      crypto.subtle.verify(
        { hash: "SHA-256", name: "ECDSA" },
        signingKey.publicKey,
        Buffer.from(signed.signature, "base64"),
        new TextEncoder().encode("sign me"),
      ),
    ).resolves.toBe(true);
  });

  it("binds local ciphertext to the supplied KMS AAD", async () => {
    const signingKey = await createLocalSigningKey();
    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: LOCAL_KMS_API_ROOT,
      HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: signingKey.privateJwkJson,
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 8).toString("base64"),
      NODE_ENV: "test",
    });
    const encrypted = await client.encrypt({
      additionalAuthenticatedData: "expected-aad",
      keyName: LOCAL_KMS_KEY_NAME,
      plaintext: new Uint8Array([1, 2, 3]),
    });

    await expect(client.decrypt({
      additionalAuthenticatedData: "wrong-aad",
      ciphertext: encrypted.ciphertext,
      keyName: LOCAL_KMS_KEY_NAME,
    })).rejects.toThrow();
  });

  it("rejects the local KMS shim in production", async () => {
    const signingKey = await createLocalSigningKey();
    const baseEnv = {
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: LOCAL_KMS_API_ROOT,
      HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: signingKey.privateJwkJson,
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
      NODE_ENV: "test",
    } satisfies NodeJS.ProcessEnv;
    const productionEnvironments: readonly NodeJS.ProcessEnv[] = [
      { ...baseEnv, NODE_ENV: "production" },
      { ...baseEnv, NODE_ENV: "test", VERCEL_ENV: "production" },
      { ...baseEnv, HOSTED_CRYPTO_ENV: "prod", NODE_ENV: "test" },
      { ...baseEnv, HOSTED_CRYPTO_ENV: "production", NODE_ENV: "test" },
    ];

    for (const env of productionEnvironments) {
      expect(() => createHostedGcpKmsClientFromEnv(env)).toThrow(
        /local KMS is not allowed in production/u,
      );
    }
  });
});

async function createLocalSigningKey(): Promise<{
  privateJwkJson: string;
  publicKey: CryptoKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateJwkJson: JSON.stringify(await crypto.subtle.exportKey("jwk", keyPair.privateKey)),
    publicKey: keyPair.publicKey,
  };
}
