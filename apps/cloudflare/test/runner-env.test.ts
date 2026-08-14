import { describe, expect, it } from "vitest";
import {
  buildHostedRuntimeLaunchSpec,
  buildHostedRuntimeResolvedConfig,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
  readHostedRuntimeCommitTimeoutConfigValue,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerJobRuntime,
  buildHostedRunnerJobRuntimeConfig,
  buildHostedRunnerContainerEnv,
  buildHostedRunnerContainerPlatformEnv,
  buildHostedRunnerChannelPlatformEnv,
  buildHostedRunnerLegacyDeviceSyncPlatformEnv,
  filterHostedRunnerSecrets,
} from "../src/runner-env.js";
import { readHostedDeployAutomationEnvironment } from "../scripts/deploy-automation.js";
import {
  HOSTED_WORKER_REQUIRED_SECRET_NAMES,
  HOSTED_WORKER_OPTIONAL_SECRET_NAMES,
} from "../scripts/deploy-automation/worker-secret-names.ts";
import {
  HOSTED_WORKER_OPTIONAL_VAR_NAMES,
} from "../scripts/deploy-automation/worker-optional-vars.ts";
import {
  HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV,
} from "../src/runner-native-parser-toolchain.ts";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../src/runner-egress-intercept.ts";

const REQUIRED_HOSTED_CRYPTO_WORKER_VARS = {
  CF_PUBLIC_BASE_URL: "https://murph-hosted.cobuildwithus.workers.dev",
  HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION:
    "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
  HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
    "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
  HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:v1",
  HOSTED_CRYPTO_ENV: "production",
  HOSTED_R2_PRESIGN_ACCOUNT_ID: "r2-account-test",
  HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-bundles",
} as const;
const REQUIRED_OPENAI_PROVIDER_ENV = {
  HOSTED_ASSISTANT_PROVIDER: "openai",
} as const;
const DEFAULT_HOSTED_RUNNER_NATIVE_PARSER_TOOLCHAIN = {
  tools: {
    ffmpeg: {
      command: "/usr/bin/ffmpeg",
    },
    pdfinfo: {
      command: "/usr/bin/pdfinfo",
    },
    pdftotext: {
      command: "/usr/bin/pdftotext",
    },
    transcription: {
      endpoint: "http://murph-transcribe.worker/v1/transcribe",
    },
  },
} as const;

