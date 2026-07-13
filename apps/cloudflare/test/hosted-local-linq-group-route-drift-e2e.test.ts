import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const ownerMemberId = `member_local_linq_group_route_owner_${runId}`;
const groupChatId = `chat_local_linq_group_route_${runId}`;
const ownerPhone = buildLinqRecipientPhoneNumber(ownerMemberId);
const homePhone = buildLinqHomePhoneNumber(ownerMemberId);
const linqApiToken = "linq-local-group-route-token";
const linqWebhookSecret = "linq-local-group-route-webhook-secret";
const firstInboundText = "Group route drift fixture: first group message.";
const secondInboundText = "Group route drift fixture: durable route follow-up.";
const firstReplyText = "I am staying with this group conversation.";
const secondReplyText = "The group route is still authoritative.";
const groupReplyPath = `/chats/${encodeURIComponent(groupChatId)}/messages`;
const canonicalChatPath = `/chats/${encodeURIComponent(groupChatId)}`;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local Linq group route drift e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      canonicalChats: [
        {
          chatId: groupChatId,
          handles: [
            {
              handle: homePhone,
              isMe: true,
              status: "active",
            },
            {
              handle: ownerPhone,
              isMe: false,
              status: "active",
            },
          ],
          isGroup: true,
        },
      ],
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: ownerPhone,
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-linq-group-route-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted Linq group route drift e2e",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 180_000);

  it("keeps a canonically classified group on its durable route when webhook directness drifts", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: ownerMemberId,
      memberPhone: ownerPhone,
    });
    requireScenario().queueAssistantResponses([firstReplyText], {
      matchInputContains: firstInboundText,
    });
    requireScenario().queueAssistantResponses([secondReplyText], {
      matchInputContains: secondInboundText,
    });

    const outboundBaseline = requireLinqStub().countObservedSends(groupReplyPath);
    const createChatBaseline = requireLinqStub().countObservedSends(
      requireLinqStub().createChatPath,
    );
    const canonicalReadBaseline = countCanonicalChatReads();
    const providerRequestBaseline = requireScenario().assistantProviderRequests.length;

    const firstResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      ownerMemberId,
      groupChatId,
      {
        eventId: `evt_group_route_omitted_${runId}`,
        isGroup: null,
        messageId: `msg_group_route_omitted_${runId}`,
        service: "iMessage",
        text: firstInboundText,
      },
    ));
    expect(firstResponse.status).toBe(202);
    await expect(firstResponse.json()).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });

    const firstSends = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: outboundBaseline + 1,
      expectedPath: groupReplyPath,
      scenario: requireScenario(),
      userId: ownerMemberId,
    });
    const firstSend = firstSends.at(-1);
    if (!firstSend) {
      throw new Error("Expected the first durable group-route reply to be observed.");
    }
    expect(requireLinqStub().readObservedMessageText(firstSend)).toBe(firstReplyText);
    expect(firstSend.authorizationStatus).toBe("hosted-sentinel");

    const provisionReads = await requireLinqStub().waitForMatchingRequestCount({
      expectedCount: canonicalReadBaseline + 2,
      expectedMethod: "GET",
      expectedPath: canonicalChatPath,
      scenario: requireScenario(),
      userId: ownerMemberId,
    });
    expect(provisionReads.slice(canonicalReadBaseline)).toHaveLength(2);
    expect(provisionReads.slice(canonicalReadBaseline).every((request) =>
      request.authorizationStatus === "expected"
    )).toBe(true);
    const canonicalReadsAfterProvision = countCanonicalChatReads();

    const secondResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      ownerMemberId,
      groupChatId,
      {
        eventId: `evt_group_route_reported_direct_${runId}`,
        isGroup: false,
        messageId: `msg_group_route_reported_direct_${runId}`,
        service: "iMessage",
        text: secondInboundText,
      },
    ));
    expect(secondResponse.status).toBe(202);
    await expect(secondResponse.json()).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });

    const allSends = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: outboundBaseline + 2,
      expectedPath: groupReplyPath,
      scenario: requireScenario(),
      userId: ownerMemberId,
    });
    const newSends = allSends.slice(outboundBaseline);
    expect(newSends.map((request) =>
      requireLinqStub().readObservedMessageText(request)
    )).toEqual([firstReplyText, secondReplyText]);
    expect(newSends.every((request) =>
      request.authorizationStatus === "hosted-sentinel"
    )).toBe(true);

    expect(countCanonicalChatReads()).toBe(canonicalReadsAfterProvision);
    expect(requireLinqStub().countObservedSends(requireLinqStub().createChatPath)).toBe(
      createChatBaseline,
    );

    const providerBodies = requireScenario().assistantProviderRequests
      .slice(providerRequestBaseline)
      .map((request) => request.body);
    expect(providerBodies.some((body) => body.includes(firstInboundText))).toBe(true);
    expect(providerBodies.some((body) => body.includes(secondInboundText))).toBe(true);
    expect(providerBodies.filter((body) =>
      body.includes(firstInboundText) || body.includes(secondInboundText)
    ).every((body) => body.includes("thread is direct: false"))).toBe(true);
  }, 420_000);
});

function countCanonicalChatReads(): number {
  return requireLinqStub().countObservedRequests({
    expectedMethod: "GET",
    expectedPath: canonicalChatPath,
  });
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return await fetch(
    `${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`,
    {
      body: rawBody,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-webhook-signature": `sha256=${signature}`,
        "x-webhook-timestamp": timestamp,
      },
      method: "POST",
    },
  );
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
