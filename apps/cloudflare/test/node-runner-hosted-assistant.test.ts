import { describe, expect, it } from "vitest";

import {
  buildHostedRunnerContainerEnv,
  isHostedUserEnvKeyAllowed,
} from "../src/hosted-env-policy.ts";

describe("hosted assistant runner env policy", () => {
  it("forwards hosted assistant seed vars and the referenced api key", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "secret-value",
    });

    expect(env).toMatchObject({
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "secret-value",
    });
  });

  it("forwards Venice hosted assistant seed vars and the referenced api key", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "VENICE_API_KEY",
      HOSTED_ASSISTANT_MODEL: "openai-gpt-54",
      HOSTED_ASSISTANT_PROVIDER: "venice",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      VENICE_API_KEY: "secret-value",
    });

    expect(env).toMatchObject({
      HOSTED_ASSISTANT_API_KEY_ENV: "VENICE_API_KEY",
      HOSTED_ASSISTANT_MODEL: "openai-gpt-54",
      HOSTED_ASSISTANT_PROVIDER: "venice",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      VENICE_API_KEY: "secret-value",
    });
  });

  it("forwards a custom hosted assistant api key alias when explicitly referenced", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_ENTERPRISE_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_ENTERPRISE_API_KEY: "secret-value",
    });

    expect(env).toMatchObject({
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_ENTERPRISE_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_ENTERPRISE_API_KEY: "secret-value",
    });
  });

  it("forwards Vercel AI Gateway bootstrap vars and gateway key aliases", () => {
    const env = buildHostedRunnerContainerEnv({
      AI_GATEWAY_API_KEY: "gateway-secret",
      HOSTED_ASSISTANT_API_KEY_ENV: "AI_GATEWAY_API_KEY",
      HOSTED_ASSISTANT_MODEL: "openai/gpt-5.4",
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      HOSTED_ASSISTANT_ZERO_DATA_RETENTION: "true",
    });

    expect(env).toMatchObject({
      AI_GATEWAY_API_KEY: "gateway-secret",
      HOSTED_ASSISTANT_API_KEY_ENV: "AI_GATEWAY_API_KEY",
      HOSTED_ASSISTANT_MODEL: "openai/gpt-5.4",
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      HOSTED_ASSISTANT_ZERO_DATA_RETENTION: "true",
    });
  });

  it("does not forward referenced reserved worker secrets into the runner", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
    });

    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBe("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK");
    expect(env.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBeUndefined();
  });

  it("never allows per-user env overrides to shadow hosted assistant bootstrap vars", () => {
    expect(isHostedUserEnvKeyAllowed("HOSTED_ASSISTANT_PROVIDER")).toBe(false);
    expect(isHostedUserEnvKeyAllowed("HOSTED_ASSISTANT_MODEL")).toBe(false);
    expect(isHostedUserEnvKeyAllowed("OPENAI_API_KEY")).toBe(true);
    expect(isHostedUserEnvKeyAllowed("AI_GATEWAY_API_KEY")).toBe(true);
    expect(isHostedUserEnvKeyAllowed("VERCEL_AI_API_KEY")).toBe(true);
  });
});
