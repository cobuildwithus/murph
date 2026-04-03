import { describe, expect, it } from "vitest";

import {
  buildHostedRunnerJobRuntimeConfig,
  buildHostedRunnerContainerEnv,
  filterHostedRunnerUserEnv,
} from "../src/runner-env.js";

const HOSTED_ASSISTANT_AUTOMATION_DISABLE_ALIASES = ["0", "false", "no", "off", "disabled"] as const;

describe("buildHostedRunnerContainerEnv", () => {
  it("forwards non-automation runner env without leaking worker proxy base URLs", () => {
    expect(buildHostedRunnerContainerEnv({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      HOSTED_AI_USAGE_BASE_URL: "https://web.example.test",
      HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "https://web.example.test",
    })).toEqual({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("forwards automation-only keys by default", () => {
    expect(buildHostedRunnerContainerEnv({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    })).toEqual({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    });
  });

  it.each(HOSTED_ASSISTANT_AUTOMATION_DISABLE_ALIASES)(
    "can still strip automation-only keys when hosted assistant automation is explicitly disabled via %s",
    (disableValue) => {
      expect(buildHostedRunnerContainerEnv({
        FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
        HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION: disableValue,
        TELEGRAM_BOT_TOKEN: "telegram-token",
      })).toEqual({
        FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
        HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION: disableValue,
        HOSTED_EMAIL_INGRESS_READY: "false",
        HOSTED_EMAIL_SEND_READY: "false",
        NODE_ENV: "production",
      });
    },
  );

  it("does not forward stale AgentMail hosted vars into the runner", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_API_KEY: "agentmail-secret",
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
    })).toEqual({
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("ignores removed AgentMail and ffmpeg alias keys", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_API_BASE_URL: "https://legacy-mail.example.test/v0",
      PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
    })).toEqual({
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("ignores unknown AgentMail and ffmpeg-prefixed keys", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_TIMEOUT_MS: "5000",
      FFMPEG_THREADS: "2",
    })).toEqual({
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("does not forward hosted web control tokens into the runner", () => {
    expect(buildHostedRunnerContainerEnv({
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EXECUTION_INTERNAL_TOKEN: "internal-token",
    })).toEqual({
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("derives hosted email readiness once and forwards the resolved flags", () => {
    expect(buildHostedRunnerContainerEnv({
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "signing-secret",
    })).toEqual({
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("preserves automation-only per-user env by default", () => {
    expect(filterHostedRunnerUserEnv({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      DEEPSEEK_API_KEY: "deepseek-user",
      HF_TOKEN: "hf-user",
      OPENAI_API_KEY: "sk-user",
      VENICE_API_KEY: "venice-user",
      XAI_API_KEY: "xai-user",
    }, {})).toEqual({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      DEEPSEEK_API_KEY: "deepseek-user",
      HF_TOKEN: "hf-user",
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
        DEEPSEEK_API_KEY: "deepseek-user",
        HF_TOKEN: "hf-user",
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
      DEEPSEEK_API_KEY: "deepseek-user",
      HF_TOKEN: "hf-user",
      OPENAI_API_KEY: "sk-user",
      VENICE_API_KEY: "venice-user",
      XAI_API_KEY: "xai-user",
    }, {
      HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION: "true",
    })).toEqual({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      DEEPSEEK_API_KEY: "deepseek-user",
      HF_TOKEN: "hf-user",
      OPENAI_API_KEY: "sk-user",
      VENICE_API_KEY: "venice-user",
      XAI_API_KEY: "xai-user",
    });
  });
});

describe("buildHostedRunnerJobRuntimeConfig", () => {
  it("builds per-job runtime config from forwarded env instead of ambient process env", () => {
    expect(buildHostedRunnerJobRuntimeConfig({
      forwardedEnv: {
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
        OPENAI_API_KEY: "sk-worker",
      },
      userEnv: {
        OPENAI_API_KEY: "sk-user",
        VENICE_API_KEY: "venice-user",
      },
    })).toEqual({
      commitTimeoutMs: 45_000,
      forwardedEnv: {
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
        OPENAI_API_KEY: "sk-worker",
      },
      userEnv: {
        OPENAI_API_KEY: "sk-user",
        VENICE_API_KEY: "venice-user",
      },
    });
  });
});
