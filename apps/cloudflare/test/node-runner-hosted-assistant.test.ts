import { describe, expect, it } from "vitest";

import {
  buildHostedRunnerContainerEnv,
  isHostedRunnerSecretKeyAllowed,
} from "../src/hosted-env-policy.ts";

describe("hosted assistant runner env policy", () => {
  it("forwards hosted Codex seed vars and the Vercel AI Gateway key", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_AI_USAGE_REPORTING_SECRET: "usage-reporting-secret",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
      HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      HOSTED_ASSISTANT_SANDBOX: "danger-full-access",
      VERCEL_AI_API_KEY: "secret-value",
    });

    expect(env).toMatchObject({
      HOSTED_AI_USAGE_REPORTING_SECRET: "usage-reporting-secret",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
      HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      HOSTED_ASSISTANT_SANDBOX: "danger-full-access",
      VERCEL_AI_API_KEY: "secret-value",
    });
  });

  it("does not forward legacy OpenAI-compatible hosted assistant seed vars", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      OPENAI_API_KEY: "secret-value",
    });

    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();
    expect(env.HOSTED_ASSISTANT_MODEL).toBeUndefined();
    expect(env.HOSTED_ASSISTANT_PROVIDER).toBeUndefined();
    expect(env.HOSTED_ASSISTANT_REASONING_EFFORT).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("does not forward a custom hosted assistant api key alias when explicitly referenced", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_ENTERPRISE_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      OPENAI_ENTERPRISE_API_KEY: "secret-value",
    });

    expect(env.OPENAI_ENTERPRISE_API_KEY).toBeUndefined();
  });

  it("does not forward referenced reserved worker secrets into the runner", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
    });

    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();
    expect(env.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBeUndefined();
  });

  it("never allows runner-secret overrides to shadow hosted assistant bootstrap vars", () => {
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_ASSISTANT_PROVIDER")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_ASSISTANT_MODEL")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("TELEGRAM_BOT_TOKEN")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("VERCEL_AI_API_KEY")).toBe(true);
  });
});
