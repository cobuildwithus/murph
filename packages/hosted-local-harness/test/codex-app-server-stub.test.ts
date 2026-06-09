import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import {
  HOSTED_LOCAL_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_LOCAL_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
  HOSTED_LOCAL_CODEX_APP_SERVER_STUB_EXPECT_DYNAMIC_TOOLS_ENV,
  HOSTED_LOCAL_CODEX_APP_SERVER_STUB_MURPH_CLI_PATH_ENV,
  HOSTED_LOCAL_CODEX_APP_SERVER_STUB_TURN_DELAY_MS_ENV,
  HostedLocalCodexAppServerStubConfigurationError,
  maybeInstallHostedLocalCodexAppServerStub,
} from "../src/codex-app-server-stub.ts";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((target) =>
      rm(target, { force: true, recursive: true })
    ),
  );
});

test("hosted-local Codex app-server stub installer writes a neutral command override", async () => {
  const root = await createTemporaryDirectory();
  const installPath = path.join(root, "bin", "codex");
  const runtimeEnv: Record<string, string | undefined> = {
    NODE_ENV: "test",
    [HOSTED_LOCAL_CODEX_APP_SERVER_STUB_BASE_URL_ENV]: "http://127.0.0.1:4111/v1",
  };

  const installed = await maybeInstallHostedLocalCodexAppServerStub({
    installPath,
    runtimeEnv,
  });

  assert.equal(installed, true);
  assert.equal(runtimeEnv[HOSTED_LOCAL_CODEX_APP_SERVER_COMMAND_ENV], installPath);
  const installedStat = await stat(installPath);
  assert.equal(installedStat.isFile(), true);
});

test("hosted-local Codex app-server stub rejects non-test installation", async () => {
  const root = await createTemporaryDirectory();

  await assert.rejects(
    () =>
      maybeInstallHostedLocalCodexAppServerStub({
        installPath: path.join(root, "bin", "codex"),
        runtimeEnv: {
          NODE_ENV: "production",
          [HOSTED_LOCAL_CODEX_APP_SERVER_STUB_BASE_URL_ENV]: "http://127.0.0.1:4111/v1",
        },
      }),
    (error) =>
      error instanceof HostedLocalCodexAppServerStubConfigurationError
      && error.code === "HOSTED_LOCAL_CODEX_APP_SERVER_STUB_CONFIG_INVALID"
      && error.message.includes("NODE_ENV=test"),
  );
});

test("hosted-local Codex app-server stub bridges JSON-RPC turns to Responses", async () => {
  const root = await createTemporaryDirectory();
  const requests: string[] = [];
  const server = await startResponsesStubServer({
    requests,
    responseText: "assistant reply from harness-owned shim",
  });

  try {
    const { codexHome, command } = await installStubCommand({
      baseUrl: `${readServerBaseUrl(server)}/v1`,
      root,
    });
    const messages = await runHostedLocalCodexStubTurn(
      spawnStubCommand(command, codexHome),
    );

    assert.equal(requests.length, 1);
    assert.match(requests[0] ?? "", /hosted-e2e-codex-shim/u);
    assert.equal(readAssistantMessage(messages), "assistant reply from harness-owned shim");

    const threadId = readThreadId(messages);
    const rolloutLog = await readFile(
      path.join(
        codexHome,
        "sessions",
        "2026",
        "05",
        "06",
        `rollout-2026-05-06T01-02-03-${threadId}.jsonl`,
      ),
      "utf8",
    );
    assert.match(rolloutLog, /assistant reply from harness-owned shim/u);
  } finally {
    await closeHttpServer(server);
  }
});

test("hosted-local Codex app-server stub runs under module package roots", async () => {
  const root = await createTemporaryDirectory();
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module" }),
    "utf8",
  );
  const requests: string[] = [];
  const server = await startResponsesStubServer({
    requests,
    responseText: "assistant reply from module-root shim",
  });

  try {
    const { codexHome, command } = await installStubCommand({
      baseUrl: `${readServerBaseUrl(server)}/v1`,
      root,
    });
    const messages = await runHostedLocalCodexStubTurn(
      spawnStubCommand(command, codexHome),
    );

    assert.equal(requests.length, 1);
    assert.equal(readAssistantMessage(messages), "assistant reply from module-root shim");
  } finally {
    await closeHttpServer(server);
  }
});

