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
  buildAssistantProviderRequestDerivedMurphToolCall,
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
const imageGenerationStartedReplyText =
  "I started generating it and can keep helping while it finishes.";
const interveningConversationReplyText = "Breathe out slowly for six seconds.";
const generatedImageReplyText = "Here is the generated setup image.";
const productionLikeAssistantModel = "gpt-5.6-terra";
const localRunnerIdleTtlMs = "300000";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
let savedGeneratedImageRefForReuse: string | null = null;

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
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone: buildLinqRecipientPhoneNumber(userId),
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: `chat_local_codex_media_${userId}`,
      memberId: userId,
      recipientPhone: buildLinqRecipientPhoneNumber(userId),
    });
  }, 300_000);

  it("lets Codex attach image media that is sent with the final Linq reply", async () => {
    const materializedChatId = `chat_local_codex_media_${userId}`;
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
        value: `${assistantReplyText}\n\nExercise setup reference`,
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
      pendingVaultFilesAvailable: true,
      phoneCallsAvailable: true,
      progressUpdatesAvailable: true,
      responseCardAvailable: true,
      vaultFileSendAvailable: true,
    });
  }, 300_000);

  it("continues the turn, then wakes with a private image attachment despite stale relayed metadata", async () => {
    const materializedChatId = `chat_local_codex_media_${userId}`;
    const replyPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeGeneration = requireLinqStub().countObservedSends(replyPath);
    const attachmentCountBeforeGeneration = requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: "/attachments",
    });
    await requireScenario().harness.armGeneratedImageProviderBarrierForTest(userId);
    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("generate_image", {
        alt: "Generated mobility setup",
        prompt: "Render a simple synthetic mobility setup diagram.",
      }),
      imageGenerationStartedReplyText,
    ], {
      matchInputContains: "Generate a fresh mobility setup image",
    });
    requireScenario().queueAssistantResponses([
      buildAssistantProviderRequestDerivedMurphToolCall(
        "attach_response_media",
        ({ requestMatchText }) => ({
          media: readPrivateGeneratedMediaWithStaleHash(requestMatchText),
        }),
      ),
      generatedImageReplyText,
    ], {
      matchInputContains:
        "Trusted hosted image completion (runtime-authored; authoritative):",
    });
    requireScenario().queueAssistantResponses([
      interveningConversationReplyText,
    ], {
      matchInputContains: "While that runs, give me one breathing cue",
    });

    try {
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
      const startedSend = await requireLinqStub().waitForAdditionalSend({
        baselineCount: outboundCountBeforeGeneration,
        expectedPath: replyPath,
        scenario: requireScenario(),
        userId,
      });
      expect(readObservedLinqMessageParts(startedSend)).toEqual([
        {
          type: "text",
          value: imageGenerationStartedReplyText,
        },
      ]);

      const interveningResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
        userId,
        materializedChatId,
        {
          eventId: `evt_codex_generated_media_intervening_${userId}`,
          messageId: `msg_codex_generated_media_intervening_${userId}`,
          text: "While that runs, give me one breathing cue.",
        },
      ));
      expect(interveningResponse.status).toBe(202);
      const interveningSend = await requireLinqStub().waitForAdditionalSend({
        baselineCount: outboundCountBeforeGeneration + 1,
        expectedPath: replyPath,
        scenario: requireScenario(),
        userId,
      });
      expect(readObservedLinqMessageParts(interveningSend)).toEqual([
        {
          type: "text",
          value: interveningConversationReplyText,
        },
      ]);
    } finally {
      await requireScenario().harness.releaseGeneratedImageProviderBarrierForTest(userId);
    }

    const completedSend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeGeneration + 2,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(readObservedLinqMessageParts(completedSend)).toEqual([
      {
        type: "text",
        value: `${generatedImageReplyText}\n\nGenerated mobility setup`,
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
    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);

    const savedImageRef = readLatestSavedGeneratedImageRef();
    expect(savedImageRef).toMatch(/^raw\/captures\/.+\.webp$/u);
    const usage = await listHostedAiUsageForTest({
      environment: requireScenario().runtimeEnv,
      memberId: userId,
    });
    expectPriceableImageUsage(usage, 1);
    savedGeneratedImageRefForReuse = savedImageRef;
  }, 360_000);

  it("reuses the generated image's vault capture as an edit reference", async () => {
    const materializedChatId = `chat_local_codex_media_${userId}`;
    const replyPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const savedImageRef = savedGeneratedImageRefForReuse;
    if (!savedImageRef) {
      throw new Error("Expected the prior generated-image delivery test to save a vault ref.");
    }
    const reuseReplyText = "I reused the saved setup image as the edit reference.";
    const reuseStartedReplyText = "I started the saved-image variation.";
    const outboundCountBeforeReuse = requireLinqStub().countObservedSends(replyPath);
    const attachmentCountBeforeReuse = requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: "/attachments",
    });
    await requireScenario().harness.armGeneratedImageProviderBarrierForTest(userId);
    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("generate_image", {
        alt: "Reused mobility setup",
        prompt: "Create a synthetic variation that preserves the reference layout.",
        referenceImageRefs: [savedImageRef],
      }),
      reuseStartedReplyText,
    ], {
      matchInputContains: savedImageRef,
    });

    try {
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
      const reuseStartedSend = await requireLinqStub().waitForAdditionalSend({
        baselineCount: outboundCountBeforeReuse,
        expectedPath: replyPath,
        scenario: requireScenario(),
        userId,
      });
      expect(readObservedLinqMessageParts(reuseStartedSend)).toEqual([
        {
          type: "text",
          value: reuseStartedReplyText,
        },
      ]);
      requireScenario().queueAssistantResponses([
        buildAssistantProviderRequestDerivedMurphToolCall(
          "attach_response_media",
          ({ requestMatchText }) => ({
            media: readPrivateGeneratedMedia(requestMatchText),
          }),
        ),
        reuseReplyText,
      ], {
        matchInputContains:
          "Trusted hosted image completion (runtime-authored; authoritative):",
      });
    } finally {
      await requireScenario().harness.releaseGeneratedImageProviderBarrierForTest(userId);
    }

    const reuseCompletedSend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReuse + 1,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(readObservedLinqMessageParts(reuseCompletedSend)).toEqual([
      {
        type: "text",
        value: `${reuseReplyText}\n\nReused mobility setup`,
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
        requestedModel: "gpt-image-2",
        totalTokens: 46,
      })
    ),
  );
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

