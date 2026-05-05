import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import {
  HostedAssistantConfigurationError,
} from "@murphai/operator-config/hosted-assistant-config";
import {
  buildHostedRuntimeForwardedEnv,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
  HOSTED_RUNTIME_ENV_KEY_NAMES,
  HOSTED_RUNTIME_ENV_PROFILE_KEYS,
} from "../src/hosted-runtime/launch-spec.ts";

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
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_MODEL, undefined);
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT, "medium");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_APPROVAL_POLICY, "never");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_SANDBOX, "danger-full-access");

  const config = await readFile(result.codexConfigPath, "utf8");
  assert.doesNotMatch(config, /^model = /mu);
  assert.match(config, /model_provider = "vercel-ai-gateway"/u);
  assert.match(config, /model_reasoning_effort = "medium"/u);
  assert.match(config, /approval_policy = "never"/u);
  assert.match(config, /sandbox_mode = "danger-full-access"/u);
  assert.match(config, /\[model_providers\."vercel-ai-gateway"\]/u);
  assert.match(config, /base_url = "https:\/\/ai-gateway\.vercel\.sh\/v1"/u);
  assert.match(config, /env_key = "VERCEL_AI_API_KEY"/u);
  assert.match(config, /wire_api = "responses"/u);
  assert.match(config, /\[shell_environment_policy\]/u);
  assert.match(config, /inherit = "none"/u);
  assert.match(config, /include_only = \[/u);
  assert.match(config, /"PATH"/u);
  assert.match(config, /"VAULT"/u);
  assert.doesNotMatch(config, /"PDFTOTEXT_COMMAND"/u);
  assert.doesNotMatch(config, /"WHISPER_COMMAND"/u);
  assert.doesNotMatch(config, /"WHISPER_MODEL_PATH"/u);
  assert.doesNotMatch(config, /include_only = \[[^\]]*"VERCEL_AI_API_KEY"/u);
  assert.doesNotMatch(config, /secret-vercel-key/u);

  const configMode = (await stat(result.codexConfigPath)).mode & 0o777;
  assert.equal(configMode, 0o600);
  const codexHomeMode = (await stat(result.codexHome)).mode & 0o777;
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
});

test("hosted Codex runtime config drops blank model env values", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_MODEL: "   ",
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      VERCEL_AI_API_KEY: "secret-vercel-key",
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
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      HOSTED_ASSISTANT_REASONING_EFFORT: "high",
      VERCEL_AI_API_KEY: "secret-vercel-key",
    },
  });

  const config = await readFile(result.codexConfigPath, "utf8");
  assert.match(config, /model = "gpt-explicit"/u);
  assert.match(config, /model_reasoning_effort = "high"/u);
});

test("hosted Codex runtime config accepts a local test-only model provider base URL override", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
        "http://host.docker.internal:4567/v1",
      NODE_ENV: "test",
      VERCEL_AI_API_KEY: "secret-vercel-key",
    },
  });

  const config = await readFile(result.codexConfigPath, "utf8");
  assert.match(config, /base_url = "http:\/\/host\.docker\.internal:4567\/v1"/u);
  assert.match(config, /request_max_retries = 0/u);
  assert.match(config, /stream_max_retries = 0/u);
  assert.doesNotMatch(config, /https:\/\/ai-gateway\.vercel\.sh\/v1/u);
});

test("hosted Codex runtime config accepts a Linux Docker bridge model provider override", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
        "http://172.17.0.1:4567/v1",
      NODE_ENV: "test",
      VERCEL_AI_API_KEY: "secret-vercel-key",
    },
  });

  const config = await readFile(result.codexConfigPath, "utf8");
  assert.match(config, /base_url = "http:\/\/172\.17\.0\.1:4567\/v1"/u);
});

test("hosted Codex runtime config installs a local E2E app-server stub when configured", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const result = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot,
    runtimeEnv: {
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      [HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV]:
        "http://host.docker.internal:4123/v1",
      NODE_ENV: "test",
      VERCEL_AI_API_KEY: "secret-vercel-key",
    },
  });

  const shimBinDir = path.join(result.codexHome, "bin");
  const shimPath = path.join(shimBinDir, "codex");
  assert.equal(
    result.runtimeEnv.PATH?.startsWith(`${shimBinDir}${path.delimiter}`),
    true,
  );
  const shimSource = await readFile(shimPath, "utf8");
  assert.match(shimSource, /^#!\/usr\/bin\/env node/u);
  assert.match(shimSource, /hosted-e2e-codex-shim/u);
  assert.match(shimSource, /http:\/\/host\.docker\.internal:4123\/v1/u);
  const shimMode = (await stat(shimPath)).mode & 0o777;
  assert.equal(shimMode, 0o700);
});

