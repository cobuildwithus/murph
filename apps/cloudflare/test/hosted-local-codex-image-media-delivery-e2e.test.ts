import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  listHostedAiUsageForTest,
  readHostedGroupUsageStatusForTest,
  seedHostedAiUsageLimitPeriodForTest,
} from "#hosted-web-testing";
import {
  buildAssistantProviderMurphToolCall,
  buildAssistantProviderShellCommandCall,
  buildAssistantProviderVaultCliCall,
  expectAdvertisedMurphDynamicTools,
  scopeHostedLocalAssistantProviderResponse,
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
const homePhone = buildLinqHomePhoneNumber(userId);
const memberPhone = buildLinqRecipientPhoneNumber(userId);
const assistantReplyText = "Here is the setup image.";
const assistantMediaUrl = "https://assets.example.test/assistant-media/dead-bug-setup.png";
const generatedImageAdmissionReplyText =
  "I'm checking whether that image can start.";
const generatedImageReplyText = "Here is the generated setup image.";
const generatedImageUploadFailureReplyText =
  "I couldn't make that image available to send, so I can only send text right now.";
const generatedImageUrl = "https://imagedelivery.net/hosted-local/generated-image/public";
const groupImageChatId = `chat_local_codex_image_group_${userId}`;
const groupImageWarmupText = "Warm up the image allowance test group.";
const groupImageWarmupReplyText = "The group image test is ready.";
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
    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    await requireScenario().waitForHostedCompletion(userId);
  }, 300_000);

  it("lets Codex attach image media that is sent with the final Linq reply", async () => {
    const materializedChatId = `chat_local_codex_media_${userId}`;
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: materializedChatId,
      memberId: userId,
      recipientPhone: homePhone,
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

  it("generates a hosted image, saves its canonical capture, and reuses it on a later turn", async () => {
    const materializedChatId = `chat_local_codex_media_generation_${userId}`;
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: materializedChatId,
      memberId: userId,
      recipientPhone: homePhone,
    });
    const replyPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const acceptedCountBeforeGeneration = requireLinqStub().countAcceptedSends(replyPath);
    const providerRequestCountBeforeGeneration =
      readAssistantProviderResponsesRequestBodies().length;
    const generationOriginMatcher = "Generate a fresh mobility setup image";
    const newerInboundText =
      "While that image is rendering, tell me whether the next mobility block is timed.";
    const newerInboundReplyText =
      "Yes—the next mobility block is timed.";
    queueHostedImageGenerationTurnPair({
      completionMatchers: [generatedImageUrl, '"status":"ready"'],
      completionResponses: [
        buildAssistantProviderVaultCliCall([
          "capture",
          "list",
          "--tag",
          "assistant-generated-image",
          "--limit",
          "1",
          "--format",
          "json",
        ]),
        buildAssistantProviderMurphToolCall("attach_response_media", {
          media: [{
            alt: "Generated mobility setup",
            kind: "image",
            source: "gpt-image-2",
            url: generatedImageUrl,
          }],
        }),
        scopeHostedLocalAssistantProviderResponse(generatedImageReplyText, {
          matchInputContains: "1 response image attached",
        }),
      ],
      generateArgs: {
        alt: "Generated mobility setup",
        prompt: "Render a simple synthetic mobility setup diagram.",
      },
      originMatcher: generationOriginMatcher,
    });
    requireScenario().queueAssistantResponses([newerInboundReplyText], {
      matchInputContains: newerInboundText,
    });

    let imageBarrierArmed = false;
    try {
      await requireScenario().harness.armOpenAiImageResponseBarrierForTest(userId);
      imageBarrierArmed = true;
      const generationResponse = await postSignedLinqWebhook(
        buildHostedLinqInboundEvent(
          userId,
          materializedChatId,
          {
            eventId: `evt_codex_generated_media_${userId}`,
            messageId: `msg_codex_generated_media_${userId}`,
            text: "Generate a fresh mobility setup image and save it for later reuse.",
          },
        ),
      );
      expect(generationResponse.status).toBe(202);
      await requireScenario().waitForLatestPendingWake(userId);
      await requireLinqStub().waitForMatchingAcceptedSendCount({
        expectedCount: acceptedCountBeforeGeneration + 1,
        expectedPath: replyPath,
        scenario: requireScenario(),
        userId,
      });
      expectAcceptedLinqSendPartsAt({
        expectedParts: [{
          type: "text",
          value: generatedImageAdmissionReplyText,
        }],
        expectedPath: replyPath,
        index: acceptedCountBeforeGeneration,
      });
      expectImageToolResultAt({
        baselineCount: providerRequestCountBeforeGeneration,
        expected: {
          admission_pending: true,
          image_started: false,
          status: "admission_pending",
        },
        requestIndex: 1,
      });
      await waitForOpenAiImageResponseBarrierEntered(userId);

      const newerInboundResponse = await postSignedLinqWebhook(
        buildHostedLinqInboundEvent(
          userId,
          materializedChatId,
          {
            eventId: `evt_codex_generated_media_newer_${userId}`,
            messageId: `msg_codex_generated_media_newer_${userId}`,
            text: newerInboundText,
          },
        ),
      );
      expect(newerInboundResponse.status).toBe(202);
      await expect(newerInboundResponse.json()).resolves.toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });
      await requireLinqStub().waitForMatchingAcceptedSendCount({
        expectedCount: acceptedCountBeforeGeneration + 2,
        expectedPath: replyPath,
        scenario: requireScenario(),
        userId,
      });
      expectAcceptedLinqSendPartsSince({
        baselineCount: acceptedCountBeforeGeneration,
        expectedParts: [
          [{
            type: "text",
            value: generatedImageAdmissionReplyText,
          }],
          [{
            type: "text",
            value: newerInboundReplyText,
          }],
        ],
        expectedPath: replyPath,
      });
      expectAssistantProviderRequestSequence({
        baselineCount: providerRequestCountBeforeGeneration,
        expectedCount: 3,
        expectedMatchersByIndex: {
          0: [generationOriginMatcher],
          1: [
            generationOriginMatcher,
            '"admission_pending":true',
            '"image_started":false',
            '"status":"admission_pending"',
          ],
          2: [newerInboundText],
        },
      });
      expect(
        await requireScenario().harness.readOpenAiImageResponseBarrierForTest(
          userId,
        ),
      ).toEqual({ state: "entered" });
      const release =
        await requireScenario().harness.releaseOpenAiImageResponseBarrierForTest(
          userId,
        );
      expect(release).toEqual({ ok: true, released: true });
      imageBarrierArmed = false;
    } finally {
      if (imageBarrierArmed) {
        await requireScenario().harness.releaseOpenAiImageResponseBarrierForTest(
          userId,
        );
      }
    }

    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: acceptedCountBeforeGeneration + 3,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    const generationStatus =
      await requireScenario().waitForHostedCompletion(userId);
    expect(generationStatus.lastErrorCode ?? null).toBeNull();
    expectAcceptedLinqSendPartsSince({
      baselineCount: acceptedCountBeforeGeneration,
      expectedParts: [
        [{
          type: "text",
          value: generatedImageAdmissionReplyText,
        }],
        [{
          type: "text",
          value: newerInboundReplyText,
        }],
        [
          {
            type: "text",
            value: generatedImageReplyText,
          },
          {
            type: "media",
            url: generatedImageUrl,
          },
        ],
      ],
      expectedPath: replyPath,
    });
    expectAssistantProviderRequestSequence({
      baselineCount: providerRequestCountBeforeGeneration,
      expectedCount: 6,
      expectedMatchersByIndex: {
        0: [generationOriginMatcher],
        1: [
          generationOriginMatcher,
          '"admission_pending":true',
          '"image_started":false',
          '"status":"admission_pending"',
        ],
        2: [newerInboundText],
        3: [
          generationOriginMatcher,
          "<hosted_image_generation_result>",
          generatedImageUrl,
          '"status":"ready"',
        ],
        5: ["1 response image attached"],
      },
    });

    const savedImageRef = readLatestSavedGeneratedImageRef();
    expect(savedImageRef).toMatch(/^raw\/captures\/.+\.webp$/u);
    const usage = await listHostedAiUsageForTest({
      environment: requireScenario().runtimeEnv,
      memberId: userId,
    });
    expectPriceableImageUsage(usage, 1);

    const reuseReplyText = "I reused the saved setup image as the edit reference.";
    const reuseChatId = `chat_local_codex_media_reuse_${userId}`;
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: reuseChatId,
      memberId: userId,
      recipientPhone: homePhone,
    });
    const reuseReplyPath = `/chats/${encodeURIComponent(reuseChatId)}/messages`;
    const acceptedCountBeforeReuse = requireLinqStub().countAcceptedSends(reuseReplyPath);
    const providerRequestCountBeforeReuse =
      readAssistantProviderResponsesRequestBodies().length;
    const reuseOriginMatcher = `Reuse the saved image ${savedImageRef}`;
    queueHostedImageGenerationTurnPair({
      completionMatchers: [generatedImageUrl, '"status":"ready"'],
      completionResponses: [
        buildAssistantProviderMurphToolCall("attach_response_media", {
          media: [{
            alt: "Reused mobility setup",
            kind: "image",
            source: "gpt-image-2",
            url: generatedImageUrl,
          }],
        }),
        scopeHostedLocalAssistantProviderResponse(reuseReplyText, {
          matchInputContains: "1 response image attached",
        }),
      ],
      generateArgs: {
        alt: "Reused mobility setup",
        prompt: "Create a synthetic variation that preserves the reference layout.",
        referenceImageRefs: [savedImageRef],
      },
      originMatcher: reuseOriginMatcher,
    });

    const reuseResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      reuseChatId,
      {
        eventId: `evt_codex_generated_media_reuse_${userId}`,
        messageId: `msg_codex_generated_media_reuse_${userId}`,
        text: `Reuse the saved image ${savedImageRef} as a reference for one variation.`,
      },
    ));
    expect(reuseResponse.status).toBe(202);
    await requireScenario().waitForLatestPendingWake(userId);
    const reuseCompletionPromise = requireScenario().waitForHostedCompletion(userId);
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: acceptedCountBeforeReuse + 1,
      expectedPath: reuseReplyPath,
      scenario: requireScenario(),
      userId,
    });
    expectAcceptedLinqSendPartsAt({
      expectedParts: [{
        type: "text",
        value: generatedImageAdmissionReplyText,
      }],
      expectedPath: reuseReplyPath,
      index: acceptedCountBeforeReuse,
    });
    expectImageToolResultAt({
      baselineCount: providerRequestCountBeforeReuse,
      expected: {
        admission_pending: true,
        image_started: false,
        status: "admission_pending",
      },
      requestIndex: 1,
    });
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: acceptedCountBeforeReuse + 2,
      expectedPath: reuseReplyPath,
      scenario: requireScenario(),
      userId,
    });
    const finalStatus = await reuseCompletionPromise;
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expectAcceptedLinqSendPartsSince({
      baselineCount: acceptedCountBeforeReuse,
      expectedParts: [
        [{
          type: "text",
          value: generatedImageAdmissionReplyText,
        }],
        [
          {
            type: "text",
            value: reuseReplyText,
          },
          {
            type: "media",
            url: generatedImageUrl,
          },
        ],
      ],
      expectedPath: reuseReplyPath,
    });
    expectAssistantProviderRequestSequence({
      baselineCount: providerRequestCountBeforeReuse,
      expectedCount: 4,
      expectedMatchersByIndex: {
        0: [reuseOriginMatcher],
        1: [
          reuseOriginMatcher,
          '"admission_pending":true',
          '"image_started":false',
          '"status":"admission_pending"',
        ],
        2: [
          reuseOriginMatcher,
          "<hosted_image_generation_result>",
          generatedImageUrl,
          '"status":"ready"',
        ],
      },
    });
    expectPriceableImageUsage(
      await listHostedAiUsageForTest({
        environment: requireScenario().runtimeEnv,
        memberId: userId,
      }),
      2,
    );
  }, 360_000);

  it("degrades to text when generated-image upload throws", async () => {
    const materializedChatId = `chat_local_codex_media_upload_failure_${userId}`;
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: materializedChatId,
      memberId: userId,
      recipientPhone: homePhone,
    });
    const replyPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const acceptedCountBeforeGeneration = requireLinqStub().countAcceptedSends(replyPath);
    const providerRequestCountBeforeGeneration =
      readAssistantProviderResponsesRequestBodies().length;
    const imageUsageCountBeforeGeneration = (
      await listHostedAiUsageForTest({
        environment: requireScenario().runtimeEnv,
        memberId: userId,
      })
    ).filter((row) => row.providerName === "OpenAI Images").length;
    const originMatcher = "Generate an image that hits the upload failure path";
    await requireScenario().harness.armGeneratedImageUploadTypeErrorForTest(userId);
    queueHostedImageGenerationTurnPair({
      completionMatchers: [
        '"reason":"finalization_failed"',
        '"status":"unavailable"',
      ],
      completionResponses: [generatedImageUploadFailureReplyText],
      generateArgs: {
        alt: "Generated upload failure setup",
        prompt: "Render a simple synthetic mobility setup diagram for a failure test.",
      },
      originMatcher,
    });

    const generationResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      materializedChatId,
      {
        eventId: `evt_codex_generated_media_upload_failure_${userId}`,
        messageId: `msg_codex_generated_media_upload_failure_${userId}`,
        text: "Generate an image that hits the upload failure path.",
      },
    ));
    expect(generationResponse.status).toBe(202);
    await requireScenario().waitForLatestPendingWake(userId);
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: acceptedCountBeforeGeneration + 1,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expectAcceptedLinqSendPartsAt({
      expectedParts: [{
        type: "text",
        value: generatedImageAdmissionReplyText,
      }],
      expectedPath: replyPath,
      index: acceptedCountBeforeGeneration,
    });
    expectImageToolResultAt({
      baselineCount: providerRequestCountBeforeGeneration,
      expected: {
        admission_pending: true,
        image_started: false,
        status: "admission_pending",
      },
      requestIndex: 1,
    });
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: acceptedCountBeforeGeneration + 2,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expectAcceptedLinqSendPartsSince({
      baselineCount: acceptedCountBeforeGeneration,
      expectedParts: [
        [{
          type: "text",
          value: generatedImageAdmissionReplyText,
        }],
        [{
          type: "text",
          value: generatedImageUploadFailureReplyText,
        }],
      ],
      expectedPath: replyPath,
    });
    expectAssistantProviderRequestSequence({
      baselineCount: providerRequestCountBeforeGeneration,
      expectedCount: 3,
      expectedMatchersByIndex: {
        0: [originMatcher],
        1: [
          originMatcher,
          '"admission_pending":true',
          '"image_started":false',
          '"status":"admission_pending"',
        ],
        2: [
          originMatcher,
          "<hosted_image_generation_result>",
          '"reason":"finalization_failed"',
          '"status":"unavailable"',
        ],
      },
    });
    expectPriceableImageUsage(
      await listHostedAiUsageForTest({
        environment: requireScenario().runtimeEnv,
        memberId: userId,
      }),
      imageUsageCountBeforeGeneration + 1,
    );
  }, 360_000);

  it("denies a group image before dispatch and lets fresh Murph offer the existing funding path", async () => {
    const replyPath =
      `/chats/${encodeURIComponent(groupImageChatId)}/messages`;
    const warmupSendBaseline =
      requireLinqStub().countAcceptedSends(replyPath);
    requireScenario().queueAssistantResponses([groupImageWarmupReplyText], {
      matchInputContains: groupImageWarmupText,
    });
    const warmupResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(
        userId,
        groupImageChatId,
        {
          eventId: `evt_codex_image_group_warmup_${userId}`,
          isGroup: true,
          messageId: `msg_codex_image_group_warmup_${userId}`,
          service: "iMessage",
          text: groupImageWarmupText,
        },
      ),
    );
    expect(warmupResponse.status).toBe(202);
    await expect(warmupResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-thread-route",
    });
    const route = await requireScenario().readHostedThreadRoute({
      channel: "linq",
      threadId: groupImageChatId,
    });
    expect(route).not.toBeNull();
    const containerMemberId = route?.containerMemberId;
    if (!containerMemberId) {
      throw new Error("Expected the image test group to have a runtime member.");
    }
    await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: warmupSendBaseline + 1,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId: containerMemberId,
    });
    await waitForNonImageUsage(containerMemberId);

    const { periodEnd, periodStart } = currentUtcCalendarMonth();
    await seedHostedAiUsageLimitPeriodForTest({
      environment: requireScenario().runtimeEnv,
      limitUsdMicros: 4_500_000n,
      memberId: containerMemberId,
      periodEnd,
      periodStart,
      remainingUsdMicros: 6_118n,
    });
    const usageBefore = await readHostedGroupUsageStatusForTest({
      environment: requireScenario().runtimeEnv,
      runtimeMemberId: containerMemberId,
    });
    expect(usageBefore).toMatchObject({
      capacityState: "low",
    });
    const fundingUrl = usageBefore?.fundingUrl;
    if (!fundingUrl) {
      throw new Error("Expected the image test group to expose its funding URL.");
    }

    const denialOriginMatcher =
      "Generate the tiny capacity-check image for this group";
    const denialReplyText =
      `That image didn't start because it would exhaust this chat's available usage. If anyone wants more capacity, it can be added here: ${fundingUrl}`;
    const acceptedCountBeforeDenial =
      requireLinqStub().countAcceptedSends(replyPath);
    const providerRequestCountBeforeDenial =
      readAssistantProviderResponsesRequestBodies().length;
    let barrierArmed = false;
    try {
      await requireScenario().harness.armOpenAiImageResponseBarrierForTest(
        containerMemberId,
      );
      barrierArmed = true;
      queueHostedImageGenerationTurnPair({
        completionMatchers: [
          '"image_started":false',
          '"reason":"would_exhaust"',
          '"status":"insufficient_image_capacity"',
        ],
        completionResponses: [
          buildAssistantProviderShellCommandCall(
            'sed -n \'1,240p\' "$MURPH_ASSISTANT_SKILLS_ROOT/hosted-low-usage/SKILL.md"',
          ),
          buildAssistantProviderMurphToolCall("group", {
            action: "read_usage",
          }),
          denialReplyText,
        ],
        generateArgs: {
          alt: "Capacity check",
          prompt: "x",
          quality: "low",
          size: "1024x1024",
        },
        originMatcher: denialOriginMatcher,
      });

      const denialResponse = await postSignedLinqWebhook(
        buildHostedLinqInboundEvent(
          userId,
          groupImageChatId,
          {
            eventId: `evt_codex_image_group_denial_${userId}`,
            isGroup: true,
            messageId: `msg_codex_image_group_denial_${userId}`,
            service: "iMessage",
            text:
              "Generate the tiny capacity-check image for this group and send it here.",
          },
        ),
      );
      expect(denialResponse.status).toBe(202);
      await requireLinqStub().waitForMatchingAcceptedSendCount({
        expectedCount: acceptedCountBeforeDenial + 1,
        expectedPath: replyPath,
        scenario: requireScenario(),
        userId: containerMemberId,
      });
      expectAcceptedLinqSendPartsAt({
        expectedParts: [{
          type: "text",
          value: generatedImageAdmissionReplyText,
        }],
        expectedPath: replyPath,
        index: acceptedCountBeforeDenial,
      });
      expectImageToolResultAt({
        baselineCount: providerRequestCountBeforeDenial,
        expected: {
          admission_pending: true,
          image_started: false,
          status: "admission_pending",
        },
        requestIndex: 1,
      });
      await waitForAssistantProviderRequestCountWithoutImageDispatch({
        baselineCount: providerRequestCountBeforeDenial,
        expectedCount: 3,
        userId: containerMemberId,
      });
      await requireLinqStub().waitForMatchingAcceptedSendCount({
        expectedCount: acceptedCountBeforeDenial + 2,
        expectedPath: replyPath,
        scenario: requireScenario(),
        userId: containerMemberId,
      });

      expectAssistantProviderRequestSequence({
        baselineCount: providerRequestCountBeforeDenial,
        expectedCount: 5,
        expectedMatchersByIndex: {
          0: [denialOriginMatcher, "thread is direct: false"],
          1: [
            denialOriginMatcher,
            '"admission_pending":true',
            '"image_started":false',
            '"status":"admission_pending"',
          ],
          2: [
            denialOriginMatcher,
            "thread is direct: false",
            "<hosted_image_generation_result>",
            '"image_started":false',
            '"reason":"would_exhaust"',
            '"status":"insufficient_image_capacity"',
          ],
          3: [
            "hosted-low-usage/SKILL.md",
            "## Image capacity denial",
          ],
          4: [
            '"action":"read_usage"',
            "capacityState",
            fundingUrl,
          ],
        },
      });
      // A freshly provisioned group can retain an unrelated due activation
      // wake. Idle still proves this invocation finished while the provider
      // barrier remains armed.
      await requireScenario().waitForHostedIdle(containerMemberId);
      expectAcceptedLinqSendPartsSince({
        baselineCount: acceptedCountBeforeDenial,
        expectedParts: [
          [{
            type: "text",
            value: generatedImageAdmissionReplyText,
          }],
          [{
            type: "text",
            value: denialReplyText,
          }],
        ],
        expectedPath: replyPath,
      });
      expect(
        await requireScenario().harness.readOpenAiImageResponseBarrierForTest(
          containerMemberId,
        ),
      ).toEqual({ state: "armed" });
    } finally {
      if (barrierArmed) {
        await requireScenario().harness.releaseOpenAiImageResponseBarrierForTest(
          containerMemberId,
        );
      }
    }

    const usageRows = await listHostedAiUsageForTest({
      environment: requireScenario().runtimeEnv,
      memberId: containerMemberId,
    });
    expect(
      usageRows.filter((row) => row.providerName === "OpenAI Images"),
    ).toEqual([]);
    expect(
      usageRows.some((row) => row.providerName !== "OpenAI Images"),
    ).toBe(true);
    await expect(readHostedGroupUsageStatusForTest({
      environment: requireScenario().runtimeEnv,
      runtimeMemberId: containerMemberId,
    })).resolves.toMatchObject({
      capacityState: "low",
      fundingUrl,
    });
  }, 420_000);
});