describe("buildHostedRunnerContainerEnv", () => {
  it("forwards non-automation runner env without leaking unrelated worker vars or parser selectors", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      PDFTOTEXT_COMMAND: "/usr/local/bin/pdftotext",
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("forwards only the default assistant runner env profile", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      PDFTOTEXT_COMMAND: "/usr/local/bin/pdftotext",
      MAPBOX_ACCESS_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      TELEGRAM_BOT_TOKEN: "telegram-token",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("forwards opt-in runner env profiles when configured", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      EXA_API_KEY: "exa-token",
      HOSTED_EMAIL: {
        send: async (_message: unknown) => undefined,
      },
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "signing-secret",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "telegram,mapbox,hosted-email,exa",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      EXA_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SEND_READY: "true",
      MAPBOX_ACCESS_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      NODE_ENV: "production",
    });
  });

  it("maps Worker-owned Exa credentials to a hosted runtime sentinel", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      EXA_API_KEY: "exa-token",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "exa",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      EXA_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("maps Worker-owned ElevenLabs credentials to a sentinel and preserves runtime config", () => {
    const configSource = {
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      ELEVENLABS_API_KEY: "elevenlabs-token",
      MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      MURPH_ELEVENLABS_VOICE_ID: "voice_murph",
    };
    const forwardedEnv = buildHostedRunnerContainerEnv(configSource);

    expect(forwardedEnv).toMatchObject({
      ELEVENLABS_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      MURPH_ELEVENLABS_VOICE_ID: "voice_murph",
    });

    const runtime = buildHostedRunnerJobRuntimeConfig({
      configSource,
      forwardedEnv,
      runnerSecrets: {
        ELEVENLABS_API_KEY: "member-elevenlabs-token",
      },
    });

    expect(runtime.forwardedEnv).toMatchObject({
      ELEVENLABS_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      MURPH_ELEVENLABS_VOICE_ID: "voice_murph",
    });
    expect(runtime.userEnv?.ELEVENLABS_API_KEY).toBeUndefined();
  });

  it("forwards allowlisted env values that are readable by key but not enumerable", () => {
    const source: Record<string, unknown> = {};
    Object.defineProperties(source, {
      HOSTED_ASSISTANT_PROVIDER: {
        enumerable: false,
        value: "openai",
      },
      HOSTED_ASSISTANT_MODEL: {
        enumerable: false,
        value: "gpt-test",
      },
      NODE_ENV: {
        enumerable: false,
        value: "development",
      },
      UNRELATED_SECRET: {
        enumerable: false,
        value: "not-forwarded",
      },
      OPENAI_API_KEY: {
        enumerable: false,
        value: "openai-key",
      },
    });

    expect(Object.keys(source)).toEqual([]);
    expect(buildHostedRunnerContainerEnv(source)).toEqual({
      HOSTED_ASSISTANT_MODEL: "gpt-test",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "development",
      OPENAI_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
    });
  });

  it("rejects deprecated local Codex app-server bridge config", () => {
    expect(() =>
      buildHostedRunnerContainerEnv({
        HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV]: "bridge-token",
        [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV]: "http://127.0.0.1:4555",
        NODE_ENV: "development",
        OPENAI_API_KEY: "openai-key",
      })
    ).toThrow(
      "MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN, MURPH_DEV_CODEX_APP_SERVER_PROXY_URL are no longer supported for hosted runner config",
    );
  });

  it("rejects the removed local-codex hosted assistant provider", () => {
    expect(() =>
      buildHostedRunnerContainerEnv({
        HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
        HOSTED_ASSISTANT_PROVIDER: "local-codex",
        NODE_ENV: "development",
        OPENAI_API_KEY: "openai-key",
      })
    ).toThrow(
      "HOSTED_ASSISTANT_PROVIDER must be openai for hosted runner execution.",
    );
  });

  it("forwards OpenAI assistant config into runner containers", () => {
    expect(buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      NODE_ENV: "development",
      OPENAI_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
    })).toEqual({
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "development",
      OPENAI_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
    });
  });

  it("forwards the managed Venice credential for per-member provider overrides", () => {
    expect(buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "openai-worker-secret",
      VENICE_API_KEY: "venice-worker-secret",
    })).toEqual({
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
      OPENAI_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      VENICE_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
    });
  });

  it("forwards explicit hosted checkpoint debug env into runner containers", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_FILE: "/tmp/checkpoint-debug.json",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT: "20000",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW: "1",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_FILE: "/tmp/checkpoint-debug.json",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT: "20000",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW: "1",
      NODE_ENV: "production",
    });
  });

  it("does not forward the Linq webhook verification secret into the runner", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "linq",
      LINQ_API_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      LINQ_API_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      NODE_ENV: "production",
    });
  });

  it("forwards hosted email send readiness alongside ingress when email config is present", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "signing-secret",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "hosted-email",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SEND_READY: "true",
      NODE_ENV: "production",
    });
  });

  it("rewrites forwarded loopback runner callback urls to the container-reachable worker bridge host", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_ASSISTANT_BASE_URL: "http://127.0.0.1:4111/v1",
      HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "host.docker.internal",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "linq,telegram",
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]: "http://127.0.0.1:4222/v1",
      LINQ_ATTACHMENT_CDN_BASE_URL: "http://127.0.0.1:4011/attachment-downloads",
      LINQ_API_BASE_URL: "http://localhost:4011",
      TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
      TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      LINQ_ATTACHMENT_CDN_BASE_URL: "http://host.docker.internal:4011/attachment-downloads",
      LINQ_API_BASE_URL: "http://host.docker.internal:4011/",
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
        "http://host.docker.internal:4222/v1",
      NODE_ENV: "production",
      TELEGRAM_API_BASE_URL: "http://host.docker.internal:4012/",
      TELEGRAM_FILE_BASE_URL: "http://host.docker.internal:4013/",
    });
  });

  it("keeps loopback runner callback urls unchanged for ambient host execution env", () => {
    expect(buildHostedRunnerAmbientEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_ASSISTANT_BASE_URL: "http://127.0.0.1:4111/v1",
      HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "host.docker.internal",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "linq,telegram",
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]: "http://127.0.0.1:4222/v1",
      LINQ_ATTACHMENT_CDN_BASE_URL: "http://127.0.0.1:4011/attachment-downloads",
      LINQ_API_BASE_URL: "http://localhost:4011",
      TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
      TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      LINQ_ATTACHMENT_CDN_BASE_URL: "http://127.0.0.1:4011/attachment-downloads",
      LINQ_API_BASE_URL: "http://localhost:4011",
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]: "http://127.0.0.1:4222/v1",
      NODE_ENV: "production",
      TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
      TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
    });
  });

  it("does not forward worker-only runtime config into the child runner env", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "OPENAI_API_KEY",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "1000",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      NODE_ENV: "production",
      OPENAI_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
      OPENAI_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
    });
  });

  it("does not forward prefix-only provider or channel extras", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      OPENAI_BASE_URL: "https://proxy.example.test/v1",
      TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret",
      WHOOP_REDIRECT_URI: "https://worker.example.test/callback",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("ignores stale parser aliases and unknown environment keys", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      FFMPEG_THREADS: "2",
      PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
      UNRECOGNIZED_PROVIDER_TIMEOUT_MS: "5000",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("does not forward hosted web control tokens into the runner", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("derives hosted email readiness once without forwarding hosted email env by default", () => {
    expect(buildHostedRunnerContainerEnv({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "signing-secret",
    })).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    });
  });

  it("preserves hosted automation runner secrets while dropping operator-only keys", () => {
    expect(filterHostedRunnerSecrets({
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]: "http://127.0.0.1:4111/v1",
      [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV]: "member-token",
      [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV]: "tcp://evil.example.test:1234",
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      DEEPSEEK_API_KEY: "deepseek-user",
      EXA_API_KEY: "exa-user",
      HF_TOKEN: "hf-user",
      LINQ_API_TOKEN: "linq-user",
      MAPBOX_ACCESS_TOKEN: "mapbox-user",
      OPENAI_API_KEY: "fixture-user-key",
      TELEGRAM_API_BASE_URL: "https://evil.telegram.example",
      TELEGRAM_BOT_TOKEN: "telegram-user",
      TELEGRAM_FILE_BASE_URL: "https://evil-files.telegram.example",
      VENICE_API_KEY: "venice-user",
      WHATSAPP_API_BASE_URL: "https://removed-whatsapp.example.test",
      WHATSAPP_ACCESS_TOKEN: "removed-whatsapp-user",
      WHATSAPP_APP_SECRET: "removed-whatsapp-app-secret",
      WHATSAPP_GRAPH_VERSION: "v25.0",
      WHATSAPP_PHONE_NUMBER_ID: "removed-whatsapp-phone-user",
      WHATSAPP_VERIFY_TOKEN: "removed-whatsapp-verify-token",
      XAI_API_KEY: "xai-user",
    })).toEqual({});
  });

  it("rejects intercept-injected provider credentials from runner secrets even when explicitly allowlisted", () => {
    expect(filterHostedRunnerSecrets(
      {
        EXA_API_KEY: "exa-user",
        LINQ_API_TOKEN: "linq-user",
        MAPBOX_ACCESS_TOKEN: "mapbox-user",
        MURPH_DATA_API_KEY: "data-api-user",
        HOSTED_WEB_BASE_URL: "https://evil.example.test",
        OPENAI_API_KEY: "openai-user",
        TELEGRAM_BOT_TOKEN: "telegram-user",
        WHATSAPP_API_BASE_URL: "https://removed-whatsapp.example.test",
        WHATSAPP_ACCESS_TOKEN: "removed-whatsapp-user",
        WHATSAPP_APP_SECRET: "removed-whatsapp-app-secret",
        WHATSAPP_GRAPH_VERSION: "v25.0",
        WHATSAPP_PHONE_NUMBER_ID: "removed-whatsapp-phone-user",
        WHATSAPP_VERIFY_TOKEN: "removed-whatsapp-verify-token",
      },
      {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: [
          "EXA_API_KEY",
          "LINQ_API_TOKEN",
          "MAPBOX_ACCESS_TOKEN",
          "MURPH_DATA_API_KEY",
          "HOSTED_WEB_BASE_URL",
          "OPENAI_API_KEY",
          "TELEGRAM_BOT_TOKEN",
          "WHATSAPP_API_BASE_URL",
          "WHATSAPP_ACCESS_TOKEN",
          "WHATSAPP_APP_SECRET",
          "WHATSAPP_GRAPH_VERSION",
          "WHATSAPP_PHONE_NUMBER_ID",
          "WHATSAPP_VERIFY_TOKEN",
        ].join(","),
      },
    )).toEqual({});
  });

  it("rejects ingress-only secrets from runner secrets even when explicitly allowlisted", () => {
    expect(filterHostedRunnerSecrets(
      {
        [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV]: "member-token",
        [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV]: "tcp://evil.example.test:1234",
        [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]: "http://127.0.0.1:4111/v1",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS:
          `${HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV},${HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV},${HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV},LINQ_WEBHOOK_SECRET`,
      },
    )).toEqual({});
  });
});

