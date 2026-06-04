import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

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
const userId = `member_local_warm_reuse_${runId}`;
const chatId = `chat_local_warm_reuse_${runId}`;
const linqWebhookSecret = "linq-local-warm-reuse-secret";
const productionLikeAssistantModel = "gpt-5.5";
const firstUserText = "warm reuse setup input";
const secondUserText = "warm reuse followup input";
const firstReplyText = "Warm reuse setup reply.";
const secondReplyText = "Warm reuse followup reply.";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;
let linqStub: HostedLocalLinqStub | null = null;

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local runner warm reuse e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 300_000);

  it("processes consecutive foreground nudges through a warm runner", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const homePhone = buildLinqHomePhoneNumber(userId);
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;

    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    const baselineSendCount = requireLinqStub().countObservedSends(replyPath);
    requireScenario().queueAssistantResponses([firstReplyText, secondReplyText]);

    const firstWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_warm_reuse_first_${runId}`,
        messageId: `msg_warm_reuse_first_${runId}`,
        text: firstUserText,
      }),
    );
    expect(firstWebhookResponse.status).toBe(202);

    await requireScenario().waitForLatestPendingWake(userId);
    const firstReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSendCount,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(firstReply)).toBe(firstReplyText);
    const firstStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(firstStatus.lastErrorCode ?? null).toBeNull();

    const secondWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_warm_reuse_second_${runId}`,
        messageId: `msg_warm_reuse_second_${runId}`,
        text: secondUserText,
      }),
    );
    expect(secondWebhookResponse.status).toBe(202);

    await requireScenario().waitForLatestPendingWake(userId);
    const secondReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSendCount + 1,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(secondReply)).toBe(secondReplyText);

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
  }, 600_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "15000",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().containerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-warm-reuse-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted runner warm reuse e2e",
    streamLogs: streamDevLogs,
  });
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signLinqWebhook(linqWebhookSecret, body, timestamp);
  return await fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": signature,
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
}

function buildActivationWake(userId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:evt_runner_warm_reuse`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: userId,
    occurredAt: new Date().toISOString(),
  });
}

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return `sha256=${signature}`;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not started.");
  }
  return linqStub;
}
