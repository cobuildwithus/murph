import assert from "node:assert/strict";

import { test } from "vitest";
import type { HostedAssistantDeliveryRecord } from "@murphai/hosted-execution/side-effects";

import type { HostedRuntimePlatform } from "../src/hosted-runtime/platform.ts";
import {
  buildHostedPlatformBackedRuntimeEnv,
  normalizeHostedAssistantRuntimeConfig,
  withHostedProcessEnvironment,
} from "../src/hosted-runtime/environment.ts";
import {
  buildHostedRuntimeChildEnv,
  buildHostedRuntimeForwardedEnv,
  buildHostedRuntimeLaunchSpec,
  buildHostedRuntimePlatformEnv,
  buildHostedRuntimeResolvedConfig,
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
  const forwardedEnv = { VERCEL_AI_API_KEY: "secret" };
  const platformEnv = { TELEGRAM_BOT_TOKEN: "telegram-token" };
  const resolvedConfig = createHostedRuntimeResolvedConfig();
  const userEnv = { ANTHROPIC_API_KEY: "anthropic-secret" };

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      commitTimeoutMs: 45_000,
      forwardedEnv,
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
  assert.deepEqual(normalized.platformEnv, platformEnv);
  assert.notEqual(normalized.platformEnv, platformEnv);
  assert.deepEqual(normalized.resolvedConfig, resolvedConfig);
  assert.notEqual(normalized.resolvedConfig, resolvedConfig);
  assert.deepEqual(normalized.userEnv, userEnv);
  assert.notEqual(normalized.userEnv, userEnv);
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
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      LINQ_API_TOKEN: "linq-token",
      LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      NODE_OPTIONS: "--require /tmp/injected.js",
      VERCEL_AI_API_KEY: "worker-vercel-secret",
      TELEGRAM_API_BASE_URL: "https://evil.telegram.example",
      TELEGRAM_BOT_TOKEN: "evil-telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://evil-files.telegram.example",
    },
    platformEnv: {
      HOSTED_WAKE_ENCRYPTION_KEY: "wake-key",
      HOSTED_WAKE_ENCRYPTION_KEY_VERSION: "wake:v1",
      TELEGRAM_API_BASE_URL: "https://api.telegram.example",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
    },
    userEnv: {
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      VERCEL_AI_API_KEY: "user-vercel-secret",
      TELEGRAM_BOT_TOKEN: "user-telegram-token",
    },
  });

  assert.deepEqual(spec.runtime, {
    commitTimeoutMs: 45_000,
    forwardedEnv: {
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      LINQ_API_TOKEN: "linq-token",
      VERCEL_AI_API_KEY: "worker-vercel-secret",
    },
    platformEnv: {
      HOSTED_WAKE_ENCRYPTION_KEY: "wake-key",
      HOSTED_WAKE_ENCRYPTION_KEY_VERSION: "wake:v1",
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
    userEnv: {
      VERCEL_AI_API_KEY: "user-vercel-secret",
    },
  });
});

test("hosted runtime launch spec derives platform env from forwarded env only when no explicit platform env is supplied", () => {
  const spec = buildHostedRuntimeLaunchSpec({
    forwardedEnv: {
      VERCEL_AI_API_KEY: "worker-vercel-secret",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    },
  });

  assert.deepEqual(spec.runtime.forwardedEnv, {
    VERCEL_AI_API_KEY: "worker-vercel-secret",
  });
  assert.deepEqual(spec.runtime.platformEnv, {
    TELEGRAM_BOT_TOKEN: "telegram-token",
  });
});

test("hosted runtime forwarded env profiles are runtime-owned and transport-mappable", () => {
  assert.deepEqual(
    buildHostedRuntimeForwardedEnv({
      HOSTED_EMAIL: {
        send: async (_message: unknown) => undefined,
      },
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "signing-secret",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "hosted-email,linq,mapbox,telegram",
      LINQ_API_BASE_URL: "http://127.0.0.1:4011",
      LINQ_API_TOKEN: "linq-token",
      LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      TELEGRAM_API_BASE_URL: "http://127.0.0.1:4012",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "http://127.0.0.1:4013",
    }, {
      mapValue: ({ key, value }) =>
        key.endsWith("_BASE_URL") ? value.replace("127.0.0.1", "host.internal") : value,
    }),
    {
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SEND_READY: "true",
      LINQ_API_BASE_URL: "http://host.internal:4011",
      LINQ_API_TOKEN: "linq-token",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      NODE_ENV: "production",
      TELEGRAM_API_BASE_URL: "http://host.internal:4012",
      TELEGRAM_FILE_BASE_URL: "http://host.internal:4013",
    },
  );
});

