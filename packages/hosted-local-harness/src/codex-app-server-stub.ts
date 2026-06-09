import { access, chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HOSTED_LOCAL_CODEX_APP_SERVER_COMMAND_ENV =
  "MURPH_HOSTED_CODEX_APP_SERVER_COMMAND";
export const HOSTED_LOCAL_CODEX_APP_SERVER_STUB_BASE_URL_ENV =
  "MURPH_E2E_CODEX_APP_SERVER_STUB_BASE_URL";
export const HOSTED_LOCAL_CODEX_APP_SERVER_STUB_EXPECT_DYNAMIC_TOOLS_ENV =
  "MURPH_E2E_CODEX_APP_SERVER_STUB_EXPECT_DYNAMIC_TOOLS";
export const HOSTED_LOCAL_CODEX_APP_SERVER_STUB_TURN_DELAY_MS_ENV =
  "MURPH_E2E_CODEX_APP_SERVER_STUB_TURN_DELAY_MS";
export const HOSTED_LOCAL_CODEX_APP_SERVER_STUB_MURPH_CLI_PATH_ENV =
  "MURPH_E2E_TRUSTED_MURPH_CLI_PATH";

export class HostedLocalCodexAppServerStubConfigurationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HostedLocalCodexAppServerStubConfigurationError";
    this.code = code;
  }
}

export async function maybeInstallHostedLocalCodexAppServerStub(input: {
  installPath: string;
  runtimeCommandPath?: string | null;
  runtimeEnv: Record<string, string | undefined>;
}): Promise<boolean> {
  const assistantProviderBaseUrl = readHostedLocalCodexAppServerStubBaseUrl(input.runtimeEnv);

  if (!assistantProviderBaseUrl) {
    return false;
  }

  const trustedMurphCliPath = await resolveHostedLocalTrustedMurphCliPath(input.runtimeEnv);

  await installHostedLocalCodexAppServerShim({
    installPath: input.installPath,
    runtimeCommandPath: input.runtimeCommandPath ?? input.installPath,
    runtimeEnv: input.runtimeEnv,
    source: buildHostedLocalCodexAppServerStubSource({
      assistantProviderBaseUrl,
      expectedThreadStartDynamicTools: readHostedLocalCodexAppServerStubExpectedDynamicTools(
        input.runtimeEnv,
      ),
      trustedMurphCliPath,
      turnDelayMs: readHostedLocalCodexAppServerStubTurnDelayMs(input.runtimeEnv),
    }),
  });

  return true;
}

