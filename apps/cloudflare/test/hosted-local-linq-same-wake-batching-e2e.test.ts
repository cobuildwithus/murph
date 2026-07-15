import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqSignupWelcomeWake,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  requireLinqPhoneLookupKey,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";
import {
  listHostedRuntimeLogsForTest,
  signalHostedMailboxAppendRuntimeForTest,
  signalHostedManualRunRuntimeForTest,
} from "#hosted-web-testing";

vi.mock("server-only", () => ({}));

const runId = Date.now();
const userId = `member_local_linq_same_wake_batching_${runId}`;
const linqApiToken = "linq-local-test-token";
const linqWebhookSecret = "linq-local-same-wake-batching-secret";
const batchingRoundCount = 3;
const inputsPerRound = 3;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local Linq same-wake batching e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 120_000);

  it("batches every same-wake Linq burst into one ordered assistant turn", async () => {
    const { chatId, replyPath } = await createActiveLinqMember();

    for (let round = 1; round <= batchingRoundCount; round += 1) {
      const sentinels = Array.from(
        { length: inputsPerRound },
        (_, index) => `SAME_WAKE_BATCH_ROUND_${round}_INPUT_${index + 1}_${runId}`,
      );
      const replyText = `Same-wake batch round ${round} reply.`;
      const providerRequestBaseline = listResponsesApiRequests().length;
      const linqSendBaseline = requireLinqStub().countObservedSends(replyPath);

      requireScenario().queueAssistantResponses([replyText], {
        matchInputContains: sentinels,
      });

      const appendedConversationSeqs: bigint[] = [];
      let terminalMailboxItemId: string | null = null;
      for (const [inputIndex, text] of sentinels.entries()) {
        const append = await requireScenario().enqueueWake(
          buildInboundLinqWake({
            chatId,
            inputIndex: inputIndex + 1,
            round,
            text,
          }),
          userId,
        );
        expect(append).toMatchObject({
          duplicate: false,
          inserted: true,
        });
        appendedConversationSeqs.push(BigInt(append.wake.seq));
        terminalMailboxItemId = append.wake.id;
      }
      for (let index = 1; index < appendedConversationSeqs.length; index += 1) {
        expect(appendedConversationSeqs[index]).toBe(
          appendedConversationSeqs[index - 1]! + 1n,
        );
      }

      if (!terminalMailboxItemId) {
        throw new Error(`Round ${round} did not append a terminal mailbox item.`);
      }

      await signalHostedMailboxAppendRuntimeForTest({
        environment: requireScenario().runtimeEnv,
        expectedUserId: userId,
        mailboxItemId: terminalMailboxItemId,
      });
      await requireScenario().waitForLatestPendingWake(userId);
      const completionStatus = await requireScenario().waitForHostedCompletion(userId);

      const replySend = await requireLinqStub().waitForAdditionalSend({
        baselineCount: linqSendBaseline,
        expectedPath: replyPath,
        scenario: requireScenario(),
        userId,
      });
      expect(requireLinqStub().readObservedMessageText(replySend)).toBe(replyText);
      expect(requireLinqStub().countObservedSends(replyPath)).toBe(linqSendBaseline + 1);

      const roundProviderRequests = listResponsesApiRequests().slice(providerRequestBaseline);
      expect(roundProviderRequests).toHaveLength(1);
      expectOrderedBatchPrompt(roundProviderRequests[0]!.body, sentinels, round);
      expectHealthyCompletion(completionStatus);
    }

    const providerRequestBaseline = listResponsesApiRequests().length;
    const linqSendBaseline = requireLinqStub().countObservedSends(replyPath);
    const manualWakeStartedAt = new Date().toISOString();
    await signalHostedManualRunRuntimeForTest({
      environment: requireScenario().runtimeEnv,
      userId,
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const noOpStatus = await requireScenario().waitForHostedCompletion(userId);

    expect(listResponsesApiRequests()).toHaveLength(providerRequestBaseline);
    expect(requireLinqStub().countObservedSends(replyPath)).toBe(linqSendBaseline);
    expectHealthyCompletion(noOpStatus);
    await expectNoPendingAssistantInputsAfter(manualWakeStartedAt);
  }, 600_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: linqApiToken,
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
    },
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-linq-same-wake-batching-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Linq same-wake batching e2e",
    streamLogs: streamDevLogs,
  });
}

