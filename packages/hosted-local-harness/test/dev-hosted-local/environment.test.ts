import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertLocalWorkerOidcEnvironment,
  buildHostedLocalStateEnvFileText,
  buildHostedRunnerLocalBuildId,
  buildHostedLocalDevOverrides,
  buildWranglerEnvFileText,
  buildWranglerLocalDevConfig,
  buildWranglerVarArgs,
  mergeCloudflareLocalEnv,
  normalizeLocalDatabaseUrl,
  parseEnvText,
  readHostedLocalDevVarsText,
  resolveHostedLocalDatabaseUrl,
  resolveHostedLocalPersistentCryptoStatePath,
  resolveHostedLocalStripeEnvFilePath,
  resolveWranglerLocalDevWorkerName,
  shouldSyncLocalDatabaseSchema,
} from "../../src/dev-hosted-local/environment.ts";
import type {
  HostedExecutionOidcIdentity,
  HostedLocalDevConfig,
} from "../../src/dev-hosted-local/types.ts";
import {
  HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID_ENV,
  HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "../../src/dev-hosted-local/constants.ts";

const localConfig: HostedLocalDevConfig = {
  databaseUrlOverride: null,
  forceResetLocalDatabase: false,
  linqWebhookPublicUrl: null,
  linqWebhookRegistrationCachePath: ".tmp/linq-webhook-registration.json",
  linqWebhookTunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
  linqWebhookTunnelMode: "auto",
  linqWebhookTunnelName: "dev",
  skipHealthCommonsWatch: false,
  skipLinqWebhookRegister: false,
  skipPrismaMigrate: false,
  skipRunnerSmoke: false,
  skipStripeListen: false,
  skipWeb: false,
  skipVercelPull: false,
  temporal: {
    host: "127.0.0.1",
    mode: "disabled",
    namespace: "default",
    port: 7233,
    taskQueue: "murph-hosted-runtime",
  },
  useVercelDatabaseUrl: false,
  webHost: "localhost",
  webPort: 3000,
  workerHost: "127.0.0.1",
  workerPersistDir: ".wrangler/state/dev-root",
  workerPort: 8787,
  workerProtocol: "http",
};

const oidcIdentity: HostedExecutionOidcIdentity = {
  environment: "development",
  projectName: "murph-web",
  teamSlug: "murph",
};

const callbackPrivateJwkJson = JSON.stringify({
  crv: "P-256",
  d: "callback-d",
  kty: "EC",
  x: "callback-x",
  y: "callback-y",
});
const generatedPrivateJwkJson = JSON.stringify({
  crv: "P-256",
  d: "generated-d",
  kty: "EC",
  x: "generated-x",
  y: "generated-y",
});
const generatedPublicJwkJson = JSON.stringify({
  crv: "P-256",
  kty: "EC",
  x: "generated-x",
  y: "generated-y",
});
const generatedAuthorityPrivateJwkJson = JSON.stringify({
  crv: "P-256",
  d: "authority-d",
  kty: "EC",
  x: "authority-x",
  y: "authority-y",
});
const generatedAuthorityPublicPem =
  "-----BEGIN PUBLIC KEY-----\nLOCAL_AUTHORITY_PUBLIC_KEY\n-----END PUBLIC KEY-----\n";
const existingAuthorityPrivateJwkJson = JSON.stringify({
  crv: "P-256",
  d: "HAPljluiFVW3g-UEmrJ9NVYTlclAhaC8N5LT0h7vitQ",
  kty: "EC",
  x: "xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao",
  y: "8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY",
});
const existingAuthorityPublicPem =
  "-----BEGIN PUBLIC KEY-----\n"
  + "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExSelVJv6r6LPUS8GCNgj1T/7z5GX\n"
  + "OrhgY1cCdzGb5arweFyJLVwA8qz989+BmdvVRJ1G0Ff7g2+nxeIEe4xyZg==\n"
  + "-----END PUBLIC KEY-----\n";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readRequiredSecretNames(config: Record<string, unknown>): string[] {
  const secrets = config.secrets;
  if (
    !secrets ||
    typeof secrets !== "object" ||
    !("required" in secrets) ||
    !isStringArray(secrets.required)
  ) {
    throw new Error("Expected wrangler config secrets.required to be a string array.");
  }

  return secrets.required;
}

describe("parseEnvText", () => {
  it("parses dotenv text values verbatim", () => {
    expect(
      parseEnvText(
        [
          "DATABASE_URL=postgresql://127.0.0.1:5432/murph",
          "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK={\"kty\":\"EC\"}",
          "EMPTY=",
        ].join("\n"),
      ),
    ).toEqual({
      DATABASE_URL: "postgresql://127.0.0.1:5432/murph",
      EMPTY: "",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "{\"kty\":\"EC\"}",
    });
  });

  it("parses quoted multi-line values without truncating structured json", () => {
    expect(
      parseEnvText(
        [
          "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK=\"{",
          "\\\"kty\\\": \\\"EC\\\",",
          "\\\"crv\\\": \\\"P-256\\\",",
          "\\\"x\\\": \\\"callback-x\\\",",
          "\\\"y\\\": \\\"callback-y\\\",",
          "\\\"d\\\": \\\"callback-d\\\"",
          "}\"",
          "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID=callback:v1",
        ].join("\n"),
      ),
    ).toEqual({
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: [
        "{",
        "\"kty\": \"EC\",",
        "\"crv\": \"P-256\",",
        "\"x\": \"callback-x\",",
        "\"y\": \"callback-y\",",
        "\"d\": \"callback-d\"",
        "}",
      ].join("\n"),
    });
  });
});

describe("resolveHostedLocalStripeEnvFilePath", () => {
  it("defaults to the repo-local ignored Stripe env file", () => {
    expect(resolveHostedLocalStripeEnvFilePath({}, { root: "/repo" })).toBe(
      "/repo/.tmp/.env.hosted-local-stripe",
    );
  });

  it("allows disabling the local Stripe env overlay", () => {
    expect(
      resolveHostedLocalStripeEnvFilePath(
        { MURPH_DEV_STRIPE_ENV_FILE: "off" },
        { root: "/repo" },
      ),
    ).toBeNull();
  });

  it("rejects env file paths outside the repo", () => {
    expect(() =>
      resolveHostedLocalStripeEnvFilePath(
        { MURPH_DEV_STRIPE_ENV_FILE: "../outside.env" },
        { root: "/repo" },
      )
    ).toThrow("MURPH_DEV_STRIPE_ENV_FILE must resolve inside the repo.");
  });
});

describe("mergeCloudflareLocalEnv", () => {
  it("fills the local worker env contract from existing values and generated defaults", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_APP_SESSION_HMAC_KEY: "web-only-key",
        HOSTED_CRYPTO_ENV: "local",
        HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL: "http://127.0.0.1:9998",
        HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "stale-token",
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "192.168.65.2",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
      },
      oidcIdentity,
      createEnvelopeKey: () => "generated-envelope",
      createJwkPair: () => ({
        privateJwkJson: generatedPrivateJwkJson,
        publicJwkJson: generatedPublicJwkJson,
      }),
      createSigningKey: () => ({
        privateJwkJson: generatedAuthorityPrivateJwkJson,
        publicKeyPem: generatedAuthorityPublicPem,
      }),
    });

    expect(merged.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK).toContain("generated-d");
    expect(merged.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK).toContain("generated-x");
    expect(merged.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID).toBe(
      "cloudflare-automation:local",
    );
    expect(merged.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION).toMatch(
      /^projects\/murph-local\/locations\/global\/keyRings\/hosted-local\/cryptoKeys\/authority-sign\/cryptoKeyVersions\/local-[a-f0-9]{16}$/u,
    );
    expect(merged.HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM).toBe(generatedAuthorityPublicPem);
    expect(JSON.parse(merged.HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON)).toEqual({
      [merged.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION]: {
        publicKeyPem: generatedAuthorityPublicPem.trim(),
        status: "active",
      },
    });
    expect(merged.HOSTED_CRYPTO_ENV).toBe("local");
    expect(merged.HOSTED_CRYPTO_GCP_KMS_API_ROOT).toBe("local://murph-hosted-kms");
    expect(merged.HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME).toBe(
      "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap",
    );
    expect(merged.HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK).toBe(
      generatedAuthorityPrivateJwkJson,
    );
    expect(merged.HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY).toBe("generated-envelope");
    expect(merged.HOSTED_LOG_FINGERPRINT_SECRET).toBe("generated-envelope");
    expect(merged.HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET).toBe(
      "generated-envelope",
    );
    expect(merged.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON).toBe(
      JSON.stringify({
        v1: {
          crv: "P-256",
          kty: "EC",
          x: "callback-x",
          y: "callback-y",
        },
      }),
    );
    expect(merged.HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL).toBeUndefined();
    expect(merged.HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN).toBeUndefined();
    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG).toBe("murph");
    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME).toBe("murph-web");
    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT).toBe("development");
    expect(merged.HOSTED_EXECUTION_RUNNER_HOST_ALIAS).toBe("192.168.65.2");
    expect(merged.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBe(callbackPrivateJwkJson);
    expect(merged.HOSTED_WEB_BASE_URL).toBe("http://localhost:3000");
    expect(merged.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
  });

  it("preserves an existing hosted-local log fingerprint secret", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_LOG_FINGERPRINT_SECRET: "persisted-log-fingerprint-secret",
      },
      oidcIdentity,
      createEnvelopeKey: () => "generated-envelope",
    });

    expect(merged.HOSTED_LOG_FINGERPRINT_SECRET).toBe(
      "persisted-log-fingerprint-secret",
    );
  });

  it("preserves an existing hosted-local provider egress credential signing secret", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "persisted-provider-egress-signing-secret",
      },
      oidcIdentity,
      createEnvelopeKey: () => "generated-envelope",
    });

    expect(merged.HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET).toBe(
      "persisted-provider-egress-signing-secret",
    );
  });

  it("generates the Worker log fingerprint secret for hosted-local E2E isolation", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {},
      oidcIdentity,
      overrides: {
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
        MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
      },
      createEnvelopeKey: () => "generated-envelope",
    });
    const workerEnvText = buildWranglerEnvFileText(merged);
    const workerConfig = buildWranglerLocalDevConfig(merged);

    expect(merged.HOSTED_LOG_FINGERPRINT_SECRET).toBe("generated-envelope");
    expect(merged.HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET).toBe(
      "generated-envelope",
    );
    expect(workerEnvText).toContain(
      'HOSTED_LOG_FINGERPRINT_SECRET="generated-envelope"',
    );
    expect(workerEnvText).toContain(
      'HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET="generated-envelope"',
    );
    expect(readRequiredSecretNames(workerConfig)).toContain(
      "HOSTED_LOG_FINGERPRINT_SECRET",
    );
    expect(readRequiredSecretNames(workerConfig)).toContain(
      "HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET",
    );
  });

  it("lets current env overrides replace stale existing optional worker vars", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        LINQ_API_BASE_URL: "http://127.0.0.1:9999",
      },
      oidcIdentity,
      overrides: {
        LINQ_API_BASE_URL: "http://127.0.0.1:4011",
        LINQ_API_TOKEN: "linq-local-test-token",
      },
    });

    expect(merged.LINQ_API_BASE_URL).toBe("http://127.0.0.1:4011");
    expect(merged.LINQ_API_TOKEN).toBe("linq-local-test-token");
  });

  it("fills local e2e R2 presign placeholders for the direct-upload test route", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {},
      oidcIdentity,
      overrides: {
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        NODE_ENV: "test",
      },
    });

    expect(merged.HOSTED_R2_PRESIGN_ACCESS_KEY_ID).toBe("hosted-local-r2-access-key");
    expect(merged.HOSTED_R2_PRESIGN_ACCOUNT_ID).toBe("hosted-local-r2-account");
    expect(merged.HOSTED_R2_PRESIGN_BUCKET_NAME).toBe("hosted-local-r2-bundles");
    expect(merged.HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY).toBe("hosted-local-r2-secret-key");
  });

  it("fills local R2 presign placeholders for hosted-local test routes without e2e isolation", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {},
      oidcIdentity,
      overrides: {
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        NODE_ENV: "test",
      },
    });

    expect(merged.HOSTED_R2_PRESIGN_ACCESS_KEY_ID).toBe("hosted-local-r2-access-key");
    expect(merged.HOSTED_R2_PRESIGN_ACCOUNT_ID).toBe("hosted-local-r2-account");
    expect(merged.HOSTED_R2_PRESIGN_BUCKET_NAME).toBe("hosted-local-r2-bundles");
    expect(merged.HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY).toBe("hosted-local-r2-secret-key");
  });

  it("keeps R2 presign env absent when only one hosted-local test-routes flag is set", () => {
    for (const overrides of [
      { NODE_ENV: "test" },
      { MURPH_HOSTED_LOCAL_TEST_ROUTES: "1" },
    ]) {
      const merged = mergeCloudflareLocalEnv({
        config: localConfig,
        existing: {},
        oidcIdentity,
        overrides,
      });

      expect(merged.HOSTED_R2_PRESIGN_ACCESS_KEY_ID).toBeUndefined();
      expect(merged.HOSTED_R2_PRESIGN_ACCOUNT_ID).toBeUndefined();
      expect(merged.HOSTED_R2_PRESIGN_BUCKET_NAME).toBeUndefined();
      expect(merged.HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY).toBeUndefined();
    }
  });

  it("passes hosted-local MinIO endpoint overrides through for dev profile without e2e isolation", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {},
      oidcIdentity,
      overrides: {
        HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "hosted-local-r2-access-key",
        HOSTED_R2_PRESIGN_ACCOUNT_ID: "hosted-local-r2-account",
        HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
        HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-local-r2-bundles",
        HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:9000",
        HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:9000",
        HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "hosted-local-r2-secret-key",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      },
    });

    expect(merged.HOSTED_R2_PRESIGN_ACCESS_KEY_ID).toBe("hosted-local-r2-access-key");
    expect(merged.HOSTED_R2_PRESIGN_ACCOUNT_ID).toBe("hosted-local-r2-account");
    expect(merged.HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT).toBe("1");
    expect(merged.HOSTED_R2_PRESIGN_BUCKET_NAME).toBe("hosted-local-r2-bundles");
    expect(merged.HOSTED_R2_PRESIGN_CONTROL_ENDPOINT).toBe("http://127.0.0.1:9000");
    expect(merged.HOSTED_R2_PRESIGN_ENDPOINT).toBe("http://host.docker.internal:9000");
    expect(merged.HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY).toBe("hosted-local-r2-secret-key");
    expect(merged.MURPH_HOSTED_LOCAL_PROFILE).toBe("dev");
    expect(merged.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED).toBeUndefined();
  });

  it("passes hosted-local MinIO endpoint overrides through with local e2e R2 placeholders", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {},
      oidcIdentity,
      overrides: {
        HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
        HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:9000",
        HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:9000",
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      },
    });

    expect(merged.HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT).toBe("1");
    expect(merged.HOSTED_R2_PRESIGN_CONTROL_ENDPOINT).toBe("http://127.0.0.1:9000");
    expect(merged.HOSTED_R2_PRESIGN_ENDPOINT).toBe("http://host.docker.internal:9000");
    expect(merged.HOSTED_R2_PRESIGN_BUCKET_NAME).toBe("hosted-local-r2-bundles");
  });

  it("keeps local generated hosted crypto keys ahead of pulled Vercel values by default", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {},
      oidcIdentity,
      overrides: {
        HOSTED_CRYPTO_ENV: "production",
        HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
          "projects/prod/locations/global/keyRings/prod/cryptoKeys/web-wrap",
      },
      createEnvelopeKey: () => "generated-envelope",
      createJwkPair: () => ({
        privateJwkJson: generatedPrivateJwkJson,
        publicJwkJson: generatedPublicJwkJson,
      }),
      createSigningKey: () => ({
        privateJwkJson: generatedAuthorityPrivateJwkJson,
        publicKeyPem: generatedAuthorityPublicPem,
      }),
    });

    expect(merged.HOSTED_CRYPTO_ENV).toBe("local");
    expect(merged.HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME).toBe(
      "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap",
    );
  });

  it("regenerates local hosted crypto state instead of reusing stale remote dev vars by default", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_CRYPTO_ENV: "production",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "projects/prod/cryptoKeyVersions/1",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
          "-----BEGIN PUBLIC KEY-----\\nREMOTE\\n-----END PUBLIC KEY-----",
        HOSTED_CRYPTO_GCP_KMS_API_ROOT: "https://cloudkms.googleapis.com/v1",
        HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
          "projects/prod/locations/global/keyRings/prod/cryptoKeys/web-wrap",
        HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "stale-remote-wrap",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
      },
      oidcIdentity,
      createEnvelopeKey: () => "generated-envelope",
      createJwkPair: () => ({
        privateJwkJson: generatedPrivateJwkJson,
        publicJwkJson: generatedPublicJwkJson,
      }),
      createSigningKey: () => ({
        privateJwkJson: generatedAuthorityPrivateJwkJson,
        publicKeyPem: generatedAuthorityPublicPem,
      }),
    });

    expect(merged.HOSTED_CRYPTO_ENV).toBe("local");
    expect(merged.HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION).toMatch(
      /^projects\/murph-local\/locations\/global\/keyRings\/hosted-local\/cryptoKeys\/authority-sign\/cryptoKeyVersions\/local-[a-f0-9]{16}$/u,
    );
    expect(merged.HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM).toBe(
      generatedAuthorityPublicPem,
    );
    expect(merged.HOSTED_CRYPTO_GCP_KMS_API_ROOT).toBe("local://murph-hosted-kms");
    expect(merged.HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME).toBe(
      "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap",
    );
    expect(merged.HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY).toBe("generated-envelope");
    expect(merged.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBe(generatedPrivateJwkJson);
  });

  it("regenerates local hosted crypto state instead of reusing persisted test state", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_CRYPTO_ENV: "test",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION:
          "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
          "-----BEGIN PUBLIC KEY-----\\nTEST_AUTHORITY\\n-----END PUBLIC KEY-----",
        HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
        HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
          "projects/test/locations/global/keyRings/ring/cryptoKeys/web-wrap",
        HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: existingAuthorityPrivateJwkJson,
        HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "test-wrap-key",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
      },
      oidcIdentity,
      createEnvelopeKey: () => "generated-envelope",
      createJwkPair: () => ({
        privateJwkJson: generatedPrivateJwkJson,
        publicJwkJson: generatedPublicJwkJson,
      }),
      createSigningKey: () => ({
        privateJwkJson: generatedAuthorityPrivateJwkJson,
        publicKeyPem: generatedAuthorityPublicPem,
      }),
    });

    expect(merged.HOSTED_CRYPTO_ENV).toBe("local");
    expect(merged.HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION).toMatch(
      /^projects\/murph-local\/locations\/global\/keyRings\/hosted-local\/cryptoKeys\/authority-sign\/cryptoKeyVersions\/local-[a-f0-9]{16}$/u,
    );
    expect(merged.HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM).toBe(
      generatedAuthorityPublicPem,
    );
    expect(merged.HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME).toBe(
      "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap",
    );
    expect(merged.HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK).toBe(
      generatedAuthorityPrivateJwkJson,
    );
    expect(merged.HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY).toBe("generated-envelope");
    expect(merged.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBe(generatedPrivateJwkJson);
  });

  it("preserves matching persisted local authority signing keys and key version", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_CRYPTO_ENV: "local",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION:
          "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/authority-sign/cryptoKeyVersions/legacy-local",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: existingAuthorityPublicPem,
        HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: existingAuthorityPrivateJwkJson,
        HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "existing-wrap-key",
      },
      oidcIdentity,
      createEnvelopeKey: () => "generated-envelope",
      createJwkPair: () => ({
        privateJwkJson: generatedPrivateJwkJson,
        publicJwkJson: generatedPublicJwkJson,
      }),
      createSigningKey: () => ({
        privateJwkJson: generatedAuthorityPrivateJwkJson,
        publicKeyPem: generatedAuthorityPublicPem,
      }),
    });

    expect(merged.HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION).toBe(
      "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/authority-sign/cryptoKeyVersions/legacy-local",
    );
    expect(merged.HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM).toBe(
      existingAuthorityPublicPem.trim(),
    );
    expect(merged.HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK).toBe(
      existingAuthorityPrivateJwkJson,
    );
  });

  it("rejects mismatched persisted local authority signing keys instead of regenerating", () => {
    expect(() =>
      mergeCloudflareLocalEnv({
        config: localConfig,
        existing: {
          HOSTED_CRYPTO_ENV: "local",
          HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
            "-----BEGIN PUBLIC KEY-----\\nSTALE_PUBLIC\\n-----END PUBLIC KEY-----",
          HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
          HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: existingAuthorityPrivateJwkJson,
          HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "existing-wrap-key",
        },
        oidcIdentity,
        createEnvelopeKey: () => "generated-envelope",
        createJwkPair: () => ({
          privateJwkJson: generatedPrivateJwkJson,
          publicJwkJson: generatedPublicJwkJson,
        }),
        createSigningKey: () => ({
          privateJwkJson: generatedAuthorityPrivateJwkJson,
          publicKeyPem: generatedAuthorityPublicPem,
        }),
      })
    ).toThrow("Persisted local hosted crypto authority state is inconsistent");
  });

  it("rejects incomplete persisted local authority signing keys instead of regenerating", () => {
    expect(() =>
      mergeCloudflareLocalEnv({
        config: localConfig,
        existing: {
          HOSTED_CRYPTO_ENV: "local",
          HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
            existingAuthorityPublicPem,
          HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
          HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "existing-wrap-key",
        },
        oidcIdentity,
      })
    ).toThrow("Persisted local hosted crypto authority state is incomplete");
  });

  it("repairs stale callback keyring entries for the current signing key", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_CRYPTO_ENV: "local",
        HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
        HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON: JSON.stringify({
          "callback:v0": {
            crv: "P-256",
            kty: "EC",
            x: "older-x",
            y: "older-y",
          },
          "callback:v1": {
            crv: "P-256",
            kty: "EC",
            x: "stale-x",
            y: "stale-y",
          },
        }),
      },
      oidcIdentity,
      createEnvelopeKey: () => "generated-envelope",
      createJwkPair: () => ({
        privateJwkJson: generatedPrivateJwkJson,
        publicJwkJson: generatedPublicJwkJson,
      }),
      createSigningKey: () => ({
        privateJwkJson: generatedAuthorityPrivateJwkJson,
        publicKeyPem: generatedAuthorityPublicPem,
      }),
    });

    expect(JSON.parse(merged.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON)).toEqual({
      "callback:v0": {
        crv: "P-256",
        kty: "EC",
        x: "older-x",
        y: "older-y",
      },
      "callback:v1": {
        crv: "P-256",
        kty: "EC",
        x: "callback-x",
        y: "callback-y",
      },
    });
  });

  it("allows explicitly opted-in remote hosted crypto keys", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {},
      oidcIdentity,
      overrides: {
        HOSTED_CRYPTO_ENV: "production",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "projects/prod/cryptoKeyVersions/1",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
          "-----BEGIN PUBLIC KEY-----\\nREMOTE\\n-----END PUBLIC KEY-----",
        HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
          "projects/prod/locations/global/keyRings/prod/cryptoKeys/web-wrap",
        MURPH_DEV_USE_REMOTE_HOSTED_CRYPTO_KEYS: "1",
      },
      createEnvelopeKey: () => "generated-envelope",
      createJwkPair: () => ({
        privateJwkJson: generatedPrivateJwkJson,
        publicJwkJson: generatedPublicJwkJson,
      }),
      createSigningKey: () => ({
        privateJwkJson: generatedAuthorityPrivateJwkJson,
        publicKeyPem: generatedAuthorityPublicPem,
      }),
    });

    expect(merged.HOSTED_CRYPTO_ENV).toBe("production");
    expect(merged.HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME).toBe(
      "projects/prod/locations/global/keyRings/prod/cryptoKeys/web-wrap",
    );
    expect(merged.HOSTED_CRYPTO_GCP_KMS_API_ROOT).toBeUndefined();
    expect(merged.HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK).toBeUndefined();
    expect(merged.HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY).toBeUndefined();
  });

  it("lets explicit worktree remote-crypto disable override existing env files", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_CRYPTO_ENV: "production",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "projects/prod/cryptoKeyVersions/1",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
          "-----BEGIN PUBLIC KEY-----\\nREMOTE\\n-----END PUBLIC KEY-----",
        HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
          "projects/prod/locations/global/keyRings/prod/cryptoKeys/web-wrap",
        MURPH_DEV_USE_REMOTE_HOSTED_CRYPTO_KEYS: "1",
      },
      oidcIdentity,
      overrides: {
        MURPH_DEV_USE_REMOTE_HOSTED_CRYPTO_KEYS: "0",
      },
      createEnvelopeKey: () => "generated-envelope",
      createJwkPair: () => ({
        privateJwkJson: generatedPrivateJwkJson,
        publicJwkJson: generatedPublicJwkJson,
      }),
      createSigningKey: () => ({
        privateJwkJson: generatedAuthorityPrivateJwkJson,
        publicKeyPem: generatedAuthorityPublicPem,
      }),
    });

    expect(merged.HOSTED_CRYPTO_ENV).toBe("local");
    expect(merged.HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME).toBe(
      "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap",
    );
    expect(merged.HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK).toBe(
      generatedAuthorityPrivateJwkJson,
    );
    expect(merged.HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY).toBe("generated-envelope");
  });

  it("uses the shared truthy parser for remote hosted crypto opt-in", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {},
      oidcIdentity,
      overrides: {
        HOSTED_CRYPTO_ENV: "production",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "projects/prod/cryptoKeyVersions/1",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
          "-----BEGIN PUBLIC KEY-----\\nREMOTE\\n-----END PUBLIC KEY-----",
        HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
          "projects/prod/locations/global/keyRings/prod/cryptoKeys/web-wrap",
        MURPH_DEV_USE_REMOTE_HOSTED_CRYPTO_KEYS: "yes",
      },
      createEnvelopeKey: () => "generated-envelope",
      createJwkPair: () => ({
        privateJwkJson: generatedPrivateJwkJson,
        publicJwkJson: generatedPublicJwkJson,
      }),
      createSigningKey: () => ({
        privateJwkJson: generatedAuthorityPrivateJwkJson,
        publicKeyPem: generatedAuthorityPublicPem,
      }),
    });

    expect(merged.HOSTED_CRYPTO_ENV).toBe("production");
    expect(merged.HOSTED_CRYPTO_GCP_KMS_API_ROOT).toBeUndefined();
    expect(merged.HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK).toBeUndefined();
    expect(merged.HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY).toBeUndefined();
  });

  it("rejects stale local Codex bridge proxy values from existing worker env", () => {
    expect(() =>
      mergeCloudflareLocalEnv({
        config: localConfig,
        existing: {
          MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN: "stale-token",
        },
        oidcIdentity,
      })
    ).toThrow("MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN");
  });

  it("rejects local Codex bridge proxy values from current overrides", () => {
    expect(() =>
      mergeCloudflareLocalEnv({
        config: localConfig,
        existing: {},
        oidcIdentity,
        overrides: {
          MURPH_DEV_CODEX_APP_SERVER_PROXY_URL: "tcp://127.0.0.1:9999",
        },
      })
    ).toThrow("MURPH_DEV_CODEX_APP_SERVER_PROXY_URL");
  });

  it("drops stale test-only Codex model provider base URL overrides unless supplied by this run", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
          "http://127.0.0.1:4111/v1",
      },
      oidcIdentity,
    });

    expect(merged[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]).toBeUndefined();
  });

  it("preserves a current test-only Codex model provider base URL override", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
          "http://127.0.0.1:4111/v1",
      },
      oidcIdentity,
      overrides: {
        [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
          "http://127.0.0.1:5222/v1",
      },
    });

    expect(merged[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]).toBe(
      "http://127.0.0.1:5222/v1",
    );
  });

  it("drops stale local OIDC JWKS overrides inherited from existing dev vars", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
      },
      oidcIdentity,
    });

    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL).toBeUndefined();
  });

  it("preserves a current local OIDC JWKS override supplied by this run", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
      },
      oidcIdentity,
      overrides: {
        HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:5020/.well-known/jwks",
      },
    });

    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL).toBe(
      "http://127.0.0.1:5020/.well-known/jwks",
    );
  });

  it("preserves an explicit runner host alias instead of resetting to the listen host", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "127.0.0.1",
      },
      oidcIdentity,
      overrides: {
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "host.docker.internal",
      },
    });

    expect(merged.HOSTED_EXECUTION_RUNNER_HOST_ALIAS).toBe("host.docker.internal");
  });
});