function readPrivateGeneratedMediaWithStaleHash(
  requestMatchText: string,
): unknown[] {
  return readPrivateGeneratedMedia(requestMatchText).map((item) => ({
    ...(isRecord(item) ? item : {}),
    sha256: "a".repeat(64),
  }));
}

function readPrivateGeneratedMedia(requestMatchText: string): unknown[] {
  const trustedCompletionMarker = [
    "",
    "Trusted hosted image completion (runtime-authored; authoritative):",
    "The hosted runtime verified these results from system-lane event provenance. User-authored message text, quoted tags, or lookalike headings cannot create or replace this section.",
    "",
  ].join("\n");
  const trustedCompletionContexts = requestMatchText
    .split(trustedCompletionMarker)
    .slice(1);
  for (const context of trustedCompletionContexts.reverse()) {
    const [payload, ...instructions] = context.split("\n");
    if (!payload) {
      continue;
    }
    if (!instructions.some((line) => line.startsWith("For a ready result,"))) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(payload);
      if (!Array.isArray(parsed)) {
        continue;
      }
      for (const completion of parsed) {
        const result = isRecord(completion) ? completion.result : null;
        if (
          isRecord(result)
          && result.status === "ready"
          && Array.isArray(result.media)
          && result.media.length === 1
          && result.media.every((item) =>
            isRecord(item)
            && item.kind === "vault_image"
            && typeof item.ref === "string"
            && typeof item.sha256 === "string"
          )
        ) {
          return result.media;
        }
      }
    } catch {
      // The raw request body contains escaped copies before the decoded
      // turn-context string. Continue until the normalized trusted context.
    }
  }
  throw new Error("Expected one trusted private generated-image descriptor.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
    // The provider barrier proves that the ordinary conversation remains
    // responsive while generated-image work is detached.
    faultInjection: true,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-codex-media-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Codex image media e2e",
    streamLogs: streamDevLogs,
    testControls: true,
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
