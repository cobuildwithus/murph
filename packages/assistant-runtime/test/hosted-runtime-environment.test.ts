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

test("hosted platform-backed env merges non-secret forwarded env with platform-only secrets", () => {
  assert.deepEqual(
    buildHostedPlatformBackedRuntimeEnv({
      forwardedEnv: {
        OPENAI_API_KEY: "openai-secret",
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
  assert.deepEqual(normalized.userEnv, {
    OPENAI_API_KEY: "openai-secret",
  });
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
  assert.deepEqual(normalized.userEnv, {
    OPENAI_API_KEY: "user-openai-secret",
  });
});

test("hosted runtime config strips hosted control-plane secrets from forwarded and user env", () => {
  const platform = createHostedRuntimePlatformStub();

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      forwardedEnv: {
        LD_PRELOAD: "/tmp/injected.so",
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
        OPENAI_API_KEY: "openai-secret",
      },
      userEnv: {
        LD_PRELOAD: "/tmp/user-injected.so",
        NODE_OPTIONS: "--require /tmp/user-injected.js",
        PATH: "/tmp/user-bin",
        HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON: "{}",
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON: "{}",
        HOSTED_WAKE_ENCRYPTION_KEYRING_JSON: "{}",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
        OPENAI_API_KEY: "user-openai-secret",
      },
    },
    platform,
  );

  assert.deepEqual(normalized.forwardedEnv, {
    HOSTED_WEB_BASE_URL: "https://web.example.test",
    OPENAI_API_KEY: "openai-secret",
  });
  assert.deepEqual(normalized.userEnv, {
    OPENAI_API_KEY: "user-openai-secret",
  });
});

test("hosted platform-backed env strips non-platform entries from platform env", () => {
  assert.deepEqual(
    buildHostedPlatformBackedRuntimeEnv({
      forwardedEnv: {
        OPENAI_API_KEY: "openai-secret",
      },
      platformEnv: {
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
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
