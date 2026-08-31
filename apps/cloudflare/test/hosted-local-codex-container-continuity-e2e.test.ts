import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  listHostedRuntimeLogsForTest,
  readHostedIngressLatencyTraceForTest,
  readHostedMailboxItemForTest,
} from "#hosted-web-testing";
import {
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

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
const userId = `member_local_codex_container_continuity_${runId}`;
const chatId = `chat_local_codex_container_continuity_${runId}`;
const linqWebhookSecret = "linq-local-codex-container-continuity-secret";
const productionLikeAssistantModel = "gpt-5.6-terra";
const firstUserText = "codex container continuity first input";
const secondUserText = "codex container continuity second input";
const firstReplyText = "First Codex continuity reply.";
const secondReplyText = "Second Codex continuity reply.";
const secondEventId = `evt_codex_container_continuity_second_${runId}`;
const runtimeLogLimit = 2_000;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;
let linqStub: HostedLocalLinqStub | null = null;

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local Codex container continuity e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 300_000);

  it("restarts real Codex before a resident workspace restore and resumes the same session", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const homePhone = buildLinqHomePhoneNumber(userId);
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;

    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    expect(requireScenario().runtimeEnv).toMatchObject({
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "stub-local-openai-key",
    });
    expect(
      requireScenario().runtimeEnv[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV],
    ).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/u);

    const baselineSendCount = requireLinqStub().countObservedSends(replyPath);
    const baselineProviderRequestCount = countAssistantProviderResponsesApiRequests();
    requireScenario().queueAssistantResponses([firstReplyText], {
      matchInputContains: firstUserText,
    });
    requireScenario().queueAssistantResponses([secondReplyText], {
      matchInputContains: secondUserText,
    });

    const firstWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_codex_container_continuity_first_${runId}`,
        messageId: `msg_codex_container_continuity_first_${runId}`,
        text: firstUserText,
      }),
    );
    expect(firstWebhookResponse.status).toBe(202);
    await expect(firstWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    const firstReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSendCount,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(firstReply)).toBe(firstReplyText);

    const firstCompletionStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(firstCompletionStatus.lastErrorCode ?? null).toBeNull();

    const secondTurnStartedAt = new Date();
    const providerRequestCountBeforeSecondTurn = countAssistantProviderResponsesApiRequests();
    const secondWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: secondEventId,
        messageId: `msg_codex_container_continuity_second_${runId}`,
        text: secondUserText,
      }),
    );
    expect(secondWebhookResponse.status).toBe(202);
    await expect(secondWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    const secondReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSendCount + 1,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(secondReply)).toBe(secondReplyText);

    const secondCompletionStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(secondCompletionStatus.lastErrorCode ?? null).toBeNull();
    expect(secondCompletionStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);

    const secondTurnEvidence = await waitForResidentCodexRestoreEvidence({
      dedupeKey: secondEventId,
      fromAt: secondTurnStartedAt,
    });
    expect(secondTurnEvidence.runtimeLogs.length).toBeGreaterThan(0);
    expect(secondTurnEvidence.totalRuntimeLogCount).toBeLessThan(runtimeLogLimit);
    expect(secondTurnEvidence.runtimeLogs.some((entry) =>
      entry.redactedJson?.providerTraceKind === "codex.resume_failure"
    )).toBe(false);

    const firstTurnProviderRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(baselineProviderRequestCount, providerRequestCountBeforeSecondTurn);
    const secondTurnProviderRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(providerRequestCountBeforeSecondTurn);

    expect(firstTurnProviderRequests.length).toBeGreaterThan(0);
    expect(secondTurnProviderRequests.length).toBeGreaterThan(0);
    const secondTurnText = secondTurnProviderRequests
      .map((request) => readAssistantProviderRequestText(request))
      .join("\n\n");
    expect(secondTurnText).toContain(secondUserText);
  }, 720_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "low",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      MURPH_E2E_ASSISTANT_PROVIDER_MODE: "live",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderMode: "live",
    assistantProviderMaxResponsesApiRequestBodies: 12,
    assistantProviderRecorder: true,
    assistantProviderStubModelId: productionLikeAssistantModel,
    faultInjection: true,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-codex-container-continuity-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Codex container continuity e2e",
    streamLogs: streamDevLogs,
    testControls: true,
  });
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_codex_container_continuity`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
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

