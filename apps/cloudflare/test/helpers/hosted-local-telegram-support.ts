import { appendFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";

import {
  buildStableNumericSuffix,
  readRequestBody,
  stopHttpStubServer,
  writeJsonResponse,
} from "./hosted-local-e2e-support.js";
import type { HostedLocalFullStackScenario } from "./hosted-local-full-stack-scenario.js";

export interface ObservedTelegramRequest {
  body: string;
  method: string;
  url: string;
}

export type ObservedTelegramRequestMatcher = (request: ObservedTelegramRequest) => boolean;

export interface HostedLocalTelegramStub {
  baseUrl: string;
  countObservedRequests(expectedPath: string, matchRequest?: ObservedTelegramRequestMatcher): number;
  createSendMessageMatcher(userId: string): ObservedTelegramRequestMatcher;
  createTypingMatcher(userId: string): ObservedTelegramRequestMatcher;
  observedRequests: ObservedTelegramRequest[];
  parseObservedJson(body: string): Record<string, unknown> | null;
  stop(): Promise<void>;
  waitForRequest(input: {
    expectedPath: string;
    matchRequest?: ObservedTelegramRequestMatcher;
    scenario: HostedLocalFullStackScenario;
    userId: string;
  }): Promise<ObservedTelegramRequest>;
  waitForRequestsToSettle(input: {
    quietMs?: number;
    scenario: HostedLocalFullStackScenario;
    timeoutMs?: number;
    userId: string;
  }): Promise<void>;
  waitForRequestCount(input: {
    expectedCount: number;
    expectedPath: string;
    matchRequest?: ObservedTelegramRequestMatcher;
    scenario: HostedLocalFullStackScenario;
    userId: string;
  }): Promise<ObservedTelegramRequest[]>;
}

export async function startHostedLocalTelegramStub(input: {
  botToken: string;
  debugLogFile?: string | null;
}): Promise<HostedLocalTelegramStub> {
  const debugLogFile = input.debugLogFile?.trim() || null;
  const observedRequests: ObservedTelegramRequest[] = [];
  let server: HttpServer | null = null;

  server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    const observedRequest = {
      body,
      method: request.method ?? "GET",
      url: request.url ?? "/",
    };
    observedRequests.push(observedRequest);
    await writeTelegramDebugLog(debugLogFile, {
      body: parseObservedTelegramJson(body),
      method: observedRequest.method,
      url: observedRequest.url,
    });

    if (request.method === "POST" && request.url === `/bot${input.botToken}/sendChatAction`) {
      writeJsonResponse(response, 200, {
        ok: true,
        result: true,
      });
      return;
    }

    if (request.method === "POST" && request.url === `/bot${input.botToken}/sendMessage`) {
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

  const activeServer = server;
  await new Promise<void>((resolve, reject) => {
    activeServer.once("error", reject);
    activeServer.listen(0, "0.0.0.0", () => {
      activeServer.off("error", reject);
      resolve();
    });
  });

  const waitForObservedRequests = async (inputForWait: {
    expectedCount: number;
    expectedPath: string;
    matchRequest?: ObservedTelegramRequestMatcher;
    scenario: HostedLocalFullStackScenario;
    userId: string;
  }): Promise<ObservedTelegramRequest[]> => {
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < 60_000) {
      const matchingRequests = observedRequests.filter((request) =>
        isMatchingObservedTelegramRequest(
          request,
          inputForWait.expectedPath,
          inputForWait.matchRequest,
        )
      );

      if (matchingRequests.length >= inputForWait.expectedCount) {
        return matchingRequests;
      }

      await sleep(250);
    }

    throw new Error(
      await inputForWait.scenario.buildFailureMessage(inputForWait.userId, [
        `Timed out waiting for ${inputForWait.expectedCount} Telegram request(s) for ${inputForWait.userId}.`,
        `expected path: ${inputForWait.expectedPath}`,
        `observed requests: ${JSON.stringify(summarizeObservedTelegramRequests(observedRequests))}`,
      ]),
    );
  };

  return {
    baseUrl: `http://127.0.0.1:${requireBoundTcpPort(activeServer, "Telegram stub")}`,
    countObservedRequests: (expectedPath, matchRequest) =>
      observedRequests.filter((request) =>
        isMatchingObservedTelegramRequest(request, expectedPath, matchRequest)
      ).length,
    createSendMessageMatcher: createTelegramSendMessageMatcher,
    createTypingMatcher: createTelegramTypingRequestMatcher,
    observedRequests,
    parseObservedJson: parseObservedTelegramJson,
    stop: async () => {
      await stopHttpStubServer(activeServer);
      server = null;
    },
    waitForRequest: async (inputForWait) =>
      (
        await waitForObservedRequests({
          expectedCount: 1,
          expectedPath: inputForWait.expectedPath,
          matchRequest: inputForWait.matchRequest,
          scenario: inputForWait.scenario,
          userId: inputForWait.userId,
        })
      )[0]!,
    waitForRequestCount: async (inputForWait) =>
      await waitForObservedRequests(inputForWait),
    waitForRequestsToSettle: async (inputForWait) => {
      const timeoutMs = inputForWait.timeoutMs ?? 10_000;
      const quietMs = inputForWait.quietMs ?? 750;
      const startedAt = Date.now();
      let lastCount = countObservedTelegramRequestsForUser(observedRequests, inputForWait.userId);
      let stableSince = Date.now();

      while ((Date.now() - startedAt) < timeoutMs) {
        const nextCount = countObservedTelegramRequestsForUser(observedRequests, inputForWait.userId);

        if (nextCount !== lastCount) {
          lastCount = nextCount;
          stableSince = Date.now();
        }

        if ((Date.now() - stableSince) >= quietMs) {
          return;
        }

        await sleep(100);
      }

      throw new Error(
        await inputForWait.scenario.buildFailureMessage(inputForWait.userId, [
          `Timed out waiting for Telegram requests to settle for ${inputForWait.userId}.`,
          `observed requests: ${JSON.stringify(summarizeObservedTelegramRequests(observedRequests))}`,
        ]),
      );
    },
  };

  function createTelegramTypingRequestMatcher(userId: string): ObservedTelegramRequestMatcher {
    return (request) => {
      const parsed = parseObservedTelegramJson(request.body);
      return Boolean(
        parsed
        && parsed.action === "typing"
        && parsed.chat_id === buildTelegramThreadId(userId),
      );
    };
  }

  function createTelegramSendMessageMatcher(userId: string): ObservedTelegramRequestMatcher {
    const expectedMessageIdPrefix = buildTelegramMessageId(userId);

    return (request) => {
      const parsed = parseObservedTelegramJson(request.body);
      const replyToMessageId =
        parsed && "reply_to_message_id" in parsed
          ? parsed.reply_to_message_id
          : null;

      return Boolean(
        parsed
        && parsed.chat_id === buildTelegramThreadId(userId)
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
}

export function buildTelegramMessageId(userId: string): string {
  return buildStableTelegramNumericId(userId, "700");
}

export function buildTelegramThreadId(userId: string): string {
  return buildStableTelegramNumericId(userId, "600");
}

export function resolveHostedTelegramAssistantReplyText(body: string): string {
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

function buildStableTelegramNumericId(userId: string, prefix: string): string {
  return `${prefix}${buildStableNumericSuffix(userId, 7)}`;
}

function countObservedTelegramRequestsForUser(
  requests: readonly ObservedTelegramRequest[],
  userId: string,
): number {
  const expectedThreadId = buildTelegramThreadId(userId);
  return requests.filter((request) => parseObservedTelegramJson(request.body)?.chat_id === expectedThreadId)
    .length;
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

function summarizeObservedTelegramRequests(
  requests: readonly ObservedTelegramRequest[],
): Array<{
  body: Record<string, unknown> | null;
  method: string;
  url: string;
}> {
  return requests.map((request) => ({
    body: parseObservedTelegramJson(request.body),
    method: request.method,
    url: request.url,
  }));
}

function requireBoundTcpPort(server: HttpServer, label: string): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`Expected the ${label} server to bind a TCP port.`);
  }

  return address.port;
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function writeTelegramDebugLog(
  debugLogFile: string | null,
  entry: Record<string, unknown>,
): Promise<void> {
  if (!debugLogFile) {
    return;
  }

  await appendFile(debugLogFile, `${JSON.stringify(entry)}\n`, "utf8");
}
