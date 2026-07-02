import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, test } from "vitest";

import {
  executeCodexAppServerTurn as executeCodexAppServerTurnUnchecked,
  resolveMurphDynamicTools,
  type CodexAppServerTurnInput,
} from "@murphai/assistant-engine/assistant-codex";
import {
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
} from "@murphai/assistant-engine/assistant-skill-assets";
import {
  HostedAssistantConfigurationError,
} from "@murphai/operator-config/hosted-assistant-config";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from "@murphai/hosted-execution/cli-runtime-bridge";
import {
  buildHostedRuntimeForwardedEnv,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
  HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
  HOSTED_RUNTIME_ENV_KEY_NAMES,
  HOSTED_RUNTIME_ENV_PROFILE_KEYS,
} from "../src/hosted-runtime/launch-spec.ts";
import {
  HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV,
} from "../src/hosted-runtime/codex-runtime-env.ts";
import {
  buildHostedRunnerExecutablePath,
  HOSTED_RUNNER_EXECUTABLE_PATH,
} from "../src/hosted-runtime/environment.ts";

import {
  buildHostedCodexConfigToml,
  HOSTED_CODEX_OPERATOR_MEMORY_DIAGNOSTICS,
  HOSTED_CODEX_ROOT_AGENT_USAGE_HINT,
  prepareHostedCodexRuntimeEnvironment,
} from "../src/hosted-runtime/codex-config.ts";
import {
  HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY,
} from "../src/hosted-runtime/codex-shell-env-policy.ts";

const temporaryPaths: string[] = [];
const RUN_HOSTED_CODEX_AUTH_E2E = process.env.MURPH_RUN_HOSTED_CODEX_AUTH_E2E === "1";
const RUN_HOSTED_CODEX_AUTOCOMPACTION_E2E =
  process.env.MURPH_RUN_HOSTED_CODEX_AUTOCOMPACTION_E2E === "1";
const testHostedCodexAuthE2e = RUN_HOSTED_CODEX_AUTH_E2E ? test : test.skip;
const testHostedCodexAutocompactionE2e = RUN_HOSTED_CODEX_AUTOCOMPACTION_E2E
  ? test
  : test.skip;
const HOSTED_CODEX_EXPECTED_AUTO_COMPACT_TOKEN_LIMIT = 100_000;
const HOSTED_CODEX_AUTO_COMPACT_TOKEN_LIMIT_CEILING = 250_000;
const HOSTED_CODEX_AUTOCOMPACTION_E2E_TOKEN_LIMIT = 12_000;
const HOSTED_CODEX_AUTOCOMPACTION_SUMMARY_SENTINEL =
  "HOSTED_CODEX_AUTOCOMPACTION_SUMMARY_SENTINEL";

test("hosted Codex memory diagnostics expose only safe config metadata", () => {
  assert.deepEqual(HOSTED_CODEX_OPERATOR_MEMORY_DIAGNOSTICS, {
    codexOperatorMemoryDisableOnExternalContext: false,
    codexOperatorMemoryFeatureEnabled: true,
    codexOperatorMemoryGenerateMemories: true,
    codexOperatorMemoryMaxRawMemoriesForConsolidation: 128,
    codexOperatorMemoryMaxRolloutAgeDays: 10,
    codexOperatorMemoryMaxRolloutsPerStartup: 1,
    codexOperatorMemoryMaxUnusedDays: 30,
    codexOperatorMemoryMinRateLimitRemainingPercent: 25,
    codexOperatorMemoryMinRolloutIdleHours: 1,
    codexOperatorMemoryMode: "codex-native-operator-context",
    codexOperatorMemoryUseMemories: true,
  });
});

function executeCodexAppServerTurn(
  input: Omit<CodexAppServerTurnInput, "dynamicTools"> & {
    dynamicTools?: CodexAppServerTurnInput["dynamicTools"]
  },
) {
  return executeCodexAppServerTurnUnchecked({
    ...input,
    dynamicTools: input.dynamicTools ?? resolveMurphDynamicTools({
      allowFinishWithoutReply: input.allowFinishWithoutReply,
      allowMessageReactions: input.allowMessageReactions,
      computerToolsAvailable:
        input.hostedToolContext?.computerToolsAvailable === true,
      connectedAppsAvailable: input.hostedToolContext?.connectedApps != null,
      productFeedbackAvailable:
        typeof input.productFeedbackRecorder?.recordProductFeedback === "function",
      progressUpdatesAvailable: input.progressDelivery != null,
    }),
  })
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((target) =>
      removeTemporaryPath(target)
    ),
  );
});

test("hosted Codex runtime config writes OpenAI Responses config without secret values", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });

  assert.equal(result.codexHome, path.join(operatorHomeRoot, ".codex-hosted"));
  assert.equal(result.codexConfigPath, path.join(operatorHomeRoot, ".codex-hosted", "config.toml"));
  assert.equal(result.runtimeEnv.CODEX_HOME, result.codexHome);
  assert.ok(result.runtimeEnv[MURPH_ASSISTANT_SKILLS_ROOT_ENV]);
  assert.match(
    result.runtimeEnv[MURPH_ASSISTANT_SKILLS_ROOT_ENV] ?? "",
    /assistant-engine[/\\]skills$/,
  );
  assert.equal(
    result.runtimeEnv[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV],
    "hosted-openai",
  );
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_API_KEY_ENV, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_MODEL, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT, "low");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_APPROVAL_POLICY, "never");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_SANDBOX, "danger-full-access");
  assert.equal(result.runtimeEnv[HOSTED_RUNTIME_PROCESS_ENV], "1");
  assert.equal(result.runtimeEnv.PATH, HOSTED_RUNNER_EXECUTABLE_PATH);

  const config = await readFile(result.codexConfigPath, "utf8");
  assert.doesNotMatch(config, /^model = /mu);
  assert.match(config, /^model_provider = "hosted-openai"$/mu);
  assert.match(config, /model_reasoning_effort = "low"/u);
  assert.match(
    config,
    new RegExp(
      `^model_auto_compact_token_limit = ${HOSTED_CODEX_EXPECTED_AUTO_COMPACT_TOKEN_LIMIT}$`,
      "mu",
    ),
  );
  assert.match(config, /^log_dir = "\/tmp\/murph-codex-log"$/mu);
  assert.match(config, /approval_policy = "never"/u);
  assert.match(config, /sandbox_mode = "danger-full-access"/u);
  assert.match(config, /^check_for_update_on_startup = false$/mu);
  assert.match(config, /^allow_login_shell = false$/mu);
  assert.doesNotMatch(config, /^model_provider = "openai"$/mu);
  assert.doesNotMatch(config, /\[model_providers\."openai"\]/u);
  assert.match(config, /\[model_providers\."hosted-openai"\]/u);
  assert.match(config, /base_url = "https:\/\/api\.openai\.com\/v1"/u);
  assert.match(config, /env_key = "OPENAI_API_KEY"/u);
  assert.match(config, /wire_api = "responses"/u);
  assert.match(config, /^supports_websockets = true$/mu);
  assert.match(config, /^requires_openai_auth = false$/mu);
  assert.doesNotMatch(config, /^requires_openai_auth = true$/mu);
  assert.match(config, /\[features\]\nplugins = false\nmemories = true/u);
  assert.ok(
    config.includes(
      `[features.multi_agent_v2]\nenabled = true\nroot_agent_usage_hint_text = ${JSON.stringify(HOSTED_CODEX_ROOT_AGENT_USAGE_HINT)}`,
    ),
  );
  assertHostedCodexRootAgentUsageHintRetainsCodexDefaults();
  assert.match(
    config,
    /\[memories\]\nuse_memories = true\ngenerate_memories = true\ndisable_on_external_context = false\nmin_rollout_idle_hours = 1\nmax_rollouts_per_startup = 1\nmax_rollout_age_days = 10\nmin_rate_limit_remaining_percent = 25\nmax_raw_memories_for_consolidation = 128\nmax_unused_days = 30/u,
  );
  assert.doesNotMatch(config, /^plugins = true$/mu);
  assert.match(config, /\[skills\]\ninclude_instructions = false/u);
  assert.match(config, /\[skills\.bundled\]\nenabled = false/u);
  assert.match(config, /\[history\]\npersistence = "none"/u);
  assert.match(config, /\[shell_environment_policy\]/u);
  assert.match(config, /inherit = "all"/u);
  assert.match(config, /include_only = \[/u);
  assert.match(config, /"EXA_API_KEY"/u);
  assert.match(config, /"MURPH_ASSISTANT_SKILLS_ROOT"/u);
  assert.match(config, /"PATH"/u);
  assert.match(config, /"VAULT"/u);
  assert.match(config, /\[shell_environment_policy\.set\]/u);
  assert.equal(config.split("\n").includes(`PATH = "${HOSTED_RUNNER_EXECUTABLE_PATH}"`), true);
  assert.doesNotMatch(config, /"ELEVENLABS_API_KEY"/u);
  assert.doesNotMatch(config, /"MURPH_ELEVENLABS_MODEL_ID"/u);
  assert.doesNotMatch(config, /"MURPH_ELEVENLABS_VOICE_ID"/u);
  assert.doesNotMatch(config, /"PDFTOTEXT_COMMAND"/u);
  assert.doesNotMatch(config, /"WHISPER_COMMAND"/u);
  assert.doesNotMatch(config, /"WHISPER_MODEL_PATH"/u);
  assert.doesNotMatch(config, /include_only = \[[^\]]*"OPENAI_API_KEY"/u);
  assert.doesNotMatch(config, /fixture-exa-env-value/u);
  assert.doesNotMatch(config, /secret-openai-key/u);

  const configMode = (await stat(result.codexConfigPath)).mode & 0o777;
  assert.equal(configMode, 0o600);
  const codexHomeMode = (await stat(result.codexHome)).mode & 0o777;
  assert.equal(codexHomeMode, 0o700);
});

