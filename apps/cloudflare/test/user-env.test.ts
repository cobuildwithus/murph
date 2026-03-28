import { describe, expect, it } from "vitest";

import {
  applyHostedUserEnvUpdate,
  decodeHostedUserEnvPayload,
  encodeHostedUserEnvPayload,
} from "../src/user-env.js";

const REMOVED_HOSTED_USER_PREFIX_KEY = "HB_USER_SAMPLE_FLAG";

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

  it("accepts HOSTED_USER_ overrides but rejects the removed HB_USER_ prefix", () => {
    expect(applyHostedUserEnvUpdate({
      current: {},
      update: {
        env: {
          HOSTED_USER_SAMPLE_FLAG: "enabled",
        },
        mode: "merge",
      },
    })).toEqual({
      HOSTED_USER_SAMPLE_FLAG: "enabled",
    });

    expect(() => applyHostedUserEnvUpdate({
      current: {},
      update: {
        env: {
          [REMOVED_HOSTED_USER_PREFIX_KEY]: "enabled",
        },
        mode: "merge",
      },
    })).toThrow(/not allowed/u);
  });

  it("rejects removed AgentMail and ffmpeg alias keys", () => {
    expect(() => applyHostedUserEnvUpdate({
      current: {},
      update: {
        env: {
          AGENTMAIL_API_BASE_URL: "https://legacy-mail.example.test/v0",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedUserEnvUpdate({
      current: {},
      update: {
        env: {
          PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);
  });

  it("accepts canonical AgentMail and ffmpeg keys but rejects unknown prefixed keys", () => {
    expect(applyHostedUserEnvUpdate({
      current: {},
      update: {
        env: {
          AGENTMAIL_API_KEY: "agentmail-secret",
          AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
          FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
        },
        mode: "replace",
      },
    })).toEqual({
      AGENTMAIL_API_KEY: "agentmail-secret",
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
    });

    expect(() => applyHostedUserEnvUpdate({
      current: {},
      update: {
        env: {
          AGENTMAIL_TIMEOUT_MS: "5000",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedUserEnvUpdate({
      current: {},
      update: {
        env: {
          FFMPEG_THREADS: "2",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);
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

  it("round-trips user env config through the standalone hosted payload", () => {
    const payload = encodeHostedUserEnvPayload({
      env: {
        OPENAI_API_KEY: "sk-user",
        TELEGRAM_BOT_TOKEN: "bot-token",
      },
      now: "2026-03-26T12:00:00.000Z",
    });

    expect(decodeHostedUserEnvPayload(payload)).toEqual({
      OPENAI_API_KEY: "sk-user",
      TELEGRAM_BOT_TOKEN: "bot-token",
    });
  });

  it("round-trips extension-only keys when the same allowlist source is provided on read", () => {
    const payload = encodeHostedUserEnvPayload({
      env: {
        CUSTOM_API_KEY: "custom-secret",
      },
      now: "2026-03-26T12:00:00.000Z",
    });

    expect(decodeHostedUserEnvPayload(payload, {
      HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "CUSTOM_API_KEY",
    })).toEqual({
      CUSTOM_API_KEY: "custom-secret",
    });
  });

  it("still reads the legacy hosted user env schema", () => {
    const payload = new TextEncoder().encode(JSON.stringify({
      env: {
        OPENAI_API_KEY: "sk-user",
      },
      schema: "healthybob.hosted-user-env.v1",
      updatedAt: "2026-03-26T12:00:00.000Z",
    }));

    expect(decodeHostedUserEnvPayload(payload)).toEqual({
      OPENAI_API_KEY: "sk-user",
    });
  });
});
