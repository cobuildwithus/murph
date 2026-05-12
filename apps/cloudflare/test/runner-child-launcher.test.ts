import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  createHostedRunnerChildLauncherDirectories,
  createHostedRunnerChildProcessEnv,
  resolveHostedRunnerTsconfigPath,
  resolveHostedRunnerTsxImportSpecifier,
} from "../src/runner-child-launcher.ts";

function createLauncherDirectories(root: string) {
  return {
    cacheRoot: path.join(root, "cache"),
    homeRoot: path.join(root, "home"),
    huggingFaceRoot: path.join(root, "hf-home"),
    tempRoot: path.join(root, "tmp"),
  };
}

test("hosted runner child launcher directories create app-owned cache, home, hf, and temp roots", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-env-"));

  try {
    const launcherRoot = path.join(workspaceRoot, "launcher");
    const directories = await createHostedRunnerChildLauncherDirectories(launcherRoot);

    assert.deepEqual(directories, createLauncherDirectories(launcherRoot));
    await Promise.all(Object.values(directories).map(async (directory) => access(directory)));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted runner child process env forwards only launcher-safe ambient and sanitized runtime env", () => {
  const launcherDirectories = createLauncherDirectories("/tmp/hosted-runner");
  const env = createHostedRunnerChildProcessEnv({
    ambientEnv: {
      FFMPEG_COMMAND: "/usr/bin/ffmpeg",
      FILE_COMMAND: "/usr/bin/file",
      HTTPS_PROXY: "https://proxy.example.test",
      LANG: "en_US.UTF-8",
      MUTOOL_COMMAND: "/usr/bin/mutool",
      PATH: "/usr/bin:/bin",
      PDFINFO_COMMAND: "/usr/bin/pdfinfo",
      PDFTOPPM_COMMAND: "/usr/bin/pdftoppm",
      PDFTOTEXT_COMMAND: "/usr/bin/pdftotext",
      QPDF_COMMAND: "/usr/bin/qpdf",
      SSL_CERT_FILE: "/etc/ssl/cert.pem",
      TZ: "UTC",
      WHISPER_COMMAND: "/usr/local/bin/whisper-cli",
      WHISPER_MODEL_PATH: "/opt/murph/models/whisper/ggml-base.en.bin",
    },
    forwardedEnv: {
      FFMPEG_COMMAND: "/stale/ffmpeg",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "127.0.0.1",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
      HOSTED_WAKE_ENCRYPTION_KEY: "wake-key",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      OPENAI_API_KEY: "secret",
      PATH: "/custom/bin",
      WHISPER_COMMAND: "/stale/whisper-cli",
      WHISPER_MODEL_PATH: "/stale/model.bin",
    },
    isTypeScriptChild: true,
    launcherDirectories,
  });

  assert.deepEqual(env, {
    HF_HOME: launcherDirectories.huggingFaceRoot,
    HOME: launcherDirectories.homeRoot,
    LANG: "en_US.UTF-8",
    OPENAI_API_KEY: "secret",
    PATH: "/usr/bin:/bin",
    SSL_CERT_FILE: "/etc/ssl/cert.pem",
    TEMP: launcherDirectories.tempRoot,
    TMP: launcherDirectories.tempRoot,
    TMPDIR: launcherDirectories.tempRoot,
    TSX_TSCONFIG_PATH: resolveHostedRunnerTsconfigPath(),
    TZ: "UTC",
    XDG_CACHE_HOME: launcherDirectories.cacheRoot,
  });
  assert.equal("FFMPEG_COMMAND" in env, false);
  assert.equal("HTTPS_PROXY" in env, false);
  assert.equal("PDFINFO_COMMAND" in env, false);
  assert.equal("PDFTOTEXT_COMMAND" in env, false);
  assert.equal(env.PATH, "/usr/bin:/bin");
  assert.equal("WHISPER_COMMAND" in env, false);
  assert.equal("WHISPER_MODEL_PATH" in env, false);
});

test("hosted runner child process env omits parser paths without a typed parser toolchain", () => {
  const env = createHostedRunnerChildProcessEnv({
    ambientEnv: {
      FFMPEG_COMMAND: "/usr/bin/ffmpeg",
      PATH: "/usr/bin:/bin",
      WHISPER_COMMAND: "/usr/local/bin/whisper-cli",
      WHISPER_MODEL_PATH: "/opt/murph/models/whisper/ggml-base.en.bin",
    },
    forwardedEnv: {
      FFMPEG_COMMAND: "/stale/ffmpeg",
      PDFINFO_COMMAND: "/stale/pdfinfo",
      PDFTOTEXT_COMMAND: "/stale/pdftotext",
      WHISPER_COMMAND: "/stale/whisper-cli",
      WHISPER_MODEL_PATH: "/stale/model.bin",
    },
    isTypeScriptChild: false,
    launcherDirectories: createLauncherDirectories("/tmp/hosted-runner"),
  });

  assert.equal(env.PATH, "/usr/bin:/bin");
  assert.equal("FFMPEG_COMMAND" in env, false);
  assert.equal("PDFINFO_COMMAND" in env, false);
  assert.equal("PDFTOTEXT_COMMAND" in env, false);
  assert.equal("WHISPER_COMMAND" in env, false);
  assert.equal("WHISPER_MODEL_PATH" in env, false);
});

test("hosted runner child process env omits tsx config wiring for non-typescript children", () => {
  const env = createHostedRunnerChildProcessEnv({
    forwardedEnv: {},
    isTypeScriptChild: false,
    launcherDirectories: createLauncherDirectories("/tmp/hosted-runner"),
  });

  assert.equal("TSX_TSCONFIG_PATH" in env, false);
});

test("hosted runner child environment resolves stable tsx loader and tsconfig paths", () => {
  assert.match(resolveHostedRunnerTsconfigPath(), /tsconfig\.base\.json$/u);
  assert.equal(typeof resolveHostedRunnerTsxImportSpecifier(), "string");
  assert.notEqual(resolveHostedRunnerTsxImportSpecifier().length, 0);
});

test("hosted runner child environment falls back to the bare tsx specifier when resolution fails", () => {
  const unresolvedRequire = Object.assign(createRequire(import.meta.url), {
    resolve() {
      throw new Error("tsx not installed");
    },
  });

  assert.equal(resolveHostedRunnerTsxImportSpecifier(unresolvedRequire), "tsx");
});
