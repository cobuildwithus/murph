import { buildHostedExecutionMemberActivatedWake } from "@murphai/hosted-execution";
import { setTimeout as sleep } from "node:timers/promises";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeEmptyPostgresRuntimeForTest, readPostgresRuntimeIdentityForTest } from "#hosted-web-testing";
import { startHostedLocalFullStackScenario, type HostedLocalFullStackScenario } from "./helpers/hosted-local-full-stack-scenario.js";
import { buildHostedLinqInboundEvent, buildLinqHomePhoneNumber, buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub, type HostedLocalLinqStub } from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const userId = `synthetic_postgres_runtime_${runId}`;
const chatId = `synthetic_postgres_chat_${runId}`;
const linqWebhookSecret = "synthetic-postgres-webhook-secret";
const firstUserText = "cold Postgres runtime input";
const secondUserText = "warm Postgres runtime input";
const firstReplyText = "Cold runtime reply.";
const secondReplyText = "Warm runtime reply.";
let scenario: HostedLocalFullStackScenario | null = null;
let linqStub: HostedLocalLinqStub | null = null;

describe("Postgres runtime: cold reply and warm typing", () => {
  afterAll(async () => {
    try { await scenario?.stop(); } finally { await linqStub?.stop(); }
    scenario = null; linqStub = null;
  }, 120_000);
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub();
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "60000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: buildLinqRecipientPhoneNumber(userId),
        LINQ_API_BASE_URL: linqStub.runnerBaseUrl,
        LINQ_API_TOKEN: "linq-local-test-token", LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        // The empty Postgres gate is initialized after schema preparation.
        // This scenario then proves the real cold launch, typing, and delivery.
        MURPH_DEV_SKIP_RUNNER_SMOKE: "1",
        OPENAI_API_KEY: "synthetic-stub-openai-key",
      },
      assistantProviderStubModelId: "gpt-5.6-terra",
      persistDirPrefix: "murph-hosted-local-postgres-runtime-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Postgres runtime cold and warm reply",
      streamLogs: process.env.MURPH_E2E_STREAM_DEV_LOGS === "1",
    });
    await initializeEmptyPostgresRuntimeForTest(scenario.runtimeEnv);
  }, 300_000);

  it("processes consecutive foreground nudges through a warm runner", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const homePhone = buildLinqHomePhoneNumber(userId);
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const typingPath = `/chats/${encodeURIComponent(chatId)}/typing`;

    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildHostedExecutionMemberActivatedWake({
      eventId: `synthetic-activation-${runId}`, memberId: userId,
      occurredAt: new Date().toISOString(),
      memberChannels: { email: false, linq: true, telegram: false },
    }), userId);
    await requireScenario().waitForHostedCompletion(userId);
    // Background activation does not mint a conversation retention window.
    await expect.poll(async () => (await readPostgresRuntimeIdentityForTest(requireScenario().runtimeEnv, userId))?.target,
      { timeout: 90_000 }).toBeNull();
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    const baselineSendCount = requireLinqStub().countObservedSends(replyPath);
    requireScenario().queueAssistantResponses([firstReplyText], {
      matchInputContains: firstUserText,
    });
    requireScenario().queueAssistantResponses([secondReplyText], {
      matchInputContains: secondUserText,
    });

    const coldStartedAtMs = Date.now();
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
    const firstIdentity = await readPostgresRuntimeIdentityForTest(requireScenario().runtimeEnv, userId);
    expect(firstIdentity?.target).toBeTruthy();
    const firstStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(firstStatus.lastErrorCode ?? null).toBeNull();

    const requestCountBeforeSecondReply = requireLinqStub().observedRequests.length;
    const warmStartedAtMs = Date.now();
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
    const requestsAfterSecondInbound =
      requireLinqStub().observedRequests.slice(requestCountBeforeSecondReply);
    const secondReplyTypingStarts = requestsAfterSecondInbound.filter((request) =>
      request.method === "POST" && request.url === typingPath
    );
    expect(secondReplyTypingStarts.length).toBeGreaterThanOrEqual(1);
    const secondReplySendIndex = requestsAfterSecondInbound.indexOf(secondReply);
    const secondReplyTypingStartIndex = requestsAfterSecondInbound.indexOf(
      secondReplyTypingStarts[0]!,
    );
    expect(secondReplySendIndex).toBeGreaterThanOrEqual(0);
    expect(secondReplyTypingStartIndex).toBeGreaterThanOrEqual(0);
    expect(secondReplySendIndex).toBeGreaterThan(secondReplyTypingStartIndex);

    const secondIdentity = await readPostgresRuntimeIdentityForTest(requireScenario().runtimeEnv, userId);
    expect(secondIdentity?.target).toBe(firstIdentity?.target);
    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    await requireScenario().assertHealthyHostedRun(userId, { expectAssistantProviderRequest: true });
    process.stdout.write(`${JSON.stringify({
      event: "postgres_runtime_local_lifecycle_proof",
      coldReplyMs: firstReply.observedAtEpochMs! - coldStartedAtMs,
      warmTypingMs: secondReplyTypingStarts[0]!.observedAtEpochMs! - warmStartedAtMs,
      warmReplyMs: secondReply.observedAtEpochMs! - warmStartedAtMs,
      sameNativeTarget: true,
    })}\n`);
    requireScenario().harness.assertNoInterventions();
  }, 600_000);

});

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