test("hosted Codex shell policy excludes ElevenLabs runtime env without writing provider values", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      ELEVENLABS_API_KEY: "fixture-elevenlabs-env-value",
      EXA_API_KEY: "fixture-exa-env-value",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      MURPH_ELEVENLABS_VOICE_ID: "voice_murph",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });

  assert.equal(result.runtimeEnv.ELEVENLABS_API_KEY, "fixture-elevenlabs-env-value");
  assert.equal(result.runtimeEnv.EXA_API_KEY, "fixture-exa-env-value");
  assert.equal(result.runtimeEnv.MURPH_ELEVENLABS_MODEL_ID, "eleven_multilingual_v2");
  assert.equal(result.runtimeEnv.MURPH_ELEVENLABS_VOICE_ID, "voice_murph");
  const config = await readFile(result.codexConfigPath, "utf8");
  assert.match(config, /"EXA_API_KEY"/u);
  assert.doesNotMatch(config, /"ELEVENLABS_API_KEY"/u);
  assert.doesNotMatch(config, /"MURPH_ELEVENLABS_MODEL_ID"/u);
  assert.doesNotMatch(config, /"MURPH_ELEVENLABS_VOICE_ID"/u);
  assert.doesNotMatch(config, /fixture-elevenlabs-env-value/u);
  assert.doesNotMatch(config, /fixture-exa-env-value/u);
  assert.doesNotMatch(config, /eleven_multilingual_v2/u);
  assert.doesNotMatch(config, /voice_murph/u);
  assert.doesNotMatch(config, /secret-openai-key/u);
});

test("hosted Codex runtime env exposes bundled CLI bins on PATH", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const reducedSystemPath = "/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games";
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "secret-openai-key",
      PATH: reducedSystemPath,
    },
  });

  assert.equal(result.runtimeEnv.PATH, buildHostedRunnerExecutablePath(reducedSystemPath));
  assert.equal(result.runtimeEnv.PATH.startsWith("/app/node_modules/.bin:"), true);
  assert.equal(
    result.runtimeEnv.PATH.split(":").filter((entry) => entry === "/app/node_modules/.bin")
      .length,
    1,
  );
  const config = await readFile(result.codexConfigPath, "utf8");
  assert.equal(config.split("\n").includes(`PATH = "${HOSTED_RUNNER_EXECUTABLE_PATH}"`), true);
});

test("hosted Codex config pins PATH after shell snapshots are sourced", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const reducedSystemPath = "/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games";
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "test-openai-key",
      PATH: reducedSystemPath,
    },
  });

  const config = await readFile(result.codexConfigPath, "utf8");
  const lines = config.split("\n");
  const shellPolicyIndex = lines.indexOf("[shell_environment_policy]");
  const shellSetIndex = lines.indexOf("[shell_environment_policy.set]");

  assert.notEqual(shellPolicyIndex, -1);
  assert.notEqual(shellSetIndex, -1);
  assert.equal(shellSetIndex > shellPolicyIndex, true);
  assert.equal(lines[shellSetIndex + 1], `PATH = "${HOSTED_RUNNER_EXECUTABLE_PATH}"`);
  assert.equal(HOSTED_RUNNER_EXECUTABLE_PATH.startsWith("/app/node_modules/.bin:"), true);
  assert.equal(result.runtimeEnv.PATH.startsWith("/app/node_modules/.bin:"), true);
});

test("hosted Cloudflare Codex config injects the hosted auto-compaction limit", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });

  const config = await readFile(result.codexConfigPath, "utf8");
  assertHostedCodexAutoCompactTokenLimit(config);
});

test("hosted Codex runtime config strips legacy hosted assistant seed env before bootstrap", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
      HOSTED_ASSISTANT_BASE_URL: "https://legacy-provider.example.test/v1",
      HOSTED_ASSISTANT_CODEX_COMMAND: "codex-dev",
      HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS: "openai",
      HOSTED_ASSISTANT_OSS: "true",
      HOSTED_ASSISTANT_PROFILE: "legacy-profile",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_PROVIDER_NAME: "legacy-provider",
      MURPH_HOSTED_CODEX_BOUND_USER_ID: "member_123",
      MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID: "attempt_123",
      MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION: "7",
      MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION: "42",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });

  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_PROVIDER, "openai");
  assert.equal(result.runtimeEnv.OPENAI_API_KEY, "secret-openai-key");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_API_KEY_ENV, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_BASE_URL, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_CODEX_COMMAND, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_OSS, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_PROFILE, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_PROVIDER_NAME, undefined);
  assert.equal(result.runtimeEnv.MURPH_HOSTED_CODEX_BOUND_USER_ID, undefined);
  assert.equal(result.runtimeEnv.MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID, undefined);
  assert.equal(result.runtimeEnv.MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION, undefined);
  assert.equal(result.runtimeEnv.MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION, undefined);
});

