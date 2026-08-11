import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
  buildAssistantProviderMurphToolCall,
  buildHostedAssistantNotificationDecisionResponse,
  type HostedLocalAssistantProviderStubRequest,
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
const groupOwnerUserId = `member_local_telegram_group_owner_${Date.now()}`;
const telegramGroupThreadId = "-1007654321";
const telegramBotToken = "telegram-local-scheduled-reminder-token";
const telegramWebhookSecret = "telegram-local-scheduled-reminder-secret";
const hostedLocalTelegramRequestToken = HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL;
const reminderText = "Time to sleep. Put the phone down and get some rest.";
const setupReplyText = "Done - I will remind you here in a few minutes.";
const setupRequestText = "Remind me here in a few minutes to go to sleep.";
const groupSetupRequestText = "Set up our weekly health newsletter in this chat.";
const groupSetupReplyText = "Got it - this Telegram group route is ready.";
const groupNewsletterName = "Hosted local family health newsletter";
const groupNewsletterText = "This week, the family kept showing up for each other.";
const groupNewsletterTimeZone = "America/New_York";
const scheduledReminderInstructions =
  "Send the user the hosted-local sleep reminder: go to sleep.";
const scheduledReminderLeadMs = 360_000;
const scheduledReminderMinimumRunwayMs = 30_000;
const scheduledReminderSendWaitMs = 240_000;
const productionLikeAssistantModel = "gpt-5.6-terra";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const telegramDebugLogFile = process.env.MURPH_E2E_TELEGRAM_DEBUG_LOG_FILE?.trim() || null;
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;
let telegramStub: HostedLocalTelegramStub | null = null;
let groupContainerMemberId: string | null = null;
let groupNewsletterDueAtIso: string | null = null;
let groupNewsletterSendBaselineCount = 0;

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

  it("routes a real Telegram group webhook through its group runtime and ordinary chat outbox", async () => {
    await requireScenario().seedActiveHostedMember({ memberId: groupOwnerUserId });
    await requireScenario().bindActiveHostedTelegramMember({
      memberId: groupOwnerUserId,
      telegramThreadId: buildTelegramThreadId(groupOwnerUserId),
      telegramUserId: buildTelegramSenderUserId(groupOwnerUserId),
    });
    const scheduledNewsletterTimes = resolveScheduledReminderTimes();
    requireScenario().queueAssistantResponses(
      buildHostedAssistantNewsletterSaveResponses({
        dueAtIso: scheduledNewsletterTimes.dueAtIso,
        text: groupSetupReplyText,
      }),
      { matchInputContains: groupSetupRequestText },
    );

    const expectedSendPath = `/bot${hostedLocalTelegramRequestToken}/sendMessage`;
    const groupSendMatcher = (request: ObservedTelegramRequest) => {
      const body = requireTelegramStub().parseObservedJson(request.body);
      return body?.chat_id === telegramGroupThreadId
        && body.text === groupSetupReplyText;
    };
    const baselineCount = requireTelegramStub().countObservedRequests(
      expectedSendPath,
      groupSendMatcher,
    );
    const webhookResponse = await postTelegramWebhook(
      buildInboundTelegramGroupUpdate(groupOwnerUserId),
    );
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-group",
    });

    const route = await requireScenario().readHostedThreadRoute({
      channel: "telegram",
      threadId: telegramGroupThreadId,
    });
    expect(route).toMatchObject({ ownerMemberId: groupOwnerUserId });
    if (!route) {
      throw new Error("Expected the Telegram group webhook to create a thread route.");
    }
    await requireTelegramStub().waitForRequestCount({
      expectedCount: baselineCount + 1,
      expectedPath: expectedSendPath,
      matchRequest: groupSendMatcher,
      scenario: requireScenario(),
      userId: route.containerMemberId,
    });
    const completed = await requireScenario().waitForHostedCompletion(
      route.containerMemberId,
    );
    expect(completed.lastErrorCode ?? null).toBeNull();
    groupContainerMemberId = route.containerMemberId;
    groupNewsletterDueAtIso = scheduledNewsletterTimes.dueAtIso;
    groupNewsletterSendBaselineCount = countScheduledTelegramSendsWithoutNudge({
      expectedPath: expectedSendPath,
      expectedText: groupNewsletterText,
      targetThreadId: telegramGroupThreadId,
    });
    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("group", {
        action: "read_shared",
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      }),
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver the group health newsletter",
        text: groupNewsletterText,
      }),
    ], {
      matchInputContains: groupNewsletterName,
    });
    await waitForHostedWorkspaceWakeNotLaterThan({
      latestAllowedWakeAt: scheduledNewsletterTimes.dueAtIso,
      userId: route.containerMemberId,
    });
    assertScheduledReminderRunway(scheduledNewsletterTimes.dueAtIso);
  }, 180_000);

  it("creates a thread-only Telegram reminder, wakes from the scheduled alarm, and sends it", async () => {
    await requireScenario().seedActiveHostedMember({ memberId: userId });
    await requireScenario().bindActiveHostedTelegramMember({
      memberId: userId,
      telegramThreadId: buildTelegramThreadId(userId),
      telegramUserId: buildTelegramSenderUserId(userId),
    });
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
      }),
      { matchInputContains: setupRequestText },
    );

    const expectedSendPath = `/bot${hostedLocalTelegramRequestToken}/sendMessage`;
    const setupReplyBaselineCount = requireTelegramStub().countObservedRequests(
      expectedSendPath,
      requireTelegramStub().createSendMessageMatcher(userId),
    );
    const webhookResponse = await postTelegramWebhook(buildInboundTelegramUpdate(userId));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

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
    await waitForHostedWorkspaceWakeNotLaterThan({
      latestAllowedWakeAt: scheduledReminderTimes.dueAtIso,
      userId,
    });
    assertScheduledReminderRunway(scheduledReminderTimes.dueAtIso);

    const reminderProviderRequestBaselineCount =
      requireScenario().assistantProviderRequests.length;
    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver sleep reminder",
        text: reminderText,
      }),
    ], {
      matchInputContains: scheduledReminderInstructions,
    });

    const reminderSendBaselineCount = countScheduledTelegramSendsWithoutNudge({
      expectedPath: expectedSendPath,
      expectedText: reminderText,
      targetThreadId: buildTelegramThreadId(userId),
    });
    await sleepUntil(scheduledReminderTimes.dueAtIso);
    const sendRequest = await waitForScheduledTelegramSendWithoutNudge({
      baselineCount: reminderSendBaselineCount,
      expectedPath: expectedSendPath,
      expectedText: reminderText,
      runtimeUserId: userId,
      targetThreadId: buildTelegramThreadId(userId),
      timeoutMs: scheduledReminderSendWaitMs,
    });

    expect(sendRequest.method).toBe("POST");
    expect(requireTelegramStub().parseObservedJson(sendRequest.body)).toMatchObject({
      chat_id: buildTelegramThreadId(userId),
      text: reminderText,
    });
    expect(
      "reply_to_message_id" in (requireTelegramStub().parseObservedJson(sendRequest.body) ?? {}),
    ).toBe(false);

    const completedReminderStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(completedReminderStatus.lastErrorCode ?? null).toBeNull();
    await assertScheduledReminderCronProviderRequestUsedFlex({
      baselineCount: reminderProviderRequestBaselineCount,
      userId,
    });
    await requireTelegramStub().waitForRequestsToSettle({
      scenario: requireScenario(),
      userId,
    });
    expect(countScheduledTelegramSendsWithoutNudge({
      expectedPath: expectedSendPath,
      expectedText: reminderText,
      targetThreadId: buildTelegramThreadId(userId),
    })).toBe(reminderSendBaselineCount + 1);

    const scheduledGroupRuntimeUserId = requireGroupContainerMemberId();
    const scheduledGroupSend = await waitForScheduledTelegramSendWithoutNudge({
      baselineCount: groupNewsletterSendBaselineCount,
      expectedPath: expectedSendPath,
      expectedText: groupNewsletterText,
      runtimeUserId: scheduledGroupRuntimeUserId,
      targetThreadId: telegramGroupThreadId,
      timeoutMs: scheduledReminderSendWaitMs,
    });
    expect(requireTelegramStub().parseObservedJson(scheduledGroupSend.body)).toMatchObject({
      chat_id: telegramGroupThreadId,
      text: groupNewsletterText,
    });
    expect(Date.parse(requireGroupNewsletterDueAtIso())).toBeLessThanOrEqual(Date.now());
    const completedGroupNewsletterStatus = await requireScenario().waitForHostedCompletion(
      scheduledGroupRuntimeUserId,
    );
    expect(completedGroupNewsletterStatus.lastErrorCode ?? null).toBeNull();
  }, 720_000);
});

