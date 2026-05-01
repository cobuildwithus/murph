import { describe, expect, it } from "vitest";

import { createHostedGcpKmsClientFromEnv } from "../src/lib/hosted-crypto/gcp-kms";

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
});
