import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
  buildAssistantProviderVaultCliCall,
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
const userId = `member_local_canonical_lost_ack_${runId}`;
const chatId = `chat_local_canonical_lost_ack_${runId}`;
const automationSlug = `canonical-receipt-probe-${runId}`;
const inboundText = "Save a durable canonical receipt recovery probe.";
const replyText = "The durable recovery probe is saved.";
const linqApiToken = "linq-local-test-token";
const linqWebhookSecret = "linq-local-canonical-lost-ack-secret";
const assistantModel = "gpt-5.5";
const lostAckLogMessage =
  "Hosted-local test dropped a canonical checkpoint acknowledgement after the real checkpoint committed.";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local canonical receipt lost-ack recovery e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "10000",
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          buildLinqRecipientPhoneNumber(userId),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      assistantProviderStubModelId: assistantModel,
      faultInjection: true,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-canonical-lost-ack-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted canonical receipt lost-ack recovery e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });
  }, 300_000);

  it("reconciles the exact canonical checkpoint successor after its committed response is lost", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    const activationStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(activationStatus.workspace).not.toBeNull();
    const activationWorkspaceVersion = BigInt(activationStatus.workspace!.version);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const outboundBaseline = requireLinqStub().countObservedSends(replyPath);
    const providerBaseline = countResponsesApiRequests();
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    requireScenario().queueAssistantResponses([
      buildAssistantProviderVaultCliCall([
        "automation",
        "save",
        "Canonical receipt recovery probe",
        "--request-id",
        `canonical-receipt-probe-${userId}`,
        "--slug",
        automationSlug,
        "--instructions",
        "Record the hosted canonical checkpoint recovery probe.",
        "--summary",
        "Hosted canonical checkpoint recovery probe.",
        "--tags",
        "assistant",
        "--continuity-policy",
        "fresh",
        "--channel",
        "linq",
        "--delivery-target",
        chatId,
        "--schedule-kind",
        "at",
        "--schedule-at",
        dueAt,
      ]),
      replyText,
    ], {
      matchInputContains: inboundText,
    });

    await requireScenario().harness.armCanonicalCheckpointLostAckForTest(userId);
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_canonical_lost_ack_${runId}`,
        messageId: `msg_canonical_lost_ack_${runId}`,
        text: inboundText,
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    const reply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(reply)).toBe(replyText);

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(finalStatus.workspace).not.toBeNull();
    expect(BigInt(finalStatus.workspace!.version)).toBeGreaterThan(activationWorkspaceVersion);

    const providerRequestText = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(providerBaseline)
      .map(readAssistantProviderRequestText)
      .join("\n\n");
    expect(providerRequestText).toContain(automationSlug);
    expect(providerRequestText).toMatch(/"created"\s*:\s*true/u);

    const faultLogs = [
      requireScenario().harness.stdoutTail(2_000_000),
      requireScenario().harness.stderrTail(2_000_000),
    ].join("\n");
    expect(countOccurrences(faultLogs, lostAckLogMessage)).toBe(1);
  }, 420_000);
});

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return await fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body: rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": `sha256=${signature}`,
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
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

function countResponsesApiRequests(): number {
  return requireScenario().assistantProviderRequests
    .filter((request) => request.url === "/v1/responses").length;
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_canonical_lost_ack`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local canonical lost-ack scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local canonical lost-ack Linq stub was not started.");
  }
  return linqStub;
}
