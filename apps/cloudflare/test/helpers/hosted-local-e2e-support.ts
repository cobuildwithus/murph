import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";

const hostedWebSmokeDefaultEncryptionKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const hostedWebSmokeDefaultEncryptionKeyVersion = "v1";
const hostedLocalE2eRunnerTimeoutMs = "240000";

export async function startAssistantProviderStubServer(input: {
  messageText?: string;
  modelId?: string;
  onRequestBody?: (body: string) => void;
  resolveMessageText?: (body: string) => string;
} = {}): Promise<ReturnType<typeof createServer>> {
  const messageText = input.messageText ?? "Got it - I saw your message and I'm here.";
  const modelId = input.modelId ?? "stub-openrouter-model";

  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    input.onRequestBody?.(body);

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

    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      const responseText = input.resolveMessageText?.(body) ?? messageText;
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
  assistantProviderStubBaseUrl: string | null,
  scenarioLabel: string,
): NodeJS.ProcessEnv {
  if (assistantProviderStubBaseUrl) {
    return {
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
      HOSTED_ASSISTANT_BASE_URL: assistantProviderStubBaseUrl,
      HOSTED_ASSISTANT_MODEL: "stub-openrouter-model",
      HOSTED_ASSISTANT_PROVIDER: "openrouter",
      HOSTED_ASSISTANT_PROVIDER_NAME: "local-openrouter-stub",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS:
        source.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS?.trim()
        || hostedLocalE2eRunnerTimeoutMs,
      OPENAI_API_KEY: "stub-local-openrouter-key",
    };
  }

  const provider = source.HOSTED_ASSISTANT_PROVIDER?.trim();
  const model = source.HOSTED_ASSISTANT_MODEL?.trim();

  if (provider && model) {
    return {};
  }

  if (source.OPENAI_API_KEY?.trim()) {
    return {
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS:
        source.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS?.trim()
        || hostedLocalE2eRunnerTimeoutMs,
    };
  }

  throw new Error(
    [
      `${scenarioLabel} requires explicit hosted assistant config.`,
      "Set HOSTED_ASSISTANT_PROVIDER and HOSTED_ASSISTANT_MODEL, or provide OPENAI_API_KEY for the local fallback profile.",
    ].join(" "),
  );
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
  };
}

export function shouldUseAssistantProviderStub(source: NodeJS.ProcessEnv): boolean {
  const explicit = source.MURPH_E2E_STUB_ASSISTANT_PROVIDER?.trim();
  if (explicit) {
    return explicit !== "0";
  }

  return !(
    source.HOSTED_ASSISTANT_PROVIDER?.trim()
    && source.HOSTED_ASSISTANT_MODEL?.trim()
  );
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
    String(existingProfiles ?? "")
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