test("hosted Codex runtime local E2E app-server stub bridges JSON-RPC turns to Responses", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const requests: string[] = [];
  const server = await startResponsesStubServer({
    requests,
    responseText: "shim response",
  });

  try {
    const result = await prepareHostedCodexRuntimeEnvironment({
      operatorHomeRoot,
      runtimeEnv: {
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        [HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV]:
          `${readServerBaseUrl(server)}/v1`,
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        VERCEL_AI_API_KEY: "secret-vercel-key",
      },
    });
    const child = spawn(path.join(result.codexHome, "bin", "codex"), ["app-server"], {
      env: {
        ...process.env,
        CODEX_HOME: result.runtimeEnv.CODEX_HOME,
        PATH: result.runtimeEnv.PATH,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const messages = await runHostedLocalCodexStubTurn(child);

    assert.equal(requests.length, 1);
    assert.match(requests[0]!, /hello hosted local/u);
    assert.deepEqual(
      messages.find((message) => message.type === "item.completed"),
      {
        item: {
          id: "msg_turn_hosted_local_1",
          text: "shim response",
          type: "assistant.message",
        },
        type: "item.completed",
      },
    );
    const continuityLog = await readHostedLocalCodexShimContinuityLog(result.codexHome);
    const continuityEntries = parseHostedLocalCodexShimContinuityEntries(continuityLog);
    assert.deepEqual(continuityEntries, [
      {
        event: "thread.started",
        schema: "murph.hosted-e2e-codex-shim-continuity.v1",
        threadId: "thread_hosted_local_1",
      },
    ]);
    assert.doesNotMatch(continuityLog, /hello hosted local/u);
    assert.doesNotMatch(continuityLog, /shim response/u);
  } finally {
    await closeHttpServer(server);
  }
});

test("hosted Codex runtime local E2E app-server stub preserves resumed assistant context", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();
  const requests: string[] = [];
  const server = await startResponsesStubServer({
    requests,
    responseTexts: ["first assistant reply", "second assistant reply"],
  });

  try {
    const result = await prepareHostedCodexRuntimeEnvironment({
      operatorHomeRoot,
      runtimeEnv: {
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        [HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV]:
          `${readServerBaseUrl(server)}/v1`,
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        VERCEL_AI_API_KEY: "secret-vercel-key",
      },
    });
    const child = spawn(path.join(result.codexHome, "bin", "codex"), ["app-server"], {
      env: {
        ...process.env,
        CODEX_HOME: result.runtimeEnv.CODEX_HOME,
        PATH: result.runtimeEnv.PATH,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    await runHostedLocalCodexStubTurn(child, [
      "first hosted local prompt",
      "second hosted local prompt",
    ]);

    assert.equal(requests.length, 2);
    assert.match(readResponsesRequestInput(requests[0]!), /first hosted local prompt/u);
    assert.match(readResponsesRequestInput(requests[1]!), /second hosted local prompt/u);
    assert.match(
      readResponsesRequestInput(requests[1]!),
      /Conversation so far:\nAssistant:\nfirst assistant reply/u,
    );
    const continuityLog = await readHostedLocalCodexShimContinuityLog(result.codexHome);
    assert.deepEqual(parseHostedLocalCodexShimContinuityEntries(continuityLog), [
      {
        event: "thread.started",
        schema: "murph.hosted-e2e-codex-shim-continuity.v1",
        threadId: "thread_hosted_local_1",
      },
      {
        event: "thread.resumed",
        schema: "murph.hosted-e2e-codex-shim-continuity.v1",
        threadId: "thread_test",
      },
    ]);
    assert.doesNotMatch(continuityLog, /first hosted local prompt/u);
    assert.doesNotMatch(continuityLog, /second hosted local prompt/u);
    assert.doesNotMatch(continuityLog, /first assistant reply/u);
    assert.doesNotMatch(continuityLog, /second assistant reply/u);
  } finally {
    await closeHttpServer(server);
  }
});

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
      && error.message.includes("HOSTED_ASSISTANT_PROVIDER=vercel-ai-gateway"),
  );
});

test("hosted Codex runtime config rejects the local E2E app-server stub for non-local hosts", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
          [HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV]:
            "https://provider.example.test/v1",
          NODE_ENV: "test",
          VERCEL_AI_API_KEY: "secret-vercel-key",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
      && error.message.includes("local test host"),
  );
});

