import { describe, expect, it } from "vitest";

import {
  assertHostedDeployEnvironment,
  assertHostedDeployEnvironmentAsync,
  listHostedDeployEnvironmentInvariantErrors,
  listHostedDeployEnvironmentInvariantErrorsAsync,
  listMissingHostedDeployEnvironment,
  parseDeployWorkerFlag,
} from "../scripts/deploy-preflight.js";

type EnvSource = Readonly<Record<string, string | undefined>>;

function createRequiredWorkerDeployEnv(overrides: Record<string, string | undefined> = {}): EnvSource {
  return {
    CF_BUNDLES_BUCKET: "bundles",
    CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
    CF_PUBLIC_BASE_URL: "https://worker.example.test",
    CF_WORKER_NAME: "hosted-runner",
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"d\":\"secret\",\"x\":\"public-x\",\"y\":\"public-y\"}",
    HOSTED_CRYPTO_ENV: "prod",
    HOSTED_EXECUTION_DEPLOY_CONTEXT: "production",
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "murph-team",
    HOSTED_WEB_BASE_URL: "https://app.example.test",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"public-x\",\"y\":\"public-y\",\"d\":\"private-d\"}",
    HOSTED_WEB_PRODUCTION_BASE_URL: "https://app.example.test",
    ...overrides,
  };
}