export function buildHostedLocalCodexAppServerStubSource(input: {
  assistantProviderBaseUrl: string;
  expectedThreadStartDynamicTools?: readonly string[] | null;
  trustedMurphCliPath?: string | null;
  turnDelayMs?: number | null;
}): string {
  const turnDelayMs = input.turnDelayMs ?? 25;
  const expectedThreadStartDynamicTools = input.expectedThreadStartDynamicTools ?? [];
  return `#!/usr/bin/env node
import childProcess from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";

const assistantProviderBaseUrl = ${JSON.stringify(input.assistantProviderBaseUrl)};
const expectedThreadStartDynamicTools = ${JSON.stringify(expectedThreadStartDynamicTools)};
const configuredTrustedMurphCliPath = ${JSON.stringify(input.trustedMurphCliPath ?? null)};
const trustedMurphCliPathEnv = ${JSON.stringify(HOSTED_LOCAL_CODEX_APP_SERVER_STUB_MURPH_CLI_PATH_ENV)};
const turnDelayMs = ${JSON.stringify(turnDelayMs)};
const moduleRequire = createRequire(import.meta.url);
const processThreadPrefix = String(process.pid % 1000000).padStart(6, "0");
let threadCounter = 0;
let turnCounter = 0;
let serverRequestCounter = 1000000;
let activeTurn = null;
const pendingServerRequests = new Map();
const threadAssistantHistory = new Map();
const threadDynamicToolNames = new Map();

function writeRpc(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

function writeRpcError(id, message) {
  writeRpc({
    id,
    error: {
      code: -32000,
      message,
    },
  });
}

function readCodexHome() {
  const value = process.env.CODEX_HOME;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildUuidThreadId(counter) {
  return "00000000-0000-4000-8000-" + processThreadPrefix + String(counter).padStart(6, "0");
}

function buildRolloutRelativePath(threadId) {
  return path.join(
    "sessions",
    "2026",
    "05",
    "06",
    "rollout-2026-05-06T01-02-03-" + threadId + ".jsonl",
  );
}

function readRolloutPath(threadId) {
  const codexHome = readCodexHome();
  if (!codexHome) {
    return null;
  }
  return path.join(codexHome, buildRolloutRelativePath(threadId));
}

function appendThreadRolloutEvent(threadId, event) {
  const rolloutPath = readRolloutPath(threadId);
  if (!rolloutPath) {
    return null;
  }

  fs.mkdirSync(path.dirname(rolloutPath), {
    mode: 0o700,
    recursive: true,
  });
  fs.appendFileSync(
    rolloutPath,
    JSON.stringify({
      schema: "murph.hosted-e2e-codex-shim-rollout.v1",
      threadId,
      ...event,
    }) + "\\n",
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  fs.chmodSync(rolloutPath, 0o600);
  return rolloutPath;
}

function readThreadStartDynamicToolNames(params) {
  const dynamicTools = params && Array.isArray(params.dynamicTools)
    ? params.dynamicTools
    : [];
  return dynamicTools.flatMap((tool) => {
    const name = readDynamicToolName(tool);
    return name ? [name] : [];
  });
}

function readDynamicToolName(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    return null;
  }

  const namespace = typeof tool.namespace === "string" && tool.namespace.trim()
    ? tool.namespace.trim()
    : null;
  const name = typeof tool.name === "string" && tool.name.trim()
    ? tool.name.trim()
    : null;
  if (!namespace || !name) {
    return null;
  }

  return namespace + "." + name;
}

function dynamicToolNamesMatch(actual, expected) {
  return actual.length === expected.length
    && actual.every((name, index) => name === expected[index]);
}

function formatDynamicToolNames(names) {
  return names.length === 0 ? "none" : names.join(", ");
}

function validateExpectedDynamicTools(scope, actualLabel, actual) {
  if (expectedThreadStartDynamicTools.length === 0) {
    return null;
  }

  if (dynamicToolNamesMatch(actual, expectedThreadStartDynamicTools)) {
    return null;
  }

  return scope + " dynamic tools mismatch: expected ["
    + formatDynamicToolNames(expectedThreadStartDynamicTools)
    + "] but " + actualLabel + " ["
    + formatDynamicToolNames(actual)
    + "]";
}

function loadThreadDynamicToolNamesFromRollout(threadId) {
  const rolloutPath = readRolloutPath(threadId);
  if (!rolloutPath || !fs.existsSync(rolloutPath)) {
    return [];
  }

  let dynamicToolNames = [];
  for (const line of fs.readFileSync(rolloutPath, "utf8").trim().split(/\\r?\\n/u)) {
    if (!line.trim()) {
      continue;
    }
    const parsed = JSON.parse(line);
    if (!Array.isArray(parsed.dynamicToolNames)) {
      continue;
    }
    dynamicToolNames = parsed.dynamicToolNames.flatMap((name) => {
      return typeof name === "string" && name.trim() ? [name.trim()] : [];
    });
  }
  return dynamicToolNames;
}

function readThreadDynamicToolNames(threadId) {
  const cached = threadDynamicToolNames.get(threadId);
  if (Array.isArray(cached)) {
    return cached;
  }

  const restored = loadThreadDynamicToolNamesFromRollout(threadId);
  if (restored.length > 0) {
    threadDynamicToolNames.set(threadId, restored);
  }
  return restored;
}

function loadThreadHistoryFromRollout(threadId) {
  const rolloutPath = readRolloutPath(threadId);
  if (!rolloutPath || !fs.existsSync(rolloutPath)) {
    return [];
  }

  return fs.readFileSync(rolloutPath, "utf8")
    .trim()
    .split(/\\r?\\n/u)
    .flatMap((line) => {
      if (!line.trim()) {
        return [];
      }
      const parsed = JSON.parse(line);
      return typeof parsed.assistantText === "string" && parsed.assistantText.trim()
        ? [parsed.assistantText.trim()]
        : [];
    });
}

function readInputItems(params) {
  const input = params && Array.isArray(params.input) ? params.input : [];
  return input
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      if (item.type === "text" && typeof item.text === "string") {
        return [{ type: "text", text: item.text }];
      }
      if (item.type === "image" && isSafeDataImageUrl(item.url)) {
        return [{ type: "image", url: item.url }];
      }
      if (item.type === "localImage" && typeof item.path === "string") {
        return [{ type: "localImage", path: item.path }];
      }
      return [];
    });
}

function readThreadAssistantHistory(threadId) {
  const history = threadAssistantHistory.get(threadId);
  if (Array.isArray(history)) {
    return history;
  }
  return loadThreadHistoryFromRollout(threadId);
}

function appendThreadAssistantMessage(threadId, text) {
  if (!threadId || typeof text !== "string" || !text.trim()) {
    return;
  }

  const nextHistory = readThreadAssistantHistory(threadId).concat([text.trim()]).slice(-8);
  threadAssistantHistory.set(threadId, nextHistory);
  appendThreadRolloutEvent(threadId, {
    assistantText: text.trim(),
    event: "assistant.message",
  });
}

function buildThreadHistoryPrompt(threadId) {
  const history = readThreadAssistantHistory(threadId);
  if (history.length === 0) {
    return "";
  }

  return "Conversation so far:\\n"
    + history.map((text) => "Assistant:\\n" + text).join("\\n\\n");
}

function inferImageMimeType(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  return "image/png";
}

function isSafeDataImageUrl(value) {
  return typeof value === "string" && /^data:image\\/[a-z0-9.+-]+;base64,/iu.test(value);
}

function pushImageContent(content, imageUrl, imageIndex) {
  content.push({
    type: "input_text",
    text: "<image name=[Image #" + imageIndex + "]>",
  });
  content.push({
    detail: "auto",
    image_url: imageUrl,
    type: "input_image",
  });
  content.push({
    type: "input_text",
    text: "</image>",
  });
}

function pushUnreadableImageContent(content, imageIndex) {
  content.push({
    type: "input_text",
    text: "<image name=[Image #" + imageIndex + "]>",
  });
  content.push({
    type: "input_text",
    text: "Codex could not read a local image attachment.",
  });
  content.push({
    type: "input_text",
    text: "</image>",
  });
}

function buildProviderContentFromInputItems(items) {
  const content = [];
  let imageIndex = 0;

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    if (item.type === "text" && typeof item.text === "string") {
      content.push({
        type: "input_text",
        text: item.text,
      });
      continue;
    }

    if (item.type === "image" && typeof item.url === "string") {
      imageIndex += 1;
      pushImageContent(content, item.url, imageIndex);
      continue;
    }

    if (item.type === "localImage" && typeof item.path === "string") {
      imageIndex += 1;
      try {
        const bytes = fs.readFileSync(item.path);
        const mimeType = inferImageMimeType(item.path);
        pushImageContent(
          content,
          "data:" + mimeType + ";base64," + bytes.toString("base64"),
          imageIndex,
        );
      } catch {
        pushUnreadableImageContent(content, imageIndex);
      }
    }
  }

  return content;
}

function buildTurnProviderInput(turn) {
  const content = [];
  const historyPrompt = buildThreadHistoryPrompt(turn.threadId);
  if (historyPrompt) {
    content.push({
      type: "input_text",
      text: historyPrompt,
    });
  }

  for (const items of turn.inputs) {
    const nextContent = buildProviderContentFromInputItems(items);
    if (nextContent.length === 0) {
      continue;
    }
    if (content.length > 0) {
      content.push({
        type: "input_text",
        text: "\\n\\n",
      });
    }
    content.push(...nextContent);
  }

  if (content.length === 0) {
    content.push({
      type: "input_text",
      text: "",
    });
  }

  return [{
    content,
    role: "user",
  }];
}

function extractResponseText(payload) {
  const outputs = payload && Array.isArray(payload.output) ? payload.output : [];
  for (const output of outputs) {
    const content = output && Array.isArray(output.content) ? output.content : [];
    for (const part of content) {
      if (part && typeof part.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }

  throw new Error("assistant provider stub response did not contain output text");
}

function extractE2EToolDirective(responseText) {
  try {
    const parsed = JSON.parse(responseText);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (
        Array.isArray(parsed.__murphE2eToolCalls) ||
        Array.isArray(parsed.__murphE2eVaultCliCommands)
      ) &&
      typeof parsed.text === "string" &&
      parsed.text.trim()
    ) {
      const rawToolCalls = Array.isArray(parsed.__murphE2eToolCalls)
        ? parsed.__murphE2eToolCalls
        : [];
      const rawVaultCliCommands = Array.isArray(parsed.__murphE2eVaultCliCommands)
        ? parsed.__murphE2eVaultCliCommands
        : [];
      const toolCalls = rawToolCalls
        .map(normalizeE2EToolCall)
        .filter(Boolean);
      const vaultCliCommands = rawVaultCliCommands
        .map(normalizeE2EVaultCliCommand)
        .filter(Boolean);
      return {
        toolCalls,
        vaultCliCommands,
        text: parsed.text.trim(),
      };
    }
  } catch {
    // Non-JSON responses are normal assistant text.
  }

  return {
    toolCalls: [],
    vaultCliCommands: [],
    text: responseText,
  };
}

function normalizeE2EToolCall(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (
    typeof value.namespace !== "string" ||
    !value.namespace.trim() ||
    typeof value.tool !== "string" ||
    !value.tool.trim()
  ) {
    return null;
  }
  const args = value.arguments && typeof value.arguments === "object" && !Array.isArray(value.arguments)
    ? value.arguments
    : {};
  return {
    arguments: args,
    namespace: value.namespace.trim(),
    tool: value.tool.trim(),
  };
}

function normalizeE2EVaultCliCommand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (!Array.isArray(value.args)) {
    return null;
  }
  if (!value.args.every((arg) => typeof arg === "string")) {
    return null;
  }
  return {
    args: value.args,
  };
}

function redactE2ECommandOutput(value) {
  let output = typeof value === "string" ? value : String(value ?? "");
  const sensitivePathValues = [
    process.env.CODEX_HOME,
    process.env.HOME,
    process.env.VAULT,
  ].filter((entry) => typeof entry === "string" && entry.trim().length > 0);
  for (const sensitivePath of sensitivePathValues) {
    output = output.split(sensitivePath).join("<redacted-path>");
  }
  return output.slice(-4000);
}

function validateE2EVaultCliCommandArgs(args) {
  if (args.length < 3 || args.length > 64) {
    throw new Error("E2E vault-cli directive must include 3 to 64 arguments");
  }
  for (const arg of args) {
    if (arg.length === 0 || arg.length > 4096 || arg.includes(String.fromCharCode(0))) {
      throw new Error("E2E vault-cli directive includes an invalid argument");
    }
  }
  if (args[0] === "assistant") {
    if (
      args.length === 5
      && args[1] === "onboarding"
      && args[2] === "complete"
      && args[3] === "--reason"
      && args[4] === "manual"
    ) {
      return;
    }
    throw new Error("E2E vault-cli directive only supports assistant onboarding complete");
  }
  if (args[0] !== "automation") {
    throw new Error("E2E vault-cli directive only supports automation commands or assistant onboarding complete");
  }
  if (args[1] === "save") {
    return;
  }
  if (
    args[1] === "set-status"
    && args.length === 5
    && args[2] === "finish-onboarding-followup"
    && args[3] === "--status"
    && args[4] === "archived"
  ) {
    return;
  }
  throw new Error("E2E vault-cli directive only supports automation save or automation set-status");
}

function resolveE2EVaultCliInvocation(args) {
  const packageCliPath = resolveE2EMurphPackageCliPath();
  if (packageCliPath) {
    return {
      command: process.execPath,
      args: [packageCliPath, ...args],
    };
  }

  throw new Error("Unable to resolve a trusted E2E vault-cli binary");
}

function resolveE2EMurphPackageCliPath() {
  const configuredCliPath = resolveE2ETrustedMurphCliPathFromEnv();
  if (configuredCliPath) {
    return configuredCliPath;
  }
  const roots = [...new Set([process.cwd(), "/app"])];
  for (const root of roots) {
    const cliPath = resolveE2EMurphPackageCliPathFromTrustedRoot(root);
    if (cliPath) {
      return cliPath;
    }
  }
  return null;
}

function resolveE2ETrustedMurphCliPathFromEnv() {
  if (configuredTrustedMurphCliPath) {
    return resolveE2ETrustedMurphCliPath(configuredTrustedMurphCliPath);
  }

  const configured = process.env[trustedMurphCliPathEnv];
  if (typeof configured !== "string" || !configured.trim()) {
    return null;
  }

  return resolveE2ETrustedMurphCliPath(configured);
}

function resolveE2ETrustedMurphCliPath(candidate) {
  try {
    const cliPath = fs.realpathSync(candidate);
    if (path.basename(cliPath) !== "bin.js") {
      return null;
    }
    const packageRoot = path.dirname(path.dirname(cliPath));
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    );
    if (!packageJson || packageJson.name !== "@murphai/murph") {
      return null;
    }
    if (!isE2EPathWithin(cliPath, packageRoot)) {
      return null;
    }
    return cliPath;
  } catch {
    return null;
  }
}

function resolveE2EMurphPackageCliPathFromTrustedRoot(root) {
  try {
    const trustedRoot = path.resolve(root);
    const entrypoint = moduleRequire.resolve("@murphai/murph", {
      paths: [trustedRoot],
    });
    const cliPath = path.join(path.dirname(entrypoint), "bin.js");
    if (fs.existsSync(cliPath) && isE2EPathWithin(cliPath, trustedRoot)) {
      return cliPath;
    }
  } catch {
    // Try the next trusted runtime package root.
  }
  return null;
}

function isE2EPathWithin(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function callVaultCliCommand(command) {
  validateE2EVaultCliCommandArgs(command.args);
  const invocation = resolveE2EVaultCliInvocation(command.args);
  const result = childProcess.spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
  });
  if (result.error) {
    throw new Error("E2E vault-cli automation command failed: " + redactE2ECommandOutput(result.error.message));
  }
  if (result.status !== 0) {
    throw new Error([
      "E2E vault-cli automation command failed with exit code " + result.status,
      redactE2ECommandOutput(result.stderr),
      redactE2ECommandOutput(result.stdout),
    ].filter(Boolean).join("\\n"));
  }
}

function callDynamicTool(turn, toolCall) {
  return new Promise((resolve, reject) => {
    const id = ++serverRequestCounter;
    const timeout = setTimeout(() => {
      pendingServerRequests.delete(id);
      reject(new Error("dynamic tool call timed out"));
    }, 30000);
    pendingServerRequests.set(id, {
      reject,
      resolve,
      timeout,
    });
    writeRpc({
      id,
      method: "item/tool/call",
      params: {
        arguments: toolCall.arguments,
        namespace: toolCall.namespace,
        threadId: turn.threadId,
        tool: toolCall.tool,
        turnId: turn.turnId,
      },
    });
  }).then((message) => {
    if (message && message.error) {
      const errorMessage =
        message.error && typeof message.error.message === "string"
          ? message.error.message
          : "dynamic tool call failed";
      throw new Error(errorMessage);
    }
    const result = message ? message.result : null;
    if (!result || result.success !== true) {
      const contentItems = result && Array.isArray(result.contentItems)
        ? result.contentItems
        : [];
      const detail = contentItems
        .flatMap((item) => item && typeof item.text === "string" ? [item.text] : [])
        .join(" ")
        .trim();
      throw new Error(detail || "dynamic tool call was not accepted");
    }
  });
}

async function fetchAssistantResponse(providerInput) {
  const response = await fetch(new URL("responses", assistantProviderBaseUrl.replace(/\\/+$/u, "") + "/"), {
    body: JSON.stringify({
      input: providerInput,
      model: "hosted-e2e-codex-shim",
    }),
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(
      "assistant provider stub failed with HTTP "
        + response.status
        + ": "
        + redactE2ECommandOutput(rawBody),
    );
  }

  return extractResponseText(JSON.parse(rawBody));
}

async function completeTurn(turn) {
  if (turn.completed) {
    return;
  }
  turn.completed = true;

  try {
    const providerInput = buildTurnProviderInput(turn);
    const rawText = await fetchAssistantResponse(providerInput);
    const {
      toolCalls,
      vaultCliCommands,
      text,
    } = extractE2EToolDirective(rawText);
    for (const command of vaultCliCommands) {
      callVaultCliCommand(command);
    }
    for (const toolCall of toolCalls) {
      await callDynamicTool(turn, toolCall);
    }
    appendThreadAssistantMessage(turn.threadId, text);
    writeRpc({
      type: "item.completed",
      params: {
        turnId: turn.turnId,
      },
      item: {
        id: "msg_" + turn.turnId,
        type: "assistant.message",
        text,
      },
    });
    writeRpc({
      method: "turn/completed",
      params: {
        turn: {
          id: turn.turnId,
          status: "completed",
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[hosted-e2e-codex-shim] turn failed: " + redactE2ECommandOutput(message));
    writeRpc({
      type: "error",
      params: {
        turnId: turn.turnId,
      },
      message,
    });
    writeRpc({
      method: "turn/completed",
      params: {
        turn: {
          error: {
            message,
          },
          id: turn.turnId,
          status: "failed",
        },
      },
    });
  }
}

function scheduleTurnCompletion(turn) {
  setTimeout(() => {
    void completeTurn(turn);
  }, turnDelayMs);
}

async function handleRpc(message) {
  const id = typeof message.id === "number" ? message.id : null;
  const method = typeof message.method === "string" ? message.method : null;
  const params = message.params && typeof message.params === "object" ? message.params : {};

  if (id !== null && method === null && pendingServerRequests.has(id)) {
    const pending = pendingServerRequests.get(id);
    pendingServerRequests.delete(id);
    clearTimeout(pending.timeout);
    pending.resolve(message);
    return;
  }
  if (id !== null && method === null) {
    return;
  }

  if (method === "initialize" && id !== null) {
    writeRpc({
      id,
      result: {},
    });
    return;
  }

  if (method === "initialized") {
    return;
  }

  if ((method === "thread/start" || method === "thread/resume") && id !== null) {
    const requestedThreadId = typeof params.threadId === "string" && params.threadId.trim()
      ? params.threadId.trim()
      : null;
    const threadId = requestedThreadId ?? buildUuidThreadId(++threadCounter);
    if (method === "thread/resume") {
      const rolloutPath = readRolloutPath(threadId);
      if (!rolloutPath || !fs.existsSync(rolloutPath)) {
        writeRpcError(id, "no rollout found for thread id " + threadId);
        return;
      }
    }
    const receivedDynamicToolNames = readThreadStartDynamicToolNames(params);
    const restoredDynamicToolNames = method === "thread/resume"
      ? readThreadDynamicToolNames(threadId)
      : [];
    const validateReceivedDynamicToolNames =
      method === "thread/start" ||
      receivedDynamicToolNames.length > 0;
    const dynamicToolNames = validateReceivedDynamicToolNames
      ? receivedDynamicToolNames
      : restoredDynamicToolNames;
    const validationError = validateExpectedDynamicTools(
      method,
      validateReceivedDynamicToolNames ? "received" : "restored",
      dynamicToolNames,
    );
    if (validationError) {
      writeRpcError(id, validationError);
      return;
    }
    if (method === "thread/start") {
      threadDynamicToolNames.set(threadId, dynamicToolNames);
    }
    const threadPath = appendThreadRolloutEvent(threadId, {
      ...(dynamicToolNames.length > 0 ? { dynamicToolNames } : {}),
      event: method === "thread/resume" ? "thread.resumed" : "thread.started",
    });
    writeRpc({
      id,
      result: {
        thread: {
          id: threadId,
          ...(threadPath ? { path: threadPath } : {}),
        },
      },
    });
    return;
  }

  if (method === "turn/start" && id !== null) {
    const threadId = typeof params.threadId === "string" && params.threadId.trim()
      ? params.threadId.trim()
      : buildUuidThreadId(threadCounter || ++threadCounter);
    const turnId = "turn_hosted_local_" + (++turnCounter);
    const turn = {
      completed: false,
      inputs: [readInputItems(params)],
      threadId,
      turnId,
    };
    activeTurn = turn;
    writeRpc({
      id,
      result: {
        turn: {
          id: turnId,
        },
      },
    });
    writeRpc({
      method: "turn/started",
      params: {
        turn: {
          id: turnId,
        },
      },
    });
    scheduleTurnCompletion(turn);
    return;
  }

  if (method === "turn/steer" && id !== null) {
    if (!activeTurn || activeTurn.completed) {
      writeRpcError(id, "hosted E2E Codex shim does not have an active turn");
      return;
    }
    activeTurn.inputs.push(readInputItems(params));
    writeRpc({
      id,
      result: {
        ok: true,
      },
    });
    return;
  }

  if (method === "turn/interrupt" && id !== null) {
    if (activeTurn) {
      activeTurn.completed = true;
    }
    writeRpc({
      id,
      result: {
        ok: true,
      },
    });
    writeRpc({
      method: "turn/completed",
      params: {
        turn: {
          id: activeTurn ? activeTurn.turnId : "turn_hosted_local_unknown",
          status: "interrupted",
        },
      },
    });
    return;
  }

  if (id !== null) {
    writeRpcError(id, "unsupported hosted E2E Codex shim method: " + (method ?? "unknown"));
  }
}

const rl = readline.createInterface({
  input: process.stdin,
});
let queue = Promise.resolve();

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  queue = queue.then(async () => {
    await handleRpc(JSON.parse(trimmed));
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    writeRpc({
      type: "error",
      message,
    });
  });
});
`;
}

