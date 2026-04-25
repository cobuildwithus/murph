import { describe, expect, it } from "vitest";

import {
  filterHostedRunnerSecrets,
  isHostedRunnerSecretKeyAllowed,
} from "../src/hosted-env-policy.js";
import { readHostedExecutionEnvironment } from "../src/env.js";
import { toStringEnvSource } from "../src/string-env.js";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.js";

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
    expect(environment.maxEventAttempts).toBe(3);
    expect(environment.retryDelayMs).toBe(30_000);
    expect(environment.runnerReadyTimeoutMs).toBe(20_000);
    expect(environment.runnerTimeoutMs).toBe(60_000);
    expect(environment.vercelOidcValidation.teamSlug).toBe("murph-team");
    expect(environment.hostedWebBaseUrl).toBe("https://web.example.test");
    expect(environment.hostedIngressEncryption.keyVersion).toBe("v1");
    expect(environment.hostedIngressEncryption.key).toHaveLength(32);
    expect(environment.webCallbackSigning.keyId).toBe("v1");
    expect(environment.webCallbackSigning.privateKeyJwkJson).toContain("\"kty\":\"EC\"");
  });

  it("normalizes a scheme-less hosted web base url in worker env", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "web.example.test",
    }));

    expect(environment.hostedWebBaseUrl).toBe("https://web.example.test");
  });

  it("accepts a bracketed IPv6 localhost hosted web base url in worker env", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "http://[::1]:3000",
    }));

    expect(environment.hostedWebBaseUrl).toBe("http://[::1]:3000");
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

  it("reads the runner readiness timeout when configured", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "45000",
    }));

    expect(environment.runnerReadyTimeoutMs).toBe(45_000);
  });

  it("reads optional runner-secret allowlist extensions", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "OPENAI_API_KEY,CUSTOM_API_KEY",
    }));

    expect(environment.allowedRunnerSecretKeys).toBe("OPENAI_API_KEY,CUSTOM_API_KEY");
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

  it("rejects platform-envelope keys that are not exactly 32 bytes", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: Buffer.alloc(16, 9).toString("base64url"),
      })),
    ).toThrow(/valid 32-byte base64 or base64url values/u);
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

  it("rejects a missing hosted web base url", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: undefined,
      })),
    ).toThrow(/HOSTED_WEB_BASE_URL must be a valid absolute URL/u);
  });

  it("rejects a missing hosted wake encryption key", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WAKE_ENCRYPTION_KEY: undefined,
      })),
    ).toThrow(/HOSTED_WAKE_ENCRYPTION_KEY is required/u);
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
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: undefined,
      } as Record<string, string | undefined>)),
    ).toThrow(/HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK/u);
  });

  it("drops non-string worker bindings before config readers consume env", () => {
    expect(toStringEnvSource({
      BUNDLES: { fetch() {} },
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "OPENAI_API_KEY",
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: Buffer.alloc(32, 9).toString("base64url"),
      OPENAI_API_KEY: "openai-secret",
      PORT: 8787,
    })).toEqual({
      BUNDLES: undefined,
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "OPENAI_API_KEY",
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: Buffer.alloc(32, 9).toString("base64url"),
      OPENAI_API_KEY: "openai-secret",
      PORT: undefined,
    });
  });
});

describe("hosted runner secrets policy", () => {
  it("keeps parser executable selectors operator-only", () => {
    expect(isHostedRunnerSecretKeyAllowed("OPENAI_API_KEY")).toBe(true);

    expect(isHostedRunnerSecretKeyAllowed("FFMPEG_COMMAND")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_AI_USAGE_REPORTING_SECRET")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_LOG_FINGERPRINT_SECRET")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("TELEGRAM_BOT_TOKEN")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("WHISPER_COMMAND")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("WHISPER_MODEL_PATH")).toBe(false);
  });

  it("does not let the custom allowlist re-enable operator-only or process-control keys", () => {
    const source = {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: [
        "FFMPEG_COMMAND",
        "HOSTED_AI_USAGE_REPORTING_SECRET",
        "HOSTED_LOG_FINGERPRINT_SECRET",
        "WHISPER_COMMAND",
        "NODE_OPTIONS",
      ].join(","),
    };

    expect(isHostedRunnerSecretKeyAllowed("FFMPEG_COMMAND", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_AI_USAGE_REPORTING_SECRET", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_LOG_FINGERPRINT_SECRET", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("WHISPER_COMMAND", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("NODE_OPTIONS", source)).toBe(false);
  });

  it("filters operator-only keys out of runner secrets before execution", () => {
    expect(filterHostedRunnerSecrets({
      FFMPEG_COMMAND: "/tmp/evil-ffmpeg",
      HOSTED_AI_USAGE_REPORTING_SECRET: "usage-reporting-secret",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
      NODE_OPTIONS: "--require /tmp/evil-loader.js",
      OPENAI_API_KEY: "sk-test",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      WHISPER_COMMAND: "/tmp/evil-whisper",
    })).toEqual({
      OPENAI_API_KEY: "sk-test",
    });
  });
});
