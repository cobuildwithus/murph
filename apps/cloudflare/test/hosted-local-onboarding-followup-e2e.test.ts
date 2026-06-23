import { createHmac } from "node:crypto";
import {
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
} from "@murphai/assistant-engine";
import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
  buildHostedLinqInboundEvent,
  buildHostedLinqSignupWelcomeWake,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  type ObservedLinqRequest,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const userId = `member_local_linq_onboarding_followup_${Date.now()}`;
const linqWebhookSecret = "linq-local-onboarding-followup-secret";
const followupSlug = MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug;
const followupTitle = MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title;
const followupSummary = MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary;
const followupInstructions = MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions;
const followupTags = MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags;
const followupReminderText = "Want to finish setup? Send me where you left off and we can continue.";
const accelerationReplyText = "Done - I will check back soon so we can finish setup.";
const onboardingCompleteReplyText = "Setup is marked complete.";
const acceleratedEveryMs = 90_000;
const minimumScheduleRunwayMs = 10_000;
const scheduledSendWaitMs = 120_000;
const secondPeriodQuietWindowMs = 5_000;
const seededDailyFollowupMinimumDelayMs = 60 * 60 * 1000;
const seededDailyFollowupMaxDelayMs = 36 * 60 * 60 * 1000;
const productionLikeAssistantModel = "gpt-5.5";

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