describe("deploy preflight helpers", () => {
  it("requires the base deploy environment regardless of deploy mode", () => {
    expect(listMissingHostedDeployEnvironment({}, { deployWorker: false })).toEqual([
      "CF_WORKER_NAME",
      "CF_BUNDLES_BUCKET",
      "CF_BUNDLES_PREVIEW_BUCKET",
    ]);
  });

  it("requires the worker public URL plus hosted web OIDC validation env when deploy_worker is enabled", () => {
    expect(listMissingHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
      CF_WORKER_NAME: "hosted-runner",
    }, { deployWorker: true })).toEqual([
      "CF_PUBLIC_BASE_URL",
      "HOSTED_EXECUTION_DEPLOY_CONTEXT",
      "HOSTED_WEB_BASE_URL",
      "HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG",
      "HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME",
      "HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION",
      "HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
      "HOSTED_CRYPTO_ENV",
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
      "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
    ]);
  });

  it("does not require worker-only secrets for config-only runs", () => {
    expect(listMissingHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
      CF_WORKER_NAME: "hosted-runner",
    }, { deployWorker: false })).toEqual([]);
  });

  it("allows config-only runs without CF_PUBLIC_BASE_URL", () => {
    expect(() => assertHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
      CF_WORKER_NAME: "hosted-runner",
    }, { deployWorker: false })).not.toThrow();
  });

  it("treats whitespace-only values as missing", () => {
    expect(() => assertHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "   ",
      CF_PUBLIC_BASE_URL: "   ",
      CF_WORKER_NAME: "hosted-runner",
      HOSTED_EXECUTION_DEPLOY_CONTEXT: "   ",
      HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "   ",
      HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "   ",
      HOSTED_WEB_BASE_URL: "   ",
    }, { deployWorker: true })).toThrowError(
      "Missing required GitHub environment variables for deploy workflow: CF_BUNDLES_PREVIEW_BUCKET CF_PUBLIC_BASE_URL HOSTED_EXECUTION_DEPLOY_CONTEXT HOSTED_WEB_BASE_URL HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID HOSTED_CRYPTO_ENV HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
    );
  });

  it("allows production deploys only when the hosted web origin matches the explicit production origin", () => {
    expect(() => assertHostedDeployEnvironment(
      createRequiredWorkerDeployEnv(),
      { deployWorker: true },
    )).not.toThrow();
  });

  it("requires an explicit production web origin for production worker deploys", () => {
    expect(listMissingHostedDeployEnvironment(createRequiredWorkerDeployEnv({
      HOSTED_WEB_PRODUCTION_BASE_URL: undefined,
    }), { deployWorker: true })).toContain("HOSTED_WEB_PRODUCTION_BASE_URL");
  });

  it("rejects production worker deploys that point at preview or development web origins", () => {
    expect(() => assertHostedDeployEnvironment(createRequiredWorkerDeployEnv({
      HOSTED_WEB_BASE_URL: "https://preview.example.test",
    }), { deployWorker: true })).toThrowError(
      "production deploys must set HOSTED_WEB_BASE_URL to HOSTED_WEB_PRODUCTION_BASE_URL",
    );
  });

  it("rejects preview-shaped hosted web origins even when the expected production URL is misconfigured", () => {
    expect(() => assertHostedDeployEnvironment(createRequiredWorkerDeployEnv({
      HOSTED_WEB_BASE_URL: "https://murph-git-main-team.vercel.app",
      HOSTED_WEB_PRODUCTION_BASE_URL: "https://murph-git-main-team.vercel.app",
    }), { deployWorker: true })).toThrowError(
      "HOSTED_WEB_BASE_URL must not use a preview or development origin",
    );
  });

  it("rejects preview-shaped worker and callback origins in production deploys", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(createRequiredWorkerDeployEnv({
      CF_PUBLIC_BASE_URL: "https://worker-git-main-team.workers.dev",
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-preview.example.test/api/device-sync",
    }), { deployWorker: true })).toEqual(expect.arrayContaining([
      "CF_PUBLIC_BASE_URL must not use a preview or development origin in production deploys.",
      "DEVICE_SYNC_PUBLIC_BASE_URL must not use a preview or development origin in production deploys.",
    ]));
  });

  it("keeps non-IP hostnames that start like IPv6 private ranges eligible for production", () => {
    expect(() => assertHostedDeployEnvironment(createRequiredWorkerDeployEnv({
      HOSTED_WEB_BASE_URL: "https://fd-prod.example.test",
      HOSTED_WEB_PRODUCTION_BASE_URL: "https://fd-prod.example.test",
    }), { deployWorker: true })).not.toThrow();
  });

  it.each([
    ["http worker origin", { CF_PUBLIC_BASE_URL: "http://worker.example.test" }],
    ["http hosted web origin", { HOSTED_WEB_BASE_URL: "http://app.example.test" }],
    ["localhost hosted web origin", { HOSTED_WEB_BASE_URL: "https://localhost" }],
    ["loopback hosted web origin", { HOSTED_WEB_BASE_URL: "https://127.0.0.1" }],
    ["Docker bridge hosted web origin", { HOSTED_WEB_BASE_URL: "https://host.docker.internal" }],
    ["private IPv4 hosted web origin", { HOSTED_WEB_BASE_URL: "https://10.1.2.3" }],
    ["private IPv6 hosted web origin", { HOSTED_WEB_BASE_URL: "https://[fd00::1]" }],
    ["IPv4-mapped private callback origin", { DEVICE_SYNC_PUBLIC_BASE_URL: "https://[::ffff:10.1.2.3]/api/device-sync" }],
    ["private device-sync callback origin", { DEVICE_SYNC_PUBLIC_BASE_URL: "https://192.168.1.20/api/device-sync" }],
  ])("rejects production deploy URLs with %s", (_name, overrides) => {
    expect(() => assertHostedDeployEnvironment(
      createRequiredWorkerDeployEnv(overrides),
      { deployWorker: true },
    )).toThrowError(/Invalid GitHub environment variables for deploy workflow/u);
  });

  it("rejects a production worker configured to trust preview or development Vercel OIDC tokens", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(createRequiredWorkerDeployEnv({
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "preview",
    }), { deployWorker: true })).toContain(
      "production deploys must set HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=production.",
    );
  });

  it("rejects production OIDC environment casing that the worker runtime would reject", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(createRequiredWorkerDeployEnv({
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "Production",
    }), { deployWorker: true })).toContain(
      "HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT must be one of development, preview, or production.",
    );
  });

  it("rejects malformed deploy contexts before deployment", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(createRequiredWorkerDeployEnv({
      HOSTED_EXECUTION_DEPLOY_CONTEXT: "prod",
    }), { deployWorker: true })).toEqual([
      "HOSTED_EXECUTION_DEPLOY_CONTEXT must be one of development, preview, or production.",
    ]);
  });

  it("keeps local development worker deploy preflight tolerant of localhost web origins", () => {
    expect(() => assertHostedDeployEnvironment(createRequiredWorkerDeployEnv({
      CF_PUBLIC_BASE_URL: "http://localhost:8787",
      HOSTED_EXECUTION_DEPLOY_CONTEXT: "development",
      HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
      HOSTED_WEB_PRODUCTION_BASE_URL: undefined,
    }), { deployWorker: true })).not.toThrow();
  });

  it("allows production deploy DNS records only when they resolve to public addresses", async () => {
    await expect(assertHostedDeployEnvironmentAsync(
      createRequiredWorkerDeployEnv(),
      { deployWorker: true },
      {
        resolveHostnameAddresses: async () => ["8.8.8.8", "2001:4860:4860::8888"],
      },
    )).resolves.toBeUndefined();
  });

  it("rejects production deploy hostnames that resolve to private-network addresses", async () => {
    await expect(listHostedDeployEnvironmentInvariantErrorsAsync(
      createRequiredWorkerDeployEnv(),
      { deployWorker: true },
      {
        resolveHostnameAddresses: async (hostname) =>
          hostname === "app.example.test" ? ["10.1.2.3"] : ["8.8.8.8"],
      },
    )).resolves.toContain(
      "HOSTED_WEB_BASE_URL must not resolve to private-network addresses in production deploys.",
    );
  });

  it("rejects production deploy hostnames that resolve to dotted IPv4-mapped private IPv6 addresses", async () => {
    await expect(listHostedDeployEnvironmentInvariantErrorsAsync(
      createRequiredWorkerDeployEnv(),
      { deployWorker: true },
      {
        resolveHostnameAddresses: async (hostname) =>
          hostname === "app.example.test" ? ["::ffff:10.1.2.3"] : ["8.8.8.8"],
      },
    )).resolves.toContain(
      "HOSTED_WEB_BASE_URL must not resolve to private-network addresses in production deploys.",
    );
  });

  it("parses truthy deploy-worker flag values", () => {
    expect(parseDeployWorkerFlag("true")).toBe(true);
    expect(parseDeployWorkerFlag("1")).toBe(true);
    expect(parseDeployWorkerFlag("yes")).toBe(true);
    expect(parseDeployWorkerFlag("no")).toBe(false);
    expect(parseDeployWorkerFlag(" false ")).toBe(false);
    expect(parseDeployWorkerFlag(undefined)).toBe(false);
  });
});
