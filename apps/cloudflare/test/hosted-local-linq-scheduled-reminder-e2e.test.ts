import { createHmac } from "node:crypto";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  listHostedAiUsageForTest,
  type HostedAiUsageForTestRow,
} from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildAssistantProviderVaultCliCall,
  buildHostedAssistantNotificationDecisionResponse,
  type HostedLocalAssistantProviderStubRequest,
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

const userId = `member_local_linq_scheduled_reminder_${Date.now()}`;
const linqWebhookSecret = "linq-local-scheduled-reminder-secret";
const reminderText = "Time to sleep. Put the phone down and get some rest.";
const fastDeployGate = process.env.MURPH_HOSTED_LOCAL_E2E_FAST_GATE === "1";
const scheduledReminderFullLeadMs = 300_000;
const scheduledReminderFastGateLeadMs = 120_000;
const scheduledReminderLeadMs = resolveScheduledReminderLeadMs(fastDeployGate);
const setupLeadText = fastDeployGate ? "about two minutes" : "about five minutes";
const setupReplyText = `Done - I will remind you here in ${setupLeadText}.`;
const setupRequestText = `Remind me here in ${setupLeadText} to go to sleep.`;
const scheduledReminderMinimumRunwayMs = 10_000;
const scheduledReminderSendWaitMs = 240_000;
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

describe("hosted local Linq scheduled reminder e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 600_000);

  it("creates a reminder from the hosted assistant turn, wakes from the scheduled alarm, and sends it", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    const activatedStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(activatedStatus.lastErrorCode ?? null).toBeNull();

    const unscheduledStatus = await requireScenario().harness.readUserStatus(userId);
    expect(unscheduledStatus.workspace?.nextWakeAt ?? null).toBeNull();
    expect(unscheduledStatus.nextAlarmAt ?? null).toBeNull();

    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId: `member.activated:local:${userId}:evt_linq_scheduled_chat`,
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

    const scheduledChatId = requireLinqStub().requireObservedChatId(userId);
    const reminderPath = `/chats/${encodeURIComponent(scheduledChatId)}/messages`;
    const setupReplyBaselineCount = requireLinqStub().countObservedSends(reminderPath);
    const scheduledReminderTimes = resolveScheduledReminderTimes();
    requireScenario().queueAssistantResponses(
      buildHostedAssistantAutomationSaveResponses({
        dueAtIso: scheduledReminderTimes.dueAtIso,
        deliveryTarget: scheduledChatId,
        text: setupReplyText,
      }),
    );
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      scheduledChatId,
      {
        eventId: `evt_scheduled_reminder_setup_${userId}`,
        messageId: `msg_scheduled_reminder_setup_${userId}`,
        text: setupRequestText,
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const setupReplySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: setupReplyBaselineCount,
      expectedPath: reminderPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(setupReplySend)).toBe(setupReplyText);
    const setupStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(setupStatus.lastErrorCode ?? null).toBeNull();
    assertScheduledReminderRunway(scheduledReminderTimes.dueAtIso);

    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver sleep reminder",
        text: reminderText,
      }),
    ]);
    const reminderSendBaselineCount = requireLinqStub().countObservedSends(reminderPath);
    const reminderProviderRequestBaselineCount =
      requireScenario().assistantProviderRequests.length;
    const reminderCronUsageNotBeforeIso = new Date().toISOString();
    await sleepUntil(scheduledReminderTimes.dueAtIso);
    const sendRequest = await waitForScheduledReminderSend({
      baselineCount: reminderSendBaselineCount,
      expectedPath: reminderPath,
      timeoutMs: scheduledReminderSendWaitMs,
      userId,
    });

    expect(sendRequest.method).toBe("POST");
    expect(requireLinqStub().readObservedMessageText(sendRequest)).toBe(reminderText);
    const reminderStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(reminderStatus.lastErrorCode ?? null).toBeNull();
    const providerRequestTokenPricingBasis =
      await resolveScheduledReminderCronProviderRequestTokenPricingBasis({
        baselineCount: reminderProviderRequestBaselineCount,
        userId,
      });
    await assertScheduledReminderCronUsagePricingMatchedProviderRequest({
      expectedTokenPricingBasis: providerRequestTokenPricingBasis,
      memberId: userId,
      notBeforeIso: reminderCronUsageNotBeforeIso,
    });
  }, 720_000);
});

describe("hosted local Linq scheduled reminder timing helpers", () => {
  it("uses a two-minute lead for fast deploy gates and five minutes otherwise", () => {
    const now = new Date("2026-06-18T12:00:00.000Z");

    expect(resolveScheduledReminderLeadMs(true)).toBe(scheduledReminderFastGateLeadMs);
    expect(resolveScheduledReminderLeadMs(false)).toBe(scheduledReminderFullLeadMs);
    expect(resolveScheduledReminderTimes(now, scheduledReminderFastGateLeadMs)).toEqual({
      dueAtIso: "2026-06-18T12:02:00.000Z",
    });
    expect(resolveScheduledReminderTimes(now, scheduledReminderFullLeadMs)).toEqual({
      dueAtIso: "2026-06-18T12:05:00.000Z",
    });
    expect(resolveScheduledReminderTimes(now)).toEqual({
      dueAtIso: fastDeployGate
        ? "2026-06-18T12:02:00.000Z"
        : "2026-06-18T12:05:00.000Z",
    });
    expect(scheduledReminderLeadMs).toBeGreaterThan(scheduledReminderMinimumRunwayMs);
  });
});

type ScheduledReminderTokenPricingBasis = "openai-flex" | "standard";

