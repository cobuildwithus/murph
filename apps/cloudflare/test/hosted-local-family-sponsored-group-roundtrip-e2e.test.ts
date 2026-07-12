import { createHmac } from "node:crypto";

import { seedHostedFamilySponsoredLinqMember } from "#hosted-web-testing";
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
const familyOwnerMemberId = `member_local_family_owner_${runId}`;
const sponsoredMemberId = `member_local_family_sponsored_${runId}`;
const familyGroupId = `family_group_local_${runId}`;
const groupChatId = `chat_local_family_sponsored_${runId}`;
const sponsoredMemberPhone = buildLinqRecipientPhoneNumber(sponsoredMemberId);
const homePhone = buildLinqHomePhoneNumber(sponsoredMemberId);
const linqApiToken = "linq-local-family-sponsored-token";
const linqWebhookSecret = "linq-local-family-sponsored-webhook-secret";
const inboundText = "Family-sponsored group roundtrip fixture.";
const replyText = "Family access is active in this group conversation.";
const groupReplyPath = `/chats/${encodeURIComponent(groupChatId)}/messages`;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local family-sponsored group roundtrip e2e", () => {
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
              handle: sponsoredMemberPhone,
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
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          sponsoredMemberPhone,
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-family-sponsored-group-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted family-sponsored group roundtrip e2e",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 180_000);

  it("routes a family-sponsored member's first group message through a real assistant turn", async () => {
    await seedHostedFamilySponsoredLinqMember({
      environment: requireScenario().runtimeEnv,
      groupId: familyGroupId,
      homePhone,
      memberId: sponsoredMemberId,
      memberPhone: sponsoredMemberPhone,
      ownerMemberId: familyOwnerMemberId,
    });
    requireScenario().queueAssistantResponses([replyText], {
      matchInputContains: inboundText,
    });

    const outboundBaseline = requireLinqStub().countObservedSends(groupReplyPath);
    const createChatBaseline = requireLinqStub().countObservedSends(
      requireLinqStub().createChatPath,
    );
    const providerRequestBaseline = requireScenario().assistantProviderRequests.length;

    const response = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      sponsoredMemberId,
      groupChatId,
      {
        eventId: `evt_family_sponsored_group_${runId}`,
        isGroup: true,
        messageId: `msg_family_sponsored_group_${runId}`,
        service: "iMessage",
        text: inboundText,
      },
    ));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });

    const sends = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: outboundBaseline + 1,
      expectedPath: groupReplyPath,
      scenario: requireScenario(),
      userId: sponsoredMemberId,
    });
    const newSends = sends.slice(outboundBaseline);
    expect(newSends).toHaveLength(1);
    const reply = newSends[0];
    if (!reply) {
      throw new Error("Expected the family-sponsored group reply to be observed.");
    }
    expect(requireLinqStub().readObservedMessageText(reply)).toBe(replyText);
    expect(reply.authorizationStatus).toBe("hosted-sentinel");
    expect(requireLinqStub().countObservedSends(requireLinqStub().createChatPath)).toBe(
      createChatBaseline,
    );

    const matchingProviderBodies = requireScenario().assistantProviderRequests
      .slice(providerRequestBaseline)
      .map((request) => request.body)
      .filter((body) => body.includes(inboundText));
    expect(matchingProviderBodies).toHaveLength(1);
    expect(matchingProviderBodies[0]).toContain("thread is direct: false");
  }, 420_000);
});

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
