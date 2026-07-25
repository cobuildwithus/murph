import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  listHostedAiUsageForTest,
} from "#hosted-web-testing";
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
const generatedImageReplyText = "Here is the generated setup image.";
const productionLikeAssistantModel = "gpt-5.6-terra";
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
      { matchInputContains: "Can you send me the setup image?" },
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
      messageTargetingAvailable: true,
      phoneCallsAvailable: true,
      progressUpdatesAvailable: true,
      vaultFileSendAvailable: true,
    });
  }, 300_000);

  it("generates a private image, delivers it as a Linq attachment, and reuses its vault capture", async () => {
    const materializedChatId = `chat_local_codex_media_${userId}`;
    const replyPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeGeneration = requireLinqStub().countObservedSends(replyPath);
    const attachmentCountBeforeGeneration = requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: "/attachments",
    });
    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("generate_image", {
        alt: "Generated mobility setup",
        prompt: "Render a simple synthetic mobility setup diagram.",
      }),
      generatedImageReplyText,
    ], {
      matchInputContains: "Generate a fresh mobility setup image",
    });

    const generationResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      materializedChatId,
      {
        eventId: `evt_codex_generated_media_${userId}`,
        messageId: `msg_codex_generated_media_${userId}`,
        text: "Generate a fresh mobility setup image and save it for later reuse.",
      },
    ));
    expect(generationResponse.status).toBe(202);
    await requireScenario().waitForLatestPendingWake(userId);
    const generationSend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeGeneration,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(readObservedLinqMessageParts(generationSend)).toEqual([
      {
        type: "text",
        value: generatedImageReplyText,
      },
      expect.objectContaining({
        attachment_id: expect.stringMatching(/^attachment_local_/u),
        type: "media",
      }),
    ]);
    expect(requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: "/attachments",
    })).toBe(attachmentCountBeforeGeneration + 1);
    await requireScenario().waitForHostedCompletion(userId);

    const savedImageRef = readLatestSavedGeneratedImageRef();
    expect(savedImageRef).toMatch(/^raw\/captures\/.+\.webp$/u);
    const usage = await listHostedAiUsageForTest({
      environment: requireScenario().runtimeEnv,
      memberId: userId,
    });
    expectPriceableImageUsage(usage, 1);

    const reuseReplyText = "I reused the saved setup image as the edit reference.";
    const outboundCountBeforeReuse = requireLinqStub().countObservedSends(replyPath);
    const attachmentCountBeforeReuse = requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: "/attachments",
    });
    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("generate_image", {
        alt: "Reused mobility setup",
        prompt: "Create a synthetic variation that preserves the reference layout.",
        referenceImageRefs: [savedImageRef],
      }),
      reuseReplyText,
    ], {
      matchInputContains: savedImageRef,
    });

    const reuseResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      materializedChatId,
      {
        eventId: `evt_codex_generated_media_reuse_${userId}`,
        messageId: `msg_codex_generated_media_reuse_${userId}`,
        text: `Reuse the saved image ${savedImageRef} as a reference for one variation.`,
      },
    ));
    expect(reuseResponse.status).toBe(202);
    await requireScenario().waitForLatestPendingWake(userId);
    const reuseSend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReuse,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(readObservedLinqMessageParts(reuseSend)).toEqual([
      {
        type: "text",
        value: reuseReplyText,
      },
      expect.objectContaining({
        attachment_id: expect.stringMatching(/^attachment_local_/u),
        type: "media",
      }),
    ]);
    expect(requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: "/attachments",
    })).toBe(attachmentCountBeforeReuse + 1);
    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expectPriceableImageUsage(
      await listHostedAiUsageForTest({
        environment: requireScenario().runtimeEnv,
        memberId: userId,
      }),
      2,
    );
  }, 360_000);

});

function expectPriceableImageUsage(
  usage: Awaited<ReturnType<typeof listHostedAiUsageForTest>>,
  expectedCount: number,
): void {
  const imageUsage = usage.filter((row) => row.providerName === "OpenAI Images");
  expect(imageUsage).toHaveLength(expectedCount);
  expect(imageUsage).toEqual(
    Array.from({ length: expectedCount }, () =>
      expect.objectContaining({
        allowanceCostUsdMicros: "1080",
        allowanceCounted: true,
        allowancePricingSnapshotJson: expect.objectContaining({
          schema: "murph.hosted-ai-usage-allowance-pricing.v1",
          tokens: expect.objectContaining({
            openAiImage: expect.objectContaining({
              billableImageInput: "0",
              billableTextInput: "12",
              imageInput: "0",
              output: "34",
              textInput: "12",
            }),
          }),
        }),
        allowancePricingVersion: "openai-image-api-pricing-2026-07-08-standard",
        requestedModel: "gpt-image-2",
        totalTokens: 46,
      }),
    ),
  );
}

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
    testControls: true,
  });
}

function readLatestSavedGeneratedImageRef(): string {
  const requests = requireScenario().assistantProviderRequests
    .filter((request) => request.url === "/v1/responses")
    .map((request) => request.body);
  for (const body of [...requests].reverse()) {
    const match = body.match(/raw\/captures\/[A-Za-z0-9_./-]+\.webp/u);
    if (match?.[0]) {
      return match[0];
    }
  }
  const knownOutcome = [
    "saved generated image lookup could not be loaded",
    "image generation failed",
    "image generation returned invalid image data",
    "image generated but vault save failed",
  ].find((outcome) => requests.some((body) => body.includes(outcome))) ?? "unclassified";
  throw new Error(
    `Expected the generated-image tool output to expose a saved vault ref; outcome: ${knownOutcome}.`,
  );
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