async function resolveScheduledReminderCronProviderRequestTokenPricingBasis(input: {
  baselineCount: number;
  userId: string;
}): Promise<ScheduledReminderTokenPricingBasis> {
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

  return "openai-flex";
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

async function assertScheduledReminderCronUsagePricingMatchedProviderRequest(input: {
  expectedTokenPricingBasis: ScheduledReminderTokenPricingBasis;
  memberId: string;
  notBeforeIso: string;
}): Promise<void> {
  const usageRows = await listHostedAiUsageForTest({
    environment: requireScenario().runtimeEnv,
    memberId: input.memberId,
  });
  const cronRows = usageRows.filter((row) =>
    row.triggerKind === "automation_cron" && row.occurredAt >= input.notBeforeIso
  );
  expect(cronRows.length).toBeGreaterThan(0);

  const expectedPricingVersion = input.expectedTokenPricingBasis === "openai-flex"
    ? "openai-api-pricing-2026-05-05-openai-flex"
    : "openai-api-pricing-2026-05-05-standard";
  const expectedAdjustmentDenominator =
    input.expectedTokenPricingBasis === "openai-flex" ? "2" : "1";

  for (const cronUsage of cronRows) {
    expect(cronUsage).toMatchObject({
      allowanceCounted: true,
      allowancePricingVersion: expectedPricingVersion,
      credentialSource: "platform",
      providerName: "hosted-openai",
      requestedModel: productionLikeAssistantModel,
      servedModel: productionLikeAssistantModel,
      surface: "linq",
      tokenPricingBasis: input.expectedTokenPricingBasis,
      triggerKind: "automation_cron",
    });
    expect(BigInt(cronUsage.allowanceCostUsdMicros) > 0n).toBe(true);
    expect(cronUsage.allowancePricingSnapshotJson).toMatchObject({
      tokenPricingAdjustment: {
        denominator: expectedAdjustmentDenominator,
        numerator: "1",
      },
      tokenPricingBasis: input.expectedTokenPricingBasis,
    });

    if (input.expectedTokenPricingBasis === "openai-flex") {
      assertOpenAiFlexUsageCostsAdjustedFromStandard(cronUsage);
    } else {
      assertStandardUsageCostsMatchStandardCost(cronUsage);
    }
  }
}

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
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-linq-scheduled-reminder-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Linq scheduled reminder e2e",
    streamLogs: streamDevLogs,
  });
}

function buildHostedAssistantAutomationSaveResponses(input: {
  deliveryTarget: string;
  dueAtIso: string;
  text: string;
}): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderVaultCliCall([
      "automation",
      "save",
      "Sleep reminder",
      "--request-id",
      `hosted-local-reminder-${userId}`,
      "--instructions",
      "Send the user a short reminder to go to sleep.",
      "--summary",
      "One-shot sleep reminder.",
      "--tags",
      "assistant",
      "--tags",
      "scheduled",
      "--continuity-policy",
      "preserve",
      "--channel",
      "linq",
      "--delivery-target",
      input.deliveryTarget,
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
    eventId: `member.activated:local:${memberId}:evt_linq_scheduled_reminder`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForScheduledReminderSend(input: {
  baselineCount: number;
  expectedPath: string;
  timeoutMs: number;
  userId: string;
}): Promise<ObservedLinqRequest> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < input.timeoutMs) {
    const matchingRequests = requireLinqStub().observedRequests.filter((request) =>
      request.method === "POST" && request.url === input.expectedPath
    );
    if (matchingRequests.length > input.baselineCount) {
      return matchingRequests.at(-1)!;
    }

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the scheduled Linq reminder send after the due time.",
    `expected path: ${input.expectedPath}`,
    `baseline count: ${input.baselineCount}`,
    `observed requests: ${JSON.stringify(summarizeObservedLinqRequests())}`,
  ]));
}

function summarizeObservedLinqRequests(): Array<{ method: string; url: string }> {
  return requireLinqStub().observedRequests.slice(-20).map((request) => ({
    method: request.method,
    url: request.url,
  }));
}

function resolveScheduledReminderLeadMs(useFastGate: boolean): number {
  return useFastGate ? scheduledReminderFastGateLeadMs : scheduledReminderFullLeadMs;
}

function resolveScheduledReminderTimes(
  now = new Date(),
  leadMs = scheduledReminderLeadMs,
): {
  dueAtIso: string;
} {
  const dueAtMs = now.getTime() + leadMs;
  return {
    dueAtIso: new Date(dueAtMs).toISOString(),
  };
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

function assertOpenAiFlexUsageCostsAdjustedFromStandard(row: HostedAiUsageForTestRow): void {
  const snapshot = row.allowancePricingSnapshotJson;
  if (!isRecord(snapshot)) {
    throw new Error("Scheduled reminder usage row is missing an allowance pricing snapshot.");
  }

  const standardCostUsdMicros = snapshot.standardCostUsdMicros;
  if (typeof standardCostUsdMicros !== "string") {
    throw new Error("Scheduled reminder pricing snapshot is missing standardCostUsdMicros.");
  }

  const standardCost = BigInt(standardCostUsdMicros);
  expect(BigInt(row.allowanceCostUsdMicros)).toBe((standardCost + 1n) / 2n);
}

function assertStandardUsageCostsMatchStandardCost(row: HostedAiUsageForTestRow): void {
  const snapshot = row.allowancePricingSnapshotJson;
  if (!isRecord(snapshot)) {
    throw new Error("Scheduled reminder usage row is missing an allowance pricing snapshot.");
  }

  const standardCostUsdMicros = snapshot.standardCostUsdMicros;
  if (typeof standardCostUsdMicros !== "string") {
    throw new Error("Scheduled reminder pricing snapshot is missing standardCostUsdMicros.");
  }

  expect(BigInt(row.allowanceCostUsdMicros)).toBe(BigInt(standardCostUsdMicros));
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
