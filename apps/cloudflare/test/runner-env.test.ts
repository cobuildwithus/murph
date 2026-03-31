import { describe, expect, it } from "vitest";

import {
  buildHostedRunnerContainerEnv,
  filterHostedRunnerUserEnv,
} from "../src/runner-env.js";

const HOSTED_ASSISTANT_AUTOMATION_DISABLE_ALIASES = ["0", "false", "no", "off", "disabled"] as const;

describe("buildHostedRunnerContainerEnv", () => {
  it("forwards non-automation runner env without leaking worker proxy base URLs", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
    })).toEqual({
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      NODE_ENV: "production",
    });
  });

  it("forwards automation-only keys by default", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    })).toEqual({
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      NODE_ENV: "production",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    });
  });

  it.each(HOSTED_ASSISTANT_AUTOMATION_DISABLE_ALIASES)(
    "can still strip automation-only keys when hosted assistant automation is explicitly disabled via %s",
    (disableValue) => {
      expect(buildHostedRunnerContainerEnv({
        AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
        FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
        HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION: disableValue,
        TELEGRAM_BOT_TOKEN: "telegram-token",
      })).toEqual({
        AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
        FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
        HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION: disableValue,
        NODE_ENV: "production",
      });
    },
  );

  it("does not forward unused AgentMail platform secrets into the runner", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_API_KEY: "agentmail-secret",
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
    })).toEqual({
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
      NODE_ENV: "production",
    });
  });

  it("ignores removed AgentMail and ffmpeg alias keys", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_API_BASE_URL: "https://legacy-mail.example.test/v0",
      PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
    })).toEqual({
      NODE_ENV: "production",
    });
  });

  it("ignores unknown AgentMail and ffmpeg-prefixed keys", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_TIMEOUT_MS: "5000",
      FFMPEG_THREADS: "2",
    })).toEqual({
      NODE_ENV: "production",
    });
  });

  it("does not forward hosted web control tokens into the runner", () => {
    expect(buildHostedRunnerContainerEnv({
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EXECUTION_INTERNAL_TOKEN: "internal-token",
    })).toEqual({
      NODE_ENV: "production",
    });
  });

  it("preserves automation-only per-user env by default", () => {
    expect(filterHostedRunnerUserEnv({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      OPENAI_API_KEY: "sk-user",
      VENICE_API_KEY: "venice-user",
      XAI_API_KEY: "xai-user",
    }, {})).toEqual({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      OPENAI_API_KEY: "sk-user",
      VENICE_API_KEY: "venice-user",
      XAI_API_KEY: "xai-user",
    });
  });

  it.each(HOSTED_ASSISTANT_AUTOMATION_DISABLE_ALIASES)(
    "strips automation-only per-user env when hosted assistant automation is explicitly disabled via %s",
    (disableValue) => {
      expect(filterHostedRunnerUserEnv({
        FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
        OPENAI_API_KEY: "sk-user",
        VENICE_API_KEY: "venice-user",
        XAI_API_KEY: "xai-user",
      }, {
        HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION: disableValue,
      })).toEqual({
        FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      });
    },
  );

  it("preserves automation-only per-user env when hosted assistant automation is explicitly enabled", () => {
    expect(filterHostedRunnerUserEnv({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      OPENAI_API_KEY: "sk-user",
      VENICE_API_KEY: "venice-user",
      XAI_API_KEY: "xai-user",
    }, {
      HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION: "true",
    })).toEqual({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      OPENAI_API_KEY: "sk-user",
      VENICE_API_KEY: "venice-user",
      XAI_API_KEY: "xai-user",
    });
  });
});
