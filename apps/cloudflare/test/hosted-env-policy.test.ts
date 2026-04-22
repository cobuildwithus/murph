import { describe, expect, it } from "vitest";

import {
  HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
  isHostedAssistantApiKeyEnvName,
} from "@murphai/assistant-runtime/hosted-assistant-env";

import { buildHostedWorkerSecretsPayload } from "../scripts/deploy-automation/secrets.ts";
import {
  buildHostedRunnerContainerEnv,
  summarizeHostedRunnerForwardedEnvLogCategories,
  summarizeHostedRunnerSecretLogCategories,
} from "../src/hosted-env-policy.ts";

const requiredWorkerSecrets = {
  HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: "automation-private",
  HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: "automation-public",
  HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-envelope",
  HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK: "recovery-public",
  HOSTED_WAKE_ENCRYPTION_KEY: "hosted-ingress-encryption",
  HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "webhook-private",
} satisfies Record<string, string>;

describe("buildHostedRunnerContainerEnv", () => {
  it("forwards only explicit assistant provider env names", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "STRIPE_SECRET_KEY",
      OPENAI_API_KEY: "openai-secret",
      STRIPE_SECRET_KEY: "stripe-secret",
    });

    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBe("STRIPE_SECRET_KEY");
    expect(env.OPENAI_API_KEY).toBe("openai-secret");
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("includes shared allowed hosted assistant api key env names", () => {
    const env = buildHostedRunnerContainerEnv({
      VERCEL_AI_API_KEY: "vercel-secret",
    });

    expect(env.VERCEL_AI_API_KEY).toBe("vercel-secret");
  });

  it("forwards the delegated billing restricted Stripe key only through the assistant env profile", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: "rk_test_123",
      HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: "true",
    });

    expect(env.HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY).toBe("rk_test_123");
    expect(env.HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED).toBe("true");
  });
});

describe("hosted runner log categories", () => {
  it("preserves the forwarded env category summaries used by runner logging", () => {
    expect(summarizeHostedRunnerForwardedEnvLogCategories({
      MURPH_WEB_SEARCH_TIMEOUT_MS: "5000",
      OPENAI_API_KEY: "openai-secret",
      TELEGRAM_BOT_TOKEN: "telegram-secret",
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
      OPENAI_API_KEY: "openai-secret",
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
    expect(isHostedAssistantApiKeyEnvName("OPENAI_API_KEY")).toBe(true);
    expect(isHostedAssistantApiKeyEnvName("STRIPE_SECRET_KEY")).toBe(false);
    expect(HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES).toContain("VERCEL_AI_API_KEY");
  });
});
