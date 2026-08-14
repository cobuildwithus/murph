import { createHmac } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import {
  listHostedRuntimeLogsForTest,
  seedHostedGroupEmailAuthorizationForTest,
  seedHostedLaunchConsentForTest,
} from "#hosted-web-testing";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildAssistantProviderMurphToolCall,
  type HostedLocalAssistantProviderScriptedResponse,
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
const ownerMemberId = `member_local_group_email_owner_${runId}`;
const missingEmailMemberId = `member_local_group_email_missing_${runId}`;
const groupChatId = `chat_local_group_email_${runId}`;
const ownerPhone = buildLinqRecipientPhoneNumber(ownerMemberId);
const missingEmailPhone = buildLinqRecipientPhoneNumber(missingEmailMemberId);
const homePhone = buildLinqHomePhoneNumber(ownerMemberId);
const ownerEmail = `eligible-${runId}@example.test`;
const linqApiToken = "linq-local-group-email-token";
const linqWebhookSecret = "linq-local-group-email-webhook-secret";
const bootstrapText = "Initialize this hosted-local group runtime.";
const bootstrapReplyText = "The group runtime is ready.";
const setupRequestText = "Set up our health newsletter by email.";
const setupReplyText = "The group email newsletter is scheduled.";
const newsletterSubject = "Hosted-local group health edition";
const newsletterText = "The authorized group health edition is ready.";
const newsletterHtml = `<p>${newsletterText}</p>`;
const groupReplyPath = `/chats/${encodeURIComponent(groupChatId)}/messages`;
const productionLikeAssistantModel = "gpt-5.6-terra";
const scheduledWaitMs = 240_000;
const projectionScopes = [
  { projectionKind: "steps-days.v0" },
  { projectionKind: "activity-days.v0" },
  { projectionKind: "workout-days.v0" },
  { projectionKind: "workouts.v0" },
  { projectionKind: "sleep-duration-days.v0" },
  { projectionKind: "sleep-times.v0" },
  { projectionKind: "resting-heart-rate-days.v0" },
  { projectionKind: "hrv-days.v0" },
] as const;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local group email newsletter e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      canonicalChats: [{
        chatId: groupChatId,
        handles: [
          { handle: homePhone, isMe: true, status: "active" },
          { handle: ownerPhone, isMe: false, status: "active" },
          { handle: missingEmailPhone, isMe: false, status: "active" },
        ],
        isGroup: true,
      }],
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: [
          ownerPhone,
          missingEmailPhone,
        ].join(","),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      assistantProviderStubModelId: productionLikeAssistantModel,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-group-email-newsletter-",
      requiredRunnerEnvProfile: "hosted-email,linq",
      scenarioLabel: "Local hosted group email newsletter e2e",
      streamLogs: streamDevLogs,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 180_000);

  it("settles one scheduled eight-scope edition through generic group email without a chat copy", async () => {
    await Promise.all([
      requireScenario().seedActiveHostedLinqMember({
        homePhone,
        memberId: ownerMemberId,
        memberPhone: ownerPhone,
      }),
      requireScenario().seedActiveHostedLinqMember({
        homePhone: buildLinqHomePhoneNumber(missingEmailMemberId),
        memberId: missingEmailMemberId,
        memberPhone: missingEmailPhone,
      }),
    ]);
    await Promise.all([
      seedHostedLaunchConsentForTest({
        environment: requireScenario().runtimeEnv,
        memberId: ownerMemberId,
      }),
      seedHostedLaunchConsentForTest({
        environment: requireScenario().runtimeEnv,
        memberId: missingEmailMemberId,
      }),
    ]);
    await Promise.all([
      requireScenario().runWake(buildActivationWake(ownerMemberId), ownerMemberId),
      requireScenario().runWake(
        buildActivationWake(missingEmailMemberId),
        missingEmailMemberId,
      ),
    ]);
    const [ownerActivated, missingEmailActivated] = await Promise.all([
      requireScenario().waitForHostedCompletion(ownerMemberId),
      requireScenario().waitForHostedCompletion(missingEmailMemberId),
    ]);
    expect(ownerActivated.lastErrorCode ?? null).toBeNull();
    expect(missingEmailActivated.lastErrorCode ?? null).toBeNull();

    requireScenario().queueAssistantResponses(
      [bootstrapReplyText],
      { matchInputContains: bootstrapText },
    );
    const bootstrapSendBaseline = requireLinqStub().countObservedSends(groupReplyPath);
    const bootstrapWebhook = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      ownerMemberId,
      groupChatId,
      {
        eventId: `evt_group_email_bootstrap_${runId}`,
        isGroup: true,
        messageId: `msg_group_email_bootstrap_${runId}`,
        service: "iMessage",
        text: bootstrapText,
      },
    ));
    expect(bootstrapWebhook.status).toBe(202);
    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: bootstrapSendBaseline + 1,
      expectedPath: groupReplyPath,
      scenario: requireScenario(),
      userId: ownerMemberId,
    });
    const route = await waitForGroupRoute();
    const bootstrapped = await requireScenario().waitForHostedCompletion(
      route.containerMemberId,
    );
    expect(bootstrapped.lastErrorCode ?? null).toBeNull();

    await seedHostedGroupEmailAuthorizationForTest({
      environment: requireScenario().runtimeEnv,
      participants: [
        { memberId: ownerMemberId, verifiedEmail: ownerEmail },
        { memberId: missingEmailMemberId },
      ],
      projectionScopes,
      runtimeMemberId: route.containerMemberId,
    });

    const schedule = resolveNextNaturalCron();
    const automationInstructions = buildNewsletterInstructions();
    requireScenario().queueAssistantResponses(
      buildAutomationSaveResponses({
        instructions: automationInstructions,
        schedule,
      }),
      { matchInputContains: setupRequestText },
    );
    const setupSendBaseline = requireLinqStub().countObservedSends(groupReplyPath);
    const setupWebhook = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      ownerMemberId,
      groupChatId,
      {
        eventId: `evt_group_email_setup_${runId}`,
        isGroup: true,
        messageId: `msg_group_email_setup_${runId}`,
        service: "iMessage",
        text: setupRequestText,
      },
    ));
    expect(setupWebhook.status).toBe(202);
    const setupSends = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: setupSendBaseline + 1,
      expectedPath: groupReplyPath,
      scenario: requireScenario(),
      userId: route.containerMemberId,
    });
    const setupSend = setupSends.at(-1);
    if (!setupSend) {
      throw new Error("Expected the newsletter setup confirmation send.");
    }
    expect(requireLinqStub().readObservedMessageText(setupSend))
      .toBe(setupReplyText);
    const setupStatus = await requireScenario().waitForHostedCompletion(
      route.containerMemberId,
    );
    expect(setupStatus.lastErrorCode ?? null).toBeNull();
    await waitForScheduledWake({
      dueAtIso: schedule.dueAtIso,
      userId: route.containerMemberId,
    });

    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("group", {
        action: "read_shared",
        audience: "group_email",
        projectionScopes,
      }),
      buildAssistantProviderMurphToolCall("group", {
        action: "send_email",
        html: newsletterHtml,
        subject: newsletterSubject,
        text: newsletterText,
      }),
    ], { matchInputContains: automationInstructions });
    const providerRequestBaseline = countAssistantProviderRequests();
    const chatSendBaseline = requireLinqStub().countObservedSends(groupReplyPath);
    const scheduledLogsNotBefore = new Date();

    await sleepUntil(schedule.dueAtIso);
    await waitForAssistantProviderRequestCount({
      minimumCount: providerRequestBaseline + 2,
      userId: route.containerMemberId,
    });
    const deliveryLogs = await waitForTwoSentEmailEffects({
      fromAt: scheduledLogsNotBefore,
      userId: route.containerMemberId,
    });
    const finalStatus = await requireScenario().waitForHostedCompletion(
      route.containerMemberId,
      { timeoutMs: scheduledWaitMs },
    );
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    await sleep(1_000);

    const scheduledRequests = listAssistantProviderRequests()
      .slice(providerRequestBaseline);
    expect(scheduledRequests).toHaveLength(2);
    const modelExchange = scheduledRequests
      .map((request) => collectJsonStrings(JSON.parse(request.body)).join("\n"))
      .join("\n");
    for (const scope of projectionScopes) {
      expect(modelExchange).toContain(scope.projectionKind);
    }
    expect(modelExchange).toContain('"recipientCount":1');
    expect(modelExchange).toContain('"missingVerifiedEmailCount":1');
    for (const forbidden of [
      ownerEmail,
      ownerMemberId,
      missingEmailMemberId,
      route.containerMemberId,
      "authorizationProof",
      "preparationId",
      "recipientMemberId",
      "shareId",
    ]) {
      expect(modelExchange).not.toContain(forbidden);
    }

    expect(requireLinqStub().countObservedSends(groupReplyPath))
      .toBe(chatSendBaseline);
    expect(deliveryLogs.reduce(
      (total, log) => total + readLogCount(log.redactedJson?.attempted),
      0,
    )).toBe(2);
    expect(deliveryLogs.reduce(
      (total, log) => total + readLogCount(log.redactedJson?.sent),
      0,
    )).toBe(2);
    expect(deliveryLogs.every((log) =>
      log.redactedJson?.deliveryChannelSummary === "email:1"
    )).toBe(true);
    expect(finalStatus.workspace?.nextWakeAt).toBeTruthy();
    expect(Date.parse(finalStatus.workspace?.nextWakeAt ?? ""))
      .toBeGreaterThan(Date.now() + 20 * 60 * 60 * 1_000);
  }, 720_000);
});

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:group-email-newsletter`,
    memberChannels: { email: false, linq: true, telegram: false },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

function buildAutomationSaveResponses(input: {
  instructions: string;
  schedule: ReturnType<typeof resolveNextNaturalCron>;
}): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderMurphToolCall("automation", {
      action: "save",
      continuityPolicy: "fresh",
      instructions: input.instructions,
      schedule: {
        expression: input.schedule.expression,
        kind: "cron",
        timeZone: "UTC",
      },
      slug: "group-health-newsletter",
      summary: "Share the group's scheduled health newsletter by email.",
      tags: ["assistant", "scheduled"],
      title: "Hosted-local group health newsletter",
    }),
    setupReplyText,
  ];
}

function buildNewsletterInstructions(): string {
  return [
    "Open and follow $MURPH_ASSISTANT_SKILLS_ROOT/group-newsletter/SKILL.md before doing anything else.",
    "Newsletter recipe JSON:",
    JSON.stringify({
      customNote: null,
      delivery: "group_email",
      newsletterName: "Hosted-local group health newsletter",
      projectionScopes: projectionScopes.map((scope) => scope.projectionKind),
      tone: "supportive",
    }),
  ].join("\n");
}

function resolveNextNaturalCron(now = new Date()): {
  dueAtIso: string;
  expression: string;
} {
  const earliest = new Date(now.getTime() + 90_000);
  const dueAt = new Date(earliest);
  dueAt.setUTCSeconds(0, 0);
  if (dueAt.getTime() < earliest.getTime()) {
    dueAt.setUTCMinutes(dueAt.getUTCMinutes() + 1);
  }
  return {
    dueAtIso: dueAt.toISOString(),
    expression: `${dueAt.getUTCMinutes()} ${dueAt.getUTCHours()} * * *`,
  };
}

async function waitForGroupRoute() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    const route = await requireScenario().readHostedThreadRoute({
      channel: "linq",
      threadId: groupChatId,
    });
    if (route) return route;
    await sleep(250);
  }
  throw new Error(await requireScenario().buildFailureMessage(ownerMemberId, [
    "Timed out waiting for the group runtime route.",
  ]));
}

async function waitForScheduledWake(input: {
  dueAtIso: string;
  userId: string;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    const status = await requireScenario().harness.readUserStatus(input.userId);
    const nextWakeAt = status.workspace?.nextWakeAt ?? null;
    if (
      nextWakeAt
      && Date.parse(nextWakeAt) <= Date.parse(input.dueAtIso)
      && Date.parse(nextWakeAt) > Date.now()
    ) {
      return;
    }
    await sleep(500);
  }
  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the scheduled group email wake.",
    `expected due time: ${input.dueAtIso}`,
  ]));
}

async function waitForAssistantProviderRequestCount(input: {
  minimumCount: number;
  userId: string;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < scheduledWaitMs) {
    if (countAssistantProviderRequests() >= input.minimumCount) return;
    await sleep(250);
  }
  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the scheduled group email model exchange.",
    `expected provider request count: ${input.minimumCount}`,
    `actual provider request count: ${countAssistantProviderRequests()}`,
  ]));
}

async function waitForTwoSentEmailEffects(input: {
  fromAt: Date;
  userId: string;
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < scheduledWaitMs) {
    const logs = (await listHostedRuntimeLogsForTest({
      environment: requireScenario().runtimeEnv,
      fromAt: input.fromAt,
      userId: input.userId,
    })).filter((log) =>
      log.eventCode === "outbox.delivery_finished"
      && log.redactedJson?.deliveryChannelSummary === "email:1"
    );
    const sent = logs.reduce(
      (total, log) => total + readLogCount(log.redactedJson?.sent),
      0,
    );
    if (sent >= 2) return logs;
    await sleep(500);
  }
  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the group email parent and recipient fanout to settle.",
  ]));
}

async function sleepUntil(dueAtIso: string): Promise<void> {
  const dueAtMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueAtMs)) {
    throw new Error(`Invalid scheduled group email due timestamp: ${dueAtIso}`);
  }
  const delayMs = dueAtMs - Date.now() + 750;
  if (delayMs > 0) await sleep(delayMs);
}

function listAssistantProviderRequests() {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.method === "POST" && request.url === "/v1/responses"
  );
}

function countAssistantProviderRequests(): number {
  return listAssistantProviderRequests().length;
}

function readLogCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body: rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": `sha256=${signature}`,
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectJsonStrings);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(collectJsonStrings);
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) throw new Error("Hosted local Linq stub was not initialized.");
  return linqStub;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) throw new Error("Hosted local full-stack scenario was not initialized.");
  return scenario;
}
