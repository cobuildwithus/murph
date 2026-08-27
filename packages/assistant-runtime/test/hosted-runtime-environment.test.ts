import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test, vi } from "vitest";
import type { HostedAssistantDeliveryRecord } from "@murphai/hosted-execution/side-effects";

import type { HostedRuntimePlatform } from "../src/hosted-runtime/platform.ts";
import {
  buildHostedRunnerExecutablePath,
  buildHostedPlatformBackedRuntimeEnv,
  HOSTED_RUNNER_EXECUTABLE_PATH,
  normalizeHostedAssistantRuntimeConfig,
  projectHostedRuntimeProcessEnv,
  withHostedProcessEnvironment,
} from "../src/hosted-runtime/environment.ts";
import {
  buildHostedRuntimeChildEnv,
  buildHostedRuntimeForwardedEnv,
  buildHostedRuntimeLaunchSpec,
  buildHostedRuntimePlatformEnv,
  buildHostedRuntimeResolvedConfig,
  HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
  HOSTED_RUNTIME_ENV_KEY_NAMES,
  HOSTED_RUNTIME_ENV_PROFILE_KEYS,
  readHostedRuntimeCommitTimeoutConfigValue,
} from "../src/hosted-runtime/launch-spec.ts";
import {
  createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";

function createHostedRuntimePlatformStub(): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: {
      async deletePreparedAssistantDelivery() {},
      async readRawEmailMessage() {
        return null;
      },
      async readAssistantDeliveryRecord() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
      async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
        return record;
      },
    },
  };
}

test("hosted runtime config copies user and forwarded env maps", () => {
  const platform = createHostedRuntimePlatformStub();
  const forwardedEnv = { OPENAI_API_KEY: "secret" };
  const parserToolchain = {
    tools: {
      whisper: {
        command: "/usr/local/bin/whisper-cli",
        modelPath: "/home/runner/.murph/models/whisper/ggml-base.en.bin",
      },
    },
  };
  const platformEnv = { TELEGRAM_BOT_TOKEN: "telegram-token" };
  const resolvedConfig = createHostedRuntimeResolvedConfig();
  const userEnv = { ANTHROPIC_API_KEY: "anthropic-secret" };

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      commitTimeoutMs: 45_000,
      forwardedEnv,
      parserToolchain,
      platformEnv,
      resolvedConfig,
      userEnv,
    },
    platform,
  );

  assert.equal(normalized.platform, platform);
  assert.equal(normalized.commitTimeoutMs, 45_000);
  assert.deepEqual(normalized.forwardedEnv, forwardedEnv);
  assert.notEqual(normalized.forwardedEnv, forwardedEnv);
  assert.deepEqual(normalized.parserToolchain, parserToolchain);
  assert.notEqual(normalized.parserToolchain, parserToolchain);
  assert.notEqual(normalized.parserToolchain?.tools, parserToolchain.tools);
  assert.notEqual(
    normalized.parserToolchain?.tools.whisper,
    parserToolchain.tools.whisper,
  );
  assert.deepEqual(normalized.platformEnv, platformEnv);
  assert.notEqual(normalized.platformEnv, platformEnv);
  assert.deepEqual(normalized.resolvedConfig, resolvedConfig);
  assert.notEqual(normalized.resolvedConfig, resolvedConfig);
  assert.deepEqual(normalized.userEnv, userEnv);
  assert.notEqual(normalized.userEnv, userEnv);
});

test("hosted runtime config rejects platform-owned asset-root env overrides from every producer", () => {
  const platform = createHostedRuntimePlatformStub();
  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      forwardedEnv: {
        MURPH_HEALTH_COMMONS_PACKAGE_ROOT: "/tmp/attacker-health-commons",
        MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH: "/tmp/attacker-contract.json",
        MURPH_ASSISTANT_SKILLS_ROOT: "/tmp/attacker-skills",
        OPENAI_API_KEY: "secret",
      },
      resolvedConfig: createHostedRuntimeResolvedConfig(),
      userEnv: {
        ANTHROPIC_API_KEY: "anthropic-secret",
        MURPH_HEALTH_COMMONS_PACKAGE_ROOT: "/tmp/attacker-health-commons",
        MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH: "/tmp/attacker-contract.json",
        MURPH_ASSISTANT_SKILLS_ROOT: "/tmp/attacker-skills",
      },
    },
    platform,
  );

  // The runtime boundary guards code-location-sensitive package roots for all
  // job producers, not only the Cloudflare runner-secret policy.
  assert.deepEqual(normalized.forwardedEnv, { OPENAI_API_KEY: "secret" });
  assert.deepEqual(normalized.userEnv, { ANTHROPIC_API_KEY: "anthropic-secret" });
});

test("hosted runtime env policy imports only the zero-dependency assistant skill env contract", async () => {
  const policyModules = [
    "../src/hosted-runtime/environment.ts",
    "../src/hosted-runtime/codex-shell-env-policy.ts",
  ];

  for (const policyModule of policyModules) {
    const source = await readFile(new URL(policyModule, import.meta.url), "utf8");
    assert.match(
      source,
      /@murphai\/assistant-engine\/assistant-skill-env/u,
      `${policyModule} should import the worker-safe skill env-name contract`,
    );
    assert.doesNotMatch(
      source,
      /@murphai\/assistant-engine\/assistant-skill-assets/u,
      `${policyModule} must not import the Node/process-bearing skill asset module`,
    );
  }
});

test("hosted runtime config rejects parserToolchain:null", () => {
  assert.throws(
    () =>
      normalizeHostedAssistantRuntimeConfig(
        JSON.parse('{"parserToolchain":null}'),
        createHostedRuntimePlatformStub(),
      ),
    /Hosted runtime parserToolchain:null is not supported/u,
  );
});

test("hosted runtime config rejects null or empty parser tool paths", () => {
  assert.throws(
    () =>
      normalizeHostedAssistantRuntimeConfig(
        JSON.parse('{"parserToolchain":{"tools":{"whisper":{"command":null}}}}'),
        createHostedRuntimePlatformStub(),
      ),
    /Hosted runtime parser toolchain command must be a non-empty absolute path/u,
  );

  assert.throws(
    () =>
      normalizeHostedAssistantRuntimeConfig(
        {
          parserToolchain: {
            tools: {
              whisper: {
                command: "   ",
              },
            },
          },
        },
        createHostedRuntimePlatformStub(),
      ),
    /Hosted runtime parser toolchain command must be a non-empty absolute path/u,
  );
});