describe("hosted local onboarding follow-up e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 600_000);

  it("seeds the signup follow-up, sends it once, then self-archives without sending after onboarding completes", async () => {
    const homePhone = buildLinqHomePhoneNumber(userId);
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    const activatedStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(activatedStatus.lastErrorCode ?? null).toBeNull();

    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId: `member.activated:local:${userId}:evt_linq_onboarding_followup`,
        userId,
      }),
      userId,
    );
    const welcomeSendPromise = requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(userId),
      scenario: requireScenario(),
      userId,
    });
    const welcomeStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(welcomeStatus.lastErrorCode ?? null).toBeNull();
    await welcomeSendPromise;
    await requireScenario().waitForHostedIdle(userId);

    const seededWakeAt = await waitForHostedWorkspaceNextWakeAfter({
      afterMs: Date.now(),
      label: "seeded daily onboarding follow-up",
      maxDelayMs: seededDailyFollowupMaxDelayMs,
      minDelayMs: seededDailyFollowupMinimumDelayMs,
      userId,
    });
    expect(Date.parse(seededWakeAt)).toBeGreaterThan(Date.now());

    const materializedChatId = requireLinqStub().requireObservedChatId(userId);
    const followupPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const accelerationBaseline = requireLinqStub().countObservedSends(followupPath);
    const accelerationStartedAt = Date.now();
    requireScenario().queueAssistantResponses(
      buildHostedAssistantAccelerateFollowupResponses({
        deliveryTarget: materializedChatId,
        text: accelerationReplyText,
      }),
    );
    const accelerationWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      materializedChatId,
      {
        eventId: `evt_onboarding_followup_accelerate_${userId}`,
        messageId: `msg_onboarding_followup_accelerate_${userId}`,
        text: "Please check the onboarding follow-up soon.",
      },
    ));
    expect(accelerationWebhookResponse.status).toBe(202);
    await expect(accelerationWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const accelerationReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: accelerationBaseline,
      expectedPath: followupPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(accelerationReply))
      .toBe(accelerationReplyText);
    const accelerationStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(accelerationStatus.lastErrorCode ?? null).toBeNull();
    const firstDueAt = await waitForHostedWorkspaceNextWakeAfter({
      afterMs: accelerationStartedAt,
      label: "accelerated onboarding follow-up",
      maxDelayMs: acceleratedEveryMs + 45_000,
      userId,
    });
    assertScheduleRunway(firstDueAt);

    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver onboarding follow-up",
        text: followupReminderText,
      }),
    ]);
    const firstSendBaseline = countOutboundLinqMessageSends();
    const firstSendPromise = waitForAdditionalOutboundLinqSend({
      baselineCount: firstSendBaseline,
      timeoutMs: scheduledSendWaitMs,
      userId,
    });
    await sleepUntil(firstDueAt);
    const firstFollowupSend = await firstSendPromise;
    expect(requireLinqStub().readObservedMessageText(firstFollowupSend))
      .toBe(followupReminderText);
    const firstRunStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(firstRunStatus.lastErrorCode ?? null).toBeNull();
    const secondDueAt = await waitForHostedWorkspaceNextWakeAfter({
      afterMs: Date.parse(firstDueAt),
      label: "second onboarding follow-up",
      maxDelayMs: acceleratedEveryMs + 45_000,
      userId,
    });
    assertScheduleRunway(secondDueAt);

    const completionBaseline = requireLinqStub().countObservedSends(followupPath);
    requireScenario().queueAssistantResponses(
      buildHostedAssistantCompleteOnboardingResponses({
        text: onboardingCompleteReplyText,
      }),
    );
    const completionWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      materializedChatId,
      {
        eventId: `evt_onboarding_followup_complete_${userId}`,
        messageId: `msg_onboarding_followup_complete_${userId}`,
        text: "I finished onboarding.",
      },
    ));
    expect(completionWebhookResponse.status).toBe(202);
    await expect(completionWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const completionReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: completionBaseline,
      expectedPath: followupPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(completionReply))
      .toBe(onboardingCompleteReplyText);
    const completionStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(completionStatus.lastErrorCode ?? null).toBeNull();
    await waitForHostedWorkspaceNextWakeAt({
      expectedNextWakeAt: secondDueAt,
      userId,
    });

    requireScenario().queueAssistantResponses(
      buildHostedAssistantArchiveAndSkipResponses(),
    );
    const secondSendBaseline = countOutboundLinqMessageSends();
    const secondProviderRequestBaseline = requireScenario().assistantProviderRequests.length;
    await sleepUntil(secondDueAt);
    await waitForAssistantProviderRequestCount({
      minimumCount: secondProviderRequestBaseline + 1,
      timeoutMs: scheduledSendWaitMs,
      userId,
    });
    const secondRunStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(secondRunStatus.lastErrorCode ?? null).toBeNull();
    await expectNoAdditionalOutboundLinqSend({
      baselineCount: secondSendBaseline,
      quietWindowMs: secondPeriodQuietWindowMs,
    });
    await waitForHostedWorkspaceNextWakeCleared(userId);
  }, 720_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "30000",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-onboarding-followup-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted onboarding follow-up e2e",
    streamLogs: streamDevLogs,
  });
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_linq_onboarding_followup`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
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
        "Hosted runner reported an error before checkpointing the onboarding follow-up wake.",
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
    "Timed out waiting for the hosted workspace to checkpoint the onboarding follow-up wake.",
    `expectedNextWakeAt: ${input.expectedNextWakeAt}`,
    `latestNextWakeAt: ${latestNextWakeAt ?? "null"}`,
    `latestNextAlarmAt: ${latestNextAlarmAt ?? "null"}`,
    latestError ? `latest status read error: ${latestError}` : null,
  ].filter((line): line is string => Boolean(line))));
}

function countOutboundLinqMessageSends(): number {
  return listOutboundLinqMessageSends().length;
}

function listOutboundLinqMessageSends(): ObservedLinqRequest[] {
  return requireLinqStub().observedRequests.filter((request) =>
    request.method === "POST"
    && (
      request.url === requireLinqStub().createChatPath
      || /^\/chats\/[^/]+\/messages$/u.test(request.url)
    )
  );
}

async function waitForAdditionalOutboundLinqSend(input: {
  baselineCount: number;
  timeoutMs: number;
  userId: string;
}): Promise<ObservedLinqRequest> {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < input.timeoutMs) {
    const matchingRequests = listOutboundLinqMessageSends();
    if (matchingRequests.length > input.baselineCount) {
      return matchingRequests.at(-1)!;
    }

    const status = await requireScenario().harness.readUserStatus(input.userId).catch(() => null);
    if (status?.lastErrorCode) {
      throw new Error(await requireScenario().buildFailureMessage(input.userId, [
        `Hosted runner reported ${status.lastErrorCode} before the expected onboarding follow-up send was observed.`,
        `observed requests: ${JSON.stringify(summarizeObservedLinqRequests())}`,
      ]));
    }

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the onboarding follow-up Linq send.",
    `baseline count: ${input.baselineCount}`,
    `observed requests: ${JSON.stringify(summarizeObservedLinqRequests())}`,
  ]));
}

async function expectNoAdditionalOutboundLinqSend(input: {
  baselineCount: number;
  quietWindowMs: number;
}): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < input.quietWindowMs) {
    const matchingRequests = listOutboundLinqMessageSends();
    expect(matchingRequests.length).toBe(input.baselineCount);
    await sleep(250);
  }
}

function summarizeObservedLinqRequests(): Array<{ method: string; url: string }> {
  return requireLinqStub().observedRequests.slice(-20).map((request) => ({
    method: request.method,
    url: request.url,
  }));
}

async function waitForHostedWorkspaceNextWakeAfter(input: {
  afterMs: number;
  label: string;
  maxDelayMs: number;
  minDelayMs?: number;
  userId: string;
}): Promise<string> {
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
        `Hosted runner reported an error before checkpointing ${input.label}.`,
        `lastErrorCode: ${status.lastErrorCode}`,
      ]));
    }

    latestNextWakeAt = status.workspace?.nextWakeAt ?? null;
    latestNextAlarmAt = status.nextAlarmAt ?? null;
    const nextWakeAtMs = latestNextWakeAt ? Date.parse(latestNextWakeAt) : NaN;
    if (latestNextWakeAt && Number.isFinite(nextWakeAtMs) && nextWakeAtMs > input.afterMs) {
      const delayMs = nextWakeAtMs - input.afterMs;
      if (input.minDelayMs !== undefined && delayMs < input.minDelayMs) {
        await sleep(1_000);
        continue;
      }
      if (delayMs > input.maxDelayMs) {
        throw new Error(await requireScenario().buildFailureMessage(input.userId, [
          `Hosted workspace checkpointed ${input.label} too far in the future.`,
          `nextWakeAt: ${latestNextWakeAt}`,
          `delayMs: ${delayMs}`,
          `maxDelayMs: ${input.maxDelayMs}`,
        ]));
      }
      return latestNextWakeAt;
    }

    await sleep(1_000);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    `Timed out waiting for the hosted workspace to checkpoint ${input.label}.`,
    `latestNextWakeAt: ${latestNextWakeAt ?? "null"}`,
    `latestNextAlarmAt: ${latestNextAlarmAt ?? "null"}`,
    input.minDelayMs !== undefined ? `minDelayMs: ${input.minDelayMs}` : null,
    `maxDelayMs: ${input.maxDelayMs}`,
    latestError ? `latest status read error: ${latestError}` : null,
  ].filter((line): line is string => Boolean(line))));
}

async function waitForHostedWorkspaceNextWakeCleared(userId: string): Promise<void> {
  const startedAt = Date.now();
  let latestNextWakeAt: string | null = null;
  let latestNextAlarmAt: string | null = null;

  while ((Date.now() - startedAt) < 120_000) {
    const status = await requireScenario().harness.readUserStatus(userId);
    if (status.lastErrorCode) {
      throw new Error(await requireScenario().buildFailureMessage(userId, [
        "Hosted runner reported an error before clearing the onboarding follow-up wake.",
        `lastErrorCode: ${status.lastErrorCode}`,
      ]));
    }

    latestNextWakeAt = status.workspace?.nextWakeAt ?? null;
    latestNextAlarmAt = status.nextAlarmAt ?? null;
    if (!latestNextWakeAt && !latestNextAlarmAt) {
      return;
    }

    await sleep(1_000);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the hosted workspace to clear the onboarding follow-up wake.",
    `latestNextWakeAt: ${latestNextWakeAt ?? "null"}`,
    `latestNextAlarmAt: ${latestNextAlarmAt ?? "null"}`,
  ]));
}

async function waitForAssistantProviderRequestCount(input: {
  minimumCount: number;
  timeoutMs: number;
  userId: string;
}): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < input.timeoutMs) {
    if (requireScenario().assistantProviderRequests.length >= input.minimumCount) {
      return;
    }

    const status = await requireScenario().harness.readUserStatus(input.userId).catch(() => null);
    if (status?.lastErrorCode) {
      throw new Error(await requireScenario().buildFailureMessage(input.userId, [
        `Hosted runner reported ${status.lastErrorCode} before the expected onboarding follow-up skip turn ran.`,
        `assistant provider request count: ${requireScenario().assistantProviderRequests.length}`,
      ]));
    }

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the onboarding follow-up skip turn to call the assistant provider.",
    `expected request count: ${input.minimumCount}`,
    `actual request count: ${requireScenario().assistantProviderRequests.length}`,
  ]));
}

function buildHostedAssistantAccelerateFollowupResponses(input: {
  deliveryTarget: string;
  text: string;
}): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderVaultCliCall([
      "automation",
      "save",
      followupTitle,
      "--request-id",
      `hosted-local-onboarding-followup-accelerate-${userId}`,
      "--slug",
      followupSlug,
      "--status",
      "active",
      "--instructions",
      followupInstructions,
      "--summary",
      followupSummary,
      ...followupTags.flatMap((tag) => ["--tags", tag]),
      "--continuity-policy",
      "preserve",
      "--channel",
      "linq",
      "--delivery-target",
      input.deliveryTarget,
      "--schedule-kind",
      "every",
      "--schedule-every-ms",
      String(acceleratedEveryMs),
    ]),
    input.text,
  ];
}

function buildHostedAssistantCompleteOnboardingResponses(input: {
  text: string;
}): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderVaultCliCall([
      "assistant",
      "onboarding",
      "complete",
      "--reason",
      "manual",
    ]),
    input.text,
  ];
}

function buildHostedAssistantArchiveAndSkipResponses(): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderVaultCliCall([
      "automation",
      "set-status",
      followupSlug,
      "--status",
      "archived",
    ]),
    JSON.stringify({
      kind: "skip",
      privateSummary: "Onboarding is complete; archived the follow-up automation.",
    }),
  ];
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

function assertScheduleRunway(dueAtIso: string): void {
  const dueAtMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueAtMs)) {
    throw new Error(`Invalid onboarding follow-up due timestamp: ${dueAtIso}`);
  }

  const remainingMs = dueAtMs - Date.now();
  if (remainingMs < minimumScheduleRunwayMs) {
    throw new Error([
      "Onboarding follow-up E2E reached Temporal scheduling too close to due time.",
      `remainingMs: ${remainingMs}`,
      `minimumRunwayMs: ${minimumScheduleRunwayMs}`,
      `dueAtIso: ${dueAtIso}`,
    ].join("\n"));
  }
}

async function sleepUntil(dueAtIso: string): Promise<void> {
  const dueAtMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueAtMs)) {
    throw new Error(`Invalid onboarding follow-up due timestamp: ${dueAtIso}`);
  }

  const delayMs = dueAtMs - Date.now() + 750;
  if (delayMs > 0) {
    await sleep(delayMs);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
