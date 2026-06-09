import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  readHostedExecutionSnapshotHotRef,
  readHostedExecutionSnapshotDeltaRef,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";

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
const userId = `member_local_container_continuity_${runId}`;
const chatId = `chat_local_container_continuity_${runId}`;
const linqWebhookSecret = "linq-local-container-continuity-secret";
const productionLikeAssistantModel = "gpt-5.5";
const firstUserText = "container continuity first input";
const secondUserText = "container continuity second input";
const firstReplyText = "First continuity reply.";
const secondReplyText = "Second continuity reply.";

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

describe("hosted local container continuity e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 300_000);

  it("preserves conversation context across idle-shutdown checkpoint cleanup", async () => {
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

    const baselineSendCount = requireLinqStub().countObservedSends(replyPath);
    const baselineProviderRequestCount = countAssistantProviderResponsesApiRequests();
    const baselineIdleShutdownCleanupCount = countContainerDestroyCompletedLogs();
    requireScenario().queueAssistantResponses([firstReplyText, secondReplyText]);

    const firstWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_container_continuity_first_${runId}`,
        messageId: `msg_container_continuity_first_${runId}`,
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
    expect(firstCompletionStatus.workspace).not.toBeNull();

    const idleShutdownStatus = await waitForIdleShutdownCheckpoint({
      baselineCleanupCount: baselineIdleShutdownCleanupCount,
    });
    expect(idleShutdownStatus.workspace).not.toBeNull();
    expect(readHostedExecutionSnapshotHotRef(idleShutdownStatus.workspace?.snapshotRef ?? null))
      .toBeNull();
    expect(readHostedExecutionSnapshotDeltaRef(idleShutdownStatus.workspace?.snapshotRef ?? null))
      .toBeNull();
    expect(idleShutdownStatus.inFlight).toBe(false);
    expect(idleShutdownStatus.lastErrorCode ?? null).toBeNull();
    expect(countContainerDestroyCompletedLogs())
      .toBeGreaterThan(baselineIdleShutdownCleanupCount);

    const secondWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_container_continuity_second_${runId}`,
        messageId: `msg_container_continuity_second_${runId}`,
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

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);

    const assistantProviderRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(baselineProviderRequestCount);
    expect(assistantProviderRequests).toHaveLength(2);
    const secondPromptText = readAssistantProviderRequestText(assistantProviderRequests[1]!);
    expect(secondPromptText).toContain(firstReplyText);
    expect(secondPromptText).toContain(secondUserText);
  }, 600_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "2000",
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
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
    persistDirPrefix: "murph-hosted-local-container-continuity-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted container continuity e2e",
    streamLogs: streamDevLogs,
  });
}

async function waitForIdleShutdownCheckpoint(input: {
  baselineCleanupCount: number;
}): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastActivityExpiryError: unknown = null;
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < 120_000) {
    const status = await requireScenario().harness.readUserStatus(userId);
    lastStatus = status;
    const hotRef = status.workspace
      ? readHostedExecutionSnapshotHotRef(status.workspace.snapshotRef)
      : null;
    const deltaRef = status.workspace
      ? readHostedExecutionSnapshotDeltaRef(status.workspace.snapshotRef)
      : null;

    if (
      status.workspace
      && hotRef === null
      && deltaRef === null
      && !status.inFlight
      && !status.lastErrorCode
      && countContainerDestroyCompletedLogs() > input.baselineCleanupCount
    ) {
      return status;
    }

    try {
      await requireScenario().harness.expireRunnerActivityForTest(userId);
      lastActivityExpiryError = null;
    } catch (error) {
      lastActivityExpiryError = error;
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for hosted idle-shutdown checkpoint.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
    ...(lastActivityExpiryError
      ? [`last activity expiry error: ${formatErrorMessage(lastActivityExpiryError)}`]
      : []),
  ]));
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function countContainerDestroyCompletedLogs(): number {
  const output = [
    requireScenario().harness.stdoutTail(200_000),
    requireScenario().harness.stderrTail(200_000),
  ].join("\n");

  return output
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        return false;
      }

      let record: unknown;
      try {
        record = JSON.parse(trimmed);
      } catch {
        return false;
      }

      if (!record || typeof record !== "object") {
        return false;
      }

      const candidate = record as {
        message?: unknown;
      };
      return candidate.message === "Hosted execution container destroy completed.";
    }).length;
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

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_container_continuity`,
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local container continuity scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local container continuity Linq stub was not started.");
  }
  return linqStub;
}
