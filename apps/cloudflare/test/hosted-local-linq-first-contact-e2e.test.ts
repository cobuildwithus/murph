import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
  DEFAULT_DATABASE_URL,
} from "../../../scripts/dev-hosted-local/constants.ts";
import { buildStableNumericSuffix } from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  requireLinqPhoneLookupKey,
  resolveHostedLinqAssistantReplyText,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const userId = `member_local_linq_first_contact_${Date.now()}`;
const directReplyUserId = `member_local_linq_direct_reply_${Date.now()}`;
const fastReplyUserId = `member_local_linq_fast_reply_${Date.now()}`;

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
    linqStub = await startHostedLocalLinqStub();
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        LINQ_API_BASE_URL: requireLinqStub().baseUrl,
        LINQ_API_TOKEN: "linq-local-test-token",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-linq-first-contact-",
      requiredRunnerEnvProfile: "linq",
      resolveAssistantReplyText: resolveHostedLinqAssistantReplyText,
      scenarioLabel: "Local hosted Linq e2e",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  });

  it("sends the first-contact Linq welcome through the live local worker", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone: buildLinqRecipientPhoneNumber(userId),
    });
    await requireScenario().dispatchWake(buildActivationWake(userId), userId);

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.bundleRef).not.toBeNull();
    expect(finalStatus.lastError).toBeNull();
    expect(finalStatus.pendingEventCount).toBe(0);

    const sendRequest = await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(userId),
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().requireObservedChatId(userId)).toEqual(expect.any(String));
    expect(sendRequest.method).toBe("POST");
    expect(sendRequest.url).toBe(requireLinqStub().createChatPath);
    expect(JSON.parse(sendRequest.body)).toMatchObject({
      from: buildLinqHomePhoneNumber(userId),
      message: {
        idempotency_key: expect.stringContaining("assistant-first-contact"),
        parts: [
          {
            type: "text",
            value: expect.stringContaining("Murph"),
          },
        ],
      },
      to: [buildLinqRecipientPhoneNumber(userId)],
    });
  }, 300_000);

  it("sends a Linq reply after a later inbound Linq message", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(directReplyUserId),
      memberId: directReplyUserId,
      memberPhone: buildLinqRecipientPhoneNumber(directReplyUserId),
    });
    await requireScenario().dispatchWake(
      buildActivationWake(directReplyUserId),
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
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedDirectReplyChatPath);
    const inboundWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: `linq.message.received:local:${directReplyUserId}:evt_direct_reply`,
      linqEvent: buildHostedLinqInboundEvent(directReplyUserId, materializedChatId),
      linqMessageId: `msg_local_${directReplyUserId}`,
      occurredAt: new Date().toISOString(),
      phoneLookupKey: requireLinqPhoneLookupKey(directReplyUserId),
      userId: directReplyUserId,
    });
    await requireScenario().dispatchWake(inboundWake, directReplyUserId);

    await requireScenario().waitForHostedCompletion(directReplyUserId);
    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedDirectReplyChatPath,
      scenario: requireScenario(),
      userId: directReplyUserId,
    });
    expect(replySend.method).toBe("POST");
  }, 300_000);

  it("keeps Linq context when two replies arrive before hosted completion catches up", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(fastReplyUserId),
      memberId: fastReplyUserId,
      memberPhone: buildLinqRecipientPhoneNumber(fastReplyUserId),
    });
    await requireScenario().dispatchWake(buildActivationWake(fastReplyUserId), fastReplyUserId);

    const createChatRequest = await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(fastReplyUserId),
      scenario: requireScenario(),
      userId: fastReplyUserId,
    });
    expect(createChatRequest.method).toBe("POST");

    const materializedChatId = requireLinqStub().requireObservedChatId(fastReplyUserId);
    const expectedDirectReplyChatPath =
      `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedDirectReplyChatPath);

    const firstInboundWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: `linq.message.received:local:${fastReplyUserId}:evt_fast_reply_name`,
      linqEvent: buildHostedLinqInboundEvent(fastReplyUserId, materializedChatId, {
        messageId: `msg_fast_name_${fastReplyUserId}`,
        text: "U can call me Rocket Man",
      }),
      linqMessageId: `msg_fast_name_${fastReplyUserId}`,
      occurredAt: new Date().toISOString(),
      phoneLookupKey: requireLinqPhoneLookupKey(fastReplyUserId),
      userId: fastReplyUserId,
    });
    await requireScenario().dispatchWake(firstInboundWake, fastReplyUserId);

    const secondInboundWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: `linq.message.received:local:${fastReplyUserId}:evt_fast_reply_goals`,
      linqEvent: buildHostedLinqInboundEvent(fastReplyUserId, materializedChatId, {
        messageId: `msg_fast_goals_${fastReplyUserId}`,
        text: "I want to build more strength, improve endurance, and get fitter overall.",
      }),
      linqMessageId: `msg_fast_goals_${fastReplyUserId}`,
      occurredAt: new Date().toISOString(),
      phoneLookupKey: requireLinqPhoneLookupKey(fastReplyUserId),
      userId: fastReplyUserId,
    });
    await requireScenario().dispatchWake(secondInboundWake, fastReplyUserId);

    const statusBeforeWait = await requireScenario().harness.readUserStatus(fastReplyUserId);
    await requireScenario().waitForHostedCompletion(fastReplyUserId);
    const statusAfterWait = await requireScenario().harness.readUserStatus(fastReplyUserId);

    const replySends = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: outboundCountBeforeReply + 2,
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
          observedAssistantProviderBodies: requireScenario().assistantProviderBodies,
          statusAfterWait,
          statusBeforeWait,
        })}`,
      );
    }

    const newReplySends = replySends.slice(outboundCountBeforeReply);
    const firstReplyText = requireLinqStub().readObservedMessageText(newReplySends[0]!);
    const secondReplyText = requireLinqStub().readObservedMessageText(newReplySends[1]!);
    if (secondReplyText !== "Got you — stronger, fitter, faster, and more endurance.") {
      throw new Error(
        `Unexpected second Linq reply: ${JSON.stringify({
          firstReplyText,
          observedAssistantProviderBodies: requireScenario().assistantProviderBodies,
          secondReplyText,
        })}`,
      );
    }
    expect(firstReplyText).toBe("Got it — I’ll call you Rocket Man.\n\nWhat are your health goals right now?");
    expect(secondReplyText).toBe("Got you — stronger, fitter, faster, and more endurance.");
    expect(secondReplyText).not.toContain("What should I call you");
    expect(secondReplyText).not.toContain("Hey, I'm Murph");
    expect(requireScenario().assistantProviderBodies).toHaveLength(3);
    expect(requireScenario().assistantProviderBodies.at(-1)).toContain("Rocket Man");
    expect(requireScenario().assistantProviderBodies.at(-1)).toContain("build more strength");
  }, 300_000);
});

function buildActivationWake(userId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:evt_linq_first_contact`,
    firstContact: {
      channel: "linq",
      fromPhoneNumber: buildLinqHomePhoneNumber(userId),
      identityId: requireLinqPhoneLookupKey(userId),
      kind: "linq-materialize-home-thread",
      toPhoneNumber: buildLinqRecipientPhoneNumber(userId),
    },
    memberId: userId,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    occurredAt: new Date().toISOString(),
  });
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