const HOSTED_CODEX_DYNAMIC_TOOL_NAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}(?:\.[A-Za-z0-9][A-Za-z0-9_.-]{0,63})+$/u;

async function resolveHostedLocalTrustedMurphCliPath(
  runtimeEnv: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const explicitPath = normalizeHostedLocalTrustedMurphCliPath(
    runtimeEnv[HOSTED_LOCAL_CODEX_APP_SERVER_STUB_MURPH_CLI_PATH_ENV],
  );
  if (explicitPath) {
    return await validateHostedLocalTrustedMurphCliPath(explicitPath);
  }

  const localWorkspaceCliPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../cli/dist/bin.js",
  );
  return await validateHostedLocalTrustedMurphCliPath(localWorkspaceCliPath);
}

function normalizeHostedLocalTrustedMurphCliPath(value: string | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return path.resolve(value.trim());
}

async function validateHostedLocalTrustedMurphCliPath(candidate: string): Promise<string | null> {
  try {
    const cliPath = await realpath(candidate);
    if (path.basename(cliPath) !== "bin.js") {
      return null;
    }
    const packageRoot = path.dirname(path.dirname(cliPath));
    const packageJson = JSON.parse(
      await readFile(path.join(packageRoot, "package.json"), "utf8"),
    ) as { name?: unknown };
    if (packageJson.name !== "@murphai/murph") {
      return null;
    }
    await access(cliPath);
    return cliPath;
  } catch {
    return null;
  }
}