test("hosted Codex runtime config omits the model for blank env values", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_MODEL: "   ",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });

  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_MODEL, undefined);
  const config = await readFile(result.codexConfigPath, "utf8");
  assert.doesNotMatch(config, /^model = /mu);
});

test("hosted Codex runtime config preserves explicit model and reasoning env", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_MODEL: "gpt-explicit",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "high",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });

  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_MODEL, "gpt-explicit");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT, "high");
  const config = await readFile(result.codexConfigPath, "utf8");
  assert.match(config, /model = "gpt-explicit"/u);
  assert.match(config, /model_reasoning_effort = "high"/u);
});

test("hosted Codex runtime config accepts a local test-only model provider base URL override", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
        "http://host.docker.internal:4567/v1",
      NODE_ENV: "test",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });

  assert.equal(
    result.runtimeEnv[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV],
    "hosted-openai",
  );

  const config = await readFile(result.codexConfigPath, "utf8");
  assert.match(config, /model_provider = "hosted-openai"/u);
  assert.match(config, /\[model_providers\."hosted-openai"\]/u);
  assert.match(config, /base_url = "http:\/\/host\.docker\.internal:4567\/v1"/u);
  assert.match(config, /env_key = "OPENAI_API_KEY"/u);
  assert.match(config, /requires_openai_auth = false/u);
  assert.doesNotMatch(config, /^supports_websockets = true$/mu);
  assert.match(config, /request_max_retries = 4/u);
  assert.match(config, /stream_max_retries = 5/u);
  assert.doesNotMatch(config, /https:\/\/api\.openai\.com\/v1/u);
});

test("hosted Codex runtime config accepts a Linux Docker bridge model provider override", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
        "http://172.17.0.1:4567/v1",
      NODE_ENV: "test",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });

  const config = await readFile(result.codexConfigPath, "utf8");
  assert.match(config, /model_provider = "hosted-openai"/u);
  assert.match(config, /base_url = "http:\/\/172\.17\.0\.1:4567\/v1"/u);
});

test("hosted Codex runtime config uses ChatGPT subscription auth in local dev", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const chatGptAuthJson = buildChatGptCodexAuthJson();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      [HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]: encodeChatGptCodexAuthEnvValue(chatGptAuthJson),
      NODE_ENV: "development",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });

  // The built-in provider id routes Codex to the ChatGPT backend via auth.json.
  assert.equal(
    result.runtimeEnv[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV],
    "openai",
  );
  // Token material must not linger in the runtime env; image-gen keeps the key.
  assert.equal(result.runtimeEnv[HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV], undefined);
  assert.equal(result.runtimeEnv.OPENAI_API_KEY, "secret-openai-key");

  const codexAuthPath = path.join(result.codexHome, "auth.json");
  assert.equal(await readFile(codexAuthPath, "utf8"), chatGptAuthJson);
  const authMode = (await stat(codexAuthPath)).mode & 0o777;
  assert.equal(authMode, 0o600);

  const config = await readFile(result.codexConfigPath, "utf8");
  assert.match(config, /^cli_auth_credentials_store = "file"$/mu);
  assert.match(config, /^model_provider = "openai"$/mu);
  assert.doesNotMatch(config, /\[model_providers\./u);
  assert.doesNotMatch(config, /base_url/u);
  assert.doesNotMatch(config, /env_key/u);
  assert.doesNotMatch(config, /requires_openai_auth/u);
  assert.doesNotMatch(config, /chatgpt-access-token/u);
  assert.match(config, /model_reasoning_effort = "low"/u);
  assert.match(config, /\[history\]\npersistence = "none"/u);
  assert.match(config, /\[shell_environment_policy\]/u);
  assertHostedCodexAutoCompactTokenLimit(config);
});

test("hosted Codex runtime config rejects ChatGPT subscription auth outside development", async () => {
  for (const nodeEnv of ["production", "test", undefined]) {
    const operatorHomeRoot = await createTemporaryDirectory();

    await assert.rejects(
      () =>
        prepareHostedCodexRuntimeEnvironment({
          operatorHomeRoot,
          runtimeEnv: {
            HOSTED_ASSISTANT_PROVIDER: "openai",
            [HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]:
              encodeChatGptCodexAuthEnvValue(buildChatGptCodexAuthJson()),
            ...(nodeEnv ? { NODE_ENV: nodeEnv } : {}),
            OPENAI_API_KEY: "secret-openai-key",
          },
        }),
      (error) =>
        error instanceof HostedAssistantConfigurationError
        && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
        && error.message.includes(HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV)
        && error.message.includes("NODE_ENV=development"),
    );
  }
});

test("hosted Codex runtime config rejects malformed ChatGPT subscription auth", async () => {
  for (const malformed of [
    // Not base64url-encoded JSON at all.
    "not-base64url-json",
    ...[
      JSON.stringify({ OPENAI_API_KEY: "sk-direct-key" }),
      JSON.stringify({ auth_mode: "apikey", tokens: chatGptCodexAuthTokens() }),
      JSON.stringify({
        OPENAI_API_KEY: "sk-direct-key",
        last_refresh: "2026-06-11T00:00:00.000Z",
        tokens: chatGptCodexAuthTokens(),
      }),
      JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "only-access" } }),
      JSON.stringify({
        OPENAI_API_KEY: null,
        auth_mode: "chatgpt",
        last_refresh: "2026-06-11T00:00:00.000Z",
        tokens: chatGptCodexAuthTokens(),
      }),
      JSON.stringify({
        OPENAI_API_KEY: null,
        auth_mode: "chatgptAuthTokens",
        tokens: chatGptCodexAuthTokens(),
      }),
      JSON.stringify({
        OPENAI_API_KEY: null,
        auth_mode: "chatgptAuthTokens",
        last_refresh: "2026-06-11",
        tokens: chatGptCodexAuthTokens(),
      }),
      JSON.stringify({
        OPENAI_API_KEY: null,
        auth_mode: "chatgptAuthTokens",
        last_refresh: "2026-06-11T00:00:00.000Z",
        tokens: {
          access_token: "chatgpt-access-token",
          account_id: "account-1234",
          id_token: "chatgpt-id-token",
          refresh_token: "",
        },
      }),
    ].map(encodeChatGptCodexAuthEnvValue),
  ]) {
    const operatorHomeRoot = await createTemporaryDirectory();

    await assert.rejects(
      () =>
        prepareHostedCodexRuntimeEnvironment({
          operatorHomeRoot,
          runtimeEnv: {
            HOSTED_ASSISTANT_PROVIDER: "openai",
            [HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]: malformed,
            NODE_ENV: "development",
            OPENAI_API_KEY: "secret-openai-key",
          },
        }),
      (error) =>
        error instanceof HostedAssistantConfigurationError
        && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
        && error.message.includes(HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV)
        // Never echo token material into configuration errors.
        && !error.message.includes("chatgpt-access-token")
        && !error.message.includes("sk-direct-key"),
    );
  }
});

test("hosted Codex runtime config writes no auth.json without subscription auth", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });

  await assert.rejects(() => readFile(path.join(result.codexHome, "auth.json"), "utf8"));
});

test("hosted Codex runtime config removes stale subscription auth from a persistent home", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const subscriptionResult = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      [HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]:
        encodeChatGptCodexAuthEnvValue(buildChatGptCodexAuthJson()),
      NODE_ENV: "development",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });
  const codexAuthPath = path.join(subscriptionResult.codexHome, "auth.json");
  await readFile(codexAuthPath, "utf8");

  // A later wake without subscription auth must not leave stale tokens behind.
  await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });
  await assert.rejects(() => readFile(codexAuthPath, "utf8"));
});

