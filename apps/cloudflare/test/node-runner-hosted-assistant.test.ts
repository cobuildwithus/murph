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

  it("does not forward referenced reserved worker secrets into the runner", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "HOSTED_EXECUTION_SIGNING_SECRET",
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_SIGNING_SECRET: "signing-secret",
    });

    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBe("HOSTED_EXECUTION_SIGNING_SECRET");
    expect(env.HOSTED_EXECUTION_SIGNING_SECRET).toBeUndefined();
  });

  it("never allows per-user env overrides to shadow hosted assistant bootstrap vars", () => {
    expect(isHostedUserEnvKeyAllowed("HOSTED_ASSISTANT_PROVIDER")).toBe(false);
    expect(isHostedUserEnvKeyAllowed("HOSTED_ASSISTANT_MODEL")).toBe(false);
    expect(isHostedUserEnvKeyAllowed("OPENAI_API_KEY")).toBe(true);
  });
});
