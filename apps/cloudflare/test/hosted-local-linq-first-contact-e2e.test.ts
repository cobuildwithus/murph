import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionMemberActivatedDispatch,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionDispatchResult,
} from "@murphai/hosted-execution/parsers";
import {
  startHostedLocalDevHarness,
  type HostedLocalDevHarness,
} from "./helpers/hosted-local-dev-harness.js";

interface ObservedLinqRequest {
  body: string;
  method: string;
  url: string;
}

const userId = `member_local_linq_first_contact_${Date.now()}`;
const directReplyUserId = `member_local_linq_direct_reply_${Date.now()}`;

const observedLinqRequests: ObservedLinqRequest[] = [];
const devEnv: NodeJS.ProcessEnv = {
  ...process.env,
  MURPH_DEV_CF_WRANGLER_LOG_LEVEL: "debug",
  MURPH_DEV_SKIP_PRISMA_MIGRATE: "1",
  MURPH_DEV_SKIP_WEB: "1",
  MURPH_DEV_WEB_PORT: "3213",
  MURPH_DEV_WORKER_PORT: "8902",
  NEXT_DIST_DIR_MODE: "smoke",
};
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const debugE2E = process.env.MURPH_E2E_DEBUG_PROGRESS === "1";
const useAssistantProviderStub = process.env.MURPH_E2E_STUB_ASSISTANT_PROVIDER !== "0";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const expectedLinqChatPath = `/chats/${encodeURIComponent(`chat:${userId}`)}/messages`;
const expectedDirectReplyChatPath = `/chats/${encodeURIComponent(`chat:${directReplyUserId}`)}/messages`;

let linqServer: ReturnType<typeof createServer> | null = null;
let linqServerBaseUrl = "";
let assistantProviderServer: ReturnType<typeof createServer> | null = null;
let assistantProviderBaseUrl = "";
let localHarness: HostedLocalDevHarness | null = null;
let workerBaseUrl = "";
let workerPersistDir: string | null = null;