test("hosted runtime config validates transcription endpoints", () => {
  const platform = createHostedRuntimePlatformStub();

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      parserToolchain: {
        tools: {
          transcription: {
            endpoint: "  http://murph-transcribe.worker/v1/transcribe  ",
          },
        },
      },
    },
    platform,
  );
  assert.deepEqual(normalized.parserToolchain, {
    tools: {
      transcription: {
        endpoint: "http://murph-transcribe.worker/v1/transcribe",
      },
    },
  });

  assert.throws(
    () =>
      normalizeHostedAssistantRuntimeConfig(
        {
          parserToolchain: {
            tools: {
              transcription: {
                endpoint: "   ",
              },
            },
          },
        },
        platform,
      ),
    /Hosted runtime parser toolchain endpoint must be a non-empty http\(s\) URL/u,
  );

  assert.throws(
    () =>
      normalizeHostedAssistantRuntimeConfig(
        {
          parserToolchain: {
            tools: {
              transcription: {
                endpoint: "v1/transcribe",
              },
            },
          },
        },
        platform,
      ),
    /Hosted runtime parser toolchain endpoint must be an absolute http\(s\) URL/u,
  );

  assert.throws(
    () =>
      normalizeHostedAssistantRuntimeConfig(
        {
          parserToolchain: {
            tools: {
              transcription: {
                endpoint: "ftp://murph-transcribe.worker/v1/transcribe",
              },
            },
          },
        },
        platform,
      ),
    /Hosted runtime parser toolchain endpoint must be an absolute http\(s\) URL/u,
  );
});

test("hosted runtime launch spec preserves transcription endpoints", () => {
  // The hosted runner job runtime is built worker-side via
  // buildHostedRuntimeLaunchSpec (apps/cloudflare/src/runner-env.ts), so the
  // transcription endpoint must survive this boundary for the container-side
  // parser registry to activate the remote-transcription provider.
  assert.deepEqual(
    buildHostedRuntimeLaunchSpec({
      forwardedEnv: {},
      parserToolchain: {
        tools: {
          ffmpeg: {
            command: "/usr/bin/ffmpeg",
          },
          transcription: {
            endpoint: "http://murph-transcribe.worker/v1/transcribe",
          },
        },
      },
    }).runtime.parserToolchain,
    {
      tools: {
        ffmpeg: {
          command: "/usr/bin/ffmpeg",
        },
        transcription: {
          endpoint: "http://murph-transcribe.worker/v1/transcribe",
        },
      },
    },
  );
});

test("hosted runtime launch spec owns semantic env split and runtime config", () => {
  const spec = buildHostedRuntimeLaunchSpec({
    commitTimeoutMs: 45_000,
    configSource: {
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SEND_READY: "true",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    },
    forwardedEnv: {
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      LINQ_API_TOKEN: "linq-token",
      LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      NODE_OPTIONS: "--require /tmp/injected.js",
      OPENAI_API_KEY: "worker-openai-secret",
      TELEGRAM_API_BASE_URL: "https://evil.telegram.example",
      TELEGRAM_BOT_TOKEN: "evil-telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://evil-files.telegram.example",
    },
    platformEnv: {
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      HOSTED_PHYSICAL_NOTES_ENABLED: "true",
      TELEGRAM_API_BASE_URL: "https://api.telegram.example",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
    },
    userEnv: {
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      HOSTED_PHYSICAL_NOTES_ENABLED: "true",
      OPENAI_API_KEY: "user-openai-secret",
      TELEGRAM_BOT_TOKEN: "user-telegram-token",
    },
  });

  assert.deepEqual(spec.runtime, {
    commitTimeoutMs: 45_000,
    forwardedEnv: {
      LINQ_API_TOKEN: "linq-token",
      OPENAI_API_KEY: "worker-openai-secret",
    },
    platformEnv: {
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      HOSTED_PHYSICAL_NOTES_ENABLED: "true",
      TELEGRAM_API_BASE_URL: "https://api.telegram.example",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
    },
    resolvedConfig: {
      channelCapabilities: {
        emailSendReady: true,
        telegramBotConfigured: true,
      },
      deviceSync: null,
      managedAutoReplyChannels: [
        {
          capabilityReady: true,
          channel: "email",
          memberChannel: "email",
        },
        {
          capabilityReady: true,
          channel: "linq",
          memberChannel: "linq",
        },
        {
          capabilityReady: true,
          channel: "telegram",
          memberChannel: "telegram",
        },
      ],
    },
    userEnv: {},
  });
});

test("hosted runtime process env does not project typed parser toolchain into process env", () => {
  const childEnv = projectHostedRuntimeProcessEnv({
    ambientEnv: {
      CODEX_CA_CERTIFICATE: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
      CURL_CA_BUNDLE: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
      HOME: "/ambient/home",
      HTTP_PROXY: "http://ambient-proxy.example.test:8080",
      NODE_EXTRA_CA_CERTS: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
      NO_PROXY: "api.openai.com",
      PATH: "/usr/bin:/bin",
      REQUESTS_CA_BUNDLE: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
      WHISPER_COMMAND: "/ambient/whisper-cli",
    },
    forwardedEnv: {
      FFMPEG_COMMAND: "/stale/ffmpeg",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_FILE: "/tmp/checkpoint-debug.json",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT: "20000",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW: "1",
      HOSTED_CONTAINER_DEBUG_SECRET: "container-debug-secret",
      NODE_ENV: "production",
      OPENAI_API_KEY: "worker-openai-secret",
      HOSTED_WEB_BASE_URL: "https://evil-web.example.test",
      HTTP_PROXY: "http://forwarded-proxy.example.test:8080",
      HTTPS_PROXY: "http://forwarded-proxy.example.test:8080",
      WHISPER_COMMAND: "/stale/whisper-cli",
      WHISPER_MODEL_PATH: "/stale/model.bin",
    },
    platformTransportEnv: {
      ALL_PROXY: "http://platform-all-proxy.example.test:8080",
      HTTP_PROXY: "http://platform-proxy.example.test:8080",
      HTTPS_PROXY: "http://platform-proxy.example.test:8080",
      NO_PROXY: "localhost,127.0.0.1,host.docker.internal",
    },
  });

  assert.deepEqual(childEnv, {
    ALL_PROXY: "http://platform-all-proxy.example.test:8080",
    CODEX_CA_CERTIFICATE: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
    CURL_CA_BUNDLE: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
    HTTP_PROXY: "http://platform-proxy.example.test:8080",
    HTTPS_PROXY: "http://platform-proxy.example.test:8080",
    MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS: "1",
    MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_FILE: "/tmp/checkpoint-debug.json",
    MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG: "1",
    MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT: "20000",
    MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW: "1",
    NO_PROXY: "localhost,127.0.0.1,host.docker.internal",
    NODE_EXTRA_CA_CERTS: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
    NODE_ENV: "production",
    PATH: HOSTED_RUNNER_EXECUTABLE_PATH,
    OPENAI_API_KEY: "worker-openai-secret",
    REQUESTS_CA_BUNDLE: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
  });
  assert.equal("FFMPEG_COMMAND" in childEnv, false);
  assert.equal("HOME" in childEnv, false);
  assert.equal("HOSTED_CONTAINER_DEBUG_SECRET" in childEnv, false);
  assert.equal("HOSTED_WEB_BASE_URL" in childEnv, false);
  assert.equal("PDFINFO_COMMAND" in childEnv, false);
  assert.equal("PDFTOTEXT_COMMAND" in childEnv, false);
  assert.equal("WHISPER_COMMAND" in childEnv, false);
  assert.equal("WHISPER_MODEL_PATH" in childEnv, false);
});

