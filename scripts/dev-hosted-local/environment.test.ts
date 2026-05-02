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
  resolveHostedLocalDatabaseUrl,
  resolveHostedLocalStripeEnvFilePath,
  shouldSyncLocalDatabaseSchema,
} from "./environment.ts";
import type {
  HostedExecutionOidcIdentity,
  HostedLocalDevConfig,
} from "./types.ts";

const localConfig: HostedLocalDevConfig = {
  databaseUrlOverride: null,
  forceResetLocalDatabase: false,
  linqWebhookPublicUrl: null,
  linqWebhookTunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
  linqWebhookTunnelMode: "auto",
  linqWebhookTunnelName: "dev",
  localCodexBridge: true,
  localCodexBridgeHost: "127.0.0.1",
  localCodexBridgePort: 0,
  localCodexCommand: "codex",
  skipHealthCommonsWatch: false,
  skipLinqWebhookRegister: false,
  skipPrismaMigrate: false,
  skipRunnerSmoke: false,
  skipStripeListen: false,
  skipWeb: false,
  skipVercelPull: false,
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
        HOSTED_CRYPTO_ENV: "local",
        HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL: "http://127.0.0.1:9998",
        HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "stale-token",
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:9999",
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
    expect(merged.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION).toBe(
      "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/authority-sign/cryptoKeyVersions/1",
    );
    expect(merged.HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM).toBe(generatedAuthorityPublicPem);
    expect(merged.HOSTED_CRYPTO_ENV).toBe("local");
    expect(merged.HOSTED_CRYPTO_GCP_KMS_API_ROOT).toBe("local://murph-hosted-kms");
    expect(merged.HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME).toBe(
      "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap",
    );
    expect(merged.HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK).toBe(
      generatedAuthorityPrivateJwkJson,
    );
    expect(merged.HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY).toBe("generated-envelope");
    expect(merged.HOSTED_WAKE_ENCRYPTION_KEY).toBeUndefined();
    expect(merged.HOSTED_WAKE_ENCRYPTION_KEYRING_JSON).toBeUndefined();
    expect(merged.HOSTED_WEB_ENCRYPTION_KEY).toBeUndefined();
    expect(merged.HOSTED_WEB_ENCRYPTION_KEYRING_JSON).toBeUndefined();
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
    expect(merged.HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL).toBe("http://127.0.0.1:9998");
    expect(merged.HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN).toBe("stale-token");
    expect(merged.ALLOW_LOCAL_INTERNAL_PROXY).toBe("true");
    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG).toBe("murph");
    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME).toBe("murph-web");
    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT).toBe("development");
    expect(merged.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL).toBe("http://127.0.0.1:8787");
    expect(merged.HOSTED_EXECUTION_RUNNER_HOST_ALIAS).toBe("192.168.65.2");
    expect(merged.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBe(callbackPrivateJwkJson);
    expect(merged.HOSTED_WEB_BASE_URL).toBe("http://localhost:3000");
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
    expect(merged.HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION).toBe(
      "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/authority-sign/cryptoKeyVersions/1",
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

  it("regenerates local authority signing keys when persisted local state is mismatched", () => {
    const merged = mergeCloudflareLocalEnv({
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
    });

    expect(merged.HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM).toBe(
      generatedAuthorityPublicPem,
    );
    expect(merged.HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK).toBe(
      generatedAuthorityPrivateJwkJson,
    );
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

  it("drops stale local Codex bridge proxy values when the bridge is disabled", () => {
    const merged = mergeCloudflareLocalEnv({
      config: {
        ...localConfig,
        localCodexBridge: false,
      },
      existing: {
        MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN: "stale-token",
        MURPH_DEV_CODEX_APP_SERVER_PROXY_URL: "tcp://127.0.0.1:4123",
      },
      oidcIdentity,
      overrides: {
        MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN: "override-token",
        MURPH_DEV_CODEX_APP_SERVER_PROXY_URL: "tcp://127.0.0.1:9999",
      },
    });

    expect(merged.MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN).toBeUndefined();
    expect(merged.MURPH_DEV_CODEX_APP_SERVER_PROXY_URL).toBeUndefined();
  });

  it("drops test-only Codex app-server stub values when the bridge is enabled", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        MURPH_E2E_CODEX_APP_SERVER_STUB_BASE_URL: "http://127.0.0.1:4111/v1",
      },
      oidcIdentity,
      overrides: {
        MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN: "bridge-token",
        MURPH_DEV_CODEX_APP_SERVER_PROXY_URL: "tcp://127.0.0.1:4123",
        MURPH_E2E_CODEX_APP_SERVER_STUB_BASE_URL: "http://127.0.0.1:5222/v1",
      },
    });

    expect(merged.MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN).toBe("bridge-token");
    expect(merged.MURPH_DEV_CODEX_APP_SERVER_PROXY_URL).toBe("tcp://127.0.0.1:4123");
    expect(merged.MURPH_E2E_CODEX_APP_SERVER_STUB_BASE_URL).toBeUndefined();
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

  it("preserves an explicit current worker bridge override instead of resetting to the listen host", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:9999",
      },
      oidcIdentity,
      overrides: {
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://host.docker.internal:8787",
      },
    });

    expect(merged.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL).toBe(
      "http://host.docker.internal:8787",
    );
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
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
    });

    expect(overrides).toMatchObject({
      HOSTED_EXECUTION_CONTROL_URL: "http://127.0.0.1:8787",
      HOSTED_EXECUTION_DISPATCH_URL: "http://127.0.0.1:8787",
      HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS: "http://localhost:3000",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "http://localhost:3000",
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

  it("can use a public tunnel origin for hosted onboarding links while keeping worker web base local", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {}, {
      hostedOnboardingPublicBaseUrl: "https://tunnel.example.test",
    });

    expect(overrides.HOSTED_ONBOARDING_PUBLIC_BASE_URL).toBe("https://tunnel.example.test");
    expect(overrides.HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS).toBe("http://localhost:3000");
    expect(overrides.HOSTED_WEB_BASE_URL).toBe("http://localhost:3000");
  });

  it("preserves an explicit wake fetch proof key override", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {
    });

  });

  it("does not mirror legacy hosted wake encryption overrides from the worker env", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {
      HOSTED_WAKE_ENCRYPTION_KEY: "shared-wake-key",
      HOSTED_WAKE_ENCRYPTION_KEY_VERSION: "shared-wake-key-id",
    });

    expect(overrides.HOSTED_WAKE_ENCRYPTION_KEY).toBeUndefined();
    expect(overrides.HOSTED_WAKE_ENCRYPTION_KEY_VERSION).toBeUndefined();
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
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:8787",
        MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN: "bridge-token",
        MURPH_DEV_CODEX_APP_SERVER_PROXY_URL: "tcp://127.0.0.1:4123",
        ALLOW_LOCAL_INTERNAL_PROXY: "true",
        HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
        HOSTED_WEB_BASE_URL: "http://localhost:3000",
        HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
        LINQ_ATTACHMENT_CDN_BASE_URL: "http://127.0.0.1:4011/attachment-downloads",
        MURPH_E2E_CODEX_APP_SERVER_STUB_BASE_URL: "http://127.0.0.1:4111/v1",
        NODE_ENV: "test",
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "60000",
        IGNORED_SECRET: "secret",
      }),
    ).toEqual([
      "--var",
      "HOSTED_WEB_BASE_URL:http://localhost:3000",
      "--var",
      "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID:callback:v1",
      "--var",
      "ALLOW_LOCAL_INTERNAL_PROXY:true",
      "--var",
      "LINQ_ATTACHMENT_CDN_BASE_URL:http://127.0.0.1:4011/attachment-downloads",
      "--var",
      "MURPH_E2E_CODEX_APP_SERVER_STUB_BASE_URL:http://127.0.0.1:4111/v1",
      "--var",
      "NODE_ENV:test",
      "--var",
      "HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL:http://127.0.0.1:8787",
      "--var",
      "HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS:60000",
      "--var",
      "HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL:http://127.0.0.1:4010/.well-known/jwks",
    ]);
  });

  it("passes local e2e parser selectors to the worker without making them runner secrets", () => {
    expect(
      buildWranglerVarArgs({
        FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
        HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN: "1",
        WHISPER_COMMAND: "/app/test-parser-toolchain/whisper-cli",
        WHISPER_MODEL_PATH: "/app/test-parser-toolchain/ggml-test.bin",
      }),
    ).toEqual([
      "--var",
      "HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN:1",
      "--var",
      "FFMPEG_COMMAND:/app/test-parser-toolchain/ffmpeg",
      "--var",
      "WHISPER_COMMAND:/app/test-parser-toolchain/whisper-cli",
      "--var",
      "WHISPER_MODEL_PATH:/app/test-parser-toolchain/ggml-test.bin",
    ]);
  });
});

