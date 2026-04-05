import { describe, expect, it } from "vitest";

import {
  applyHostedUserEnvUpdate,
  decodeHostedUserEnvPayload,
  encodeHostedUserEnvPayload,
  parseHostedUserEnvUpdate,
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

  it("accepts explicitly allowlisted keys but rejects removed or prefix-only keys", () => {
    expect(applyHostedUserEnvUpdate({
      current: {},
      source: {
        HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "HOSTED_USER_SAMPLE_FLAG",
      },
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

    expect(() => applyHostedUserEnvUpdate({
      current: {},
      source: {
        HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "OPENAI_API_KEY",
      },
      update: {
        env: {
          HOSTED_USER_OTHER_FLAG: "enabled",
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
          HF_TOKEN: "hf-user",
          OPENAI_API_KEY: "sk-user",
          VENICE_API_KEY: "venice-user",
          XAI_API_KEY: "xai-user",
        },
        mode: "replace",
      },
    })).toEqual({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      HF_TOKEN: "hf-user",
      OPENAI_API_KEY: "sk-user",
      VENICE_API_KEY: "venice-user",
      XAI_API_KEY: "xai-user",
    });

    expect(() => applyHostedUserEnvUpdate({
      current: {},
      update: {
        env: {
          AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

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

  it("does not let hosted user env extensions re-enable AgentMail keys", () => {
    expect(() => applyHostedUserEnvUpdate({
      current: {},
      source: {
        HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "AGENTMAIL_API_KEY",
      },
      update: {
        env: {
          AGENTMAIL_API_KEY: "agentmail-secret",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedUserEnvUpdate({
      current: {},
      source: {
        HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES: "AGENTMAIL_",
      },
      update: {
        env: {
          AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
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
          HOSTED_WEB_INTERNAL_SIGNING_SECRET: "nope",
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

  it("rejects the removed legacy hosted user env schema", () => {
    const payload = new TextEncoder().encode(JSON.stringify({
      env: {
        VENICE_API_KEY: "venice-user",
      },
      schema: "healthybob.hosted-user-env.v1",
      updatedAt: "2026-03-26T12:00:00.000Z",
    }));

    expect(() => decodeHostedUserEnvPayload(payload)).toThrow("Hosted user env config is invalid.");
  });

  it("requires the canonical env wrapper and returns the shared update shape", () => {
    expect(() => parseHostedUserEnvUpdate({
      OPENAI_API_KEY: "sk-test",
      mode: "replace",
    })).toThrow("Hosted user env request body field `env` must be a JSON object.");

    expect(parseHostedUserEnvUpdate({
      env: {
        OPENAI_API_KEY: "sk-test",
      },
      mode: "replace",
    })).toEqual({
      env: {
        OPENAI_API_KEY: "sk-test",
      },
      mode: "replace",
    });
  });

  it("preserves the explicit env wrapper and ignores top-level extras when env is present", () => {
    expect(parseHostedUserEnvUpdate({
      env: {
        OPENAI_API_KEY: "sk-test",
        REMOVE_ME: null,
      },
      EXTRA: "ignored",
      mode: "merge",
    })).toEqual({
      env: {
        OPENAI_API_KEY: "sk-test",
        REMOVE_ME: null,
      },
      mode: "merge",
    });
  });

  it("delegates value validation to the shared hosted-execution parser", () => {
    expect(() => parseHostedUserEnvUpdate({
      env: {
        OPENAI_API_KEY: 123,
      },
      mode: "merge",
    })).toThrow(
      "Hosted execution user env update env.OPENAI_API_KEY must be a string or null.",
    );
  });

  it("preserves blank strings so the apply step can still treat them as deletions", () => {
    expect(applyHostedUserEnvUpdate({
      current: {
        OPENAI_API_KEY: "sk-user",
      },
      update: parseHostedUserEnvUpdate({
        env: {
          OPENAI_API_KEY: "",
        },
        mode: "merge",
      }),
    })).toEqual({});
  });
});
