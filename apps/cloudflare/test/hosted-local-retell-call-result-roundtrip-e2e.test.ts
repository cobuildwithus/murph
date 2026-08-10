import { createHmac } from "node:crypto";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  listHostedAiUsageForTest,
  readHostedMailboxItemForTest,
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
  buildHostedLinqInboundEvent,
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
const linqWebhookSecret = "linq-local-retell-result-secret";
const assistantModel = "gpt-5.6-terra";
const resultSummary = "The pharmacy confirmed the prescription will be ready this afternoon.";
const resultReply = "The pharmacy confirmed your prescription will be ready this afternoon. No follow-up is needed.";
const setupQuestion = "Can you keep this conversation open while I wait for a pharmacy update?";
const setupReply = "Yes, I’ll be here when you have an update.";
const temporalMailboxSignalFaultPreloadUrl = new URL(
  "../../web/test/support/hosted-local-temporal-mailbox-signal-fault-preload.ts",
  import.meta.url,
).href;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

vi.mock("server-only", () => ({}));

afterAll(async () => {
  await scenario?.harness.clearTemporalMailboxSignalFaultForTest(userId).catch(() => {});
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
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          buildLinqRecipientPhoneNumber(userId),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: "linq-local-test-token",
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
        RETELL_API_KEY: retellApiKey,
      },
      assistantProviderStubModelId: assistantModel,
      faultInjection: true,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-retell-result-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted Retell result roundtrip e2e",
      streamLogs: streamDevLogs,
      testControls: true,
      webProcessEnvOverrides: {
        MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID: userId,
        NODE_OPTIONS: appendNodeImportOption(
          process.env.NODE_OPTIONS,
          temporalMailboxSignalFaultPreloadUrl,
        ),
      },
    });
  }, 300_000);

  it("replays one signed call result after the post-commit runtime signal fails", async () => {
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
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const setupBaselineSends = requireLinqStub().countObservedSends(replyPath);
    const setupTurnStartedAt = new Date().toISOString();
    requireScenario().queueAssistantResponses([setupReply], {
      matchInputContains: setupQuestion,
    });
    const setupResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_retell_result_setup_${runId}`,
        messageId: `msg_retell_result_setup_${runId}`,
        text: setupQuestion,
      }),
    );
    expect(setupResponse.status).toBe(202);
    await requireScenario().waitForLatestPendingWake(userId);
    const setupSend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: setupBaselineSends,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(setupSend)).toBe(setupReply);
    const setupStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(setupStatus.lastErrorCode ?? null).toBeNull();

    const setupSessionIds = new Set(
      (await listHostedAiUsageForTest({
        environment: requireScenario().runtimeEnv,
        memberId: userId,
      }))
        .filter((row) => row.occurredAt >= setupTurnStartedAt && row.surface === "linq")
        .map((row) => row.sessionId),
    );
    expect(setupSessionIds.size).toBe(1);
    const originSessionId = setupSessionIds.values().next().value;
    if (!originSessionId) {
      throw new Error("The setup Linq turn did not persist an assistant session.");
    }

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
      originSessionId,
      providerCallId,
      requestKey: `retell-result-e2e:${runId}`,
    });

    // The completed call runs an allow-skip notification turn; queue the
    // assistant's composed result message keyed on the untrusted summary.
    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver pharmacy call result",
        text: resultReply,
      }),
    ], {
      matchInputContains: resultSummary,
    });
    const baselineSends = requireLinqStub().countObservedSends(replyPath);
    const baselineProviderRequests = countAssistantProviderRequests();
    const payload = buildRetellCallAnalyzedPayload();
    const signedPayload = buildSignedRetellWebhookRequest(payload);
    const notificationDedupeKey =
      `assistant.notification.requested:phone-call-result:${phoneCallId}`;
    const firstResponsePromise = postSignedRetellWebhook(signedPayload);
    const committedMailboxItem = await waitForHostedMailboxItem({
      dedupeKey: notificationDedupeKey,
      environment: requireScenario().runtimeEnv,
      userId,
    });
    await requireScenario().harness.armTemporalMailboxSignalFaultForTest(
      userId,
      committedMailboxItem.id,
    );
    const firstResponse = await firstResponsePromise;
    expect(firstResponse.status).toBe(500);

    expect(committedMailboxItem).toMatchObject({
      consumedAt: null,
      dedupeKey: notificationDedupeKey,
      kind: "assistant.notification.requested",
    });
    expect(countAssistantProviderRequests()).toBe(baselineProviderRequests);
    expect(requireLinqStub().countObservedSends(replyPath)).toBe(baselineSends);

    const storedAfterFailedSignal = await readHostedPhoneCallForTest({
      environment: requireScenario().runtimeEnv,
      id: phoneCallId,
    });
    expect(storedAfterFailedSignal).toMatchObject({
      analyzedAt: expect.any(Date),
      memberId: userId,
      originSessionId,
      providerCallId,
      resultEncrypted: expect.any(String),
      resultJson: null,
      status: "completed",
    });

    // Replay the exact same raw body and Retell signature.
    const replay = await postSignedRetellWebhook(signedPayload);
    expect(replay.status).toBe(204);
    const replayMailboxItem = await readHostedMailboxItemForTest({
      dedupeKey: notificationDedupeKey,
      environment: requireScenario().runtimeEnv,
      userId,
    });
    expect(replayMailboxItem.id).toBe(committedMailboxItem.id);
    expect(replayMailboxItem.laneSeq).toBe(committedMailboxItem.laneSeq);

    // Proactive delivery: one message is sent WITHOUT any follow-up user turn.
    await requireScenario().waitForLatestPendingWake(userId);
    const send = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSends,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(send)).toBe(resultReply);

    const resultStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(resultStatus.lastErrorCode ?? null).toBeNull();
    expect(resultStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    // Exactly one notification provider request ran, framed with the untrusted
    // call result and carrying the result summary.
    expect(requireScenario().assistantProviderRequests.slice(baselineProviderRequests).some((request) =>
      request.url === "/v1/responses"
      && request.body.includes(resultSummary)
      && request.body.includes("untrusted provider/callee text")
    )).toBe(true);
    expect(countAssistantProviderRequests()).toBe(baselineProviderRequests + 1);
    expect(requireLinqStub().countObservedSends(replyPath)).toBe(baselineSends + 1);

    const storedCall = await readHostedPhoneCallForTest({
      environment: requireScenario().runtimeEnv,
      id: phoneCallId,
    });
    expect(storedCall).toMatchObject({
      memberId: userId,
      originSessionId,
      providerCallId,
      status: "completed",
    });
    expect(storedCall?.analyzedAt).toBeInstanceOf(Date);
    expect(storedCall?.resultEncrypted).toEqual(expect.any(String));
    expect(storedCall?.resultEncrypted).not.toHaveLength(0);
    expect(storedCall?.resultJson).toBeNull();

    // Idempotent replay after recovery: re-POSTing the same call_analyzed sends
    // no second message and runs no second turn (deliveryIdempotencyKey dedupe
    // on phone-call-result:${call.id}).
    const duplicateReplay = await postSignedRetellWebhook(
      buildSignedRetellWebhookRequest(payload),
    );
    expect(duplicateReplay.status).toBe(204);
    await requireScenario().waitForHostedIdle(userId);
    expect(requireLinqStub().countObservedSends(replyPath)).toBe(baselineSends + 1);
    expect(countAssistantProviderRequests()).toBe(baselineProviderRequests + 1);
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

interface SignedRetellWebhookRequest {
  rawBody: string;
  signature: string;
}

function buildSignedRetellWebhookRequest(
  payload: Record<string, unknown>,
): SignedRetellWebhookRequest {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const digest = createHmac("sha256", retellApiKey)
    .update(`${rawBody}${timestamp}`)
    .digest("hex");
  return {
    rawBody,
    signature: `v=${timestamp},d=${digest}`,
  };
}

async function postSignedRetellWebhook(
  request: SignedRetellWebhookRequest,
): Promise<Response> {
  return await fetch(`${requireScenario().harness.webBaseUrl}/api/retell/webhook`, {
    body: request.rawBody,
    headers: {
      "content-type": "application/json",
      "x-retell-signature": request.signature,
    },
    method: "POST",
  });
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
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

async function waitForHostedMailboxItem(input: {
  dedupeKey: string;
  environment: NodeJS.ProcessEnv;
  userId: string;
}): Promise<Awaited<ReturnType<typeof readHostedMailboxItemForTest>>> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < 30_000) {
    try {
      return await readHostedMailboxItemForTest(input);
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error(
    "Timed out waiting for the committed Retell notification mailbox item.",
    { cause: lastError },
  );
}

function appendNodeImportOption(
  existingNodeOptions: string | undefined,
  importUrl: string,
): string {
  const existing = existingNodeOptions?.trim();
  return existing
    ? `${existing} --import=${importUrl}`
    : `--import=${importUrl}`;
}

function countAssistantProviderRequests(): number {
  return requireScenario().assistantProviderRequests.filter(
    (request) => request.url === "/v1/responses",
  ).length;
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