test("hosted Codex runtime config preserves managed ChatGPT auth", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const codexHome = path.join(operatorHomeRoot, ".codex-hosted");
  const codexAuthPath = path.join(codexHome, "auth.json");
  const managedAuthJson = buildManagedChatGptCodexAuthJson();
  await mkdir(codexHome, {
    mode: 0o700,
    recursive: true,
  });
  await writeFile(codexAuthPath, managedAuthJson, {
    encoding: "utf8",
    mode: 0o600,
  });

  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      NODE_ENV: "test",
    },
  });

  assert.equal(await readFile(codexAuthPath, "utf8"), managedAuthJson);
  assert.equal(result.runtimeEnv.OPENAI_API_KEY, undefined);
  assert.equal(
    result.runtimeEnv[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV],
    "openai",
  );

  const config = await readFile(result.codexConfigPath, "utf8");
  assert.match(config, /^cli_auth_credentials_store = "file"$/mu);
  assert.match(config, /^model_provider = "openai"$/mu);
  assert.doesNotMatch(config, /\[model_providers\./u);
  assert.doesNotMatch(config, /chatgpt-refresh-token/u);
  assertHostedCodexAutoCompactTokenLimit(config);
});

test("hosted Codex runtime config removes invalid persistent ChatGPT auth", async () => {
  for (const invalidAuthJson of [
    "{\"auth_mode\":\"chatgpt\"",
    JSON.stringify({
      OPENAI_API_KEY: null,
      auth_mode: "chatgpt",
      last_refresh: "2026-06-11T00:00:00.000Z",
      tokens: {
        access_token: "chatgpt-access-token",
      },
    }),
  ]) {
    const operatorHomeRoot = await createTemporaryDirectory();
    const codexHome = path.join(operatorHomeRoot, ".codex-hosted");
    const codexAuthPath = path.join(codexHome, "auth.json");
    await mkdir(codexHome, {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(codexAuthPath, invalidAuthJson, {
      encoding: "utf8",
      mode: 0o600,
    });

    const result = await prepareHostedCodexRuntimeEnvironment({
      operatorHomeRoot,
      runtimeEnv: {
        HOSTED_ASSISTANT_PROVIDER: "openai",
        OPENAI_API_KEY: "secret-openai-key",
      },
    });

    await assert.rejects(() => readFile(codexAuthPath, "utf8"));
    assert.equal(
      result.runtimeEnv[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV],
      "hosted-openai",
    );

    const config = await readFile(result.codexConfigPath, "utf8");
    assert.doesNotMatch(config, /^cli_auth_credentials_store = "file"$/mu);
    assert.match(config, /^model_provider = "hosted-openai"$/mu);
    assert.doesNotMatch(config, /chatgpt-access-token/u);
  }
});

test("hosted runtime launch env policy forwards the dev-only ChatGPT subscription auth", () => {
  assert.equal(
    (HOSTED_RUNTIME_ENV_PROFILE_KEYS.assistant as readonly string[]).includes(
      HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
    ),
    true,
  );
  const encodedAuthJson = encodeChatGptCodexAuthEnvValue(buildChatGptCodexAuthJson());
  assert.equal(
    buildHostedRuntimeForwardedEnv({
      HOSTED_ASSISTANT_PROVIDER: "openai",
      [HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]: encodedAuthJson,
      NODE_ENV: "development",
      OPENAI_API_KEY: "openai-key",
    })[HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV],
    encodedAuthJson,
  );
});

test("hosted Codex runtime config rejects command override outside test mode", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "openai",
          [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: "/tmp/hosted-local-codex",
          NODE_ENV: "production",
          OPENAI_API_KEY: "secret-openai-key",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
      && error.message.includes(HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV)
      && error.message.includes("NODE_ENV=test"),
  );
});

test("hosted Codex runtime config rejects relative command overrides", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "openai",
          [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: "codex-local-shim",
          NODE_ENV: "test",
          OPENAI_API_KEY: "secret-openai-key",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
      && error.message.includes(HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV)
      && error.message.includes("absolute path"),
  );
});

testHostedCodexAuthE2e(
  "hosted Codex runtime authenticates but the legacy built-in OpenAI config fails",
  async () => {
    const operatorHomeRoot = await createTemporaryDirectory();
    const requests: string[] = [];
    const authorizationHeaders: string[] = [];
    const expectedAuthorization = ["Bearer", "hosted-auth-regression-key"].join(" ");
    const server = await startResponsesStubServer({
      authorizationHeaders,
      requiredAuthorization: expectedAuthorization,
      requests,
      responseText: "auth regression ok",
    });

    try {
      const result = await prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_MODEL: "gpt-5.5",
          HOSTED_ASSISTANT_PROVIDER: "openai",
          [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
            `${readServerBaseUrl(server)}/v1`,
          NODE_ENV: "test",
          OPENAI_API_KEY: "hosted-auth-regression-key",
          PATH: process.env.PATH ?? "",
        },
      });
      const config = await readFile(result.codexConfigPath, "utf8");

      assert.match(config, /^model_provider = "hosted-openai"$/mu);
      assert.match(config, /\[model_providers\."hosted-openai"\]/u);
      assert.match(config, /^env_key = "OPENAI_API_KEY"$/mu);
      assert.match(config, /^requires_openai_auth = false$/mu);
      assert.doesNotMatch(config, /^model_provider = "openai"$/mu);

      const fixedResult = await executeCodexAppServerTurn({
        approvalPolicy: "never",
        codexHome: result.runtimeEnv.CODEX_HOME,
        env: {
          CODEX_HOME: result.runtimeEnv.CODEX_HOME,
          HOME: operatorHomeRoot,
          OPENAI_API_KEY: result.runtimeEnv.OPENAI_API_KEY,
          PATH: result.runtimeEnv.PATH ?? process.env.PATH ?? "",
        },
        prompt: "hello hosted auth regression",
        sandbox: "danger-full-access",
        workingDirectory: operatorHomeRoot,
      });

      assert.equal(requests.length, 1);
      assert.equal(fixedResult.finalMessage, "auth regression ok");
      assert.equal(authorizationHeaders[0], expectedAuthorization);
      assert.match(requests[0]!, /hello hosted auth regression/u);

      const legacyCodexHome = await prepareLegacyBuiltInOpenAiCodexHome({
        baseUrl: `${readServerBaseUrl(server)}/v1`,
        operatorHomeRoot,
      });
      let legacyError: unknown = null;
      try {
        await executeCodexAppServerTurn({
          abortSignal: AbortSignal.timeout(3_000),
          approvalPolicy: "never",
          codexHome: legacyCodexHome,
          env: {
            CODEX_HOME: legacyCodexHome,
            HOME: operatorHomeRoot,
            OPENAI_API_KEY: "hosted-auth-regression-key",
            PATH: result.runtimeEnv.PATH ?? process.env.PATH ?? "",
          },
          prompt: "hello legacy hosted auth regression",
          sandbox: "danger-full-access",
          workingDirectory: operatorHomeRoot,
        });
      } catch (error) {
        legacyError = error;
      }

      assert.notEqual(authorizationHeaders[1], expectedAuthorization);
      assert(legacyError instanceof Error);
    } finally {
      await closeHttpServer(server);
    }
  },
  20_000,
);