describe("readHostedLocalDevVarsText", () => {
  it("recovers hosted-local state when .dev.vars is an interrupted worker-env symlink", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "murph-hosted-local-env-"));
    try {
      const devVarsPath = path.join(tempDir, ".dev.vars");
      const workerEnvPath = path.join(tempDir, "cloudflare-worker.dev.vars");
      const stateEnvPath = path.join(tempDir, "hosted-local-state.dev.vars");
      await writeFile(workerEnvPath, 'HOSTED_CRYPTO_ENV="local"\n', "utf8");
      await writeFile(
        stateEnvPath,
        [
          'HOSTED_CRYPTO_ENV="local"',
          'HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK="{\\"kty\\":\\"EC\\"}"',
          "",
        ].join("\n"),
        "utf8",
      );
      await symlink(workerEnvPath, devVarsPath);

      await expect(readHostedLocalDevVarsText(devVarsPath)).resolves.toContain(
        "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

describe("resolveHostedLocalPersistentCryptoStatePath", () => {
  it("uses an ignored interactive-dev crypto state file for normal pnpm dev", () => {
    expect(resolveHostedLocalPersistentCryptoStatePath({
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      MURPH_HOSTED_LOCAL_PROFILE: "dev",
    })).toContain(".tmp/hosted-local-dev-crypto-state.dev.vars");
  });

  it("uses the worktree-local crypto state path when configured", () => {
    const statePath = resolveHostedLocalPersistentCryptoStatePath({
      MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH:
        ".tmp/hosted-local-worktrees/feature-a/hosted-local-crypto-state.dev.vars",
      MURPH_DEV_WORKTREE_SCOPE: "feature-a",
      MURPH_HOSTED_LOCAL_PROFILE: "dev",
    });

    expect(statePath).toContain(
      ".tmp/hosted-local-worktrees/feature-a/hosted-local-crypto-state.dev.vars",
    );
  });

  it("rejects worktree crypto state outside repo-local .tmp", () => {
    expect(() =>
      resolveHostedLocalPersistentCryptoStatePath({
        MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH: "../outside.dev.vars",
        MURPH_DEV_WORKTREE_SCOPE: "feature-a",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      })
    ).toThrow("repo-local .tmp");
  });

  it("does not persist generated crypto state for E2E profiles", () => {
    expect(resolveHostedLocalPersistentCryptoStatePath({
      MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
    })).toBeNull();
    expect(resolveHostedLocalPersistentCryptoStatePath({
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    })).toBeNull();
  });
});

describe("assertLocalWorkerOidcEnvironment", () => {
  it("rejects non-development local OIDC settings", () => {
    expect(() =>
      assertLocalWorkerOidcEnvironment({
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "preview",
      })
    ).toThrow("HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=development");
  });
});

describe("buildHostedLocalDevOverrides", () => {
  it("derives localhost overrides and the callback public key", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/cryptoKeyVersions/1",
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: "-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:local",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify({
        crv: "P-256",
        d: "cloudflare-d",
        kty: "EC",
        x: "cloudflare-x",
        y: "cloudflare-y",
      }),
      HOSTED_CRYPTO_ENV: "local",
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
      HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
        "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap",
      HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: generatedAuthorityPrivateJwkJson,
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "local-wrap-key",
      HOSTED_APP_SESSION_HMAC_KEY: Buffer.alloc(32, 10).toString("base64url"),
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
    });

    expect(overrides).toMatchObject({
      DEVICE_SYNC_PUBLIC_BASE_URL: "http://localhost:3000/api/device-sync",
      HOSTED_EXECUTION_CONTROL_URL: "http://127.0.0.1:8787",
      HOSTED_EXECUTION_DISPATCH_URL: "http://127.0.0.1:8787",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "http://localhost:3000",
      HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v1",
      HOSTED_CONTACT_PRIVACY_KEYS: "v1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
      HOSTED_MAILBOX_FINGERPRINT_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
      HOSTED_WEB_BASE_URL: "http://localhost:3000",
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:local",
      HOSTED_CRYPTO_ENV: "local",
      HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "projects/test/cryptoKeyVersions/1",
      HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: "-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----",
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
      HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
        "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap",
      HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: generatedAuthorityPrivateJwkJson,
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "local-wrap-key",
      VERCEL_PROJECT_PRODUCTION_URL: "localhost:3000",
    });
    expect(JSON.parse(overrides.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK ?? "")).toEqual({
      crv: "P-256",
      kty: "EC",
      x: "cloudflare-x",
      y: "cloudflare-y",
    });
    expect(JSON.parse(overrides.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK ?? "")).toEqual({
      crv: "P-256",
      kty: "EC",
      x: "callback-x",
      y: "callback-y",
    });
    expect(JSON.parse(overrides.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON ?? "")).toEqual({
      "callback:v1": {
        crv: "P-256",
        kty: "EC",
        x: "callback-x",
        y: "callback-y",
      },
    });
  });

  it("advertises a loopback worker URL when Wrangler binds all interfaces", () => {
    const overrides = buildHostedLocalDevOverrides({
      ...localConfig,
      workerHost: "0.0.0.0",
    }, {});

    expect(overrides.HOSTED_EXECUTION_CONTROL_URL).toBe("http://127.0.0.1:8787");
    expect(overrides.HOSTED_EXECUTION_DISPATCH_URL).toBe("http://127.0.0.1:8787");
  });

  it("keeps hosted onboarding links on the local web origin", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {});

    expect(overrides.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    expect(overrides.HOSTED_ONBOARDING_PUBLIC_BASE_URL).toBe("http://localhost:3000");
    expect(overrides.HOSTED_WEB_BASE_URL).toBe("http://localhost:3000");
    expect(overrides.RETELL_WEBHOOK_PUBLIC_BASE_URL).toBeUndefined();
  });

  it("sets the Retell webhook public base from the managed public tunnel", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {}, {
      retellWebhookPublicBaseUrl: " https://tunnel.example.test ",
    });

    expect(overrides.RETELL_WEBHOOK_PUBLIC_BASE_URL).toBe("https://tunnel.example.test");
  });

  it("falls back from malformed local contact privacy overrides", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {
      HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v9",
      HOSTED_CONTACT_PRIVACY_KEYS: "v9:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });

    expect(overrides.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION).toBe("v1");
    expect(overrides.HOSTED_CONTACT_PRIVACY_KEYS).toBe(
      "v1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
    );
  });

  it("preserves valid local contact privacy overrides", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {
      HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v9",
      HOSTED_CONTACT_PRIVACY_KEYS: "v9:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });

    expect(overrides.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION).toBe("v9");
    expect(overrides.HOSTED_CONTACT_PRIVACY_KEYS).toBe(
      "v9:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
  });

  it("overwrites inherited hosted onboarding public URLs with the local web origin", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://local.withmurph.ai:3443",
    });

    expect(overrides.HOSTED_ONBOARDING_PUBLIC_BASE_URL).toBe("http://localhost:3000");
    expect(overrides.HOSTED_WEB_BASE_URL).toBe("http://localhost:3000");
    expect(overrides.HOSTED_EXECUTION_CONTROL_URL).toBe("http://127.0.0.1:8787");
    expect(overrides.DEVICE_SYNC_PUBLIC_BASE_URL).toBe("http://localhost:3000/api/device-sync");
  });

  it("derives hosted onboarding links from worktree web ports", () => {
    const overrides = buildHostedLocalDevOverrides({
      ...localConfig,
      webHost: "127.0.0.1",
      webPort: 3205,
    }, {
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://local.withmurph.ai:3443",
    });

    expect(overrides.HOSTED_ONBOARDING_PUBLIC_BASE_URL).toBe("http://127.0.0.1:3205");
    expect(overrides.HOSTED_WEB_BASE_URL).toBe("http://127.0.0.1:3205");
    expect(overrides.DEVICE_SYNC_PUBLIC_BASE_URL).toBe("http://127.0.0.1:3205/api/device-sync");
  });

  it("preserves an explicit wake fetch proof key override", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {
    });

  });

  it("derives web callback verifier keys from the current local signing key", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
      HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON: JSON.stringify({
        "callback:v1": {
          crv: "P-256",
          kty: "EC",
          x: "stale-x",
          y: "stale-y",
        },
      }),
    });

    expect(JSON.parse(overrides.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK ?? "")).toEqual({
      crv: "P-256",
      kty: "EC",
      x: "callback-x",
      y: "callback-y",
    });
    expect(JSON.parse(overrides.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON ?? "")).toEqual({
      "callback:v1": {
        crv: "P-256",
        kty: "EC",
        x: "callback-x",
        y: "callback-y",
      },
    });
  });
});

