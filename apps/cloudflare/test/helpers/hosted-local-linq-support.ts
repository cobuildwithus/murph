import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";

import { MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE } from "@murphai/contracts";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";

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
  host: string | null;
  method: string;
  url: string;
}

export type ObservedLinqRequestMatcher = (request: ObservedLinqRequest) => boolean;

const linqCreateChatPath = "/chats";
const linqAttachmentDownloadBasePath = "/attachment-downloads";

type HostedLinqInboundPartInput =
  | {
      type: "text";
      value: string;
    }
  | {
      attachmentId: string;
      fileName?: string;
      mimeType?: string;
      size?: number | null;
      type: "media" | "voice_memo";
      url?: string | null;
    };

export interface HostedLocalLinqStub {
  attachmentDownloadBaseUrl: string;
  baseUrl: string;
  countObservedSends(expectedPath: string, matchRequest?: ObservedLinqRequestMatcher): number;
  countObservedRequests(input: {
    expectedMethod: string;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
  }): number;
  createChatPath: string;
  createCreateChatRequestMatcher(userId: string): ObservedLinqRequestMatcher;
  listObservedMessageIds(chatId: string): string[];
  observedRequests: ObservedLinqRequest[];
  readObservedMessageText(request: ObservedLinqRequest): string | null;
  requireObservedChatId(userId: string): string;
  requireLatestObservedMessageId(chatId: string): string;
  stop(): Promise<void>;
  waitForAdditionalRequest(input: {
    baselineCount: number;
    expectedMethod: string;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalFullStackScenario;
    userId: string;
  }): Promise<ObservedLinqRequest>;
  waitForAdditionalSend(input: {
    baselineCount: number;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalFullStackScenario;
    userId: string;
  }): Promise<ObservedLinqRequest>;
  waitForMatchingRequestCount(input: {
    expectedCount: number;
    expectedMethod: string;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalFullStackScenario;
    userId: string;
  }): Promise<ObservedLinqRequest[]>;
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

export const HOSTED_LINQ_DEFAULT_ASSISTANT_REPLY_TEXT =
  "Got it - I saw your message and I'm here.";
export const HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT =
  "Got it — I’ll call you Rocket Man.\n\nWhat are your health goals right now?";
export const HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT =
  "What should I call you? And out of those, which ones matter most to you right now?";

export async function startHostedLocalLinqStub(): Promise<HostedLocalLinqStub> {
  const observedRequests: ObservedLinqRequest[] = [];
  const observedChatIdsByRecipient = new Map<string, string>();
  const observedMessageIdsByChat = new Map<string, string[]>();
  const voiceMemoBytes = buildHostedLocalLinqVoiceMemoBytes();
  let nextObservedChatSequence = 0;
  let nextObservedMessageSequence = 0;
  let attachmentDownloadBaseUrl = "";
  let server: HttpServer | null = null;

  server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    observedRequests.push({
      body,
      host: request.headers.host?.trim() || null,
      method: request.method ?? "GET",
      url: request.url ?? "/",
    });
    if (process.env.MURPH_E2E_DEBUG_LINQ_STUB === "1") {
      console.log(`[linq-stub] ${request.method ?? "GET"} ${request.url ?? "/"}`);
    }

    if (request.method === "POST" && request.url === linqCreateChatPath) {
      const parsedBody = parseObservedLinqJson(body);
      if (!isObservedLinqCreateChatPayload(parsedBody)) {
        writeJsonResponse(response, 400, {
          error: "Expected a Linq create-chat payload with from, to, and a text message.",
        });
        return;
      }

      const recipient = Array.isArray(parsedBody?.to) ? parsedBody.to[0] : "unknown";
      const chatId = `chat_local_${++nextObservedChatSequence}`;
      const messageId = `linq_msg_local_${++nextObservedMessageSequence}`;
      observedChatIdsByRecipient.set(String(recipient ?? "unknown"), chatId);
      observedMessageIdsByChat.set(chatId, [messageId]);
      writeJsonResponse(response, 200, {
        chat: {
          id: chatId,
          message: {
            id: messageId,
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
      if (!isObservedLinqMessagePayload(parseObservedLinqJson(body))) {
        writeJsonResponse(response, 400, {
          error: "Expected a Linq send-message payload with a text message.",
        });
        return;
      }

      const chatId = request.url.split("/")[2] ?? "unknown";
      const messageId = `linq_msg_local_${++nextObservedMessageSequence}`;
      const observedMessageIds = observedMessageIdsByChat.get(chatId) ?? [];
      observedMessageIds.push(messageId);
      observedMessageIdsByChat.set(chatId, observedMessageIds);
      writeJsonResponse(response, 200, {
        chat_id: chatId,
        data: {
          chat_id: chatId,
          id: messageId,
        },
        message: {
          id: messageId,
        },
      });
      return;
    }

    if (request.method === "GET" && request.url && /^\/attachments\/[^/]+$/u.test(request.url)) {
      const attachmentId = decodeURIComponent(request.url.split("/").at(-1) ?? "");
      writeJsonResponse(response, 200, {
        download_url: buildHostedLocalLinqAttachmentDownloadUrl(
          resolveHostedLocalLinqAttachmentDownloadBaseUrl(request, attachmentDownloadBaseUrl),
          attachmentId,
        ),
      });
      return;
    }

    if (
      request.method === "GET"
      && request.url
      && /^\/attachment-downloads\/[^/]+\.wav$/u.test(request.url)
    ) {
      response.statusCode = 200;
      response.setHeader("content-type", "audio/wav");
      response.end(Buffer.from(voiceMemoBytes));
      return;
    }

    if (request.method === "DELETE" && request.url && /^\/messages\/[^/]+$/u.test(request.url)) {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (
      request.url
      && /^\/chats\/[^/]+\/typing$/u.test(request.url)
      && (request.method === "POST" || request.method === "DELETE")
    ) {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/phone_numbers") {
      writeJsonResponse(response, 200, {
        phone_numbers: [],
      });
      return;
    }

    writeJsonResponse(response, 404, {
      error: `Unhandled Linq stub route: ${request.method ?? "GET"} ${request.url ?? "/"}`,
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
  const baseUrl = `http://127.0.0.1:${requireBoundTcpPort(activeServer, "Linq stub")}`;
  attachmentDownloadBaseUrl = `${baseUrl}${linqAttachmentDownloadBasePath}`;

  const waitForObservedRequests = async (input: {
    expectedCount: number;
    expectedMethod: string;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalFullStackScenario;
    userId: string;
  }): Promise<ObservedLinqRequest[]> => {
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < 60_000) {
      const matchingRequests = observedRequests.filter((request) =>
        isMatchingObservedLinqRequest(
          request,
          input.expectedMethod,
          input.expectedPath,
          input.matchRequest,
        )
      );

      if (matchingRequests.length >= input.expectedCount) {
        return matchingRequests;
      }

      await sleep(250);
    }

      throw new Error(
        await input.scenario.buildFailureMessage(input.userId, [
          `Timed out waiting for ${input.expectedCount} Linq request(s) for ${input.userId}.`,
          `expected path: ${input.expectedPath}`,
          `observed requests: ${JSON.stringify(observedRequests)}`,
        ]),
      );
  };

  return {
    attachmentDownloadBaseUrl,
    baseUrl,
    countObservedSends: (expectedPath, matchRequest) =>
      observedRequests.filter((request) =>
        isMatchingObservedLinqRequest(request, "POST", expectedPath, matchRequest)
      ).length,
    countObservedRequests: ({ expectedMethod, expectedPath, matchRequest }) =>
      observedRequests.filter((request) =>
        isMatchingObservedLinqRequest(request, expectedMethod, expectedPath, matchRequest)
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
    listObservedMessageIds: (chatId) => [...(observedMessageIdsByChat.get(chatId) ?? [])],
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
    requireLatestObservedMessageId: (chatId) => {
      const latestMessageId = observedMessageIdsByChat.get(chatId)?.at(-1) ?? null;
      if (!latestMessageId) {
        throw new Error(`Expected an observed Linq message id for chat ${chatId}.`);
      }

      return latestMessageId;
    },
    stop: async () => {
      await stopHttpStubServer(activeServer);
      server = null;
    },
    waitForAdditionalRequest: async (input) => {
      const matchingRequests = await waitForObservedRequests({
        expectedCount: input.baselineCount + 1,
        expectedMethod: input.expectedMethod,
        expectedPath: input.expectedPath,
        matchRequest: input.matchRequest,
        scenario: input.scenario,
        userId: input.userId,
      });
      return matchingRequests.at(-1)!;
    },
    waitForAdditionalSend: async (input) => {
      const matchingRequests = await waitForObservedRequests({
        expectedCount: input.baselineCount + 1,
        expectedMethod: "POST",
        expectedPath: input.expectedPath,
        matchRequest: input.matchRequest,
        scenario: input.scenario,
        userId: input.userId,
      });
      return matchingRequests.at(-1)!;
    },
    waitForMatchingRequestCount: async (input) =>
      await waitForObservedRequests({
        expectedCount: input.expectedCount,
        expectedMethod: input.expectedMethod,
        expectedPath: input.expectedPath,
        matchRequest: input.matchRequest,
        scenario: input.scenario,
        userId: input.userId,
      }),
    waitForMatchingSendCount: async (input) =>
      await waitForObservedRequests({
        expectedCount: input.expectedCount,
        expectedMethod: "POST",
        expectedPath: input.expectedPath,
        matchRequest: input.matchRequest,
        scenario: input.scenario,
        userId: input.userId,
      }),
    waitForSend: async (input) =>
      (
        await waitForObservedRequests({
          expectedCount: 1,
          expectedMethod: "POST",
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
    parts?: HostedLinqInboundPartInput[];
    text?: string;
  } = {},
): Record<string, unknown> {
  const parts = input.parts?.map(buildHostedLinqInboundPart) ?? [
    {
      type: "text",
      value: input.text ?? "hello mate",
    },
  ];

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
        parts,
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

export function buildHostedLinqSignupWelcomeWake(input: {
  eventId: string;
  occurredAt?: string;
  userId: string;
}) {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: input.eventId,
    memberId: input.userId,
    notification: {
      deliveryDedupeToken: `signup-welcome:${input.userId}`,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: `signup-welcome:${input.userId}`,
      firstContact: {
        markSeenOnDeliveryAccepted: true,
      },
      instructions: [
        "Prepare the first in-chat onboarding reply.",
        "Use this user-facing reply only:",
        MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      ].join("\n\n"),
      responsePolicy: {
        kind: "require_send_exact_text",
        text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      },
      route: {
        actorId: buildLinqRecipientPhoneNumber(input.userId),
        channel: "linq",
        delivery: {
          kind: "participant",
          source: {
            fromPhoneNumber: buildLinqHomePhoneNumber(input.userId),
            kind: "linq",
          },
          target: buildLinqRecipientPhoneNumber(input.userId),
        },
        identityId: requireLinqPhoneLookupKey(input.userId),
        threadId: null,
        threadIsDirect: true,
      },
    },
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  });
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

function buildStableTestPhoneNumber(userId: string, prefix: string): string {
  return `+1555${prefix}${buildStableNumericSuffix(userId, 7)}`;
}

function isMatchingObservedLinqRequest(
  request: ObservedLinqRequest,
  expectedMethod: string,
  expectedPath: string,
  matchRequest?: ObservedLinqRequestMatcher,
): boolean {
  return (
    request.method === expectedMethod
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

function isObservedLinqCreateChatPayload(payload: Record<string, unknown> | null): boolean {
  return Boolean(
    payload
    && typeof payload.from === "string"
    && Array.isArray(payload.to)
    && payload.to.every((recipient) => typeof recipient === "string" && recipient.length > 0)
    && isObservedLinqMessagePayload(payload),
  );
}

function isObservedLinqMessagePayload(payload: Record<string, unknown> | null): boolean {
  if (!payload || typeof payload.message !== "object" || payload.message === null) {
    return false;
  }

  const parts =
    "parts" in payload.message
      ? (payload.message as { parts?: unknown }).parts
      : null;
  if (!Array.isArray(parts) || parts.length === 0) {
    return false;
  }

  return parts.some((part) =>
    Boolean(
      part
      && typeof part === "object"
      && "type" in part
      && "value" in part
      && part.type === "text"
      && typeof part.value === "string"
      && part.value.trim().length > 0,
    )
  );
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

function buildHostedLinqInboundPart(part: HostedLinqInboundPartInput): Record<string, unknown> {
  if (part.type === "text") {
    return {
      type: "text",
      value: part.value,
    };
  }

  return {
    attachment_id: part.attachmentId,
    ...(part.fileName ? { filename: part.fileName } : {}),
    ...(part.mimeType ? { mime_type: part.mimeType } : {}),
    ...(typeof part.size === "number" ? { size: part.size } : {}),
    type: part.type,
    ...(part.url ? { url: part.url } : {}),
  };
}

function buildHostedLocalLinqAttachmentDownloadUrl(
  attachmentDownloadBaseUrl: string,
  attachmentId: string,
): string {
  return `${attachmentDownloadBaseUrl}/${encodeURIComponent(attachmentId)}.wav`;
}

function resolveHostedLocalLinqAttachmentDownloadBaseUrl(
  request: Pick<IncomingMessage, "headers">,
  fallbackBaseUrl: string,
): string {
  const host = request.headers.host?.trim();
  if (!host) {
    return fallbackBaseUrl;
  }

  try {
    return new URL(linqAttachmentDownloadBasePath, `http://${host}`).toString().replace(/\/$/u, "");
  } catch {
    return fallbackBaseUrl;
  }
}

function buildHostedLocalLinqVoiceMemoBytes(): Uint8Array {
  return Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x2c, 0x00, 0x00, 0x00,
    0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
    0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00,
    0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61,
    0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x7f,
    0x00, 0x80, 0x00, 0x00,
  ]);
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