testHostedCodexAutocompactionE2e(
  "hosted Codex app-server auto-compacts oversized resumed context",
  async () => {
    const workspaceRoot = await createTemporaryDirectory();
    const operatorHomeRoot = path.join(workspaceRoot, "operator-home");
    const vaultRoot = path.join(workspaceRoot, "vault");
    const rawContextMarker = `HOSTED_CODEX_AUTOCOMPACTION_RAW_${Date.now()}`;
    const rawContext = Array.from(
      { length: 12 },
      (_, index) =>
        `${rawContextMarker}_${String(index).padStart(3, "0")} synthetic oversized turn context.`,
    ).join("\n");
    const requests: string[] = [];
    const requestUrls: string[] = [];
    const compactionRequestIndexes = new Set<number>();
    const server = await startResponsesStubServer({
      requestUrls,
      requests,
      responseTextForRequest: (body, requestIndex, requestUrl) => {
        if (requestIndex === 1) {
          return "first assistant reply before auto-compaction";
        }

        if (
          compactionRequestIndexes.size === 0
          && (
            requestUrl === "/v1/responses/compact"
            || isResponsesAutocompactionRequest(body)
          )
        ) {
          compactionRequestIndexes.add(requestIndex);
          return `${HOSTED_CODEX_AUTOCOMPACTION_SUMMARY_SENTINEL}: the first turn included a large synthetic context and received a brief reply.`;
        }

        return "second assistant reply after auto-compaction";
      },
      usageForRequest: (_body, requestIndex) =>
        compactionRequestIndexes.has(requestIndex)
          ? {
              input_tokens: 300,
              input_tokens_details: null,
              output_tokens: 80,
              output_tokens_details: null,
              total_tokens: 380,
            }
          : {
              input_tokens: 13_000,
              input_tokens_details: null,
              output_tokens: 500,
              output_tokens_details: null,
              total_tokens: 13_500,
            },
    });

    try {
      await mkdir(vaultRoot, { recursive: true });
      const prepared = await prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_MODEL: "gpt-5.5",
          HOSTED_ASSISTANT_PROVIDER: "openai",
          [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
            `${readServerBaseUrl(server)}/v1`,
          NODE_ENV: "test",
          OPENAI_API_KEY: "hosted-autocompaction-e2e-key",
          PATH: process.env.PATH ?? "",
        },
      });
      const codexEnv = {
        CODEX_HOME: prepared.runtimeEnv.CODEX_HOME,
        HOME: operatorHomeRoot,
        OPENAI_API_KEY: prepared.runtimeEnv.OPENAI_API_KEY,
        PATH: prepared.runtimeEnv.PATH ?? process.env.PATH ?? "",
      };
      const configOverrides = [
        `model_auto_compact_token_limit=${HOSTED_CODEX_AUTOCOMPACTION_E2E_TOKEN_LIMIT}`,
      ];
      const firstResult = await executeCodexAppServerTurn({
        abortSignal: AbortSignal.timeout(60_000),
        approvalPolicy: "never",
        codexHome: prepared.runtimeEnv.CODEX_HOME,
        configOverrides,
        env: codexEnv,
        prompt: [
          "Please acknowledge this synthetic oversized hosted Codex context briefly.",
          rawContext,
        ].join("\n\n"),
        sandbox: "danger-full-access",
        workingDirectory: vaultRoot,
      });
      assert.equal(firstResult.finalMessage, "first assistant reply before auto-compaction");
      assert.ok(firstResult.threadId);

      const responseCountAfterFirstTurn = requests.length;
      const secondResult = await executeCodexAppServerTurn({
        abortSignal: AbortSignal.timeout(60_000),
        approvalPolicy: "never",
        codexHome: prepared.runtimeEnv.CODEX_HOME,
        configOverrides,
        env: codexEnv,
        prompt: "Please use the compacted context and answer with a short second reply.",
        resumeSessionId: firstResult.threadId,
        sandbox: "danger-full-access",
        workingDirectory: vaultRoot,
      });

      assert.equal(secondResult.finalMessage, "second assistant reply after auto-compaction");
      assert.equal(secondResult.threadId, firstResult.threadId);
      assert.equal(
        compactionRequestIndexes.size > 0,
        true,
        "Expected real Codex app-server to issue a compaction Responses API request.",
      );
      const firstCompactionRequestIndex = Math.min(...compactionRequestIndexes);
      const modelRequestIndexes = requestUrls
        .map((requestUrl, index) => ({ index: index + 1, requestUrl }))
        .filter(({ requestUrl }) => requestUrl === "/v1/responses");
      const firstModelRequestIndex = modelRequestIndexes[0]?.index;
      const lastModelRequestIndex = modelRequestIndexes.at(-1)?.index;
      assert.ok(firstModelRequestIndex, "Expected the first turn to make a model request.");
      assert.ok(lastModelRequestIndex, "Expected the resumed turn to make a model request.");
      assert.equal(
        firstCompactionRequestIndex < lastModelRequestIndex,
        true,
        "Expected auto-compaction to complete before the resumed hosted Codex model request.",
      );
      const firstTurnInput = readResponsesRequestInput(requests[firstModelRequestIndex - 1]!);
      assert.equal(
        firstTurnInput.includes(rawContextMarker),
        true,
        "Expected the first model request path to include the synthetic oversized context.",
      );

      const secondTurnInput = readResponsesRequestInput(
        requests[lastModelRequestIndex - 1]!,
      );
      assert.equal(
        secondTurnInput.includes(HOSTED_CODEX_AUTOCOMPACTION_SUMMARY_SENTINEL),
        true,
        "Expected the resumed turn to include the compacted summary.",
      );
      assert.equal(
        secondTurnInput.includes(rawContextMarker),
        false,
        "Expected the resumed turn to exclude the raw oversized context after compaction.",
      );
    } finally {
      await closeHttpServer(server);
    }
  },
  150_000,
);

test("hosted Codex runtime config rejects the removed local Codex provider", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "local-codex",
          NODE_ENV: "development",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
      && error.message.includes("HOSTED_ASSISTANT_PROVIDER=openai"),
  );
});

test("hosted Codex runtime config rejects the model provider base URL override outside test mode", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "openai",
          [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
            "http://127.0.0.1:4123/v1",
          OPENAI_API_KEY: "secret-openai-key",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
      && error.message.includes("test-only"),
  );
});

test("hosted Codex runtime config rejects non-local model provider base URL overrides", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "openai",
          [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
            "http://provider.example.test/v1",
          NODE_ENV: "test",
          OPENAI_API_KEY: "secret-openai-key",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
      && error.message.includes("local test host"),
  );
});

test("hosted Codex runtime config rejects https model provider base URL overrides", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "openai",
          [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
            "https://127.0.0.1:4123/v1",
          NODE_ENV: "test",
          OPENAI_API_KEY: "secret-openai-key",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
      && error.message.includes("must use http"),
  );
});

test("hosted Codex runtime config rejects removed local dev app-server proxy env", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "openai",
          [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV]: "token",
          [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV]: "tcp://127.0.0.1:4123",
          NODE_ENV: "development",
          OPENAI_API_KEY: "secret-openai-key",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
      && error.message.includes(HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV)
      && error.message.includes(HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV)
      && error.message.includes("no longer supported"),
  );
});