test("hosted runtime child env projection is a transport projection of forwarded env only", () => {
  assert.deepEqual(
    buildHostedRuntimeChildEnv({
      forwardedEnv: {
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        VERCEL_AI_API_KEY: "worker-vercel-secret",
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    }),
    {
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      VERCEL_AI_API_KEY: "worker-vercel-secret",
    },
  );
});

test("hosted runtime platform env selector and timeout parser are reusable outside Cloudflare", () => {
  assert.deepEqual(
    buildHostedRuntimePlatformEnv({
      HOSTED_WAKE_ENCRYPTION_KEY: "wake-key",
      HOSTED_WAKE_ENCRYPTION_KEY_VERSION: "wake:v1",
      TELEGRAM_API_BASE_URL: "https://api.telegram.example",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
    }),
    {
      HOSTED_WAKE_ENCRYPTION_KEY: "wake-key",
      HOSTED_WAKE_ENCRYPTION_KEY_VERSION: "wake:v1",
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
        VERCEL_AI_API_KEY: "vercel-secret",
      },
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.test",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.test",
      },
    }),
    {
      VERCEL_AI_API_KEY: "vercel-secret",
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
        VERCEL_AI_API_KEY: "vercel-secret",
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
      VERCEL_AI_API_KEY: "vercel-secret",
      TELEGRAM_API_BASE_URL: "https://api.telegram.test",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.test",
    },
  );
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
        VERCEL_AI_API_KEY: "vercel-secret",
      },
    },
    platform,
  );

  assert.deepEqual(normalized.forwardedEnv, {
    LINQ_API_TOKEN: "linq-token",
  });
  assert.deepEqual(normalized.userEnv, {
    VERCEL_AI_API_KEY: "vercel-secret",
  });
});

test("hosted runtime config strips platform-only Telegram vars from forwarded and user env", () => {
  const platform = createHostedRuntimePlatformStub();

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      forwardedEnv: {
        VERCEL_AI_API_KEY: "vercel-secret",
        TELEGRAM_API_BASE_URL: "https://evil.telegram.example",
      },
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      userEnv: {
        VERCEL_AI_API_KEY: "user-vercel-secret",
        TELEGRAM_API_BASE_URL: "https://user.telegram.example",
        TELEGRAM_BOT_TOKEN: "user-telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://user-files.telegram.example",
      },
    },
    platform,
  );

  assert.deepEqual(normalized.forwardedEnv, {
    VERCEL_AI_API_KEY: "vercel-secret",
  });
  assert.deepEqual(normalized.platformEnv, {
    TELEGRAM_API_BASE_URL: "https://api.telegram.example",
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
  });
  assert.deepEqual(normalized.userEnv, {
    VERCEL_AI_API_KEY: "user-vercel-secret",
  });
});

