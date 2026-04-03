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

  it("does not forward referenced reserved worker secrets into the runner", () => {
    const env = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_API_KEY_ENV: "HOSTED_EXECUTION_CONTROL_TOKEN",
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });

    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBe("HOSTED_EXECUTION_CONTROL_TOKEN");
    expect(env.HOSTED_EXECUTION_CONTROL_TOKEN).toBeUndefined();
  });

  it("never allows per-user env overrides to shadow hosted assistant bootstrap vars", () => {
    expect(isHostedUserEnvKeyAllowed("HOSTED_ASSISTANT_PROVIDER")).toBe(false);
    expect(isHostedUserEnvKeyAllowed("HOSTED_ASSISTANT_MODEL")).toBe(false);
    expect(isHostedUserEnvKeyAllowed("OPENAI_API_KEY")).toBe(true);
  });
});
