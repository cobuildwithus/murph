import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  buildAssistantProviderMurphToolCall,
  expectAdvertisedMurphDynamicTools,
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
  type ObservedLinqRequest,
} from "./helpers/hosted-local-linq-support.js";

const userId = `member_local_codex_media_${Date.now()}`;
const linqApiToken = "linq-local-test-token";
const linqWebhookSecret = "linq-local-webhook-secret";
const assistantReplyText = "Here is the setup image.";
const assistantMediaUrl = "https://assets.example.test/assistant-media/dead-bug-setup.png";
const productionLikeAssistantModel = "gpt-5.5";
const localRunnerIdleTtlMs = "300000";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

function buildHostedAssistantMediaToolResponses(input: {
  mediaUrl: string;
  text: string;
}): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderMurphToolCall("attach_response_media", {
      media: [
        {
          kind: "image",
          url: input.mediaUrl,
          alt: "Exercise setup reference",
          source: "hosted-local-codex-image-media",
        },
      ],
    }),
    input.text,
  ];
}

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local Codex image media delivery e2e", () => {
  beforeAll(async () => {
    await ensureScenario();
  }, 300_000);

  it("lets Codex attach image media that is sent with the final Linq reply", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone: buildLinqRecipientPhoneNumber(userId),
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    await requireScenario().waitForHostedCompletion(userId);

    const materializedChatId = `chat_local_codex_media_${userId}`;
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: materializedChatId,
      memberId: userId,
      recipientPhone: buildLinqRecipientPhoneNumber(userId),
    });

    const expectedDirectReplyChatPath =
      `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply =
      requireLinqStub().countObservedSends(expectedDirectReplyChatPath);
    requireScenario().queueAssistantResponses(
      buildHostedAssistantMediaToolResponses({
        mediaUrl: assistantMediaUrl,
        text: assistantReplyText,
      }),
    );

    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      materializedChatId,
      {
        eventId: `evt_codex_media_${userId}`,
        messageId: `msg_codex_media_${userId}`,
        text: "Can you send me the setup image?",
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    const completionPromise = requireScenario().waitForHostedCompletion(userId);
    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedDirectReplyChatPath,
      scenario: requireScenario(),
      userId,
    });
    expect(replySend.authorizationStatus).toBe("hosted-sentinel");
    expect(readObservedLinqMessageParts(replySend)).toEqual([
      {
        type: "text",
        value: assistantReplyText,
      },
      {
        type: "media",
        url: assistantMediaUrl,
      },
    ]);

    const finalStatus = await completionPromise;
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expectAdvertisedMurphDynamicTools(requireScenario().assistantProviderRequests, {
      computerToolsAvailable: true,
      connectedAppsAvailable: true,
      phoneCallsAvailable: false,
      progressUpdatesAvailable: false,
      vaultFileSendAvailable: true,
    });
  }, 300_000);
});

async function ensureScenario(): Promise<void> {
  if (scenario) {
    return;
  }

  linqStub = await startHostedLocalLinqStub({
    expectedAuthorizationToken: linqApiToken,
  });
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: localRunnerIdleTtlMs,
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: linqApiToken,
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-codex-media-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Codex image media e2e",
    streamLogs: streamDevLogs,
  });
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_linq_codex_media`,
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

function readObservedLinqMessageParts(request: ObservedLinqRequest): unknown[] {
  const parsed = JSON.parse(request.body) as {
    message?: {
      parts?: unknown;
    };
  };
  return Array.isArray(parsed.message?.parts) ? parsed.message.parts : [];
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not initialized.");
  }

  return linqStub;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full stack scenario was not initialized.");
  }

  return scenario;
}