test("hosted runtime config strips hosted control-plane secrets from forwarded and user env", () => {
  const platform = createHostedRuntimePlatformStub();

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      forwardedEnv: {
        LD_PRELOAD: "/tmp/injected.so",
        CODEX_HOME: "/tmp/forwarded-codex-home",
        HOSTED_ASSISTANT_API_KEY_ENV: "VERCEL_AI_API_KEY",
        HOSTED_ASSISTANT_BASE_URL: "https://legacy-provider.example.test/v1",
        NODE_OPTIONS: "--require /tmp/injected.js",
        PATH: "/tmp/custom-bin",
        HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: "automation-private-jwk",
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:8787",
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
        HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK: '{"kty":"EC","x":"recovery","y":"recovery"}',
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
        HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
        HOSTED_WAKE_ENCRYPTION_KEY: "wake-key",
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
        HTTPS_PROXY: "http://forwarded-proxy.example.test:8080",
        NODE_EXTRA_CA_CERTS: "/tmp/forwarded-ca.pem",
        NPM_CONFIG_USERCONFIG: "/tmp/forwarded-npmrc",
        SSL_CERT_FILE: "/tmp/forwarded-cert.pem",
        TMPDIR: "/tmp/forwarded-tmp",
        VERCEL_AI_API_KEY: "vercel-secret",
      },
      userEnv: {
        AGENTMAIL_API_KEY: "agentmail-user-secret",
        CF_ACCOUNT_ID: "cf-account",
        LD_PRELOAD: "/tmp/user-injected.so",
        CODEX_HOME: "/tmp/user-codex-home",
        HOSTED_ASSISTANT_API_KEY_ENV: "VERCEL_AI_API_KEY",
        HOSTED_ASSISTANT_BASE_URL: "https://user-legacy-provider.example.test/v1",
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        NODE_OPTIONS: "--require /tmp/user-injected.js",
        PATH: "/tmp/user-bin",
        PDFTOTEXT_COMMAND: "/tmp/user-pdftotext",
        HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON: "{}",
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON: "{}",
        HOSTED_WAKE_ENCRYPTION_KEYRING_JSON: "{}",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
        HTTPS_PROXY: "http://user-proxy.example.test:8080",
        NODE_EXTRA_CA_CERTS: "/tmp/user-ca.pem",
        NPM_CONFIG_USERCONFIG: "/tmp/user-npmrc",
        SSL_CERT_FILE: "/tmp/user-cert.pem",
        TMPDIR: "/tmp/user-tmp",
        VERCEL_AI_API_KEY: "user-vercel-secret",
        WRANGLER_API_TOKEN: "wrangler-user-secret",
      },
    },
    platform,
  );

  assert.deepEqual(normalized.forwardedEnv, {
    HOSTED_WEB_BASE_URL: "https://web.example.test",
    VERCEL_AI_API_KEY: "vercel-secret",
  });
  assert.deepEqual(normalized.userEnv, {
    VERCEL_AI_API_KEY: "user-vercel-secret",
  });
});

