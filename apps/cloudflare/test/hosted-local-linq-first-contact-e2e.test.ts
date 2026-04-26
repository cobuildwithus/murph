import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
  DEFAULT_DATABASE_URL,
} from "../../../scripts/dev-hosted-local/constants.ts";
import {
  buildHostedAssistantNotificationDecisionResponse,
  buildStableNumericSuffix,
} from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqSignupWelcomeWake,
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  HOSTED_LINQ_DEFAULT_ASSISTANT_REPLY_TEXT,
  HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT,
  startHostedLocalLinqStub,
  type ObservedLinqRequest,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const userId = `member_local_linq_first_contact_${Date.now()}`;
const directReplyUserId = `member_local_linq_direct_reply_${Date.now()}`;
const fastReplyUserId = `member_local_linq_fast_reply_${Date.now()}`;
const linqWebhookSecret = "linq-local-webhook-secret";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

it("derives stable numeric suffixes from the full Linq user id", () => {
  expect(buildStableNumericSuffix("member_local_linq_first_contact_20260408", 7)).not.toBe(
    buildStableNumericSuffix("member_local_linq_direct_reply_20260408", 7),
  );
});

describe("hosted local Linq first-contact e2e", () => {
  beforeAll(async () => {
    await startLinqScenario();
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 120_000);

  it("sends the first-contact Linq welcome through the live local worker", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone: buildLinqRecipientPhoneNumber(userId),
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    await requireScenario().waitForHostedCompletion(userId);
    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver signup welcome",
        text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      }),
    ]);
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId: `assistant.notification.requested:local:${userId}:evt_linq_first_contact`,
        userId,
      }),
      userId,
    );

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.bundleRef).not.toBeNull();
    expect(finalStatus.lastError).toBeNull();
    expect(finalStatus.pendingIngressEventCount).toBe(0);

    const sendRequest = await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(userId),
      scenario: requireScenario(),
      userId,
    });
    const materializedChatId = requireLinqStub().requireObservedChatId(userId);
    const welcomeMessageId = requireLinqStub().requireLatestObservedMessageId(materializedChatId);
    expect(materializedChatId).toEqual(expect.any(String));
    expect(sendRequest.method).toBe("POST");
    expect(sendRequest.url).toBe(requireLinqStub().createChatPath);
    expect(JSON.parse(sendRequest.body)).toMatchObject({
      from: buildLinqHomePhoneNumber(userId),
      message: {
        idempotency_key: `signup-welcome:${userId}`,
        parts: [
          {
            type: "text",
            value: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
          },
        ],
      },
      to: [buildLinqRecipientPhoneNumber(userId)],
    });
    await requireLinqStub().waitForMatchingRequestCount({
      expectedCount: 1,
      expectedMethod: "DELETE",
      expectedPath: `/messages/${encodeURIComponent(welcomeMessageId)}`,
      scenario: requireScenario(),
      userId,
    });
  }, 300_000);

  it("sends a Linq reply after a later inbound Linq message", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(directReplyUserId),
      memberId: directReplyUserId,
      memberPhone: buildLinqRecipientPhoneNumber(directReplyUserId),
    });
    await requireScenario().runWake(
      buildActivationWake(directReplyUserId),
      directReplyUserId,
    );
    await requireScenario().waitForHostedCompletion(directReplyUserId);
    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver signup welcome",
        text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      }),
    ]);
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId:
          `assistant.notification.requested:local:${directReplyUserId}:evt_linq_direct_reply`,
        userId: directReplyUserId,
      }),
      directReplyUserId,
    );
    await requireScenario().waitForHostedCompletion(directReplyUserId);
    await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(directReplyUserId),
      scenario: requireScenario(),
      userId: directReplyUserId,
    });

    const materializedChatId = requireLinqStub().requireObservedChatId(directReplyUserId);
    const expectedDirectReplyChatPath =
      `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const expectedTypingPath = `/chats/${encodeURIComponent(materializedChatId)}/typing`;
    const observedMessageIdsBeforeReply =
      requireLinqStub().listObservedMessageIds(materializedChatId).length;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedDirectReplyChatPath);
    const typingStopCountBeforeReply = countObservedLinqRequests({
      expectedMethod: "DELETE",
      expectedPath: expectedTypingPath,
    });
    const requestCountBeforeReply = requireLinqStub().observedRequests.length;
    requireScenario().queueAssistantResponses([HOSTED_LINQ_DEFAULT_ASSISTANT_REPLY_TEXT]);
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      directReplyUserId,
      materializedChatId,
      {
        eventId: `evt_direct_reply_${directReplyUserId}`,
        messageId: `msg_direct_reply_${directReplyUserId}`,
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(directReplyUserId);
    const completionPromise = requireScenario()
      .waitForHostedCompletion(directReplyUserId);
    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedDirectReplyChatPath,
      scenario: requireScenario(),
      userId: directReplyUserId,
    });
    const typingStop = await waitForAdditionalObservedLinqRequest({
      baselineCount: typingStopCountBeforeReply,
      expectedMethod: "DELETE",
      expectedPath: expectedTypingPath,
      userId: directReplyUserId,
    });
    const requestsAfterInbound = requireLinqStub().observedRequests.slice(requestCountBeforeReply);
    const typingRequestsAfterInbound = requestsAfterInbound.filter((request) =>
      request.method === "POST" && request.url === expectedTypingPath
    );
    const typingStopRequestsAfterInbound = requestsAfterInbound.filter((request) =>
      request.method === "DELETE" && request.url === expectedTypingPath
    );
    expect(replySend.method).toBe("POST");
    expect(typingRequestsAfterInbound.length).toBeGreaterThanOrEqual(1);
    expect(typingStopRequestsAfterInbound.length).toBeGreaterThanOrEqual(1);

    const sendIndex = requestsAfterInbound.indexOf(replySend);
    const typingIndices = typingRequestsAfterInbound.map((request) =>
      requestsAfterInbound.indexOf(request)
    );
    const typingStopIndex = requestsAfterInbound.indexOf(typingStop);

    expect(sendIndex).toBeGreaterThanOrEqual(0);
    expect(typingIndices[0]).toBeGreaterThanOrEqual(0);
    expect(sendIndex).toBeGreaterThan(typingIndices[0]);
    expect(typingStopIndex).toBeGreaterThan(typingIndices[0]);
    expect(typingStopIndex).toBeLessThan(sendIndex);
    expect(typingRequestsAfterInbound.every((request) =>
      requestsAfterInbound.indexOf(request) < sendIndex
    )).toBe(true);
    expect(requireLinqStub().readObservedMessageText(replySend)).toBe(
      HOSTED_LINQ_DEFAULT_ASSISTANT_REPLY_TEXT,
    );
    const outboundReplyMessageId =
      requireLinqStub().listObservedMessageIds(materializedChatId)[observedMessageIdsBeforeReply] ?? null;
    expect(outboundReplyMessageId).not.toBeNull();
    const finalStatus = await completionPromise;
    expect(finalStatus.pendingIngressEventCount).toBe(0);
    expect(finalStatus.lastError).toBeNull();
    await requireLinqStub().waitForMatchingRequestCount({
      expectedCount: 1,
      expectedMethod: "DELETE",
      expectedPath: `/messages/${encodeURIComponent(`msg_direct_reply_${directReplyUserId}`)}`,
      scenario: requireScenario(),
      userId: directReplyUserId,
    });
    await requireLinqStub().waitForMatchingRequestCount({
      expectedCount: 1,
      expectedMethod: "DELETE",
      expectedPath: `/messages/${encodeURIComponent(outboundReplyMessageId!)}`,
      scenario: requireScenario(),
      userId: directReplyUserId,
    });
  }, 300_000);

  it("keeps Linq context when two messages arrive before hosted completion catches up", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(fastReplyUserId),
      memberId: fastReplyUserId,
      memberPhone: buildLinqRecipientPhoneNumber(fastReplyUserId),
    });
    await requireScenario().runWake(buildActivationWake(fastReplyUserId), fastReplyUserId);
    await requireScenario().waitForHostedCompletion(fastReplyUserId);
    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver signup welcome",
        text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      }),
    ]);
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId: `assistant.notification.requested:local:${fastReplyUserId}:evt_linq_fast_reply`,
        userId: fastReplyUserId,
      }),
      fastReplyUserId,
    );

    const createChatRequest = await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(fastReplyUserId),
      scenario: requireScenario(),
      userId: fastReplyUserId,
    });
    expect(createChatRequest.method).toBe("POST");
    await requireScenario().waitForHostedCompletion(fastReplyUserId);

    const materializedChatId = requireLinqStub().requireObservedChatId(fastReplyUserId);
    const expectedDirectReplyChatPath =
      `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const observedMessageIdsBeforeReply =
      requireLinqStub().listObservedMessageIds(materializedChatId).length;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedDirectReplyChatPath);

    requireScenario().queueAssistantResponses([HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT]);
    const firstInboundMessageId = `msg_fast_name_${fastReplyUserId}`;
    const firstWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      fastReplyUserId,
      materializedChatId,
      {
        eventId: `evt_fast_reply_name_${fastReplyUserId}`,
        messageId: firstInboundMessageId,
        text: "U can call me Rocket Man",
      },
    ));
    const secondInboundMessageId = `msg_fast_goals_${fastReplyUserId}`;
    const secondWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      fastReplyUserId,
      materializedChatId,
      {
        eventId: `evt_fast_reply_goals_${fastReplyUserId}`,
        messageId: secondInboundMessageId,
        text: "I want to build more strength, improve endurance, and get fitter overall.",
      },
    ));
    expect(firstWebhookResponse.status).toBe(202);
    await expect(firstWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(secondWebhookResponse.status).toBe(202);
    await expect(secondWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const statusBeforeWait = await requireScenario().harness.readUserStatus(fastReplyUserId);
    await requireScenario().waitForLatestPendingWake(fastReplyUserId);
    await requireScenario().waitForHostedCompletion(fastReplyUserId);
    const statusAfterWait = await requireScenario().harness.readUserStatus(fastReplyUserId);

    const replySends = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: outboundCountBeforeReply + 1,
      expectedPath: expectedDirectReplyChatPath,
      scenario: requireScenario(),
      userId: fastReplyUserId,
    });
    const createChatRequests = requireLinqStub().observedRequests.filter((request) =>
      request.url === requireLinqStub().createChatPath
      && requireLinqStub().createCreateChatRequestMatcher(fastReplyUserId)(request)
    );
    if (createChatRequests.length !== 1) {
      throw new Error(
        `Expected exactly one Linq chat materialization for ${fastReplyUserId}, saw ${
          createChatRequests.length
        }: ${JSON.stringify({
          createChatRequests: createChatRequests.map((request) => ({
            text: requireLinqStub().readObservedMessageText(request),
            url: request.url,
          })),
          statusAfterWait,
          statusBeforeWait,
        })}`,
      );
    }

    const newReplySends = replySends.slice(outboundCountBeforeReply);
    expect(newReplySends).toHaveLength(1);
    const groupedReplyText = requireLinqStub().readObservedMessageText(newReplySends[0]!);
    expect(groupedReplyText).toBe(HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT);
    const outboundReplyMessageId =
      requireLinqStub().listObservedMessageIds(materializedChatId)[observedMessageIdsBeforeReply] ?? null;
    expect(outboundReplyMessageId).not.toBeNull();
    for (const messageId of [firstInboundMessageId, secondInboundMessageId, outboundReplyMessageId!]) {
      await requireLinqStub().waitForMatchingRequestCount({
        expectedCount: 1,
        expectedMethod: "DELETE",
        expectedPath: `/messages/${encodeURIComponent(messageId)}`,
        scenario: requireScenario(),
        userId: fastReplyUserId,
      });
    }
  }, 300_000);
});

