import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { deflateSync } from "node:zlib";

import { MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE } from "@murphai/contracts";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";
import { createHostedPhoneLookupKey } from "./hosted-contact-privacy.js";
import {
  buildStableNumericSuffix,
  readRequestBody,
  stopHttpStubServer,
  writeJsonResponse,
} from "./hosted-local-e2e-support.js";
import type { HostedLocalFullStackScenario } from "./hosted-local-full-stack-scenario.js";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../../src/runner-injected-credential.ts";

export interface ObservedLinqRequest {
  authorizationStatus: "expected" | "hosted-sentinel" | "missing" | "present" | "unexpected";
  body: string;
  host: string | null;
  method: string;
  observedAtEpochMs?: number;
  url: string;
}

export type ObservedLinqRequestMatcher = (request: ObservedLinqRequest) => boolean;
export type HostedLocalLinqWaitScenario = Pick<
  HostedLocalFullStackScenario,
  "buildFailureMessage"
>;

export interface HostedLocalLinqCanonicalChatHandle {
  handle: string;
  isMe: boolean;
  status?: string | null;
}

export interface HostedLocalLinqCanonicalChat {
  chatId: string;
  handles?: readonly HostedLocalLinqCanonicalChatHandle[];
  isGroup: boolean;
}

const linqCreateChatPath = "/chats";
const linqCreateAttachmentPath = "/attachments";
const linqIMessageCapabilityPath = "/capability/check_imessage";
const linqAttachmentDownloadBasePath = "/attachment-downloads";
const hostedLocalLinqObservedRequestWaitTimeoutMs = 180_000;
const hostedLocalRunnerProviderHost = "host.docker.internal";
// Linq's production client makes three attempts for retry-safe POSTs. The
// controls span that provider-local loop so one logical send fails. The
// post-accept control records only its first provider acceptance; a later
// logical retry observes that already-accepted result.
const hostedLocalLinqHttpAttemptsPerLogicalSend = 3;

interface HostedLocalLinqArmedSendFailure {
  expectedPath: string;
  matchRequest: ObservedLinqRequestMatcher;
  remainingResponses: number;
}

interface HostedLocalLinqAcceptedMessage {
  chatId: string;
  messageId: string;
  request: ObservedLinqRequest;
}

interface HostedLocalLinqArmedRequestDelay {
  delayMs: number;
  expectedMethod: string;
  expectedPath: string;
  matchRequest?: ObservedLinqRequestMatcher;
}