test("hosted Codex runtime config rejects the model provider base URL override outside test mode", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
          [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
            "http://127.0.0.1:4123/v1",
          VERCEL_AI_API_KEY: "secret-vercel-key",
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
          HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
          [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
            "http://provider.example.test/v1",
          NODE_ENV: "test",
          VERCEL_AI_API_KEY: "secret-vercel-key",
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
          HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
          [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
            "https://127.0.0.1:4123/v1",
          NODE_ENV: "test",
          VERCEL_AI_API_KEY: "secret-vercel-key",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
      && error.message.includes("must use http"),
  );
});

test("hosted Codex runtime config rejects the local E2E app-server stub outside test mode", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
          [HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV]:
            "http://127.0.0.1:4123/v1",
          VERCEL_AI_API_KEY: "secret-vercel-key",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_INVALID"
      && error.message.includes("NODE_ENV=test"),
  );
});

test("hosted Codex runtime config requires Vercel credentials even for the local E2E stub", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
          [HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV]:
            "http://127.0.0.1:4123/v1",
          NODE_ENV: "test",
        },
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError
      && error.code === "HOSTED_ASSISTANT_CONFIG_REQUIRED"
      && error.message.includes("VERCEL_AI_API_KEY"),
  );
});

test("hosted Codex runtime config rejects removed local dev app-server proxy env", async () => {
  const operatorHomeRoot = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot,
        runtimeEnv: {
          HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
          [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV]: "token",
          [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV]: "tcp://127.0.0.1:4123",
          NODE_ENV: "development",
          VERCEL_AI_API_KEY: "secret-vercel-key",
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
      HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
        "http://127.0.0.1:4111/v1",
      NODE_ENV: "test",
      VERCEL_AI_API_KEY: "gateway-key",
    })[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV],
    "http://127.0.0.1:4111/v1",
  );
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
      && error.message.includes("vercel-ai-gateway"),
  );
});

test("hosted Codex config TOML uses env var names rather than credential values", () => {
  const config = buildHostedCodexConfigToml({
    model: null,
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
      'model_provider = "vercel-ai-gateway"',
      'model_reasoning_effort = "medium"',
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      "",
      '[model_providers."vercel-ai-gateway"]',
      'name = "Vercel AI Gateway"',
      'base_url = "https://ai-gateway.vercel.sh/v1"',
      'env_key = "VERCEL_AI_API_KEY"',
      'wire_api = "responses"',
      "",
      "# Keep Codex skill file instructions out of hosted prompts. Their temporary",
      "# runner paths change on each wake and break provider prefix caching.",
      "[skills]",
      "include_instructions = false",
      "",
      "[skills.bundled]",
      "enabled = false",
      "",
      "[shell_environment_policy]",
      'inherit = "none"',
      'include_only = ["CI", "CODEX_HOME", "COLORTERM", "CURL_CA_BUNDLE", "FORCE_COLOR", "HOME", "MURPH_HOSTED_CLI_BRIDGE_TOKEN", "MURPH_HOSTED_CLI_BRIDGE_URL", "MURPH_HOSTED_RUNTIME_PROCESS", "LANG", "LC_ALL", "LC_CTYPE", "NODE_EXTRA_CA_CERTS", "NO_COLOR", "PATH", "REQUESTS_CA_BUNDLE", "SSL_CERT_DIR", "SSL_CERT_FILE", "TEMP", "TERM", "TMP", "TMPDIR", "VAULT"]',
      "",
    ].join("\n"),
  );
});

test("hosted Codex config keeps skill instructions disabled for stable prompt prefixes", () => {
  const config = buildHostedCodexConfigToml({
    model: "gpt-5.5",
    provider: {
      id: "vercel-ai-gateway",
      name: "Vercel AI Gateway",
      baseUrl: "https://ai-gateway.vercel.sh/v1",
      envKey: "VERCEL_AI_API_KEY",
      wireApi: "responses",
    },
    reasoningEffort: "low",
  });

  assert.match(config, /\[skills\]\ninclude_instructions = false/u);
  assert.match(config, /\[skills\.bundled\]\nenabled = false/u);
  assert.doesNotMatch(config, /include_instructions = true/u);
  assert.doesNotMatch(config, /\[skills\.bundled\]\nenabled = true/u);
  assert.match(config, /break provider prefix caching/u);
});

