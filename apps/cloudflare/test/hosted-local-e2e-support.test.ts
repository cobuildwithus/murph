import { describe, expect, it } from "vitest";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import {
  HOSTED_LOCAL_ASSISTANT_STUB_CLEARED_ENV_KEYS,
  mergeRequiredEnvProfile,
  resolveHostedAssistantLocalDevEnv,
} from "./helpers/hosted-local-e2e-support.js";

describe("mergeRequiredEnvProfile", () => {
  it("preserves the default hosted runner profiles when adding a required channel profile", () => {
    expect(mergeRequiredEnvProfile(undefined, "linq")).toBe("assistant,parsers,linq");
  });

  it("adds the required profile without duplicating existing entries", () => {
    expect(mergeRequiredEnvProfile("assistant,linq", "linq")).toBe("assistant,linq");
  });
});

describe("resolveHostedAssistantLocalDevEnv", () => {
  it("seeds Codex Vercel AI Gateway config in local stub mode", () => {
    const env = resolveHostedAssistantLocalDevEnv(
      {
        HOSTED_ASSISTANT_BASE_URL: "https://legacy-provider.example.test/v1",
        HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "12345",
        OPENAI_API_KEY: "live-openai-key",
      },
      "stub",
      "http://127.0.0.1:1234/v1",
      "Hosted local test",
    );

    expect(env).toMatchObject({
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "12345",
      [HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV]: "http://127.0.0.1:1234/v1",
      NODE_ENV: "test",
      VERCEL_AI_API_KEY: "stub-local-vercel-ai-gateway-key",
    });
    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();
    expect(env.HOSTED_ASSISTANT_BASE_URL).toBeUndefined();
    expect(env.HOSTED_ASSISTANT_PROVIDER_NAME).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("clears direct provider keys from local stub mode", () => {
    const source = Object.fromEntries(
      HOSTED_LOCAL_ASSISTANT_STUB_CLEARED_ENV_KEYS.map((key) => [key, `${key}-value`]),
    );
    const env = resolveHostedAssistantLocalDevEnv(
      source,
      "stub",
      "http://127.0.0.1:1234/v1",
      "Hosted local test",
    );

    for (const key of HOSTED_LOCAL_ASSISTANT_STUB_CLEARED_ENV_KEYS) {
      expect(env[key]).toBeUndefined();
    }
    expect(env.VERCEL_AI_API_KEY).toBe("stub-local-vercel-ai-gateway-key");
  });

  it("fails closed in live mode without explicit hosted assistant provider and model", () => {
    expect(() =>
      resolveHostedAssistantLocalDevEnv(
        {},
        "live",
        null,
        "Hosted local test",
      )
    ).toThrow(
      "Hosted local test requires explicit hosted assistant config in live mode.",
    );
  });
});