test("hosted runtime launch env policy does not forward local Codex bridge config", () => {
  assert.equal(
    (HOSTED_RUNTIME_ENV_PROFILE_KEYS.assistant as readonly string[]).includes(
      HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
    ),
    false,
  );
  assert.equal(
    (HOSTED_RUNTIME_ENV_PROFILE_KEYS.assistant as readonly string[]).includes(
      HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
    ),
    false,
  );
  assert.equal(
    HOSTED_RUNTIME_ENV_KEY_NAMES.includes(HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV),
    false,
  );
  assert.equal(
    HOSTED_RUNTIME_ENV_KEY_NAMES.includes(HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV),
    false,
  );
  assert.deepEqual(
    buildHostedRuntimeForwardedEnv({
      HOSTED_ASSISTANT_MODEL: "ignored-local-model",
      HOSTED_ASSISTANT_PROVIDER: "local-codex",
      [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV]: "bridge-token",
      [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV]: "tcp://127.0.0.1:4222",
    }),
    {
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "production",
    },
  );
});

test("hosted runtime launch env policy does not forward non-provider platform secrets", () => {
  assert.equal(
    (HOSTED_RUNTIME_ENV_PROFILE_KEYS.assistant as readonly string[]).includes(
      "HOSTED_AI_USAGE_REPORTING_SECRET",
    ),
    false,
  );
  assert.equal(
    (HOSTED_RUNTIME_ENV_PROFILE_KEYS.assistant as readonly string[]).includes(
      "HOSTED_LOG_FINGERPRINT_SECRET",
    ),
    false,
  );
  assert.equal(HOSTED_RUNTIME_ENV_KEY_NAMES.includes("HOSTED_AI_USAGE_REPORTING_SECRET"), false);
  assert.equal(HOSTED_RUNTIME_ENV_KEY_NAMES.includes("HOSTED_LOG_FINGERPRINT_SECRET"), false);
  assert.deepEqual(
    buildHostedRuntimeForwardedEnv({
      HOSTED_AI_USAGE_REPORTING_SECRET: "usage-secret",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-secret",
      NODE_ENV: "test",
      OPENAI_API_KEY: "openai-key",
    }),
    {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      NODE_ENV: "test",
      OPENAI_API_KEY: "openai-key",
    },
  );
});

test("hosted runtime launch env policy forwards the test-only model provider base URL override", () => {
  assert.equal(
    (HOSTED_RUNTIME_ENV_PROFILE_KEYS.assistant as readonly string[]).includes(
      HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
    ),
    true,
  );
  assert.equal(
    HOSTED_RUNTIME_ENV_KEY_NAMES.includes(
      HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
    ),
    true,
  );
  assert.equal(
    buildHostedRuntimeForwardedEnv({
      HOSTED_ASSISTANT_PROVIDER: "openai",
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
        "http://127.0.0.1:4111/v1",
      NODE_ENV: "test",
      OPENAI_API_KEY: "openai-key",
    })[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV],
    "http://127.0.0.1:4111/v1",
  );
});

test("hosted runtime launch env policy forwards the neutral hosted Codex command override", () => {
  assert.equal(
    (HOSTED_RUNTIME_ENV_PROFILE_KEYS.assistant as readonly string[]).includes(
      HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
    ),
    true,
  );
  assert.equal(
    buildHostedRuntimeForwardedEnv({
      HOSTED_ASSISTANT_PROVIDER: "openai",
      [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: "/tmp/hosted-local-codex",
      NODE_ENV: "test",
      OPENAI_API_KEY: "openai-key",
    })[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV],
    "/tmp/hosted-local-codex",
  );
});

test("hosted runtime launch env policy does not forward the image-owned hosted Codex model catalog path", () => {
  assert.equal(
    (HOSTED_RUNTIME_ENV_PROFILE_KEYS.assistant as readonly string[]).includes(
      HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
    ),
    false,
  );
  assert.strictEqual(
    buildHostedRuntimeForwardedEnv({
      HOSTED_ASSISTANT_PROVIDER: "openai",
      [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]:
        "/usr/local/share/murph/codex-model-catalog.openai-flex.json",
      NODE_ENV: "test",
      OPENAI_API_KEY: "openai-key",
    })[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV],
    undefined,
  );
});

test("hosted Codex runtime config fails closed without the configured model credential env", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "openai",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_REQUIRED"
      && error.message.includes("OPENAI_API_KEY"),
  );
});

test("hosted Codex runtime config rejects non-Codex provider env", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "legacy-provider",
          HOSTED_ASSISTANT_MODEL: "legacy-model",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
      && error.message.includes("openai"),
  );
});

test("hosted Codex config TOML omits credential values and runtime authority headers", () => {
  const config = buildHostedCodexConfigToml({
    model: null,
    provider: {
      id: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      envKey: "OPENAI_API_KEY",
      wireApi: "responses",
    },
    reasoningEffort: "medium",
  });

  assert.equal(
    config,
    [
      'model_provider = "openai"',
      'model_reasoning_effort = "medium"',
      `model_auto_compact_token_limit = ${HOSTED_CODEX_EXPECTED_AUTO_COMPACT_TOKEN_LIMIT}`,
      'log_dir = "/tmp/murph-codex-log"',
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      "check_for_update_on_startup = false",
      "allow_login_shell = false",
      "",
      '[model_providers."openai"]',
      'name = "OpenAI"',
      'base_url = "https://api.openai.com/v1"',
      'env_key = "OPENAI_API_KEY"',
      'wire_api = "responses"',
      "requires_openai_auth = false",
      "",
      "# Hosted runs should not perform Codex plugin marketplace or remote plugin",
      "# sync work on cold wake; Murph owns the hosted runtime tool surface.",
      "[features]",
      "plugins = false",
      "memories = true",
      "",
      "# Murph prompts and skills direct sub-agent delegation for slow ingestion",
      "# (lab PDFs, supplement labels), but Codex 0.142.x's multi-agent mode",
      "# message only recognizes explicit user requests. The root-agent hint",
      "# REPLACES Codex's default, so it restates the 0.142.5 default verbatim",
      "# and appends the Murph skill-delegation authorization sentence.",
      "[features.multi_agent_v2]",
      "enabled = true",
      `root_agent_usage_hint_text = ${JSON.stringify(HOSTED_CODEX_ROOT_AGENT_USAGE_HINT)}`,
      "",
      "# Codex-native memories are operator memory only. Murph product memory",
      "# remains canonical in the vault; snapshots keep the Codex home allowlist",
      "# narrow instead of recursively preserving every generated memory artifact.",
      "[memories]",
      "use_memories = true",
      "generate_memories = true",
      "disable_on_external_context = false",
      "min_rollout_idle_hours = 1",
      "max_rollouts_per_startup = 1",
      "max_rollout_age_days = 10",
      "min_rate_limit_remaining_percent = 25",
      "max_raw_memories_for_consolidation = 128",
      "max_unused_days = 30",
      "",
      "# Keep Codex skill file instructions out of hosted prompts. Their temporary",
      "# runner paths change on each wake and break provider prefix caching.",
      "[skills]",
      "include_instructions = false",
      "",
      "[skills.bundled]",
      "enabled = false",
      "",
      "[history]",
      'persistence = "none"',
      "",
      "[shell_environment_policy]",
      'inherit = "all"',
      'include_only = ["CI", "CODEX_HOME", "CODEX_CA_CERTIFICATE", "COLORTERM", "CURL_CA_BUNDLE", "FORCE_COLOR", "HOME", "MURPH_HOSTED_CLI_BRIDGE_TOKEN", "MURPH_HOSTED_CLI_BRIDGE_URL", "MURPH_HOSTED_RUNTIME_PROCESS", "MURPH_ASSISTANT_SKILLS_ROOT", "LANG", "LC_ALL", "LC_CTYPE", "EXA_API_KEY", "MAPBOX_ACCESS_TOKEN", "MURPH_DATA_API_KEY", "NODE_EXTRA_CA_CERTS", "NO_COLOR", "PATH", "REQUESTS_CA_BUNDLE", "SSL_CERT_DIR", "SSL_CERT_FILE", "TEMP", "TERM", "TMP", "TMPDIR", "VAULT"]',
      "",
      "[shell_environment_policy.set]",
      `PATH = "${HOSTED_RUNNER_EXECUTABLE_PATH}"`,
      "",
    ].join("\n"),
  );
});