describe("hosted local Linq first-contact e2e", () => {
  beforeAll(async () => {
    logDebug("starting hosted local Linq e2e setup");
    observedLinqRequests.length = 0;
    linqServer = await startLinqStubServer();
    const address = linqServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected the Linq stub server to bind a TCP port.");
    }
    linqServerBaseUrl = `http://127.0.0.1:${address.port}`;
    logDebug("started Linq stub server", { linqServerBaseUrl });
    if (useAssistantProviderStub) {
      assistantProviderServer = await startAssistantProviderStubServer();
      const providerAddress = assistantProviderServer.address();
      if (!providerAddress || typeof providerAddress === "string") {
        throw new Error("Expected the assistant provider stub server to bind a TCP port.");
      }
      assistantProviderBaseUrl = `http://host.docker.internal:${providerAddress.port}/v1`;
      logDebug("started assistant provider stub server", {
        assistantProviderBaseUrl,
      });
    }
    const hostedAssistantDevEnv = resolveHostedAssistantLocalDevEnv(
      process.env,
      useAssistantProviderStub ? assistantProviderBaseUrl : null,
    );
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...devEnv,
      ...hostedAssistantDevEnv,
      LINQ_API_BASE_URL: linqServerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
    };
    localHarness = await startHostedLocalDevHarness({
      env: runtimeEnv,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-linq-first-contact-",
      statusHeaders: (nextUserId: string) => ({
        [HOSTED_EXECUTION_USER_ID_HEADER]: nextUserId,
      }),
      statusPath: (nextUserId: string) => `/internal/users/${encodeURIComponent(nextUserId)}/status`,
      streamLogs: streamDevLogs,
    });
    workerBaseUrl = localHarness.workerBaseUrl;
    workerPersistDir = localHarness.persistDir;
    logDebug("cloudflare worker healthy", {
      workerBaseUrl,
      workerPersistDir,
    });
  }, 300_000);

  afterAll(async () => {
    logDebug("tearing down hosted local Linq e2e");
    await localHarness?.stop();
    localHarness = null;

    await stopLinqStubServer(linqServer);
    await stopAssistantProviderStubServer(assistantProviderServer);
  });

  it("sends the first-contact Linq welcome through the live local worker", async () => {
    logDebug("dispatching activation", { userId });
    const dispatchResult = await dispatchHostedEvent(buildActivationDispatch(userId), userId);
    expect(dispatchResult.event).toMatchObject({
      eventId: `member.activated:local:${userId}:evt_linq_first_contact`,
      lastError: null,
      state: "completed",
      userId,
    });

    const finalStatus = await requireHarness().waitForHostedCompletion(userId);
    logDebug("activation completed", { userId, finalStatus });
    expect(finalStatus.bundleRef).not.toBeNull();
    expect(finalStatus.lastError).toBeNull();
    expect(finalStatus.pendingEventCount).toBe(0);

    const sendRequest = await waitForLinqSend({
      expectedPath: expectedLinqChatPath,
      userId,
    });
    expect(sendRequest.method).toBe("POST");
    expect(sendRequest.url).toBe(expectedLinqChatPath);
    expect(JSON.parse(sendRequest.body)).toMatchObject({
      message: {
        idempotency_key: expect.stringContaining("assistant-first-contact"),
        parts: [
          {
            type: "text",
            value: expect.stringContaining("Murph"),
          },
        ],
      },
    });
  }, 300_000);

  it("sends a Linq reply after a later inbound Linq message", async () => {
    logDebug("dispatching direct-reply activation", { userId: directReplyUserId });
    const activationResult = await dispatchHostedEvent(
      buildActivationDispatch(directReplyUserId),
      directReplyUserId,
    );
    expect(activationResult.event).toMatchObject({
      eventId: `member.activated:local:${directReplyUserId}:evt_linq_first_contact`,
      lastError: null,
      state: "completed",
      userId: directReplyUserId,
    });

    await requireHarness().waitForHostedCompletion(directReplyUserId);
    logDebug("direct-reply activation completed", { userId: directReplyUserId });
    await waitForLinqSend({
      expectedPath: expectedDirectReplyChatPath,
      userId: directReplyUserId,
    });

    const outboundCountBeforeReply = countObservedLinqSends(expectedDirectReplyChatPath);
    logDebug("dispatching later inbound Linq message", {
      baselineSendCount: outboundCountBeforeReply,
      userId: directReplyUserId,
    });
    const inboundDispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: `linq.message.received:local:${directReplyUserId}:evt_direct_reply`,
      linqEvent: buildInboundLinqEvent(directReplyUserId),
      linqMessageId: `msg_local_${directReplyUserId}`,
      occurredAt: new Date().toISOString(),
      phoneLookupKey: directReplyUserId,
      userId: directReplyUserId,
    });
    const inboundResult = await dispatchHostedEvent(inboundDispatch, directReplyUserId);
    expect(inboundResult.event).toMatchObject({
      eventId: `linq.message.received:local:${directReplyUserId}:evt_direct_reply`,
      lastError: null,
      state: "completed",
      userId: directReplyUserId,
    });

    await requireHarness().waitForHostedCompletion(directReplyUserId);
    logDebug("later inbound Linq message completed", { userId: directReplyUserId });
    const replySend = await waitForAdditionalLinqSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedDirectReplyChatPath,
      userId: directReplyUserId,
    });
    expect(replySend.method).toBe("POST");
  }, 300_000);

  async function dispatchHostedEvent(dispatch: object, nextUserId: string) {
    logDebug("POST /internal/dispatch", {
      eventId:
        typeof dispatch === "object" && dispatch !== null && "eventId" in dispatch
          ? (dispatch as { eventId?: unknown }).eventId
          : null,
      userId: nextUserId,
    });
    const response = await requireHarness().requestJson("/internal/dispatch", {
      body: JSON.stringify(dispatch),
      headers: {
        "content-type": "application/json; charset=utf-8",
        [HOSTED_EXECUTION_USER_ID_HEADER]: nextUserId,
      },
      method: "POST",
    });

    const parsed = parseHostedExecutionDispatchResult(response);
    logDebug("dispatch completed", {
      eventId: parsed.event.eventId,
      state: parsed.event.state,
      userId: nextUserId,
    });
    return parsed;
  }

