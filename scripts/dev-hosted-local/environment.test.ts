import { describe, expect, it } from "vitest";

import {
  assertLocalWorkerOidcEnvironment,
  buildHostedLocalDevOverrides,
  buildWranglerEnvFileText,
  buildWranglerLocalDevConfig,
  buildWranglerVarArgs,
  mergeCloudflareLocalEnv,
  normalizeLocalDatabaseUrl,
  parseEnvText,
  shouldSyncLocalDatabaseSchema,
} from "./environment.ts";
import type {
  HostedExecutionOidcIdentity,
  HostedLocalDevConfig,
} from "./types.ts";

const localConfig: HostedLocalDevConfig = {
  skipWeb: false,
  skipPrismaMigrate: false,
  skipStripeListen: false,
  skipVercelPull: false,
  webHost: "127.0.0.1",
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

describe("mergeCloudflareLocalEnv", () => {
  it("fills the local worker env contract from existing values and generated defaults", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
        HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL: "http://127.0.0.1:9998",
        HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "stale-token",
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:9999",
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "192.168.65.2",
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "existing-envelope",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
      },
      oidcIdentity,
      createEnvelopeKey: () => "generated-envelope",
      createJwkPair: () => ({
        privateJwkJson: JSON.stringify({
          crv: "P-256",
          d: "generated-d",
          kty: "EC",
          x: "generated-x",
          y: "generated-y",
        }),
        publicJwkJson: JSON.stringify({
          crv: "P-256",
          kty: "EC",
          x: "generated-x",
          y: "generated-y",
        }),
      }),
    });

    expect(merged.HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY).toBe("existing-envelope");
    expect(merged.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK).toContain("generated-d");
    expect(merged.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK).toContain("generated-x");
    expect(merged.HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL).toBe("http://127.0.0.1:9998");
    expect(merged.HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN).toBe("stale-token");
    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG).toBe("murph");
    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME).toBe("murph-web");
    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT).toBe("development");
    expect(merged.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL).toBe("http://127.0.0.1:8787");
    expect(merged.HOSTED_EXECUTION_RUNNER_HOST_ALIAS).toBe("192.168.65.2");
    expect(merged.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBe(callbackPrivateJwkJson);
    expect(merged.HOSTED_WEB_BASE_URL).toBe("http://127.0.0.1:3000");
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
      HOSTED_WAKE_ENCRYPTION_KEY: "worker-wake-key",
      HOSTED_WAKE_ENCRYPTION_KEYRING_JSON: "{\"v0\":\"old-worker-wake-key\"}",
      HOSTED_WAKE_ENCRYPTION_KEY_VERSION: "worker:v2",
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
    });

    expect(overrides).toMatchObject({
      HOSTED_EXECUTION_DISPATCH_URL: "http://127.0.0.1:8787",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "http://127.0.0.1:3000",
      HOSTED_WAKE_ENCRYPTION_KEY: "worker-wake-key",
      HOSTED_WAKE_ENCRYPTION_KEYRING_JSON: "{\"v0\":\"old-worker-wake-key\"}",
      HOSTED_WAKE_ENCRYPTION_KEY_VERSION: "worker:v2",
      HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
      VERCEL_PROJECT_PRODUCTION_URL: "127.0.0.1:3000",
    });
    expect(JSON.parse(overrides.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK ?? "")).toEqual({
      crv: "P-256",
      kty: "EC",
      x: "callback-x",
      y: "callback-y",
    });
  });

  it("preserves an explicit wake fetch proof key override", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {
    });

  });

  it("mirrors hosted wake encryption overrides from the worker env", () => {
    const overrides = buildHostedLocalDevOverrides(localConfig, {
      HOSTED_WAKE_ENCRYPTION_KEY: "shared-wake-key",
      HOSTED_WAKE_ENCRYPTION_KEY_VERSION: "shared-wake-key-id",
    });

    expect(overrides.HOSTED_WAKE_ENCRYPTION_KEY).toBe("shared-wake-key");
    expect(overrides.HOSTED_WAKE_ENCRYPTION_KEY_VERSION).toBe("shared-wake-key-id");
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
        HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
        HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
        HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "60000",
        IGNORED_SECRET: "secret",
      }),
    ).toEqual([
      "--var",
      "HOSTED_WEB_BASE_URL:http://127.0.0.1:3000",
      "--var",
      "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID:callback:v1",
      "--var",
      "HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL:http://127.0.0.1:8787",
      "--var",
      "HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS:60000",
      "--var",
      "HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL:http://127.0.0.1:4010/.well-known/jwks",
    ]);
  });
});

describe("buildWranglerEnvFileText", () => {
  it("includes worker secrets and defaults the runner env profiles", () => {
    expect(
      buildWranglerEnvFileText({
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-secret",
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "60000",
        HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
        LINQ_API_TOKEN: "linq-secret",
      }),
    ).toContain('HOSTED_EXECUTION_RUNNER_ENV_PROFILES="device-sync,hosted-email,linq,mapbox,telegram"');
    expect(
      buildWranglerEnvFileText({
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-secret",
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "60000",
        HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
        LINQ_API_TOKEN: "linq-secret",
      }),
    ).toContain('HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS="60000"');
    expect(
      buildWranglerEnvFileText({
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-secret",
        HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "60000",
        HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
        LINQ_API_TOKEN: "linq-secret",
      }),
    ).toContain('LINQ_API_TOKEN="linq-secret"');
  });
});

describe("buildWranglerLocalDevConfig", () => {
  it("keeps repo-relative defaults for the checked-in local dev location", () => {
    const config = buildWranglerLocalDevConfig({});
    const container = (config.containers as { image: string; image_build_context: string }[])[0];

    expect(config.main).toBe("../src/index.ts");
    expect(container.image).toBe("../../../Dockerfile.cloudflare-hosted-runner");
    expect(container.image_build_context).toBe("..");
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
    const container = (config.containers as { image: string; image_build_context: string }[])[0];

    expect(config.main).toBe("../../workspace/apps/cloudflare/src/index.ts");
    expect(container.image).toBe("../../workspace/Dockerfile.cloudflare-hosted-runner");
    expect(container.image_build_context).toBe("../../workspace/apps/cloudflare");
  });
});
