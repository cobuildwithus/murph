import { createServer, type Server as HttpServer } from "node:http";

import { createHostedPhoneLookupKey } from "./hosted-contact-privacy.js";
import {
  buildStableNumericSuffix,
  readRequestBody,
  stopHttpStubServer,
  writeJsonResponse,
} from "./hosted-local-e2e-support.js";
import type { HostedLocalFullStackScenario } from "./hosted-local-full-stack-scenario.js";

export interface ObservedLinqRequest {
  body: string;
  method: string;
  url: string;
}

export type ObservedLinqRequestMatcher = (request: ObservedLinqRequest) => boolean;

const linqCreateChatPath = "/chats";

export interface HostedLocalLinqStub {
  baseUrl: string;
  countObservedSends(expectedPath: string, matchRequest?: ObservedLinqRequestMatcher): number;
  createChatPath: string;
  createCreateChatRequestMatcher(userId: string): ObservedLinqRequestMatcher;
  observedRequests: ObservedLinqRequest[];
  readObservedMessageText(request: ObservedLinqRequest): string | null;
  requireObservedChatId(userId: string): string;
  stop(): Promise<void>;
  waitForAdditionalSend(input: {
    baselineCount: number;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalFullStackScenario;
    userId: string;
  }): Promise<ObservedLinqRequest>;
  waitForMatchingSendCount(input: {
    expectedCount: number;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalFullStackScenario;
    userId: string;
  }): Promise<ObservedLinqRequest[]>;
  waitForSend(input: {
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalFullStackScenario;
    userId: string;
  }): Promise<ObservedLinqRequest>;
}

export async function startHostedLocalLinqStub(): Promise<HostedLocalLinqStub> {
  const observedRequests: ObservedLinqRequest[] = [];
  const observedChatIdsByRecipient = new Map<string, string>();
  let nextObservedChatSequence = 0;
  let server: HttpServer | null = null;

  server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    observedRequests.push({
      body,
      method: request.method ?? "GET",
      url: request.url ?? "/",
    });

    if (request.method === "POST" && request.url === linqCreateChatPath) {
      const parsedBody = parseObservedLinqJson(body);
      const recipient = Array.isArray(parsedBody?.to) ? parsedBody.to[0] : "unknown";
      const chatId = `chat_local_${++nextObservedChatSequence}`;
      observedChatIdsByRecipient.set(String(recipient ?? "unknown"), chatId);
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
          chat_id: request.url.split("/")[2],
          id: `linq_msg_${Date.now()}`,
        },
      });
      return;
    }

    writeJsonResponse(response, 200, { ok: true });
  });

  const activeServer = server;
  await new Promise<void>((resolve, reject) => {
    activeServer.once("error", reject);
    activeServer.listen(0, "0.0.0.0", () => {
      activeServer.off("error", reject);
      resolve();
    });
  });

  const waitForObservedRequests = async (input: {
    expectedCount: number;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalFullStackScenario;
    userId: string;
  }): Promise<ObservedLinqRequest[]> => {
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < 60_000) {
      const matchingRequests = observedRequests.filter((request) =>
        isMatchingObservedLinqSend(request, input.expectedPath, input.matchRequest)
      );

      if (matchingRequests.length >= input.expectedCount) {
        return matchingRequests;
      }

      await sleep(250);
    }

    throw new Error(
      await input.scenario.buildFailureMessage(input.userId, [
        `Timed out waiting for ${input.expectedCount} Linq send(s) for ${input.userId}.`,
        `expected path: ${input.expectedPath}`,
        `observed requests: ${JSON.stringify(observedRequests)}`,
        `assistant provider bodies: ${JSON.stringify(input.scenario.assistantProviderBodies)}`,
      ]),
    );
  };

  return {
    baseUrl: `http://127.0.0.1:${requireBoundTcpPort(activeServer, "Linq stub")}`,
    countObservedSends: (expectedPath, matchRequest) =>
      observedRequests.filter((request) =>
        isMatchingObservedLinqSend(request, expectedPath, matchRequest)
      ).length,
    createChatPath: linqCreateChatPath,
    createCreateChatRequestMatcher: (userId) => {
      const expectedFrom = buildLinqHomePhoneNumber(userId);
      const expectedTo = buildLinqRecipientPhoneNumber(userId);

      return (request) => {
        const parsed = parseObservedLinqJson(request.body);
        const to = parsed?.to;
        return parsed?.from === expectedFrom && Array.isArray(to) && to[0] === expectedTo;
      };
    },
    observedRequests,
    readObservedMessageText: readObservedLinqMessageText,
    requireObservedChatId: (userId) => {
      const recipientPhoneNumber = buildLinqRecipientPhoneNumber(userId);
      const chatId = observedChatIdsByRecipient.get(recipientPhoneNumber);
      if (!chatId) {
        throw new Error(`Expected a materialized Linq chat id for ${userId}.`);
      }

      return chatId;
    },
    stop: async () => {
      await stopHttpStubServer(activeServer);
      server = null;
    },
    waitForAdditionalSend: async (input) => {
      const matchingRequests = await waitForObservedRequests({
        expectedCount: input.baselineCount + 1,
        expectedPath: input.expectedPath,
        matchRequest: input.matchRequest,
        scenario: input.scenario,
        userId: input.userId,
      });
      return matchingRequests.at(-1)!;
    },
    waitForMatchingSendCount: async (input) =>
      await waitForObservedRequests({
        expectedCount: input.expectedCount,
        expectedPath: input.expectedPath,
        matchRequest: input.matchRequest,
        scenario: input.scenario,
        userId: input.userId,
      }),
    waitForSend: async (input) =>
      (
        await waitForObservedRequests({
          expectedCount: 1,
          expectedPath: input.expectedPath,
          matchRequest: input.matchRequest,
          scenario: input.scenario,
          userId: input.userId,
        })
      )[0]!,
  };
}