test("hosted runtime process env omits parser path env when no typed toolchain is present", () => {
  assert.deepEqual(
    projectHostedRuntimeProcessEnv({
      ambientEnv: {},
      forwardedEnv: {
        FFMPEG_COMMAND: "/stale/ffmpeg",
        NODE_ENV: "production",
        PDFINFO_COMMAND: "/stale/pdfinfo",
        PDFTOTEXT_COMMAND: "/stale/pdftotext",
        WHISPER_COMMAND: "/stale/whisper-cli",
      },
    }),
    {
      NODE_ENV: "production",
      PATH: HOSTED_RUNNER_EXECUTABLE_PATH,
    },
  );
});

test("hosted runtime process env omits ambient proxy env unless platform transport is supplied", () => {
  assert.deepEqual(
    projectHostedRuntimeProcessEnv({
      ambientEnv: {
        HTTP_PROXY: "http://ambient-proxy.example.test:8080",
        HTTPS_PROXY: "http://ambient-proxy.example.test:8080",
        NO_PROXY: "api.openai.com",
      },
      forwardedEnv: {},
    }),
    {
      PATH: HOSTED_RUNNER_EXECUTABLE_PATH,
    },
  );
});

test("hosted runtime process env strips local device daemon env", () => {
  const childEnv = projectHostedRuntimeProcessEnv({
    ambientEnv: {
      PATH: "/usr/bin:/bin",
    },
    forwardedEnv: {
      DEVICE_SYNC_BASE_URL: "http://127.0.0.1:8788",
      DEVICE_SYNC_CONTROL_TOKEN: "device-control-token",
      DEVICE_SYNC_SECRET: "device-secret",
      DEVICE_SYNC_STATE_DB_PATH: "/tmp/device-sync.sqlite",
      MURPH_HOSTED_RUNTIME_PROCESS: "1",
      NODE_ENV: "production",
      OPENAI_API_KEY: "worker-openai-secret",
    },
  });

  assert.deepEqual(childEnv, {
    NODE_ENV: "production",
    PATH: HOSTED_RUNNER_EXECUTABLE_PATH,
    OPENAI_API_KEY: "worker-openai-secret",
  });
});

