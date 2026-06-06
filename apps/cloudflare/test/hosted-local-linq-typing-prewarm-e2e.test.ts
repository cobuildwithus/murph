import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  type HostedRuntimeWorkflowState,
} from "@murphai/hosted-execution/orchestration-control";
import {
  type HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  hostedUserRuntimeWorkflowId,
} from "@murphai/hosted-orchestrator-temporal/client";
import {
  createHostedRuntimeTemporalClientFromEnv,
} from "@murphai/hosted-orchestrator-temporal/client/temporal-client";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
  type ObservedLinqRequest,
} from "./helpers/hosted-local-linq-support.js";

const linqWebhookSecret = "linq-local-typing-prewarm-secret";
const runId = Date.now();
const prewarmUserId = `member_local_linq_typing_prewarm_${runId}`;
const prewarmChatId = `chat_local_linq_typing_prewarm_${runId}`;
const prewarmReplyText = "Typing prewarm did not block this iMessage reply.";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local Linq typing prewarm e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub();
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          buildLinqRecipientPhoneNumber(prewarmUserId),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: "linq-local-test-token",
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-linq-typing-prewarm-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted Linq typing prewarm e2e",
      streamLogs: streamDevLogs,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 120_000);

  it("prewarms from typing and still lets the later iMessage mailbox turn run immediately", async () => {
    const activeScenario = requireScenario();
    const activeLinqStub = requireLinqStub();
    const memberPhone = buildLinqRecipientPhoneNumber(prewarmUserId);

    await activeScenario.seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(prewarmUserId),
      memberId: prewarmUserId,
      memberPhone,
    });
    await activeScenario.runWake(buildActivationWake(prewarmUserId), prewarmUserId);
    await activeScenario.waitForHostedCompletion(prewarmUserId);
    await activeScenario.bindActiveHostedLinqHomeChat({
      chatId: prewarmChatId,
      memberId: prewarmUserId,
      recipientPhone: memberPhone,
    });

    const workflowId = hostedUserRuntimeWorkflowId(prewarmUserId);
    const statusBeforeTyping = await activeScenario.harness.readUserStatus(prewarmUserId);
    expectIdleStatusWithoutMailboxLag(statusBeforeTyping);
    const workspaceVersionBeforeTyping = statusBeforeTyping.workspace?.version ?? null;
    const lastInvocationAtBeforeTyping = statusBeforeTyping.lastInvocationAt ?? null;
    const outboundRequestCountBeforeTyping = activeLinqStub.observedRequests.length;
    const providerRequestCountBeforeTyping = activeScenario.assistantProviderRequests.length;

    const typingResponse = await postSignedLinqWebhook(buildTypingStartedEvent({
      chatId: prewarmChatId,
      eventId: `evt_linq_typing_prewarm_${prewarmUserId}`,
    }));
    const typingResponseJson = await expectLinqWebhookJsonResponse(typingResponse, 202);
    expect(typingResponseJson).toMatchObject({
      ok: true,
      reason: "typing-prewarm-signaled",
    });
    expect(activeLinqStub.observedRequests).toHaveLength(outboundRequestCountBeforeTyping);
    expect(activeScenario.assistantProviderRequests).toHaveLength(
      providerRequestCountBeforeTyping,
    );

    const prewarmState = await waitForWorkflowExecutionState({
      description: "typing prewarm signal",
      env: activeScenario.runtimeEnv,
      predicate: (state) =>
        state.prewarmSignalCount === 1
        && state.latestPrewarmRequestedAt !== null
        && state.lastPrewarmAttemptId !== null
        && state.lastPrewarmResult === "accepted"
        && state.lastPrewarmErrorCode === null
        && !state.prewarmRequested,
      workflowId,
    });
    expect(prewarmState.userId).toBe(prewarmUserId);
    expect(prewarmState.prewarmSignalCount).toBe(1);
    expect(prewarmState.latestPrewarmRequestedAt).not.toBeNull();
    expect(prewarmState.mailboxSignalCount).toBe(0);
    expect(prewarmState.latestMailboxPointer).toBeNull();
    expect(prewarmState.manualRunRequested).toBe(false);
    expect(prewarmState.browserVaultRefreshRequested).toBe(false);
    expect(prewarmState).not.toHaveProperty("deviceSyncRecoveryRequested");
    expect(prewarmState.lagRecoveryObserved).toBe(false);
    expect(prewarmState.lastDemandKind).toBe("idle");
    expect(prewarmState.lastDemandSource).toBeNull();
    expect(prewarmState.lastExecutionAt).toBeNull();
    expect(prewarmState.lastOrchestrationAttemptId).toBeNull();
    expect(prewarmState.lastRuntimeAttemptId).toBeNull();
    expect(activeLinqStub.observedRequests).toHaveLength(outboundRequestCountBeforeTyping);
    expect(activeScenario.assistantProviderRequests).toHaveLength(
      providerRequestCountBeforeTyping,
    );
    const statusAfterTyping = await activeScenario.harness.readUserStatus(prewarmUserId);
    expectIdleStatusWithoutMailboxLag(statusAfterTyping);
    expect(statusAfterTyping.workspace?.version ?? null).toBe(workspaceVersionBeforeTyping);
    expect(statusAfterTyping.lastInvocationAt ?? null).toBe(lastInvocationAtBeforeTyping);

    activeScenario.queueAssistantResponses([prewarmReplyText]);
    const replyChatPath = `/chats/${encodeURIComponent(prewarmChatId)}/messages`;
    const outboundCountBeforeReply = activeLinqStub.countObservedSends(replyChatPath);
    const providerRequestCountBeforeReply = activeScenario.assistantProviderRequests.length;
    const messageResponse = await postSignedLinqWebhook(buildMessageReceivedEvent({
      chatId: prewarmChatId,
      eventId: `evt_linq_typing_prewarm_message_${prewarmUserId}`,
      messageId: `msg_linq_typing_prewarm_${prewarmUserId}`,
      text: "Reply to this after the typing prewarm.",
      userId: prewarmUserId,
    }));

    const messageResponseJson = await expectLinqWebhookJsonResponse(messageResponse, 202);
    expect(messageResponseJson).toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(activeLinqStub.countObservedSends(replyChatPath)).toBe(outboundCountBeforeReply);

    const mailboxState = await waitForWorkflowExecutionStateBeforeLinqSend({
      baselineSendCount: outboundCountBeforeReply,
      description: "mailbox processing after typing prewarm",
      env: activeScenario.runtimeEnv,
      expectedSendPath: replyChatPath,
      predicate: (state) =>
        state.prewarmSignalCount === prewarmState.prewarmSignalCount
        && state.lastDemandSource === "mailbox_backlog"
        && state.lastExecutionAt !== null
        && state.lastExecutionAt !== prewarmState.lastExecutionAt
        && state.lastOrchestrationAttemptId !== null
        && state.lastOrchestrationAttemptId !== prewarmState.lastOrchestrationAttemptId
        && state.lastExecutionErrorCode === null
        && state.lastExecutionKind === "runtime_processing_accepted",
      workflowId,
    });
    expect(mailboxState.prewarmRequested).toBe(false);
    expect(mailboxState.lastExecutionKind).toBe("runtime_processing_accepted");

    const replySend = await waitForAdditionalObservedLinqSendWithoutNudge({
      baselineCount: outboundCountBeforeReply,
      expectedPath: replyChatPath,
      userId: prewarmUserId,
    });
    expect(activeLinqStub.readObservedMessageText(replySend)).toBe(prewarmReplyText);
    expect(activeLinqStub.countObservedSends(replyChatPath)).toBe(
      outboundCountBeforeReply + 1,
    );

    const finalStatus = await activeScenario.waitForHostedIdle(prewarmUserId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(finalStatus.inFlight).toBe(false);
    expect(finalStatus.workspace).not.toBeNull();

    const providerRequests = activeScenario.assistantProviderRequests.slice(
      providerRequestCountBeforeReply,
    );
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0]?.body).toContain("Reply to this after the typing prewarm.");
  }, 900_000);
});

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

