import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS,
} from "@murphai/hosted-execution/contracts";
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
    expect(environment.idleCheckpointDelayMs).toBe(180_000);
    expect(environment.retryDelayMs).toBe(30_000);
    expect(environment.runnerCommitTimeoutMs).toBe(45_000);
    expect(environment.runnerReadyTimeoutMs).toBe(90_000);
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

  it("rejects HTTP hosted web base urls in production", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_CRYPTO_ENV: "production",
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
        HOSTED_WEB_BASE_URL: "http://host.docker.internal:3000",
      })),
    ).toThrow(/Hosted execution base URLs must use HTTPS/u);

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

  it("rejects a production idle checkpoint delay below 180 seconds", () => {
    expect(() =>
      readHostedExecutionWorkerEnvironment(createHostedExecutionTestEnv({
        HOSTED_CRYPTO_ENV: "production",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "179999",
      })),
    ).toThrow(
      /HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS must be at least 180000 in production/u,
    );

    expect(
      readHostedExecutionWorkerEnvironment(createHostedExecutionTestEnv({
        HOSTED_CRYPTO_ENV: "production",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "180000",
      })).idleCheckpointDelayMs,
    ).toBe(180_000);
  });

  it("reads the configured Vercel OIDC environment when provided", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "preview",
    }));

    expect(environment.vercelOidcValidation.environment).toBe("preview");
    expect(environment.vercelOidcValidation.subject).toContain(":environment:preview");
  });

  it("keeps the runner commit timeout outside the hosted-web control timeout", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "30000",
    }));

    expect(environment.runnerCommitTimeoutMs).toBe(45_000);
    expect(environment.webControlTimeoutMs).toBe(30_000);
  });

  it("rejects runner commit timeouts that do not contain the web-control request", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "30000",
        HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "30000",
      })),
    ).toThrow(
      "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS must be at least 5000ms greater than HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS.",
    );
  });

  it("rejects hosted-web control timeouts that cannot leave the response margin", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: String(
          HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS,
        ),
      })),
    ).toThrow(
      `HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS must be greater than ${HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS}.`,
    );
  });

  it("reads the runner readiness timeout when configured", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "45000",
    }));

    expect(environment.runnerReadyTimeoutMs).toBe(45_000);
  });

  it("rejects partial numeric Worker timing environment values", () => {
    const invalidTimingValues = {
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "180000abc",
      HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS: "3abc",
      HOSTED_EXECUTION_RETRY_DELAY_MS: "30000abc",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "30000abc",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000abc",
      HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000abc",
      HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "20000abc",
      HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "30000abc",
    } as const;

    for (const [key, value] of Object.entries(invalidTimingValues)) {
      expect(() =>
        readHostedExecutionWorkerEnvironment(createHostedExecutionTestEnv({
          [key]: value,
        })),
      ).toThrow(`${key} must be a positive integer.`);
    }
  });

  it("defaults the runner idle lifecycle to five minutes", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv());

    expect(environment.runnerIdleTtlMs).toBe(300_000);
    expect(environment.runnerLifecycleReevaluationMs).toBe(300_000);
  });

  it("reads an independent runner lifecycle reevaluation cadence", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1200000",
      HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
    }));

    expect(environment.runnerIdleTtlMs).toBe(1_200_000);
    expect(environment.runnerLifecycleReevaluationMs).toBe(60_000);
  });

  it("reads optional runner-secret allowlist extensions", () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "OPENAI_API_KEY,CUSTOM_API_KEY",
    }));

    expect(environment.allowedRunnerSecretKeys).toBe("OPENAI_API_KEY,CUSTOM_API_KEY");
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
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_CONTAINER_DEBUG_SECRET")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_AI_USAGE_REPORTING_SECRET")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_LOG_FINGERPRINT_SECRET")).toBe(false);
    expect(
      isHostedRunnerSecretKeyAllowed("HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET"),
    ).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("TELEGRAM_BOT_TOKEN")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("WHISPER_COMMAND")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("WHISPER_MODEL_PATH")).toBe(false);
  });

  it("does not let the custom allowlist re-enable operator-only or process-control keys", () => {
    const source = {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: [
        "FFMPEG_COMMAND",
        "PDFTOTEXT_COMMAND",
        "HOSTED_CONTAINER_DEBUG_SECRET",
        "HOSTED_AI_USAGE_REPORTING_SECRET",
        "HOSTED_LOG_FINGERPRINT_SECRET",
        "HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET",
        "WHISPER_COMMAND",
        "NODE_OPTIONS",
      ].join(","),
    };

    expect(isHostedRunnerSecretKeyAllowed("FFMPEG_COMMAND", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("PDFTOTEXT_COMMAND", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_CONTAINER_DEBUG_SECRET", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_AI_USAGE_REPORTING_SECRET", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_LOG_FINGERPRINT_SECRET", source)).toBe(false);
    expect(
      isHostedRunnerSecretKeyAllowed("HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET", source),
    ).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("WHISPER_COMMAND", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("NODE_OPTIONS", source)).toBe(false);
  });

  it("filters operator-only keys out of runner secrets before execution", () => {
    expect(filterHostedRunnerSecrets({
      FFMPEG_COMMAND: "/tmp/evil-ffmpeg",
      PDFTOTEXT_COMMAND: "/tmp/evil-pdftotext",
      HOSTED_CONTAINER_DEBUG_SECRET: "container-debug-secret",
      HOSTED_AI_USAGE_REPORTING_SECRET: "usage-reporting-secret",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "provider-egress-signing-secret",
      NODE_OPTIONS: "--require /tmp/evil-loader.js",
      OPENAI_API_KEY: "sk-test",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      WHISPER_COMMAND: "/tmp/evil-whisper",
    })).toEqual({});
  });
});