test("hosted runtime process env projects image-owned Codex model catalog path from ambient env", () => {
  const childEnv = projectHostedRuntimeProcessEnv({
    ambientEnv: {
      [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]:
        "/usr/local/share/murph/codex-model-catalog.openai-flex.json",
    },
    forwardedEnv: {
      [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: "/tmp/spoofed-catalog.json",
      NODE_ENV: "production",
    },
  });

  assert.deepEqual(childEnv, {
    [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]:
      "/usr/local/share/murph/codex-model-catalog.openai-flex.json",
    NODE_ENV: "production",
    PATH: HOSTED_RUNNER_EXECUTABLE_PATH,
  });
});

test("hosted runtime process env projects image-owned Health Commons package root from ambient env", () => {
  const childEnv = projectHostedRuntimeProcessEnv({
    ambientEnv: {
      MURPH_HEALTH_COMMONS_PACKAGE_ROOT: "/app/node_modules/@murphai/health-commons",
    },
    forwardedEnv: {
      MURPH_HEALTH_COMMONS_PACKAGE_ROOT: "/tmp/spoofed-health-commons",
      NODE_ENV: "production",
    },
  });

  assert.deepEqual(childEnv, {
    MURPH_HEALTH_COMMONS_PACKAGE_ROOT: "/app/node_modules/@murphai/health-commons",
    NODE_ENV: "production",
    PATH: HOSTED_RUNNER_EXECUTABLE_PATH,
  });
});

test("hosted runner executable PATH prepends the image contract and preserves absolute ambient extras", () => {
  assert.equal(
    buildHostedRunnerExecutablePath("/custom/bin:/usr/bin:.:relative/bin:/opt/tools:/bin"),
    `${HOSTED_RUNNER_EXECUTABLE_PATH}:/custom/bin:/opt/tools`,
  );
});

test("hosted runtime launch spec derives platform env from forwarded env only when no explicit platform env is supplied", () => {
  const spec = buildHostedRuntimeLaunchSpec({
    forwardedEnv: {
      OPENAI_API_KEY: "worker-openai-secret",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    },
  });

  assert.deepEqual(spec.runtime.forwardedEnv, {
    OPENAI_API_KEY: "worker-openai-secret",
  });
  assert.deepEqual(spec.runtime.platformEnv, {
    TELEGRAM_BOT_TOKEN: "telegram-token",
  });
});

test("hosted runtime launch spec keeps the Android rollout gate platform-owned and exact", () => {
  const platform = createHostedRuntimePlatformStub();
  const enabled = normalizeHostedAssistantRuntimeConfig(
    buildHostedRuntimeLaunchSpec({
      forwardedEnv: {
        MURPH_ANDROID_APP_ENABLED: "1",
      },
      platformEnv: {
        MURPH_ANDROID_APP_ENABLED: "1",
      },
      userEnv: {
        MURPH_ANDROID_APP_ENABLED: "0",
      },
    }).runtime,
    platform,
  );
  const disabled = normalizeHostedAssistantRuntimeConfig(
    buildHostedRuntimeLaunchSpec({
      forwardedEnv: {
        MURPH_ANDROID_APP_ENABLED: "1",
      },
      platformEnv: {
        MURPH_ANDROID_APP_ENABLED: " 1 ",
      },
      userEnv: {
        MURPH_ANDROID_APP_ENABLED: "1",
      },
    }).runtime,
    platform,
  );

  assert.deepEqual(enabled.platformEnv, {
    MURPH_ANDROID_APP_ENABLED: "1",
  });
  assert.equal(enabled.forwardedEnv.MURPH_ANDROID_APP_ENABLED, undefined);
  assert.equal(enabled.userEnv.MURPH_ANDROID_APP_ENABLED, undefined);
  assert.equal(disabled.platformEnv.MURPH_ANDROID_APP_ENABLED, undefined);
  assert.equal(disabled.forwardedEnv.MURPH_ANDROID_APP_ENABLED, undefined);
  assert.equal(disabled.userEnv.MURPH_ANDROID_APP_ENABLED, undefined);
});

test("hosted runtime launch spec rejects parserToolchain:null", () => {
  assert.throws(
    () =>
      buildHostedRuntimeLaunchSpec({
        forwardedEnv: {},
        parserToolchain: JSON.parse("null"),
      }),
    /Hosted runtime parserToolchain:null is not supported/u,
  );
});

test("hosted runtime launch spec validates explicit parser tool paths", () => {
  assert.deepEqual(
    buildHostedRuntimeLaunchSpec({
      forwardedEnv: {},
      parserToolchain: {
        tools: {
          whisper: {
            command: "  /opt/whisper-cli  ",
            modelPath: "/opt/models/ggml-base.en.bin",
          },
        },
      },
    }).runtime.parserToolchain,
    {
      tools: {
        whisper: {
          command: "/opt/whisper-cli",
          modelPath: "/opt/models/ggml-base.en.bin",
        },
      },
    },
  );

  assert.throws(
    () =>
      buildHostedRuntimeLaunchSpec({
        forwardedEnv: {},
        parserToolchain: JSON.parse(
          '{"tools":{"whisper":{"command":null}}}',
        ),
      }),
    /parserToolchain\.tools\.whisper\.command must be a non-empty absolute path/u,
  );

  assert.throws(
    () =>
      buildHostedRuntimeLaunchSpec({
        forwardedEnv: {},
        parserToolchain: {
          tools: {
            whisper: {
              modelPath: "   ",
            },
          },
        },
      }),
    /parserToolchain\.tools\.whisper\.modelPath must be a non-empty absolute path/u,
  );

  assert.throws(
    () =>
      buildHostedRuntimeLaunchSpec({
        forwardedEnv: {},
        parserToolchain: {
          tools: {
            whisper: {
              command: "whisper-cli",
            },
          },
        },
      }),
    /parserToolchain\.tools\.whisper\.command must be an absolute path/u,
  );
});

test("hosted runtime forwarded env profiles are runtime-owned and transport-mappable", () => {
  assert.deepEqual(
    buildHostedRuntimeForwardedEnv({
      FFMPEG_COMMAND: "/stale/ffmpeg",
      ELEVENLABS_API_KEY: "elevenlabs-token",
      EXA_API_KEY: "exa-token",
      GEMINI_API_KEY: "gemini-token",
      HOSTED_EMAIL: {
        send: async (_message: unknown) => undefined,
      },
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "signing-secret",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "exa,hosted-email,linq,mapbox,parsers,telegram",
      LINQ_API_BASE_URL: "http://127.0.0.1:4011",
      LINQ_API_TOKEN: "linq-token",
      LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      MURPH_ELEVENLABS_VOICE_ID: "voice-murph",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_FILE: "/tmp/checkpoint-debug.json",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT: "20000",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW: "1",
      TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
      WHISPER_COMMAND: "/stale/whisper-cli",
      WHISPER_MODEL_PATH: "/stale/model.bin",
    }, {
      mapValue: ({ key, value }) =>
        key.endsWith("_BASE_URL") ? value.replace("127.0.0.1", "host.internal") : value,
    }),
    {
      ELEVENLABS_API_KEY: "elevenlabs-token",
      EXA_API_KEY: "exa-token",
      GEMINI_API_KEY: "gemini-token",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SEND_READY: "true",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      LINQ_API_BASE_URL: "http://host.internal:4011",
      LINQ_API_TOKEN: "linq-token",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      MURPH_ELEVENLABS_VOICE_ID: "voice-murph",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_FILE: "/tmp/checkpoint-debug.json",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT: "20000",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW: "1",
      NODE_ENV: "production",
      TELEGRAM_API_BASE_URL: "http://host.internal:4012",
      TELEGRAM_FILE_BASE_URL: "http://host.internal:4013",
    },
  );
});

test("hosted runtime parsers profile is semantic and forwards no native paths", () => {
  assert.deepEqual(HOSTED_RUNTIME_ENV_PROFILE_KEYS.exa, ["EXA_API_KEY"]);
  assert.deepEqual(HOSTED_RUNTIME_ENV_PROFILE_KEYS.parsers, []);
  assert.deepEqual(
    buildHostedRuntimeForwardedEnv({
      FFMPEG_COMMAND: "/stale/ffmpeg",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "parsers",
      PDFINFO_COMMAND: "/stale/pdfinfo",
      PDFTOTEXT_COMMAND: "/stale/pdftotext",
      WHISPER_COMMAND: "/stale/whisper-cli",
      WHISPER_MODEL_PATH: "/stale/model.bin",
    }),
    {
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    },
  );
});

test("hosted assistant runtime never forwards an xAI base URL override", () => {
  assert.equal(
    (HOSTED_RUNTIME_ENV_PROFILE_KEYS.assistant as readonly string[])
      .includes("XAI_API_BASE_URL"),
    false,
  );
  assert.equal(HOSTED_RUNTIME_ENV_KEY_NAMES.includes("XAI_API_BASE_URL"), false);
});

test("hosted runtime child env projection is a transport projection of forwarded env only", () => {
  assert.deepEqual(
    buildHostedRuntimeChildEnv({
      forwardedEnv: {
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        OPENAI_API_KEY: "worker-openai-secret",
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    }),
    {
      OPENAI_API_KEY: "worker-openai-secret",
    },
  );
});

test("hosted runtime platform env selector and timeout parser are reusable outside Cloudflare", () => {
  assert.deepEqual(
    buildHostedRuntimePlatformEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      HOSTED_PHYSICAL_NOTES_ENABLED: "true",
      JUNCTION_API_KEY: "junction-api-key",
      JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
      JUNCTION_ENV: "sandbox",
      JUNCTION_REGION: "us",
      JUNCTION_WEBHOOK_SECRET: "junction-webhook-secret",
      TELEGRAM_API_BASE_URL: "https://api.telegram.example",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
    }),
    {
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      HOSTED_PHYSICAL_NOTES_ENABLED: "true",
      JUNCTION_API_KEY: "junction-api-key",
      JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
      JUNCTION_ENV: "sandbox",
      JUNCTION_REGION: "us",
      TELEGRAM_API_BASE_URL: "https://api.telegram.example",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
    },
  );
  assert.equal(readHostedRuntimeCommitTimeoutConfigValue("45000"), 45_000);
  assert.equal(Number.isNaN(readHostedRuntimeCommitTimeoutConfigValue("45000abc")), true);
});

test("hosted runtime resolved config derives typed channel and device-sync state", () => {
  const resolved = buildHostedRuntimeResolvedConfig({
    DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
    DEVICE_SYNC_SECRET: "secret_123",
    WHOOP_CLIENT_ID: "whoop-client",
    WHOOP_CLIENT_SECRET: "whoop-secret",
    HOSTED_EMAIL_DOMAIN: "mail.example.test",
    HOSTED_EMAIL_INGRESS_READY: "true",
    HOSTED_EMAIL_LOCAL_PART: "assistant",
    HOSTED_EMAIL_SEND_READY: "true",
    TELEGRAM_BOT_TOKEN: "telegram-token",
  });

  assert.deepEqual(resolved.channelCapabilities, {
    emailSendReady: true,
    telegramBotConfigured: true,
  });
  assert.deepEqual(resolved.deviceSync, {
    providerConfigs: {
      whoop: {
        clientId: "whoop-client",
        clientSecret: "whoop-secret",
      },
    },
    publicBaseUrl: "https://device-sync.example.test",
    secret: "secret_123",
  });
});