type HostedLinqInboundPartInput =
  | {
      type: "text";
      value: string;
    }
  | {
      app: Record<string, unknown>;
      fallbackText?: string | null;
      layout: Record<string, unknown>;
      type: "imessage_app";
      url: string;
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
  acceptedSendRequests: ObservedLinqRequest[];
  armNextRequestDelay(input: {
    delayMs: number;
    expectedMethod: string;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
  }): void;
  armNextPostAcceptLostAcknowledgment(input: {
    expectedPath: string;
    matchRequest: ObservedLinqRequestMatcher;
    responseCount?: number;
  }): void;
  armNextPreAcceptDefinitiveSendFailure(input: {
    expectedPath: string;
    matchRequest: ObservedLinqRequestMatcher;
    responseCount?: number;
  }): void;
  armNextPreAcceptRetryableSendFailure(input: {
    expectedPath: string;
    matchRequest: ObservedLinqRequestMatcher;
    responseCount?: number;
  }): void;
  attachmentDownloadContainerBaseUrl: string;
  attachmentDownloadBaseUrl: string;
  baseUrl: string;
  containerBaseUrl: string;
  countAcceptedSends(expectedPath: string, matchRequest?: ObservedLinqRequestMatcher): number;
  countObservedSends(expectedPath: string, matchRequest?: ObservedLinqRequestMatcher): number;
  countObservedRequests(input: {
    expectedMethod: string;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
  }): number;
  createChatPath: string;
  createCreateChatRequestMatcher(userId: string): ObservedLinqRequestMatcher;
  createIMessageCapabilityRequestMatcher(input: {
    address: string;
  }): ObservedLinqRequestMatcher;
  listObservedMessageIds(chatId: string): string[];
  observedRequests: ObservedLinqRequest[];
  readObservedMessageAppCard(request: ObservedLinqRequest): Record<string, unknown> | null;
  readObservedMessageLink(request: ObservedLinqRequest): string | null;
  readObservedMessageText(request: ObservedLinqRequest): string | null;
  requireObservedChatId(userId: string): string;
  requireLatestObservedMessageId(chatId: string): string;
  runnerBaseUrl: string;
  setChatIsGroup(chatId: string, isGroup: boolean): void;
  stop(): Promise<void>;
  waitForAdditionalRequest(input: {
    baselineCount: number;
    expectedMethod: string;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalLinqWaitScenario;
    userId: string;
  }): Promise<ObservedLinqRequest>;
  waitForAdditionalAcceptedSend(input: {
    baselineCount: number;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalLinqWaitScenario;
    userId: string;
  }): Promise<ObservedLinqRequest>;
  waitForAdditionalSend(input: {
    baselineCount: number;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalLinqWaitScenario;
    userId: string;
  }): Promise<ObservedLinqRequest>;
  waitForMatchingRequestCount(input: {
    expectedCount: number;
    expectedMethod: string;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalLinqWaitScenario;
    userId: string;
  }): Promise<ObservedLinqRequest[]>;
  waitForMatchingAcceptedSendCount(input: {
    expectedCount: number;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalLinqWaitScenario;
    userId: string;
  }): Promise<ObservedLinqRequest[]>;
  waitForMatchingSendCount(input: {
    expectedCount: number;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalLinqWaitScenario;
    userId: string;
  }): Promise<ObservedLinqRequest[]>;
  waitForSend(input: {
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    scenario: HostedLocalLinqWaitScenario;
    userId: string;
  }): Promise<ObservedLinqRequest>;
}

export const HOSTED_LINQ_DEFAULT_ASSISTANT_REPLY_TEXT =
  "Got it - I saw your message and I'm here.";
export const HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT =
  "Got it — I’ll call you Rocket Man.\n\nWhat are your health goals right now?";
export const HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT =
  "Which of those health goals matters most to you right now?";
export const HOSTED_LOCAL_LINQ_PDF_BYTES = new TextEncoder().encode([
  "%PDF-1.7",
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
  "2 0 obj<</Type/Pages/Count 0>>endobj",
  "trailer<</Root 1 0 R>>",
  "%%EOF",
  "",
].join("\n"));

const HOSTED_LOCAL_LINQ_IMAGE_PNG_WIDTH = 768;
const HOSTED_LOCAL_LINQ_IMAGE_PNG_HEIGHT = 512;
const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_CRC_TABLE = buildPngCrcTable();

let hostedLocalLinqImagePngBytes: Uint8Array | null = null;

export function readHostedLocalLinqImagePngBytes(): Uint8Array {
  hostedLocalLinqImagePngBytes ??= buildHostedLocalLargeImagePngBytes();
  return hostedLocalLinqImagePngBytes.slice();
}