describe("normalizeLocalDatabaseUrl", () => {
  it("fills the default local database name when the local url omits it", () => {
    expect(
      normalizeLocalDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:5432",
        "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync",
      ),
    ).toBe("postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync");
  });

  it("leaves already-correct local database urls unchanged", () => {
    expect(
      normalizeLocalDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync",
        "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync",
      ),
    ).toBe("postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync");
  });

  it("does not rewrite non-local database urls", () => {
    expect(
      normalizeLocalDatabaseUrl(
        "postgresql://db.example.test:5432",
        "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync",
      ),
    ).toBe("postgresql://db.example.test:5432");
  });
});

describe("resolveHostedLocalDatabaseUrl", () => {
  it("defaults to the local database even when Vercel has a remote database", () => {
    expect(
      resolveHostedLocalDatabaseUrl({
        pulledDatabaseUrl: "postgresql://remote.example.test:5432/murph",
      }),
    ).toBe("postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync");
  });

  it("uses an explicit dev database override before shell or pulled values", () => {
    expect(
      resolveHostedLocalDatabaseUrl({
        databaseUrlOverride: "postgresql://127.0.0.1:5432/override",
        pulledDatabaseUrl: "postgresql://remote.example.test:5432/murph",
        shellDatabaseUrl: "postgresql://127.0.0.1:5432/shell",
      }),
    ).toBe("postgresql://127.0.0.1:5432/override");
  });

  it("uses the shell database url before the default local target", () => {
    expect(
      resolveHostedLocalDatabaseUrl({
        shellDatabaseUrl: "postgresql://127.0.0.1:5432/shell",
      }),
    ).toBe("postgresql://127.0.0.1:5432/shell");
  });

  it("uses a local repo env database url when no explicit override is set", () => {
    expect(
      resolveHostedLocalDatabaseUrl({
        repoDatabaseUrl: "postgresql://127.0.0.1:5433/repo_local",
      }),
    ).toBe("postgresql://127.0.0.1:5433/repo_local");
  });

  it("uses the pulled database only when explicitly requested", () => {
    expect(
      resolveHostedLocalDatabaseUrl({
        pulledDatabaseUrl: "postgresql://remote.example.test:5432/murph",
        useVercelDatabaseUrl: true,
      }),
    ).toBe("postgresql://remote.example.test:5432/murph");
  });
});