test("hosted platform-backed env strips non-platform entries from platform env", () => {
  assert.deepEqual(
    buildHostedPlatformBackedRuntimeEnv({
      forwardedEnv: {
        VERCEL_AI_API_KEY: "vercel-secret",
      },
      platformEnv: {
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
        HOSTED_WAKE_ENCRYPTION_KEY: "wake-key",
        VERCEL_AI_API_KEY: "platform-vercel-secret",
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    }),
    {
      VERCEL_AI_API_KEY: "vercel-secret",
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
        garmin: {
          clientId: "garmin-client",
          clientSecret: "garmin-secret",
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
  Object.defineProperty(
    resolvedConfig.deviceSync?.providerConfigs.oura ?? {},
    "webhookVerificationToken",
    {
      configurable: true,
      enumerable: true,
      value: "control-plane-only",
    },
  );

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
    normalized.resolvedConfig.deviceSync?.providerConfigs.garmin,
    resolvedConfig.deviceSync?.providerConfigs.garmin,
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
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      normalized.resolvedConfig.deviceSync?.providerConfigs.oura ?? {},
      "webhookVerificationToken",
    ),
    false,
  );
  assert.notEqual(
    normalized.resolvedConfig.deviceSync?.providerConfigs.oura?.scopes,
    ouraScopes,
  );
});

test("withHostedProcessEnvironment restores overwritten and newly introduced env values", async () => {
  const originalHome = process.env.HOME;
  const originalVault = process.env.VAULT;
  const originalCustom = process.env.CUSTOM_HOSTED_ENV;

  process.env.HOME = "/tmp/original-home";
  process.env.VAULT = "/tmp/original-vault";
  delete process.env.CUSTOM_HOSTED_ENV;

  try {
    await withHostedProcessEnvironment(
      {
        envOverrides: {
          CUSTOM_HOSTED_ENV: "present",
        },
        operatorHomeRoot: "/tmp/override-home",
        vaultRoot: "/tmp/override-vault",
      },
      async () => {
        assert.equal(process.env.HOME, "/tmp/override-home");
        assert.equal(process.env.VAULT, "/tmp/override-vault");
        assert.equal(process.env.CUSTOM_HOSTED_ENV, "present");
      },
    );

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
  }
});

test("withHostedProcessEnvironment replaces ambient env with the hosted runtime projection", async () => {
  const originalValues = new Map(
    [
      "AMBIENT_CHANNEL_SECRET",
      "CUSTOM_HOSTED_ENV",
      "HOSTED_ASSISTANT_BASE_URL",
      "HOSTED_ASSISTANT_PROVIDER_NAME",
      "HOSTED_EXECUTION_CONTROL_TOKEN",
      "MURPH_HOSTED_RUNTIME_PROCESS",
      "MUTATED_DURING_HOSTED_ENV",
      "PATH",
      "HOME",
      "VAULT",
      "VERCEL_AI_API_KEY",
    ].map((key) => [key, process.env[key]]),
  );

  process.env.AMBIENT_CHANNEL_SECRET = "ambient-secret";
  process.env.HOSTED_ASSISTANT_BASE_URL = "https://legacy-provider.example.test/v1";
  process.env.HOSTED_ASSISTANT_PROVIDER_NAME = "legacy-provider";
  process.env.HOSTED_EXECUTION_CONTROL_TOKEN = "control-secret";
  process.env.PATH = "/usr/bin";
  process.env.HOME = "/tmp/original-home";
  process.env.VAULT = "/tmp/original-vault";
  process.env.VERCEL_AI_API_KEY = "ambient-vercel-secret";
  delete process.env.CUSTOM_HOSTED_ENV;
  delete process.env.MURPH_HOSTED_RUNTIME_PROCESS;
  delete process.env.MUTATED_DURING_HOSTED_ENV;

  try {
    await withHostedProcessEnvironment(
      {
        envOverrides: {
          CUSTOM_HOSTED_ENV: "runtime-value",
          VERCEL_AI_API_KEY: "runtime-vercel-secret",
        },
        operatorHomeRoot: "/tmp/hosted-home",
        vaultRoot: "/tmp/hosted-vault",
      },
      async () => {
        assert.equal(process.env.AMBIENT_CHANNEL_SECRET, undefined);
        assert.equal(process.env.HOSTED_ASSISTANT_BASE_URL, undefined);
        assert.equal(process.env.HOSTED_ASSISTANT_PROVIDER_NAME, undefined);
        assert.equal(process.env.HOSTED_EXECUTION_CONTROL_TOKEN, undefined);
        assert.equal(process.env.CUSTOM_HOSTED_ENV, "runtime-value");
        assert.equal(process.env.HOME, "/tmp/hosted-home");
        assert.equal(process.env.PATH, "/usr/bin");
        assert.equal(process.env.MURPH_HOSTED_RUNTIME_PROCESS, "1");
        assert.equal(process.env.VAULT, "/tmp/hosted-vault");
        assert.equal(process.env.VERCEL_AI_API_KEY, "runtime-vercel-secret");
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
    assert.equal(process.env.VERCEL_AI_API_KEY, "ambient-vercel-secret");
  } finally {
    for (const [key, value] of originalValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("withHostedProcessEnvironment serializes overlapping process env overrides", async () => {
  const originalHome = process.env.HOME;
  const originalVault = process.env.VAULT;
  const originalCustom = process.env.CUSTOM_HOSTED_ENV;
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
        operatorHomeRoot: "/tmp/first-home",
        vaultRoot: "/tmp/first-vault",
      },
      async () => {
        observed.push(`first-start:${process.env.HOME}:${process.env.CUSTOM_HOSTED_ENV}`);
        await firstRunGate;
        observed.push(`first-end:${process.env.HOME}:${process.env.CUSTOM_HOSTED_ENV}`);
      },
    );
    await Promise.resolve();

    const secondRun = withHostedProcessEnvironment(
      {
        envOverrides: {
          CUSTOM_HOSTED_ENV: "second",
        },
        operatorHomeRoot: "/tmp/second-home",
        vaultRoot: "/tmp/second-vault",
      },
      async () => {
        observed.push(`second-start:${process.env.HOME}:${process.env.CUSTOM_HOSTED_ENV}`);
        observed.push(`second-end:${process.env.HOME}:${process.env.CUSTOM_HOSTED_ENV}`);
      },
    );
    await Promise.resolve();

    assert.deepEqual(observed, [
      "first-start:/tmp/first-home:first",
    ]);
    assert.equal(process.env.HOME, "/tmp/first-home");
    assert.equal(process.env.VAULT, "/tmp/first-vault");
    assert.equal(process.env.CUSTOM_HOSTED_ENV, "first");

    releaseFirstRun();
    await Promise.all([firstRun, secondRun]);

    assert.deepEqual(observed, [
      "first-start:/tmp/first-home:first",
      "first-end:/tmp/first-home:first",
      "second-start:/tmp/second-home:second",
      "second-end:/tmp/second-home:second",
    ]);
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
  }
});