test("hosted-local Codex app-server stub correlates dynamic tool directives to the active turn", async () => {
  const root = await createTemporaryDirectory();
  const requests: string[] = [];
  const server = await startResponsesStubServer({
    requests,
    responseText: JSON.stringify({
      __murphE2eToolCalls: [
        {
          arguments: { text: "progress update" },
          namespace: "murph",
          tool: "send_progress_update",
        },
      ],
      text: "tool directive completed",
    }),
  });

  try {
    const { codexHome, command } = await installStubCommand({
      baseUrl: `${readServerBaseUrl(server)}/v1`,
      root,
    });
    const messages = await runHostedLocalCodexStubTurn(
      spawnStubCommand(command, codexHome),
    );

    const toolCall = messages.find((message) => message.method === "item/tool/call");
    assert.ok(toolCall);
    assert.deepEqual(toolCall.params, {
      arguments: { text: "progress update" },
      namespace: "murph",
      threadId: readThreadId(messages),
      tool: "send_progress_update",
      turnId: readTurnId(messages),
    });
    assert.equal(readAssistantMessage(messages), "tool directive completed");
  } finally {
    await closeHttpServer(server);
  }
});

test("hosted-local Codex app-server stub preserves text from vault-cli directives", async () => {
  const root = await createTemporaryDirectory();
  const cliCallsPath = path.join(root, "cli-calls.jsonl");
  const trustedCliPath = await installTrustedMurphCliFixture(root, cliCallsPath);
  const requests: string[] = [];
  const server = await startResponsesStubServer({
    requests,
    responseText: JSON.stringify({
      __murphE2eVaultCliCommands: [
        {
          args: [
            "automation",
            "save",
            "Sleep reminder",
            "--request-id",
            "hosted-local-reminder-test",
            "--instructions",
            "Send a short reminder.",
            "--summary",
            "One-shot reminder.",
            "--continuity-policy",
            "preserve",
            "--schedule-kind",
            "at",
            "--schedule-at",
            "2026-05-06T01:07:03.000Z",
            "--channel",
            "linq",
            "--thread-id",
            "chat_local_test",
          ],
        },
      ],
      text: "Done - I will remind you here in about five minutes.",
    }),
  });

  try {
    const { codexHome, command } = await installStubCommand({
      baseUrl: `${readServerBaseUrl(server)}/v1`,
      root,
      runtimeEnv: {
        [HOSTED_LOCAL_CODEX_APP_SERVER_STUB_MURPH_CLI_PATH_ENV]: trustedCliPath,
      },
    });
    const messages = await runHostedLocalCodexStubTurn(
      spawnStubCommand(command, codexHome),
    );

    assert.equal(
      readAssistantMessage(messages),
      "Done - I will remind you here in about five minutes.",
    );
    assert.match(await readFile(cliCallsPath, "utf8"), /"automation","save"/u);
  } finally {
    await closeHttpServer(server);
  }
});

