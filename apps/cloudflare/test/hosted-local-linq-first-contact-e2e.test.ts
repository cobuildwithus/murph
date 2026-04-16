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
import {
  readRequestBody,
  requireBoundTcpPort,
  resolveHostedAssistantLocalDevEnv,
  shouldUseAssistantProviderStub,
  startAssistantProviderStubServer,
  stopHttpStubServer,
  writeJsonResponse,
} from "./helpers/hosted-local-e2e-support.js";

interface ObservedLinqRequest {
  body: string;
  method: string;
  url: string;
}

type ObservedLinqRequestMatcher = (request: ObservedLinqRequest) => boolean;

const userId = `member_local_linq_first_contact_${Date.now()}`;
const directReplyUserId = `member_local_linq_direct_reply_${Date.now()}`;

const observedLinqRequests: ObservedLinqRequest[] = [];
const observedLinqChatIdsByRecipient = new Map<string, string>();
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
const useAssistantProviderStub = shouldUseAssistantProviderStub(process.env);
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const expectedLinqCreateChatPath = "/chats";

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
    observedLinqChatIdsByRecipient.clear();
    linqServer = await startLinqStubServer();
    linqServerBaseUrl = `http://127.0.0.1:${requireBoundTcpPort(linqServer, "Linq stub")}`;
    logDebug("started Linq stub server", { linqServerBaseUrl });
    if (useAssistantProviderStub) {
      assistantProviderServer = await startAssistantProviderStubServer();
      assistantProviderBaseUrl =
        `http://host.docker.internal:${requireBoundTcpPort(assistantProviderServer, "assistant provider stub")}/v1`;
      logDebug("started assistant provider stub server", {
        assistantProviderBaseUrl,
      });
    }
    const hostedAssistantDevEnv = resolveHostedAssistantLocalDevEnv(
      process.env,
      useAssistantProviderStub ? assistantProviderBaseUrl : null,
      "Local hosted Linq e2e",
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

    await stopHttpStubServer(linqServer);
    await stopHttpStubServer(assistantProviderServer);
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
      expectedPath: expectedLinqCreateChatPath,
      matchRequest: createLinqCreateChatRequestMatcher(userId),
      userId,
    });
    expect(requireObservedLinqChatId(userId)).toEqual(expect.any(String));
    expect(sendRequest.method).toBe("POST");
    expect(sendRequest.url).toBe(expectedLinqCreateChatPath);
    expect(JSON.parse(sendRequest.body)).toMatchObject({
      from: buildLinqHomePhoneNumber(userId),
      to: [buildLinqRecipientPhoneNumber(userId)],
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
      expectedPath: expectedLinqCreateChatPath,
      matchRequest: createLinqCreateChatRequestMatcher(directReplyUserId),
      userId: directReplyUserId,
    });

    const materializedChatId = requireObservedLinqChatId(directReplyUserId);
    const expectedDirectReplyChatPath =
      `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply = countObservedLinqSends(expectedDirectReplyChatPath);
    logDebug("dispatching later inbound Linq message", {
      baselineSendCount: outboundCountBeforeReply,
      userId: directReplyUserId,
    });
    const inboundDispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: `linq.message.received:local:${directReplyUserId}:evt_direct_reply`,
      linqEvent: buildInboundLinqEvent(directReplyUserId, materializedChatId),
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
    matchRequest?: ObservedLinqRequestMatcher;
    userId: string;
  }): Promise<ObservedLinqRequest> {
    const startedAt = Date.now();
    let nextProgressLogAt = startedAt;

    while ((Date.now() - startedAt) < 30_000) {
      const sendRequest = observedLinqRequests.find((request) =>
        isMatchingObservedLinqSend(request, input.expectedPath, input.matchRequest)
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
          observedSendCount: countObservedLinqSends(
            input.expectedPath,
            input.matchRequest,
          ),
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
    matchRequest?: ObservedLinqRequestMatcher;
    userId: string;
  }): Promise<ObservedLinqRequest> {
    const startedAt = Date.now();
    let nextProgressLogAt = startedAt;

    while ((Date.now() - startedAt) < 60_000) {
      const matchingRequests = observedLinqRequests.filter((request) =>
        isMatchingObservedLinqSend(request, input.expectedPath, input.matchRequest)
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
      fromPhoneNumber: buildLinqHomePhoneNumber(nextUserId),
      identityId: `linq:${nextUserId}`,
      kind: "linq-materialize-home-thread",
      toPhoneNumber: buildLinqRecipientPhoneNumber(nextUserId),
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

function buildInboundLinqEvent(nextUserId: string, chatId: string) {
  return {
    api_version: "v3",
    created_at: new Date().toISOString(),
    data: {
      chat: {
        id: chatId,
        is_group: false,
        owner_handle: {
          handle: buildLinqHomePhoneNumber(nextUserId),
          id: `handle_owner_${nextUserId}`,
          is_me: true,
          service: "SMS",
        },
      },
      chat_id: chatId,
      direction: "inbound",
      from: buildLinqRecipientPhoneNumber(nextUserId),
      from_handle: {
        handle: buildLinqRecipientPhoneNumber(nextUserId),
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
        handle: buildLinqHomePhoneNumber(nextUserId),
        id: `handle_owner_${nextUserId}`,
        is_me: true,
        service: "SMS",
      },
      recipient_phone: buildLinqHomePhoneNumber(nextUserId),
      received_at: new Date().toISOString(),
      sender_handle: {
        handle: buildLinqRecipientPhoneNumber(nextUserId),
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

function countObservedLinqSends(
  expectedPath: string,
  matchRequest?: ObservedLinqRequestMatcher,
): number {
  return observedLinqRequests.filter((request) =>
    isMatchingObservedLinqSend(request, expectedPath, matchRequest)
  ).length;
}

function isMatchingObservedLinqSend(
  request: ObservedLinqRequest,
  expectedPath: string,
  matchRequest?: ObservedLinqRequestMatcher,
): boolean {
  return (
    request.method === "POST"
    && request.url === expectedPath
    && (matchRequest ? matchRequest(request) : true)
  );
}

function createLinqCreateChatRequestMatcher(nextUserId: string): ObservedLinqRequestMatcher {
  const expectedFrom = buildLinqHomePhoneNumber(nextUserId);
  const expectedTo = buildLinqRecipientPhoneNumber(nextUserId);

  return (request) => {
    const parsed = parseObservedLinqJson(request.body);
    if (!parsed || typeof parsed !== "object") {
      return false;
    }

    const from = "from" in parsed ? parsed.from : null;
    const to = "to" in parsed ? parsed.to : null;
    return (
      from === expectedFrom
      && Array.isArray(to)
      && to[0] === expectedTo
    );
  };
}

function parseObservedLinqJson(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function startLinqStubServer(): Promise<ReturnType<typeof createServer>> {
  let nextObservedChatSequence = 0;

  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    observedLinqRequests.push({
      body,
      method: request.method ?? "GET",
      url: request.url ?? "/",
    });

    if (request.method === "POST" && request.url === "/chats") {
      const parsedBody = JSON.parse(body) as {
        from?: string;
        message?: { parts?: Array<{ type?: string; value?: string }> };
        to?: string[];
      };
      const recipient = parsedBody.to?.[0] ?? "unknown";
      const chatId = `chat_local_${++nextObservedChatSequence}`;
      observedLinqChatIdsByRecipient.set(recipient, chatId);
      writeJsonResponse(response, 200, {
        chat: {
          id: chatId,
          message: {
            id: `linq_msg_${Date.now()}`,
          },
        },
      });
      return;
    }

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

function requireObservedLinqChatId(nextUserId: string): string {
  const recipientPhoneNumber = buildLinqRecipientPhoneNumber(nextUserId);
  const chatId = observedLinqChatIdsByRecipient.get(recipientPhoneNumber);
  if (!chatId) {
    throw new Error(`Expected a materialized Linq chat id for ${nextUserId}.`);
  }

  return chatId;
}

function buildLinqHomePhoneNumber(nextUserId: string): string {
  return buildStableTestPhoneNumber(nextUserId, "598");
}

function buildLinqRecipientPhoneNumber(nextUserId: string): string {
  return buildStableTestPhoneNumber(nextUserId, "501");
}

function buildStableTestPhoneNumber(nextUserId: string, prefix: string): string {
  const digits = nextUserId.replace(/\D/gu, "");
  const suffix = digits.slice(-7).padStart(7, "0");
  return `+1555${prefix}${suffix}`;
}
