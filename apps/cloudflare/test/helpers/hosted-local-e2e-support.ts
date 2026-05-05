import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  deviceSyncProviderRuntimeSecretEnvKeys,
  deviceSyncProviderRuntimeVariableEnvKeys,
} from "@murphai/device-syncd/config";

const hostedWebSmokeDefaultEncryptionKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const hostedWebSmokeDefaultEncryptionKeyVersion = "v1";
const hostedLocalE2eRunnerTimeoutMs = "240000";
const defaultHostedRunnerEnvProfiles = [
  "assistant",
] as const;
export const HOSTED_LOCAL_ASSISTANT_STUB_CLEARED_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "FIREWORKS_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACEHUB_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HUGGING_FACE_HUB_TOKEN",
  "LITELLM_PROXY_API_KEY",
  "MISTRAL_API_KEY",
  "NVIDIA_API_KEY",
  "NGC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "PERPLEXITY_API_KEY",
  "TOGETHER_API_KEY",
  "VENICE_API_KEY",
  "XAI_API_KEY",
  "HOSTED_ASSISTANT_API_KEY_ENV",
  "HOSTED_ASSISTANT_BASE_URL",
  "HOSTED_ASSISTANT_CODEX_COMMAND",
  "HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS",
  "HOSTED_ASSISTANT_OSS",
  "HOSTED_ASSISTANT_PROFILE",
  "HOSTED_ASSISTANT_PROVIDER_NAME",
] as const;
export const HOSTED_LOCAL_DEVICE_SYNC_PROVIDER_CLEARED_ENV_KEYS = [
  ...deviceSyncProviderRuntimeSecretEnvKeys,
  ...deviceSyncProviderRuntimeVariableEnvKeys,
] as const;

export type HostedLocalAssistantProviderMode = "stub" | "live";

export interface HostedLocalAssistantProviderStubState {
  queuedResponseTexts: string[];
}

export interface HostedLocalAssistantProviderStubRequest {
  body: string;
  method: string;
  url: string;
}

export function buildHostedAssistantNotificationDecisionResponse(input: {
  privateSummary?: string;
  subject?: string | null;
  text: string;
}): string {
  const text = input.text.trim();
  if (!text) {
    throw new Error("Hosted assistant notification decision text must be non-empty.");
  }

  const privateSummary = input.privateSummary?.trim() || "deliver";
  const subject = input.subject?.trim() || null;

  return JSON.stringify({
    kind: "send_message",
    privateSummary,
    text,
    ...(subject ? { subject } : {}),
  });
}

function dequeueAssistantProviderResponseText(input: {
  fallbackResponseText?: string | null;
  responseState?: HostedLocalAssistantProviderStubState;
}): string | null {
  return (
    input.responseState?.queuedResponseTexts.shift()
    ?? input.fallbackResponseText
    ?? null
  );
}

function buildAssistantProviderResponsesApiStubResponse(input: {
  modelId: string;
  responseId?: string;
  responseText: string;
}): Record<string, unknown> {
  return {
    created_at: Math.floor(Date.now() / 1000),
    id: input.responseId ?? "resp_stub_hosted_local_e2e",
    model: input.modelId,
    output: [
      {
        content: [
          {
            annotations: [],
            text: input.responseText,
            type: "output_text",
          },
        ],
        id: "msg_stub_hosted_local_e2e",
        role: "assistant",
        type: "message",
      },
    ],
    usage: {
      input_tokens: 24,
      output_tokens: 11,
    },
  };
}

function writeAssistantProviderResponsesApiStubStream(input: {
  modelId: string;
  response: ServerResponse;
  responseId: string;
  responseText: string;
}): void {
  const messageId = `msg_${input.responseId}`;
  const content = {
    annotations: [],
    text: input.responseText,
    type: "output_text",
  };
  const outputItem = {
    content: [content],
    id: messageId,
    role: "assistant",
    status: "completed",
    type: "message",
  };
  const completedResponse = {
    ...buildAssistantProviderResponsesApiStubResponse({
      modelId: input.modelId,
      responseId: input.responseId,
      responseText: input.responseText,
    }),
    output: [outputItem],
    status: "completed",
  };

  input.response.statusCode = 200;
  input.response.setHeader("cache-control", "no-cache");
  input.response.setHeader("content-type", "text/event-stream; charset=utf-8");
  writeAssistantProviderSseEvent(input.response, "response.created", {
    response: {
      ...completedResponse,
      output: [],
      status: "in_progress",
    },
    type: "response.created",
  });
  writeAssistantProviderSseEvent(input.response, "response.output_item.added", {
    item: {
      ...outputItem,
      content: [],
      status: "in_progress",
    },
    output_index: 0,
    type: "response.output_item.added",
  });
  writeAssistantProviderSseEvent(input.response, "response.content_part.added", {
    content_index: 0,
    item_id: messageId,
    output_index: 0,
    part: {
      annotations: [],
      text: "",
      type: "output_text",
    },
    type: "response.content_part.added",
  });
  writeAssistantProviderSseEvent(input.response, "response.output_text.delta", {
    content_index: 0,
    delta: input.responseText,
    item_id: messageId,
    output_index: 0,
    type: "response.output_text.delta",
  });
  writeAssistantProviderSseEvent(input.response, "response.output_text.done", {
    content_index: 0,
    item_id: messageId,
    output_index: 0,
    text: input.responseText,
    type: "response.output_text.done",
  });
  writeAssistantProviderSseEvent(input.response, "response.content_part.done", {
    content_index: 0,
    item_id: messageId,
    output_index: 0,
    part: content,
    type: "response.content_part.done",
  });
  writeAssistantProviderSseEvent(input.response, "response.output_item.done", {
    item: outputItem,
    output_index: 0,
    type: "response.output_item.done",
  });
  writeAssistantProviderSseEvent(input.response, "response.completed", {
    response: completedResponse,
    type: "response.completed",
  });
  input.response.write("data: [DONE]\n\n");
  input.response.end();
}