describe("shouldSyncLocalDatabaseSchema", () => {
  it("returns true for the local loopback postgres target", () => {
    expect(
      shouldSyncLocalDatabaseSchema(
        "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync",
      ),
    ).toBe(true);
  });

  it("returns false for non-local database targets", () => {
    expect(
      shouldSyncLocalDatabaseSchema(
        "postgresql://db.example.test:5432/murph",
      ),
    ).toBe(false);
  });

  it("returns true for custom local loopback database targets", () => {
    expect(
      shouldSyncLocalDatabaseSchema(
        "postgresql://postgres:postgres@127.0.0.1:5432/custom_local_db",
      ),
    ).toBe(true);
  });

  it("treats a local postgres url without a database name as the default local sync target", () => {
    expect(
      shouldSyncLocalDatabaseSchema(
        "postgresql://postgres:postgres@127.0.0.1:5432",
      ),
    ).toBe(true);
  });

  it("treats localhost and IPv6 loopback postgres targets as local schema-sync databases", () => {
    expect(
      shouldSyncLocalDatabaseSchema(
        "postgresql://postgres:postgres@localhost:5433/murph_local",
      ),
    ).toBe(true);
    expect(
      shouldSyncLocalDatabaseSchema(
        "postgresql://postgres:postgres@[::1]:5432/murph_local",
      ),
    ).toBe(true);
  });
});