async function expectLinqWebhookJsonResponse(
  response: Response,
  expectedStatus: number,
): Promise<Record<string, unknown>> {
  const body = await response.text();
  const parsed = parseWebhookJsonBody(body);
  if (response.status !== expectedStatus || parsed === null) {
    throw new Error([
      `Expected Linq webhook JSON response with status ${expectedStatus}.`,
      `observed status: ${response.status}`,
      `json object body: ${parsed !== null}`,
      ...summarizeWebhookJsonBody(parsed),
    ].join("\n"));
  }

  return parsed;
}

function parseWebhookJsonBody(body: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

function summarizeWebhookJsonBody(parsed: Record<string, unknown> | null): string[] {
  if (!parsed) {
    return [];
  }

  return [
    summarizeWebhookJsonField(parsed, "ok"),
    summarizeWebhookJsonField(parsed, "reason"),
    summarizeWebhookJsonField(parsed, "errorCode"),
  ].filter((line): line is string => line !== null);
}

function summarizeWebhookJsonField(
  parsed: Record<string, unknown>,
  field: string,
): string | null {
  const value = parsed[field];
  if (typeof value === "boolean") {
    return `${field}: ${String(value)}`;
  }
  if (typeof value === "string") {
    return `${field}: ${value.slice(0, 80)}`;
  }

  return null;
}

function buildTypingStartedEvent(input: {
  chatId: string;
  eventId: string;
}): Record<string, unknown> {
  return {
    api_version: "v3",
    created_at: new Date().toISOString(),
    data: {
      chat: {
        id: input.chatId,
        owner_handle: {
          handle: buildLinqHomePhoneNumber(prewarmUserId),
          id: `handle_owner_${prewarmUserId}`,
          is_me: true,
          service: "iMessage",
        },
      },
      chat_id: input.chatId,
      service: "iMessage",
    },
    event_id: input.eventId,
    event_type: "chat.typing_indicator.started",
    webhook_version: "2026-02-03",
  };
}

function buildMessageReceivedEvent(input: {
  chatId: string;
  eventId: string;
  messageId: string;
  text: string;
  userId: string;
}): Record<string, unknown> {
  const homePhone = buildLinqHomePhoneNumber(input.userId);
  const memberPhone = buildLinqRecipientPhoneNumber(input.userId);

  return {
    api_version: "v3",
    created_at: new Date().toISOString(),
    data: {
      chat: {
        id: input.chatId,
        is_group: false,
        owner_handle: {
          handle: homePhone,
          id: `handle_owner_${input.userId}`,
          is_me: true,
          service: "iMessage",
        },
      },
      chat_id: input.chatId,
      direction: "inbound",
      from: memberPhone,
      from_handle: {
        handle: memberPhone,
        id: `handle_sender_${input.userId}`,
        service: "iMessage",
      },
      is_from_me: false,
      message: {
        id: input.messageId,
        parts: [
          {
            type: "text",
            value: input.text,
          },
        ],
      },
      recipient_handle: {
        handle: homePhone,
        id: `handle_owner_${input.userId}`,
        is_me: true,
        service: "iMessage",
      },
      recipient_phone: homePhone,
      received_at: new Date().toISOString(),
      sender_handle: {
        handle: memberPhone,
        id: `handle_sender_${input.userId}`,
        service: "iMessage",
      },
      sent_at: new Date().toISOString(),
      service: "iMessage",
    },
    event_id: input.eventId,
    event_type: "message.received",
    webhook_version: "2026-02-03",
  };
}

async function waitForWorkflowExecutionState(input: {
  description: string;
  env: NodeJS.ProcessEnv;
  predicate(state: HostedRuntimeWorkflowState): boolean;
  workflowId: string;
}): Promise<HostedRuntimeWorkflowState> {
  const client = await createHostedRuntimeTemporalClientFromEnv(input.env);
  const handle = client.workflow.getHandle(input.workflowId);
  const deadline = Date.now() + 180_000;
  let latestState: HostedRuntimeWorkflowState | null = null;
  let latestError: string | null = null;

  try {
    while (Date.now() < deadline) {
      try {
        latestState = await handle.query<HostedRuntimeWorkflowState>(
          HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
        );
      } catch (error) {
        latestError = error instanceof Error ? error.message : String(error);
        await sleep(1_000);
        continue;
      }

      if (input.predicate(latestState)) {
        return latestState;
      }

      await sleep(1_000);
    }
  } finally {
    await client.connection.close();
  }

  throw new Error(
    [
      `Timed out waiting for Temporal workflow state: ${input.description}.`,
      latestState ? `last state: ${JSON.stringify(latestState)}` : null,
      latestError ? `last query error: ${latestError}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
  );
}

async function waitForWorkflowExecutionStateBeforeLinqSend(input: {
  baselineSendCount: number;
  description: string;
  env: NodeJS.ProcessEnv;
  expectedSendPath: string;
  predicate(state: HostedRuntimeWorkflowState): boolean;
  workflowId: string;
}): Promise<HostedRuntimeWorkflowState> {
  return await waitForWorkflowExecutionState({
    description: input.description,
    env: input.env,
    predicate: (state) => {
      if (input.predicate(state)) {
        return true;
      }

      const sendCount = requireLinqStub().countObservedSends(input.expectedSendPath);
      if (sendCount > input.baselineSendCount) {
        throw new Error([
          "Observed Linq reply before Temporal accepted mailbox execution.",
          `expected path: ${input.expectedSendPath}`,
          `baseline count: ${input.baselineSendCount}`,
          `observed count: ${sendCount}`,
          `last demand source: ${state.lastDemandSource ?? "null"}`,
          `last execution kind: ${state.lastExecutionKind ?? "null"}`,
        ].join("\n"));
      }

      return false;
    },
    workflowId: input.workflowId,
  });
}

async function waitForAdditionalObservedLinqSendWithoutNudge(input: {
  baselineCount: number;
  expectedPath: string;
  timeoutMs?: number;
  userId: string;
}): Promise<ObservedLinqRequest> {
  const timeoutMs = input.timeoutMs ?? 120_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const matchingSends = requireLinqStub().observedRequests.filter((request) =>
      request.method === "POST" && request.url === input.expectedPath
    );
    if (matchingSends.length > input.baselineCount) {
      return matchingSends.at(-1)!;
    }

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for a Linq send without runner nudges.",
    `expected path: ${input.expectedPath}`,
    `baseline count: ${input.baselineCount}`,
    `observed requests: ${JSON.stringify(summarizeObservedLinqRequestsForFailure())}`,
  ]));
}

function summarizeObservedLinqRequestsForFailure(): Array<{ method: string; url: string }> {
  return requireLinqStub().observedRequests.slice(-20).map((request) => ({
    method: request.method,
    url: request.url,
  }));
}

function expectIdleStatusWithoutMailboxLag(status: HostedRunnerStatusResponse): void {
  expect(status.userId).toBe(prewarmUserId);
  expect(status.lastErrorCode ?? null).toBeNull();
  expect(status.inFlight).toBe(false);
  expect(status.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_linq_typing_prewarm`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
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
