import { chmod, mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import {
  HostedAssistantConfigurationError,
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_BASE_URL_ENV,
  HOSTED_ASSISTANT_CODEX_COMMAND_ENV,
  HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS_ENV,
  HOSTED_ASSISTANT_OSS_ENV,
  HOSTED_ASSISTANT_PROFILE_ENV,
  HOSTED_ASSISTANT_PROVIDER_NAME_ENV,
} from "@murphai/operator-config/hosted-assistant-config";
import {
  VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
} from "@murphai/operator-config/assistant/target-runtime";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
} from "./launch-spec.ts";

const HOSTED_CODEX_CONFIG_DIR_NAME = ".codex-hosted";
const HOSTED_CODEX_CONFIG_FILE_NAME = "config.toml";
const HOSTED_CODEX_PROXY_CONFIG_FILE_NAME = "app-server-proxy.json";
const HOSTED_CODEX_STUB_BIN_DIR_NAME = "bin";
const HOSTED_LOCAL_CODEX_PROVIDER_ID = "local-codex";
const DEFAULT_HOSTED_CODEX_MODEL = "gpt-5.5";
const DEFAULT_HOSTED_CODEX_REASONING_EFFORT = "medium";
const DEFAULT_HOSTED_CODEX_APPROVAL_POLICY = "never";
const DEFAULT_HOSTED_CODEX_SANDBOX = "danger-full-access";
const DEFAULT_HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE = "all";
const DEFAULT_HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY = [
  "CI",
  "CODEX_HOME",
  "COLORTERM",
  "CURL_CA_BUNDLE",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NODE_EXTRA_CA_CERTS",
  "NO_COLOR",
  "PATH",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "VAULT",
] as const;
const DEFAULT_HOSTED_CODEX_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const HOSTED_CODEX_REJECTED_SEED_ENV_KEYS = [
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_BASE_URL_ENV,
  HOSTED_ASSISTANT_CODEX_COMMAND_ENV,
  HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS_ENV,
  HOSTED_ASSISTANT_OSS_ENV,
  HOSTED_ASSISTANT_PROFILE_ENV,
  HOSTED_ASSISTANT_PROVIDER_NAME_ENV,
] as const;

export interface HostedCodexRuntimeEnvironmentInput {
  operatorHomeRoot: string;
  runtimeEnv: Readonly<Record<string, string>>;
}

export interface HostedCodexRuntimeEnvironmentResult {
  codexConfigPath: string | null;
  codexHome: string | null;
  runtimeEnv: Record<string, string>;
}