async function createActiveLinqMember(): Promise<{
  chatId: string;
  replyPath: string;
}> {
  await requireScenario().seedActiveHostedLinqMember({
    homePhone: buildLinqHomePhoneNumber(userId),
    memberId: userId,
    memberPhone: buildLinqRecipientPhoneNumber(userId),
  });

  await requireScenario().runWake(buildActivationWake(), userId);
  await requireScenario().waitForHostedCompletion(userId);
  await requireScenario().runWake(
    buildHostedLinqSignupWelcomeWake({
      eventId: `member.activated:local:${userId}:same-wake-welcome`,
      userId,
    }),
    userId,
  );
  const welcomeStatus = await requireScenario().waitForHostedCompletion(userId);
  expectHealthyCompletion(welcomeStatus);

  await requireLinqStub().waitForSend({
    expectedPath: requireLinqStub().createChatPath,
    matchRequest: requireLinqStub().createCreateChatRequestMatcher(userId),
    scenario: requireScenario(),
    userId,
  });
  const chatId = requireLinqStub().requireObservedChatId(userId);
  await requireScenario().bindActiveHostedLinqHomeChat({
    chatId,
    memberId: userId,
    recipientPhone: buildLinqRecipientPhoneNumber(userId),
  });
  return {
    chatId,
    replyPath: `/chats/${encodeURIComponent(chatId)}/messages`,
  };
}

function buildActivationWake() {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:same-wake-batching`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: userId,
    occurredAt: new Date().toISOString(),
  });
}

function buildInboundLinqWake(input: {
  chatId: string;
  inputIndex: number;
  round: number;
  text: string;
}) {
  return buildHostedExecutionLinqConversationMessageWake({
    eventId: `evt_same_wake_batch_${runId}_${input.round}_${input.inputIndex}`,
    linqMessage: {
      chatId: input.chatId,
      from: buildLinqRecipientPhoneNumber(userId),
      isFromMe: false,
      messageId: `msg_same_wake_batch_${runId}_${input.round}_${input.inputIndex}`,
      parts: [{
        type: "text",
        value: input.text,
      }],
      service: "SMS",
      threadIsDirect: true,
    },
    occurredAt: new Date().toISOString(),
    phoneLookupKey: requireLinqPhoneLookupKey(userId),
    userId,
  });
}

function listResponsesApiRequests() {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.method === "POST" && request.url === "/v1/responses"
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

function expectOrderedBatchPrompt(
  body: string,
  sentinels: readonly string[],
  round: number,
): void {
  let previousIndex = -1;
  for (const [index, sentinel] of sentinels.entries()) {
    const inputLabel = `Input ${index + 1}:`;
    const labelIndex = body.indexOf(inputLabel, previousIndex + 1);
    const sentinelIndex = body.indexOf(sentinel, labelIndex + inputLabel.length);
    const context = `round ${round}, input ${index + 1}`;

    expect(labelIndex, `${context}: missing or out-of-order input label`).toBeGreaterThan(
      previousIndex,
    );
    expect(sentinelIndex, `${context}: missing or out-of-order sentinel`).toBeGreaterThan(
      labelIndex,
    );
    previousIndex = sentinelIndex;
  }
  expect(body.includes(`Input ${sentinels.length + 1}:`)).toBe(false);
}

function expectHealthyCompletion(
  status: Awaited<ReturnType<HostedLocalFullStackScenario["waitForHostedCompletion"]>>,
): void {
  expect(status.lastErrorCode ?? null).toBeNull();
  expect(status.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
  expect(
    (status.recentLogs ?? [])
      .filter((entry) => entry.level === "error")
      .map((entry) => ({
        component: entry.component,
        errorCode: entry.errorCode ?? null,
        eventCode: entry.eventCode,
        phase: entry.phase,
      })),
  ).toEqual([]);
}

async function expectNoPendingAssistantInputsAfter(startedAt: string): Promise<void> {
  const logs = await listHostedRuntimeLogsForTest({
    environment: requireScenario().runtimeEnv,
    limit: 1_500,
    userId,
  });
  const passStarts = logs.filter((entry) =>
    entry.at >= startedAt
    && entry.eventCode === "assistant.automation_detail"
    && entry.redactedJson?.detailLabel === "Hosted assistant automation pass starting."
  );
  expect(passStarts.length).toBeGreaterThan(0);
  expect(passStarts.at(-1)?.redactedJson).toMatchObject({
    freshAssistantInputCount: 0,
    pendingAssistantInputCount: 0,
    selectedAssistantInputCount: 0,
  });
}
