import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionTelegramConversationMessageWake,
} from "@murphai/hosted-execution";

import {
  buildAssistantProviderVaultCliCall,
  buildHostedAssistantNotificationDecisionResponse,
  type HostedLocalAssistantProviderScriptedResponse,
} from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildTelegramMessageId,
  buildTelegramThreadId,
  startHostedLocalTelegramStub,
  type HostedLocalTelegramStub,
  type ObservedTelegramRequest,
} from "./helpers/hosted-local-telegram-support.js";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../src/runner-injected-credential.ts";

const userId = `member_local_telegram_scheduled_reminder_${Date.now()}`;
const telegramBotToken = "telegram-local-scheduled-reminder-token";
const hostedLocalTelegramRequestToken = HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL;
const reminderText = "Time to sleep. Put the phone down and get some rest.";
const setupReplyText = "Done - I will remind you here in about one minute.";
const setupRequestText = "Remind me here in about one minute to go to sleep.";
const scheduledReminderLeadMs = 60_000;
const scheduledReminderMinimumRunwayMs = 10_000;
const scheduledReminderSendWaitMs = 120_000;
const productionLikeAssistantModel = "gpt-5.5";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const telegramDebugLogFile = process.env.MURPH_E2E_TELEGRAM_DEBUG_LOG_FILE?.trim() || null;
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;
let telegramStub: HostedLocalTelegramStub | null = null;

describe("hosted local Telegram scheduled reminder e2e", () => {
  beforeAll(async () => {
    await startTelegramScenario();
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await telegramStub?.stop();
    telegramStub = null;
  }, 120_000);

  it("creates a thread-only Telegram reminder, wakes from the scheduled alarm, and sends it", async () => {
    await requireScenario().seedActiveHostedMember({ memberId: userId });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    const activatedStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(activatedStatus.lastErrorCode ?? null).toBeNull();
    await requireTelegramStub().waitForRequestsToSettle({
      scenario: requireScenario(),
      userId,
    });

    const unscheduledStatus = await requireScenario().harness.readUserStatus(userId);
    expect(unscheduledStatus.workspace?.nextWakeAt ?? null).toBeNull();
    expect(unscheduledStatus.nextAlarmAt ?? null).toBeNull();

    const scheduledReminderTimes = resolveScheduledReminderTimes();
    requireScenario().queueAssistantResponses(
      buildHostedAssistantAutomationSaveResponses({
        dueAtIso: scheduledReminderTimes.dueAtIso,
        text: setupReplyText,
        threadId: buildTelegramThreadId(userId),
      }),
    );

    const expectedSendPath = `/bot${hostedLocalTelegramRequestToken}/sendMessage`;
    const setupReplyBaselineCount = requireTelegramStub().countObservedRequests(
      expectedSendPath,
      requireTelegramStub().createSendMessageMatcher(userId),
    );
    await requireScenario().runWake(buildInboundTelegramWake(userId), userId);
    await requireScenario().waitForLatestPendingWake(userId);

    const setupReplyRequests = await requireTelegramStub().waitForRequestCount({
      expectedCount: setupReplyBaselineCount + 1,
      expectedPath: expectedSendPath,
      matchRequest: requireTelegramStub().createSendMessageMatcher(userId),
      scenario: requireScenario(),
      userId,
    });
    const setupReplySend = setupReplyRequests.at(-1)!;
    expect(readObservedTelegramText(setupReplySend)).toBe(setupReplyText);

    const setupStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(setupStatus.lastErrorCode ?? null).toBeNull();
    await requireTelegramStub().waitForRequestsToSettle({
      scenario: requireScenario(),
      userId,
    });
    await waitForHostedWorkspaceNextWakeAt({
      expectedNextWakeAt: scheduledReminderTimes.dueAtIso,
      userId,
    });
    assertScheduledReminderRunway(scheduledReminderTimes.dueAtIso);

    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver sleep reminder",
        text: reminderText,
      }),
    ]);

    const reminderSendBaselineCount = requireTelegramStub().countObservedRequests(expectedSendPath);
    await sleepUntil(scheduledReminderTimes.dueAtIso);
    const sendRequest = await waitForScheduledReminderSendWithoutNudge({
      baselineCount: reminderSendBaselineCount,
      expectedPath: expectedSendPath,
      timeoutMs: scheduledReminderSendWaitMs,
      userId,
    });

    expect(sendRequest.method).toBe("POST");
    expect(requireTelegramStub().parseObservedJson(sendRequest.body)).toMatchObject({
      chat_id: buildTelegramThreadId(userId),
      text: reminderText,
    });
    expect(
      "reply_to_message_id" in (requireTelegramStub().parseObservedJson(sendRequest.body) ?? {}),
    ).toBe(false);
  }, 720_000);
});

async function startTelegramScenario(): Promise<void> {
  telegramStub = await startHostedLocalTelegramStub({
    botToken: telegramBotToken,
    debugLogFile: telegramDebugLogFile,
  });
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "30000",
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
      TELEGRAM_API_BASE_URL: requireTelegramStub().runnerBaseUrl,
      TELEGRAM_BOT_TOKEN: telegramBotToken,
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-telegram-scheduled-reminder-",
    requiredRunnerEnvProfile: "telegram",
    scenarioLabel: "Local hosted Telegram scheduled reminder e2e",
    streamLogs: streamDevLogs,
  });
}