function writeAssistantProviderSseEvent(
  response: ServerResponse,
  event: string,
  payload: Record<string, unknown>,
): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function startAssistantProviderStubServer(input: {
  fallbackResponseText?: string | null;
  maxResponsesApiRequestBodies?: number;
  modelId?: string;
  onRequest?: (request: HostedLocalAssistantProviderStubRequest) => void;
  responseState?: HostedLocalAssistantProviderStubState;
} = {}): Promise<ReturnType<typeof createServer>> {
  const modelId = input.modelId ?? "gpt-5.5";
  let responseSequence = 0;
  let responsesApiRequestBodyCount = 0;

  const server = createServer(async (request, response) => {
    const requestMethod = request.method ?? "GET";
    const requestUrl = request.url ?? "/";
    if (
      requestMethod === "POST"
      && requestUrl === "/v1/responses"
      && typeof input.maxResponsesApiRequestBodies === "number"
      && responsesApiRequestBodyCount >= input.maxResponsesApiRequestBodies
    ) {
      response.setHeader("connection", "close");
      writeJsonResponse(response, 429, {
        error: "Assistant provider stub captured the maximum configured Responses API request bodies.",
      });
      request.destroy();
      return;
    }

    const body = await readRequestBody(request);
    const requestRecord = {
      body,
      method: requestMethod,
      url: requestUrl,
    } satisfies HostedLocalAssistantProviderStubRequest;
    input.onRequest?.(requestRecord);
    if (process.env.MURPH_E2E_DEBUG_ASSISTANT_PROVIDER_STUB === "1") {
      console.log(
        `[assistant-provider-stub] ${requestRecord.method} ${requestRecord.url}`,
      );
    }

    if (request.method === "GET" && request.url === "/v1/models") {
      writeJsonResponse(response, 200, {
        data: [
          {
            id: modelId,
          },
        ],
      });
      return;
    }

    if (request.method === "POST" && request.url === "/v1/responses") {
      responsesApiRequestBodyCount += 1;
      const bodyJson = parseJsonObject(body);
      if (!bodyJson || typeof bodyJson !== "object") {
        writeJsonResponse(response, 400, {
          error: "Assistant provider stub requires a responses request with a JSON object body.",
        });
        return;
      }

      const responseText = dequeueAssistantProviderResponseText({
        fallbackResponseText: input.fallbackResponseText,
        responseState: input.responseState,
      });
      if (!responseText) {
        writeJsonResponse(response, 500, {
          error: "Assistant provider stub received a responses request without a queued response.",
        });
        return;
      }

      responseSequence += 1;
      const responseId = `resp_stub_hosted_local_e2e_${responseSequence}`;
      if (bodyJson.stream === true) {
        writeAssistantProviderResponsesApiStubStream({
          modelId,
          response,
          responseId,
          responseText,
        });
        return;
      }

      writeJsonResponse(response, 200, buildAssistantProviderResponsesApiStubResponse({
        modelId,
        responseId,
        responseText,
      }));
      return;
    }

    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      const bodyJson = parseJsonObject(body);
      if (!bodyJson || !Array.isArray(bodyJson.messages)) {
        writeJsonResponse(response, 400, {
          error: "Assistant provider stub requires a chat completion request with a messages array.",
        });
        return;
      }

      const responseText = dequeueAssistantProviderResponseText({
        fallbackResponseText: input.fallbackResponseText,
        responseState: input.responseState,
      });
      if (!responseText) {
        writeJsonResponse(response, 500, {
          error: "Assistant provider stub received a completion request without a queued response.",
        });
        return;
      }

      writeJsonResponse(response, 200, {
        id: "chatcmpl_stub_hosted_local_e2e",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: responseText,
            },
          },
        ],
        usage: {
          prompt_tokens: 24,
          completion_tokens: 11,
          total_tokens: 35,
        },
      });
      return;
    }

    writeJsonResponse(response, 404, {
      error: `Unhandled assistant provider stub route: ${request.method ?? "GET"} ${request.url ?? "/"}`,
    });
  });

  await listenStubServer(server);
  return server;
}

export async function stopHttpStubServer(
  server: ReturnType<typeof createServer> | null,
): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

