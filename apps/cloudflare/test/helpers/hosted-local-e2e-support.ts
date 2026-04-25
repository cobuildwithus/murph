import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";

const hostedWebSmokeDefaultEncryptionKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const hostedWebSmokeDefaultEncryptionKeyVersion = "v1";
const hostedLocalE2eRunnerTimeoutMs = "240000";
const defaultHostedRunnerEnvProfiles = [
  "assistant",
  "parsers",
  "web",
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
  responseText: string;
}): Record<string, unknown> {
  return {
    created_at: Math.floor(Date.now() / 1000),
    id: "resp_stub_hosted_local_e2e",
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

export async function startAssistantProviderStubServer(input: {
  fallbackResponseText?: string | null;
  modelId?: string;
  onRequest?: (request: HostedLocalAssistantProviderStubRequest) => void;
  responseState?: HostedLocalAssistantProviderStubState;
} = {}): Promise<ReturnType<typeof createServer>> {
  const modelId = input.modelId ?? "stub-openrouter-model";

  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    const requestRecord = {
      body,
      method: request.method ?? "GET",
      url: request.url ?? "/",
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

      writeJsonResponse(
        response,
        200,
        buildAssistantProviderResponsesApiStubResponse({
          modelId,
          responseText,
        }),
      );
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
    if (!assistantProviderStubBaseUrl) {
      throw new Error(
        `${scenarioLabel} requires a stub assistant provider base URL in stub mode.`,
      );
    }

    return {
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
      HOSTED_ASSISTANT_BASE_URL: assistantProviderStubBaseUrl,
      HOSTED_ASSISTANT_MODEL: "stub-openrouter-model",
      HOSTED_ASSISTANT_PROVIDER: "openrouter",
      HOSTED_ASSISTANT_PROVIDER_NAME: "local-openrouter-stub",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: hostedExecutionRunnerTimeoutMs,
      OPENAI_API_KEY: "stub-local-openrouter-key",
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
    String(
      existingProfiles
      ?? defaultHostedRunnerEnvProfiles.join(","),
    )
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