function buildHostedAssistantAutomationSaveResponses(input: {
  dueAtIso: string;
  text: string;
  threadId: string;
}): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderVaultCliCall([
      "automation",
      "save",
      "Sleep reminder",
      "--request-id",
      `hosted-local-telegram-reminder-${userId}`,
      "--instructions",
      "Send the user a short reminder to go to sleep.",
      "--summary",
      "One-shot sleep reminder.",
      "--tags",
      "assistant",
      "--tags",
      "scheduled",
      "--continuity-policy",
      "fresh",
      "--channel",
      "telegram",
      "--thread-id",
      input.threadId,
      "--schedule-kind",
      "at",
      "--schedule-at",
      input.dueAtIso,
    ]),
    input.text,
  ];
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_telegram_scheduled_reminder`,
    memberChannels: {
      email: false,
      linq: false,
      telegram: true,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

function buildInboundTelegramWake(memberId: string) {
  return buildHostedExecutionTelegramConversationMessageWake({
    eventId: `telegram.message.received:local:${memberId}:evt_telegram_scheduled_reminder_setup`,
    occurredAt: new Date().toISOString(),
    telegramMessage: {
      messageId: buildTelegramMessageId(memberId),
      schema: "murph.hosted-telegram-message.v1",
      text: setupRequestText,
      threadId: buildTelegramThreadId(memberId),
    },
    userId: memberId,
  });
}

async function waitForHostedWorkspaceNextWakeAt(input: {
  expectedNextWakeAt: string;
  userId: string;
}): Promise<void> {
  const startedAt = Date.now();
  let latestNextWakeAt: string | null = null;
  let latestNextAlarmAt: string | null = null;
  let latestError: string | null = null;

  while ((Date.now() - startedAt) < 120_000) {
    let status: Awaited<ReturnType<HostedLocalFullStackScenario["harness"]["readUserStatus"]>>;
    try {
      status = await requireScenario().harness.readUserStatus(input.userId);
    } catch (error) {
      latestError = error instanceof Error ? error.message : String(error);
      await sleep(1_000);
      continue;
    }

    if (status.lastErrorCode) {
      throw new Error(await requireScenario().buildFailureMessage(input.userId, [
        "Hosted runner reported an error before checkpointing the scheduled reminder wake.",
        `lastErrorCode: ${status.lastErrorCode}`,
      ]));
    }

    latestNextWakeAt = status.workspace?.nextWakeAt ?? null;
    latestNextAlarmAt = status.nextAlarmAt ?? null;
    if (latestNextWakeAt === input.expectedNextWakeAt) {
      return;
    }

    await sleep(1_000);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the hosted workspace to checkpoint the scheduled reminder wake.",
    `expectedNextWakeAt: ${input.expectedNextWakeAt}`,
    `latestNextWakeAt: ${latestNextWakeAt ?? "null"}`,
    `latestNextAlarmAt: ${latestNextAlarmAt ?? "null"}`,
    latestError ? `latest status read error: ${latestError}` : null,
  ].filter((line): line is string => Boolean(line))));
}

async function waitForScheduledReminderSendWithoutNudge(input: {
  baselineCount: number;
  expectedPath: string;
  timeoutMs: number;
  userId: string;
}): Promise<ObservedTelegramRequest> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < input.timeoutMs) {
    const matchingRequests = requireTelegramStub().observedRequests.filter((request) =>
      request.method === "POST" && request.url === input.expectedPath
    );
    if (matchingRequests.length > input.baselineCount) {
      return matchingRequests.at(-1)!;
    }

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the scheduled Telegram reminder send without runner nudges.",
    `expected path: ${input.expectedPath}`,
    `baseline count: ${input.baselineCount}`,
    `observed requests: ${JSON.stringify(summarizeObservedTelegramRequests())}`,
  ]));
}

function readObservedTelegramText(request: ObservedTelegramRequest): string | null {
  const parsed = requireTelegramStub().parseObservedJson(request.body);
  return typeof parsed?.text === "string" ? parsed.text : null;
}

function summarizeObservedTelegramRequests(): Array<{
  body: Record<string, unknown> | null;
  method: string;
  url: string;
}> {
  return requireTelegramStub().observedRequests.slice(-20).map((request) => ({
    body: requireTelegramStub().parseObservedJson(request.body),
    method: request.method,
    url: request.url,
  }));
}

function resolveScheduledReminderTimes(now = new Date()): {
  dueAtIso: string;
} {
  const dueAtMs = now.getTime() + scheduledReminderLeadMs;
  return {
    dueAtIso: new Date(dueAtMs).toISOString(),
  };
}

function assertScheduledReminderRunway(dueAtIso: string): void {
  const dueAtMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueAtMs)) {
    throw new Error(`Invalid scheduled reminder due timestamp: ${dueAtIso}`);
  }

  const remainingMs = dueAtMs - Date.now();
  if (remainingMs < scheduledReminderMinimumRunwayMs) {
    throw new Error([
      "Scheduled reminder E2E reached Temporal scheduling too close to due time.",
      `remainingMs: ${remainingMs}`,
      `minimumRunwayMs: ${scheduledReminderMinimumRunwayMs}`,
      `dueAtIso: ${dueAtIso}`,
    ].join("\n"));
  }
}

async function sleepUntil(dueAtIso: string): Promise<void> {
  const dueAtMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueAtMs)) {
    throw new Error(`Invalid scheduled reminder due timestamp: ${dueAtIso}`);
  }

  const delayMs = dueAtMs - Date.now() + 750;
  if (delayMs > 0) {
    await sleep(delayMs);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }

  return scenario;
}

function requireTelegramStub(): HostedLocalTelegramStub {
  if (!telegramStub) {
    throw new Error("Hosted local Telegram stub was not initialized.");
  }

  return telegramStub;
}
