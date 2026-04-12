import { describe, expect, it } from "vitest";

import {
  buildHostedRunnerJobRuntime,
  buildHostedRunnerJobRuntimeConfig,
  buildHostedRunnerContainerEnv,
  buildHostedRunnerResolvedConfig,
  filterHostedRunnerUserEnv,
} from "../src/runner-env.js";

describe("buildHostedRunnerContainerEnv", () => {
  it("forwards non-automation runner env without leaking worker proxy base URLs", () => {
    expect(buildHostedRunnerContainerEnv({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "https://web.example.test",
    })).toEqual({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("forwards only the default assistant, parser, and web runner env profiles", () => {
    expect(buildHostedRunnerContainerEnv({
      BRAVE_API_KEY: "brave-key",
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      MURPH_WEB_SEARCH_MAX_RESULTS: "8",
      MURPH_WEB_SEARCH_PROVIDER: "brave",
      MURPH_WEB_SEARCH_TIMEOUT_MS: "10000",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    })).toEqual({
      BRAVE_API_KEY: "brave-key",
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      MURPH_WEB_SEARCH_MAX_RESULTS: "8",
      MURPH_WEB_SEARCH_PROVIDER: "brave",
      MURPH_WEB_SEARCH_TIMEOUT_MS: "10000",
      NODE_ENV: "production",
    });
  });

  it("forwards opt-in runner env profiles when configured", () => {
    expect(buildHostedRunnerContainerEnv({
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "signing-secret",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "telegram,mapbox,hosted-email",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    })).toEqual({
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SEND_READY: "false",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      NODE_ENV: "production",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    });
  });

  it("does not forward worker-only runtime config into the child runner env", () => {
    expect(buildHostedRunnerContainerEnv({
      HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "OPENAI_API_KEY",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "1000",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-test",
    })).toEqual({
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-test",
    });
  });

  it("does not forward prefix-only provider or channel extras", () => {
    expect(buildHostedRunnerContainerEnv({
      OPENAI_BASE_URL: "https://proxy.example.test/v1",
      TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret",
      WHOOP_REDIRECT_URI: "https://worker.example.test/callback",
    })).toEqual({
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("forwards hosted web-read enablement into the runner", () => {
    expect(buildHostedRunnerContainerEnv({
      MURPH_WEB_FETCH_ENABLED: "true",
    })).toEqual({
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      MURPH_WEB_FETCH_ENABLED: "true",
      NODE_ENV: "production",
    });
  });

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
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
    })).toEqual({
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("derives hosted email readiness once without forwarding hosted email env by default", () => {
    expect(buildHostedRunnerContainerEnv({
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "signing-secret",
    })).toEqual({
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("preserves hosted automation per-user env while dropping operator-only keys", () => {
    expect(filterHostedRunnerUserEnv({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      DEEPSEEK_API_KEY: "deepseek-user",
      HF_TOKEN: "hf-user",
      OPENAI_API_KEY: "sk-user",
      VENICE_API_KEY: "venice-user",
      XAI_API_KEY: "xai-user",
    })).toEqual({
      DEEPSEEK_API_KEY: "deepseek-user",
      HF_TOKEN: "hf-user",
      OPENAI_API_KEY: "sk-user",
      VENICE_API_KEY: "venice-user",
      XAI_API_KEY: "xai-user",
    });
  });
});

describe("buildHostedRunnerJobRuntimeConfig", () => {
  it("preserves typed runtime fields when the caller already resolved them", () => {
    expect(buildHostedRunnerJobRuntime({
      commitTimeoutMs: 45_000,
      forwardedEnv: {
        HOSTED_EMAIL_INGRESS_READY: "true",
        HOSTED_EMAIL_SEND_READY: "true",
      },
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: true,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      },
      userEnv: {
        CUSTOM_API_KEY: "custom-user",
      },
    })).toEqual({
      commitTimeoutMs: 45_000,
      forwardedEnv: {
        HOSTED_EMAIL_INGRESS_READY: "true",
        HOSTED_EMAIL_SEND_READY: "true",
      },
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: true,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      },
      userEnv: {
        CUSTOM_API_KEY: "custom-user",
      },
    });
  });

  it("uses the shared config source for both timeout and allowed user env filtering", () => {
    expect(buildHostedRunnerJobRuntimeConfig({
      configSource: {
        HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "CUSTOM_API_KEY",
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      },
      forwardedEnv: {
        OPENAI_API_KEY: "sk-worker",
      },
      userEnv: {
        CUSTOM_API_KEY: "custom-user",
        OPENAI_API_KEY: "sk-user",
        VENICE_API_KEY: "venice-user",
      },
    })).toEqual({
      commitTimeoutMs: 45_000,
      forwardedEnv: {
        OPENAI_API_KEY: "sk-worker",
      },
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      },
      userEnv: {
        CUSTOM_API_KEY: "custom-user",
        OPENAI_API_KEY: "sk-user",
        VENICE_API_KEY: "venice-user",
      },
    });
  });

  it("preserves an explicit resolved config override when the caller already computed semantics", () => {
    expect(buildHostedRunnerJobRuntimeConfig({
      forwardedEnv: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      configSource: {},
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      },
      userEnv: {},
    })).toEqual({
      commitTimeoutMs: 30_000,
      forwardedEnv: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      },
      userEnv: {},
    });
  });
});

describe("buildHostedRunnerResolvedConfig", () => {
  it("derives explicit channel capabilities from the forwarded runner env", () => {
    expect(buildHostedRunnerResolvedConfig({
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SEND_READY: "true",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    })).toEqual({
      channelCapabilities: {
        emailSendReady: true,
        telegramBotConfigured: true,
      },
      deviceSync: null,
    });
  });

  it("requires both device-sync secrets and provider credentials before enabling device sync", () => {
    expect(buildHostedRunnerResolvedConfig({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
      DEVICE_SYNC_SECRET: "secret_123",
    })).toEqual({
      channelCapabilities: {
        emailSendReady: false,
        telegramBotConfigured: false,
      },
      deviceSync: null,
    });

    expect(buildHostedRunnerResolvedConfig({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
      DEVICE_SYNC_SECRET: "secret_123",
      WHOOP_CLIENT_ID: "whoop-client",
      WHOOP_CLIENT_SECRET: "whoop-secret",
    })).toMatchObject({
      channelCapabilities: {
        emailSendReady: false,
        telegramBotConfigured: false,
      },
      deviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "whoop-client",
            clientSecret: "whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "secret_123",
      },
    });
  });
});
