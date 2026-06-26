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
    CLOUDFLARE_ACCOUNT_ID: "r2-account",
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"d\":\"secret\",\"x\":\"public-x\",\"y\":\"public-y\"}",
    HOSTED_CRYPTO_ENV: "production",
    HOSTED_EXECUTION_DEPLOY_CONTEXT: "production",
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "murph-team",
    HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "r2-access-fixture",
    HOSTED_R2_PRESIGN_ACCOUNT_ID: "r2-account",
    HOSTED_R2_PRESIGN_BUCKET_NAME: "bundles",
    HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "r2-signing-fixture",
    HOSTED_ASSISTANT_MODEL: "gpt-5.5",
    HOSTED_ASSISTANT_PROVIDER: "openai",
    HOSTED_ASSISTANT_REASONING_EFFORT: "low",
    HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
    HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
      "provider-egress-signing-secret",
    HOSTED_WEB_BASE_URL: "https://app.example.test",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"public-x\",\"y\":\"public-y\",\"d\":\"private-d\"}",
    HOSTED_WEB_PRODUCTION_BASE_URL: "https://app.example.test",
    MURPH_DATA_API_KEY: "data-api-key",
    OPENAI_API_KEY: "openai-key",
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
      "HOSTED_R2_PRESIGN_ACCOUNT_ID",
      "HOSTED_R2_PRESIGN_BUCKET_NAME",
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
      "HOSTED_LOG_FINGERPRINT_SECRET",
      "HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET",
      "HOSTED_R2_PRESIGN_ACCESS_KEY_ID",
      "HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY",
      "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
      "MURPH_DATA_API_KEY",
      "OPENAI_API_KEY",
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
      "Missing required GitHub environment variables for deploy workflow: CF_BUNDLES_PREVIEW_BUCKET CF_PUBLIC_BASE_URL HOSTED_EXECUTION_DEPLOY_CONTEXT HOSTED_WEB_BASE_URL HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID HOSTED_CRYPTO_ENV HOSTED_R2_PRESIGN_ACCOUNT_ID HOSTED_R2_PRESIGN_BUCKET_NAME HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK HOSTED_LOG_FINGERPRINT_SECRET HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET HOSTED_R2_PRESIGN_ACCESS_KEY_ID HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK MURPH_DATA_API_KEY OPENAI_API_KEY",
    );
  });

  it("requires OpenAI API key for direct OpenAI hosted assistant deploys", () => {
    expect(listMissingHostedDeployEnvironment(createRequiredWorkerDeployEnv({
      OPENAI_API_KEY: undefined,
      VERCEL_AI_API_KEY: "legacy-vercel-key",
    }), { deployWorker: true })).toContain("OPENAI_API_KEY");
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

  it("requires the direct-R2 presign bucket to match the Worker R2 binding bucket", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(createRequiredWorkerDeployEnv({
      HOSTED_R2_PRESIGN_BUCKET_NAME: "other-bundles",
    }), { deployWorker: true })).toContain(
      "HOSTED_R2_PRESIGN_BUCKET_NAME must match CF_BUNDLES_BUCKET.",
    );
  });

  it("requires the direct-R2 presign account to match the Cloudflare deploy account", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(createRequiredWorkerDeployEnv({
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "other-account",
    }), { deployWorker: true })).toContain(
      "HOSTED_R2_PRESIGN_ACCOUNT_ID must match CLOUDFLARE_ACCOUNT_ID.",
    );
  });

  it("rejects local or non-account direct-R2 endpoint overrides for deploys", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(createRequiredWorkerDeployEnv({
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:9000",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://127.0.0.1:9000",
    }), { deployWorker: true })).toEqual(expect.arrayContaining([
      "HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT must not be set for deploys.",
      "HOSTED_R2_PRESIGN_CONTROL_ENDPOINT must not be set for deploys.",
      "HOSTED_R2_PRESIGN_ENDPOINT must be the account-level R2 HTTPS origin.",
    ]));

    expect(listHostedDeployEnvironmentInvariantErrors(createRequiredWorkerDeployEnv({
      HOSTED_R2_PRESIGN_ENDPOINT: "https://other-account.r2.cloudflarestorage.com",
    }), { deployWorker: true })).toContain(
      "HOSTED_R2_PRESIGN_ENDPOINT must be the account-level R2 HTTPS origin.",
    );
  });

  it("allows the explicit account-scoped direct-R2 endpoint override for deploys", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(createRequiredWorkerDeployEnv({
      HOSTED_R2_PRESIGN_ENDPOINT: "https://r2-account.r2.cloudflarestorage.com",
    }), { deployWorker: true })).not.toContain(
      "HOSTED_R2_PRESIGN_ENDPOINT must be the account-level R2 HTTPS origin.",
    );
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

  it("rejects preview-shaped worker origins in production deploys", () => {
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

  it("rejects non-canonical hosted crypto deploy environment names", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_CRYPTO_ENV: "prod",
        }),
        { deployWorker: true },
      ),
    ).toContain("HOSTED_CRYPTO_ENV must be one of development, preview, or production.");
  });

  it("requires production hosted crypto env on production deploys", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_CRYPTO_ENV: "preview",
        }),
        { deployWorker: true },
      ),
    ).toContain("production deploys must set HOSTED_CRYPTO_ENV=production.");
  });

  it("requires Junction runtime env to be configured all-or-none", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          JUNCTION_ENV: "sandbox",
          JUNCTION_REGION: "us",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "Junction runtime env must set JUNCTION_API_KEY, JUNCTION_CLIENT_USER_ID_SECRET, JUNCTION_ENV, JUNCTION_REGION together.",
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          JUNCTION_API_KEY: "junction-api-key",
          JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
          JUNCTION_ENV: "sandbox",
          JUNCTION_REGION: "us",
        }),
        { deployWorker: true },
      ),
    ).not.toContain(
      "Junction runtime env must set JUNCTION_API_KEY, JUNCTION_CLIENT_USER_ID_SECRET, JUNCTION_ENV, JUNCTION_REGION together.",
    );
  });

  it("requires an explicitly priced hosted assistant model for worker deploys", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: undefined,
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "HOSTED_ASSISTANT_MODEL must be one of gpt-5.5 for hosted AI usage allowance pricing.",
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "   ",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "HOSTED_ASSISTANT_MODEL must be one of gpt-5.5 for hosted AI usage allowance pricing.",
    );
  });

  it("requires the direct OpenAI hosted assistant provider for worker deploys", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_PROVIDER: undefined,
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "HOSTED_ASSISTANT_PROVIDER must be openai for hosted runner execution.",
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "HOSTED_ASSISTANT_PROVIDER must be openai for hosted runner execution.",
    );
  });

  it("rejects hosted assistant models without allowance pricing", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "HOSTED_ASSISTANT_MODEL must be one of gpt-5.5 for hosted AI usage allowance pricing.",
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "gpt-unpriced-mini",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "HOSTED_ASSISTANT_MODEL must be one of gpt-5.5 for hosted AI usage allowance pricing.",
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "gpt-5.4-nano",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "HOSTED_ASSISTANT_MODEL must be one of gpt-5.5 for hosted AI usage allowance pricing.",
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "openai/gpt-5.5",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "HOSTED_ASSISTANT_MODEL must be one of gpt-5.5 for hosted AI usage allowance pricing.",
    );
  });

  it("requires the production hosted assistant profile", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "gpt-unpriced-mini",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "production hosted assistant deploys must set HOSTED_ASSISTANT_MODEL=gpt-5.5.",
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_REASONING_EFFORT: undefined,
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "production hosted assistant deploys must set HOSTED_ASSISTANT_REASONING_EFFORT=low.",
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "production hosted assistant deploys must set HOSTED_ASSISTANT_REASONING_EFFORT=low.",
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv(),
        { deployWorker: true },
      ),
    ).toEqual(expect.not.arrayContaining([
      "production hosted assistant deploys must set HOSTED_ASSISTANT_MODEL=gpt-5.5.",
      "production hosted assistant deploys must set HOSTED_ASSISTANT_REASONING_EFFORT=low.",
    ]));
  });

  it("allows deploys without Junction runtime env", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          JUNCTION_PROVIDER_FILTER: "garmin",
        }),
        { deployWorker: true },
      ),
    ).not.toContain(
      "Junction runtime env must set JUNCTION_API_KEY, JUNCTION_CLIENT_USER_ID_SECRET, JUNCTION_ENV, JUNCTION_REGION together.",
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
      HOSTED_CRYPTO_ENV: "development",
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