async function startTelegramScenario(): Promise<void> {
  telegramStub = await startHostedLocalTelegramStub({
    botToken: hostedLocalTelegramRequestToken,
    debugLogFile: telegramDebugLogFile,
  });
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
      TELEGRAM_API_BASE_URL: requireTelegramStub().runnerBaseUrl,
      TELEGRAM_BOT_TOKEN: telegramBotToken,
      TELEGRAM_WEBHOOK_SECRET: telegramWebhookSecret,
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
}): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderMurphToolCall("automation", {
      action: "save",
      continuityPolicy: "fresh",
      instructions: scheduledReminderInstructions,
      schedule: { at: input.dueAtIso, kind: "at" },
      summary: "One-shot sleep reminder.",
      tags: ["assistant", "scheduled"],
      title: "Sleep reminder",
    }),
    input.text,
  ];
}

function buildHostedAssistantNewsletterSaveResponses(input: {
  dueAtIso: string;
  text: string;
}): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderMurphToolCall("automation", {
      action: "save",
      continuityPolicy: "fresh",
      instructions: [
        "Read the group-newsletter skill before every execution.",
        "Delivery: current_chat",
        "Health scopes: steps-days.v0",
        `Newsletter name: ${groupNewsletterName}`,
        "Tone: supportive",
      ].join("\n"),
      schedule: {
        expression: buildDailyCronExpressionInTimeZone({
          at: input.dueAtIso,
          timeZone: groupNewsletterTimeZone,
        }),
        kind: "cron",
      },
      slug: "group-health-newsletter",
      summary: "Share the group's scheduled health newsletter.",
      title: groupNewsletterName,
    }),
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

