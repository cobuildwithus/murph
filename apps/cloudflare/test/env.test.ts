import { describe, expect, it } from "vitest";

import {
  filterHostedRunnerSecrets,
  isHostedRunnerSecretKeyAllowed,
} from "../src/hosted-env-policy.js";
import { readHostedExecutionEnvironment } from "../src/env.js";
import { readHostedExecutionWorkerEnvironment } from "../src/hosted-execution-worker-env.js";
import { toStringEnvSource } from "../src/string-env.js";
import { normalizeHostedWebControlBaseUrl } from "../src/web-control-plane.js";
import { CLOUDFLARE_HOSTED_RUNTIME_HOSTS } from "../src/internal-hosts.js";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.js";

const REMOVED_BUNDLE_KEY_ALIAS = ["HB", "HOSTED", "BUNDLE", "KEY"].join("_");

describe("readHostedExecutionEnvironment", () => {
  it("reads required values and defaults", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv());

    expect(environment.hostedCrypto.HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM).toContain(
      "BEGIN PUBLIC KEY",
    );
    expect(environment.hostedCrypto.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID).toBe(
      "cloudflare-automation:v1",
    );
    expect(environment.hostedCrypto.HOSTED_CRYPTO_ENV).toBe("test");
    expect(environment.maxEventAttempts).toBe(3);
    expect(environment.retryDelayMs).toBe(30_000);
    expect(environment.runnerReadyTimeoutMs).toBe(20_000);
    expect(environment.runnerTimeoutMs).toBe(600_000);
    expect(environment.webControlTimeoutMs).toBe(30_000);
    expect(environment.vercelOidcValidation.teamSlug).toBe("murph-team");
    expect(environment.hostedWebBaseUrl).toBe("https://web.example.test");
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

  it("allows HTTP loopback hosted web base urls in non-production worker env", () => {
    const loopbackUrls = [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ] as const;

    for (const hostedWebBaseUrl of loopbackUrls) {
      const environment = readHostedExecutionWorkerEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: hostedWebBaseUrl,
      }));

      expect(environment.hostedWebBaseUrl).toBe(hostedWebBaseUrl);
    }
  });

  it("rejects HTTP loopback hosted web base urls in production worker env", () => {
    const productionMarkers = [
      { HOSTED_CRYPTO_ENV: "prod" },
      { HOSTED_CRYPTO_ENV: "production" },
      { NODE_ENV: "production" },
      { VERCEL_ENV: "production" },
    ] as const;
    const loopbackUrls = [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ] as const;

    for (const productionMarker of productionMarkers) {
      for (const hostedWebBaseUrl of loopbackUrls) {
        expect(() =>
          readHostedExecutionWorkerEnvironment(createHostedExecutionTestEnv({
            ...productionMarker,
            HOSTED_WEB_BASE_URL: hostedWebBaseUrl,
          })),
        ).toThrow(/HOSTED_WEB_BASE_URL must not use HTTP loopback in production/u);
      }
    }

    expect(() =>
      readHostedExecutionWorkerEnvironment(
        createHostedExecutionTestEnv({
          HOSTED_CRYPTO_ENV: "production",
          HOSTED_WEB_BASE_URL: "http://localhost:3000",
        }),
        {
          allowHostedWebHttpHosts: ["localhost"],
        },
      ),
    ).toThrow(/HOSTED_WEB_BASE_URL must not use HTTP loopback in production/u);
  });

  it("keeps the Docker bridge host limited to local child web-control normalization", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: "http://host.docker.internal:3000",
      })),
    ).toThrow(/HTTPS unless the host is explicitly allowlisted/u);

    expect(
      () => normalizeHostedWebControlBaseUrl("http://host.docker.internal:3000"),
    ).toThrow(/HTTPS unless the host is explicitly allowlisted/u);
    expect(
      normalizeHostedWebControlBaseUrl("http://host.docker.internal:3000", {
        allowHttpHosts: ["host.docker.internal"],
      }),
    ).toBe("http://host.docker.internal:3000");
    expect(() =>
      normalizeHostedWebControlBaseUrl(
        `http://${CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane}`,
      ),
    ).toThrow(/HTTPS unless the host is explicitly allowlisted/u);
    expect(
      normalizeHostedWebControlBaseUrl(
        `http://${CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane}`,
        {
          allowHttpHosts: [CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane],
        },
      ),
    ).toBe(`http://${CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane}`);
    expect(
      readHostedExecutionWorkerEnvironment(
        createHostedExecutionTestEnv({
          HOSTED_WEB_BASE_URL: "http://host.docker.internal:3000",
        }),
        {
          allowHostedWebHttpHosts: ["host.docker.internal"],
        },
      ).hostedWebBaseUrl,
    ).toBe("http://host.docker.internal:3000");
  });

  it("allows the Docker bridge hosted web base url only in local proxy mode", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      ALLOW_LOCAL_INTERNAL_PROXY: "true",
      HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://host.docker.internal:8787",
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
      HOSTED_WEB_BASE_URL: "http://host.docker.internal:3000",
    }));

    expect(environment.hostedWebAllowHttpHosts).toEqual(["host.docker.internal"]);
    expect(environment.hostedWebBaseUrl).toBe("http://host.docker.internal:3000");
  });

  it("rejects local proxy HTTP hosted web base urls in production", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        ALLOW_LOCAL_INTERNAL_PROXY: "true",
        HOSTED_CRYPTO_ENV: "production",
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://host.docker.internal:8787",
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
        HOSTED_WEB_BASE_URL: "http://host.docker.internal:3000",
      })),
    ).toThrow(/HOSTED_WEB_BASE_URL must not use HTTP in production/u);

    expect(() =>
      readHostedExecutionWorkerEnvironment(
        createHostedExecutionTestEnv({
          HOSTED_CRYPTO_ENV: "production",
          HOSTED_WEB_BASE_URL: "http://host.docker.internal:3000",
        }),
        {
          allowHostedWebHttpHosts: ["host.docker.internal"],
        },
      ),
    ).toThrow(/HOSTED_WEB_BASE_URL must not use HTTP in production/u);
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

  it("keeps the hosted-web control timeout separate from the runner timeout", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "600000",
      HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "45000",
    }));

    expect(environment.runnerTimeoutMs).toBe(600_000);
    expect(environment.webControlTimeoutMs).toBe(45_000);
  });

  it("reads the runner readiness timeout when configured", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "45000",
    }));

    expect(environment.runnerReadyTimeoutMs).toBe(45_000);
  });

  it("allows idle-shutdown checkpoint safety margin to be zero", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_IDLE_SHUTDOWN_CHECKPOINT_SAFETY_MARGIN_MS: "0",
    }));

    expect(environment.idleShutdownCheckpointSafetyMarginMs).toBe(0);
  });

  it("reads optional runner-secret allowlist extensions", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "OPENAI_API_KEY,CUSTOM_API_KEY",
    }));

    expect(environment.allowedRunnerSecretKeys).toBe("OPENAI_API_KEY,CUSTOM_API_KEY");
  });

  it("hard-fails when the local internal proxy is configured outside development", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        ALLOW_LOCAL_INTERNAL_PROXY: "true",
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:8787",
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "production",
      })),
    ).toThrow(
      "HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL and ALLOW_LOCAL_INTERNAL_PROXY are only supported when HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=development.",
    );
  });

  it("rejects a missing hosted crypto authority public key", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: undefined,
      })),
    ).toThrow(/HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM is required/u);
  });

  it("rejects a missing Cloudflare automation private key", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: undefined,
      })),
    ).toThrow(/HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK is required/u);
  });

  it("rejects a missing hosted crypto environment", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_CRYPTO_ENV: undefined,
      })),
    ).toThrow(/HOSTED_CRYPTO_ENV is required/u);
  });

  it("rejects a missing hosted web base url", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: undefined,
      })),
    ).toThrow(/HOSTED_WEB_BASE_URL must be a valid absolute URL/u);
  });

  it("does not accept the removed bundle-key alias", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        [REMOVED_BUNDLE_KEY_ALIAS]: Buffer.alloc(32, 9).toString("base64"),
      } as Record<string, string | undefined>)),
    ).not.toThrow();
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
      OPENAI_API_KEY: "openai-secret",
      PORT: 8787,
    })).toEqual({
      BUNDLES: undefined,
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "OPENAI_API_KEY",
      OPENAI_API_KEY: "openai-secret",
      PORT: undefined,
    });
  });
});

