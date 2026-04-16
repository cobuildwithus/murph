import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionDispatchResult,
} from "@murphai/hosted-execution/parsers";
import {
  startHostedLocalDevHarness,
  type HostedLocalDevHarness,
} from "./helpers/hosted-local-dev-harness.js";
import {
  startHostedLocalOidcFixture,
  type HostedLocalOidcFixture,
} from "./helpers/hosted-local-oidc-support.js";
import {
  buildHostLoopbackStubBaseUrl,
  readRequestBody,
  reserveLocalTcpPort,
  resolveHostedAssistantLocalDevEnv,
  shouldUseAssistantProviderStub,
  startAssistantProviderStubServer,
  stopHttpStubServer,
  writeJsonResponse,
} from "./helpers/hosted-local-e2e-support.js";

interface ObservedTelegramRequest {
  body: string;
  method: string;
  url: string;
}

type ObservedTelegramRequestMatcher = (request: ObservedTelegramRequest) => boolean;

const userId = `member_local_telegram_reply_${Date.now()}`;
const fastReplyUserId = `member_local_telegram_fast_reply_${Date.now()}`;
const telegramBotToken = "telegram-local-test-token";
const observedTelegramRequests: ObservedTelegramRequest[] = [];
const observedAssistantProviderBodies: string[] = [];
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const debugE2E = process.env.MURPH_E2E_DEBUG_PROGRESS === "1";
const telegramDebugLogFile = process.env.MURPH_E2E_TELEGRAM_DEBUG_LOG_FILE?.trim() || null;
const useAssistantProviderStub = shouldUseAssistantProviderStub(process.env);
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;

let telegramServer: ReturnType<typeof createServer> | null = null;
let telegramApiBaseUrl = "";
let assistantProviderServer: ReturnType<typeof createServer> | null = null;
let assistantProviderBaseUrl = "";
let localHarness: HostedLocalDevHarness | null = null;
let oidcFixture: HostedLocalOidcFixture | null = null;

it("derives stable numeric suffixes from the full Telegram user id", () => {
  expect(buildStableTelegramNumericSuffix("member_local_telegram_reply_20260408", 7)).not.toBe(
    buildStableTelegramNumericSuffix("member_local_telegram_fast_reply_20260408", 7),
  );
});

