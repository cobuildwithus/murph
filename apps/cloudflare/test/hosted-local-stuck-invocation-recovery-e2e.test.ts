import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionLinqConversationMessageWake,
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
  requireLinqPhoneLookupKey,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const userId = `member_local_stuck_invocation_${runId}`;
const chatId = `chat_local_stuck_invocation_${runId}`;
const linqWebhookSecret = "linq-local-stuck-invocation-secret";
const productionLikeAssistantModel = "gpt-5.5";
const firstUserText = "stuck invocation setup input";
const firstReplyText = "Setup reply before stale invocation.";
const userText = "stuck invocation recovery input";
const replyText = "Recovered stale invocation reply.";

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

describe("hosted local stuck invocation recovery e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 300_000);

  it("replays mailbox work from a durable alarm after the local invocation lock is stale", async () => {
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
    requireScenario().queueAssistantResponses([
      firstReplyText,
    ]);
    const firstWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_stuck_invocation_setup_${runId}`,
        messageId: `msg_stuck_invocation_setup_${runId}`,
        text: firstUserText,
      }),
    );
    expect(firstWebhookResponse.status).toBe(202);
    await expect(firstWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const firstReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSendCount,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(firstReply)).toBe(firstReplyText);
    await requireScenario().waitForHostedCompletion(userId);

    const recoveryBaselineSendCount = requireLinqStub().countObservedSends(replyPath);
    const baselineProviderRequestCount = countAssistantProviderResponsesApiRequests();
    requireScenario().queueAssistantResponses([replyText]);

    await requireScenario().enqueueWake(buildInboundLinqWake(), userId);

    const stuckInvocation = await requireScenario().harness.startStuckInvocationForTest(userId);
    expect(stuckInvocation.ok).toBe(true);
    expect(stuckInvocation.attemptId).toMatch(/^workspace-invocation-/u);

    await expect(requireScenario().harness.runHostedAlarmForTest(userId)).resolves.toEqual({
      ok: true,
    });
    const statusAfterAlarm = await waitForHostedCompletionWithoutNudging(userId);
    if (
      statusAfterAlarm.inFlight
      || statusAfterAlarm.lastErrorCode
      || statusAfterAlarm.mailboxLag.some((lane) => lane.lag !== "0")
    ) {
      throw new Error(await requireScenario().buildFailureMessage(userId, [
        "Hosted runner did not complete after stale invocation recovery alarm.",
        `statusAfterAlarm: ${JSON.stringify(statusAfterAlarm)}`,
      ]));
    }

    const reply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: recoveryBaselineSendCount,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(reply)).toBe(replyText);

    const assistantProviderRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(baselineProviderRequestCount);
    expect(assistantProviderRequests).toHaveLength(1);
  }, 600_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().baseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-stuck-invocation-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted stuck invocation recovery e2e",
    streamLogs: streamDevLogs,
  });
}

function buildInboundLinqWake() {
  return buildHostedExecutionLinqConversationMessageWake({
    eventId: `evt_stuck_invocation_${runId}`,
    linqMessage: {
      chatId,
      from: buildLinqRecipientPhoneNumber(userId),
      isFromMe: false,
      messageId: `msg_stuck_invocation_${runId}`,
      parts: [{
        type: "text",
        value: userText,
      }],
      service: "SMS",
    },
    occurredAt: new Date().toISOString(),
    phoneLookupKey: requireLinqPhoneLookupKey(userId),
    userId,
  });
}

async function waitForHostedCompletionWithoutNudging(
  userId: string,
): Promise<Awaited<ReturnType<HostedLocalFullStackScenario["harness"]["readUserStatus"]>>> {
  const startedAt = Date.now();
  let lastStatus: Awaited<ReturnType<HostedLocalFullStackScenario["harness"]["readUserStatus"]>> | null = null;

  while ((Date.now() - startedAt) < 30_000) {
    const status = await requireScenario().harness.readUserStatus(userId);
    lastStatus = status;
    if (
      !status.inFlight
      && !status.lastErrorCode
      && status.mailboxLag.every((lane) => lane.lag === "0")
    ) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!lastStatus) {
    throw new Error("Hosted runner status was unavailable after stale invocation recovery alarm.");
  }
  return lastStatus;
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_stuck_invocation`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
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

function countAssistantProviderResponsesApiRequests(): number {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.url === "/v1/responses"
  ).length;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local stuck invocation recovery scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local stuck invocation recovery Linq stub was not started.");
  }
  return linqStub;
}
