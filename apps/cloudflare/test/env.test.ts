import { describe, expect, it } from "vitest";

import { readHostedExecutionEnvironment } from "../src/env.js";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures";

const REMOVED_BUNDLE_KEY_ALIAS = ["HB", "HOSTED", "BUNDLE", "KEY"].join("_");

describe("readHostedExecutionEnvironment", () => {
  it("reads required values and defaults", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: Buffer.alloc(32, 9).toString("base64url"),
    }));

    expect(environment.platformEnvelopeKey).toHaveLength(32);
    expect(environment.platformEnvelopeKeysById).toEqual({
      v1: environment.platformEnvelopeKey,
    });
    expect(environment.platformEnvelopeKeyId).toBe("v1");
    expect(environment.defaultAlarmDelayMs).toBe(15 * 60 * 1000);
    expect(environment.maxEventAttempts).toBe(3);
    expect(environment.retryDelayMs).toBe(30_000);
    expect(environment.runnerTimeoutMs).toBe(60_000);
    expect(environment.vercelOidcValidation.teamSlug).toBe("murph-team");
    expect(environment.webInternalSigningSecret).toBe("web-internal-secret");
  });

  it("reads the configured Vercel OIDC environment when provided", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "preview",
    }));

    expect(environment.vercelOidcValidation.environment).toBe("preview");
    expect(environment.vercelOidcValidation.subject).toContain(":environment:preview");
  });

  it("reads the runner timeout when configured", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "15000",
    }));

    expect(environment.runnerTimeoutMs).toBe(15_000);
  });

  it("reads optional user env allowlist extensions", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "OPENAI_API_KEY,TELEGRAM_BOT_TOKEN",
    }));

    expect(environment.allowedUserEnvKeys).toBe("OPENAI_API_KEY,TELEGRAM_BOT_TOKEN");
  });

  it("reads optional platform-envelope keyrings", () => {
    const previousKey = Buffer.alloc(32, 8).toString("base64");
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON: JSON.stringify({
        legacy: previousKey,
      }),
    }));

    expect(Object.keys(environment.platformEnvelopeKeysById).sort()).toEqual(["legacy", "v1"]);
    expect(environment.platformEnvelopeKeysById.legacy).toEqual(Uint8Array.from(Buffer.alloc(32, 8)));
    expect(environment.platformEnvelopeKeysById.v1).toEqual(Uint8Array.from(Buffer.alloc(32, 9)));
  });

  it("rejects malformed platform-envelope keyrings", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON: "[1,2,3]",
      })),
    ).toThrow(/must be a JSON object/u);
  });

  it("rejects platform-envelope keyrings that conflict with the active key id", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON: JSON.stringify({
          v1: Buffer.alloc(32, 7).toString("base64"),
        }),
      })),
    ).toThrow(/must match the current platform envelope key/u);
  });

  it("does not accept the removed bundle-key alias", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        [REMOVED_BUNDLE_KEY_ALIAS]: Buffer.alloc(32, 9).toString("base64"),
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: undefined,
      } as Record<string, string | undefined>)),
    ).toThrow(/HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY/u);
  });

  it("does not accept the removed Cloudflare signing-secret alias", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET: "dispatch-secret",
        HOSTED_WEB_INTERNAL_SIGNING_SECRET: undefined,
      } as Record<string, string | undefined>)),
    ).toThrow(/HOSTED_WEB_INTERNAL_SIGNING_SECRET/u);
  });
});