test("hosted-local Codex app-server stub allows onboarding completion directives", async () => {
  const root = await createTemporaryDirectory();
  const cliCallsPath = path.join(root, "cli-calls.jsonl");
  const trustedCliPath = await installTrustedMurphCliFixture(root, cliCallsPath);
  const requests: string[] = [];
  const server = await startResponsesStubServer({
    requests,
    responseText: JSON.stringify({
      __murphE2eVaultCliCommands: [
        {
          args: [
            "assistant",
            "onboarding",
            "complete",
            "--reason",
            "manual",
          ],
        },
        {
          args: [
            "automation",
            "set-status",
            "finish-onboarding-followup",
            "--status",
            "archived",
          ],
        },
      ],
      text: "Onboarding complete.",
    }),
  });

  try {
    const { codexHome, command } = await installStubCommand({
      baseUrl: `${readServerBaseUrl(server)}/v1`,
      root,
      runtimeEnv: {
        [HOSTED_LOCAL_CODEX_APP_SERVER_STUB_MURPH_CLI_PATH_ENV]: trustedCliPath,
      },
    });
    const messages = await runHostedLocalCodexStubTurn(
      spawnStubCommand(command, codexHome),
    );

    assert.equal(readAssistantMessage(messages), "Onboarding complete.");
    const cliCalls = await readFile(cliCallsPath, "utf8");
    assert.match(
      cliCalls,
      /"assistant","onboarding","complete","--reason","manual"/u,
    );
    assert.match(
      cliCalls,
      /"automation","set-status","finish-onboarding-followup","--status","archived"/u,
    );
  } finally {
    await closeHttpServer(server);
  }
});

test("hosted-local Codex app-server stub resolves bundled murph CLI from cwd", async () => {
  const root = await createTemporaryDirectory();
  const cliCallsPath = path.join(root, "cli-calls.jsonl");
  await installBundledMurphCliFixture(root, cliCallsPath);
  const requests: string[] = [];
  const server = await startResponsesStubServer({
    requests,
    responseText: JSON.stringify({
      __murphE2eVaultCliCommands: [
        {
          args: [
            "automation",
            "save",
            "Sleep reminder",
            "--request-id",
            "hosted-local-reminder-bundled-test",
            "--instructions",
            "Send a short reminder.",
            "--summary",
            "One-shot reminder.",
            "--continuity-policy",
            "preserve",
            "--schedule-kind",
            "at",
            "--schedule-at",
            "2026-05-06T01:07:03.000Z",
            "--channel",
            "linq",
            "--thread-id",
            "chat_local_test",
          ],
        },
      ],
      text: "Done - I will remind you here in about five minutes.",
    }),
  });

  try {
    const { codexHome, command } = await installStubCommand({
      baseUrl: `${readServerBaseUrl(server)}/v1`,
      root,
    });
    const messages = await runHostedLocalCodexStubTurn(
      spawnStubCommand(command, codexHome, { cwd: root }),
    );

    assert.equal(
      readAssistantMessage(messages),
      "Done - I will remind you here in about five minutes.",
    );
    assert.match(await readFile(cliCallsPath, "utf8"), /"automation","save"/u);
  } finally {
    await closeHttpServer(server);
  }
});

test("hosted-local Codex app-server stub enforces expected dynamic tools", async () => {
  const root = await createTemporaryDirectory();
  const { codexHome, command } = await installStubCommand({
    baseUrl: "http://127.0.0.1:4111/v1",
    root,
    runtimeEnv: {
      [HOSTED_LOCAL_CODEX_APP_SERVER_STUB_EXPECT_DYNAMIC_TOOLS_ENV]:
        "murph.send_progress_update",
    },
  });

  const messages = await runHostedLocalCodexStubThreadStart(
    spawnStubCommand(command, codexHome),
    {
      dynamicTools: [
        {
          name: "unexpected_tool",
          namespace: "murph",
        },
      ],
    },
  );

  assert.match(
    readRpcErrorMessage(messages, 2),
    /dynamic tools mismatch/u,
  );
});

test("hosted-local Codex app-server stub restores dynamic tools on clean resume", async () => {
  const root = await createTemporaryDirectory();
  const { codexHome, command } = await installStubCommand({
    baseUrl: "http://127.0.0.1:4111/v1",
    root,
    runtimeEnv: {
      [HOSTED_LOCAL_CODEX_APP_SERVER_STUB_EXPECT_DYNAMIC_TOOLS_ENV]:
        "murph.send_progress_update",
    },
  });

  const startMessages = await runHostedLocalCodexStubThreadStart(
    spawnStubCommand(command, codexHome),
    {
      dynamicTools: [
        {
          name: "send_progress_update",
          namespace: "murph",
        },
      ],
    },
  );
  const threadId = readThreadId(startMessages);

  const resumeMessages = await runHostedLocalCodexStubThreadRequest(
    spawnStubCommand(command, codexHome),
    "thread/resume",
    {
      threadId,
    },
  );

  assert.equal(readRpcErrorMessageOrNull(resumeMessages, 2), null);
  assert.equal(readThreadId(resumeMessages), threadId);
});

