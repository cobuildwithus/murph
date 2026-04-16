import { describe, expect, it } from "vitest";

import {
  applyHostedRunnerSecretsUpdate,
  decodeHostedRunnerSecretsPayload,
  encodeHostedRunnerSecretsPayload,
  parseHostedRunnerSecretsUpdate,
} from "../src/runner-secrets.js";

const REMOVED_HOSTED_USER_PREFIX_KEY = "HB_USER_SAMPLE_FLAG";

describe("hosted runner secrets helpers", () => {
  it("merges allowlisted keys and removes null values", () => {
    const result = applyHostedRunnerSecretsUpdate({
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
    expect(applyHostedRunnerSecretsUpdate({
      current: {},
      source: {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "HOSTED_USER_SAMPLE_FLAG",
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

    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      update: {
        env: {
          [REMOVED_HOSTED_USER_PREFIX_KEY]: "enabled",
        },
        mode: "merge",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      source: {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "OPENAI_API_KEY",
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
    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      update: {
        env: {
          AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      update: {
        env: {
          PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);
  });

  it("accepts canonical model keys but rejects operator-only parser keys and removed integration keys", () => {
    expect(applyHostedRunnerSecretsUpdate({
      current: {},
      update: {
        env: {
          HF_TOKEN: "hf-user",
          OPENAI_API_KEY: "sk-user",
          VENICE_API_KEY: "venice-user",
          XAI_API_KEY: "xai-user",
        },
        mode: "replace",
      },
    })).toEqual({
      HF_TOKEN: "hf-user",
      OPENAI_API_KEY: "sk-user",
      VENICE_API_KEY: "venice-user",
      XAI_API_KEY: "xai-user",
    });

    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      update: {
        env: {
          FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      update: {
        env: {
          WHISPER_COMMAND: "/usr/local/bin/whisper-cli",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      update: {
        env: {
          AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      update: {
        env: {
          AGENTMAIL_API_KEY: "agentmail-secret",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      update: {
        env: {
          TELEGRAM_BOT_TOKEN: "bot-token",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      update: {
        env: {
          AGENTMAIL_TIMEOUT_MS: "5000",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      update: {
        env: {
          FFMPEG_THREADS: "2",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);
  });

  it("does not let hosted runner secrets extensions re-enable AgentMail keys", () => {
    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      source: {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "AGENTMAIL_API_KEY",
      },
      update: {
        env: {
          AGENTMAIL_API_KEY: "agentmail-secret",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      source: {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_PREFIXES: "AGENTMAIL_",
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
    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      update: {
        env: {
          HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "nope",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);

    expect(() => applyHostedRunnerSecretsUpdate({
      current: {},
      source: {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "NODE_OPTIONS",
      },
      update: {
        env: {
          NODE_OPTIONS: "--require /tmp/evil-loader.js",
        },
        mode: "replace",
      },
    })).toThrow(/not allowed/u);
  });

  it("round-trips runner secrets through the standalone hosted payload", () => {
    const payload = encodeHostedRunnerSecretsPayload({
      env: {
        OPENAI_API_KEY: "sk-user",
        XAI_API_KEY: "xai-user",
      },
      now: "2026-03-26T12:00:00.000Z",
    });

    expect(decodeHostedRunnerSecretsPayload(payload)).toEqual({
      OPENAI_API_KEY: "sk-user",
      XAI_API_KEY: "xai-user",
    });
  });

  it("round-trips extension-only keys when the same allowlist source is provided on read", () => {
    const payload = encodeHostedRunnerSecretsPayload({
      env: {
        CUSTOM_API_KEY: "custom-secret",
      },
      now: "2026-03-26T12:00:00.000Z",
    });

    expect(decodeHostedRunnerSecretsPayload(payload, {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
    })).toEqual({
      CUSTOM_API_KEY: "custom-secret",
    });
  });

  it("rejects the removed legacy hosted runner secrets schema", () => {
    const payload = new TextEncoder().encode(JSON.stringify({
      env: {
        VENICE_API_KEY: "venice-user",
      },
      schema: "healthybob.hosted-user-env.v1",
      updatedAt: "2026-03-26T12:00:00.000Z",
    }));

    expect(() => decodeHostedRunnerSecretsPayload(payload)).toThrow("Hosted runner secrets config is invalid.");
  });

  it("requires the canonical runner-secrets wrapper and returns the shared update shape", () => {
    expect(() => parseHostedRunnerSecretsUpdate({
      OPENAI_API_KEY: "sk-test",
      mode: "replace",
    })).toThrow("Hosted runner secrets request body field `env` must be a JSON object.");

    expect(parseHostedRunnerSecretsUpdate({
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
    expect(parseHostedRunnerSecretsUpdate({
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
    expect(() => parseHostedRunnerSecretsUpdate({
      env: {
        OPENAI_API_KEY: 123,
      },
      mode: "merge",
    })).toThrow(
      "Hosted runner secrets request body field `env.OPENAI_API_KEY` must be a string or null.",
    );
  });

  it("preserves blank strings so the apply step can still treat them as deletions", () => {
    expect(applyHostedRunnerSecretsUpdate({
      current: {
        OPENAI_API_KEY: "sk-user",
      },
      update: parseHostedRunnerSecretsUpdate({
        env: {
          OPENAI_API_KEY: "",
        },
        mode: "merge",
      }),
    })).toEqual({});
  });
});
