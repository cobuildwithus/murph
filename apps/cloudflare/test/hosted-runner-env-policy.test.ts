import { describe, expect, it } from "vitest";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";

import {
  buildHostedRunnerContainerEnv,
  isHostedRunnerSecretKeyAllowed,
} from "../src/hosted-env-policy.ts";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../src/runner-egress-intercept.ts";

describe("hosted assistant runner env policy", () => {
  it("forwards hosted Codex seed vars and sentinel OpenAI config without platform secrets", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_AI_USAGE_REPORTING_SECRET: "usage-reporting-secret",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "provider-egress-signing-secret",
      HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      HOSTED_ASSISTANT_SANDBOX: "danger-full-access",
      ELEVENLABS_API_KEY: "elevenlabs-secret",
      MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      MURPH_ELEVENLABS_VOICE_ID: "voice_murph",
      OPENAI_API_KEY: "secret-value",
    });

    expect(env).toMatchObject({
      HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      HOSTED_ASSISTANT_SANDBOX: "danger-full-access",
      ELEVENLABS_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      MURPH_ELEVENLABS_VOICE_ID: "voice_murph",
      OPENAI_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
    });
    expect(env.HOSTED_AI_USAGE_REPORTING_SECRET).toBeUndefined();
    expect(env.HOSTED_LOG_FINGERPRINT_SECRET).toBeUndefined();
    expect(env.HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET).toBeUndefined();
  });

  it("does not forward unsupported hosted assistant api key alias vars", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "PROVIDER_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      PROVIDER_API_KEY: "secret-value",
    });

    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();
    expect(env.HOSTED_ASSISTANT_MODEL).toBe("gpt-5.6-terra");
    expect(env.HOSTED_ASSISTANT_PROVIDER).toBe("openai");
    expect(env.HOSTED_ASSISTANT_REASONING_EFFORT).toBe("medium");
    expect(env.PROVIDER_API_KEY).toBeUndefined();
  });

  it("does not forward the image-owned hosted Codex model catalog path", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]:
        "/tmp/stale-forwarded-catalog.json",
      OPENAI_API_KEY: "secret-value",
    });

    expect(env[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]).toBeUndefined();
  });

  it("does not forward a custom hosted assistant api key alias when explicitly referenced", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_ENTERPRISE_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_ENTERPRISE_API_KEY: "secret-value",
    });

    expect(env.OPENAI_ENTERPRISE_API_KEY).toBeUndefined();
  });

  it("does not forward referenced reserved worker secrets into the runner", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
    });

    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();
    expect(env.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBeUndefined();
  });

  it("never allows runner-secret overrides to shadow hosted assistant bootstrap vars", () => {
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_ASSISTANT_PROVIDER")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HOSTED_ASSISTANT_MODEL")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed(HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed(HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("TELEGRAM_BOT_TOKEN")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("ELEVENLABS_API_KEY")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("XAI_API_KEY")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("GEMINI_API_KEY")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("OPENAI_API_KEY")).toBe(false);
  });
});
