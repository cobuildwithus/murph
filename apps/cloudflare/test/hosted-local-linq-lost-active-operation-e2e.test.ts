import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
  buildAssistantProviderShellCommandCall,
} from "./helpers/hosted-local-e2e-support.js";
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

const userId = `member_local_linq_lost_active_operation_${Date.now()}`;
const linqApiToken = "linq-local-test-token";
const linqWebhookSecret = "linq-local-lost-active-operation-secret";
const assistantModel = "gpt-5.5";
const chatId = `chat_local_linq_lost_active_operation_${Date.now()}`;
const firstReplyText = "I got the first note.";
const secondInboundText = "Second message that used to be stranded behind idle checkpoint.";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local Linq lost active-operation e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          buildLinqRecipientPhoneNumber(userId),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      assistantProviderStubModelId: assistantModel,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-linq-lost-active-operation-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted Linq lost active-operation e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });
  }, 300_000);

  it("wakes the live child after the outer runner active-operation pointer is lost", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone: buildLinqRecipientPhoneNumber(userId),
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: buildLinqRecipientPhoneNumber(userId),
    });

    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(replyPath);
    requireScenario().queueAssistantResponses([
      buildAssistantProviderShellCommandCall("sleep 3 && echo first-turn-held"),
      firstReplyText,
    ], {
      matchInputContains: "First message while starting the turn.",
    });

    const firstWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_lost_active_first_${userId}`,
        messageId: `msg_lost_active_first_${userId}`,
        text: "First message while starting the turn.",
      },
    ));
    expect(firstWebhookResponse.status).toBe(202);

    await waitForCondition(
      () => requireScenario().assistantProviderRequests
        .some((request) => request.url === "/v1/responses"),
      "Expected the first hosted assistant turn to reach the provider before dropping active operation.",
    );
    const firstTurnProviderRequestCount = countResponsesApiRequests();
    await requireScenario().harness.dropRunnerActiveOperationForTest(userId);

    const secondWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_lost_active_second_${userId}`,
        messageId: `msg_lost_active_second_${userId}`,
        text: secondInboundText,
      },
    ));
    expect(secondWebhookResponse.status).toBe(202);

    await waitForCondition(
      () => requireScenario().assistantProviderRequests
        .filter((request) => request.url === "/v1/responses")
        .slice(firstTurnProviderRequestCount)
        .some((request) => request.body.includes("first-turn-held")
          && request.body.includes(secondInboundText)),
      "Expected the already-running hosted assistant turn to import the second Linq message after the delayed tool output.",
    );

    const send = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(send)).toBe(firstReplyText);

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
  }, 360_000);
});

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

async function waitForCondition(
  condition: () => boolean,
  message: string,
  input: {
    intervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const intervalMs = input.intervalMs ?? 100;
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [message]));
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local Linq lost active-operation scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not started.");
  }
  return linqStub;
}

function countResponsesApiRequests(): number {
  return requireScenario().assistantProviderRequests
    .filter((request) => request.url === "/v1/responses").length;
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_linq_lost_active_operation`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}
