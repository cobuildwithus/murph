import {
  HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_ORIGIN,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
  HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR,
} from "@murphai/runtime-state";
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

const HOSTED_ASSISTANT_MODEL_PRICING_ERROR =
  "HOSTED_ASSISTANT_MODEL must be one of gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna for hosted AI usage allowance pricing.";
const HOSTED_STATE_ISOLATION_ROLLOUT_ERROR =
  "production state-isolation deploys must use HOSTED_EXECUTION_CONTAINER_ROLLOUT=immediate; rollback floor is the audience-key and selector-scope runner bundle.";

function createRequiredWorkerDeployEnv(overrides: Record<string, string | undefined> = {}): EnvSource {
  return {
    CF_BUNDLES_BUCKET: "bundles",
    CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
    CF_PUBLIC_BASE_URL: HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_ORIGIN,
    CF_WORKER_NAME: "hosted-runner",
    CLOUDFLARE_ACCOUNT_ID: "r2-account",
    HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET:
      "private-media-capability-secret-fixture",
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"d\":\"secret\",\"x\":\"public-x\",\"y\":\"public-y\"}",
    HOSTED_CRYPTO_ENV: "production",
    HOSTED_DATABASE_ALERT_ENABLED: "1",
    HOSTED_DATABASE_ALERT_LINQ_CHAT_ID: "chat-test",
    HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID: "chat-secondary-test",
    HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID: "branch-test",
    HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME: "main",
    HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME: "database-test",
    HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION: "org-test",
    HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN: "metrics-token-test",
    HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID:
      "metrics-token-id-test",
    HOSTED_EXECUTION_DEPLOY_CONTEXT: "production",
    HOSTED_EXECUTION_CONTAINER_ROLLOUT: "immediate",
    HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "production",
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "murph-team",
    HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "r2-access-fixture",
    HOSTED_R2_PRESIGN_ACCOUNT_ID: "r2-account",
    HOSTED_R2_PRESIGN_BUCKET_NAME: "bundles",
    HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "r2-signing-fixture",
    HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
    HOSTED_ASSISTANT_PROVIDER: "openai",
    HOSTED_ASSISTANT_REASONING_EFFORT: "low",
    HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
    LINQ_API_TOKEN: "linq-token-test",
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

function createRequiredPreviewWorkerDeployEnv(
  overrides: Record<string, string | undefined> = {},
): EnvSource {
  return createRequiredWorkerDeployEnv({
    CF_BUNDLES_BUCKET: "hosted-bundles-staging",
    CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-staging",
    CF_PUBLIC_BASE_URL: "https://hosted-runner-staging.example.test",
    CF_WORKER_NAME: "hosted-runner-staging",
    HOSTED_CRYPTO_ENV: "preview",
    HOSTED_DATABASE_ALERT_ENABLED: undefined,
    HOSTED_EXECUTION_DEPLOY_CONTEXT: "preview",
    HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "preview",
    HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-bundles-staging",
    HOSTED_WEB_BASE_URL: "https://web-staging.example.test",
    HOSTED_WEB_PRODUCTION_BASE_URL: "https://app.example.test",
    ...overrides,
  });
}

async function readValidR2BucketInfo(bucketName: string) {
  return {
    defaultStorageClass: "Standard",
    location: "ENAM",
    name: bucketName,
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

  it("requires the worker public URL plus hosted web validation env when deploy_worker is enabled", () => {
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
      "HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET",
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
      "Missing required GitHub environment variables for deploy workflow: CF_BUNDLES_PREVIEW_BUCKET CF_PUBLIC_BASE_URL HOSTED_EXECUTION_DEPLOY_CONTEXT HOSTED_WEB_BASE_URL HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID HOSTED_CRYPTO_ENV HOSTED_R2_PRESIGN_ACCOUNT_ID HOSTED_R2_PRESIGN_BUCKET_NAME HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK HOSTED_LOG_FINGERPRINT_SECRET HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET HOSTED_R2_PRESIGN_ACCESS_KEY_ID HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK MURPH_DATA_API_KEY OPENAI_API_KEY",
    );
  });

  it("requires OpenAI API key for direct OpenAI hosted assistant deploys", () => {
    expect(listMissingHostedDeployEnvironment(createRequiredWorkerDeployEnv({
      OPENAI_API_KEY: undefined,
      VERCEL_AI_API_KEY: "legacy-vercel-key",
    }), { deployWorker: true })).toContain("OPENAI_API_KEY");
  });

  it("requires the complete database-alert contract for production deploys", () => {
    const missing = listMissingHostedDeployEnvironment(
      createRequiredWorkerDeployEnv({
        HOSTED_DATABASE_ALERT_ENABLED: undefined,
        HOSTED_DATABASE_ALERT_LINQ_CHAT_ID: undefined,
        HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID: undefined,
        HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID: undefined,
        HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME: undefined,
        HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME: undefined,
        HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION: undefined,
        HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN: undefined,
        HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID: undefined,
        LINQ_API_TOKEN: undefined,
      }),
      { deployWorker: true },
    );

    expect(missing).toEqual([
      "HOSTED_DATABASE_ALERT_ENABLED",
      "HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID",
      "HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME",
      "HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME",
      "HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION",
      "HOSTED_DATABASE_ALERT_LINQ_CHAT_ID",
      "HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID",
      "HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN",
      "HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID",
      "LINQ_API_TOKEN",
    ]);
  });

  it("enables database paging only for the production Worker", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredWorkerDeployEnv({
        HOSTED_DATABASE_ALERT_ENABLED: "0",
      }),
      { deployWorker: true },
    )).toContain(
      "HOSTED_DATABASE_ALERT_ENABLED must be 1 for production deploys.",
    );
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredPreviewWorkerDeployEnv({
        HOSTED_DATABASE_ALERT_ENABLED: "1",
      }),
      { deployWorker: true },
    )).toContain(
      "HOSTED_DATABASE_ALERT_ENABLED must be unset outside production.",
    );
  });

  it("requires two distinct direct chats for database paging", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredWorkerDeployEnv({
        HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID: "chat-test",
      }),
      { deployWorker: true },
    )).toContain("Database health alert chat IDs must be distinct.");
  });

  it("rejects a weak private-media capability secret", () => {
    expect(() => assertHostedDeployEnvironment(createRequiredWorkerDeployEnv({
      HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET: "too-short",
    }), { deployWorker: true })).toThrowError(
      "HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET must contain at least 32 characters.",
    );
  });

  it("allows production deploys only when the hosted web origin matches the explicit production origin", () => {
    expect(() => assertHostedDeployEnvironment(
      createRequiredWorkerDeployEnv(),
      { deployWorker: true },
    )).not.toThrow();
  });

  it("preserves the source-controlled production OIDC default for direct deploys", () => {
    const source = createRequiredWorkerDeployEnv({
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: undefined,
    });

    expect(
      listMissingHostedDeployEnvironment(source, { deployWorker: true }),
    ).not.toContain("HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT");
    expect(() => assertHostedDeployEnvironment(
      source,
      { deployWorker: true },
    )).not.toThrow();
  });

  it.each([
    "development",
    "preview",
  ] as const)("requires an explicit OIDC environment for %s deploys", (deployContext) => {
    const source = createRequiredWorkerDeployEnv({
      HOSTED_EXECUTION_DEPLOY_CONTEXT: deployContext,
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: undefined,
    });

    expect(
      listMissingHostedDeployEnvironment(source, { deployWorker: true }),
    ).toContain("HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT");
  });

  it("requires an explicit production web origin for production worker deploys", () => {
    expect(listMissingHostedDeployEnvironment(createRequiredWorkerDeployEnv({
      HOSTED_WEB_PRODUCTION_BASE_URL: undefined,
    }), { deployWorker: true })).toContain("HOSTED_WEB_PRODUCTION_BASE_URL");
  });

  it("requires an explicit production web origin for preview worker deploys", () => {
    expect(listMissingHostedDeployEnvironment(createRequiredPreviewWorkerDeployEnv({
      HOSTED_WEB_PRODUCTION_BASE_URL: undefined,
    }), { deployWorker: true })).toContain("HOSTED_WEB_PRODUCTION_BASE_URL");
  });

  it("allows a preview deploy only through visibly scoped isolated resources", () => {
    expect(() => assertHostedDeployEnvironment(
      createRequiredPreviewWorkerDeployEnv(),
      { deployWorker: true },
    )).not.toThrow();
  });

  it("allows the R2 binding and preview binding to share one staging ENAM bucket", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredPreviewWorkerDeployEnv(),
        { deployWorker: true },
      ),
    ).toEqual([]);
  });

  it("rejects preview deploys that retain production crypto or OIDC context", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredPreviewWorkerDeployEnv({
        HOSTED_CRYPTO_ENV: "production",
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "production",
      }),
      { deployWorker: true },
    )).toEqual(expect.arrayContaining([
      "preview deploys must set HOSTED_CRYPTO_ENV=preview.",
      "preview deploys must set HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=preview.",
    ]));
  });

  it("accepts non-active hosted crypto standby keyrings", () => {
    expect(() => assertHostedDeployEnvironment(
      createRequiredWorkerDeployEnv({
        HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
          "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/2": {
            publicKeyPem:
              "-----BEGIN PUBLIC KEY-----\nstandby\n-----END PUBLIC KEY-----",
            status: "verify_only",
          },
        }),
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
          JSON.stringify({
            "cloudflare-automation:v2": {
              privateJwk: {
                crv: "P-256",
                d: "standby-private-coordinate",
                kty: "EC",
                x: "standby-public-x",
                y: "standby-public-y",
              },
              recipient: "cloudflare-automation-secret",
              status: "decrypt_only",
            },
          }),
      }),
      { deployWorker: true },
    )).not.toThrow();
  });

  it.each([
    [
      "malformed authority JSON",
      {
        HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON:
          '{"private-keyring-canary"',
      },
      HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
    ],
    [
      "an invalid authority status",
      {
        HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
          "authority-standby": {
            publicKeyPem: "private-keyring-canary",
            status: "verify-only",
          },
        }),
      },
      HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
    ],
    [
      "an additional active authority",
      {
        HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
          "authority-standby": {
            publicKeyPem: "private-keyring-canary",
            status: "active",
          },
        }),
      },
      HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
    ],
    [
      "an active authority entry shadowed by the required key",
      {
        HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
          "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1": {
            publicKeyPem: "private-keyring-canary",
            status: "active",
          },
        }),
      },
      HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
    ],
    [
      "a verify-only authority entry shadowed by the required key",
      {
        HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
          "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1": {
            publicKeyPem: "private-keyring-canary",
            status: "verify_only",
          },
        }),
      },
      HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
    ],
    [
      "authority entries with duplicate normalized identifiers",
      {
        HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
          "authority-standby": {
            publicKeyPem: "private-keyring-canary",
            status: "verify_only",
          },
          " authority-standby ": {
            publicKeyPem: "disabled",
            status: "disabled",
          },
        }),
      },
      HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
    ],
    [
      "a private JWK without d",
      {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
          JSON.stringify({
            "cloudflare-automation:v2": {
              privateJwk: {
                crv: "P-256",
                kty: "EC",
                x: "private-keyring-canary",
                y: "standby-public-y",
              },
              recipient: "cloudflare-automation-secret",
              status: "decrypt_only",
            },
          }),
      },
      HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR,
    ],
    [
      "a non-Cloudflare private recipient",
      {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
          JSON.stringify({
            "cloudflare-automation:v2": {
              privateJwk: {
                crv: "P-256",
                d: "private-keyring-canary",
                kty: "EC",
                x: "standby-public-x",
                y: "standby-public-y",
              },
              recipient: "recovery-offline",
              status: "decrypt_only",
            },
          }),
      },
      HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR,
    ],
    [
      "an additional active private recipient",
      {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
          JSON.stringify({
            "cloudflare-automation:v2": {
              privateJwk: {
                crv: "P-256",
                d: "private-keyring-canary",
                kty: "EC",
                x: "standby-public-x",
                y: "standby-public-y",
              },
              recipient: "cloudflare-automation-secret",
              status: "active",
            },
          }),
      },
      HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR,
    ],
    [
      "an active private entry shadowed by the required key",
      {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
          JSON.stringify({
            "cloudflare-automation:v1": {
              privateJwk: {
                crv: "P-256",
                d: "private-keyring-canary",
                kty: "EC",
                x: "standby-public-x",
                y: "standby-public-y",
              },
              recipient: "cloudflare-automation-secret",
              status: "active",
            },
          }),
      },
      HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR,
    ],
    [
      "a decrypt-only private entry shadowed by the required key",
      {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
          JSON.stringify({
            "cloudflare-automation:v1": {
              privateJwk: {
                crv: "P-256",
                d: "private-keyring-canary",
                kty: "EC",
                x: "standby-public-x",
                y: "standby-public-y",
              },
              recipient: "cloudflare-automation-secret",
              status: "decrypt_only",
            },
          }),
      },
      HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR,
    ],
    [
      "private entries with duplicate normalized identifiers",
      {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
          JSON.stringify({
            "cloudflare-automation:v2": {
              privateJwk: {
                crv: "P-256",
                d: "private-keyring-canary",
                kty: "EC",
                x: "standby-public-x",
                y: "standby-public-y",
              },
              recipient: "cloudflare-automation-secret",
              status: "decrypt_only",
            },
            " cloudflare-automation:v2 ": {
              privateJwk: {
                crv: "P-256",
                d: "private-keyring-canary",
                kty: "EC",
                x: "standby-public-x",
                y: "standby-public-y",
              },
              recipient: "cloudflare-automation-secret",
              status: "disabled",
            },
          }),
      },
      HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR,
    ],
  ] as const)("rejects %s without disclosing keyring values", (
    _name,
    overrides,
    expectedError,
  ) => {
    const errors = listHostedDeployEnvironmentInvariantErrors(
      createRequiredWorkerDeployEnv(overrides),
      { deployWorker: true },
    );

    expect(errors).toContain(expectedError);
    expect(errors.join(" ")).not.toContain("private-keyring-canary");
  });

  it("rejects preview deploys with unscoped Worker or R2 resource names", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredPreviewWorkerDeployEnv({
        CF_BUNDLES_BUCKET: "hosted-bundles",
        CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles",
        CF_WORKER_NAME: "hosted-runner",
        HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-bundles",
      }),
      { deployWorker: true },
    )).toEqual(expect.arrayContaining([
      "CF_WORKER_NAME must contain a preview or staging name segment for preview deploys.",
      "CF_BUNDLES_BUCKET must contain a preview or staging name segment for preview deploys.",
      "CF_BUNDLES_PREVIEW_BUCKET must contain a preview or staging name segment for preview deploys.",
    ]));
  });

  it("rejects preview deploys with an unscoped or production hosted Web origin", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredPreviewWorkerDeployEnv({
        HOSTED_WEB_BASE_URL: "https://app.example.test",
      }),
      { deployWorker: true },
    )).toEqual(expect.arrayContaining([
      "HOSTED_WEB_BASE_URL must use a preview or staging origin in preview deploys.",
      "preview deploys must not set HOSTED_WEB_BASE_URL to HOSTED_WEB_PRODUCTION_BASE_URL.",
    ]));
  });

  it("rejects preview deploys with an unscoped Worker origin", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredPreviewWorkerDeployEnv({
        CF_PUBLIC_BASE_URL: "https://hosted-runner.example.test",
      }),
      { deployWorker: true },
    )).toContain(
      "CF_PUBLIC_BASE_URL must use a preview or staging origin in preview deploys.",
    );
  });

  it("rejects a preview Worker that routes its Web control calls back to itself", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredPreviewWorkerDeployEnv({
        HOSTED_WEB_BASE_URL: "https://hosted-runner-staging.example.test",
      }),
      { deployWorker: true },
    )).toContain(
      "preview deploys must keep CF_PUBLIC_BASE_URL distinct from HOSTED_WEB_BASE_URL.",
    );
  });

  it("rejects a preview device callback on a different hostname from hosted Web", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredPreviewWorkerDeployEnv({
        DEVICE_SYNC_PUBLIC_BASE_URL:
          "https://device-sync-staging.example.test/api/device-sync",
      }),
      { deployWorker: true },
    )).toContain(
      "DEVICE_SYNC_PUBLIC_BASE_URL must use the HOSTED_WEB_BASE_URL hostname in preview deploys.",
    );
  });

  it("requires a configured preview device callback to use a staging HTTPS URL", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredPreviewWorkerDeployEnv({
        DEVICE_SYNC_PUBLIC_BASE_URL:
          "http://device-sync-staging.example.test/api/device-sync",
      }),
      { deployWorker: true },
    )).toContain(
      "DEVICE_SYNC_PUBLIC_BASE_URL must be a valid preview HTTPS URL.",
    );
  });

  it.each([
    "CF_PUBLIC_BASE_URL",
    "HOSTED_WEB_BASE_URL",
  ] as const)("requires preview %s to use HTTPS", (label) => {
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredPreviewWorkerDeployEnv({
        [label]: label === "CF_PUBLIC_BASE_URL"
          ? "http://hosted-runner-staging.example.test"
          : "http://web-staging.example.test",
      }),
      { deployWorker: true },
    )).toContain(`${label} must be a valid preview HTTPS URL.`);
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

  it("allows an explicit production callback path on the hosted Web hostname", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredWorkerDeployEnv({
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://app.example.test/api/device-sync",
      }),
      { deployWorker: true },
    )).toEqual([]);
  });

  it("rejects a production device callback on a different hostname from hosted Web", () => {
    expect(listHostedDeployEnvironmentInvariantErrors(
      createRequiredWorkerDeployEnv({
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test/api/device-sync",
      }),
      { deployWorker: true },
    )).toContain(
      "DEVICE_SYNC_PUBLIC_BASE_URL must use the HOSTED_WEB_BASE_URL hostname in production deploys.",
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

  it("pins the production Worker origin used by private-media capabilities", () => {
    expect(() => assertHostedDeployEnvironment(createRequiredWorkerDeployEnv({
      CF_PUBLIC_BASE_URL: "https://worker.example.test",
    }), { deployWorker: true })).toThrowError(
      `CF_PUBLIC_BASE_URL=${HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_ORIGIN}`,
    );
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
      HOSTED_ASSISTANT_MODEL_PRICING_ERROR,
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "   ",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      HOSTED_ASSISTANT_MODEL_PRICING_ERROR,
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
      HOSTED_ASSISTANT_MODEL_PRICING_ERROR,
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "gpt-unpriced-mini",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      HOSTED_ASSISTANT_MODEL_PRICING_ERROR,
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "gpt-5.4-nano",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      HOSTED_ASSISTANT_MODEL_PRICING_ERROR,
    );

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "openai/gpt-5.6-terra",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      HOSTED_ASSISTANT_MODEL_PRICING_ERROR,
    );
  });

  it("requires the production hosted assistant profile", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
        }),
        { deployWorker: true },
      ),
    ).not.toContain(HOSTED_ASSISTANT_MODEL_PRICING_ERROR);

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
          HOSTED_EXECUTION_CONTAINER_ROLLOUT: "gradual",
        }),
        { deployWorker: true },
      ),
    ).toContain(HOSTED_STATE_ISOLATION_ROLLOUT_ERROR);

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
          HOSTED_EXECUTION_CONTAINER_ROLLOUT: "immediate",
        }),
        { deployWorker: true },
      ),
    ).not.toContain(HOSTED_STATE_ISOLATION_ROLLOUT_ERROR);

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
      HOSTED_ASSISTANT_MODEL_PRICING_ERROR,
      "production hosted assistant deploys must set HOSTED_ASSISTANT_REASONING_EFFORT=low.",
    ]));
  });

  it("requires immediate production container rollout while state-isolation keys migrate", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_EXECUTION_CONTAINER_ROLLOUT: "gradual",
        }),
        { deployWorker: true },
      ),
    ).toContain(HOSTED_STATE_ISOLATION_ROLLOUT_ERROR);

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          HOSTED_EXECUTION_CONTAINER_ROLLOUT: undefined,
        }),
        { deployWorker: true },
      ),
    ).not.toContain(HOSTED_STATE_ISOLATION_ROLLOUT_ERROR);

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv(),
        { deployWorker: true },
      ),
    ).not.toContain(HOSTED_STATE_ISOLATION_ROLLOUT_ERROR);

    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          CF_PUBLIC_BASE_URL: "http://localhost:8787",
          HOSTED_CRYPTO_ENV: "development",
          HOSTED_DATABASE_ALERT_ENABLED: undefined,
          HOSTED_EXECUTION_CONTAINER_ROLLOUT: "gradual",
          HOSTED_EXECUTION_DEPLOY_CONTEXT: "development",
          HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
          HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
          HOSTED_WEB_PRODUCTION_BASE_URL: undefined,
        }),
        { deployWorker: true },
      ),
    ).not.toContain(HOSTED_STATE_ISOLATION_ROLLOUT_ERROR);
  });

  it("rejects deploy timeout settings that cannot contain the web-control request", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          CF_RUNNER_COMMIT_TIMEOUT_MS: "30000",
          CF_WEB_CONTROL_TIMEOUT_MS: "30000",
        }),
        { deployWorker: true },
      ),
    ).toContain(
      "CF_RUNNER_COMMIT_TIMEOUT_MS must be at least 5000ms greater than CF_WEB_CONTROL_TIMEOUT_MS.",
    );
  });

  it("accepts custom deploy timeouts with the required response margin", () => {
    expect(
      listHostedDeployEnvironmentInvariantErrors(
        createRequiredWorkerDeployEnv({
          CF_RUNNER_COMMIT_TIMEOUT_MS: "45000",
          CF_WEB_CONTROL_TIMEOUT_MS: "40000",
        }),
        { deployWorker: true },
      ),
    ).not.toContain(
      "CF_RUNNER_COMMIT_TIMEOUT_MS must be at least 5000ms greater than CF_WEB_CONTROL_TIMEOUT_MS.",
    );
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
      HOSTED_DATABASE_ALERT_ENABLED: undefined,
      HOSTED_EXECUTION_DEPLOY_CONTEXT: "development",
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
      HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
      HOSTED_WEB_PRODUCTION_BASE_URL: undefined,
    }), { deployWorker: true })).not.toThrow();
  });

  it("allows production deploy DNS records only when they resolve to public addresses", async () => {
    await expect(assertHostedDeployEnvironmentAsync(
      createRequiredWorkerDeployEnv(),
      { deployWorker: true },
      {
        readR2BucketInfo: readValidR2BucketInfo,
        resolveHostnameAddresses: async () => ["8.8.8.8", "2001:4860:4860::8888"],
      },
    )).resolves.toBeUndefined();
  });

  it("rejects a configured R2 bucket outside ENAM before deployment", async () => {
    await expect(listHostedDeployEnvironmentInvariantErrorsAsync(
      createRequiredWorkerDeployEnv(),
      { deployWorker: true },
      {
        readR2BucketInfo: async (bucketName) => ({
          defaultStorageClass: "Standard",
          location: "OC",
          name: bucketName,
        }),
        resolveHostnameAddresses: async () => ["8.8.8.8"],
      },
    )).resolves.toContain(
      "R2 bucket metadata validation failed: Runtime R2 bucket must report ENAM.",
    );
  });

  it("fails closed when R2 bucket metadata cannot be read", async () => {
    await expect(listHostedDeployEnvironmentInvariantErrorsAsync(
      createRequiredWorkerDeployEnv(),
      { deployWorker: true },
      {
        readR2BucketInfo: async () => {
          throw new Error("bucket metadata unavailable");
        },
        resolveHostnameAddresses: async () => ["8.8.8.8"],
      },
    )).resolves.toContain(
      "R2 bucket metadata validation failed: bucket metadata unavailable",
    );
  });

  it("rejects production deploy hostnames that resolve to private-network addresses", async () => {
    await expect(listHostedDeployEnvironmentInvariantErrorsAsync(
      createRequiredWorkerDeployEnv(),
      { deployWorker: true },
      {
        readR2BucketInfo: readValidR2BucketInfo,
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
        readR2BucketInfo: readValidR2BucketInfo,
        resolveHostnameAddresses: async (hostname) =>
          hostname === "app.example.test" ? ["::ffff:10.1.2.3"] : ["8.8.8.8"],
      },
    )).resolves.toContain(
      "HOSTED_WEB_BASE_URL must not resolve to private-network addresses in production deploys.",
    );
  });

  it("allows preview deploy hostnames and a same-host path-capable callback when all resolve publicly", async () => {
    await expect(assertHostedDeployEnvironmentAsync(
      createRequiredPreviewWorkerDeployEnv({
        DEVICE_SYNC_PUBLIC_BASE_URL:
          "https://web-staging.example.test/api/device-sync",
      }),
      { deployWorker: true },
      {
        readR2BucketInfo: readValidR2BucketInfo,
        resolveHostnameAddresses: async () => ["8.8.8.8", "2001:4860:4860::8888"],
      },
    )).resolves.toBeUndefined();
  });

  it.each([
    ["CF_PUBLIC_BASE_URL", "hosted-runner-staging.example.test"],
    ["HOSTED_WEB_BASE_URL", "web-staging.example.test"],
    ["DEVICE_SYNC_PUBLIC_BASE_URL", "web-staging.example.test"],
  ] as const)(
    "rejects preview %s when it resolves to a private-network address",
    async (label, privateHostname) => {
      await expect(listHostedDeployEnvironmentInvariantErrorsAsync(
        createRequiredPreviewWorkerDeployEnv(
          label === "DEVICE_SYNC_PUBLIC_BASE_URL"
            ? {
                DEVICE_SYNC_PUBLIC_BASE_URL:
                  "https://web-staging.example.test/api/device-sync",
              }
            : {},
        ),
        { deployWorker: true },
        {
          readR2BucketInfo: readValidR2BucketInfo,
          resolveHostnameAddresses: async (hostname) =>
            hostname === privateHostname ? ["10.1.2.3"] : ["8.8.8.8"],
        },
      )).resolves.toContain(
        `${label} must not resolve to private-network addresses in preview deploys.`,
      );
    },
  );

  it("parses truthy deploy-worker flag values", () => {
    expect(parseDeployWorkerFlag("true")).toBe(true);
    expect(parseDeployWorkerFlag("1")).toBe(true);
    expect(parseDeployWorkerFlag("yes")).toBe(true);
    expect(parseDeployWorkerFlag("no")).toBe(false);
    expect(parseDeployWorkerFlag(" false ")).toBe(false);
    expect(parseDeployWorkerFlag(undefined)).toBe(false);
  });
});