describe("hosted local Telegram auto-reply e2e", () => {
  beforeAll(async () => {
    logDebug("starting hosted local Telegram e2e setup");
    observedTelegramRequests.length = 0;
    observedAssistantProviderBodies.length = 0;
    telegramServer = await startTelegramStubServer();
    telegramApiBaseUrl = buildHostLoopbackStubBaseUrl(telegramServer, "Telegram stub");
    logDebug("started Telegram stub server", { telegramApiBaseUrl });

    if (useAssistantProviderStub) {
      assistantProviderServer = await startAssistantProviderStubServer({
        onRequestBody: (body) => {
          observedAssistantProviderBodies.push(body);
        },
        resolveMessageText: resolveHostedTelegramAssistantReplyText,
      });
      assistantProviderBaseUrl =
        `${buildHostLoopbackStubBaseUrl(assistantProviderServer, "assistant provider stub")}/v1`;
      logDebug("started assistant provider stub server", {
        assistantProviderBaseUrl,
      });
    }
    oidcFixture = await startHostedLocalOidcFixture();

    const hostedAssistantDevEnv = resolveHostedAssistantLocalDevEnv(
      process.env,
      useAssistantProviderStub ? assistantProviderBaseUrl : null,
      "Local hosted Telegram e2e",
    );
    const workerListenHost = resolveHostedLocalWorkerListenHost();
    const webPort = await reserveLocalTcpPort();
    const workerPort = await reserveLocalTcpPort();
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...hostedAssistantDevEnv,
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: mergeRunnerEnvProfiles(
        process.env.HOSTED_EXECUTION_RUNNER_ENV_PROFILES,
        "telegram",
      ),
      HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: requireOidcFixture().jwksUrl,
      MURPH_DEV_CF_WRANGLER_LOG_LEVEL: "debug",
      MURPH_DEV_SKIP_PRISMA_MIGRATE: "1",
      MURPH_DEV_SKIP_WEB: "1",
      MURPH_DEV_WEB_PORT: String(webPort),
      ...(workerListenHost ? { MURPH_DEV_WORKER_HOST: workerListenHost } : {}),
      MURPH_DEV_WORKER_PORT: String(workerPort),
      NEXT_DIST_DIR_MODE: "smoke",
      TELEGRAM_API_BASE_URL: telegramApiBaseUrl,
      TELEGRAM_BOT_TOKEN: telegramBotToken,
      VERCEL_OIDC_TOKEN: requireOidcFixture().token,
    };

    localHarness = await startHostedLocalDevHarness({
      env: runtimeEnv,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-telegram-first-contact-",
      statusHeaders: (nextUserId: string) => ({
        [HOSTED_EXECUTION_USER_ID_HEADER]: nextUserId,
      }),
      statusPath: (nextUserId: string) => `/internal/users/${encodeURIComponent(nextUserId)}/status`,
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  afterAll(async () => {
    logDebug("tearing down hosted local Telegram e2e");
    await localHarness?.stop();
    localHarness = null;
    await oidcFixture?.stop();
    oidcFixture = null;
    await stopHttpStubServer(telegramServer);
    await stopHttpStubServer(assistantProviderServer);
  });

  it("sends Telegram typing and a reply after an inbound Telegram message", async () => {
    const activationResult = await dispatchHostedEvent(buildActivationDispatch(userId), userId);
    expect(activationResult.event).toMatchObject({
      eventId: `member.activated:local:${userId}:evt_telegram_activation`,
      lastError: null,
      state: "completed",
      userId,
    });

    await requireHarness().waitForHostedCompletion(userId);
    logDebug("activation completed", { userId });

    const requestCountBeforeInbound = observedTelegramRequests.length;
    const inboundResult = await dispatchHostedEvent(buildInboundTelegramDispatch(userId), userId);
    expect(inboundResult.event).toMatchObject({
      eventId: `telegram.message.received:local:${userId}:evt_telegram_reply`,
      lastError: null,
      state: "completed",
      userId,
    });

    const finalStatus = await requireHarness().waitForHostedCompletion(userId);
    expect(finalStatus.bundleRef).not.toBeNull();
    expect(finalStatus.lastError).toBeNull();
    expect(finalStatus.pendingEventCount).toBe(0);

    await waitForTelegramRequest({
      expectedPath: `/bot${telegramBotToken}/sendChatAction`,
      matchRequest: createTelegramTypingRequestMatcher(userId),
      userId,
    });
    const sendRequest = await waitForTelegramRequest({
      expectedPath: `/bot${telegramBotToken}/sendMessage`,
      matchRequest: createTelegramSendMessageMatcher(userId),
      userId,
    });

    const requestsAfterInbound = observedTelegramRequests.slice(requestCountBeforeInbound);
    const typingRequestsAfterInbound = requestsAfterInbound.filter((request) =>
      isMatchingObservedTelegramRequest(
        request,
        `/bot${telegramBotToken}/sendChatAction`,
        createTelegramTypingRequestMatcher(userId),
      )
    );

    expect(sendRequest.method).toBe("POST");
    expect(typingRequestsAfterInbound).toHaveLength(2);
    expect(typingRequestsAfterInbound.map((request) => request.method)).toEqual(["POST", "POST"]);

    const sendIndex = requestsAfterInbound.indexOf(sendRequest);
    const typingIndices = typingRequestsAfterInbound.map((request) =>
      requestsAfterInbound.indexOf(request)
    );
    expect(sendIndex).toBeGreaterThanOrEqual(0);
    expect(typingIndices[0]).toBeGreaterThanOrEqual(0);
    expect(typingIndices[1]).toBeGreaterThan(typingIndices[0]);
    expect(sendIndex).toBeGreaterThan(typingIndices[1]);

    expect(parseObservedTelegramJson(sendRequest.body)).toMatchObject({
      chat_id: buildTelegramThreadId(userId),
      reply_to_message_id: Number.parseInt(buildTelegramMessageId(userId), 10),
      text: expect.stringContaining("Telegram"),
    });
  }, 300_000);

  it("keeps Telegram context when two replies arrive before hosted completion catches up", async () => {
    const activationResult = await dispatchHostedEvent(buildActivationDispatch(fastReplyUserId), fastReplyUserId);
    expect(activationResult.event).toMatchObject({
      eventId: `member.activated:local:${fastReplyUserId}:evt_telegram_activation`,
      lastError: null,
      state: "completed",
      userId: fastReplyUserId,
    });

    await requireHarness().waitForHostedCompletion(fastReplyUserId);

    const expectedSendPath = `/bot${telegramBotToken}/sendMessage`;
    const baselineSendCount = countObservedTelegramRequests(
      expectedSendPath,
      createTelegramSendMessageMatcher(fastReplyUserId),
    );

    const firstInboundResult = await dispatchHostedEvent(
      buildInboundTelegramDispatch(fastReplyUserId, {
        eventId: `telegram.message.received:local:${fastReplyUserId}:evt_telegram_name`,
        messageId: `${buildTelegramMessageId(fastReplyUserId)}1`,
        text: "U can call me Rocket Man",
      }),
      fastReplyUserId,
    );
    expect(firstInboundResult.event).toMatchObject({
      eventId: `telegram.message.received:local:${fastReplyUserId}:evt_telegram_name`,
      lastError: null,
      state: "completed",
      userId: fastReplyUserId,
    });

    const secondInboundResult = await dispatchHostedEvent(
      buildInboundTelegramDispatch(fastReplyUserId, {
        eventId: `telegram.message.received:local:${fastReplyUserId}:evt_telegram_goals`,
        messageId: `${buildTelegramMessageId(fastReplyUserId)}2`,
        text: "I want to build more strength, improve endurance, and get fitter overall.",
      }),
      fastReplyUserId,
    );
    expect(secondInboundResult.event).toMatchObject({
      eventId: `telegram.message.received:local:${fastReplyUserId}:evt_telegram_goals`,
      lastError: null,
      state: "completed",
      userId: fastReplyUserId,
    });

    await requireHarness().waitForHostedCompletion(fastReplyUserId);

    const replyRequests = await waitForMatchingTelegramRequestCount({
      expectedCount: baselineSendCount + 2,
      expectedPath: expectedSendPath,
      matchRequest: createTelegramSendMessageMatcher(fastReplyUserId),
      userId: fastReplyUserId,
    });
    const replyTexts = replyRequests
      .slice(-2)
      .map((request) => parseObservedTelegramJson(request.body)?.text);

    expect(replyTexts).toEqual([
      "Got it — I’ll call you Rocket Man.\n\nWhat are your health goals right now?",
      "Got you — stronger, fitter, faster, and more endurance.",
    ]);
    expect(observedAssistantProviderBodies.at(-1)).toContain("Rocket Man");
    expect(observedAssistantProviderBodies.at(-1)).toContain("build more strength");
    expect(observedAssistantProviderBodies.at(-1)).toContain("I’ll call you Rocket Man");
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
});

function requireHarness(): HostedLocalDevHarness {
  if (!localHarness) {
    throw new Error("Hosted local harness was not initialized.");
  }

  return localHarness;
}

function requireOidcFixture(): HostedLocalOidcFixture {
  if (!oidcFixture) {
    throw new Error("Hosted local OIDC fixture was not initialized.");
  }

  return oidcFixture;
}

function logDebug(message: string, details?: Record<string, unknown>): void {
  if (!debugE2E) {
    return;
  }

  const payload = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[hosted-local-telegram-e2e] ${message}${payload}`);
}

function buildActivationDispatch(nextUserId: string) {
  return buildHostedExecutionMemberActivatedDispatch({
    eventId: `member.activated:local:${nextUserId}:evt_telegram_activation`,
    memberId: nextUserId,
    memberChannels: {
      email: false,
      linq: false,
      telegram: true,
    },
    occurredAt: new Date().toISOString(),
  });
}

function buildInboundTelegramDispatch(
  nextUserId: string,
  overrides: {
    eventId?: string;
    messageId?: string;
    text?: string;
  } = {},
) {
  return buildHostedExecutionTelegramMessageReceivedDispatch({
    eventId:
      overrides.eventId
      ?? `telegram.message.received:local:${nextUserId}:evt_telegram_reply`,
    occurredAt: new Date().toISOString(),
    telegramMessage: {
      messageId: overrides.messageId ?? buildTelegramMessageId(nextUserId),
      schema: "murph.hosted-telegram-message.v1",
      text: overrides.text ?? "yo",
      threadId: buildTelegramThreadId(nextUserId),
    },
    userId: nextUserId,
  });
}

function createTelegramTypingRequestMatcher(nextUserId: string): ObservedTelegramRequestMatcher {
  return (request) => {
    const parsed = parseObservedTelegramJson(request.body);
    return Boolean(
      parsed
      && parsed.action === "typing"
      && parsed.chat_id === buildTelegramThreadId(nextUserId),
    );
  };
}

function createTelegramSendMessageMatcher(nextUserId: string): ObservedTelegramRequestMatcher {
  const expectedMessageIdPrefix = buildTelegramMessageId(nextUserId);

  return (request) => {
    const parsed = parseObservedTelegramJson(request.body);
    const replyToMessageId =
      parsed && "reply_to_message_id" in parsed
        ? parsed.reply_to_message_id
        : null;

    return Boolean(
      parsed
      && parsed.chat_id === buildTelegramThreadId(nextUserId)
      && (
        typeof replyToMessageId === "number"
          ? String(replyToMessageId).startsWith(expectedMessageIdPrefix)
          : false
      )
      && typeof parsed.text === "string"
      && parsed.text.length > 0,
    );
  };
}

async function waitForTelegramRequest(input: {
  expectedPath: string;
  matchRequest?: ObservedTelegramRequestMatcher;
  userId: string;
}): Promise<ObservedTelegramRequest> {
  const startedAt = Date.now();
  let nextProgressLogAt = startedAt;

  while ((Date.now() - startedAt) < 60_000) {
    const matchingRequest = observedTelegramRequests.find((request) =>
      isMatchingObservedTelegramRequest(request, input.expectedPath, input.matchRequest)
    );
    if (matchingRequest) {
      logDebug("observed Telegram request", {
        elapsedMs: Date.now() - startedAt,
        expectedPath: input.expectedPath,
        userId: input.userId,
      });
      return matchingRequest;
    }

    if (Date.now() >= nextProgressLogAt) {
      logDebug("waiting for Telegram request", {
        elapsedMs: Date.now() - startedAt,
        expectedPath: input.expectedPath,
        observedRequests: observedTelegramRequests.map((request) => ({
          method: request.method,
          url: request.url,
        })),
        observedRequestCount: observedTelegramRequests.length,
        userId: input.userId,
      });
      nextProgressLogAt = Date.now() + 5_000;
    }

    await sleep(250);
  }

  const status = await requireHarness().readUserStatus(input.userId);
  throw new Error([
    `Timed out waiting for Telegram request ${input.expectedPath} for ${input.userId}.`,
    `observed requests: ${JSON.stringify(summarizeObservedTelegramRequests())}`,
    `hosted status: ${JSON.stringify(status)}`,
    `stdout tail: ${requireHarness().stdoutTail()}`,
    `stderr tail: ${requireHarness().stderrTail()}`,
  ].join("\n"));
}

async function waitForMatchingTelegramRequestCount(input: {
  expectedCount: number;
  expectedPath: string;
  matchRequest?: ObservedTelegramRequestMatcher;
  userId: string;
}): Promise<ObservedTelegramRequest[]> {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < 60_000) {
    const matching = observedTelegramRequests.filter((request) =>
      isMatchingObservedTelegramRequest(request, input.expectedPath, input.matchRequest)
    );
    if (matching.length >= input.expectedCount) {
      return matching;
    }

    await sleep(250);
  }

  const status = await requireHarness().readUserStatus(input.userId);
  throw new Error([
    `Timed out waiting for ${input.expectedCount} Telegram requests ${input.expectedPath} for ${input.userId}.`,
    `observed requests: ${JSON.stringify(summarizeObservedTelegramRequests())}`,
    `hosted status: ${JSON.stringify(status)}`,
    `stdout tail: ${requireHarness().stdoutTail()}`,
    `stderr tail: ${requireHarness().stderrTail()}`,
  ].join("\n"));
}

function isMatchingObservedTelegramRequest(
  request: ObservedTelegramRequest,
  expectedPath: string,
  matchRequest?: ObservedTelegramRequestMatcher,
): boolean {
  return (
    request.method === "POST"
    && request.url === expectedPath
    && (matchRequest ? matchRequest(request) : true)
  );
}

function parseObservedTelegramJson(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function summarizeObservedTelegramRequests(): Array<{
  body: Record<string, unknown> | null;
  method: string;
  url: string;
}> {
  return observedTelegramRequests.map((request) => ({
    body: parseObservedTelegramJson(request.body),
    method: request.method,
    url: request.url,
  }));
}

function countObservedTelegramRequests(
  expectedPath: string,
  matchRequest?: ObservedTelegramRequestMatcher,
): number {
  return observedTelegramRequests.filter((request) =>
    isMatchingObservedTelegramRequest(request, expectedPath, matchRequest)
  ).length;
}

async function startTelegramStubServer(): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    const observedRequest = {
      body,
      method: request.method ?? "GET",
      url: request.url ?? "/",
    };
    observedTelegramRequests.push(observedRequest);
    await writeTelegramDebugLog({
      body: parseObservedTelegramJson(body),
      method: observedRequest.method,
      url: observedRequest.url,
    });

    if (request.method === "POST" && request.url === `/bot${telegramBotToken}/sendChatAction`) {
      writeJsonResponse(response, 200, {
        ok: true,
        result: true,
      });
      return;
    }

    if (request.method === "POST" && request.url === `/bot${telegramBotToken}/sendMessage`) {
      writeJsonResponse(response, 200, {
        ok: true,
        result: {
          message_id: 9001,
        },
      });
      return;
    }

    writeJsonResponse(response, 404, {
      error: `Unhandled Telegram stub route: ${request.method ?? "GET"} ${request.url ?? "/"}`,
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

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function writeTelegramDebugLog(entry: Record<string, unknown>): Promise<void> {
  if (!telegramDebugLogFile) {
    return;
  }

  await appendFile(telegramDebugLogFile, `${JSON.stringify(entry)}\n`, "utf8");
}

function buildTelegramThreadId(nextUserId: string): string {
  return buildStableTelegramNumericId(nextUserId, "600");
}

function buildTelegramMessageId(nextUserId: string): string {
  return buildStableTelegramNumericId(nextUserId, "700");
}

function buildStableTelegramNumericId(nextUserId: string, prefix: string): string {
  const suffix = buildStableTelegramNumericSuffix(nextUserId, 7);
  return `${prefix}${suffix}`;
}

function buildStableTelegramNumericSuffix(value: string, length: number): string {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % 10_000_000;
  }

  return String(hash).padStart(length, "0").slice(-length);
}

function mergeRunnerEnvProfiles(
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

function resolveHostedLocalWorkerListenHost(): "0.0.0.0" | undefined {
  return process.platform === "linux" ? "0.0.0.0" : undefined;
}

function resolveHostedTelegramAssistantReplyText(body: string): string {
  if (body.includes("Rocket Man") && body.includes("build more strength")) {
    if (body.includes("I’ll call you Rocket Man") || body.includes("I'll call you Rocket Man")) {
      return "Got you — stronger, fitter, faster, and more endurance.";
    }

    return "What should I call you? And out of those, which ones matter most to you right now?";
  }

  if (body.includes("Rocket Man")) {
    return "Got it — I’ll call you Rocket Man.\n\nWhat are your health goals right now?";
  }

  return "I saw your Telegram message and I'm here.";
}
