import { createHmac } from "node:crypto";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  readHostedPhoneCallForTest,
  seedHostedPhoneCallForTest,
} from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildHostedAssistantNotificationDecisionResponse,
} from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const userId = `member_local_retell_result_${runId}`;
const chatId = `chat_local_retell_result_${runId}`;
const phoneCallId = `hpc_local_retell_result_${runId}`;
const providerCallId = `retell_call_local_${runId}`;
const retellApiKey = "retell-local-test-key";
const assistantModel = "gpt-5.5";
const resultSummary = "The pharmacy confirmed the prescription will be ready this afternoon.";
const resultReply = "The pharmacy confirmed your prescription will be ready this afternoon. No follow-up is needed.";

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

describe("hosted local Retell result roundtrip e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub();
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: "linq-local-test-token",
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
        RETELL_API_KEY: retellApiKey,
      },
      assistantProviderStubModelId: assistantModel,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-retell-result-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted Retell result roundtrip e2e",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  it("turns one signed call result into one durable assistant notification", async () => {
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
      participantPhone: memberPhone,
      recipientPhone: memberPhone,
    });
    await seedHostedPhoneCallForTest({
      brief: {
        goal: "Confirm when a prescription will be ready.",
        successCriteria: "The pharmacy gives a pickup time.",
        timeZone: "America/New_York",
        to: {
          label: "the pharmacy",
          phoneNumber: "+15550102020",
        },
      },
      environment: requireScenario().runtimeEnv,
      id: phoneCallId,
      memberId: userId,
      providerCallId,
      requestKey: `retell-result-e2e:${runId}`,
    });

    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "report completed phone call result",
        text: resultReply,
      }),
    ], {
      matchInputContains: resultSummary,
    });

    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const baselineSends = requireLinqStub().countObservedSends(replyPath);
    const payload = buildRetellCallAnalyzedPayload();
    const response = await postSignedRetellWebhook(payload);
    expect(response.status).toBe(204);

    const send = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSends,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(send)).toBe(resultReply);

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(requireScenario().assistantProviderRequests.some((request) =>
      request.url === "/v1/responses"
      && request.body.includes(resultSummary)
      && request.body.includes("untrusted provider/callee text")
    )).toBe(true);

    const storedCall = await readHostedPhoneCallForTest({
      environment: requireScenario().runtimeEnv,
      id: phoneCallId,
    });
    expect(storedCall).toMatchObject({
      memberId: userId,
      providerCallId,
      status: "completed",
    });
    expect(storedCall?.analyzedAt).toBeInstanceOf(Date);
    expect(storedCall?.resultJson).toMatchObject({
      outcome: "completed",
      summary: resultSummary,
    });

    const replay = await postSignedRetellWebhook(payload);
    expect(replay.status).toBe(204);
    await requireScenario().waitForHostedIdle(userId);
    expect(requireLinqStub().countObservedSends(replyPath)).toBe(baselineSends + 1);
  }, 360_000);
});

function buildActivationWake() {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:retell-result-e2e`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: userId,
    occurredAt: new Date().toISOString(),
  });
}

function buildRetellCallAnalyzedPayload(): Record<string, unknown> {
  return {
    call: {
      call_analysis: {
        custom_analysis_data: {
          outcome: "completed",
          result: resultSummary,
        },
      },
      call_id: providerCallId,
      data_storage_setting: "basic_attributes_only",
      end_timestamp: new Date().toISOString(),
      metadata: {
        murph_phone_call_id: phoneCallId,
      },
    },
    event: "call_analyzed",
  };
}

async function postSignedRetellWebhook(payload: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const digest = createHmac("sha256", retellApiKey)
    .update(`${rawBody}${timestamp}`)
    .digest("hex");

  return await fetch(`${requireScenario().harness.webBaseUrl}/api/retell/webhook`, {
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "x-retell-signature": `v=${timestamp},d=${digest}`,
    },
    method: "POST",
  });
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local Retell result scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not started.");
  }
  return linqStub;
}
