import { createHmac } from "node:crypto";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  type HostedRuntimeWorkflowState,
} from "@murphai/hosted-execution/orchestration-control";
import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  hostedUserRuntimeWorkflowId,
} from "@murphai/hosted-orchestrator-temporal/client";
import {
  createHostedRuntimeTemporalClientFromEnv,
} from "@murphai/hosted-orchestrator-temporal/client/temporal-client";
import {
  listHostedLinqDeliveriesForTest,
  readHostedAiUsageLimitPeriodForTest,
  seedHostedAiUsageLimitPeriodForTest,
} from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
  type ObservedLinqRequest,
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const userId = `member_local_usage_limit_ambiguous_${runId}`;
const chatId = `chat_local_usage_limit_ambiguous_${runId}`;
const linqApiToken = "linq-local-usage-limit-token";
const linqWebhookSecret = "linq-local-usage-limit-webhook-secret";
const assistantModel = "gpt-5.5";
const firstInboundText = "Can you help me plan tomorrow's workout?";
const secondInboundText = "Can you also update the plan for Saturday?";
const usageLimitNoticeText =
  "Hey, you've reached your usage limit for the month. Upgrade to Edge: https://withmurph.ai/home";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

vi.mock("server-only", () => ({}));

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local usage-limit ambiguous send e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
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
      persistDirPrefix: "murph-hosted-local-usage-limit-ambiguous-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted usage-limit ambiguous send e2e",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  it("keeps one durable usage-limit claim when Linq accepts but loses every acknowledgement", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });
    const activationStatus = await requireScenario().harness.readUserStatus(userId);
    const conversationSeqBeforeDenial = readConversationMailboxMaxSeq(activationStatus);
    const { periodEnd, periodStart } = buildCurrentUtcCalendarMonthPeriod();
    await seedHostedAiUsageLimitPeriodForTest({
      environment: requireScenario().runtimeEnv,
      memberId: userId,
      periodEnd,
      periodStart,
    });

    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const usageNoticeMatcher = (request: ObservedLinqRequest): boolean =>
      requireLinqStub().readObservedMessageText(request) === usageLimitNoticeText;
    const observedBaseline = requireLinqStub().countObservedSends(
      replyPath,
      usageNoticeMatcher,
    );
    const acceptedBaseline = requireLinqStub().countAcceptedSends(
      replyPath,
      usageNoticeMatcher,
    );
    const providerBaseline = countAssistantResponseRequests();

    requireLinqStub().armNextPostAcceptLostAcknowledgment({
      expectedPath: replyPath,
      matchRequest: usageNoticeMatcher,
    });

    const firstResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_usage_limit_ambiguous_first_${runId}`,
        messageId: `msg_usage_limit_ambiguous_first_${runId}`,
        text: firstInboundText,
      },
    ));
    expect(firstResponse.status).toBe(202);
    await expect(firstResponse.json()).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: observedBaseline + 3,
      expectedPath: replyPath,
      matchRequest: usageNoticeMatcher,
      scenario: requireScenario(),
      userId,
    });
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: acceptedBaseline + 1,
      expectedPath: replyPath,
      matchRequest: usageNoticeMatcher,
      scenario: requireScenario(),
      userId,
    });
    const firstBlockedWorkflowState = await waitForUsageLimitBlockedWorkflowState(
      0,
    );
    const firstBlockedStatus = await requireScenario().harness.readUserStatus(userId);

    expect(requireLinqStub().countObservedSends(replyPath, usageNoticeMatcher)).toBe(
      observedBaseline + 3,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, usageNoticeMatcher)).toBe(
      acceptedBaseline + 1,
    );
    expect(countAssistantResponseRequests()).toBe(providerBaseline);
    expect(readConversationMailboxLag(firstBlockedStatus)).not.toBe("0");
    expect(compareMailboxSeq(
      readConversationMailboxMaxSeq(firstBlockedStatus),
      conversationSeqBeforeDenial,
    )).toBeGreaterThan(0);

    const claimedPeriod = await readHostedAiUsageLimitPeriodForTest({
      environment: requireScenario().runtimeEnv,
      memberId: userId,
      periodStart,
    });
    expect(claimedPeriod?.limitNoticeSentAt).toBeInstanceOf(Date);

    const deliveriesAfterAmbiguousSend = await listHostedLinqDeliveriesForTest({
      environment: requireScenario().runtimeEnv,
      template: "ai_usage_quota",
    });
    expect(deliveriesAfterAmbiguousSend).toHaveLength(1);
    expect(deliveriesAfterAmbiguousSend[0]).toMatchObject({
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
      status: "provider_dispatch_started",
      template: "ai_usage_quota",
    });
    expect(deliveriesAfterAmbiguousSend[0]?.idempotencyKey).toEqual(expect.any(String));

    const secondResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_usage_limit_ambiguous_second_${runId}`,
        messageId: `msg_usage_limit_ambiguous_second_${runId}`,
        text: secondInboundText,
      },
    ));
    expect(secondResponse.status).toBe(202);
    await expect(secondResponse.json()).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });
    await waitForUsageLimitBlockedWorkflowState(firstBlockedWorkflowState.signalVersion);
    const finalStatus = await requireScenario().harness.readUserStatus(userId);

    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.inFlight).toBe(false);
    expect(readConversationMailboxLag(finalStatus)).not.toBe("0");
    expect(compareMailboxSeq(
      readConversationMailboxMaxSeq(finalStatus),
      readConversationMailboxMaxSeq(firstBlockedStatus),
    )).toBeGreaterThan(0);
    expect(requireLinqStub().countObservedSends(replyPath, usageNoticeMatcher)).toBe(
      observedBaseline + 3,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, usageNoticeMatcher)).toBe(
      acceptedBaseline + 1,
    );
    expect(countAssistantResponseRequests()).toBe(providerBaseline);

    const finalDeliveries = await listHostedLinqDeliveriesForTest({
      environment: requireScenario().runtimeEnv,
      template: "ai_usage_quota",
    });
    expect(finalDeliveries).toEqual(deliveriesAfterAmbiguousSend);
  }, 420_000);
});

