import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";

import { test } from "vitest";

import type { HostedRuntimePlatform } from "../src/hosted-runtime/platform.ts";
import {
  createHostedRuntimeChildLauncherDirectories,
  createHostedRuntimeChildProcessEnv,
  normalizeHostedAssistantRuntimeConfig,
  resolveHostedRuntimeTsconfigPath,
  resolveHostedRuntimeTsxImportSpecifier,
  withHostedProcessEnvironment,
} from "../src/hosted-runtime/environment.ts";
import {
  createHostedRuntimeLauncherDirectories,
  createHostedRuntimeWorkspace,
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
      async commit() {},
      async deletePreparedSideEffect() {},
      async readRawEmailMessage() {
        return null;
      },
      async readSideEffect() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
      async writeSideEffect(record) {
        return record;
      },
    },
  };
}

test("hosted runtime config copies user and forwarded env maps", () => {
  const platform = createHostedRuntimePlatformStub();
  const forwardedEnv = { OPENAI_API_KEY: "secret" };
  const userEnv = { HOSTED_USER_VERIFIED_EMAIL: "user@example.com" };

  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      commitTimeoutMs: 45_000,
      forwardedEnv,
      userEnv,
    },
    platform,
  );

  assert.equal(normalized.platform, platform);
  assert.equal(normalized.commitTimeoutMs, 45_000);
  assert.deepEqual(normalized.forwardedEnv, forwardedEnv);
  assert.notEqual(normalized.forwardedEnv, forwardedEnv);
  assert.deepEqual(normalized.userEnv, userEnv);
  assert.notEqual(normalized.userEnv, userEnv);
});

test("hosted child launcher directories create the expected cache, home, hf, and temp roots", async () => {
  const { cleanup, workspaceRoot } = await createHostedRuntimeWorkspace("hosted-runtime-env-");

  try {
    const launcherRoot = path.join(workspaceRoot, "launcher");
    const directories = await createHostedRuntimeChildLauncherDirectories(launcherRoot);

    assert.deepEqual(
      directories,
      createHostedRuntimeLauncherDirectories(launcherRoot),
    );

    await Promise.all(Object.values(directories).map(async (directory) => access(directory)));
  } finally {
    await cleanup();
  }
});

test("hosted child process env forwards only allowlisted ambient keys and normalizes runtime roots", () => {
  const launcherDirectories = createHostedRuntimeLauncherDirectories("/tmp/hosted-runner");

  const env = createHostedRuntimeChildProcessEnv({
    ambientEnv: {
      HTTPS_PROXY: "https://proxy.example.test",
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin:/bin",
      SSL_CERT_FILE: "/etc/ssl/cert.pem",
      TZ: "UTC",
    },
    forwardedEnv: {
      OPENAI_API_KEY: "secret",
      PATH: "/custom/bin",
    },
    isTypeScriptChild: true,
    launcherDirectories,
  });

  assert.deepEqual(env, {
    HF_HOME: launcherDirectories.huggingFaceRoot,
    HOME: launcherDirectories.homeRoot,
    LANG: "en_US.UTF-8",
    OPENAI_API_KEY: "secret",
    PATH: "/custom/bin",
    SSL_CERT_FILE: "/etc/ssl/cert.pem",
    TEMP: launcherDirectories.tempRoot,
    TMP: launcherDirectories.tempRoot,
    TMPDIR: launcherDirectories.tempRoot,
    TSX_TSCONFIG_PATH: resolveHostedRuntimeTsconfigPath(),
    TZ: "UTC",
    XDG_CACHE_HOME: launcherDirectories.cacheRoot,
  });
  assert.equal("HTTPS_PROXY" in env, false);
});

test("hosted child process env omits tsx config wiring for non-typescript children", () => {
  const env = createHostedRuntimeChildProcessEnv({
    forwardedEnv: {},
    isTypeScriptChild: false,
    launcherDirectories: createHostedRuntimeLauncherDirectories("/tmp/hosted-runner"),
  });

  assert.equal("TSX_TSCONFIG_PATH" in env, false);
});

test("hosted runtime environment resolves stable tsx loader and tsconfig paths", () => {
  assert.match(resolveHostedRuntimeTsconfigPath(), /tsconfig\.base\.json$/u);
  assert.equal(typeof resolveHostedRuntimeTsxImportSpecifier(), "string");
  assert.notEqual(resolveHostedRuntimeTsxImportSpecifier().length, 0);
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
