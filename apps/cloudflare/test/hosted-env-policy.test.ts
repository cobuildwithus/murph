import { describe, expect, it } from "vitest";

import {
  HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
  isHostedAssistantApiKeyEnvName,
} from "@murphai/assistant-runtime/hosted-assistant-env";
import {
  HOSTED_AI_USAGE_BILLING_MODE_ENV,
} from "@murphai/hosted-execution";

import { buildHostedWorkerSecretsPayload } from "../scripts/deploy-automation/secrets.ts";
import {
  buildHostedRunnerContainerEnv,
  isHostedRunnerSecretKeyAllowed,
  summarizeHostedRunnerForwardedEnvLogCategories,
  summarizeHostedRunnerSecretLogCategories,
} from "../src/hosted-env-policy.ts";

const requiredWorkerSecrets = {
  HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: "automation-private",
  HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: "automation-public",
  HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-envelope",
  HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK: "recovery-public",
  HOSTED_WAKE_ENCRYPTION_KEY: "hosted-mailbox-encryption",
  HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "webhook-private",
} satisfies Record<string, string>;

describe("buildHostedRunnerContainerEnv", () => {
  it("does not forward legacy assistant api key selectors or unrelated referenced secrets", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "STRIPE_SECRET_KEY",
      VERCEL_AI_API_KEY: "vercel-secret",
      STRIPE_SECRET_KEY: "stripe-secret",
    });

    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();
    expect(env.VERCEL_AI_API_KEY).toBe("vercel-secret");
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("includes shared allowed hosted assistant api key env names", () => {
    const env = buildHostedRunnerContainerEnv({
      VERCEL_AI_API_KEY: "vercel-secret",
    });

    expect(env.VERCEL_AI_API_KEY).toBe("vercel-secret");
  });

  it("forwards delegated billing config only through the assistant env profile", () => {
    const env = buildHostedRunnerContainerEnv({
      [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "stripe_meter",
      HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: "rk_test_123",
      HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: "true",
    });

    expect(env[HOSTED_AI_USAGE_BILLING_MODE_ENV]).toBe("stripe_meter");
    expect(env.HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY).toBe("rk_test_123");
    expect(env.HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED).toBe("true");
  });

  it("does not allow runner secrets to override the platform billing mode", () => {
    expect(isHostedRunnerSecretKeyAllowed(
      HOSTED_AI_USAGE_BILLING_MODE_ENV,
      {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: HOSTED_AI_USAGE_BILLING_MODE_ENV,
      },
    )).toBe(false);
  });

  it("does not allow runner secrets to override hosted control-plane prefixes", () => {
    const source = {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: [
        "HOSTED_WAKE_ENCRYPTION_KEY_VERSION",
        "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID",
      ].join(","),
    };

    expect(isHostedRunnerSecretKeyAllowed(
      "HOSTED_WAKE_ENCRYPTION_KEY_VERSION",
      source,
    )).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed(
      "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID",
      source,
    )).toBe(false);
  });
});

describe("hosted runner log categories", () => {
  it("preserves the forwarded env category summaries used by runner logging", () => {
    expect(summarizeHostedRunnerForwardedEnvLogCategories({
      TELEGRAM_BOT_USERNAME: "murph_bot",
      MURPH_WEB_SEARCH_TIMEOUT_MS: "5000",
      VERCEL_AI_API_KEY: "vercel-secret",
    })).toEqual({
      assistantConfigured: true,
      hostedEmailConfigured: false,
      linqConfigured: false,
      parserToolingConfigured: false,
      telegramConfigured: true,
      webSearchConfigured: false,
    });
  });

  it("preserves the runner secret category summaries used by runner logging", () => {
    expect(summarizeHostedRunnerSecretLogCategories({
      CUSTOM_API_KEY: "custom-secret",
      VERCEL_AI_API_KEY: "vercel-secret",
    })).toEqual({
      modelCredentialConfigured: true,
    });
  });
});

describe("buildHostedWorkerSecretsPayload", () => {
  it("keeps assistant provider secrets in sync with the shared allowlist", () => {
    const payload = buildHostedWorkerSecretsPayload({
      ...requiredWorkerSecrets,
      OLLAMA_API_KEY: "ollama-secret",
      VERCEL_AI_API_KEY: "vercel-secret",
    });

    expect(payload.OLLAMA_API_KEY).toBe("ollama-secret");
    expect(payload.VERCEL_AI_API_KEY).toBe("vercel-secret");
  });

  it("does not include unrelated referenced secrets", () => {
    const payload = buildHostedWorkerSecretsPayload({
      ...requiredWorkerSecrets,
      HOSTED_ASSISTANT_API_KEY_ENV: "STRIPE_SECRET_KEY",
      STRIPE_SECRET_KEY: "stripe-secret",
    });

    expect(payload.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("includes the delegated billing restricted Stripe key in the worker secret payload", () => {
    const payload = buildHostedWorkerSecretsPayload({
      ...requiredWorkerSecrets,
      HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: "rk_test_123",
    });

    expect(payload.HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY).toBe("rk_test_123");
  });
});

describe("isHostedAssistantApiKeyEnvName", () => {
  it("accepts only the shared hosted assistant provider env names", () => {
    expect(isHostedAssistantApiKeyEnvName("VERCEL_AI_API_KEY")).toBe(true);
    expect(isHostedAssistantApiKeyEnvName("STRIPE_SECRET_KEY")).toBe(false);
    expect(HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES).toContain("VERCEL_AI_API_KEY");
  });
});