export function buildHostedLinqInboundEvent(
  userId: string,
  chatId: string,
  input: {
    eventId?: string;
    messageId?: string;
    text?: string;
  } = {},
): Record<string, unknown> {
  return {
    api_version: "v3",
    created_at: new Date().toISOString(),
    data: {
      chat: {
        id: chatId,
        is_group: false,
        owner_handle: {
          handle: buildLinqHomePhoneNumber(userId),
          id: `handle_owner_${userId}`,
          is_me: true,
          service: "SMS",
        },
      },
      chat_id: chatId,
      direction: "inbound",
      from: buildLinqRecipientPhoneNumber(userId),
      from_handle: {
        handle: buildLinqRecipientPhoneNumber(userId),
        id: `handle_sender_${userId}`,
        service: "SMS",
      },
      is_from_me: false,
      message: {
        id: input.messageId ?? `msg_local_${userId}`,
        parts: [
          {
            type: "text",
            value: input.text ?? "hello mate",
          },
        ],
      },
      recipient_handle: {
        handle: buildLinqHomePhoneNumber(userId),
        id: `handle_owner_${userId}`,
        is_me: true,
        service: "SMS",
      },
      recipient_phone: buildLinqHomePhoneNumber(userId),
      received_at: new Date().toISOString(),
      sender_handle: {
        handle: buildLinqRecipientPhoneNumber(userId),
        id: `handle_sender_${userId}`,
        service: "SMS",
      },
      sent_at: new Date().toISOString(),
      service: "SMS",
    },
    event_id: input.eventId ?? `evt_linq_inbound_${userId}`,
    event_type: "message.received",
    webhook_version: "2026-02-03",
  };
}

export function buildLinqHomePhoneNumber(userId: string): string {
  return buildStableTestPhoneNumber(userId, "598");
}

export function buildLinqRecipientPhoneNumber(userId: string): string {
  return buildStableTestPhoneNumber(userId, "501");
}

export function requireLinqPhoneLookupKey(userId: string): string {
  const lookupKey = createHostedPhoneLookupKey(buildLinqRecipientPhoneNumber(userId));
  if (!lookupKey) {
    throw new Error(`Expected Linq phone lookup key for ${userId}.`);
  }

  return lookupKey;
}

export function resolveHostedLinqAssistantReplyText(body: string): string {
  if (body.includes("Rocket Man") && body.includes("build more strength")) {
    if (body.includes("I’ll call you Rocket Man") || body.includes("I'll call you Rocket Man")) {
      return "Got you — stronger, fitter, faster, and more endurance.";
    }

    return "What should I call you? And out of those, which ones matter most to you right now?";
  }

  if (body.includes("Rocket Man")) {
    return "Got it — I’ll call you Rocket Man.\n\nWhat are your health goals right now?";
  }

  return "Got it - I saw your message and I'm here.";
}

function buildStableTestPhoneNumber(userId: string, prefix: string): string {
  return `+1555${prefix}${buildStableNumericSuffix(userId, 7)}`;
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

function parseObservedLinqJson(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readObservedLinqMessageText(request: ObservedLinqRequest): string | null {
  const parsed = parseObservedLinqJson(request.body);
  const message = parsed?.message;

  if (!message || typeof message !== "object") {
    return null;
  }

  const parts = "parts" in message ? message.parts : null;
  if (!Array.isArray(parts)) {
    return null;
  }

  return parts
    .filter((part): part is { type: string; value?: unknown } =>
      Boolean(part && typeof part === "object" && "type" in part)
    )
    .map((part) => (part.type === "text" && typeof part.value === "string") ? part.value : null)
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    || null;
}

function requireBoundTcpPort(server: HttpServer, label: string): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`Expected the ${label} server to bind a TCP port.`);
  }

  return address.port;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