function buildActivationWake() {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:usage-limit-ambiguous-e2e`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: userId,
    occurredAt: new Date().toISOString(),
  });
}

function buildCurrentUtcCalendarMonthPeriod(): {
  periodEnd: Date;
  periodStart: Date;
} {
  const now = new Date();
  return {
    periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}

function countAssistantResponseRequests(): number {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.url === "/v1/responses"
  ).length;
}

async function waitForUsageLimitBlockedWorkflowState(
  previousSignalVersion: number,
): Promise<HostedRuntimeWorkflowState> {
  const client = await createHostedRuntimeTemporalClientFromEnv(requireScenario().runtimeEnv);
  const handle = client.workflow.getHandle(hostedUserRuntimeWorkflowId(userId));
  const deadline = Date.now() + 180_000;
  let latestState: HostedRuntimeWorkflowState | null = null;
  let latestError: string | null = null;

  try {
    while (Date.now() < deadline) {
      try {
        latestState = await handle.query<HostedRuntimeWorkflowState>(
          HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
        );
        latestError = null;
        if (
          latestState.signalVersion > previousSignalVersion
          && latestState.lastReconciliationStatus === "blocked"
          && latestState.lastReconciliationBlockedReason === "ai_usage_denied"
        ) {
          return latestState;
        }
      } catch (error) {
        latestError = error instanceof Error ? error.message : String(error);
      }
      await sleep(250);
    }
  } finally {
    await client.connection.close();
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    `Timed out waiting for usage-limit workflow signal above ${previousSignalVersion}.`,
    ...(latestState ? [`last workflow state: ${JSON.stringify(latestState)}`] : []),
    ...(latestError ? [`last workflow query error: ${latestError}`] : []),
  ]));
}

function readConversationMailboxLane(
  status: HostedRunnerStatusResponse,
): HostedRunnerStatusResponse["mailboxLag"][number] {
  const lane = status.mailboxLag.find((entry) => entry.lane === "conversation");
  if (!lane) {
    throw new Error("Hosted runner status omitted the conversation mailbox lane.");
  }
  return lane;
}

function readConversationMailboxLag(status: HostedRunnerStatusResponse): string {
  return readConversationMailboxLane(status).lag;
}

function readConversationMailboxMaxSeq(status: HostedRunnerStatusResponse): string {
  return readConversationMailboxLane(status).maxSeq;
}

function compareMailboxSeq(left: string, right: string): number {
  const leftSeq = BigInt(left);
  const rightSeq = BigInt(right);
  return leftSeq > rightSeq ? 1 : leftSeq < rightSeq ? -1 : 0;
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
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
    throw new Error("Hosted local usage-limit Linq stub was not initialized.");
  }
  return linqStub;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local usage-limit scenario was not initialized.");
  }
  return scenario;
}
