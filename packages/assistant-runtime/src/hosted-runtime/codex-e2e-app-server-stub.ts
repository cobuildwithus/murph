import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  HostedAssistantConfigurationError,
} from "@murphai/operator-config/hosted-assistant-config";

import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_TURN_DELAY_MS_ENV,
} from "./launch-spec.ts";

const HOSTED_CODEX_STUB_BIN_DIR_NAME = "bin";
const DEFAULT_HOSTED_CODEX_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export async function maybeInstallHostedE2ECodexAppServerStub(input: {
  codexHome: string;
  runtimeEnv: Record<string, string>;
}): Promise<void> {
  const assistantProviderBaseUrl = readHostedE2ECodexAppServerStubBaseUrl(input.runtimeEnv);

  if (!assistantProviderBaseUrl) {
    return;
  }

  await installHostedE2ECodexShim({
    codexHome: input.codexHome,
    runtimeEnv: input.runtimeEnv,
    source: buildHostedE2ECodexAppServerStubSource({
      assistantProviderBaseUrl,
      turnDelayMs: readHostedE2ECodexAppServerStubTurnDelayMs(input.runtimeEnv),
    }),
  });
}

export function buildHostedE2ECodexAppServerStubSource(input: {
  assistantProviderBaseUrl: string;
  turnDelayMs?: number | null;
}): string {
  const turnDelayMs = input.turnDelayMs ?? 25;
  return `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const assistantProviderBaseUrl = ${JSON.stringify(input.assistantProviderBaseUrl)};
const turnDelayMs = ${JSON.stringify(turnDelayMs)};
const processThreadPrefix = String(process.pid % 1000000).padStart(6, "0");
let threadCounter = 0;
let turnCounter = 0;
let activeTurn = null;
const threadAssistantHistory = new Map();

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

function readTextInput(params) {
  const input = params && Array.isArray(params.input) ? params.input : [];
  return input
    .flatMap((item) => item && item.type === "text" && typeof item.text === "string" ? [item.text] : [])
    .join("\\n\\n");
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

function buildTurnPrompt(turn) {
  return [
    buildThreadHistoryPrompt(turn.threadId),
    turn.prompts.filter(Boolean).join("\\n\\n"),
  ].filter(Boolean).join("\\n\\n");
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

async function fetchAssistantResponse(prompt) {
  const response = await fetch(new URL("responses", assistantProviderBaseUrl.replace(/\\/+$/u, "") + "/"), {
    body: JSON.stringify({
      input: prompt,
      model: "hosted-e2e-codex-shim",
    }),
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error("assistant provider stub failed with HTTP " + response.status + ": " + rawBody);
  }

  return extractResponseText(JSON.parse(rawBody));
}

async function completeTurn(turn) {
  if (turn.completed) {
    return;
  }
  turn.completed = true;

  try {
    const prompt = buildTurnPrompt(turn);
    const text = await fetchAssistantResponse(prompt);
    appendThreadAssistantMessage(turn.threadId, text);
    writeRpc({
      type: "item.completed",
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
    writeRpc({
      type: "error",
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
    const threadPath = appendThreadRolloutEvent(threadId, {
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
      prompts: [readTextInput(params)],
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
    activeTurn.prompts.push(readTextInput(params));
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

function readHostedE2ECodexAppServerStubTurnDelayMs(
  runtimeEnv: Record<string, string>,
): number | null {
  const rawValue =
    runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_TURN_DELAY_MS_ENV];
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return null;
  }

  const value = Number(rawValue.trim());
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_TURN_DELAY_MS_ENV} must be an integer from 0 to 60000.`,
    );
  }

  return value;
}

async function installHostedE2ECodexShim(input: {
  codexHome: string;
  runtimeEnv: Record<string, string>;
  source: string;
}): Promise<void> {
  const binDir = path.join(input.codexHome, HOSTED_CODEX_STUB_BIN_DIR_NAME);
  const codexPath = path.join(binDir, "codex");
  await mkdir(binDir, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(binDir, 0o700);
  await writeFile(
    codexPath,
    input.source,
    {
      encoding: "utf8",
      mode: 0o700,
    },
  );
  await chmod(codexPath, 0o700);

  input.runtimeEnv.PATH = prependHostedCodexPathSegment(
    binDir,
    input.runtimeEnv.PATH ?? process.env.PATH ?? DEFAULT_HOSTED_CODEX_PATH,
  );
}

function readHostedE2ECodexAppServerStubBaseUrl(
  runtimeEnv: Readonly<Record<string, string>>,
): string | null {
  const rawBaseUrl = normalizeHostedCodexEnvString(
    runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV],
  );

  if (!rawBaseUrl) {
    return null;
  }

  if (normalizeHostedCodexEnvString(runtimeEnv.NODE_ENV) !== "test") {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV} is only available when NODE_ENV=test.`,
    );
  }

  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV} must be an absolute URL.`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV} must use http or https.`,
    );
  }

  if (!isHostedLocalCodexTestHostname(normalizeHostedCodexUrlHostname(url.hostname))) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV} must point at a local test host.`,
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

function prependHostedCodexPathSegment(segment: string, currentPath: string): string {
  return [segment, currentPath]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(path.delimiter);
}