test("hosted Codex shell policy excludes ElevenLabs runtime capability env", () => {
  assert.deepEqual(
    HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY.filter((key: string) =>
      key === "ELEVENLABS_API_KEY" || key.startsWith("MURPH_ELEVENLABS_")
    ),
    [],
  );
});

test("hosted Codex config keeps skill instructions disabled while enabling operator memory", () => {
  const config = buildHostedCodexConfigToml({
    model: "gpt-5.5",
    provider: {
      id: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      envKey: "OPENAI_API_KEY",
      wireApi: "responses",
    },
    reasoningEffort: "low",
  });

  assert.match(config, /\[skills\]\ninclude_instructions = false/u);
  assert.match(config, /\[skills\.bundled\]\nenabled = false/u);
  assert.match(config, /\[features\]\nplugins = false/u);
  assert.match(config, /^\[features\.multi_agent_v2\]$/mu);
  assert.match(config, /^enabled = true$/mu);
  assert.match(config, /^root_agent_usage_hint_text = "You are `\/root`/mu);
  assert.match(config, /^memories = true$/mu);
  assert.match(config, /\[memories\]\nuse_memories = true/u);
  assert.match(config, /^generate_memories = true$/mu);
  assert.match(config, /^disable_on_external_context = false$/mu);
  assert.match(config, /^max_rollouts_per_startup = 1$/mu);
  assert.match(config, /^check_for_update_on_startup = false$/mu);
  assert.match(config, /\[history\]\npersistence = "none"/u);
  assert.match(config, /"MURPH_ASSISTANT_SKILLS_ROOT"/u);
  assert.doesNotMatch(config, /include_instructions = true/u);
  assert.doesNotMatch(config, /\[skills\.bundled\]\nenabled = true/u);
  assert.doesNotMatch(config, /^plugins = true$/mu);
  assert.match(config, /break provider prefix caching/u);
});

test("hosted Codex runtime exposes a stable package-owned assistant skill root", async () => {
  const workspaceRoot = await createTemporaryDirectory();
  const operatorHomeRootA = path.join(workspaceRoot, "murph-test-a", "home");
  const operatorHomeRootB = path.join(workspaceRoot, "murph-test-b", "home");

  const resultA = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot: operatorHomeRootA,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });
  const resultB = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot: operatorHomeRootB,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "secret-openai-key",
    },
  });

  assert.ok(resultA.runtimeEnv[MURPH_ASSISTANT_SKILLS_ROOT_ENV]);
  assert.equal(
    resultA.runtimeEnv[MURPH_ASSISTANT_SKILLS_ROOT_ENV],
    resultB.runtimeEnv[MURPH_ASSISTANT_SKILLS_ROOT_ENV],
  );
  assert.match(
    resultA.runtimeEnv[MURPH_ASSISTANT_SKILLS_ROOT_ENV] ?? "",
    /assistant-engine[/\\]skills$/,
  );
  const skillPath = path.join(
    resultA.runtimeEnv[MURPH_ASSISTANT_SKILLS_ROOT_ENV] ?? "",
    "experiment-onboarding",
    "SKILL.md",
  );
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\nname: experiment-onboarding$/mu);

  const configA = await readFile(resultA.codexConfigPath, "utf8");
  const configB = await readFile(resultB.codexConfigPath, "utf8");

  assert.doesNotMatch(configA, /murph-test-a/u);
  assert.doesNotMatch(configB, /murph-test-b/u);
  assert.match(configA, /"MURPH_ASSISTANT_SKILLS_ROOT"/u);
  assert.match(configB, /"MURPH_ASSISTANT_SKILLS_ROOT"/u);
});

async function createTemporaryDirectory(): Promise<string> {
  const target = await mkdtemp(path.join(tmpdir(), "hosted-codex-config-"));
  temporaryPaths.push(target);
  return target;
}

// The configured root-agent usage hint REPLACES Codex's default hint, so it
// must retain the default's operational guidance from the pinned
// @openai/codex 0.142.5 alongside the appended Murph authorization sentence.
// If a Codex version bump changes the default, re-copy it and update here.
function assertHostedCodexRootAgentUsageHintRetainsCodexDefaults(): void {
  assert.match(HOSTED_CODEX_ROOT_AGENT_USAGE_HINT, /^You are `\/root`, the primary agent/u);
  assert.ok(HOSTED_CODEX_ROOT_AGENT_USAGE_HINT.includes(
    "collaboration tools cannot be called from inside `functions.exec`",
  ));
  assert.ok(HOSTED_CODEX_ROOT_AGENT_USAGE_HINT.includes(
    "Message Type: MESSAGE | FINAL_ANSWER",
  ));
  assert.ok(HOSTED_CODEX_ROOT_AGENT_USAGE_HINT.includes(
    "You can decide how much context you want to propagate to your sub-agents with the `fork_turns` parameter.",
  ));
  assert.ok(HOSTED_CODEX_ROOT_AGENT_USAGE_HINT.includes(
    "There are 4 available concurrency slots",
  ));
  assert.ok(HOSTED_CODEX_ROOT_AGENT_USAGE_HINT.endsWith(
    "Murph system-prompt and skill instructions that direct delegating work to a sub-agent, such as onboarding supplement-label or lab-result ingestion, count as explicit user requests for sub-agent work under any multi-agent mode instruction.",
  ));
}

function chatGptCodexAuthTokens(): Record<string, string> {
  return {
    access_token: "chatgpt-access-token",
    account_id: "account-1234",
    id_token: buildFakeJwtPayload({ iss: "https://auth.openai.com", sub: "user-1" }),
    // The harness keeps the durable refresh token host-side and uses Codex's
    // external-token auth mode for the runner seed.
    refresh_token: "",
  };
}

function buildChatGptCodexAuthJson(): string {
  return JSON.stringify({
    OPENAI_API_KEY: null,
    auth_mode: "chatgptAuthTokens",
    last_refresh: "2026-06-11T00:00:00.000Z",
    tokens: chatGptCodexAuthTokens(),
  });
}

function buildManagedChatGptCodexAuthJson(): string {
  return JSON.stringify({
    OPENAI_API_KEY: null,
    auth_mode: "chatgpt",
    last_refresh: "2026-06-11T00:00:00.000Z",
    tokens: {
      ...chatGptCodexAuthTokens(),
      refresh_token: "chatgpt-refresh-token",
    },
  });
}

