import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import {
  HostedAssistantConfigurationError,
} from "@murphai/operator-config/hosted-assistant-config";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
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
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_MODEL, "gpt-5.5");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT, "medium");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_APPROVAL_POLICY, "never");
  assert.equal(result.runtimeEnv.HOSTED_ASSISTANT_SANDBOX, "danger-full-access");

  const config = await readFile(result.codexConfigPath!, "utf8");
  assert.match(config, /model = "gpt-5\.5"/u);
  assert.match(config, /model_provider = "vercel-ai-gateway"/u);
  assert.match(config, /model_reasoning_effort = "medium"/u);
  assert.match(config, /approval_policy = "never"/u);
  assert.match(config, /sandbox_mode = "danger-full-access"/u);
  assert.match(config, /\[model_providers\."vercel-ai-gateway"\]/u);
  assert.match(config, /base_url = "https:\/\/ai-gateway\.vercel\.sh\/v1"/u);
  assert.match(config, /env_key = "VERCEL_AI_API_KEY"/u);
  assert.match(config, /wire_api = "responses"/u);
  assert.match(config, /\[shell_environment_policy\]/u);
  assert.match(config, /inherit = "all"/u);
  assert.match(config, /include_only = \[/u);
  assert.match(config, /"PATH"/u);
  assert.match(config, /"VAULT"/u);
  assert.match(config, /"WHISPER_COMMAND"/u);
  assert.doesNotMatch(config, /include_only = \[[^\]]*"VERCEL_AI_API_KEY"/u);
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

  const shimBinDir = path.join(result.codexHome!, "bin");
  const shimPath = path.join(shimBinDir, "codex");
  assert.equal(
    result.runtimeEnv.PATH?.startsWith(`${shimBinDir}${path.delimiter}`),
    true,
  );
  const shimSource = await readFile(shimPath, "utf8");
  assert.match(shimSource, /^#!\/usr\/bin\/env node/u);
  assert.match(shimSource, /hosted-local-codex-shim/u);
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
    const child = spawn(path.join(result.codexHome!, "bin", "codex"), ["app-server"], {
      env: {
        ...process.env,
        PATH: result.runtimeEnv.PATH,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const messages = await runHostedLocalCodexStubTurn(child);

    assert.equal(requests.length, 1);
    const requestBody = JSON.parse(requests[0]!);
    assert.deepEqual(requestBody.input, [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Attached PDF evidence.",
          },
          {
            type: "input_file",
            filename: "attachment-01.pdf",
            file_data: "data:application/pdf;base64,JVBERi0xLjcK",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "hello hosted local",
          },
        ],
      },
    ]);
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
  } finally {
    await closeHttpServer(server);
  }
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
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      "",
      '[model_providers."vercel-ai-gateway"]',
      'name = "Vercel AI Gateway"',
      'base_url = "https://ai-gateway.vercel.sh/v1"',
      'env_key = "VERCEL_AI_API_KEY"',
      'wire_api = "responses"',
      "",
      "[shell_environment_policy]",
      'inherit = "all"',
      'include_only = ["CI", "CODEX_HOME", "COLORTERM", "CURL_CA_BUNDLE", "FFMPEG_COMMAND", "FORCE_COLOR", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "NODE_EXTRA_CA_CERTS", "NO_COLOR", "PATH", "REQUESTS_CA_BUNDLE", "SSL_CERT_DIR", "SSL_CERT_FILE", "TEMP", "TERM", "TMP", "TMPDIR", "VAULT", "WHISPER_COMMAND", "WHISPER_MODEL_PATH"]',
      "",
    ].join("\n"),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const target = await mkdtemp(path.join(tmpdir(), "hosted-codex-config-"));
  temporaryPaths.push(target);
  return target;
}

async function startResponsesStubServer(input: {
  requests: string[];
  responseText: string;
}): Promise<Server> {
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
      response.end(JSON.stringify({
        output: [
          {
            content: [
              {
                text: input.responseText,
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
          finish();
        }
      }
    });
  });

  try {
    childStdin.write(`${JSON.stringify({ id: 1, method: "initialize", params: {} })}\n`);
    childStdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    childStdin.write(`${JSON.stringify({
      id: 2,
      method: "thread/start",
      params: {
        threadId: "thread_test",
      },
    })}\n`);
    childStdin.write(`${JSON.stringify({
      id: 3,
      method: "thread/inject_items",
      params: {
        threadId: "thread_test",
        items: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Attached PDF evidence.",
              },
              {
                type: "input_file",
                filename: "attachment-01.pdf",
                file_data: "data:application/pdf;base64,JVBERi0xLjcK",
              },
            ],
          },
        ],
      },
    })}\n`);
    childStdin.write(`${JSON.stringify({
      id: 4,
      method: "turn/start",
      params: {
        input: [
          {
            text: "hello hosted local",
            type: "text",
          },
        ],
        threadId: "thread_test",
      },
    })}\n`);

    await completed;
    return messages;
  } finally {
    childStdin.end();
    child.kill();
  }
}