function queueHostedImageGenerationTurnPair(input: {
  completionMatchers: readonly string[];
  completionResponses: readonly HostedLocalAssistantProviderScriptedResponse[];
  generateArgs: Record<string, unknown>;
  originMatcher: string;
}): void {
  requireScenario().queueAssistantResponses([
    buildAssistantProviderMurphToolCall("generate_image", input.generateArgs),
    generatedImageAdmissionReplyText,
  ], {
    matchInputContains: input.originMatcher,
  });
  const [completionResponse, ...completionFollowups] = input.completionResponses;
  if (!completionResponse) {
    throw new Error("Hosted image turn pair requires a completion response.");
  }
  const completionScope = [
    input.originMatcher,
    "<hosted_image_generation_result>",
    ...input.completionMatchers,
  ];
  requireScenario().queueAssistantResponses([completionResponse], {
    matchInputContains: completionScope,
  });
  requireScenario().queueAssistantResponses(completionFollowups, {
    matchInputContains: completionScope,
  });
}

function expectAcceptedLinqSendPartsAt(input: {
  expectedParts: readonly unknown[];
  expectedPath: string;
  index: number;
}): void {
  const acceptedSends = requireLinqStub().acceptedSendRequests.filter((request) =>
    request.method === "POST" && request.url === input.expectedPath
  );
  expect(acceptedSends[input.index]).toBeDefined();
  expect(readObservedLinqMessageParts(acceptedSends[input.index]!))
    .toEqual(input.expectedParts);
}