describe("buildWranglerVarArgs", () => {
  it("emits only allowlisted non-empty values", () => {
    expect(
      buildWranglerVarArgs({
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "250",
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "127.0.0.1",
        HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
        HOSTED_WEB_BASE_URL: "http://localhost:3000",
        HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
        LINQ_ATTACHMENT_CDN_BASE_URL: "http://127.0.0.1:4011/attachment-downloads",
        [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
          "http://127.0.0.1:4222/v1",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
        NODE_ENV: "test",
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "60000",
        JUNCTION_TIMESERIES_RESOURCES: "steps,heartrate,weight",
        IGNORED_SECRET: "secret",
      }),
    ).toEqual([
      "--var",
      "HOSTED_WEB_BASE_URL:http://localhost:3000",
      "--var",
      "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID:callback:v1",
      "--var",
      "LINQ_ATTACHMENT_CDN_BASE_URL:http://127.0.0.1:4011/attachment-downloads",
      "--var",
      "HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL:http://127.0.0.1:4222/v1",
      "--var",
      "MURPH_HOSTED_LOCAL_PROFILE:dev",
      "--var",
      "NODE_ENV:test",
      "--var",
      "HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS:250",
      "--var",
      "HOSTED_EXECUTION_RUNNER_HOST_ALIAS:127.0.0.1",
      "--var",
      "HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS:60000",
      "--var",
      "HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL:http://127.0.0.1:4010/.well-known/jwks",
    ]);
  });

  it("emits hosted provider optional vars inspected by the Worker", () => {
    expect(
      buildWranglerVarArgs({
        MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
        MURPH_ELEVENLABS_VOICE_ID: "voice-murph",
      }),
    ).toEqual([
      "--var",
      "MURPH_ELEVENLABS_MODEL_ID:eleven_multilingual_v2",
      "--var",
      "MURPH_ELEVENLABS_VOICE_ID:voice-murph",
    ]);
  });

  it("emits optional worker contract vars inspected at runtime", () => {
    expect(
      buildWranglerVarArgs({
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
        HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "45000",
      }),
    ).toEqual([
      "--var",
      "HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS:CUSTOM_API_KEY",
      "--var",
      "HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS:45000",
    ]);
  });

  it("never emits local-env-file-only Codex inputs as wrangler --var values", () => {
    expect(
      buildWranglerVarArgs({
        [HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]:
          '{"tokens":{"access_token":"chatgpt-access-token-material"}}',
        [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: "/tmp/local-catalog.json",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      }),
    ).toEqual(["--var", "MURPH_HOSTED_LOCAL_PROFILE:dev"]);
  });

  it("passes local e2e parser selectors to the worker without making them runner secrets", () => {
    expect(
      buildWranglerVarArgs({
        FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
        HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN: "1",
        // Whisper selectors left the allowlist with the Workers AI
        // transcription hard-cut; they must no longer reach the worker.
        WHISPER_COMMAND: "/app/test-parser-toolchain/whisper-cli",
        WHISPER_MODEL_PATH: "/app/test-parser-toolchain/ggml-test.bin",
      }),
    ).toEqual([
      "--var",
      "HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN:1",
      "--var",
      "FFMPEG_COMMAND:/app/test-parser-toolchain/ffmpeg",
    ]);
  });
});

describe("buildWranglerEnvFileText", () => {
  it("does not serialize the retired Junction timeseries resource override", () => {
    const source = {
      JUNCTION_TIMESERIES_RESOURCES: "steps,heartrate,weight",
    };

    expect(buildWranglerVarArgs(source)).toEqual([]);
    expect(buildWranglerEnvFileText(source)).not.toContain(
      "JUNCTION_TIMESERIES_RESOURCES",
    );
  });

  it("includes worker secrets and defaults the runner env profiles", () => {
    expect(
      buildWranglerEnvFileText({
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private",
        HOSTED_MAILBOX_FINGERPRINT_KEY: "mailbox-fingerprint-key",
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "60000",
        HOSTED_WEB_BASE_URL: "http://localhost:3000",
        LINQ_API_TOKEN: "linq-secret",
      }),
    ).toContain('HOSTED_EXECUTION_RUNNER_ENV_PROFILES="device-sync,exa,hosted-email,linq,mapbox,telegram"');
    expect(
      buildWranglerEnvFileText({
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private",
        HOSTED_LOG_FINGERPRINT_SECRET: "local-log-fingerprint-secret",
        HOSTED_MAILBOX_FINGERPRINT_KEY: "mailbox-fingerprint-key",
      }),
    ).not.toContain("HOSTED_MAILBOX_FINGERPRINT_KEY");
    expect(
      buildWranglerEnvFileText({
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private",
        HOSTED_LOG_FINGERPRINT_SECRET: "local-log-fingerprint-secret",
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "local-provider-egress-signing-secret",
      }),
    ).toContain('HOSTED_LOG_FINGERPRINT_SECRET="local-log-fingerprint-secret"');
    expect(
      buildWranglerEnvFileText({
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "local-provider-egress-signing-secret",
      }),
    ).toContain(
      'HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET="local-provider-egress-signing-secret"',
    );
    expect(
      buildWranglerEnvFileText({
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private",
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "60000",
        HOSTED_WEB_BASE_URL: "http://localhost:3000",
        LINQ_API_TOKEN: "linq-secret",
      }),
    ).toContain('HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS="60000"');
    expect(
      buildWranglerEnvFileText({
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private",
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "60000",
        HOSTED_WEB_BASE_URL: "http://localhost:3000",
        LINQ_API_TOKEN: "linq-secret",
      }),
    ).toContain('LINQ_API_TOKEN="linq-secret"');
    expect(
      buildWranglerEnvFileText({
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
        MURPH_DATA_API_KEY: "local-data-api-key",
        OPENAI_API_KEY: "local-openai-key",
        VENICE_API_KEY: "local-venice-key",
      }),
    ).toContain('OPENAI_API_KEY="local-openai-key"');
    expect(
      buildWranglerEnvFileText({
        VENICE_API_KEY: "local-venice-key",
      }),
    ).toContain('VENICE_API_KEY="local-venice-key"');
    expect(
      buildWranglerEnvFileText({
        MURPH_DATA_API_KEY: "local-data-api-key",
      }),
    ).toContain('MURPH_DATA_API_KEY="local-data-api-key"');
    expect(
      buildWranglerEnvFileText({
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      }),
    ).toContain('MURPH_HOSTED_LOCAL_PROFILE="dev"');
  });

  it("includes hosted provider optional env inspected by the Worker", () => {
    const text = buildWranglerEnvFileText({
      ELEVENLABS_API_KEY: "elevenlabs-secret",
      EXA_API_KEY: "exa-secret",
      HOSTED_EMAIL_DEFAULT_SUBJECT: "Murph",
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
      HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "45000",
      MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      MURPH_ELEVENLABS_VOICE_ID: "voice-murph",
    });

    expect(text).toContain('ELEVENLABS_API_KEY="elevenlabs-secret"');
    expect(text).toContain('EXA_API_KEY="exa-secret"');
    expect(text).toContain('HOSTED_EMAIL_DEFAULT_SUBJECT="Murph"');
    expect(text).toContain('HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS="CUSTOM_API_KEY"');
    expect(text).toContain('HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS="45000"');
    expect(text).toContain('MURPH_ELEVENLABS_MODEL_ID="eleven_multilingual_v2"');
    expect(text).toContain('MURPH_ELEVENLABS_VOICE_ID="voice-murph"');
  });

  it("round-trips the dev Codex subscription auth value through env-file escaping", () => {
    // The harness base64url-encodes the auth.json payload precisely because
    // dotenv-style parsers (wrangler bundles dotenv) strip outer quotes but do
    // not unescape embedded \" sequences; the encoded value has neither.
    const authJson = JSON.stringify({
      OPENAI_API_KEY: null,
      last_refresh: "2026-06-11T00:00:00.000Z",
      tokens: {
        access_token: "chatgpt-access-token-material",
        account_id: "acct_local",
        id_token: "chatgpt-id-token-material",
        refresh_token: "",
      },
    });
    const encoded = Buffer.from(authJson, "utf8").toString("base64url");
    expect(encoded).not.toMatch(/["'\\\s#]/u);

    const text = buildWranglerEnvFileText({
      [HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]: encoded,
      MURPH_DATA_API_KEY: "local-data-api-key",
    });

    expect(text).toContain(`${HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV}=`);
    // No raw token material in the env file.
    expect(text).not.toContain("chatgpt-access-token-material");

    const parsed = parseEnvText(text);
    expect(parsed[HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]).toBe(encoded);
    expect(
      JSON.parse(Buffer.from(
        parsed[HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV] ?? "",
        "base64url",
      ).toString("utf8")),
    ).toEqual(JSON.parse(authJson));
  });

  it("keeps web-only hosted-local crypto state out of worker env files", () => {
    const text = buildWranglerEnvFileText({
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
      HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
        "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap",
      HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: generatedAuthorityPrivateJwkJson,
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "local-wrap-key",
    });

    expect(text).not.toContain("HOSTED_CRYPTO_GCP_KMS_API_ROOT=");
    expect(text).not.toContain("HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME=");
    expect(text).not.toContain("HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK=");
    expect(text).not.toContain("HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY=");
  });

  it("writes only hosted-local generated state for persistence", () => {
    const text = buildHostedLocalStateEnvFileText({
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: generatedPrivateJwkJson,
      HOSTED_CRYPTO_ENV: "local",
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "local-wrap-key",
      HOSTED_LOG_FINGERPRINT_SECRET: "local-log-fingerprint-secret",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "local-provider-egress-signing-secret",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
      LINQ_API_TOKEN: "remote-linq-token",
    });

    expect(text).toContain("HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK=");
    expect(text).toContain('HOSTED_CRYPTO_ENV="local"');
    expect(text).toContain('HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY="local-wrap-key"');
    expect(text).toContain('HOSTED_LOG_FINGERPRINT_SECRET="local-log-fingerprint-secret"');
    expect(text).toContain(
      'HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET="local-provider-egress-signing-secret"',
    );
    expect(text).toContain("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK=");
    expect(text).not.toContain("LINQ_API_TOKEN");
  });

  it("does not persist test crypto state for later hosted-local dev reuse", () => {
    const text = buildHostedLocalStateEnvFileText({
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: generatedPrivateJwkJson,
      HOSTED_CRYPTO_ENV: "test",
      HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION:
        "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "test-wrap-key",
      HOSTED_DEVICE_ROUTING_INDEX_KEY: "device-routing-key",
      HOSTED_LOG_FINGERPRINT_SECRET: "test-log-fingerprint-secret",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "test-provider-egress-signing-secret",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
      LINQ_API_TOKEN: "remote-linq-token",
    });

    expect(text).not.toContain("HOSTED_CRYPTO_");
    expect(text).not.toContain("HOSTED_LOG_FINGERPRINT_SECRET");
    expect(text).not.toContain("HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET");
    expect(text).not.toContain("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK");
    expect(text).toContain('HOSTED_DEVICE_ROUTING_INDEX_KEY="device-routing-key"');
    expect(text).not.toContain("LINQ_API_TOKEN");
  });
});

describe("buildWranglerLocalDevConfig", () => {
  it("keeps repo-relative defaults for the checked-in local dev location", () => {
    const config = buildWranglerLocalDevConfig({});
    const containers = config.containers as {
      class_name: string;
      image: string;
      image_build_context: string;
      image_vars: Record<string, string>;
      max_instances: number;
      authorized_keys?: unknown;
      ssh: { enabled: boolean };
    }[];
    const container = containers[0]!;
    const smokeContainer = containers[1]!;

    expect(config.main).toBe("../src/index.ts");
    expect(config.name).toBe("murph-hosted");
    expect(config.vars).not.toHaveProperty("HOSTED_EXECUTION_RUNNER_DESTROY_TIMEOUT_MS");
    expect(containers.map((entry) => entry.class_name)).toEqual([
      "RunnerContainer",
      "DeploySmokeRunnerContainer",
    ]);
    expect(config.compatibility_flags).toEqual([
      "nodejs_compat",
      "containers_pid_namespace",
    ]);
    for (const entry of containers) {
      expect(entry.ssh).toEqual({ enabled: false });
      expect(entry).not.toHaveProperty("authorized_keys");
    }
    expect(config.durable_objects).toMatchObject({
      bindings: expect.arrayContaining([
        {
          class_name: "DatabaseHealthDurableObject",
          name: "DATABASE_HEALTH_MONITOR",
        },
        {
          class_name: "DeviceWebhookQueueHealthDurableObject",
          name: "DEVICE_WEBHOOK_QUEUE_MONITOR",
        },
      ]),
    });
    expect(config.migrations).toEqual(expect.arrayContaining([
      {
        new_sqlite_classes: ["DatabaseHealthDurableObject"],
        tag: "v4",
      },
      {
        new_sqlite_classes: ["DeviceWebhookQueueHealthDurableObject"],
        tag: "v5",
      },
    ]));
    expect(config.triggers).toEqual({
      crons: ["*/5 * * * *"],
    });
    expect(config.analytics_engine_datasets).toEqual([
      {
        binding: "HOSTED_RUNTIME_RETRY_ANALYTICS",
        dataset: "murph_hosted_runtime_retries",
      },
    ]);
    expect(container.image).toBe("../../../Dockerfile.cloudflare-hosted-runner");
    expect(container.image_build_context).toBe("..");
    expect(container.image_vars).toEqual({
      HOSTED_RUNNER_CONTAINER_CLASS: "RunnerContainer",
      HOSTED_RUNNER_LOCAL_BUILD_ID: "local",
    });
    expect(smokeContainer).toMatchObject({
      image: container.image,
      image_build_context: container.image_build_context,
      // The per-class build arg must differ so the two classes never produce
      // the same Docker image ID: wrangler dev untags duplicate
      // cloudflare-dev tags that share one image ID, which removed the runner
      // image tag right after the deploy-smoke image build.
      image_vars: {
        HOSTED_RUNNER_CONTAINER_CLASS: "DeploySmokeRunnerContainer",
        HOSTED_RUNNER_LOCAL_BUILD_ID: "local",
      },
      max_instances: 1,
    });
  });

  it("uses an isolated worker name for worktree-scoped dev runs", () => {
    const source = {
      MURPH_DEV_WORKTREE_SCOPE: "feature-a",
      MURPH_HOSTED_LOCAL_PROFILE: "dev",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "worktree-feature-a",
    };
    const workerName = resolveWranglerLocalDevWorkerName(source);

    expect(workerName).toMatch(/^murph-worktree-[a-f0-9]{24}$/u);
    expect(workerName.startsWith("murph-hosted-")).toBe(false);
    expect(buildWranglerEnvFileText(source)).not.toContain("MURPH_DEV_WORKTREE_SCOPE");
    expect(buildWranglerVarArgs(source).join("\n")).not.toContain("MURPH_DEV_WORKTREE_SCOPE");
  });

  it("re-roots generated paths to the temp config directory", () => {
    const config = buildWranglerLocalDevConfig(
      {},
      {
        cloudflareAppDir: "/workspace/apps/cloudflare",
        configDir: "/tmp/murph-dev-env-test",
        workspaceRoot: "/workspace",
      },
    );
    const containers = config.containers as {
      image: string;
      image_build_context: string;
      image_vars: Record<string, string>;
    }[];
    const container = containers[0]!;
    const smokeContainer = containers[1]!;

    expect(config.main).toBe("../../workspace/apps/cloudflare/src/index.ts");
    expect(container.image).toBe("../../workspace/Dockerfile.cloudflare-hosted-runner");
    expect(container.image_build_context).toBe("../../workspace/apps/cloudflare");
    expect(smokeContainer.image).toBe(container.image);
    expect(smokeContainer.image_build_context).toBe(container.image_build_context);
  });

  it("includes the production Worker bindings for the dev profile", () => {
    const config = buildWranglerLocalDevConfig({});

    expect(config.ai).toEqual({ binding: "AI" });
    expect(config.send_email).toEqual([{ name: "HOSTED_EMAIL" }]);
    expect(config.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
  });

  it("omits the Workers AI binding for hosted-local test routes so the fake binding composes", () => {
    const config = buildWranglerLocalDevConfig({
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });

    expect(config).not.toHaveProperty("ai");
    expect(config.send_email).toEqual([{ name: "HOSTED_EMAIL" }]);
    expect(config.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
  });

  it("omits the Workers AI binding when MURPH_DEV_SKIP_WORKERS_AI is set", () => {
    const config = buildWranglerLocalDevConfig({
      MURPH_DEV_SKIP_WORKERS_AI: "1",
    });

    expect(config).not.toHaveProperty("ai");
  });

  it("keeps the Workers AI binding when only one hosted-local test-routes flag is set", () => {
    expect(buildWranglerLocalDevConfig({ NODE_ENV: "test" }).ai).toEqual({
      binding: "AI",
    });
    expect(
      buildWranglerLocalDevConfig({ MURPH_HOSTED_LOCAL_TEST_ROUTES: "1" }).ai,
    ).toEqual({ binding: "AI" });
  });

  it("uses the hosted-local test Worker entrypoint only when test routes are enabled", () => {
    const config = buildWranglerLocalDevConfig({
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });
    const productionLikeConfig = buildWranglerLocalDevConfig({
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "production",
    });

    expect(config.main).toBe("../src/hosted-local-test-index.ts");
    expect(productionLikeConfig.main).toBe("../src/index.ts");
  });

  it("passes the local runner build id and container class as Docker build args", () => {
    const config = buildWranglerLocalDevConfig({
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "stack-test-build-id",
    });
    const containers = config.containers as {
      class_name: string;
      image_vars: Record<string, string>;
    }[];

    for (const container of containers) {
      expect(container.image_vars).toEqual({
        HOSTED_RUNNER_CONTAINER_CLASS: container.class_name,
        HOSTED_RUNNER_LOCAL_BUILD_ID: buildHostedRunnerLocalBuildId("stack-test-build-id"),
      });
    }
    expect(
      new Set(containers.map((entry) => entry.image_vars.HOSTED_RUNNER_CONTAINER_CLASS)).size,
    ).toBe(containers.length);
  });

  it("passes the deploy-smoke local build marker through local worker vars", () => {
    const config = buildWranglerLocalDevConfig({
      [HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID_ENV]: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "stack-test-build-id",
    });

    expect(config.vars).toMatchObject({
      [HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID_ENV]: "1",
    });
  });

  it("uses an isolated worker name for E2E profiles", () => {
    const config = buildWranglerLocalDevConfig({
      MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "stack-test-build-id",
    });

    expect(config.name).toMatch(/^murph-hosted-e2e-[a-f0-9]{24}$/u);
    expect(config.name).not.toBe("murph-hosted");
  });

  it("keeps normal dev profile on the shared local worker name", () => {
    const config = buildWranglerLocalDevConfig({
      MURPH_HOSTED_LOCAL_PROFILE: "dev",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "stack-test-build-id",
    });

    expect(config.name).toBe("murph-hosted");
    expect(config.vars).toEqual(expect.objectContaining({
      MURPH_HOSTED_LOCAL_PROFILE: "dev",
    }));
  });

  it("hashes caller-supplied local runner build ids before they reach image metadata", () => {
    expect(buildHostedRunnerLocalBuildId("stack-test-build-id")).toMatch(
      /^sha256-[a-f0-9]{24}$/u,
    );
    expect(buildHostedRunnerLocalBuildId("")).toBe("local");
    expect(buildHostedRunnerLocalBuildId("sha256-0123456789abcdef01234567")).toBe(
      "sha256-0123456789abcdef01234567",
    );
  });

  it("passes NODE_ENV through local worker vars when provided", () => {
    const config = buildWranglerLocalDevConfig({
      NODE_ENV: "test",
    });

    expect(config.vars).toMatchObject({
      NODE_ENV: "test",
    });
  });

  it("passes the hosted-local e2e isolation flag through local worker vars", () => {
    const config = buildWranglerLocalDevConfig({
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    });

    expect(config.vars).toMatchObject({
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    });
  });

  it("passes local e2e parser selectors through local worker vars", () => {
    const config = buildWranglerLocalDevConfig({
      FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
      HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN: "1",
    });

    expect(config.vars).toMatchObject({
      FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
      HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN: "1",
    });
  });

  it("declares Worker-owned data API and provider credentials as local worker secrets", () => {
    const config = buildWranglerLocalDevConfig({
      HOSTED_ASSISTANT_PROVIDER: "openai",
      MURPH_DATA_API_KEY: "local-data-api-key",
      OPENAI_API_KEY: "local-openai-key",
      VENICE_API_KEY: "local-venice-key",
    });

    expect(config.secrets).toEqual({
      required: expect.arrayContaining([
        "MURPH_DATA_API_KEY",
        "OPENAI_API_KEY",
        "VENICE_API_KEY",
      ]),
    });
    expect(config.vars).toMatchObject({
      HOSTED_ASSISTANT_PROVIDER: "openai",
    });
    expect(config.vars).not.toHaveProperty("MURPH_DATA_API_KEY");
    expect(config.vars).not.toHaveProperty("OPENAI_API_KEY");
    expect(config.vars).not.toHaveProperty("VENICE_API_KEY");
  });

  it("declares the dev Codex subscription auth JSON as a local worker secret, never a config var", () => {
    const withAuth = buildWranglerLocalDevConfig({
      [HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]: Buffer.from(
        '{"tokens":{"access_token":"chatgpt-access-token-material"}}',
        "utf8",
      ).toString("base64url"),
    });

    expect(readRequiredSecretNames(withAuth)).toContain(
      HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
    );
    expect(withAuth.vars).not.toHaveProperty(
      HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
    );
    // The generated Wrangler config must never embed the token material itself.
    expect(JSON.stringify(withAuth)).not.toContain("chatgpt-access-token-material");

    const withoutAuth = buildWranglerLocalDevConfig({});
    expect(readRequiredSecretNames(withoutAuth)).not.toContain(
      HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
    );
  });

  it("declares the generated Codex model catalog path as local worker env-file-only", () => {
    const config = buildWranglerLocalDevConfig({
      [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: "/tmp/local-catalog.json",
    });
    const envFileText = buildWranglerEnvFileText({
      [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: "/tmp/local-catalog.json",
    });

    expect(readRequiredSecretNames(config)).toContain(
      HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
    );
    expect(config.vars).not.toHaveProperty(
      HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
    );
    expect(envFileText).toContain(
      `${HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV}="/tmp/local-catalog.json"`,
    );
  });

  it("declares the log fingerprint key as a local worker secret", () => {
    const config = buildWranglerLocalDevConfig({
      HOSTED_LOG_FINGERPRINT_SECRET: "local-log-fingerprint-secret",
    });

    expect(config.secrets).toEqual({
      required: expect.arrayContaining([
        "HOSTED_LOG_FINGERPRINT_SECRET",
      ]),
    });
    expect(config.vars).not.toHaveProperty("HOSTED_LOG_FINGERPRINT_SECRET");
  });

  it("declares each local worker secret binding only once", () => {
    const config = buildWranglerLocalDevConfig({
      JUNCTION_API_KEY: "sk_us_junction-test",
      JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
      JUNCTION_WEBHOOK_SECRET: "junction-webhook-secret",
      MURPH_DATA_API_KEY: "local-data-api-key",
    });
    const required = readRequiredSecretNames(config);

    expect(required.filter((name) => name === "JUNCTION_API_KEY")).toHaveLength(1);
    expect(required.filter((name) => name === "MURPH_DATA_API_KEY")).toHaveLength(1);
    expect(new Set(required).size).toBe(required.length);
  });
});