function readHostedLocalCodexAppServerStubExpectedDynamicTools(
  runtimeEnv: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const rawValue =
    runtimeEnv[HOSTED_LOCAL_CODEX_APP_SERVER_STUB_EXPECT_DYNAMIC_TOOLS_ENV];
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return [];
  }

  const values = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) {
    throw new HostedLocalCodexAppServerStubConfigurationError(
      "HOSTED_LOCAL_CODEX_APP_SERVER_STUB_CONFIG_INVALID",
      `${HOSTED_LOCAL_CODEX_APP_SERVER_STUB_EXPECT_DYNAMIC_TOOLS_ENV} must list at least one dynamic tool name.`,
    );
  }
  if (values.length > 16) {
    throw new HostedLocalCodexAppServerStubConfigurationError(
      "HOSTED_LOCAL_CODEX_APP_SERVER_STUB_CONFIG_INVALID",
      `${HOSTED_LOCAL_CODEX_APP_SERVER_STUB_EXPECT_DYNAMIC_TOOLS_ENV} must list at most 16 dynamic tool names.`,
    );
  }

  const seen = new Set<string>();
  for (const value of values) {
    if (!HOSTED_CODEX_DYNAMIC_TOOL_NAME_PATTERN.test(value)) {
      throw new HostedLocalCodexAppServerStubConfigurationError(
        "HOSTED_LOCAL_CODEX_APP_SERVER_STUB_CONFIG_INVALID",
        `${HOSTED_LOCAL_CODEX_APP_SERVER_STUB_EXPECT_DYNAMIC_TOOLS_ENV} contains an invalid dynamic tool name.`,
      );
    }
    if (seen.has(value)) {
      throw new HostedLocalCodexAppServerStubConfigurationError(
        "HOSTED_LOCAL_CODEX_APP_SERVER_STUB_CONFIG_INVALID",
        `${HOSTED_LOCAL_CODEX_APP_SERVER_STUB_EXPECT_DYNAMIC_TOOLS_ENV} must not contain duplicate dynamic tool names.`,
      );
    }
    seen.add(value);
  }

  return values;
}