async function waitForLinqSend(input: {
    expectedPath: string;
    userId: string;
  }): Promise<ObservedLinqRequest> {
    const startedAt = Date.now();
    let nextProgressLogAt = startedAt;

    while ((Date.now() - startedAt) < 30_000) {
      const sendRequest = observedLinqRequests.find((request) =>
        request.method === "POST"
        && request.url === input.expectedPath
      );

      if (sendRequest) {
        logDebug("observed first Linq send", {
          elapsedMs: Date.now() - startedAt,
          expectedPath: input.expectedPath,
          userId: input.userId,
        });
        return sendRequest;
      }

      if (Date.now() >= nextProgressLogAt) {
        logDebug("waiting for first Linq send", {
          elapsedMs: Date.now() - startedAt,
          expectedPath: input.expectedPath,
          observedSendCount: countObservedLinqSends(input.expectedPath),
          userId: input.userId,
        });
        nextProgressLogAt = Date.now() + 5_000;
      }

      await sleep(250);
    }

    const status = await requireHarness().readUserStatus(input.userId);
    throw new Error([
      `Timed out waiting for a Linq send for ${input.userId}.`,
      `observed requests: ${JSON.stringify(observedLinqRequests)}`,
      `hosted status: ${JSON.stringify(status)}`,
      `stdout tail: ${requireHarness().stdoutTail()}`,
      `stderr tail: ${requireHarness().stderrTail()}`,
    ].join("\n"));
  }

async function waitForAdditionalLinqSend(input: {
    baselineCount: number;
    expectedPath: string;
    userId: string;
  }): Promise<ObservedLinqRequest> {
    const startedAt = Date.now();
    let nextProgressLogAt = startedAt;

    while ((Date.now() - startedAt) < 60_000) {
      const matchingRequests = observedLinqRequests.filter((request) =>
        request.method === "POST"
        && request.url === input.expectedPath
      );

      if (matchingRequests.length > input.baselineCount) {
        const newest = matchingRequests.at(-1);
        if (newest) {
          logDebug("observed additional Linq send", {
            baselineCount: input.baselineCount,
            elapsedMs: Date.now() - startedAt,
            expectedPath: input.expectedPath,
            userId: input.userId,
          });
          return newest;
        }
      }

      if (Date.now() >= nextProgressLogAt) {
        logDebug("waiting for additional Linq send", {
          baselineCount: input.baselineCount,
          elapsedMs: Date.now() - startedAt,
          expectedPath: input.expectedPath,
          matchingRequestCount: matchingRequests.length,
          userId: input.userId,
        });
        nextProgressLogAt = Date.now() + 5_000;
      }

      await sleep(250);
    }

    const status = await requireHarness().readUserStatus(input.userId);
    throw new Error([
      `Timed out waiting for an additional Linq send for ${input.userId}.`,
      `observed requests: ${JSON.stringify(observedLinqRequests)}`,
      `hosted status: ${JSON.stringify(status)}`,
      `stdout tail: ${requireHarness().stdoutTail()}`,
      `stderr tail: ${requireHarness().stderrTail()}`,
    ].join("\n"));
  }
});