async function installStubCommand(input: {
  baseUrl: string;
  root: string;
  runtimeEnv?: Record<string, string | undefined>;
}): Promise<{ codexHome: string; command: string }> {
  const codexHome = path.join(input.root, "codex-home");
  const command = path.join(input.root, "bin", "codex");
  await mkdir(codexHome, { mode: 0o700, recursive: true });
  const runtimeEnv: Record<string, string | undefined> = {
    NODE_ENV: "test",
    [HOSTED_LOCAL_CODEX_APP_SERVER_STUB_BASE_URL_ENV]: input.baseUrl,
    [HOSTED_LOCAL_CODEX_APP_SERVER_STUB_TURN_DELAY_MS_ENV]: "1",
    ...input.runtimeEnv,
  };

  const installed = await maybeInstallHostedLocalCodexAppServerStub({
    installPath: command,
    runtimeEnv,
  });
  assert.equal(installed, true);
  assert.equal(runtimeEnv[HOSTED_LOCAL_CODEX_APP_SERVER_COMMAND_ENV], command);
  return { codexHome, command };
}

async function installTrustedMurphCliFixture(
  root: string,
  cliCallsPath: string,
): Promise<string> {
  const packageRoot = path.join(root, "trusted-murph-cli");
  const cliPath = path.join(packageRoot, "dist", "bin.js");
  await mkdir(path.dirname(cliPath), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "@murphai/murph" }),
    "utf8",
  );
  await writeFile(
    cliPath,
    [
      "import { appendFileSync } from 'node:fs';",
      `appendFileSync(${JSON.stringify(cliCallsPath)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
      "",
    ].join("\n"),
    "utf8",
  );
  return cliPath;
}

async function installBundledMurphCliFixture(
  root: string,
  cliCallsPath: string,
): Promise<string> {
  const packageRoot = path.join(root, "node_modules", "@murphai", "murph");
  const cliPath = path.join(packageRoot, "dist", "bin.js");
  await mkdir(path.dirname(cliPath), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      main: "dist/index.js",
      name: "@murphai/murph",
      type: "module",
    }),
    "utf8",
  );
  await writeFile(path.join(packageRoot, "dist", "index.js"), "export {};\n", "utf8");
  await writeFile(
    cliPath,
    [
      "import { appendFileSync } from 'node:fs';",
      `appendFileSync(${JSON.stringify(cliCallsPath)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
      "",
    ].join("\n"),
    "utf8",
  );
  return cliPath;
}

function spawnStubCommand(
  command: string,
  codexHome: string,
  options: { cwd?: string } = {},
): ReturnType<typeof spawn> {
  return spawn(command, [], {
    cwd: options.cwd,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function createTemporaryDirectory(): Promise<string> {
  const target = await mkdtemp(path.join(tmpdir(), "hosted-local-codex-stub-"));
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
      const body = Buffer.concat(chunks).toString("utf8");
      input.requests.push(body);

      if (request.method !== "POST" || request.url !== "/v1/responses") {
        response.statusCode = 404;
        response.end("not found");
        return;
      }

      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({
        created_at: Math.floor(Date.now() / 1000),
        id: "resp_hosted_local_codex_stub",
        model: "gpt-5.5",
        output: [
          {
            content: [
              {
                annotations: [],
                text: input.responseText,
                type: "output_text",
              },
            ],
            id: "msg_hosted_local_codex_stub",
            role: "assistant",
            type: "message",
          },
        ],
        usage: {
          input_tokens: 24,
          input_tokens_details: null,
          output_tokens: 11,
          output_tokens_details: null,
          total_tokens: 35,
        },
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
      reject(new Error(`Timed out waiting for hosted-local Codex stub turn. stderr: ${stderr}`));
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
      if (!resolved) {
        finish(new Error(
          `Hosted-local Codex stub exited before completing turn: ${code ?? signal}. stderr: ${stderr}`,
        ));
      }
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
        if (parsed.id === 2) {
          writeTurnStart(childStdin, readThreadId(messages));
        }
        if (parsed.method === "item/tool/call" && typeof parsed.id === "number") {
          childStdin.write(`${JSON.stringify({
            id: parsed.id,
            result: {
              contentItems: [{ text: "progress update sent", type: "inputText" }],
              success: true,
            },
          })}\n`);
        }
        if (parsed.method === "turn/completed") {
          finish();
        }
      }
    });
  });

  try {
    childStdin.write(`${JSON.stringify({ id: 1, method: "initialize", params: {} })}\n`);
    childStdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    childStdin.write(`${JSON.stringify({ id: 2, method: "thread/start", params: {} })}\n`);
    await completed;
    return messages;
  } finally {
    childStdin.end();
    child.kill();
  }
}

async function runHostedLocalCodexStubThreadStart(
  child: ReturnType<typeof spawn>,
  threadStartParams: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  return await runHostedLocalCodexStubThreadRequest(
    child,
    "thread/start",
    threadStartParams,
  );
}

async function runHostedLocalCodexStubThreadRequest(
  child: ReturnType<typeof spawn>,
  method: "thread/start" | "thread/resume",
  params: Record<string, unknown>,
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
      reject(new Error(`Timed out waiting for hosted-local Codex stub ${method}. stderr: ${stderr}`));
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
      if (!resolved) {
        finish(new Error(
          `Hosted-local Codex stub exited before ${method} response: ${code ?? signal}. stderr: ${stderr}`,
        ));
      }
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
        if (parsed.id === 2) {
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
      method,
      params,
    })}\n`);
    await completed;
    return messages;
  } finally {
    childStdin.end();
    child.kill();
  }
}

function writeTurnStart(
  childStdin: NonNullable<ReturnType<typeof spawn>["stdin"]>,
  threadId: string,
): void {
  childStdin.write(`${JSON.stringify({
    id: 3,
    method: "turn/start",
    params: {
      input: [
        {
          text: "hello hosted local",
          type: "text",
        },
      ],
      threadId,
    },
  })}\n`);
}

function readThreadId(messages: readonly Record<string, unknown>[]): string {
  for (const message of messages) {
    if (message.id !== 2 || !isRecord(message.result)) {
      continue;
    }
    const thread = message.result.thread;
    if (isRecord(thread) && typeof thread.id === "string") {
      return thread.id;
    }
  }
  throw new Error("Expected hosted-local Codex stub thread/start response.");
}

function readTurnId(messages: readonly Record<string, unknown>[]): string {
  for (const message of messages) {
    if (message.id !== 3 || !isRecord(message.result)) {
      continue;
    }
    const turn = message.result.turn;
    if (isRecord(turn) && typeof turn.id === "string") {
      return turn.id;
    }
  }
  throw new Error("Expected hosted-local Codex stub turn/start response.");
}

function readAssistantMessage(messages: readonly Record<string, unknown>[]): string {
  for (const message of messages) {
    if (message.type !== "item.completed" || !isRecord(message.item)) {
      continue;
    }
    if (typeof message.item.text === "string") {
      return message.item.text;
    }
  }
  throw new Error("Expected hosted-local Codex stub assistant message.");
}

function readRpcErrorMessage(
  messages: readonly Record<string, unknown>[],
  id: number,
): string {
  const errorMessage = readRpcErrorMessageOrNull(messages, id);
  if (typeof errorMessage !== "string") {
    throw new Error(`Expected hosted-local Codex stub RPC error for id ${id}.`);
  }
  return errorMessage;
}

function readRpcErrorMessageOrNull(
  messages: readonly Record<string, unknown>[],
  id: number,
): string | null {
  const message = messages.find((candidate) => candidate.id === id);
  const error = isRecord(message?.error) ? message.error : null;
  if (typeof error?.message !== "string") {
    return null;
  }
  return error.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