describe("buildWranglerEnvFileText", () => {
  it("includes worker secrets and defaults the runner env profiles", () => {
    expect(
      buildWranglerEnvFileText({
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private",
        HOSTED_MAILBOX_FINGERPRINT_KEY: "mailbox-fingerprint-key",
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "60000",
        HOSTED_WEB_BASE_URL: "http://localhost:3000",
        LINQ_API_TOKEN: "linq-secret",
      }),
    ).toContain('HOSTED_EXECUTION_RUNNER_ENV_PROFILES="device-sync,hosted-email,linq,mapbox,telegram"');
    expect(
      buildWranglerEnvFileText({
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private",
        HOSTED_MAILBOX_FINGERPRINT_KEY: "mailbox-fingerprint-key",
      }),
    ).not.toContain("HOSTED_MAILBOX_FINGERPRINT_KEY");
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
        MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN: "bridge-token",
        MURPH_DEV_CODEX_APP_SERVER_PROXY_URL: "tcp://127.0.0.1:4123",
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "60000",
        HOSTED_WEB_BASE_URL: "http://localhost:3000",
        LINQ_API_TOKEN: "linq-secret",
      }),
    ).toContain('LINQ_API_TOKEN="linq-secret"');
    expect(
      buildWranglerEnvFileText({
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private",
        MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN: "bridge-token",
        MURPH_DEV_CODEX_APP_SERVER_PROXY_URL: "tcp://127.0.0.1:4123",
      }),
    ).toContain('MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN="bridge-token"');
    expect(
      buildWranglerEnvFileText({
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private",
        MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN: "bridge-token",
        MURPH_DEV_CODEX_APP_SERVER_PROXY_URL: "tcp://127.0.0.1:4123",
      }),
    ).toContain('MURPH_DEV_CODEX_APP_SERVER_PROXY_URL="tcp://127.0.0.1:4123"');
  });

  it("keeps web-only hosted-local crypto state out of worker env files", () => {
    const text = buildWranglerEnvFileText({
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
      HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
        "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap",
      HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: generatedAuthorityPrivateJwkJson,
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "local-wrap-key",
      HOSTED_WEB_ENCRYPTION_KEY: "web-key",
      HOSTED_WEB_ENCRYPTION_KEY_VERSION: "web:v1",
    });

    expect(text).not.toContain("HOSTED_CRYPTO_GCP_KMS_API_ROOT=");
    expect(text).not.toContain("HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME=");
    expect(text).not.toContain("HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK=");
    expect(text).not.toContain("HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY=");
    expect(text).not.toContain("HOSTED_WEB_ENCRYPTION_KEY=");
    expect(text).not.toContain("HOSTED_WEB_ENCRYPTION_KEY_VERSION=");
  });

  it("writes only hosted-local keyring state for persistence", () => {
    const text = buildHostedLocalStateEnvFileText({
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: generatedPrivateJwkJson,
      HOSTED_CRYPTO_ENV: "local",
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "local-wrap-key",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
      LINQ_API_TOKEN: "remote-linq-token",
    });

    expect(text).toContain("HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK=");
    expect(text).toContain('HOSTED_CRYPTO_ENV="local"');
    expect(text).toContain('HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY="local-wrap-key"');
    expect(text).toContain("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK=");
    expect(text).not.toContain("LINQ_API_TOKEN");
  });
});