function requireHarness(): HostedLocalDevHarness {
  if (!localHarness) {
    throw new Error("Hosted local harness was not initialized.");
  }

  return localHarness;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function logDebug(message: string, details?: Record<string, unknown>): void {
  if (!debugE2E) {
    return;
  }

  const payload = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[hosted-local-linq-e2e] ${message}${payload}`);
}

function buildActivationDispatch(nextUserId: string) {
  return buildHostedExecutionMemberActivatedDispatch({
    eventId: `member.activated:local:${nextUserId}:evt_linq_first_contact`,
    firstContact: {
      channel: "linq",
      identityId: `linq:${nextUserId}`,
      threadId: `chat:${nextUserId}`,
      threadIsDirect: true,
    },
    memberId: nextUserId,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    occurredAt: new Date().toISOString(),
  });
}

function buildInboundLinqEvent(nextUserId: string) {
  return {
    api_version: "v3",
    created_at: new Date().toISOString(),
    data: {
      chat: {
        id: `chat:${nextUserId}`,
        is_group: false,
        owner_handle: {
          handle: "+15555559876",
          id: `handle_owner_${nextUserId}`,
          is_me: true,
          service: "SMS",
        },
      },
      chat_id: `chat:${nextUserId}`,
      direction: "inbound",
      from: "+15555550123",
      from_handle: {
        handle: "+15555550123",
        id: `handle_sender_${nextUserId}`,
        service: "SMS",
      },
      is_from_me: false,
      message: {
        id: `msg_local_${nextUserId}`,
        parts: [
          {
            type: "text",
            value: "hello mate",
          },
        ],
      },
      recipient_handle: {
        handle: "+15555559876",
        id: `handle_owner_${nextUserId}`,
        is_me: true,
        service: "SMS",
      },
      recipient_phone: "+15555559876",
      received_at: new Date().toISOString(),
      sender_handle: {
        handle: "+15555550123",
        id: `handle_sender_${nextUserId}`,
        service: "SMS",
      },
      service: "SMS",
      sent_at: new Date().toISOString(),
    },
    event_id: `evt_linq_inbound_${nextUserId}`,
    event_type: "message.received",
  };
}

function countObservedLinqSends(expectedPath: string): number {
  return observedLinqRequests.filter((request) =>
    request.method === "POST"
    && request.url === expectedPath
  ).length;
}

async function startLinqStubServer(): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    observedLinqRequests.push({
      body,
      method: request.method ?? "GET",
      url: request.url ?? "/",
    });

    if (
      request.method === "POST"
      && request.url
      && /^\/chats\/[^/]+\/messages$/u.test(request.url)
    ) {
      writeJsonResponse(response, 200, {
        data: {
          id: `linq_msg_${Date.now()}`,
          chat_id: request.url.split("/")[2],
        },
      });
      return;
    }

    writeJsonResponse(response, 200, { ok: true });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => resolve());
  });

  return server;
}

async function stopLinqStubServer(server: ReturnType<typeof createServer> | null): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function startAssistantProviderStubServer(): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (request, response) => {
    await readRequestBody(request);

    if (request.method === "GET" && request.url === "/v1/models") {
      writeJsonResponse(response, 200, {
        data: [
          {
            id: "stub-openrouter-model",
          },
        ],
      });
      return;
    }

    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      writeJsonResponse(response, 200, {
        id: "chatcmpl_stub_linq_reply",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "stub-openrouter-model",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "Got it — I saw your message and I’m here.",
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

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

async function stopAssistantProviderStubServer(
  server: ReturnType<typeof createServer> | null,
): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function resolveHostedAssistantLocalDevEnv(
  source: NodeJS.ProcessEnv,
  assistantProviderStubBaseUrl: string | null,
): NodeJS.ProcessEnv {
  if (assistantProviderStubBaseUrl) {
    return {
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
      HOSTED_ASSISTANT_BASE_URL: assistantProviderStubBaseUrl,
      HOSTED_ASSISTANT_MODEL: "stub-openrouter-model",
      HOSTED_ASSISTANT_PROVIDER: "openrouter",
      HOSTED_ASSISTANT_PROVIDER_NAME: "local-openrouter-stub",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
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
    };
  }

  throw new Error(
    [
      "Local hosted Linq e2e requires explicit hosted assistant config.",
      "Set HOSTED_ASSISTANT_PROVIDER and HOSTED_ASSISTANT_MODEL, or provide OPENAI_API_KEY for the local fallback profile.",
    ].join(" "),
  );
}