function buildActivationWake(userId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:evt_linq_first_contact`,
    memberId: userId,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    occurredAt: new Date().toISOString(),
  });
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signLinqWebhook(linqWebhookSecret, rawBody, timestamp);

  return await fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body: rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": signature,
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
}

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return `sha256=${signature}`;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not initialized.");
  }

  return linqStub;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }

  return scenario;
}

function countObservedLinqRequests(input: {
  expectedMethod: string;
  expectedPath: string;
}): number {
  return requireLinqStub().observedRequests.filter((request) =>
    isMatchingObservedLinqRequest(request, input)
  ).length;
}

async function waitForAdditionalObservedLinqRequest(input: {
  baselineCount: number;
  expectedMethod: string;
  expectedPath: string;
  userId: string;
}): Promise<ObservedLinqRequest> {
  const matchingRequests = await waitForObservedLinqRequestCount({
    expectedCount: input.baselineCount + 1,
    expectedMethod: input.expectedMethod,
    expectedPath: input.expectedPath,
    userId: input.userId,
  });

  return matchingRequests.at(-1)!;
}

async function waitForObservedLinqRequestCount(input: {
  expectedCount: number;
  expectedMethod: string;
  expectedPath: string;
  userId: string;
}): Promise<ObservedLinqRequest[]> {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < 60_000) {
    const matchingRequests = requireLinqStub().observedRequests.filter((request) =>
      isMatchingObservedLinqRequest(request, input)
    );

    if (matchingRequests.length >= input.expectedCount) {
      return matchingRequests;
    }

    await sleep(250);
  }

  throw new Error(
    await requireScenario().buildFailureMessage(input.userId, [
      `Timed out waiting for ${input.expectedCount} Linq request(s) for ${input.userId}.`,
      `expected method: ${input.expectedMethod}`,
      `expected path: ${input.expectedPath}`,
      `observed requests: ${JSON.stringify(requireLinqStub().observedRequests)}`,
    ]),
  );
}

function isMatchingObservedLinqRequest(
  request: ObservedLinqRequest,
  input: {
    expectedMethod: string;
    expectedPath: string;
  },
): boolean {
  return request.method === input.expectedMethod && request.url === input.expectedPath;
}

async function startLinqScenario(
  additionalEnv: NodeJS.ProcessEnv = {},
): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      LINQ_API_BASE_URL: requireLinqStub().baseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      ...additionalEnv,
    },
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-linq-first-contact-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Linq e2e",
    streamLogs: streamDevLogs,
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