describe("buildWranglerLocalDevConfig", () => {
  it("keeps repo-relative defaults for the checked-in local dev location", () => {
    const config = buildWranglerLocalDevConfig({});
    const container = (config.containers as {
      image: string;
      image_build_context: string;
      image_vars: Record<string, string>;
    }[])[0];

    expect(config.main).toBe("../src/index.ts");
    expect(container.image).toBe("../../../Dockerfile.cloudflare-hosted-runner");
    expect(container.image_build_context).toBe("..");
    expect(container.image_vars).toEqual({
      HOSTED_RUNNER_LOCAL_BUILD_ID: "local",
    });
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
    const container = (config.containers as {
      image: string;
      image_build_context: string;
      image_vars: Record<string, string>;
    }[])[0];

    expect(config.main).toBe("../../workspace/apps/cloudflare/src/index.ts");
    expect(container.image).toBe("../../workspace/Dockerfile.cloudflare-hosted-runner");
    expect(container.image_build_context).toBe("../../workspace/apps/cloudflare");
  });

  it("passes the local runner build id as a Docker build arg", () => {
    const config = buildWranglerLocalDevConfig({
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "stack-test-build-id",
    });
    const container = (config.containers as {
      image_vars: Record<string, string>;
    }[])[0];

    expect(container.image_vars).toEqual({
      HOSTED_RUNNER_LOCAL_BUILD_ID: buildHostedRunnerLocalBuildId("stack-test-build-id"),
    });
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

  it("passes local e2e parser selectors through local worker vars", () => {
    const config = buildWranglerLocalDevConfig({
      FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
      HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN: "1",
      WHISPER_COMMAND: "/app/test-parser-toolchain/whisper-cli",
      WHISPER_MODEL_PATH: "/app/test-parser-toolchain/ggml-test.bin",
    });

    expect(config.vars).toMatchObject({
      FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
      HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN: "1",
      WHISPER_COMMAND: "/app/test-parser-toolchain/whisper-cli",
      WHISPER_MODEL_PATH: "/app/test-parser-toolchain/ggml-test.bin",
    });
  });

  it("declares local Codex app-server proxy env-file entries as local worker secrets", () => {
    const config = buildWranglerLocalDevConfig({
      MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN: "bridge-token",
      MURPH_DEV_CODEX_APP_SERVER_PROXY_URL: "tcp://127.0.0.1:4123",
    });

    expect(config.secrets).toEqual({
      required: expect.arrayContaining([
        "MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN",
        "MURPH_DEV_CODEX_APP_SERVER_PROXY_URL",
      ]),
    });
    expect(config.vars).not.toHaveProperty("MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN");
    expect(config.vars).not.toHaveProperty("MURPH_DEV_CODEX_APP_SERVER_PROXY_URL");
  });

  it("declares each local worker secret binding only once", () => {
    const config = buildWranglerLocalDevConfig({
      JUNCTION_API_KEY: "sk_us_junction-test",
      JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
      JUNCTION_WEBHOOK_SECRET: "junction-webhook-secret",
    });
    const required = readRequiredSecretNames(config);

    expect(required.filter((name) => name === "JUNCTION_API_KEY")).toHaveLength(1);
    expect(new Set(required).size).toBe(required.length);
  });
});