describe("hosted runner secrets policy", () => {
  it("keeps parser executable selectors operator-only", () => {
    expect(isHostedRunnerSecretKeyAllowed("OPENAI_API_KEY")).toBe(false);

    expect(isHostedRunnerSecretKeyAllowed("FFMPEG_COMMAND")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("PDFTOTEXT_COMMAND")).toBe(false);
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
        "PDFTOTEXT_COMMAND",
        "HOSTED_AI_USAGE_REPORTING_SECRET",
        "HOSTED_LOG_FINGERPRINT_SECRET",
        "WHISPER_COMMAND",
        "NODE_OPTIONS",
      ].join(","),
    };

    expect(isHostedRunnerSecretKeyAllowed("FFMPEG_COMMAND", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("PDFTOTEXT_COMMAND", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_AI_USAGE_REPORTING_SECRET", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_LOG_FINGERPRINT_SECRET", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("WHISPER_COMMAND", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("NODE_OPTIONS", source)).toBe(false);
  });

  it("filters operator-only keys out of runner secrets before execution", () => {
    expect(filterHostedRunnerSecrets({
      FFMPEG_COMMAND: "/tmp/evil-ffmpeg",
      PDFTOTEXT_COMMAND: "/tmp/evil-pdftotext",
      HOSTED_AI_USAGE_REPORTING_SECRET: "usage-reporting-secret",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
      NODE_OPTIONS: "--require /tmp/evil-loader.js",
      OPENAI_API_KEY: "sk-test",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      WHISPER_COMMAND: "/tmp/evil-whisper",
    })).toEqual({});
  });
});