test("hosted platform-backed env merges non-secret forwarded env with platform-only secrets", () => {
  assert.deepEqual(
    buildHostedPlatformBackedRuntimeEnv({
      forwardedEnv: {
        OPENAI_API_KEY: "openai-secret",
      },
      platformEnv: {
        JUNCTION_API_KEY: "junction-api-key",
        TELEGRAM_API_BASE_URL: "https://api.telegram.test",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.test",
      },
    }),
    {
      OPENAI_API_KEY: "openai-secret",
      TELEGRAM_API_BASE_URL: "https://api.telegram.test",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.test",
    },
  );
});

test("hosted platform-backed env keeps platform Telegram values when forwarded env collides", () => {
  assert.deepEqual(
    buildHostedPlatformBackedRuntimeEnv({
      forwardedEnv: {
        OPENAI_API_KEY: "openai-secret",
        TELEGRAM_API_BASE_URL: "https://evil.telegram.test",
        TELEGRAM_BOT_TOKEN: "evil-telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://evil-files.telegram.test",
      },
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.test",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.test",
      },
    }),
    {
      OPENAI_API_KEY: "openai-secret",
      TELEGRAM_API_BASE_URL: "https://api.telegram.test",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.test",
    },
  );
});

test("hosted runtime config strips hosted data API config from runtime env", () => {
  const platform = createHostedRuntimePlatformStub();

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      platformEnv: {
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        MURPH_DATA_API_KEY: "data-api-secret",
      },
      userEnv: {
        HOSTED_WEB_BASE_URL: "https://evil-web.example.test",
        MURPH_DATA_API_KEY: "evil-data-api-secret",
      },
    },
    platform,
  );

  assert.deepEqual(normalized.platformEnv, {});
  assert.deepEqual(normalized.userEnv, {});
});

test("hosted runtime config strips ingress-only secrets from forwarded env", () => {
  const platform = createHostedRuntimePlatformStub();

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      userEnv: {
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
        OPENAI_API_KEY: "openai-secret",
      },
    },
    platform,
  );

  assert.deepEqual(normalized.forwardedEnv, {
    LINQ_API_TOKEN: "linq-token",
  });
  assert.deepEqual(normalized.userEnv, {});
});

test("hosted runtime config lets platform forward Codex dev overrides but strips user overrides", () => {
  const platform = createHostedRuntimePlatformStub();
  const encodedChatGptAuthJson = Buffer.from(
    JSON.stringify({ auth_mode: "chatgptAuthTokens", tokens: { access_token: "token" } }),
    "utf8",
  ).toString("base64url");

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      forwardedEnv: {
        GEMINI_API_KEY: "gemini-secret",
        [HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]: encodedChatGptAuthJson,
        [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]:
          "/usr/local/share/murph/codex-model-catalog.openai-flex.json",
        [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
          "http://127.0.0.1:4111/v1",
        OPENAI_API_KEY: "openai-secret",
      },
      userEnv: {
        GEMINI_API_KEY: "user-gemini-secret",
        [HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]: "user-controlled-auth-seed",
        [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]:
          "/tmp/user-controlled-catalog.json",
        [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
          "http://evil.example.test/v1",
        OPENAI_API_KEY: "user-openai-secret",
      },
    },
    platform,
  );

  assert.deepEqual(normalized.forwardedEnv, {
    GEMINI_API_KEY: "gemini-secret",
    [HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]: encodedChatGptAuthJson,
    [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
      "http://127.0.0.1:4111/v1",
    OPENAI_API_KEY: "openai-secret",
  });
  assert.deepEqual(normalized.userEnv, {});
});

test("hosted runtime config strips platform-only Telegram vars from forwarded and user env", () => {
  const platform = createHostedRuntimePlatformStub();

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      forwardedEnv: {
        OPENAI_API_KEY: "openai-secret",
        TELEGRAM_API_BASE_URL: "https://evil.telegram.example",
      },
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      userEnv: {
        OPENAI_API_KEY: "user-openai-secret",
        TELEGRAM_API_BASE_URL: "https://user.telegram.example",
        TELEGRAM_BOT_TOKEN: "user-telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://user-files.telegram.example",
      },
    },
    platform,
  );

  assert.deepEqual(normalized.forwardedEnv, {
    OPENAI_API_KEY: "openai-secret",
  });
  assert.deepEqual(normalized.platformEnv, {
    TELEGRAM_API_BASE_URL: "https://api.telegram.example",
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
  });
  assert.deepEqual(normalized.userEnv, {});
});

test("hosted runtime preserves trusted Linq attachment CDN config outside user env", () => {
  const platform = createHostedRuntimePlatformStub();

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      forwardedEnv: {
        LINQ_ATTACHMENT_CDN_BASE_URL: "https://forwarded-cdn.linq.example",
        OPENAI_API_KEY: "openai-secret",
      },
      platformEnv: {
        LINQ_ATTACHMENT_CDN_BASE_URL: "https://platform-cdn.linq.example",
      },
      userEnv: {
        LINQ_ATTACHMENT_CDN_BASE_URL: "http://169.254.169.254/attachments",
        OPENAI_API_KEY: "user-openai-secret",
      },
    },
    platform,
  );

  assert.deepEqual(normalized.forwardedEnv, {
    LINQ_ATTACHMENT_CDN_BASE_URL: "https://forwarded-cdn.linq.example",
    OPENAI_API_KEY: "openai-secret",
  });
  assert.deepEqual(normalized.platformEnv, {
    LINQ_ATTACHMENT_CDN_BASE_URL: "https://platform-cdn.linq.example",
  });
  assert.deepEqual(normalized.userEnv, {});
  assert.deepEqual(
    buildHostedRuntimePlatformEnv({
      LINQ_ATTACHMENT_CDN_BASE_URL: "https://platform-cdn.linq.example",
    }),
    {
      LINQ_ATTACHMENT_CDN_BASE_URL: "https://platform-cdn.linq.example",
    },
  );
});