async function waitForResidentCodexRestoreEvidence(input: {
  dedupeKey: string;
  fromAt: Date;
}): Promise<{
  runtimeLogs: Awaited<ReturnType<typeof listHostedRuntimeLogsForTest>>;
  totalRuntimeLogCount: number;
}> {
  const startedAt = Date.now();
  let lastRuntimeLogs: Awaited<ReturnType<typeof listHostedRuntimeLogsForTest>> = [];
  let lastError: unknown = null;

  while (Date.now() - startedAt < 30_000) {
    try {
      const mailboxItem = await readHostedMailboxItemForTest({
        dedupeKey: input.dedupeKey,
        environment: requireScenario().runtimeEnv,
        userId,
      });
      const trace = await readHostedIngressLatencyTraceForTest({
        environment: requireScenario().runtimeEnv,
        mailboxItemId: mailboxItem.id,
        userId,
      });
      if (
        trace.phaseBreakdown?.boot?.restoreWasCold !== false
        || !trace.runtimeAttemptId
        || !trace.workspaceRestoreDoneAt
      ) {
        await sleep(100);
        continue;
      }

      lastRuntimeLogs = await listHostedRuntimeLogsForTest({
        environment: requireScenario().runtimeEnv,
        fromAt: input.fromAt,
        limit: runtimeLogLimit,
        userId,
      });
      if (lastRuntimeLogs.length >= runtimeLogLimit) {
        throw new Error("Second-turn runtime-log query saturated its bounded result.");
      }
      const attemptRuntimeLogs = lastRuntimeLogs.filter((entry) =>
        entry.attemptId === trace.runtimeAttemptId
      );
      const freshCodexInitialized = attemptRuntimeLogs.some((entry) =>
        entry.eventCode === "assistant.automation_detail"
        && entry.redactedJson?.providerTraceKind === "codex.app_server_timing"
        && (
          entry.redactedJson.codexTimingStage === "initialized"
          || entry.redactedJson.codexTimingStage === "preinitialized"
        )
        && entry.redactedJson.codexTimingColdStartReason === "previous-explicit-stop"
      );
      const threadResumed = attemptRuntimeLogs.some((entry) =>
        entry.eventCode === "assistant.automation_detail"
        && entry.redactedJson?.providerTraceKind === "codex.app_server_timing"
        && entry.redactedJson.codexTimingStage === "thread-resumed"
        && entry.redactedJson.codexTimingThreadIdPresent === true
      );
      const threadStarted = attemptRuntimeLogs.some((entry) =>
        entry.eventCode === "assistant.automation_detail"
        && entry.redactedJson?.providerTraceKind === "codex.app_server_timing"
        && entry.redactedJson.codexTimingStage === "thread-started"
      );
      const resumePlan = attemptRuntimeLogs.some((entry) =>
        entry.redactedJson?.providerPlanKind === "provider.plan"
        && entry.redactedJson.codexContinuation === "provider-state-optimization"
        && entry.redactedJson.resumeCodexThreadIdPresent === true
      );
      if (freshCodexInitialized && resumePlan && threadResumed && !threadStarted) {
        return {
          runtimeLogs: attemptRuntimeLogs,
          totalRuntimeLogCount: lastRuntimeLogs.length,
        };
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the resident restore and fresh Codex initialization.",
    `last evidence error: ${String(lastError)}`,
    `second-turn runtime logs: ${JSON.stringify(lastRuntimeLogs)}`,
  ]));
}


function countAssistantProviderResponsesApiRequests(): number {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.url === "/v1/responses"
  ).length;
}

function readAssistantProviderRequestText(request: { body: string }): string {
  return collectJsonStrings(JSON.parse(request.body)).join("\n\n");
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectJsonStrings(entry));
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry) => collectJsonStrings(entry));
  }

  return [];
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  const record = readRecord(parsed);
  if (!record) {
    throw new Error("Expected JSON object.");
  }

  return record;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local Codex container continuity scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Codex container continuity Linq stub was not started.");
  }
  return linqStub;
}