async function waitForHostedWorkspaceWakeNotLaterThan(input: {
  latestAllowedWakeAt: string;
  userId: string;
}): Promise<string> {
  const latestAllowedWakeAtMs = Date.parse(input.latestAllowedWakeAt);
  if (!Number.isFinite(latestAllowedWakeAtMs)) {
    throw new Error(`Invalid scheduled reminder due timestamp: ${input.latestAllowedWakeAt}`);
  }

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
    const latestNextWakeAtMs = latestNextWakeAt ? Date.parse(latestNextWakeAt) : NaN;
    if (
      latestNextWakeAt
      && Number.isFinite(latestNextWakeAtMs)
      && latestNextWakeAtMs > Date.now()
      && latestNextWakeAtMs <= latestAllowedWakeAtMs
    ) {
      return latestNextWakeAt;
    }

    await sleep(1_000);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the hosted workspace to arm a wake for the scheduled reminder.",
    `latestAllowedWakeAt: ${input.latestAllowedWakeAt}`,
    `latestNextWakeAt: ${latestNextWakeAt ?? "null"}`,
    `latestNextAlarmAt: ${latestNextAlarmAt ?? "null"}`,
    latestError ? `latest status read error: ${latestError}` : null,
  ].filter((line): line is string => Boolean(line))));
}

async function waitForScheduledTelegramSendWithoutNudge(input: {
  baselineCount: number;
  expectedPath: string;
  expectedText: string;
  runtimeUserId: string;
  targetThreadId: string;
  timeoutMs: number;
}): Promise<ObservedTelegramRequest> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < input.timeoutMs) {
    const matchingRequests = requireTelegramStub().observedRequests.filter((request) =>
      request.method === "POST" && request.url === input.expectedPath
      && isScheduledTelegramSendWithoutNudge(
        request,
        input.targetThreadId,
        input.expectedText,
      )
    );
    if (matchingRequests.length > input.baselineCount) {
      return matchingRequests.at(-1)!;
    }

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.runtimeUserId, [
    "Timed out waiting for the scheduled Telegram send without runner nudges.",
    `expected path: ${input.expectedPath}`,
    `expected target: ${input.targetThreadId}`,
    `expected text: ${input.expectedText}`,
    `baseline count: ${input.baselineCount}`,
    `observed requests: ${JSON.stringify(summarizeObservedTelegramRequests())}`,
  ]));
}

function countScheduledTelegramSendsWithoutNudge(input: {
  expectedPath: string;
  expectedText: string;
  targetThreadId: string;
}): number {
  return requireTelegramStub().observedRequests.filter((request) =>
    request.method === "POST"
    && request.url === input.expectedPath
    && isScheduledTelegramSendWithoutNudge(
      request,
      input.targetThreadId,
      input.expectedText,
    )
  ).length;
}

