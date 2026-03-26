import { describe, expect, it } from "vitest";

import {
  applyHostedUserEnvUpdate,
  readHostedUserEnvFromAgentStateBundle,
  writeHostedUserEnvToAgentStateBundle,
} from "../src/user-env.js";

describe("hosted user env helpers", () => {
  it("merges allowlisted keys and removes null values", () => {
    const result = applyHostedUserEnvUpdate({
      current: {
        TELEGRAM_BOT_TOKEN: "old-token",
      },
      update: {
        env: {
          OPENAI_API_KEY: "sk-user",
          TELEGRAM_BOT_TOKEN: null,
        },
        mode: "merge",
      },
    });

    expect(result).toEqual({
      OPENAI_API_KEY: "sk-user",
    });
  });

  it("rejects dangerous env names", () => {
    expect(() => applyHostedUserEnvUpdate({
      current: {},
      update: {
        env: {
          HOSTED_EXECUTION_SIGNING_SECRET: "nope",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);
  });

  it("round-trips user env config through the agent-state bundle", () => {
    const bundle = writeHostedUserEnvToAgentStateBundle({
      agentStateBundle: null,
      env: {
        OPENAI_API_KEY: "sk-user",
        TELEGRAM_BOT_TOKEN: "bot-token",
      },
      now: "2026-03-26T12:00:00.000Z",
    });

    expect(readHostedUserEnvFromAgentStateBundle(bundle)).toEqual({
      OPENAI_API_KEY: "sk-user",
      TELEGRAM_BOT_TOKEN: "bot-token",
    });
  });

  it("round-trips extension-only keys when the same allowlist source is provided on read", () => {
    const bundle = writeHostedUserEnvToAgentStateBundle({
      agentStateBundle: null,
      env: {
        CUSTOM_API_KEY: "custom-secret",
      },
      now: "2026-03-26T12:00:00.000Z",
    });

    expect(readHostedUserEnvFromAgentStateBundle(bundle, {
      HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "CUSTOM_API_KEY",
    })).toEqual({
      CUSTOM_API_KEY: "custom-secret",
    });
  });
});