test("hosted runtime config strips hosted control-plane secrets from forwarded and user env", () => {
  const platform = createHostedRuntimePlatformStub();

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      forwardedEnv: {
        CURL_CA_BUNDLE: "/tmp/forwarded-curl-ca.pem",
        LD_PRELOAD: "/tmp/injected.so",
        CODEX_HOME: "/tmp/forwarded-codex-home",
        HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
        HOSTED_ASSISTANT_BASE_URL: "https://legacy-provider.example.test/v1",
        HOSTED_CONTAINER_DEBUG_SECRET: "container-debug-secret",
        NODE_OPTIONS: "--require /tmp/injected.js",
        PATH: "/tmp/custom-bin",
        HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: "authority-public-pem",
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:8787",
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
        HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
        HTTPS_PROXY: "http://forwarded-proxy.example.test:8080",
        NODE_EXTRA_CA_CERTS: "/tmp/forwarded-ca.pem",
        NPM_CONFIG_USERCONFIG: "/tmp/forwarded-npmrc",
        REQUESTS_CA_BUNDLE: "/tmp/forwarded-requests-ca.pem",
        SSL_CERT_FILE: "/tmp/forwarded-cert.pem",
        TMPDIR: "/tmp/forwarded-tmp",
        OPENAI_API_KEY: "openai-secret",
      },
      userEnv: {
        CF_ACCOUNT_ID: "cf-account",
        CURL_CA_BUNDLE: "/tmp/user-curl-ca.pem",
        LD_PRELOAD: "/tmp/user-injected.so",
        CODEX_HOME: "/tmp/user-codex-home",
        HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
        HOSTED_ASSISTANT_BASE_URL: "https://user-legacy-provider.example.test/v1",
        HOSTED_CONTAINER_DEBUG_SECRET: "user-container-debug-secret",
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_WEB_BASE_URL: "https://evil-web.example.test",
        NODE_OPTIONS: "--require /tmp/user-injected.js",
        PATH: "/tmp/user-bin",
        PDFTOTEXT_COMMAND: "/tmp/user-pdftotext",
        HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: "authority-public-pem",
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
        HTTPS_PROXY: "http://user-proxy.example.test:8080",
        NODE_EXTRA_CA_CERTS: "/tmp/user-ca.pem",
        NPM_CONFIG_USERCONFIG: "/tmp/user-npmrc",
        REQUESTS_CA_BUNDLE: "/tmp/user-requests-ca.pem",
        SSL_CERT_FILE: "/tmp/user-cert.pem",
        TMPDIR: "/tmp/user-tmp",
        OPENAI_API_KEY: "user-openai-secret",
        WRANGLER_API_TOKEN: "wrangler-user-secret",
      },
    },
    platform,
  );

  assert.deepEqual(normalized.forwardedEnv, {
    OPENAI_API_KEY: "openai-secret",
  });
  assert.deepEqual(normalized.userEnv, {});
});

test("hosted platform-backed env strips non-platform entries from platform env", () => {
  assert.deepEqual(
    buildHostedPlatformBackedRuntimeEnv({
      forwardedEnv: {
        OPENAI_API_KEY: "openai-secret",
      },
      platformEnv: {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
        OPENAI_API_KEY: "platform-openai-secret",
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    }),
    {
      OPENAI_API_KEY: "openai-secret",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    },
  );
});

test("hosted runtime config deep-clones resolved device-sync provider config", () => {
  const platform = createHostedRuntimePlatformStub();
  const ouraScopes = ["daily", "sleep"];
  const resolvedConfig = createHostedRuntimeResolvedConfig({
    deviceSync: {
      providerConfigs: {
        junction: {
          environment: "sandbox",
          providerFilter: ["garmin"],
          region: "us",
        },
        oura: {
          clientId: "oura-client",
          clientSecret: "oura-secret",
          scopes: ouraScopes,
        },
        whoop: {
          clientId: "whoop-client",
          clientSecret: "whoop-secret",
          scopes: ["read:profile", "offline"],
        },
      },
      publicBaseUrl: "https://device-sync.example.test",
      secret: "secret_123",
    },
  });
  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      resolvedConfig,
    },
    platform,
  );

  assert.deepEqual(
    normalized.resolvedConfig.channelCapabilities,
    resolvedConfig.channelCapabilities,
  );
  assert.equal(
    normalized.resolvedConfig.deviceSync?.publicBaseUrl,
    resolvedConfig.deviceSync?.publicBaseUrl,
  );
  assert.equal(
    normalized.resolvedConfig.deviceSync?.secret,
    resolvedConfig.deviceSync?.secret,
  );
  assert.deepEqual(
    normalized.resolvedConfig.deviceSync?.providerConfigs.junction,
    {
      environment: "sandbox",
      providerFilter: ["garmin"],
      region: "us",
    },
  );
  assert.deepEqual(
    normalized.resolvedConfig.deviceSync?.providerConfigs.oura,
    {
      clientId: "oura-client",
      clientSecret: "oura-secret",
      scopes: ["daily", "sleep"],
    },
  );
  assert.deepEqual(
    normalized.resolvedConfig.deviceSync?.providerConfigs.whoop,
    resolvedConfig.deviceSync?.providerConfigs.whoop,
  );
  assert.notEqual(normalized.resolvedConfig.deviceSync, resolvedConfig.deviceSync);
  assert.notEqual(
    normalized.resolvedConfig.deviceSync?.providerConfigs,
    resolvedConfig.deviceSync?.providerConfigs,
  );
  assert.notEqual(
    normalized.resolvedConfig.deviceSync?.providerConfigs.oura?.scopes,
    resolvedConfig.deviceSync?.providerConfigs.oura?.scopes,
  );
  assert.notEqual(
    normalized.resolvedConfig.deviceSync?.providerConfigs.whoop?.scopes,
    resolvedConfig.deviceSync?.providerConfigs.whoop?.scopes,
  );
  assert.notEqual(
    normalized.resolvedConfig.deviceSync?.providerConfigs.oura?.scopes,
    ouraScopes,
  );
});

test("withHostedProcessEnvironment restores overwritten and newly introduced env values", async () => {
  const roots = await createHostedProcessEnvironmentTestRoots("hosted-env-restore-");
  const originalHome = process.env.HOME;
  const originalVault = process.env.VAULT;
  const originalCustom = process.env.CUSTOM_HOSTED_ENV;
  const originalWorkingDirectory = process.cwd();

  process.env.HOME = "/tmp/original-home";
  process.env.VAULT = "/tmp/original-vault";
  delete process.env.CUSTOM_HOSTED_ENV;

  try {
    await withHostedProcessEnvironment(
      {
        envOverrides: {
          CUSTOM_HOSTED_ENV: "present",
        },
        operatorHomeRoot: roots.operatorHomeRoot,
        vaultRoot: roots.vaultRoot,
      },
      async () => {
        assert.equal(process.cwd(), roots.vaultRoot);
        assert.equal(process.env.HOME, roots.operatorHomeRoot);
        assert.equal(process.env.VAULT, roots.vaultRoot);
        assert.equal(process.env.CUSTOM_HOSTED_ENV, "present");
      },
    );

    assert.equal(process.cwd(), originalWorkingDirectory);
    assert.equal(process.env.HOME, "/tmp/original-home");
    assert.equal(process.env.VAULT, "/tmp/original-vault");
    assert.equal(process.env.CUSTOM_HOSTED_ENV, undefined);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalVault === undefined) {
      delete process.env.VAULT;
    } else {
      process.env.VAULT = originalVault;
    }

    if (originalCustom === undefined) {
      delete process.env.CUSTOM_HOSTED_ENV;
    } else {
      process.env.CUSTOM_HOSTED_ENV = originalCustom;
    }
    await removeHostedProcessEnvironmentTestRoots(roots);
  }
});