// The harness base64url-encodes the auth.json payload so it survives the
// wrangler env-file hop; mirror that contract here.
function encodeChatGptCodexAuthEnvValue(authJson: string): string {
  return Buffer.from(authJson, "utf8").toString("base64url");
}

function buildFakeJwtPayload(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString("base64url"),
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"),
    "signature",
  ].join(".");
}

async function removeTemporaryPath(target: string): Promise<void> {
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(target, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 50,
      });
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableTemporaryCleanupError(error)) {
        throw error;
      }

      await sleep(attempt * 50);
    }
  }
}

function isRetryableTemporaryCleanupError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }

  return error.code === "EBUSY"
    || error.code === "ENFILE"
    || error.code === "ENOTEMPTY"
    || error.code === "EMFILE"
    || error.code === "EPERM";
}

async function startResponsesStubServer(input: {
  authorizationHeaders?: string[];
  requiredAuthorization?: string;
  requests: string[];
  requestUrls?: string[];
  responseText?: string;
  responseTextForRequest?: (
    body: string,
    requestIndex: number,
    requestUrl: string,
  ) => string;
  responseTexts?: readonly string[];
  usageForRequest?: (
    body: string,
    requestIndex: number,
    requestUrl: string,
  ) => ResponsesStubUsage;
}): Promise<Server> {
  const responseTexts = [...(input.responseTexts ?? [])];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const requestIndex = input.requests.length + 1;
      input.requests.push(body);
      input.requestUrls?.push(request.url ?? "");
      input.authorizationHeaders?.push(
        typeof request.headers.authorization === "string"
          ? request.headers.authorization
          : "",
      );

      const requestUrl = request.url ?? "";
      if (
        request.method !== "POST"
        || (requestUrl !== "/v1/responses" && requestUrl !== "/v1/responses/compact")
      ) {
        response.statusCode = 404;
        response.end("not found");
        return;
      }

      if (
        input.requiredAuthorization
        && request.headers.authorization !== input.requiredAuthorization
      ) {
        response.statusCode = 401;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({
          error: {
            message: "Missing bearer auth for hosted Codex regression.",
            type: "invalid_request_error",
          },
        }));
        return;
      }

      response.setHeader("content-type", "application/json; charset=utf-8");
      const responseText =
        input.responseTextForRequest?.(body, requestIndex, requestUrl)
        ?? responseTexts.shift()
        ?? input.responseText
        ?? "shim response";
      const usage = input.usageForRequest?.(body, requestIndex, requestUrl) ?? {
        input_tokens: 24,
        input_tokens_details: null,
        output_tokens: 11,
        output_tokens_details: null,
        total_tokens: 35,
      };
      const parsedBody = parseJsonObject(body);
      if (parsedBody?.stream === true) {
        writeResponsesStubStream({
          response,
          responseId: `resp_hosted_codex_config_${requestIndex}`,
          responseText,
          usage,
        });
        return;
      }

      response.end(JSON.stringify({
        created_at: Math.floor(Date.now() / 1000),
        id: `resp_hosted_codex_config_${requestIndex}`,
        model: "gpt-5.5",
        output: [
          {
            content: [
              {
                annotations: [],
                text: responseText,
                type: "output_text",
              },
            ],
            id: `msg_hosted_codex_config_${requestIndex}`,
            role: "assistant",
            type: "message",
          },
        ],
        usage,
      }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

type ResponsesStubUsage = {
  input_tokens: number;
  input_tokens_details: null;
  output_tokens: number;
  output_tokens_details: null;
  total_tokens: number;
};

async function prepareLegacyBuiltInOpenAiCodexHome(input: {
  baseUrl: string;
  operatorHomeRoot: string;
}): Promise<string> {
  const codexHome = path.join(input.operatorHomeRoot, ".codex-legacy-openai");
  await mkdir(codexHome, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(codexHome, 0o700);
  await writeFile(
    path.join(codexHome, "config.toml"),
    [
      'model = "gpt-5.5"',
      'model_provider = "openai"',
      `openai_base_url = ${JSON.stringify(input.baseUrl)}`,
      'model_reasoning_effort = "medium"',
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      "",
      "[skills]",
      "include_instructions = false",
      "",
      "[skills.bundled]",
      "enabled = false",
      "",
    ].join("\n"),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  await chmod(path.join(codexHome, "config.toml"), 0o600);
  return codexHome;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function writeResponsesStubStream(input: {
  response: ServerResponse;
  responseId: string;
  responseText: string;
  usage: ResponsesStubUsage;
}): void {
  const messageId = `msg_${input.responseId}`;
  const outputItem = {
    content: [
      {
        annotations: [],
        text: input.responseText,
        type: "output_text",
      },
    ],
    id: messageId,
    role: "assistant",
    status: "completed",
    type: "message",
  };
  const completedResponse = {
    created_at: Math.floor(Date.now() / 1000),
    id: input.responseId,
    model: "gpt-5.5",
    output: [outputItem],
    status: "completed",
    usage: input.usage,
  };

  input.response.statusCode = 200;
  input.response.setHeader("cache-control", "no-cache");
  input.response.setHeader("content-type", "text/event-stream; charset=utf-8");
  writeResponsesStubSseEvent(input.response, "response.created", {
    response: {
      ...completedResponse,
      output: [],
      status: "in_progress",
    },
    type: "response.created",
  });
  writeResponsesStubSseEvent(input.response, "response.output_item.done", {
    item: outputItem,
    output_index: 0,
    type: "response.output_item.done",
  });
  writeResponsesStubSseEvent(input.response, "response.completed", {
    response: completedResponse,
    type: "response.completed",
  });
  input.response.write("data: [DONE]\n\n");
  input.response.end();
}

function writeResponsesStubSseEvent(
  response: ServerResponse,
  event: string,
  payload: Record<string, unknown>,
): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readResponsesRequestInput(body: string): string {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  return stringifyResponsesRequestInput(parsed.input);
}

function stringifyResponsesRequestInput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  return JSON.stringify(value);
}

function isResponsesAutocompactionRequest(body: string): boolean {
  const parsed = parseJsonObject(body);
  const searchable = JSON.stringify({
    input: parsed?.input,
    instructions: parsed?.instructions,
  }).toLowerCase();
  return (
    searchable.includes("summarize")
    || searchable.includes("summary")
  ) && (
    searchable.includes("conversation")
    || searchable.includes("context")
    || searchable.includes("thread")
  );
}

function readServerBaseUrl(server: Server): string {
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function assertHostedCodexAutoCompactTokenLimit(config: string): void {
  const matches = [...config.matchAll(/^model_auto_compact_token_limit\s*=\s*(\d+)$/gmu)];
  assert.equal(
    matches.length,
    1,
    "Hosted Codex config must inject exactly one model_auto_compact_token_limit setting.",
  );

  const limit = Number(matches[0]?.[1]);
  assert.equal(
    Number.isSafeInteger(limit) && limit > 0,
    true,
    "Hosted Codex config auto-compaction token limit must be a positive integer.",
  );
  assert.equal(
    limit,
    HOSTED_CODEX_EXPECTED_AUTO_COMPACT_TOKEN_LIMIT,
    "Hosted Codex config auto-compaction token limit must match the hosted reply budget.",
  );
  assert.equal(
    limit < HOSTED_CODEX_AUTO_COMPACT_TOKEN_LIMIT_CEILING,
    true,
    "Hosted Codex config auto-compaction token limit must stay below 250k tokens.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