function readHostedLocalCodexAppServerStubTurnDelayMs(
  runtimeEnv: Readonly<Record<string, string | undefined>>,
): number | null {
  const rawValue =
    runtimeEnv[HOSTED_LOCAL_CODEX_APP_SERVER_STUB_TURN_DELAY_MS_ENV];
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return null;
  }

  const value = Number(rawValue.trim());
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) {
    throw new HostedLocalCodexAppServerStubConfigurationError(
      "HOSTED_LOCAL_CODEX_APP_SERVER_STUB_CONFIG_INVALID",
      `${HOSTED_LOCAL_CODEX_APP_SERVER_STUB_TURN_DELAY_MS_ENV} must be an integer from 0 to 60000.`,
    );
  }

  return value;
}

async function installHostedLocalCodexAppServerShim(input: {
  installPath: string;
  runtimeCommandPath: string;
  runtimeEnv: Record<string, string | undefined>;
  source: string;
}): Promise<void> {
  const binDir = path.dirname(input.installPath);
  await mkdir(binDir, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(binDir, 0o700);
  await writeFile(
    input.installPath,
    input.source,
    {
      encoding: "utf8",
      mode: 0o700,
    },
  );
  await chmod(input.installPath, 0o700);
  input.runtimeEnv[HOSTED_LOCAL_CODEX_APP_SERVER_COMMAND_ENV] = input.runtimeCommandPath;
}

function readHostedLocalCodexAppServerStubBaseUrl(
  runtimeEnv: Readonly<Record<string, string | undefined>>,
): string | null {
  const rawBaseUrl = normalizeHostedCodexEnvString(
    runtimeEnv[HOSTED_LOCAL_CODEX_APP_SERVER_STUB_BASE_URL_ENV],
  );

  if (!rawBaseUrl) {
    return null;
  }

  if (normalizeHostedCodexEnvString(runtimeEnv.NODE_ENV) !== "test") {
    throw new HostedLocalCodexAppServerStubConfigurationError(
      "HOSTED_LOCAL_CODEX_APP_SERVER_STUB_CONFIG_INVALID",
      `${HOSTED_LOCAL_CODEX_APP_SERVER_STUB_BASE_URL_ENV} is only available when NODE_ENV=test.`,
    );
  }

  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new HostedLocalCodexAppServerStubConfigurationError(
      "HOSTED_LOCAL_CODEX_APP_SERVER_STUB_CONFIG_INVALID",
      `${HOSTED_LOCAL_CODEX_APP_SERVER_STUB_BASE_URL_ENV} must be an absolute URL.`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HostedLocalCodexAppServerStubConfigurationError(
      "HOSTED_LOCAL_CODEX_APP_SERVER_STUB_CONFIG_INVALID",
      `${HOSTED_LOCAL_CODEX_APP_SERVER_STUB_BASE_URL_ENV} must use http or https.`,
    );
  }

  if (!isHostedLocalCodexTestHostname(normalizeHostedCodexUrlHostname(url.hostname))) {
    throw new HostedLocalCodexAppServerStubConfigurationError(
      "HOSTED_LOCAL_CODEX_APP_SERVER_STUB_CONFIG_INVALID",
      `${HOSTED_LOCAL_CODEX_APP_SERVER_STUB_BASE_URL_ENV} must point at a local test host.`,
    );
  }

  return url.toString();
}

function isHostedLocalCodexTestHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "127.0.0.1"
    || normalized === "localhost"
    || normalized === "::1"
    || normalized === "host.docker.internal"
    || normalized === "host.containers.internal"
    || isHostedLocalCodexPrivateIpv4Host(normalized);
}

function isHostedLocalCodexPrivateIpv4Host(hostname: string): boolean {
  const parts = parseHostedLocalCodexIpv4Parts(hostname);
  if (!parts) {
    return false;
  }

  const [first, second] = parts;
  return first === 10
    || first === 127
    || first === 169 && second === 254
    || first === 172 && second >= 16 && second <= 31
    || first === 192 && second === 168;
}

function parseHostedLocalCodexIpv4Parts(value: string): [number, number, number, number] | null {
  const rawParts = value.split(".");
  if (rawParts.length !== 4) {
    return null;
  }

  const parts = rawParts.map((part) => {
    if (!/^\d{1,3}$/u.test(part)) {
      return Number.NaN;
    }

    return Number(part);
  });

  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return parts as [number, number, number, number];
}

function normalizeHostedCodexUrlHostname(hostname: string): string {
  return hostname.replace(/^\[/u, "").replace(/\]$/u, "");
}

function normalizeHostedCodexEnvString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
