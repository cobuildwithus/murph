import { expect, it, vi } from "vitest";

// Fail on module evaluation, not just network calls or client construction.
vi.mock("@google-cloud/kms", () => { throw new Error("KMS SDK loaded eagerly"); });
vi.mock("google-auth-library", () => { throw new Error("Google auth SDK loaded eagerly"); });
vi.mock("@vercel/oidc", () => { throw new Error("OIDC SDK loaded eagerly"); });
vi.mock("@murphai/health-metrics", () => { throw new Error("Health metric catalog loaded eagerly"); });
vi.mock("@murphai/device-syncd/hosted-runtime", () => { throw new Error("Device sync runtime loaded eagerly"); });

it("loads the mailbox route without unrelated metric/device parsers or Google SDKs", async () => {
  const route = await import("../app/api/internal/hosted-mailbox/fetch/route");
  expect(typeof route.POST).toBe("function");
  const { createHostedGcpKmsClientFromEnv } = await import("../src/lib/hosted-crypto/gcp-kms");
  const client = createHostedGcpKmsClientFromEnv({
    HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV: "1",
    HOSTED_CRYPTO_ENV: "dev", HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "synthetic-token", NODE_ENV: "test",
  });
  expect(typeof client.decrypt).toBe("function");
});
