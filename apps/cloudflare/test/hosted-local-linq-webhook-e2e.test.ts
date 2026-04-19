import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
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

const webhookUserId = `member_local_linq_webhook_${Date.now()}`;
const linqWebhookSecret = "linq-local-webhook-secret";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

it("derives stable numeric suffixes from the full Linq user id", () => {
  expect(buildStableNumericSuffix("member_local_linq_webhook_20260408", 7)).not.toBe(
    buildStableNumericSuffix("member_local_linq_webhook_rapid_20260408", 7),
  );
});

describe("hosted local Linq webhook e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub();
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        LINQ_API_BASE_URL: requireLinqStub().baseUrl,
        LINQ_API_TOKEN: "linq-local-test-token",
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-linq-webhook-",
      requiredRunnerEnvProfile: "linq",
      resolveAssistantReplyText: resolveHostedLinqAssistantReplyText,
      scenarioLabel: "Local hosted Linq webhook e2e",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  });

  it("routes a signed Linq webhook through apps/web and delivers the follow-up reply", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(webhookUserId),
      memberId: webhookUserId,
      memberPhone: buildLinqRecipientPhoneNumber(webhookUserId),
    });

    await requireScenario().runWake(buildActivationWake(webhookUserId), webhookUserId);
    await requireScenario().waitForHostedCompletion(webhookUserId);
    await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(webhookUserId),
      scenario: requireScenario(),
      userId: webhookUserId,
    });

    const materializedChatId = requireLinqStub().requireObservedChatId(webhookUserId);
    const expectedReplyChatPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const webhookEvent = buildHostedLinqInboundEvent(webhookUserId, materializedChatId, {
      eventId: `evt_webhook_${webhookUserId}`,
      messageId: `msg_webhook_${webhookUserId}`,
      text: "U can call me Rocket Man",
    });

    const webhookResponse = await postSignedLinqWebhook(webhookEvent);
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(webhookUserId);
    await requireScenario().waitForHostedCompletion(webhookUserId);

    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedReplyChatPath,
      scenario: requireScenario(),
      userId: webhookUserId,
    });
    expect(requireLinqStub().readObservedMessageText(replySend)).toBe(
      "Got it — I’ll call you Rocket Man.\n\nWhat are your health goals right now?",
    );
    expect(requireScenario().assistantProviderBodies.at(-1)).toContain("Rocket Man");
  }, 300_000);

  it("keeps Linq context when two signed webhooks arrive before hosted completion catches up", async () => {
    const fastWebhookUserId = `${webhookUserId}_rapid`;
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(fastWebhookUserId),
      memberId: fastWebhookUserId,
      memberPhone: buildLinqRecipientPhoneNumber(fastWebhookUserId),
    });

    await requireScenario().runWake(
      buildActivationWake(fastWebhookUserId),
      fastWebhookUserId,
    );
    await requireScenario().waitForHostedCompletion(fastWebhookUserId);
    await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(fastWebhookUserId),
      scenario: requireScenario(),
      userId: fastWebhookUserId,
    });

    const materializedChatId = requireLinqStub().requireObservedChatId(fastWebhookUserId);
    const expectedReplyChatPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const assistantProviderBodyCountBeforeReply = requireScenario().assistantProviderBodies.length;

    const firstWebhook = buildHostedLinqInboundEvent(fastWebhookUserId, materializedChatId, {
      eventId: `evt_webhook_name_${fastWebhookUserId}`,
      messageId: `msg_webhook_name_${fastWebhookUserId}`,
      text: "U can call me Rocket Man",
    });
    const secondWebhook = buildHostedLinqInboundEvent(fastWebhookUserId, materializedChatId, {
      eventId: `evt_webhook_goals_${fastWebhookUserId}`,
      messageId: `msg_webhook_goals_${fastWebhookUserId}`,
      text: "I want to build more strength, improve endurance, and get fitter overall.",
    });

    const firstResponse = await postSignedLinqWebhook(firstWebhook);
    const secondResponse = await postSignedLinqWebhook(secondWebhook);

    expect(firstResponse.status).toBe(202);
    await expect(firstResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(secondResponse.status).toBe(202);
    await expect(secondResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(fastWebhookUserId);
    await requireScenario().waitForHostedCompletion(fastWebhookUserId);

    const replySends = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: outboundCountBeforeReply + 1,
      expectedPath: expectedReplyChatPath,
      scenario: requireScenario(),
      userId: fastWebhookUserId,
    });
    const newReplySends = replySends.slice(outboundCountBeforeReply);
    expect(newReplySends).toHaveLength(1);
    const groupedReplyText = requireLinqStub().readObservedMessageText(newReplySends[0]!);

    expect(groupedReplyText).toBe(
      "What should I call you? And out of those, which ones matter most to you right now?",
    );
    expect(groupedReplyText).not.toContain("Hey, I'm Murph");
    expect(requireScenario().assistantProviderBodies).toHaveLength(
      assistantProviderBodyCountBeforeReply + 1,
    );
    expect(requireScenario().assistantProviderBodies.at(-1)).toContain("Rocket Man");
    expect(requireScenario().assistantProviderBodies.at(-1)).toContain("build more strength");
    expect(requireScenario().assistantProviderBodies.at(-1)).not.toContain("I’ll call you Rocket Man");
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