async function createTemporaryDirectory(): Promise<string> {
  const target = await mkdtemp(path.join(tmpdir(), "hosted-codex-config-"));
  temporaryPaths.push(target);
  return target;
}

async function startResponsesStubServer(input: {
  requests: string[];
  responseText?: string;
  responseTexts?: readonly string[];
}): Promise<Server> {
  const responseTexts = [...(input.responseTexts ?? [])];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => {
      input.requests.push(Buffer.concat(chunks).toString("utf8"));

      if (request.method !== "POST" || request.url !== "/v1/responses") {
        response.statusCode = 404;
        response.end("not found");
        return;
      }

      response.setHeader("content-type", "application/json; charset=utf-8");
      const responseText = responseTexts.shift() ?? input.responseText ?? "shim response";
      response.end(JSON.stringify({
        output: [
          {
            content: [
              {
                text: responseText,
              },
            ],
          },
        ],
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

function readResponsesRequestInput(body: string): string {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  return typeof parsed.input === "string" ? parsed.input : "";
}

async function readHostedLocalCodexShimContinuityLog(codexHome: string): Promise<string> {
  return await readFile(
    path.join(codexHome, "rollouts", "hosted-e2e-codex-shim.jsonl"),
    "utf8",
  );
}

function parseHostedLocalCodexShimContinuityEntries(
  log: string,
): Record<string, unknown>[] {
  return log
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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

async function runHostedLocalCodexStubTurn(
  child: ReturnType<typeof spawn>,
  prompts: readonly string[] = ["hello hosted local"],
): Promise<Record<string, unknown>[]> {
  const childStdin = child.stdin;
  const childStdout = child.stdout;
  const childStderr = child.stderr;
  assert(childStdin);
  assert(childStdout);
  assert(childStderr);

  const messages: Record<string, unknown>[] = [];
  let stdoutBuffer = "";
  let stderr = "";

  const completed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for hosted local Codex stub turn. stderr: ${stderr}`));
    }, 5_000);
    let resolved = false;

    const finish = (error?: Error): void => {
      if (resolved) {
        return;
      }

      resolved = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    child.once("error", finish);
    child.once("exit", (code, signal) => {
      if (resolved) {
        return;
      }

      finish(new Error(
        `Hosted local Codex stub exited before completing turn: ${code ?? signal}. stderr: ${stderr}`,
      ));
    });
    childStderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    childStdout.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split(/\r?\n/u);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        messages.push(parsed);
        if (parsed.method === "turn/completed") {
          const completedTurns = messages.filter((message) =>
            message.method === "turn/completed"
          ).length;
          if (completedTurns >= prompts.length) {
            finish();
            continue;
          }
          writeHostedLocalCodexStubResume(childStdin, 20 + completedTurns);
          writeHostedLocalCodexStubTurnStart(
            childStdin,
            30 + completedTurns,
            prompts[completedTurns]!,
          );
        }
      }
    });
  });

  try {
    childStdin.write(`${JSON.stringify({ id: 1, method: "initialize", params: {} })}\n`);
    childStdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    childStdin.write(`${JSON.stringify({ id: 2, method: "thread/start", params: {} })}\n`);
    writeHostedLocalCodexStubTurnStart(childStdin, 3, prompts[0]!);

    await completed;
    return messages;
  } finally {
    childStdin.end();
    child.kill();
  }
}

function writeHostedLocalCodexStubResume(
  childStdin: NonNullable<ReturnType<typeof spawn>["stdin"]>,
  id: number,
): void {
  childStdin.write(`${JSON.stringify({
    id,
    method: "thread/resume",
    params: {
      threadId: "thread_test",
    },
  })}\n`);
}

function writeHostedLocalCodexStubTurnStart(
  childStdin: NonNullable<ReturnType<typeof spawn>["stdin"]>,
  id: number,
  prompt: string,
): void {
  childStdin.write(`${JSON.stringify({
    id,
    method: "turn/start",
    params: {
      input: [
        {
          text: prompt,
          type: "text",
        },
      ],
      threadId: "thread_test",
    },
  })}\n`);
}