function expectAcceptedLinqSendPartsSince(input: {
  baselineCount: number;
  expectedParts: readonly (readonly unknown[])[];
  expectedPath: string;
}): void {
  const acceptedSends = requireLinqStub().acceptedSendRequests.filter((request) =>
    request.method === "POST" && request.url === input.expectedPath
  );
  expect(acceptedSends.slice(input.baselineCount).map(readObservedLinqMessageParts))
    .toEqual(input.expectedParts);
}

function expectAssistantProviderRequestSequence(input: {
  baselineCount: number;
  expectedCount: number;
  expectedMatchersByIndex: Readonly<Record<number, readonly string[]>>;
}): void {
  const requests = readAssistantProviderResponsesRequestBodies()
    .slice(input.baselineCount);
  expect(requests).toHaveLength(input.expectedCount);
  for (const [indexText, matchers] of Object.entries(input.expectedMatchersByIndex)) {
    const index = Number(indexText);
    const request = requests[index];
    expect(request).toBeDefined();
    const matchText = buildAssistantProviderRequestMatchText(request!);
    for (const matcher of matchers) {
      expect(matchText).toContain(matcher);
    }
  }
}

function expectImageToolResultAt(input: {
  baselineCount: number;
  expected: Record<string, unknown>;
  requestIndex: number;
}): void {
  const body = readAssistantProviderResponsesRequestBodies()[
    input.baselineCount + input.requestIndex
  ];
  expect(body).toBeDefined();
  expect(readImageToolResult(body!)).toEqual(input.expected);
}