export async function prepareHostedCodexRuntimeEnvironment(
  input: HostedCodexRuntimeEnvironmentInput,
): Promise<HostedCodexRuntimeEnvironmentResult> {
  const provider = normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_PROVIDER);
  const hasLocalCodexAppServerProxy = normalizeHostedCodexEnvString(
    input.runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV],
  ) !== null;
  const usesLocalCodexProvider = provider === HOSTED_LOCAL_CODEX_PROVIDER_ID;

  if (
    provider !== VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG.id
    && !usesLocalCodexProvider
  ) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `Hosted Codex runtime only supports HOSTED_ASSISTANT_PROVIDER=${VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG.id}, or ${HOSTED_LOCAL_CODEX_PROVIDER_ID} with the local Codex app-server bridge.`,
    );
  }

  const providerConfig = VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG;
  const apiKeyValue = normalizeHostedCodexEnvString(input.runtimeEnv[providerConfig.envKey]);

  if (usesLocalCodexProvider && !hasLocalCodexAppServerProxy) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_REQUIRED",
      `${HOSTED_LOCAL_CODEX_PROVIDER_ID} requires ${HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV}.`,
    );
  }

  if (!usesLocalCodexProvider && !apiKeyValue && !hasLocalCodexAppServerProxy) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_REQUIRED",
      `Hosted assistant provider ${providerConfig.id} requires ${providerConfig.envKey} in the isolated runtime environment.`,
    );
  }

  const codexHome = path.join(input.operatorHomeRoot, HOSTED_CODEX_CONFIG_DIR_NAME);
  const codexConfigPath = path.join(codexHome, HOSTED_CODEX_CONFIG_FILE_NAME);
  const runtimeEnv = stripHostedCodexRejectedSeedEnv(input.runtimeEnv);
  Object.assign(runtimeEnv, {
    CODEX_HOME: codexHome,
    HOSTED_ASSISTANT_MODEL:
      normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_MODEL)
      ?? DEFAULT_HOSTED_CODEX_MODEL,
    HOSTED_ASSISTANT_REASONING_EFFORT:
      normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT)
      ?? DEFAULT_HOSTED_CODEX_REASONING_EFFORT,
    HOSTED_ASSISTANT_APPROVAL_POLICY:
      normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_APPROVAL_POLICY)
      ?? DEFAULT_HOSTED_CODEX_APPROVAL_POLICY,
    HOSTED_ASSISTANT_SANDBOX:
      normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_SANDBOX)
      ?? DEFAULT_HOSTED_CODEX_SANDBOX,
  });

  await mkdir(codexHome, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(codexHome, 0o700);
  await writeFile(
    codexConfigPath,
    usesLocalCodexProvider
      ? buildHostedLocalCodexConfigToml({
          model: runtimeEnv.HOSTED_ASSISTANT_MODEL,
          reasoningEffort: runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT,
        })
      : buildHostedCodexConfigToml({
          model: runtimeEnv.HOSTED_ASSISTANT_MODEL,
          provider: providerConfig,
          reasoningEffort: runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT,
        }),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  await chmod(codexConfigPath, 0o600);
  await maybeInstallHostedLocalCodexAppServerStub({
    codexHome,
    runtimeEnv,
  });

  return {
    codexConfigPath,
    codexHome,
    runtimeEnv,
  };
}

function stripHostedCodexRejectedSeedEnv(
  runtimeEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  const nextEnv = { ...runtimeEnv };

  for (const key of HOSTED_CODEX_REJECTED_SEED_ENV_KEYS) {
    delete nextEnv[key];
  }

  return nextEnv;
}

async function maybeInstallHostedLocalCodexAppServerStub(input: {
  codexHome: string;
  runtimeEnv: Record<string, string>;
}): Promise<void> {
  const appServerProxy = readHostedLocalCodexAppServerProxyConfig(input.runtimeEnv);
  const assistantProviderBaseUrl = readHostedLocalCodexAppServerStubBaseUrl(input.runtimeEnv);

  if (appServerProxy && assistantProviderBaseUrl) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV} cannot be combined with ${HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV}.`,
    );
  }

  if (appServerProxy) {
    await writeHostedLocalCodexAppServerProxyConfig({
      codexHome: input.codexHome,
      config: appServerProxy,
    });
    await installHostedLocalCodexShim({
      codexHome: input.codexHome,
      runtimeEnv: input.runtimeEnv,
      source: buildHostedLocalCodexAppServerProxySource(),
    });
    delete input.runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV];
    delete input.runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV];
    return;
  }

  if (!assistantProviderBaseUrl) {
    return;
  }

  await installHostedLocalCodexShim({
    codexHome: input.codexHome,
    runtimeEnv: input.runtimeEnv,
    source: buildHostedLocalCodexAppServerStubSource(assistantProviderBaseUrl),
  });
}

async function installHostedLocalCodexShim(input: {
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

export interface HostedLocalCodexAppServerProxyConfig {
  token: string;
  url: string;
}

async function writeHostedLocalCodexAppServerProxyConfig(input: {
  codexHome: string;
  config: HostedLocalCodexAppServerProxyConfig;
}): Promise<void> {
  const proxyConfigPath = path.join(input.codexHome, HOSTED_CODEX_PROXY_CONFIG_FILE_NAME);
  await writeFile(
    proxyConfigPath,
    `${JSON.stringify(input.config)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  await chmod(proxyConfigPath, 0o600);
}

function readHostedLocalCodexAppServerProxyConfig(
  runtimeEnv: Readonly<Record<string, string>>,
): HostedLocalCodexAppServerProxyConfig | null {
  const rawUrl = normalizeHostedCodexEnvString(
    runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV],
  );

  if (!rawUrl) {
    return null;
  }

  const token = normalizeHostedCodexEnvString(
    runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV],
  );
  if (!token) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV} requires ${HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV}.`,
    );
  }

  const nodeEnv = normalizeHostedCodexEnvString(runtimeEnv.NODE_ENV);
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV} is only available when NODE_ENV=development or NODE_ENV=test.`,
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV} must be an absolute URL.`,
    );
  }

  if (url.protocol !== "tcp:") {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV} must use tcp.`,
    );
  }

  if (!url.port || !Number.isSafeInteger(Number(url.port))) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV} must include a TCP port.`,
    );
  }

  if (!isHostedLocalCodexProxyHostname(normalizeHostedCodexUrlHostname(url.hostname))) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV} must point at a local dev host.`,
    );
  }

  return {
    token,
    url: url.toString(),
  };
}

export function buildHostedLocalCodexAppServerProxySource(): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const proxyConfigPath = path.join(__dirname, "..", ${JSON.stringify(HOSTED_CODEX_PROXY_CONFIG_FILE_NAME)});
const proxyConfig = JSON.parse(fs.readFileSync(proxyConfigPath, "utf8"));
if (typeof proxyConfig.url !== "string" || typeof proxyConfig.token !== "string") {
  process.stderr.write("hosted local Codex proxy config is invalid\\n");
  process.exit(78);
}
const proxyUrl = new URL(proxyConfig.url);
const proxyToken = proxyConfig.token;
const port = Number(proxyUrl.port);
const host = proxyUrl.hostname.replace(/^\\[/u, "").replace(/\\]$/u, "");

if (process.argv[2] && process.argv[2] !== "app-server") {
  process.stderr.write("hosted local Codex proxy only supports app-server\\n");
  process.exit(64);
}

const socket = net.connect({ host, port }, () => {
  socket.write(JSON.stringify({ murphLocalCodexBridgeToken: proxyToken }) + "\\n");
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});

