import { describe, expect, it } from "vitest";

import {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerJobRuntime,
  buildHostedRunnerJobRuntimeConfig,
  buildHostedRunnerContainerEnv,
  buildHostedRunnerResolvedConfig,
  filterHostedRunnerSecrets,
} from "../src/runner-env.js";
import { readHostedDeployAutomationEnvironment } from "../scripts/deploy-automation.js";
import {
  HOSTED_WORKER_OPTIONAL_SECRET_NAMES,
} from "../scripts/deploy-automation/worker-secret-names.ts";
import {
  HOSTED_WORKER_OPTIONAL_VAR_NAMES,
} from "../scripts/deploy-automation/worker-optional-vars.ts";

describe("buildHostedRunnerContainerEnv", () => {
  it("forwards non-automation runner env without leaking unrelated worker vars", () => {
    expect(buildHostedRunnerContainerEnv({
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      HOSTED_WEB_BASE_URL: "https://web.example.test",
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
      HOSTED_EMAIL: {
        send: async (_message: unknown) => undefined,
      },
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
      HOSTED_EMAIL_SEND_READY: "true",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      NODE_ENV: "production",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    });
  });

  it("keeps hosted email send readiness false without the binding even when ingress config is present", () => {
    expect(buildHostedRunnerContainerEnv({
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "signing-secret",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "hosted-email",
    })).toEqual({
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("rewrites forwarded loopback runner callback urls to the container-reachable worker bridge host", () => {
    expect(buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_BASE_URL: "http://127.0.0.1:4111/v1",
      HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://host.docker.internal:8787",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "linq,telegram",
      LINQ_ATTACHMENT_CDN_BASE_URL: "http://127.0.0.1:4011/attachment-downloads",
      HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
      LINQ_API_BASE_URL: "http://localhost:4011",
      TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
      TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
    })).toEqual({
      HOSTED_ASSISTANT_BASE_URL: "http://host.docker.internal:4111/v1",
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      LINQ_ATTACHMENT_CDN_BASE_URL: "http://host.docker.internal:4011/attachment-downloads",
      LINQ_API_BASE_URL: "http://host.docker.internal:4011/",
      NODE_ENV: "production",
      TELEGRAM_API_BASE_URL: "http://host.docker.internal:4012/",
      TELEGRAM_FILE_BASE_URL: "http://host.docker.internal:4013/",
    });
  });

  it("keeps loopback runner callback urls unchanged for ambient host execution env", () => {
    expect(buildHostedRunnerAmbientEnv({
      HOSTED_ASSISTANT_BASE_URL: "http://127.0.0.1:4111/v1",
      HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://host.docker.internal:8787",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "linq,telegram",
      LINQ_ATTACHMENT_CDN_BASE_URL: "http://127.0.0.1:4011/attachment-downloads",
      LINQ_API_BASE_URL: "http://localhost:4011",
      TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
      TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
    })).toEqual({
      HOSTED_ASSISTANT_BASE_URL: "http://127.0.0.1:4111/v1",
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      LINQ_ATTACHMENT_CDN_BASE_URL: "http://127.0.0.1:4011/attachment-downloads",
      LINQ_API_BASE_URL: "http://localhost:4011",
      NODE_ENV: "production",
      TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
      TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
    });
  });

  it("does not forward worker-only runtime config into the child runner env", () => {
    expect(buildHostedRunnerContainerEnv({
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "OPENAI_API_KEY",
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

  it("ignores stale AgentMail and ffmpeg alias keys", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
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

  it("preserves hosted automation runner secrets while dropping operator-only keys", () => {
    expect(filterHostedRunnerSecrets({
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
      runnerSecrets: {
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

  it("uses the shared config source for both timeout and allowed runner-secret filtering", () => {
    expect(buildHostedRunnerJobRuntimeConfig({
      configSource: {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      },
      forwardedEnv: {
        OPENAI_API_KEY: "sk-worker",
      },
      runnerSecrets: {
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

  it("keeps loopback runner callback urls intact when the runtime envelope already has forwarded env", () => {
    expect(buildHostedRunnerJobRuntimeConfig({
      forwardedEnv: {
        HOSTED_ASSISTANT_BASE_URL: "http://127.0.0.1:4111/v1",
        LINQ_API_BASE_URL: "http://localhost:4011",
        TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
        TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
      },
      runnerSecrets: {},
    })).toMatchObject({
      forwardedEnv: {
        HOSTED_ASSISTANT_BASE_URL: "http://127.0.0.1:4111/v1",
        LINQ_API_BASE_URL: "http://localhost:4011",
        TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
        TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
      },
      userEnv: {},
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
      runnerSecrets: {},
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

  it("derives device-sync runtime config from the shared config source without forwarding raw provider env", () => {
    const runtime = buildHostedRunnerJobRuntimeConfig({
      configSource: {
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://murph.example/api/device-sync",
        DEVICE_SYNC_SECRET: "runtime-codec-secret",
        GARMIN_API_BASE_URL: "https://garmin.example",
        GARMIN_CLIENT_ID: "garmin-client",
        GARMIN_CLIENT_SECRET: "garmin-secret",
        OURA_WEBHOOK_VERIFICATION_TOKEN: "control-plane-only",
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      forwardedEnv: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      runnerSecrets: {},
    });

    expect(runtime.forwardedEnv).toEqual({
      TELEGRAM_BOT_TOKEN: "telegram-token",
    });
    expect(runtime.resolvedConfig).toBeDefined();
    expect(runtime.resolvedConfig?.channelCapabilities.telegramBotConfigured).toBe(true);
    expect(runtime.resolvedConfig?.deviceSync).toEqual({
      providerConfigs: {
        garmin: {
          apiBaseUrl: "https://garmin.example",
          clientId: "garmin-client",
          clientSecret: "garmin-secret",
        },
      },
      publicBaseUrl: "https://murph.example/api/device-sync",
      secret: "runtime-codec-secret",
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

  it("reuses the shared device-sync runtime config helper and strips provider-only fields", () => {
    const resolved = buildHostedRunnerResolvedConfig({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
      DEVICE_SYNC_SECRET: "secret_123",
      OURA_CLIENT_ID: "oura-client",
      OURA_CLIENT_SECRET: "oura-secret",
      OURA_WEBHOOK_VERIFICATION_TOKEN: "verification-token",
    });

    expect(resolved).toEqual({
      channelCapabilities: {
        emailSendReady: false,
        telegramBotConfigured: false,
      },
      deviceSync: {
        providerConfigs: {
          oura: {
            clientId: "oura-client",
            clientSecret: "oura-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "secret_123",
      },
    });
    expect(resolved.deviceSync?.providerConfigs.oura).not.toHaveProperty("webhookVerificationToken");
  });
});

describe("hosted deploy automation device-sync surface", () => {
  it("keeps device-sync outside the default child env profiles while reusing shared provider env key lists", () => {
    const deployEnv = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
      CF_WORKER_NAME: "murph-runner",
    });

    expect(deployEnv.workerVars.HOSTED_EXECUTION_RUNNER_ENV_PROFILES).toBe(
      "hosted-email,linq,mapbox,telegram",
    );
    expect(HOSTED_WORKER_OPTIONAL_SECRET_NAMES).toEqual(
      expect.arrayContaining(["GARMIN_CLIENT_ID", "GARMIN_CLIENT_SECRET"]),
    );
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).toEqual(
      expect.arrayContaining([
        "GARMIN_API_BASE_URL",
        "HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED",
        "HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS",
        "WHOOP_SCOPES",
      ]),
    );
    expect(HOSTED_WORKER_OPTIONAL_SECRET_NAMES).not.toContain(
      "OURA_WEBHOOK_VERIFICATION_TOKEN",
    );
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).not.toContain(
      "OURA_WEBHOOK_VERIFICATION_TOKEN",
    );
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).not.toContain(
      "LINQ_ATTACHMENT_CDN_BASE_URL",
    );
  });
});