test("withHostedProcessEnvironment restores env if cwd restoration fails", async () => {
  const roots = await createHostedProcessEnvironmentTestRoots("hosted-env-restore-cwd-fail-");
  const originalHome = process.env.HOME;
  const originalVault = process.env.VAULT;
  const originalCustom = process.env.CUSTOM_HOSTED_ENV;
  const originalWorkingDirectory = process.cwd();
  const restoreError = new Error("restore cwd failed");
  let hostedCwdRequested = false;
  const chdirSpy = vi.spyOn(process, "chdir").mockImplementation((directory) => {
    if (directory === roots.vaultRoot) {
      hostedCwdRequested = true;
      return;
    }

    if (hostedCwdRequested && directory === originalWorkingDirectory) {
      throw restoreError;
    }
  });

  process.env.HOME = "/tmp/original-home";
  process.env.VAULT = "/tmp/original-vault";
  delete process.env.CUSTOM_HOSTED_ENV;

  try {
    await assert.rejects(
      withHostedProcessEnvironment(
        {
          envOverrides: {
            CUSTOM_HOSTED_ENV: "present",
          },
          operatorHomeRoot: roots.operatorHomeRoot,
          vaultRoot: roots.vaultRoot,
        },
        async () => {
          assert.equal(process.env.HOME, roots.operatorHomeRoot);
          assert.equal(process.env.VAULT, roots.vaultRoot);
          assert.equal(process.env.CUSTOM_HOSTED_ENV, "present");
        },
      ),
      {
        message: restoreError.message,
      },
    );

    assert.equal(hostedCwdRequested, true);
    assert.equal(process.env.HOME, "/tmp/original-home");
    assert.equal(process.env.VAULT, "/tmp/original-vault");
    assert.equal(process.env.CUSTOM_HOSTED_ENV, undefined);
  } finally {
    chdirSpy.mockRestore();

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalVault === undefined) {
      delete process.env.VAULT;
    } else {
      process.env.VAULT = originalVault;
    }

    if (originalCustom === undefined) {
      delete process.env.CUSTOM_HOSTED_ENV;
    } else {
      process.env.CUSTOM_HOSTED_ENV = originalCustom;
    }
    await removeHostedProcessEnvironmentTestRoots(roots);
  }
});