export async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export function resolveHostedAssistantLocalDevEnv(
  source: NodeJS.ProcessEnv,
  assistantProviderMode: HostedLocalAssistantProviderMode,
  assistantProviderStubBaseUrl: string | null,
  scenarioLabel: string,
): NodeJS.ProcessEnv {
  const hostedExecutionRunnerTimeoutMs =
    source.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS?.trim() || hostedLocalE2eRunnerTimeoutMs;

  if (assistantProviderMode === "stub") {
    const normalizedAssistantProviderStubBaseUrl = assistantProviderStubBaseUrl?.trim();
    if (!normalizedAssistantProviderStubBaseUrl) {
      throw new Error(`${scenarioLabel} requires an assistant provider stub base URL in stub mode.`);
    }

    return {
      ...buildHostedAssistantStubEnvClearances(),
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: hostedExecutionRunnerTimeoutMs,
      [HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV]:
        normalizedAssistantProviderStubBaseUrl,
      NODE_ENV: "test",
      OPENAI_API_KEY: "stub-local-openai-key",
    };
  }

  const provider = source.HOSTED_ASSISTANT_PROVIDER?.trim();
  const model = source.HOSTED_ASSISTANT_MODEL?.trim();

  if (!provider || !model) {
    throw new Error(
      [
        `${scenarioLabel} requires explicit hosted assistant config in live mode.`,
        "Set HOSTED_ASSISTANT_PROVIDER and HOSTED_ASSISTANT_MODEL before enabling live mode.",
      ].join(" "),
    );
  }

  return {
    HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: hostedExecutionRunnerTimeoutMs,
  };
}

function buildHostedAssistantStubEnvClearances(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of HOSTED_LOCAL_ASSISTANT_STUB_CLEARED_ENV_KEYS) {
    env[key] = undefined;
  }
  return env;
}

export function buildHostedLocalDeviceSyncProviderEnvClearances(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of HOSTED_LOCAL_DEVICE_SYNC_PROVIDER_CLEARED_ENV_KEYS) {
    env[key] = "";
  }
  return env;
}

export function resolveHostedLocalSmokeWebEnv(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION:
      source.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION
      ?? hostedWebSmokeDefaultEncryptionKeyVersion,
    HOSTED_CONTACT_PRIVACY_KEYS:
      source.HOSTED_CONTACT_PRIVACY_KEYS
      ?? `v1:${hostedWebSmokeDefaultEncryptionKey}`,
    HOSTED_WEB_ENCRYPTION_KEY:
      source.HOSTED_WEB_ENCRYPTION_KEY
      ?? hostedWebSmokeDefaultEncryptionKey,
    HOSTED_WEB_ENCRYPTION_KEY_VERSION:
      source.HOSTED_WEB_ENCRYPTION_KEY_VERSION
      ?? hostedWebSmokeDefaultEncryptionKeyVersion,
    HOSTED_WAKE_ENCRYPTION_KEY:
      source.HOSTED_WAKE_ENCRYPTION_KEY
      ?? hostedWebSmokeDefaultEncryptionKey,
    HOSTED_WAKE_ENCRYPTION_KEY_VERSION:
      source.HOSTED_WAKE_ENCRYPTION_KEY_VERSION
      ?? hostedWebSmokeDefaultEncryptionKeyVersion,
  };
}

export function resolveHostedAssistantProviderMode(
  source: NodeJS.ProcessEnv,
): HostedLocalAssistantProviderMode {
  const explicitMode = source.MURPH_E2E_ASSISTANT_PROVIDER_MODE?.trim().toLowerCase();
  if (explicitMode === "stub" || explicitMode === "live") {
    return explicitMode;
  }

  if (explicitMode) {
    throw new Error(
      `Unsupported hosted local assistant provider mode: ${source.MURPH_E2E_ASSISTANT_PROVIDER_MODE}`,
    );
  }

  const legacyStub = source.MURPH_E2E_STUB_ASSISTANT_PROVIDER?.trim();
  if (legacyStub) {
    return legacyStub === "0" ? "live" : "stub";
  }

  return "stub";
}

export function buildStableNumericSuffix(value: string, length: number): string {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % 10_000_000;
  }

  return String(hash).padStart(length, "0").slice(-length);
}

export function mergeRequiredEnvProfile(
  existingProfiles: string | undefined,
  requiredProfile: string,
): string {
  const profiles = new Set(
    [
      defaultHostedRunnerEnvProfiles.join(","),
      existingProfiles,
    ]
      .filter((entry): entry is string => typeof entry === "string")
      .join(",")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  profiles.add(requiredProfile);
  return Array.from(profiles).join(",");
}

export function requireBoundTcpPort(
  server: ReturnType<typeof createServer>,
  label: string,
): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`Expected the ${label} server to bind a TCP port.`);
  }

  return address.port;
}

export function buildHostLoopbackStubBaseUrl(
  server: ReturnType<typeof createServer>,
  label: string,
): string {
  return `http://127.0.0.1:${requireBoundTcpPort(server, label)}`;
}

export async function reserveLocalTcpPort(): Promise<number> {
  const server = createNetServer();

  return await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected a local TCP port reservation."));
        return;
      }

      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function listenStubServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