socket.on("error", (error) => {
  process.stderr.write("hosted local Codex proxy failed: " + error.message + "\\n");
  process.exitCode = 1;
});

socket.on("close", () => {
  process.exit(process.exitCode ?? 0);
});
`;
}

function readHostedLocalCodexAppServerStubBaseUrl(
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

  if (!isHostedLocalCodexStubHostname(normalizeHostedCodexUrlHostname(url.hostname))) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV} must point at a local test host.`,
    );
  }

  return url.toString();
}

function isHostedLocalCodexStubHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "127.0.0.1"
    || normalized === "localhost"
    || normalized === "::1"
    || normalized === "host.docker.internal";
}

function isHostedLocalCodexProxyHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return isHostedLocalCodexStubHostname(normalized)
    || isPrivateIpv4Hostname(normalized)
    || isLocalIpv6Hostname(normalized);
}

function isPrivateIpv4Hostname(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => {
    if (!/^[0-9]+$/u.test(part)) {
      return Number.NaN;
    }

    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : Number.NaN;
  });

  if (octets.some((octet) => Number.isNaN(octet))) {
    return false;
  }

  const [first, second] = octets;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254);
}

function isLocalIpv6Hostname(hostname: string): boolean {
  if (isIP(hostname) !== 6) {
    return false;
  }

  const normalized = hostname.toLowerCase();
  return normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:");
}

function normalizeHostedCodexUrlHostname(hostname: string): string {
  return hostname.replace(/^\[/u, "").replace(/\]$/u, "");
}

function prependHostedCodexPathSegment(segment: string, currentPath: string): string {
  return [segment, currentPath]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(path.delimiter);
}

export function buildHostedLocalCodexAppServerStubSource(
  assistantProviderBaseUrl: string,
): string {
  return `#!/usr/bin/env node
const readline = require("node:readline");

const assistantProviderBaseUrl = ${JSON.stringify(assistantProviderBaseUrl)};
const turnDelayMs = 25;
let threadCounter = 0;
let turnCounter = 0;
let activeTurn = null;

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

function readTextInput(params) {
  const input = params && Array.isArray(params.input) ? params.input : [];
  return input
    .flatMap((item) => item && item.type === "text" && typeof item.text === "string" ? [item.text] : [])
    .join("\\n\\n");
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
      model: "hosted-local-codex-shim",
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
    const prompt = turn.prompts.filter(Boolean).join("\\n\\n");
    const text = await fetchAssistantResponse(prompt);
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
    const threadId = requestedThreadId ?? "thread_hosted_local_" + (++threadCounter);
    writeRpc({
      id,
      result: {
        thread: {
          id: threadId,
        },
      },
    });
    return;
  }

  if (method === "turn/start" && id !== null) {
    const threadId = typeof params.threadId === "string" && params.threadId.trim()
      ? params.threadId.trim()
      : "thread_hosted_local_" + (threadCounter || 1);
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
      writeRpcError(id, "hosted local Codex shim does not have an active turn");
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
    writeRpcError(id, "unsupported hosted local Codex shim method: " + (method ?? "unknown"));
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

export function buildHostedCodexConfigToml(input: {
  model: string;
  provider: typeof VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG;
  reasoningEffort: string;
}): string {
  return [
    `model = ${tomlString(input.model)}`,
    `model_provider = ${tomlString(input.provider.id)}`,
    `model_reasoning_effort = ${tomlString(input.reasoningEffort)}`,
    `approval_policy = ${tomlString(DEFAULT_HOSTED_CODEX_APPROVAL_POLICY)}`,
    `sandbox_mode = ${tomlString(DEFAULT_HOSTED_CODEX_SANDBOX)}`,
    "",
    `[model_providers.${tomlQuotedKey(input.provider.id)}]`,
    `name = ${tomlString(input.provider.name)}`,
    `base_url = ${tomlString(input.provider.baseUrl)}`,
    `env_key = ${tomlString(input.provider.envKey)}`,
    `wire_api = ${tomlString(input.provider.wireApi)}`,
    "",
    "[shell_environment_policy]",
    `inherit = ${tomlString(DEFAULT_HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE)}`,
    `include_only = ${tomlStringArray(DEFAULT_HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY)}`,
    "",
  ].join("\n");
}

export function buildHostedLocalCodexConfigToml(input: {
  model: string;
  reasoningEffort: string;
}): string {
  return [
    `model = ${tomlString(input.model)}`,
    `model_reasoning_effort = ${tomlString(input.reasoningEffort)}`,
    `approval_policy = ${tomlString(DEFAULT_HOSTED_CODEX_APPROVAL_POLICY)}`,
    `sandbox_mode = ${tomlString(DEFAULT_HOSTED_CODEX_SANDBOX)}`,
    "",
    "[shell_environment_policy]",
    `inherit = ${tomlString(DEFAULT_HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE)}`,
    `include_only = ${tomlStringArray(DEFAULT_HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY)}`,
    "",
  ].join("\n");
}

function normalizeHostedCodexEnvString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function tomlQuotedKey(value: string): string {
  return tomlString(value);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}