test("withHostedProcessEnvironment replaces ambient env with the hosted runtime projection", async () => {
  const roots = await createHostedProcessEnvironmentTestRoots("hosted-env-projection-");
  const originalValues = new Map(
    [
      "AMBIENT_CHANNEL_SECRET",
      "CODEX_CA_CERTIFICATE",
      "CURL_CA_BUNDLE",
      "CUSTOM_HOSTED_ENV",
      "HOSTED_ASSISTANT_BASE_URL",
      "HOSTED_ASSISTANT_PROVIDER_NAME",
      "HOSTED_EXECUTION_CONTROL_TOKEN",
      "MURPH_HOSTED_RUNTIME_PROCESS",
      "MUTATED_DURING_HOSTED_ENV",
      "NODE_EXTRA_CA_CERTS",
      "PATH",
      "HOME",
      "VAULT",
      "OPENAI_API_KEY",
      "REQUESTS_CA_BUNDLE",
    ].map((key) => [key, process.env[key]]),
  );

  process.env.AMBIENT_CHANNEL_SECRET = "ambient-secret";
  process.env.CODEX_CA_CERTIFICATE = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
  process.env.CURL_CA_BUNDLE = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
  process.env.HOSTED_ASSISTANT_BASE_URL = "https://legacy-provider.example.test/v1";
  process.env.HOSTED_ASSISTANT_PROVIDER_NAME = "legacy-provider";
  process.env.HOSTED_EXECUTION_CONTROL_TOKEN = "control-secret";
  process.env.NODE_EXTRA_CA_CERTS = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
  process.env.PATH = "/usr/bin";
  process.env.HOME = "/tmp/original-home";
  process.env.VAULT = "/tmp/original-vault";
  process.env.OPENAI_API_KEY = "ambient-openai-secret";
  process.env.REQUESTS_CA_BUNDLE = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
  delete process.env.CUSTOM_HOSTED_ENV;
  delete process.env.MURPH_HOSTED_RUNTIME_PROCESS;
  delete process.env.MUTATED_DURING_HOSTED_ENV;

  try {
    await withHostedProcessEnvironment(
      {
        envOverrides: {
          CUSTOM_HOSTED_ENV: "runtime-value",
          OPENAI_API_KEY: "runtime-openai-secret",
        },
        operatorHomeRoot: roots.operatorHomeRoot,
        vaultRoot: roots.vaultRoot,
      },
      async () => {
        assert.equal(process.env.AMBIENT_CHANNEL_SECRET, undefined);
        assert.equal(process.env.HOSTED_ASSISTANT_BASE_URL, undefined);
        assert.equal(process.env.HOSTED_ASSISTANT_PROVIDER_NAME, undefined);
        assert.equal(process.env.HOSTED_EXECUTION_CONTROL_TOKEN, undefined);
        assert.equal(
          process.env.CODEX_CA_CERTIFICATE,
          "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
        );
        assert.equal(
          process.env.CURL_CA_BUNDLE,
          "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
        );
        assert.equal(
          process.env.NODE_EXTRA_CA_CERTS,
          "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
        );
        assert.equal(process.env.CUSTOM_HOSTED_ENV, "runtime-value");
        assert.equal(process.cwd(), roots.vaultRoot);
        assert.equal(process.env.HOME, roots.operatorHomeRoot);
        assert.equal(process.env.PATH, HOSTED_RUNNER_EXECUTABLE_PATH);
        assert.equal(
          process.env.REQUESTS_CA_BUNDLE,
          "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
        );
        assert.equal(process.env.MURPH_HOSTED_RUNTIME_PROCESS, "1");
        assert.equal(process.env.VAULT, roots.vaultRoot);
        assert.equal(process.env.OPENAI_API_KEY, "runtime-openai-secret");
        process.env.MUTATED_DURING_HOSTED_ENV = "must-restore-away";
      },
    );

    assert.equal(process.env.AMBIENT_CHANNEL_SECRET, "ambient-secret");
    assert.equal(
      process.env.HOSTED_ASSISTANT_BASE_URL,
      "https://legacy-provider.example.test/v1",
    );
    assert.equal(process.env.HOSTED_ASSISTANT_PROVIDER_NAME, "legacy-provider");
    assert.equal(process.env.HOSTED_EXECUTION_CONTROL_TOKEN, "control-secret");
    assert.equal(process.env.CUSTOM_HOSTED_ENV, undefined);
    assert.equal(process.env.HOME, "/tmp/original-home");
    assert.equal(process.env.PATH, "/usr/bin");
    assert.equal(process.env.MURPH_HOSTED_RUNTIME_PROCESS, undefined);
    assert.equal(process.env.MUTATED_DURING_HOSTED_ENV, undefined);
    assert.equal(process.env.VAULT, "/tmp/original-vault");
    assert.equal(process.env.OPENAI_API_KEY, "ambient-openai-secret");
  } finally {
    for (const [key, value] of originalValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await removeHostedProcessEnvironmentTestRoots(roots);
  }
});

test("withHostedProcessEnvironment omits ambient operator parser tool env", async () => {
  const roots = await createHostedProcessEnvironmentTestRoots("hosted-env-parser-");
  const originalValues = new Map(
    [
      "FFMPEG_COMMAND",
      "FILE_COMMAND",
      "MUTOOL_COMMAND",
      "PDFINFO_COMMAND",
      "PDFTOPPM_COMMAND",
      "PDFTOTEXT_COMMAND",
      "QPDF_COMMAND",
      "WHISPER_COMMAND",
      "WHISPER_MODEL_PATH",
    ].map((key) => [key, process.env[key]]),
  );

  process.env.FFMPEG_COMMAND = "/usr/bin/ffmpeg";
  process.env.FILE_COMMAND = "/usr/bin/file";
  process.env.MUTOOL_COMMAND = "/usr/bin/mutool";
  process.env.PDFINFO_COMMAND = "/usr/bin/pdfinfo";
  process.env.PDFTOPPM_COMMAND = "/usr/bin/pdftoppm";
  process.env.PDFTOTEXT_COMMAND = "/usr/bin/pdftotext";
  process.env.QPDF_COMMAND = "/usr/bin/qpdf";
  process.env.WHISPER_COMMAND = "/usr/local/bin/whisper-cli";
  process.env.WHISPER_MODEL_PATH = "/app/models/whisper/ggml-base.en.bin";

  try {
    await withHostedProcessEnvironment(
      {
        envOverrides: {
          CUSTOM_HOSTED_ENV: "runtime-value",
        },
        operatorHomeRoot: roots.operatorHomeRoot,
        vaultRoot: roots.vaultRoot,
      },
      async () => {
        assert.equal(process.cwd(), roots.vaultRoot);
        assert.equal(process.env.FFMPEG_COMMAND, undefined);
        assert.equal(process.env.FILE_COMMAND, undefined);
        assert.equal(process.env.MUTOOL_COMMAND, undefined);
        assert.equal(process.env.PDFINFO_COMMAND, undefined);
        assert.equal(process.env.PDFTOPPM_COMMAND, undefined);
        assert.equal(process.env.PDFTOTEXT_COMMAND, undefined);
        assert.equal(process.env.QPDF_COMMAND, undefined);
        assert.equal(process.env.WHISPER_COMMAND, undefined);
        assert.equal(process.env.WHISPER_MODEL_PATH, undefined);
      },
    );
  } finally {
    for (const [key, value] of originalValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await removeHostedProcessEnvironmentTestRoots(roots);
  }
});

test("withHostedProcessEnvironment serializes overlapping process env overrides", async () => {
  const firstRoots = await createHostedProcessEnvironmentTestRoots("hosted-env-first-");
  const secondRoots = await createHostedProcessEnvironmentTestRoots("hosted-env-second-");
  const originalHome = process.env.HOME;
  const originalVault = process.env.VAULT;
  const originalCustom = process.env.CUSTOM_HOSTED_ENV;
  const originalWorkingDirectory = process.cwd();
  let releaseFirstRun = () => {};
  const firstRunGate = new Promise<void>((resolve) => {
    releaseFirstRun = resolve;
  });
  const observed: string[] = [];

  process.env.HOME = "/tmp/original-home";
  process.env.VAULT = "/tmp/original-vault";
  delete process.env.CUSTOM_HOSTED_ENV;

  try {
    const firstRun = withHostedProcessEnvironment(
      {
        envOverrides: {
          CUSTOM_HOSTED_ENV: "first",
        },
        operatorHomeRoot: firstRoots.operatorHomeRoot,
        vaultRoot: firstRoots.vaultRoot,
      },
      async () => {
        observed.push(
          `first-start:${process.env.HOME}:${process.env.CUSTOM_HOSTED_ENV}:${process.cwd()}`,
        );
        await firstRunGate;
        observed.push(
          `first-end:${process.env.HOME}:${process.env.CUSTOM_HOSTED_ENV}:${process.cwd()}`,
        );
      },
    );
    await Promise.resolve();

    const secondRun = withHostedProcessEnvironment(
      {
        envOverrides: {
          CUSTOM_HOSTED_ENV: "second",
        },
        operatorHomeRoot: secondRoots.operatorHomeRoot,
        vaultRoot: secondRoots.vaultRoot,
      },
      async () => {
        observed.push(
          `second-start:${process.env.HOME}:${process.env.CUSTOM_HOSTED_ENV}:${process.cwd()}`,
        );
        observed.push(
          `second-end:${process.env.HOME}:${process.env.CUSTOM_HOSTED_ENV}:${process.cwd()}`,
        );
      },
    );
    await Promise.resolve();

    assert.deepEqual(observed, [
      `first-start:${firstRoots.operatorHomeRoot}:first:${firstRoots.vaultRoot}`,
    ]);
    assert.equal(process.cwd(), firstRoots.vaultRoot);
    assert.equal(process.env.HOME, firstRoots.operatorHomeRoot);
    assert.equal(process.env.VAULT, firstRoots.vaultRoot);
    assert.equal(process.env.CUSTOM_HOSTED_ENV, "first");

    releaseFirstRun();
    await Promise.all([firstRun, secondRun]);

    assert.deepEqual(observed, [
      `first-start:${firstRoots.operatorHomeRoot}:first:${firstRoots.vaultRoot}`,
      `first-end:${firstRoots.operatorHomeRoot}:first:${firstRoots.vaultRoot}`,
      `second-start:${secondRoots.operatorHomeRoot}:second:${secondRoots.vaultRoot}`,
      `second-end:${secondRoots.operatorHomeRoot}:second:${secondRoots.vaultRoot}`,
    ]);
    assert.equal(process.cwd(), originalWorkingDirectory);
    assert.equal(process.env.HOME, "/tmp/original-home");
    assert.equal(process.env.VAULT, "/tmp/original-vault");
    assert.equal(process.env.CUSTOM_HOSTED_ENV, undefined);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalVault === undefined) {
      delete process.env.VAULT;
    } else {
      process.env.VAULT = originalVault;
    }

    if (originalCustom === undefined) {
      delete process.env.CUSTOM_HOSTED_ENV;
    } else {
      process.env.CUSTOM_HOSTED_ENV = originalCustom;
    }
    await removeHostedProcessEnvironmentTestRoots(firstRoots);
    await removeHostedProcessEnvironmentTestRoots(secondRoots);
  }
});

async function createHostedProcessEnvironmentTestRoots(prefix: string): Promise<{
  operatorHomeRoot: string;
  root: string;
  vaultRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const operatorHomeRoot = path.join(root, "home");
  const vaultRoot = path.join(root, "vault");
  await Promise.all([
    mkdir(operatorHomeRoot),
    mkdir(vaultRoot),
  ]);
  return {
    operatorHomeRoot: await realpath(operatorHomeRoot),
    root: await realpath(root),
    vaultRoot: await realpath(vaultRoot),
  };
}

async function removeHostedProcessEnvironmentTestRoots(input: {
  root: string;
}): Promise<void> {
  await rm(input.root, {
    force: true,
    recursive: true,
  });
}
