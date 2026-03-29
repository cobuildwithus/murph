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
        OPENAI_API_KEY: "old-key",
      },
      update: {
        env: {
          OPENAI_API_KEY: null,
          XAI_API_KEY: "xai-user",
        },
        mode: "merge",
      },
    });

    expect(result).toEqual({
      XAI_API_KEY: "xai-user",
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

  it("accepts canonical model and parser keys but rejects removed integration keys", () => {
    expect(applyHostedUserEnvUpdate({
      current: {},
      update: {
        env: {
          FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
          OPENAI_API_KEY: "sk-user",
          VENICE_API_KEY: "venice-user",
          XAI_API_KEY: "xai-user",
        },
        mode: "replace",
      },
    })).toEqual({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      OPENAI_API_KEY: "sk-user",
      VENICE_API_KEY: "venice-user",
      XAI_API_KEY: "xai-user",
    });

    expect(() => applyHostedUserEnvUpdate({
      current: {},
      update: {
        env: {
          AGENTMAIL_API_KEY: "agentmail-secret",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedUserEnvUpdate({
      current: {},
      update: {
        env: {
          TELEGRAM_BOT_TOKEN: "bot-token",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

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
        XAI_API_KEY: "xai-user",
      },
      now: "2026-03-26T12:00:00.000Z",
    });

    expect(decodeHostedUserEnvPayload(payload)).toEqual({
      OPENAI_API_KEY: "sk-user",
      XAI_API_KEY: "xai-user",
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

});