describe("buildHostedRunnerJobRuntimeConfig", () => {
  it("keeps Cloudflare as an adapter over the shared hosted runtime launch spec", () => {
    const configSource = {
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
      HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "host.docker.internal",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "linq,telegram",
      LINQ_API_BASE_URL: "http://localhost:4011",
      LINQ_API_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
    };
    const runnerSecrets = {
      CUSTOM_API_KEY: "custom-user",
      TELEGRAM_BOT_TOKEN: "user-telegram-token",
    };
    const forwardedEnv = buildHostedRunnerContainerEnv(configSource);
    const platformEnv = {
      ...buildHostedRunnerLegacyDeviceSyncPlatformEnv(configSource, {
        rewriteLoopbackUrlsForContainer: true,
      }),
      ...buildHostedRunnerChannelPlatformEnv(configSource, {
        rewriteLoopbackUrlsForContainer: true,
      }),
    };

    expect(buildHostedRunnerJobRuntimeConfig({
      configSource,
      forwardedEnv,
      rewritePlatformUrlsForContainer: true,
      runnerSecrets,
    })).toEqual(buildHostedRuntimeLaunchSpec({
      commitTimeoutMs: readHostedRuntimeCommitTimeoutConfigValue(
        configSource.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS,
      ),
      configSource,
      forwardedEnv,
      parserToolchain: DEFAULT_HOSTED_RUNNER_NATIVE_PARSER_TOOLCHAIN,
      platformEnv,
      userEnv: filterHostedRunnerSecrets(runnerSecrets, {
        ...configSource,
        ...platformEnv,
      }),
    }).runtime);
  });

  it("preserves typed runtime fields when the caller already resolved them", () => {
    const parserToolchain = {
      tools: {
        ffmpeg: {
          command: "/app/test-parser-toolchain/ffmpeg",
        },
        whisper: {
          command: "/app/test-parser-toolchain/whisper-cli",
          modelPath: "/app/test-parser-toolchain/ggml-test.bin",
        },
      },
    };

    expect(buildHostedRunnerJobRuntime({
      commitTimeoutMs: 45_000,
      configSource: {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
      },
      forwardedEnv: {
        HOSTED_EMAIL_INGRESS_READY: "true",
        HOSTED_EMAIL_SEND_READY: "true",
      },
      parserToolchain,
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
      parserToolchain,
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

  it("does not serialize parser config from stale forwarded env into the runtime envelope", () => {
    expect(buildHostedRunnerJobRuntime({
      forwardedEnv: {
        FFMPEG_COMMAND: "/stale/ffmpeg",
        HOSTED_EMAIL_INGRESS_READY: "true",
        WHISPER_COMMAND: "/stale/whisper-cli",
        WHISPER_MODEL_PATH: "/stale/model.bin",
      },
      runnerSecrets: {},
    }).parserToolchain).toBeUndefined();
  });

  it("serializes the native parser toolchain through the runtime config wrapper", () => {
    expect(buildHostedRunnerJobRuntimeConfig({
      forwardedEnv: {
        FFMPEG_COMMAND: "/stale/ffmpeg",
        HOSTED_EMAIL_INGRESS_READY: "true",
        WHISPER_COMMAND: "/stale/whisper-cli",
        WHISPER_MODEL_PATH: "/stale/model.bin",
      },
      runnerSecrets: {},
    }).parserToolchain).toEqual(DEFAULT_HOSTED_RUNNER_NATIVE_PARSER_TOOLCHAIN);
  });

  it("serializes the local e2e parser toolchain only behind the explicit marker", () => {
    const configSource = {
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
      [HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV]: "1",
      HOSTED_EMAIL_INGRESS_READY: "true",
    };

    expect(buildHostedRunnerJobRuntimeConfig({
      configSource,
      forwardedEnv: buildHostedRunnerContainerEnv(configSource),
      runnerSecrets: {},
    }).parserToolchain).toEqual({
      tools: {
        ffmpeg: {
          command: "/app/test-parser-toolchain/ffmpeg",
        },
        pdfinfo: {
          command: "/usr/bin/pdfinfo",
        },
        pdftotext: {
          command: "/usr/bin/pdftotext",
        },
        transcription: {
          endpoint: "http://murph-transcribe.worker/v1/transcribe",
        },
      },
    });
  });

  it("keeps parser config out of the worker runtime envelope even when platform config contains parser env", () => {
    const configSource = {
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "linq,parsers",
      LINQ_API_TOKEN: "linq-token",
      WHISPER_COMMAND: "/app/test-parser-toolchain/whisper-cli",
      WHISPER_MODEL_PATH: "/app/test-parser-toolchain/ggml-test.bin",
    };

    expect(buildHostedRunnerContainerEnv(configSource)).toEqual({
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      LINQ_API_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      NODE_ENV: "production",
    });
    expect(buildHostedRunnerJobRuntimeConfig({
      configSource,
      forwardedEnv: buildHostedRunnerContainerEnv(configSource),
      runnerSecrets: {},
    }).parserToolchain).toEqual(DEFAULT_HOSTED_RUNNER_NATIVE_PARSER_TOOLCHAIN);
  });

  it("rejects parserToolchain:null at the hosted runner boundary", () => {
    expect(() =>
      buildHostedRunnerJobRuntime({
        forwardedEnv: {},
        parserToolchain: null,
        runnerSecrets: {},
      })
    ).toThrow(
      "Hosted runner parserToolchain:null is not supported; omit parserToolchain to use the runner image toolchain.",
    );
  });

  it("uses the shared config source for both timeout and allowed runner-secret filtering", () => {
    expect(buildHostedRunnerJobRuntimeConfig({
      configSource: {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      },
      forwardedEnv: {
        OPENAI_API_KEY: "fixture-worker-key",
      },
      runnerSecrets: {
        CUSTOM_API_KEY: "custom-user",
        OPENAI_API_KEY: "fixture-user-key",
        VENICE_API_KEY: "venice-user",
      },
    })).toMatchObject({
      commitTimeoutMs: 45_000,
      forwardedEnv: {
        OPENAI_API_KEY: "fixture-worker-key",
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
      },
    });
  });

  it("ignores commit timeout env values with trailing junk", () => {
    expect(buildHostedRunnerJobRuntimeConfig({
      configSource: {
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000abc",
      },
      forwardedEnv: {},
      runnerSecrets: {},
    }).commitTimeoutMs).toBe(30_000);
  });

  it("prefers explicit platform env over conflicting forwarded Telegram env", () => {
    expect(buildHostedRunnerJobRuntime({
      forwardedEnv: {
        TELEGRAM_API_BASE_URL: "https://evil.telegram.example",
        TELEGRAM_BOT_TOKEN: "evil-telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://evil-files.telegram.example",
      },
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      runnerSecrets: {},
    })).toMatchObject({
      commitTimeoutMs: 30_000,
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: true,
        },
        deviceSync: null,
      },
      userEnv: {},
    });
  });

  it("treats explicit platform env as platform-owned and does not backfill missing keys from forwarded env", () => {
    expect(buildHostedRunnerJobRuntime({
      forwardedEnv: {
        OPENAI_API_KEY: "fixture-worker-key",
        TELEGRAM_API_BASE_URL: "https://evil.telegram.example",
        TELEGRAM_FILE_BASE_URL: "https://evil-files.telegram.example",
      },
      platformEnv: {
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
        TELEGRAM_BOT_TOKEN: "telegram-token",
      } as Record<string, string>,
      runnerSecrets: {},
    })).toMatchObject({
      commitTimeoutMs: 30_000,
      forwardedEnv: {
        OPENAI_API_KEY: "fixture-worker-key",
      },
      platformEnv: {
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: true,
        },
        deviceSync: null,
      },
      userEnv: {},
    });
  });

  it("drops worker-only secret material from explicit forwarded env", () => {
    const runtime = buildHostedRunnerJobRuntimeConfig({
      forwardedEnv: {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: '{"kty":"EC","d":"automation"}',
        HOSTED_WEB_BASE_URL: "https://forwarded.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: '{"kty":"EC","d":"callback"}',
        OPENAI_API_KEY: "fixture-worker-key",
      },
      runnerSecrets: {},
    });

    expect(runtime).toMatchObject({
      forwardedEnv: {
        OPENAI_API_KEY: "fixture-worker-key",
      },
      userEnv: {},
    });
    expect(runtime.platformEnv).toBeUndefined();
  });

  it("keeps platform private JWKs out of hosted runtime job, forwarded, and user env", () => {
    const configSource = {
      ...REQUIRED_OPENAI_PROVIDER_ENV,
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:
        '{"kty":"EC","d":"automation"}',
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
        '{"kty":"EC","d":"callback"}',
    };
    const runtime = buildHostedRunnerJobRuntimeConfig({
      configSource,
      forwardedEnv: buildHostedRunnerContainerEnv(configSource),
      runnerSecrets: {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:
          "user-automation-private-jwk",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
          "user-callback-private-jwk",
      },
    });
    expect(runtime.platformEnv).toBeUndefined();
    expect(runtime.forwardedEnv?.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK).toBeUndefined();
    expect(runtime.forwardedEnv?.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBeUndefined();
    expect(runtime.userEnv?.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK).toBeUndefined();
    expect(runtime.userEnv?.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBeUndefined();
  });

  it("keeps loopback runner callback urls intact when the runtime envelope already has forwarded env", () => {
    const runtime = buildHostedRunnerJobRuntimeConfig({
      forwardedEnv: {
        HOSTED_ASSISTANT_BASE_URL: "http://127.0.0.1:4111/v1",
        LINQ_API_BASE_URL: "http://localhost:4011",
        TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
        TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
      },
      runnerSecrets: {},
    });

    expect(runtime).toMatchObject({
      forwardedEnv: {
        LINQ_API_BASE_URL: "http://localhost:4011",
      },
      userEnv: {},
    });
    expect(runtime.platformEnv).toBeUndefined();
  });

  it("serializes Telegram platform authority as container-only sentinels", () => {
    const runtime = buildHostedRunnerJobRuntimeConfig({
      configSource: {
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "host.docker.internal",
        TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
      },
      forwardedEnv: {},
      rewritePlatformUrlsForContainer: true,
      runnerSecrets: {},
    });

    expect(runtime).toMatchObject({
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "http://host.docker.internal:4012/",
        TELEGRAM_BOT_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
        TELEGRAM_FILE_BASE_URL: "http://host.docker.internal:4013/",
      },
      userEnv: {},
    });
  });

  it("keeps Telegram platform env out of runner secrets even when operators try to allowlist it", () => {
    const runtime = buildHostedRunnerJobRuntimeConfig({
      configSource: {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: [
          "TELEGRAM_API_BASE_URL",
          "TELEGRAM_BOT_TOKEN",
          "TELEGRAM_FILE_BASE_URL",
        ].join(","),
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      forwardedEnv: {},
      runnerSecrets: {
        TELEGRAM_API_BASE_URL: "https://evil.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-user",
        TELEGRAM_FILE_BASE_URL: "https://evil-files.telegram.example",
      },
    });

    expect(runtime).toMatchObject({
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      userEnv: {},
    });
  });

  it("preserves an explicit resolved config override when the caller already computed semantics", () => {
    expect(buildHostedRunnerJobRuntimeConfig({
      configSource: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      forwardedEnv: {},
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
      forwardedEnv: {},
      parserToolchain: DEFAULT_HOSTED_RUNNER_NATIVE_PARSER_TOOLCHAIN,
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
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
        OURA_CLIENT_ID: "oura-client",
        OURA_CLIENT_SECRET: "oura-secret",
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        OURA_WEBHOOK_VERIFICATION_TOKEN: "control-plane-only",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      forwardedEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      runnerSecrets: {},
    });

    expect(runtime.forwardedEnv).toEqual({});
    expect(runtime.platformEnv).toEqual({
      TELEGRAM_API_BASE_URL: "https://api.telegram.example",
      TELEGRAM_BOT_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
    });
    expect(runtime.userEnv?.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(runtime.resolvedConfig).toBeDefined();
    expect(runtime.resolvedConfig?.channelCapabilities.telegramBotConfigured).toBe(true);
    expect(runtime.resolvedConfig?.deviceSync).toEqual({
      providerConfigs: {
        oura: {
          clientId: "oura-client",
          clientSecret: "oura-secret",
        },
      },
      publicBaseUrl: "https://murph.example/api/device-sync",
      secret: "runtime-codec-secret",
    });
  });

  it("keeps Junction execution credentials in platform env while resolved config stays serializable", () => {
    const runtime = buildHostedRunnerJobRuntimeConfig({
      configSource: {
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://murph.example/api/device-sync",
        DEVICE_SYNC_SECRET: "runtime-codec-secret",
        JUNCTION_API_KEY: "sk_us_fixture",
        JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
        JUNCTION_ENV: "sandbox",
        JUNCTION_PROVIDER_FILTER: "garmin,oura",
        JUNCTION_RECONCILE_DAYS: "14",
        JUNCTION_RECONCILE_INTERVAL_MS: "3600000",
        JUNCTION_REGION: "us",
        JUNCTION_REQUEST_TIMEOUT_MS: "30000",
        JUNCTION_SUMMARY_BACKFILL_DAYS: "7",
        JUNCTION_SUMMARY_RESOURCES: "sleep,profile",
        JUNCTION_TIMESERIES_BACKFILL_DAYS: "3",
        JUNCTION_TIMESERIES_RESOURCES: "steps,heart_rate",
        JUNCTION_WEBHOOK_TIMESTAMP_TOLERANCE_MS: "300000",
        JUNCTION_WEBHOOK_SECRET: "junction-webhook-secret",
      },
      forwardedEnv: {},
      runnerSecrets: {},
    });

    expect(runtime.forwardedEnv).toEqual({});
    expect(runtime.platformEnv).toEqual({
      JUNCTION_API_KEY: "sk_us_fixture",
      JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
      JUNCTION_ENV: "sandbox",
      JUNCTION_PROVIDER_FILTER: "garmin,oura",
      JUNCTION_RECONCILE_DAYS: "14",
      JUNCTION_RECONCILE_INTERVAL_MS: "3600000",
      JUNCTION_REGION: "us",
      JUNCTION_REQUEST_TIMEOUT_MS: "30000",
      JUNCTION_SUMMARY_BACKFILL_DAYS: "7",
      JUNCTION_SUMMARY_RESOURCES: "sleep,profile",
      JUNCTION_TIMESERIES_BACKFILL_DAYS: "3",
      JUNCTION_WEBHOOK_TIMESTAMP_TOLERANCE_MS: "300000",
    });
    expect(runtime.platformEnv).not.toHaveProperty("JUNCTION_WEBHOOK_SECRET");
    expect(runtime.platformEnv).not.toHaveProperty("JUNCTION_TIMESERIES_RESOURCES");
    expect(runtime.resolvedConfig?.deviceSync?.providerConfigs.junction).toMatchObject({
      environment: "sandbox",
      region: "us",
    });
    expect(runtime.resolvedConfig?.deviceSync?.providerConfigs.junction).not.toHaveProperty("apiKey");
    expect(runtime.resolvedConfig?.deviceSync?.providerConfigs.junction).not.toHaveProperty(
      "clientUserIdSecret",
    );
    expect(runtime.resolvedConfig?.deviceSync?.providerConfigs.junction).not.toHaveProperty(
      "timeseriesResources",
    );
  });
});

describe("buildHostedRuntimeResolvedConfig", () => {
  it("derives explicit channel capabilities from the forwarded runner env", () => {
    expect(buildHostedRuntimeResolvedConfig({
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SEND_READY: "true",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    })).toMatchObject({
      channelCapabilities: {
        emailSendReady: true,
        telegramBotConfigured: true,
      },
      deviceSync: null,
    });
  });

  it("enables device sync from trusted runtime secrets without shared provider credentials", () => {
    expect(buildHostedRuntimeResolvedConfig({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
      DEVICE_SYNC_SECRET: "secret_123",
    })).toMatchObject({
      channelCapabilities: {
        emailSendReady: false,
        telegramBotConfigured: false,
      },
      deviceSync: {
        providerConfigs: {},
        publicBaseUrl: "https://device-sync.example.test",
        secret: "secret_123",
      },
    });

    expect(buildHostedRuntimeResolvedConfig({
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
    const resolved = buildHostedRuntimeResolvedConfig({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
      DEVICE_SYNC_SECRET: "secret_123",
      OURA_CLIENT_ID: "oura-client",
      OURA_CLIENT_SECRET: "oura-secret",
      OURA_WEBHOOK_VERIFICATION_TOKEN: "verification-token",
    });

    expect(resolved).toMatchObject({
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
  it("keeps device-sync outside the default runner env profiles while reusing shared provider env key lists", () => {
    const deployEnv = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "murph-runner",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
    });

    expect(deployEnv.workerVars.HOSTED_EXECUTION_RUNNER_ENV_PROFILES).toBe(
      "exa,hosted-email,linq,mapbox,telegram",
    );
    expect(HOSTED_WORKER_OPTIONAL_SECRET_NAMES).toEqual(
      expect.arrayContaining([
        "JUNCTION_API_KEY",
        "JUNCTION_CLIENT_USER_ID_SECRET",
        "JUNCTION_WEBHOOK_SECRET",
      ]),
    );
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).toEqual(
      expect.arrayContaining(["JUNCTION_ENV", "JUNCTION_REGION"]),
    );
    expect(HOSTED_WORKER_OPTIONAL_SECRET_NAMES).toEqual(
      expect.arrayContaining([
        "LINQ_API_TOKEN",
        "EXA_API_KEY",
        "MAPBOX_ACCESS_TOKEN",
        "TELEGRAM_BOT_TOKEN",
      ]),
    );
    expect(HOSTED_WORKER_REQUIRED_SECRET_NAMES).toEqual(
      expect.arrayContaining(["MURPH_DATA_API_KEY", "OPENAI_API_KEY"]),
    );
    for (const retiredWhatsAppSecret of [
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_APP_SECRET",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_VERIFY_TOKEN",
    ]) {
      expect(HOSTED_WORKER_OPTIONAL_SECRET_NAMES).not.toContain(retiredWhatsAppSecret);
    }
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).toEqual(
      expect.arrayContaining([
        "HOSTED_ASSISTANT_PROVIDER",
        "MURPH_ANDROID_APP_ENABLED",
        "WHOOP_SCOPES",
      ]),
    );
    for (const retiredVeniceModelVar of [
      "HOSTED_VENICE_LUNA_MODEL",
      "HOSTED_VENICE_SOL_MODEL",
      "HOSTED_VENICE_TERRA_MODEL",
    ]) {
      expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).not.toContain(
        retiredVeniceModelVar,
      );
    }
    expect(HOSTED_WORKER_OPTIONAL_SECRET_NAMES).toContain("VENICE_API_KEY");
    for (const retiredWhatsAppVar of [
      "WHATSAPP_API_BASE_URL",
      "WHATSAPP_GRAPH_VERSION",
    ]) {
      expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).not.toContain(retiredWhatsAppVar);
    }
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).not.toContain(
      "HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS",
    );
    for (const removedProviderSecret of [
      "ANTHROPIC_API_KEY",
      "LITELLM_PROXY_API_KEY",
      "OLLAMA_API_KEY",
      "OPENROUTER_API_KEY",
    ]) {
      expect(HOSTED_WORKER_OPTIONAL_SECRET_NAMES).not.toContain(
        removedProviderSecret,
      );
    }
    expect(HOSTED_WORKER_OPTIONAL_SECRET_NAMES).not.toContain(
      "OURA_WEBHOOK_VERIFICATION_TOKEN",
    );
    expect(HOSTED_WORKER_OPTIONAL_SECRET_NAMES).not.toContain(
      "HOSTED_AI_USAGE_GATE_ALLOW_SIGNING_KEY_ID",
    );
    expect(HOSTED_WORKER_OPTIONAL_SECRET_NAMES).not.toContain(
      "HOSTED_AI_USAGE_GATE_ALLOW_SIGNING_SECRET",
    );
    expect(HOSTED_WORKER_OPTIONAL_SECRET_NAMES).not.toContain("GARMIN_CLIENT_ID");
    expect(HOSTED_WORKER_OPTIONAL_SECRET_NAMES).not.toContain("GARMIN_CLIENT_SECRET");
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).not.toContain(
      "OURA_WEBHOOK_VERIFICATION_TOKEN",
    );
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).not.toContain("GARMIN_API_BASE_URL");
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).not.toContain("JUNCTION_RESOURCE_OVERRIDES");
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).not.toContain(
      "JUNCTION_TIMESERIES_RESOURCES",
    );
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).toContain(
      "LINQ_ATTACHMENT_CDN_BASE_URL",
    );
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).not.toContain("FFMPEG_COMMAND");
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).not.toContain("WHISPER_COMMAND");
    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).not.toContain("WHISPER_MODEL_PATH");
  });
});

describe("hosted private-media platform env", () => {
  it("keeps the deployment Worker origin in the trusted container platform env", () => {
    expect(buildHostedRunnerContainerPlatformEnv({
      CF_PUBLIC_BASE_URL: "https://hosted-runner-staging.example.test",
      HOSTED_PHYSICAL_NOTES_ENABLED: "true",
    })).toEqual({
      CF_PUBLIC_BASE_URL: "https://hosted-runner-staging.example.test",
      HOSTED_PHYSICAL_NOTES_ENABLED: "true",
    });
  });

  it("projects the Android rollout gate only from the exact enabled value", () => {
    expect(buildHostedRunnerContainerPlatformEnv({
      MURPH_ANDROID_APP_ENABLED: "1",
    })).toEqual({
      MURPH_ANDROID_APP_ENABLED: "1",
    });
    for (const disabledValue of ["", "0", "true", " 1 "]) {
      expect(buildHostedRunnerContainerPlatformEnv({
        MURPH_ANDROID_APP_ENABLED: disabledValue,
      })).not.toHaveProperty("MURPH_ANDROID_APP_ENABLED");
    }
  });
});
