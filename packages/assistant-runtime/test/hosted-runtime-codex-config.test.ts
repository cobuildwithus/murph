import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import {
  HostedAssistantConfigurationError,
} from "@murphai/operator-config/hosted-assistant-config";

import {
  buildHostedCodexConfigToml,
  prepareHostedCodexRuntimeEnvironment,
} from "../src/hosted-runtime/codex-config.ts";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      })
    ),
  );
});

test("hosted Codex runtime config writes Vercel AI Gateway Responses config without secret values", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      VERCEL_AI_API_KEY: "secret-vercel-key",
    },
  });

  assert.equal(result.codexHome, path.join(operatorHomeRoot, ".codex-hosted"));
  assert.equal(result.codexConfigPath, path.join(operatorHomeRoot, ".codex-hosted", "config.toml"));
  assert.equal(result.runtimeEnv.CODEX_HOME, result.codexHome);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_API_KEY_ENV, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_MODEL, "gpt-5.5");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT, "medium");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_APPROVAL_POLICY, "never");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_SANDBOX, "danger-full-access");

  const config = await readFile(result.codexConfigPath!, "utf8");
  assert.match(config, /model = "gpt-5\.5"/u);
  assert.match(config, /model_provider = "vercel-ai-gateway"/u);
  assert.match(config, /model_reasoning_effort = "medium"/u);
  assert.match(config, /\[model_providers\."vercel-ai-gateway"\]/u);
  assert.match(config, /base_url = "https:\/\/ai-gateway\.vercel\.sh\/v1"/u);
  assert.match(config, /env_key = "VERCEL_AI_API_KEY"/u);
  assert.match(config, /wire_api = "responses"/u);
  assert.doesNotMatch(config, /secret-vercel-key/u);

  const configMode = (await stat(result.codexConfigPath!)).mode & 0o777;
  assert.equal(configMode, 0o600);
  const codexHomeMode = (await stat(result.codexHome!)).mode & 0o777;
  assert.equal(codexHomeMode, 0o700);
});

test("hosted Codex runtime config strips legacy hosted assistant seed env before bootstrap", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_API_KEY_ENV: "VERCEL_AI_API_KEY",
      HOSTED_ASSISTANT_BASE_URL: "https://legacy-provider.example.test/v1",
      HOSTED_ASSISTANT_CODEX_COMMAND: "codex-dev",
      HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS: "openai",
      HOSTED_ASSISTANT_OSS: "true",
      HOSTED_ASSISTANT_PROFILE: "legacy-profile",
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      HOSTED_ASSISTANT_PROVIDER_NAME: "legacy-provider",
      HOSTED_ASSISTANT_ZERO_DATA_RETENTION: "true",
      VERCEL_AI_API_KEY: "secret-vercel-key",
    },
  });

  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_PROVIDER, "vercel-ai-gateway");
  assert.equal(result.runtimeEnv.VERCEL_AI_API_KEY, "secret-vercel-key");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_API_KEY_ENV, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_BASE_URL, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_CODEX_COMMAND, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_OSS, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_PROFILE, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_PROVIDER_NAME, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_ZERO_DATA_RETENTION, undefined);
});

test("hosted Codex runtime config preserves explicit model and reasoning env", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_MODEL: "gpt-explicit",
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      HOSTED_ASSISTANT_REASONING_EFFORT: "high",
      VERCEL_AI_API_KEY: "secret-vercel-key",
    },
  });

  const config = await readFile(result.codexConfigPath!, "utf8");
  assert.match(config, /model = "gpt-explicit"/u);
  assert.match(config, /model_reasoning_effort = "high"/u);
});

test("hosted Codex runtime config fails closed without the configured model credential env", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_REQUIRED"
      && error.message.includes("VERCEL_AI_API_KEY"),
  );
});

test("hosted Codex runtime config leaves non-Codex provider env untouched", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "legacy-provider",
      HOSTED_ASSISTANT_MODEL: "legacy-model",
    },
  });

  assert.equal(result.codexHome, null);
  assert.equal(result.codexConfigPath, null);
  assert.deepEqual(result.runtimeEnv, {
    HOSTED_ASSISTANT_PROVIDER: "legacy-provider",
    HOSTED_ASSISTANT_MODEL: "legacy-model",
  });
});

test("hosted Codex config TOML uses env var names rather than credential values", () => {
  const config = buildHostedCodexConfigToml({
    model: "gpt-5.5",
    provider: {
      id: "vercel-ai-gateway",
      name: "Vercel AI Gateway",
      baseUrl: "https://ai-gateway.vercel.sh/v1",
      envKey: "VERCEL_AI_API_KEY",
      wireApi: "responses",
    },
    reasoningEffort: "medium",
  });

  assert.equal(
    config,
    [
      'model = "gpt-5.5"',
      'model_provider = "vercel-ai-gateway"',
      'model_reasoning_effort = "medium"',
      "",
      '[model_providers."vercel-ai-gateway"]',
      'name = "Vercel AI Gateway"',
      'base_url = "https://ai-gateway.vercel.sh/v1"',
      'env_key = "VERCEL_AI_API_KEY"',
      'wire_api = "responses"',
      "",
    ].join("\n"),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const target = await mkdtemp(path.join(tmpdir(), "hosted-codex-config-"));
  temporaryPaths.push(target);
  return target;
}