function isScheduledTelegramSendWithoutNudge(
  request: ObservedTelegramRequest,
  targetThreadId: string,
  expectedText: string,
): boolean {
  const parsed = requireTelegramStub().parseObservedJson(request.body);
  return Boolean(
    parsed
    && parsed.chat_id === targetThreadId
    && parsed.text === expectedText
    && !("reply_to_message_id" in parsed)
  );
}

async function assertScheduledReminderCronProviderRequestUsedFlex(input: {
  baselineCount: number;
  userId: string;
}): Promise<void> {
  const providerRequests = requireScenario().assistantProviderRequests
    .slice(input.baselineCount)
    .filter((request) =>
      request.method === "POST" && request.url === "/v1/responses"
    );
  const requestSummaries = providerRequests.map(summarizeAssistantProviderRequest);
  const scheduledReminderRequest = requestSummaries.find((request) =>
    request.model === productionLikeAssistantModel
  );
  if (!scheduledReminderRequest) {
    throw new Error(await requireScenario().buildFailureMessage(input.userId, [
      "Scheduled reminder cron did not send a provider request for the configured assistant model.",
      `provider request baseline count: ${input.baselineCount}`,
      `observed provider requests: ${JSON.stringify(requestSummaries)}`,
    ]));
  }

  if (scheduledReminderRequest.serviceTier !== "flex") {
    throw new Error(await requireScenario().buildFailureMessage(input.userId, [
      "Scheduled reminder cron provider request did not use OpenAI flex service tier.",
      `observed provider requests: ${JSON.stringify(requestSummaries)}`,
    ]));
  }
}

function summarizeAssistantProviderRequest(
  request: HostedLocalAssistantProviderStubRequest,
): {
  method: string;
  model: string | null;
  serviceTier: string | null;
  url: string;
} {
  const bodyJson = parseJsonObject(request.body);

  return {
    method: request.method,
    model: typeof bodyJson?.model === "string" ? bodyJson.model : null,
    serviceTier: typeof bodyJson?.service_tier === "string"
      ? bodyJson.service_tier
      : null,
    url: request.url,
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
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

function buildDailyCronExpressionInTimeZone(input: {
  at: string;
  timeZone: string;
}): string {
  const date = new Date(input.at);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid scheduled newsletter timestamp: ${input.at}`);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    minute: "numeric",
    timeZone: input.timeZone,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!hour || !minute) {
    throw new Error(`Could not resolve cron time in ${input.timeZone}.`);
  }
  return `${Number.parseInt(minute, 10)} ${Number.parseInt(hour, 10)} * * *`;
}

function buildTelegramSenderUserId(memberId: string): string {
  return buildTelegramThreadId(memberId);
}

function buildInboundTelegramUpdate(memberId: string): Record<string, unknown> {
  return {
    message: {
      chat: {
        id: Number.parseInt(buildTelegramThreadId(memberId), 10),
        type: "private",
      },
      date: Math.floor(Date.now() / 1000),
      from: {
        first_name: "Hosted",
        id: Number.parseInt(buildTelegramSenderUserId(memberId), 10),
        is_bot: false,
      },
      message_id: Number.parseInt(buildTelegramMessageId(memberId), 10),
      text: setupRequestText,
    },
    update_id: Number.parseInt(buildTelegramMessageId(memberId), 10),
  };
}

function buildInboundTelegramGroupUpdate(memberId: string): Record<string, unknown> {
  return {
    message: {
      chat: {
        id: Number.parseInt(telegramGroupThreadId, 10),
        title: "Hosted local family chat",
        type: "group",
      },
      date: Math.floor(Date.now() / 1000),
      from: {
        first_name: "Hosted",
        id: Number.parseInt(buildTelegramSenderUserId(memberId), 10),
        is_bot: false,
      },
      message_id: Number.parseInt(buildTelegramMessageId(memberId), 10) + 1,
      text: groupSetupRequestText,
    },
    update_id: Number.parseInt(buildTelegramMessageId(memberId), 10) + 1,
  };
}

async function postTelegramWebhook(update: Record<string, unknown>): Promise<Response> {
  return await fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/telegram/webhook`, {
    body: JSON.stringify(update),
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": telegramWebhookSecret,
    },
    method: "POST",
  });
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

function requireGroupContainerMemberId(): string {
  if (!groupContainerMemberId) {
    throw new Error("Expected the Telegram group runtime to be initialized.");
  }
  return groupContainerMemberId;
}

function requireGroupNewsletterDueAtIso(): string {
  if (!groupNewsletterDueAtIso) {
    throw new Error("Expected the scheduled Telegram group newsletter due time.");
  }
  return groupNewsletterDueAtIso;
}