export async function startHostedLocalLinqStub(input: {
  canonicalChats?: readonly HostedLocalLinqCanonicalChat[];
  expectedAuthorizationToken?: string | null;
} = {}): Promise<HostedLocalLinqStub> {
  const observedRequests: ObservedLinqRequest[] = [];
  const acceptedSendRequests: ObservedLinqRequest[] = [];
  const acceptedMessagesByIdempotencyKey = new Map<
    string,
    HostedLocalLinqAcceptedMessage
  >();
  const canonicalChats = new Map(
    (input.canonicalChats ?? []).map((chat) => [chat.chatId, chat] as const),
  );
  const observedChatIdsByRecipient = new Map<string, string>();
  const canonicalGroupStateByChatId = new Map<string, boolean>();
  const observedMessageIdsByChat = new Map<string, string[]>();
  const voiceMemoBytes = buildHostedLocalLinqVoiceMemoBytes();
  const pdfBytes = HOSTED_LOCAL_LINQ_PDF_BYTES;
  let nextObservedChatSequence = 0;
  let nextObservedAttachmentSequence = 0;
  let nextObservedMessageSequence = 0;
  let attachmentDownloadBaseUrl = "";
  let attachmentDownloadContainerBaseUrl = "";
  let nextPostAcceptLostAcknowledgment: HostedLocalLinqArmedSendFailure | null = null;
  let nextPreAcceptDefinitiveSendFailure: HostedLocalLinqArmedSendFailure | null = null;
  let nextPreAcceptRetryableSendFailure: HostedLocalLinqArmedSendFailure | null = null;
  let nextRequestDelay: HostedLocalLinqArmedRequestDelay | null = null;
  let postAcceptLostAcknowledgmentAcceptedMessage: HostedLocalLinqAcceptedMessage | null = null;
  let server: HttpServer | null = null;

  server = createServer(async (request, response) => {
    const observedAtEpochMs = Date.now();
    const body = await readRequestBody(request);
    const observedRequest: ObservedLinqRequest = {
      authorizationStatus: classifyObservedLinqAuthorization(
        request.headers.authorization,
        input.expectedAuthorizationToken,
      ),
      body,
      host: request.headers.host?.trim() || null,
      method: request.method ?? "GET",
      observedAtEpochMs,
      url: request.url ?? "/",
    };
    observedRequests.push(observedRequest);
    if (
      nextRequestDelay
      && observedRequest.method === nextRequestDelay.expectedMethod
      && observedRequest.url === nextRequestDelay.expectedPath
      && (
        !nextRequestDelay.matchRequest
        || nextRequestDelay.matchRequest(observedRequest)
      )
    ) {
      const delayMs = nextRequestDelay.delayMs;
      nextRequestDelay = null;
      await sleep(delayMs);
    }
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

    if (request.method === "POST" && request.url === linqCreateAttachmentPath) {
      const parsedBody = parseObservedLinqJson(body);
      if (!isObservedLinqCreateAttachmentPayload(parsedBody)) {
        writeJsonResponse(response, 400, {
          error: "Expected a Linq attachment payload with content_type, filename, and size_bytes.",
        });
        return;
      }

      const attachmentId = `attachment_local_${++nextObservedAttachmentSequence}`;
      writeJsonResponse(response, 200, {
        attachment_id: attachmentId,
        download_url: `https://cdn.example.test/linq-attachments/${attachmentId}`,
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        http_method: "PUT",
        required_headers: {
          "content-type": parsedBody.content_type,
        },
        upload_url: `https://uploads.example.test/linq-attachments/${attachmentId}`,
      });
      return;
    }

    if (request.method === "POST" && request.url === linqIMessageCapabilityPath) {
      writeJsonResponse(response, 200, { available: true });
      return;
    }

    if (request.method === "GET" && request.url && /^\/chats\/[^/]+$/u.test(request.url)) {
      const chatId = decodeURIComponent(request.url.split("/")[2] ?? "unknown");
      const canonicalChat = canonicalChats.get(chatId);
      writeJsonResponse(response, 200, {
        handles: (canonicalChat?.handles ?? []).map((handle) => ({
          handle: handle.handle,
          is_me: handle.isMe,
          status: handle.status ?? null,
        })),
        id: chatId,
        is_group:
          canonicalGroupStateByChatId.get(chatId) ?? canonicalChat?.isGroup ?? false,
      });
      return;
    }

    if (
      request.method === "POST"
      && request.url
      && /^\/chats\/[^/]+\/messages$/u.test(request.url)
    ) {
      const parsedBody = parseObservedLinqJson(body);
      if (!isObservedLinqMessagePayload(parsedBody)) {
        writeJsonResponse(response, 400, {
          error: "Expected a Linq send-message payload with a supported message part.",
        });
        return;
      }

      if (
        consumeHostedLocalLinqArmedSendFailure(
          nextPreAcceptDefinitiveSendFailure,
          observedRequest,
        )
      ) {
        if (nextPreAcceptDefinitiveSendFailure?.remainingResponses === 0) {
          nextPreAcceptDefinitiveSendFailure = null;
        }
        writeJsonResponse(response, 400, {
          error: "Synthetic hosted-local definitive Linq send failure.",
        });
        return;
      }

      if (
        consumeHostedLocalLinqArmedSendFailure(
          nextPreAcceptRetryableSendFailure,
          observedRequest,
        )
      ) {
        if (nextPreAcceptRetryableSendFailure?.remainingResponses === 0) {
          nextPreAcceptRetryableSendFailure = null;
        }
        writeHostedLocalLinqRetryableSendFailure(response);
        return;
      }

      const chatId = request.url.split("/")[2] ?? "unknown";
      const idempotencyKey = readObservedLinqMessageIdempotencyKey(parsedBody);
      const acceptedIdempotencyReplay = idempotencyKey
        ? acceptedMessagesByIdempotencyKey.get(idempotencyKey) ?? null
        : null;
      if (
        acceptedIdempotencyReplay
        && (
          acceptedIdempotencyReplay.request.body !== observedRequest.body
          || acceptedIdempotencyReplay.request.url !== observedRequest.url
        )
      ) {
        writeJsonResponse(response, 409, {
          error: "Conflicting Linq idempotency-key reuse.",
        });
        return;
      }
      const replayedAcceptedMessage = acceptedIdempotencyReplay
        ?? (
          postAcceptLostAcknowledgmentAcceptedMessage
          && postAcceptLostAcknowledgmentAcceptedMessage.chatId === chatId
          && postAcceptLostAcknowledgmentAcceptedMessage.request.body === observedRequest.body
          && postAcceptLostAcknowledgmentAcceptedMessage.request.url === observedRequest.url
            ? postAcceptLostAcknowledgmentAcceptedMessage
            : null
        );
      const acceptedMessage = replayedAcceptedMessage ?? (() => {
        const messageId = `linq_msg_local_${++nextObservedMessageSequence}`;
        const observedMessageIds = observedMessageIdsByChat.get(chatId) ?? [];
        observedMessageIds.push(messageId);
        observedMessageIdsByChat.set(chatId, observedMessageIds);
        acceptedSendRequests.push(observedRequest);
        return {
          chatId,
          messageId,
          request: observedRequest,
        };
      })();
      if (idempotencyKey && !replayedAcceptedMessage) {
        acceptedMessagesByIdempotencyKey.set(idempotencyKey, acceptedMessage);
      }

      if (
        consumeHostedLocalLinqArmedSendFailure(
          nextPostAcceptLostAcknowledgment,
          observedRequest,
        )
      ) {
        postAcceptLostAcknowledgmentAcceptedMessage = acceptedMessage;
        if (nextPostAcceptLostAcknowledgment?.remainingResponses === 0) {
          nextPostAcceptLostAcknowledgment = null;
        }
        writeHostedLocalLinqRetryableSendFailure(response);
        return;
      }

      writeHostedLocalLinqAcceptedMessage(response, acceptedMessage);
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
      && /^\/attachment-downloads\/[^/]+\.(?:m4a|pdf|png|wav)$/u.test(request.url)
    ) {
      response.statusCode = 200;
      if (request.url.endsWith(".pdf")) {
        response.setHeader("content-type", "application/pdf");
        response.end(Buffer.from(pdfBytes));
      } else if (request.url.endsWith(".png")) {
        response.setHeader("content-type", "image/png");
        response.end(Buffer.from(readHostedLocalLinqImagePngBytes()));
      } else {
        response.setHeader(
          "content-type",
          request.url.endsWith(".m4a") ? "audio/mp4" : "audio/wav",
        );
        response.end(Buffer.from(voiceMemoBytes));
      }
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

    if (request.method === "POST" && request.url && /^\/chats\/[^/]+\/read$/u.test(request.url)) {
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
  const tcpPort = requireBoundTcpPort(activeServer, "Linq stub");
  const baseUrl = `http://127.0.0.1:${tcpPort}`;
  const containerBaseUrl =
    `http://${formatHostedLocalLinqUrlHost(resolveHostedLocalLinqContainerHost())}:${tcpPort}`;
  const runnerBaseUrl = `http://${hostedLocalRunnerProviderHost}:${tcpPort}`;
  attachmentDownloadBaseUrl = `${baseUrl}${linqAttachmentDownloadBasePath}`;
  attachmentDownloadContainerBaseUrl =
    `${containerBaseUrl}${linqAttachmentDownloadBasePath}`;

  const waitForObservedRequests = async (input: {
    expectedCount: number;
    expectedMethod: string;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    requests?: ObservedLinqRequest[];
    scenario: HostedLocalLinqWaitScenario;
    userId: string;
  }): Promise<ObservedLinqRequest[]> => {
    const requests = input.requests ?? observedRequests;
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < hostedLocalLinqObservedRequestWaitTimeoutMs) {
      const matchingRequests = requests.filter((request) =>
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
        `observed requests: ${JSON.stringify(summarizeObservedLinqRequests(observedRequests))}`,
      ]),
    );
  };

  return {
    acceptedSendRequests,
    armNextRequestDelay({
      delayMs,
      expectedMethod,
      expectedPath,
      matchRequest,
    }) {
      if (!Number.isSafeInteger(delayMs) || delayMs < 1) {
        throw new TypeError("A Linq request delay requires a positive integer delayMs.");
      }
      nextRequestDelay = {
        delayMs,
        expectedMethod,
        expectedPath,
        ...(matchRequest ? { matchRequest } : {}),
      };
    },
    armNextPostAcceptLostAcknowledgment: ({
      expectedPath,
      matchRequest,
      responseCount = hostedLocalLinqHttpAttemptsPerLogicalSend,
    }) => {
      if (nextPostAcceptLostAcknowledgment) {
        throw new Error("A post-accept Linq lost-acknowledgment control is already armed.");
      }
      if (!Number.isSafeInteger(responseCount) || responseCount < 1) {
        throw new Error(
          "A post-accept Linq lost-acknowledgment control requires a positive response count.",
        );
      }
      postAcceptLostAcknowledgmentAcceptedMessage = null;
      nextPostAcceptLostAcknowledgment = {
        expectedPath,
        matchRequest,
        remainingResponses: responseCount,
      };
    },
    armNextPreAcceptDefinitiveSendFailure: ({
      expectedPath,
      matchRequest,
      responseCount = 1,
    }) => {
      if (nextPreAcceptDefinitiveSendFailure) {
        throw new Error("A pre-accept Linq definitive-send control is already armed.");
      }
      if (!Number.isSafeInteger(responseCount) || responseCount < 1) {
        throw new Error(
          "A pre-accept Linq definitive-send control requires a positive response count.",
        );
      }
      nextPreAcceptDefinitiveSendFailure = {
        expectedPath,
        matchRequest,
        remainingResponses: responseCount,
      };
    },
    armNextPreAcceptRetryableSendFailure: ({
      expectedPath,
      matchRequest,
      responseCount = hostedLocalLinqHttpAttemptsPerLogicalSend,
    }) => {
      if (nextPreAcceptRetryableSendFailure) {
        throw new Error("A pre-accept Linq retryable-send control is already armed.");
      }
      if (!Number.isSafeInteger(responseCount) || responseCount < 1) {
        throw new Error(
          "A pre-accept Linq retryable-send control requires a positive response count.",
        );
      }
      nextPreAcceptRetryableSendFailure = {
        expectedPath,
        matchRequest,
        remainingResponses: responseCount,
      };
    },
    attachmentDownloadContainerBaseUrl,
    attachmentDownloadBaseUrl,
    baseUrl,
    containerBaseUrl,
    countAcceptedSends: (expectedPath, matchRequest) =>
      acceptedSendRequests.filter((request) =>
        isMatchingObservedLinqRequest(request, "POST", expectedPath, matchRequest)
      ).length,
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
    createIMessageCapabilityRequestMatcher: ({ address }) => (request) => {
      const parsed = parseObservedLinqJson(request.body);
      return parsed?.address === address;
    },
    listObservedMessageIds: (chatId) => [...(observedMessageIdsByChat.get(chatId) ?? [])],
    observedRequests,
    readObservedMessageAppCard: readObservedLinqIMessageAppCard,
    readObservedMessageLink: readObservedLinqMessageLink,
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
    runnerBaseUrl,
    setChatIsGroup: (chatId, isGroup) => {
      canonicalGroupStateByChatId.set(chatId, isGroup);
    },
    stop: async () => {
      await stopHttpStubServer(activeServer);
      server = null;
    },
    waitForAdditionalAcceptedSend: async (input) => {
      const matchingRequests = await waitForObservedRequests({
        expectedCount: input.baselineCount + 1,
        expectedMethod: "POST",
        expectedPath: input.expectedPath,
        matchRequest: input.matchRequest,
        requests: acceptedSendRequests,
        scenario: input.scenario,
        userId: input.userId,
      });
      return matchingRequests.at(-1)!;
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
    waitForMatchingAcceptedSendCount: async (input) =>
      await waitForObservedRequests({
        expectedCount: input.expectedCount,
        expectedMethod: "POST",
        expectedPath: input.expectedPath,
        matchRequest: input.matchRequest,
        requests: acceptedSendRequests,
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
    isGroup?: boolean | null;
    messageId?: string;
    parts?: HostedLinqInboundPartInput[];
    recipientUserId?: string;
    replyToMessageId?: string;
    service?: string;
    text?: string;
  } = {},
): Record<string, unknown> {
  const recipientUserId = input.recipientUserId ?? userId;
  const service = input.service ?? "SMS";
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
        ...(input.isGroup === null ? {} : { is_group: input.isGroup ?? false }),
        owner_handle: {
          handle: buildLinqHomePhoneNumber(recipientUserId),
          id: `handle_owner_${recipientUserId}`,
          is_me: true,
          service,
        },
      },
      chat_id: chatId,
      direction: "inbound",
      from: buildLinqRecipientPhoneNumber(userId),
      from_handle: {
        handle: buildLinqRecipientPhoneNumber(userId),
        id: `handle_sender_${userId}`,
        service,
      },
      is_from_me: false,
      message: {
        id: input.messageId ?? `msg_local_${userId}`,
        parts,
        ...(input.replyToMessageId
          ? {
              reply_to: {
                message_id: input.replyToMessageId,
              },
            }
          : {}),
      },
      recipient_handle: {
        handle: buildLinqHomePhoneNumber(recipientUserId),
        id: `handle_owner_${recipientUserId}`,
        is_me: true,
        service,
      },
      recipient_phone: buildLinqHomePhoneNumber(recipientUserId),
      received_at: new Date().toISOString(),
      sender_handle: {
        handle: buildLinqRecipientPhoneNumber(userId),
        id: `handle_sender_${userId}`,
        service,
      },
      sent_at: new Date().toISOString(),
      service,
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
  const phoneLookupKey = requireLinqPhoneLookupKey(input.userId);
  const identifierBlind = createHostedAssistantConversationIdentifierBlind({
    secret: phoneLookupKey,
    userId: input.userId,
  });
  const recipientPhoneNumber = buildLinqRecipientPhoneNumber(input.userId);

  return buildHostedExecutionMemberActivatedWake({
    eventId: input.eventId,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: input.userId,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    signupWelcome: {
      route: {
        actorId: hashHostedAssistantConversationIdentifier(
          identifierBlind,
          recipientPhoneNumber,
        ),
        channel: "linq",
        delivery: {
          kind: "participant",
          source: {
            fromPhoneNumber: buildLinqHomePhoneNumber(input.userId),
            kind: "linq",
          },
          target: recipientPhoneNumber,
        },
        identityId: hashHostedAssistantConversationIdentifier(
          identifierBlind,
          phoneLookupKey,
        ),
        threadId: null,
        threadIsDirect: true,
      },
      text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
    },
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

function consumeHostedLocalLinqArmedSendFailure(
  failure: HostedLocalLinqArmedSendFailure | null,
  request: ObservedLinqRequest,
): boolean {
  if (
    !failure
    || request.method !== "POST"
    || request.url !== failure.expectedPath
    || !failure.matchRequest(request)
  ) {
    return false;
  }

  failure.remainingResponses -= 1;
  return true;
}

function writeHostedLocalLinqRetryableSendFailure(
  response: ServerResponse<IncomingMessage>,
): void {
  writeJsonResponse(response, 503, {
    error: "Synthetic hosted-local retryable Linq send failure.",
  });
}

function writeHostedLocalLinqAcceptedMessage(
  response: ServerResponse<IncomingMessage>,
  acceptedMessage: HostedLocalLinqAcceptedMessage,
): void {
  writeJsonResponse(response, 200, {
    chat_id: acceptedMessage.chatId,
    data: {
      chat_id: acceptedMessage.chatId,
      id: acceptedMessage.messageId,
    },
    message: {
      id: acceptedMessage.messageId,
    },
  });
}

function parseObservedLinqJson(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readObservedLinqMessageIdempotencyKey(
  payload: Record<string, unknown> | null,
): string | null {
  const message = payload?.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const idempotencyKey = (message as Record<string, unknown>).idempotency_key;
  return typeof idempotencyKey === "string" && idempotencyKey.trim()
    ? idempotencyKey.trim()
    : null;
}

function classifyObservedLinqAuthorization(
  authorization: string | string[] | undefined,
  expectedToken: string | null | undefined,
): ObservedLinqRequest["authorizationStatus"] {
  const value = Array.isArray(authorization)
    ? authorization.at(0)?.trim() ?? ""
    : authorization?.trim() ?? "";
  if (!value) {
    return "missing";
  }

  const expected = expectedToken?.trim() ?? "";
  if (expected && value === `Bearer ${expected}`) {
    return "expected";
  }
  if (value === `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`) {
    return "hosted-sentinel";
  }
  return expected ? "unexpected" : "present";
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

function isObservedLinqCreateAttachmentPayload(
  payload: Record<string, unknown> | null,
): payload is Record<string, unknown> & {
  content_type: string;
  filename: string;
  size_bytes: number;
} {
  return Boolean(
    payload
    && typeof payload.content_type === "string"
    && payload.content_type.trim().length > 0
    && typeof payload.filename === "string"
    && payload.filename.trim().length > 0
    && typeof payload.size_bytes === "number"
    && Number.isSafeInteger(payload.size_bytes)
    && payload.size_bytes > 0,
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

  return parts.some((part) => {
    if (!part || typeof part !== "object" || !("type" in part)) {
      return false;
    }
    if (part.type === "text") {
      return "value" in part
        && typeof part.value === "string"
        && part.value.trim().length > 0;
    }
    if (part.type === "link") {
      return parts.length === 1
        && "value" in part
        && typeof part.value === "string"
        && part.value.startsWith("https://");
    }
    if (part.type === "imessage_app") {
      return parts.length === 1
        && "url" in part
        && typeof part.url === "string"
        && part.url.startsWith("https://")
        && "fallback_text" in part
        && typeof part.fallback_text === "string"
        && part.fallback_text.trim().length > 0
        && "app" in part
        && Boolean(part.app)
        && typeof part.app === "object"
        && "layout" in part
        && Boolean(part.layout)
        && typeof part.layout === "object";
    }
    if (part.type !== "media") {
      return false;
    }
    return (
      "attachment_id" in part
      && typeof part.attachment_id === "string"
      && part.attachment_id.trim().length > 0
    ) || (
      "url" in part
      && typeof part.url === "string"
      && part.url.trim().length > 0
    );
  });
}

function readObservedLinqMessageLink(request: ObservedLinqRequest): string | null {
  const parsed = parseObservedLinqJson(request.body);
  const message = parsed?.message;

  if (!message || typeof message !== "object") {
    return null;
  }

  const parts = "parts" in message ? message.parts : null;
  if (!Array.isArray(parts) || parts.length !== 1) {
    return null;
  }

  const part = parts[0];
  return part
      && typeof part === "object"
      && "type" in part
      && part.type === "link"
      && "value" in part
      && typeof part.value === "string"
    ? part.value
    : null;
}

function readObservedLinqIMessageAppCard(
  request: ObservedLinqRequest,
): Record<string, unknown> | null {
  const parsed = parseObservedLinqJson(request.body);
  const message = parsed?.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }

  const parts = "parts" in message ? message.parts : null;
  if (!Array.isArray(parts) || parts.length !== 1) {
    return null;
  }

  const part = parts[0];
  return part
      && typeof part === "object"
      && !Array.isArray(part)
      && "type" in part
      && part.type === "imessage_app"
    ? part as Record<string, unknown>
    : null;
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

  if (part.type === "imessage_app") {
    return {
      app: part.app,
      ...(part.fallbackText ? { fallback_text: part.fallbackText } : {}),
      layout: part.layout,
      type: part.type,
      url: part.url,
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
  const extension = attachmentId.startsWith("att_pdf_")
    ? "pdf"
    : attachmentId.startsWith("att_image_")
      ? "png"
      : "wav";
  return `${attachmentDownloadBaseUrl}/${encodeURIComponent(attachmentId)}.${extension}`;
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

function buildHostedLocalLargeImagePngBytes(): Uint8Array {
  const width = HOSTED_LOCAL_LINQ_IMAGE_PNG_WIDTH;
  const height = HOSTED_LOCAL_LINQ_IMAGE_PNG_HEIGHT;
  const bytesPerPixel = 3;
  const scanlineLength = 1 + (width * bytesPerPixel);
  const raw = Buffer.allocUnsafe(scanlineLength * height);
  let offset = 0;
  let state = 0x9e3779b9;

  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      state = Math.imul(state, 1664525) + 1013904223;
      const noise = state >>> 24;
      raw[offset] = (x + noise) & 0xff;
      raw[offset + 1] = (y + (noise * 3)) & 0xff;
      raw[offset + 2] = ((x ^ y) + (noise * 7)) & 0xff;
      offset += bytesPerPixel;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return new Uint8Array(Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    buildPngChunk("IHDR", ihdr),
    buildPngChunk("IDAT", deflateSync(raw, { level: 6 })),
    buildPngChunk("IEND", Buffer.alloc(0)),
  ]));
}

function buildPngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32([typeBytes, data]), 8 + data.byteLength);
  return chunk;
}

function buildPngCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function pngCrc32(buffers: readonly Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const bytes of buffers) {
    for (const byte of bytes) {
      crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function summarizeObservedLinqRequests(
  requests: readonly ObservedLinqRequest[],
): Array<{
  authorizationStatus: ObservedLinqRequest["authorizationStatus"];
  bodyBytes: number;
  bodySha256Prefix: string;
  method: string;
  path: string;
}> {
  return requests.map((request) => ({
    authorizationStatus: request.authorizationStatus,
    bodyBytes: Buffer.byteLength(request.body, "utf8"),
    bodySha256Prefix: createHash("sha256").update(request.body).digest("hex").slice(0, 12),
    method: request.method,
    path: readObservedRequestPath(request.url),
  }));
}

function readObservedRequestPath(rawUrl: string): string {
  try {
    return new URL(rawUrl, "http://localhost").pathname;
  } catch {
    return "[invalid-url]";
  }
}

function requireBoundTcpPort(server: HttpServer, label: string): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`Expected the ${label} server to bind a TCP port.`);
  }

  return address.port;
}

function resolveHostedLocalLinqContainerHost(): string {
  const configured = process.env.HOSTED_EXECUTION_RUNNER_HOST_ALIAS?.trim();
  if (configured) {
    return configured;
  }

  if (process.platform !== "linux") {
    return "host.docker.internal";
  }

  return readLinuxDockerBridgeGatewayHost() ?? "host.docker.internal";
}

function readLinuxDockerBridgeGatewayHost(): string | null {
  const result = spawnSync(
    "docker",
    [
      "network",
      "inspect",
      "bridge",
      "--format",
      "{{range .IPAM.Config}}{{if .Gateway}}{{.Gateway}}{{end}}{{end}}",
    ],
    {
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
}

function formatHostedLocalLinqUrlHost(host: string): string {
  const normalized = host.trim();
  if (normalized.includes(":") && !normalized.startsWith("[")) {
    return `[${normalized}]`;
  }

  return normalized;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
