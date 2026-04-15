import { describe, expect, it } from "vitest";

import {
  assertLocalWorkerOidcEnvironment,
  buildHostedLocalDevOverrides,
  buildWranglerEnvFileText,
  buildWranglerVarArgs,
  mergeCloudflareLocalEnv,
  parseEnvText,
} from "./environment.ts";
import type {
  HostedExecutionOidcIdentity,
  HostedLocalDevConfig,
} from "./types.ts";

const localConfig: HostedLocalDevConfig = {
  skipPrismaMigrate: false,
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
});

describe("mergeCloudflareLocalEnv", () => {
  it("fills the local worker env contract from existing values and generated defaults", () => {
    const merged = mergeCloudflareLocalEnv({
      config: localConfig,
      existing: {
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
    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG).toBe("murph");
    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME).toBe("murph-web");
    expect(merged.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT).toBe("development");
    expect(merged.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBe(callbackPrivateJwkJson);
    expect(merged.HOSTED_WEB_BASE_URL).toBe("http://127.0.0.1:3000");
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
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
    });

    expect(overrides).toMatchObject({
      HOSTED_EXECUTION_DISPATCH_URL: "http://127.0.0.1:8787",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "http://127.0.0.1:3000",
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
});

describe("buildWranglerVarArgs", () => {
  it("emits only allowlisted non-empty values", () => {
    expect(
      buildWranglerVarArgs({
        HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
        HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
        IGNORED_SECRET: "secret",
      }),
    ).toEqual([
      "--var",
      "HOSTED_WEB_BASE_URL:http://127.0.0.1:3000",
      "--var",
      "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID:callback:v1",
    ]);
  });
});

describe("buildWranglerEnvFileText", () => {
  it("includes worker secrets and defaults the runner env profiles", () => {
    expect(
      buildWranglerEnvFileText({
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-secret",
        HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
        LINQ_API_TOKEN: "linq-secret",
      }),
    ).toContain('HOSTED_EXECUTION_RUNNER_ENV_PROFILES="device-sync,hosted-email,linq,mapbox,telegram"');
    expect(
      buildWranglerEnvFileText({
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-secret",
        HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
        LINQ_API_TOKEN: "linq-secret",
      }),
    ).toContain('LINQ_API_TOKEN="linq-secret"');
  });
});