function readImageToolResult(body: string): Record<string, unknown> | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  for (const value of collectJsonStringValues(parsed)) {
    if (!value.includes('"image_started":false')) {
      continue;
    }
    try {
      const result = JSON.parse(value) as unknown;
      if (result && typeof result === "object" && !Array.isArray(result)) {
        return result as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function readAssistantProviderResponsesRequestBodies(): string[] {
  return requireScenario().assistantProviderRequests
    .filter((request) => request.url === "/v1/responses")
    .map((request) => request.body);
}

function buildAssistantProviderRequestMatchText(body: string): string {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  return [body, ...collectJsonStringValues(parsed)].join("\n");
}

function collectJsonStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectJsonStringValues);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectJsonStringValues);
  }
  return [];
}

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

async function waitForNonImageUsage(memberId: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const usage = await listHostedAiUsageForTest({
      environment: requireScenario().runtimeEnv,
      memberId,
    });
    if (usage.some((row) => row.providerName !== "OpenAI Images")) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for hosted non-image usage settlement.");
}

async function waitForOpenAiImageResponseBarrierEntered(
  userId: string,
): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < 30_000) {
    const barrier =
      await requireScenario().harness.readOpenAiImageResponseBarrierForTest(
        userId,
      );
    if (barrier.state === "entered") {
      return;
    }
    if (barrier.state === "unarmed") {
      throw new Error(
        "OpenAI image response barrier disarmed before provider dispatch.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for OpenAI image provider dispatch.");
}

async function waitForAssistantProviderRequestCountWithoutImageDispatch(
  input: {
    baselineCount: number;
    expectedCount: number;
    userId: string;
  },
): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < 30_000) {
    const barrier =
      await requireScenario().harness.readOpenAiImageResponseBarrierForTest(
        input.userId,
      );
    if (barrier.state === "entered") {
      throw new Error(
        "Expected image allowance denial before provider dispatch.",
      );
    }
    if (
      readAssistantProviderResponsesRequestBodies().length
        >= input.baselineCount + input.expectedCount
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the fresh image denial turn.");
}

function currentUtcCalendarMonth(): {
  periodEnd: Date;
  periodStart: Date;
} {
  const now = new Date();
  return {
    periodEnd: new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      1,
    )),
    periodStart: new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      1,
    )),
  };
}

async function ensureScenario(): Promise<void> {
  if (scenario) {
    return;
  }

  linqStub = await startHostedLocalLinqStub({
    canonicalChats: [{
          chatId: groupImageChatId,
          handles: [
            {
              handle: homePhone,
              isMe: true,
              status: "active",
            },
            {
              handle: memberPhone,
          isMe: false,
          status: "active",
        },
      ],
      isGroup: true,
    }],
    expectedAuthorizationToken: linqApiToken,
  });
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      CLOUDFLARE_IMAGES_ACCOUNT_ID: "hosted-local-images-account",
      CLOUDFLARE_IMAGES_API_KEY: "hosted-local-images-key",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: localRunnerIdleTtlMs,
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        memberPhone,
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: linqApiToken,
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    // The generated-image upload-failure regression arms a deliberate fault
    // injection, so the harness must allow mutating intervention controls.
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

function readLatestSavedGeneratedImageRef(): string {
  const requests = readAssistantProviderResponsesRequestBodies();
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
    "image generated but upload failed",
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
