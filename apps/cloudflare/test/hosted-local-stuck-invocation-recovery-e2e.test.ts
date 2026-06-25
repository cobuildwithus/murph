import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedRunnerStatusResponse,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRunnerStatusResponse,
  HostedRuntimeLogEntry,
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
const userId = `member_local_stuck_invocation_${runId}`;
const chatId = `chat_local_stuck_invocation_${runId}`;
const linqWebhookSecret = "linq-local-stuck-invocation-secret";
const productionLikeAssistantModel = "gpt-5.5";
const firstUserText = "stuck invocation setup input";
const firstReplyText = "Setup reply before stale invocation.";
const userText = "stuck invocation recovery input";
const replyText = "Recovered stale invocation reply.";

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

describe("hosted local stuck invocation recovery e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 600_000);

  it("preempts an active idle-shutdown checkpoint when a real Linq webhook appends foreground input", async () => {
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
    requireScenario().queueAssistantResponses([
      firstReplyText,
    ]);
    const firstWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_stuck_invocation_setup_${runId}`,
        messageId: `msg_stuck_invocation_setup_${runId}`,
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
    const firstCompletionStatus = await waitForHostedInvocationIdleWithLogs();
    expectMailboxLagDrained(firstCompletionStatus);
    expectDeferredMailboxImportLog(firstCompletionStatus);

    const recoveryBaselineSendCount = requireLinqStub().countObservedSends(replyPath);
    const baselineProviderRequestCount = countAssistantProviderResponsesApiRequests();
    requireScenario().queueAssistantResponses([replyText]);

    const stuckInvocation = await requireScenario().harness.startStuckInvocationForTest(userId, {
      startedAgoMs: 35_000,
    });
    expect(stuckInvocation.ok).toBe(true);
    expect(stuckInvocation.attemptId).toMatch(/^runtime-write-/u);

    const recoveryWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_stuck_invocation_${runId}`,
        messageId: `msg_stuck_invocation_${runId}`,
        text: userText,
      }),
    );
    expect(recoveryWebhookResponse.status).toBe(202);
    await expect(recoveryWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const statusAfterNudge = await waitForHostedCompletionWithoutNudging(userId);
    if (
      statusAfterNudge.inFlight
      || statusAfterNudge.lastErrorCode
      || statusAfterNudge.mailboxLag.some((lane) => lane.lag !== "0")
    ) {
      throw new Error(await requireScenario().buildFailureMessage(userId, [
        "Hosted runner did not complete after foreground input preempted idle checkpoint.",
        `statusAfterNudge: ${JSON.stringify(statusAfterNudge)}`,
      ]));
    }

    const reply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: recoveryBaselineSendCount,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(reply)).toBe(replyText);

    const assistantProviderRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(baselineProviderRequestCount);
    expect(assistantProviderRequests).toHaveLength(1);
  }, 600_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "2000",
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
    persistDirPrefix: "murph-hosted-local-stuck-invocation-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted stuck invocation recovery e2e",
    streamLogs: streamDevLogs,
    testControls: true,
  });
}

async function waitForHostedCompletionWithoutNudging(
  userId: string,
): Promise<Awaited<ReturnType<HostedLocalFullStackScenario["harness"]["readUserStatus"]>>> {
  const startedAt = Date.now();
  let lastStatus: Awaited<ReturnType<HostedLocalFullStackScenario["harness"]["readUserStatus"]>> | null = null;

  while ((Date.now() - startedAt) < 30_000) {
    const status = await requireScenario().harness.readUserStatus(userId);
    lastStatus = status;
    if (
      !status.inFlight
      && !status.lastErrorCode
      && status.mailboxLag.every((lane) => lane.lag === "0")
    ) {
      return status;
    }
    await sleep(250);
  }

  if (!lastStatus) {
    throw new Error("Hosted runner status was unavailable after foreground nudge preemption.");
  }
  return lastStatus;
}

async function waitForHostedInvocationIdleWithLogs(): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < 120_000) {
    const status = await readHostedRunnerStatusWithLogLimit(50);
    lastStatus = status;

    if (status.lastErrorCode) {
      throw new Error(await requireScenario().buildFailureMessage(userId, [
        "Hosted runner reported terminal error while waiting for foreground invocation idle.",
        `last status: ${JSON.stringify(status)}`,
      ]));
    }

    if (!status.inFlight && status.workspace !== null) {
      return status;
    }

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for hosted foreground invocation idle.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
  ]));
}

function expectMailboxLagDrained(status: Pick<HostedRunnerStatusResponse, "mailboxLag">): void {
  expect(status.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
}

function expectDeferredMailboxImportLog(
  status: Pick<HostedRunnerStatusResponse, "recentLogs">,
): void {
  const logs = status.recentLogs ?? [];
  const log = [...logs].reverse().find((entry) =>
    entry.eventCode === "mailbox.imported"
    && entry.phase === "import"
    && entry.redactedJson?.checkpointDeferred === true
    && entry.redactedJson?.checkpointed === false
    && entry.redactedJson?.stateChanged === true
  );
  if (!log) {
    throw new Error([
      "Expected a foreground deferred mailbox import log.",
      `mailbox logs: ${JSON.stringify(summarizeMailboxImportLogs(logs))}`,
    ].join("\n"));
  }
}

async function readHostedRunnerStatusWithLogLimit(
  logLimit: number,
): Promise<HostedRunnerStatusResponse> {
  const status = parseHostedRunnerStatusResponse(
    await requireScenario().harness.requestJson(
      `/internal/users/${encodeURIComponent(userId)}/status?logLimit=${logLimit}`,
      {
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
        },
      },
    ),
  );
  if (status.userId !== userId) {
    throw new Error("Hosted runner status read returned a different user.");
  }
  return status;
}

function summarizeMailboxImportLogs(
  logs: readonly HostedRuntimeLogEntry[],
): Array<{
  checkpointDeferred: unknown;
  checkpointed: unknown;
  eventCode: HostedRuntimeLogEntry["eventCode"];
  phase: HostedRuntimeLogEntry["phase"];
  stateChanged: unknown;
}> {
  return logs
    .filter((entry) => entry.eventCode === "mailbox.imported")
    .map((entry) => ({
      checkpointDeferred: entry.redactedJson?.checkpointDeferred,
      checkpointed: entry.redactedJson?.checkpointed,
      eventCode: entry.eventCode,
      phase: entry.phase,
      stateChanged: entry.redactedJson?.stateChanged,
    }));
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_stuck_invocation`,
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

function countAssistantProviderResponsesApiRequests(): number {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.url === "/v1/responses"
  ).length;
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local stuck invocation recovery scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local stuck invocation recovery Linq stub was not started.");
  }
  return linqStub;
}
