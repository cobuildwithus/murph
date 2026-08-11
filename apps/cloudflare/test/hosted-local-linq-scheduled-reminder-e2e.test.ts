import { createHmac } from "node:crypto";

import {
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionPendingEffectsReconcileRequestedWake,
} from "@murphai/hosted-execution";
import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  listHostedAiUsageForTest,
  type HostedAiUsageForTestRow,
} from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildAssistantProviderMurphToolCall,
  buildHostedAssistantNotificationDecisionResponse,
  type HostedLocalAssistantProviderStubRequest,
  type HostedLocalAssistantProviderScriptedResponse,
} from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildHostedLinqSignupWelcomeWake,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  type ObservedLinqRequest,
  type ObservedLinqRequestMatcher,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const userId = `member_local_linq_scheduled_reminder_${Date.now()}`;
const linqWebhookSecret = "linq-local-scheduled-reminder-secret";
const reminderText = "Time to sleep. Put the phone down and get some rest.";
const scheduledReminderImageAlt = "Sleep reminder illustration";
const scheduledReminderDeliveredText =
  `${reminderText}\n\n${scheduledReminderImageAlt}`;
const overlapReminderText = "Time to sleep. This is the overlap reminder.";
const overlapForegroundInboundText = "Still there while the bedtime reminder is due?";
const overlapForegroundReplyText = "Yep, I am here.";
const scheduledNutritionCard = {
  kind: "daily_nutrition",
  version: 2,
  localDate: "2026-07-28",
  mealCount: 3,
  totals: {
    calories: { mealCount: 3, total: 1_490.25 },
    carbsGrams: { mealCount: 3, total: 193.125 },
    fatGrams: { mealCount: 3, total: 34.75 },
    fiberGrams: { mealCount: 3, total: 26.5 },
    proteinGrams: { mealCount: 3, total: 94.5 },
  },
  goals: {
    calories: { status: "under_target", target: 2_100 },
    carbsGrams: { status: "on_target", target: 220 },
    fatGrams: { status: "on_target", target: 40 },
    fiberGrams: { status: "under_target", target: 30 },
    proteinGrams: { status: "on_target", target: 100 },
  },
} as const;
const wakePreservationWindowRequestText =
  "Confirm the hosted-local wake-preservation checkpoint window.";
const wakePreservationWindowReplyText =
  "Wake-preservation checkpoint window confirmed.";
const scheduledReminderTiming = resolveScheduledReminderTiming();
const scheduledReminderLeadMs = scheduledReminderTiming.leadMs;
const setupLeadText = scheduledReminderTiming.setupLeadText;
const setupReplyText = `Done - I will remind you here in ${setupLeadText}.`;
const setupRequestText = `Remind me here in ${setupLeadText} to go to sleep.`;
const scheduledNutritionCardSetupRequestText =
  `Remind me here in ${setupLeadText} to show my daily nutrition summary as a card.`;
const scheduledNutritionCardInstructions =
  "Show the user the hosted-local daily nutrition summary as a card.";
const scheduledImageSetupRequestText =
  `Remind me here in ${setupLeadText} to go to sleep with a simple illustration.`;
const scheduledReminderInstructions =
  "Send the user the hosted-local sleep reminder: go to sleep.";
const scheduledImageReminderInstructions =
  "Send the user the hosted-local sleep reminder with a simple sleep illustration.";
const scheduledReminderMinimumRunwayMs = 5_000;
const scheduledReminderSendWaitMs = 60_000;
const scheduledReminderCompletionWaitMs = 60_000;
const shutdownCheckpointBarrierWaitMs = 30_000;
const productionLikeAssistantModel = "gpt-5.6-terra";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

vi.mock("server-only", () => ({}));

afterAll(async () => {
  if (scenario) {
    await scenario.harness.releaseShutdownCheckpointPublicationBarrierForTest(userId)
      .catch(() => undefined);
  }
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local Linq scheduled reminder e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 600_000);

  it("creates a reminder from the hosted assistant turn, wakes from the scheduled alarm, and sends it", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const homePhone = buildLinqHomePhoneNumber(userId);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    const activatedStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(activatedStatus.lastErrorCode ?? null).toBeNull();

    const unscheduledStatus = await requireScenario().harness.readUserStatus(userId);
    expect(unscheduledStatus.workspace?.nextWakeAt ?? null).toBeNull();
    expect(unscheduledStatus.nextAlarmAt ?? null).toBeNull();

    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId: `member.activated:local:${userId}:evt_linq_scheduled_chat`,
        userId,
      }),
      userId,
    );
    const welcomeSendPromise = requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(userId),
      scenario: requireScenario(),
      userId,
    });
    const welcomeStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(welcomeStatus.lastErrorCode ?? null).toBeNull();
    await welcomeSendPromise;

    const scheduledChatId = requireLinqStub().requireObservedChatId(userId);
    const reminderPath = `/chats/${encodeURIComponent(scheduledChatId)}/messages`;
    const setupReplyBaselineCount = requireLinqStub().countObservedSends(reminderPath);
    const scheduledReminderTimes = resolveScheduledReminderTimes();
    requireScenario().queueAssistantResponses(
      buildHostedAssistantAutomationSaveResponses({
        dueAtIso: scheduledReminderTimes.dueAtIso,
        instructions: scheduledImageReminderInstructions,
        text: setupReplyText,
      }),
      { matchInputContains: scheduledImageSetupRequestText },
    );
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      scheduledChatId,
      {
        eventId: `evt_scheduled_reminder_setup_${userId}`,
        messageId: `msg_scheduled_reminder_setup_${userId}`,
        text: scheduledImageSetupRequestText,
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const setupReplySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: setupReplyBaselineCount,
      expectedPath: reminderPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(setupReplySend)).toBe(setupReplyText);
    const setupStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(setupStatus.lastErrorCode ?? null).toBeNull();
    await waitForHostedWorkspaceWakeNotLaterThan({
      latestAllowedWakeAt: scheduledReminderTimes.dueAtIso,
      userId,
    });
    assertScheduledReminderRunway(scheduledReminderTimes.dueAtIso);

    const wakePreservationReplyBaselineCount =
      requireLinqStub().countObservedSends(reminderPath);
    requireScenario().queueAssistantResponses([
      wakePreservationWindowReplyText,
    ], {
      matchInputContains: wakePreservationWindowRequestText,
    });
    let shutdownCheckpointBarrierArmed = false;
    let systemMailboxImportedBaseline: bigint | null = null;
    try {
      await requireScenario().harness.armShutdownCheckpointPublicationBarrierForTest(userId);
      shutdownCheckpointBarrierArmed = true;
      const wakePreservationWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
        userId,
        scheduledChatId,
        {
          eventId: `evt_scheduled_reminder_wake_window_${userId}`,
          messageId: `msg_scheduled_reminder_wake_window_${userId}`,
          text: wakePreservationWindowRequestText,
        },
      ));
      expect(wakePreservationWebhookResponse.status).toBe(202);
      await expect(wakePreservationWebhookResponse.json()).resolves.toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });
      await requireScenario().waitForLatestPendingWake(userId);
      const wakePreservationReply = await requireLinqStub().waitForAdditionalSend({
        baselineCount: wakePreservationReplyBaselineCount,
        expectedPath: reminderPath,
        scenario: requireScenario(),
        userId,
      });
      expect(requireLinqStub().readObservedMessageText(wakePreservationReply))
        .toBe(wakePreservationWindowReplyText);
      await waitForShutdownCheckpointPublicationBarrier();
      systemMailboxImportedBaseline =
        readHostedSystemMailboxImportedSeq(
          await requireScenario().harness.readUserStatus(userId),
        );
      const causalSystemWake = await requireScenario().runWake(
        buildHostedExecutionPendingEffectsReconcileRequestedWake({
          effectId: "vault-file-send:effect_stale_scheduled_reminder_wake_preservation",
          eventId:
            `runtime-control:scheduled-reminder-wake-preservation:causal-checkpoint:${userId}`,
          occurredAt: new Date().toISOString(),
          userId,
        }),
        userId,
      );
      expect(causalSystemWake.wakeResult).toMatchObject({
        action: "woken",
        kind: "runtime_processing_accepted",
      });
    } finally {
      if (shutdownCheckpointBarrierArmed) {
        await expect(
          requireScenario().harness.releaseShutdownCheckpointPublicationBarrierForTest(userId),
        ).resolves.toEqual({ ok: true, released: true });
      }
    }
    await expect(
      requireScenario().harness.readShutdownCheckpointPublicationBarrierForTest(userId),
    ).resolves.toEqual({ state: "unarmed" });
    if (systemMailboxImportedBaseline === null) {
      throw new Error("Reminder setup invocation did not reach the checkpoint barrier.");
    }
    const importedSystemMailboxSeq =
      await waitForHostedSystemMailboxImportedAfter(systemMailboxImportedBaseline);
    await waitForHostedSystemMailboxHandledThrough(importedSystemMailboxSeq);
    const causalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(causalStatus.lastErrorCode ?? null).toBeNull();
    await waitForHostedWorkspaceWakeNotLaterThan({
      latestAllowedWakeAt: scheduledReminderTimes.dueAtIso,
      timeoutMs: shutdownCheckpointBarrierWaitMs,
      userId,
    });
    assertScheduledReminderRunway(scheduledReminderTimes.dueAtIso);

    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("generate_image", {
        alt: scheduledReminderImageAlt,
        prompt: "Render a simple synthetic sleep reminder illustration.",
      }),
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver sleep reminder",
        text: reminderText,
      }),
    ], {
      matchInputContains: scheduledImageReminderInstructions,
    });
    const reminderSendBaselineCount = countScheduledReminderSendsWithoutNudge({
      expectedPath: reminderPath,
      expectedText: scheduledReminderDeliveredText,
    });
    const reminderAttachmentBaselineCount = requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: "/attachments",
    });
    const reminderProviderRequestBaselineCount =
      requireScenario().assistantProviderRequests.length;
    const reminderCronUsageNotBeforeIso = new Date().toISOString();
    await sleepUntil(scheduledReminderTimes.dueAtIso);
    const sendRequest = await waitForScheduledReminderSendWithoutNudge({
      baselineCount: reminderSendBaselineCount,
      expectedPath: reminderPath,
      expectedText: scheduledReminderDeliveredText,
      timeoutMs: scheduledReminderSendWaitMs,
      userId,
    });

    expect(sendRequest.method).toBe("POST");
    expect(requireLinqStub().readObservedMessageText(sendRequest))
      .toBe(scheduledReminderDeliveredText);
    expect(readObservedLinqMessageParts(sendRequest)).toEqual([
      {
        type: "text",
        value: scheduledReminderDeliveredText,
      },
      expect.objectContaining({
        attachment_id: expect.stringMatching(/^attachment_local_/u),
        type: "media",
      }),
    ]);
    expect(requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: "/attachments",
    })).toBe(reminderAttachmentBaselineCount + 1);
    const reminderStatus = await requireScenario().waitForHostedCompletion(userId, {
      timeoutMs: scheduledReminderCompletionWaitMs,
    });
    expect(reminderStatus.lastErrorCode ?? null).toBeNull();
    const providerRequestTokenPricingBasis =
      await resolveScheduledReminderCronProviderRequestTokenPricingBasis({
        baselineCount: reminderProviderRequestBaselineCount,
        userId,
      });
    await assertScheduledReminderCronUsagePricingMatchedProviderRequest({
      expectedTokenPricingBasis: providerRequestTokenPricingBasis,
      memberId: userId,
      notBeforeIso: reminderCronUsageNotBeforeIso,
    });

    const overlapSetupTimes = resolveScheduledReminderTimes();
    const overlapSetupBaselineCount = requireLinqStub().countObservedSends(reminderPath);
    requireScenario().queueAssistantResponses(
      buildHostedAssistantAutomationSaveResponses({
        dueAtIso: overlapSetupTimes.dueAtIso,
        instructions: scheduledReminderInstructions,
        text: setupReplyText,
      }),
      { matchInputContains: setupRequestText },
    );
    const overlapSetupWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      scheduledChatId,
      {
        eventId: `evt_scheduled_reminder_overlap_setup_${userId}`,
        messageId: `msg_scheduled_reminder_overlap_setup_${userId}`,
        text: setupRequestText,
      },
    ));
    expect(overlapSetupWebhookResponse.status).toBe(202);
    await requireScenario().waitForLatestPendingWake(userId);
    const overlapSetupSend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: overlapSetupBaselineCount,
      expectedPath: reminderPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(overlapSetupSend)).toBe(setupReplyText);
    const overlapSetupStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(overlapSetupStatus.lastErrorCode ?? null).toBeNull();
    await waitForHostedWorkspaceWakeNotLaterThan({
      latestAllowedWakeAt: overlapSetupTimes.dueAtIso,
      userId,
    });
    assertScheduledReminderRunway(overlapSetupTimes.dueAtIso);

    const heldOverlapReminderResponse = createHeldAssistantProviderTextResponse(
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver overlap sleep reminder",
        text: overlapReminderText,
      }),
    );
    requireScenario().queueAssistantResponses([
      heldOverlapReminderResponse.response,
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver overlap sleep reminder after foreground reply",
        text: overlapReminderText,
      }),
    ], {
      matchInputContains: scheduledReminderInstructions,
    });
    requireScenario().queueAssistantResponses([
      overlapForegroundReplyText,
    ], {
      matchInputContains: overlapForegroundInboundText,
    });
    const overlapProviderBaselineCount = countAssistantProviderResponsesApiRequests();
    const overlapForegroundReplyMatcher =
      createObservedLinqMessageTextMatcher(overlapForegroundReplyText);
    const overlapReminderMatcher =
      createObservedLinqMessageTextMatcher(overlapReminderText);
    const overlapForegroundSendBaselineCount = requireLinqStub().countObservedSends(reminderPath);
    const overlapCreateChatBaselineCount = requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: requireLinqStub().createChatPath,
    });
    const overlapForegroundReplyBaselineCount =
      requireLinqStub().countObservedSends(reminderPath, overlapForegroundReplyMatcher);
    const overlapReminderSendBaselineCount =
      requireLinqStub().countObservedSends(reminderPath, overlapReminderMatcher);
    try {
      await sleepUntil(overlapSetupTimes.dueAtIso);

      const overlapScheduledWakeResult = await requireScenario().waitForLatestPendingWake(userId);
      expect(overlapScheduledWakeResult.lastErrorCode ?? null).toBeNull();
      await heldOverlapReminderResponse.started;
      const overlapForegroundWebhookResponse = await postSignedLinqWebhook(
        buildHostedLinqInboundEvent(
          userId,
          scheduledChatId,
          {
            eventId: `evt_scheduled_reminder_overlap_foreground_${userId}`,
            messageId: `msg_scheduled_reminder_overlap_foreground_${userId}`,
            service: "iMessage",
            text: overlapForegroundInboundText,
          },
        ),
      );
      expect(overlapForegroundWebhookResponse.status).toBe(202);
      await waitForAssistantProviderResponsesApiRequestCount(
        overlapProviderBaselineCount + 2,
        userId,
      );
      const foregroundOverlapProviderRequest =
        listAssistantProviderResponsesApiRequests()[overlapProviderBaselineCount + 1];
      await assertAssistantProviderRequestContainsText({
        baselineCount: overlapProviderBaselineCount,
        expectedText: overlapForegroundInboundText,
        request: foregroundOverlapProviderRequest,
        userId,
      });

      const overlapForegroundSend = await requireLinqStub().waitForAdditionalSend({
        baselineCount: overlapForegroundReplyBaselineCount,
        expectedPath: reminderPath,
        matchRequest: overlapForegroundReplyMatcher,
        scenario: requireScenario(),
        userId,
      });
      expect(requireLinqStub().readObservedMessageText(overlapForegroundSend))
        .toBe(overlapForegroundReplyText);
      expect(requireLinqStub().countObservedSends(reminderPath))
        .toBe(overlapForegroundSendBaselineCount + 1);
      heldOverlapReminderResponse.release();
      const overlapReminderSend = await requireLinqStub().waitForAdditionalSend({
        baselineCount: overlapReminderSendBaselineCount,
        expectedPath: reminderPath,
        matchRequest: overlapReminderMatcher,
        scenario: requireScenario(),
        userId,
      });
      expect(requireLinqStub().readObservedMessageText(overlapReminderSend))
        .toBe(overlapReminderText);
      expect(requireObservedRequestTimestamp(overlapForegroundSend))
        .toBeLessThanOrEqual(requireObservedRequestTimestamp(overlapReminderSend));
      const overlapFinalStatus = await requireScenario().waitForHostedCompletion(userId, {
        timeoutMs: scheduledReminderCompletionWaitMs,
      });
      expect(overlapFinalStatus.lastErrorCode ?? null).toBeNull();
      expect(requireLinqStub().countObservedSends(reminderPath, overlapForegroundReplyMatcher))
        .toBe(overlapForegroundReplyBaselineCount + 1);
      expect(requireLinqStub().countObservedSends(reminderPath, overlapReminderMatcher))
        .toBe(overlapReminderSendBaselineCount + 1);
      expect(requireLinqStub().countObservedSends(reminderPath))
        .toBe(overlapForegroundSendBaselineCount + 2);
      expect(requireLinqStub().countObservedRequests({
        expectedMethod: "POST",
        expectedPath: requireLinqStub().createChatPath,
      })).toBe(overlapCreateChatBaselineCount);
    } finally {
      heldOverlapReminderResponse.release();
    }

    const scheduledCardSetupTimes = resolveScheduledReminderTimes();
    const scheduledCardSetupBaselineCount =
      requireLinqStub().countObservedSends(reminderPath);
    requireScenario().queueAssistantResponses(
      buildHostedAssistantAutomationSaveResponses({
        dueAtIso: scheduledCardSetupTimes.dueAtIso,
        instructions: scheduledNutritionCardInstructions,
        text: setupReplyText,
      }),
      { matchInputContains: scheduledNutritionCardSetupRequestText },
    );
    const scheduledCardSetupResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(
        userId,
        scheduledChatId,
        {
          eventId: `evt_scheduled_nutrition_card_setup_${userId}`,
          messageId: `msg_scheduled_nutrition_card_setup_${userId}`,
          text: scheduledNutritionCardSetupRequestText,
        },
      ),
    );
    expect(scheduledCardSetupResponse.status).toBe(202);
    await requireScenario().waitForLatestPendingWake(userId);
    const scheduledCardSetupSend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: scheduledCardSetupBaselineCount,
      expectedPath: reminderPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(scheduledCardSetupSend))
      .toBe(setupReplyText);
    const scheduledCardSetupStatus = await requireScenario()
      .waitForHostedCompletion(userId);
    expect(scheduledCardSetupStatus.lastErrorCode ?? null).toBeNull();
    await waitForHostedWorkspaceWakeNotLaterThan({
      latestAllowedWakeAt: scheduledCardSetupTimes.dueAtIso,
      userId,
    });
    assertScheduledReminderRunway(scheduledCardSetupTimes.dueAtIso);

    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("attach_response_card", {
        card: scheduledNutritionCard,
      }),
      { text: "" },
    ], {
      matchInputContains: scheduledNutritionCardInstructions,
    });
    const scheduledCardMatcher = createObservedLinqIMessageAppCardMatcher();
    const scheduledCardTotalSendBaselineCount =
      requireLinqStub().countObservedSends(reminderPath);
    const scheduledCardNativeSendBaselineCount =
      requireLinqStub().countObservedSends(reminderPath, scheduledCardMatcher);
    const capabilityPath = "/capability/check_imessage";
    const capabilityMatcher = requireLinqStub().createIMessageCapabilityRequestMatcher({
      address: memberPhone,
    });
    const scheduledCardCapabilityBaselineCount = requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: capabilityPath,
      matchRequest: capabilityMatcher,
    });

    await sleepUntil(scheduledCardSetupTimes.dueAtIso);
    const scheduledCardWakeResult =
      await requireScenario().waitForLatestPendingWake(userId);
    expect(scheduledCardWakeResult.lastErrorCode ?? null).toBeNull();
    const scheduledCardSend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: scheduledCardNativeSendBaselineCount,
      expectedPath: reminderPath,
      matchRequest: scheduledCardMatcher,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(scheduledCardSend)).toBeNull();
    expect(requireLinqStub().readObservedMessageAppCard(scheduledCardSend)).toMatchObject({
      fallback_text: "Ask Murph for this card in text",
      interactive: true,
      layout: {
        caption: "Jul 28 · 3 meals",
      },
      type: "imessage_app",
    });
    await requireLinqStub().waitForMatchingRequestCount({
      expectedCount: scheduledCardCapabilityBaselineCount + 1,
      expectedMethod: "POST",
      expectedPath: capabilityPath,
      matchRequest: capabilityMatcher,
      scenario: requireScenario(),
      userId,
    });
    const scheduledCardFinalStatus = await requireScenario().waitForHostedCompletion(userId, {
      timeoutMs: scheduledReminderCompletionWaitMs,
    });
    expect(scheduledCardFinalStatus.lastErrorCode ?? null).toBeNull();
    expect(requireLinqStub().countObservedSends(reminderPath, scheduledCardMatcher))
      .toBe(scheduledCardNativeSendBaselineCount + 1);
    expect(requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: capabilityPath,
      matchRequest: capabilityMatcher,
    })).toBe(scheduledCardCapabilityBaselineCount + 1);
    expect(requireLinqStub().countObservedSends(reminderPath))
      .toBe(scheduledCardTotalSendBaselineCount + 1);
  }, 720_000);
});

describe("hosted local Linq scheduled reminder timing helpers", () => {
  it("keeps the production-like checkpoint and enough setup runway in both gates", () => {
    const now = new Date("2026-06-18T12:00:00.000Z");
    const fullTiming = resolveScheduledReminderTiming({});
    const fastTiming = resolveScheduledReminderTiming({
      MURPH_HOSTED_LOCAL_E2E_FAST_GATE: "1",
    });

    expect(fullTiming).toEqual({
      idleCheckpointDelayMs: 10_000,
      leadMs: 90_000,
      setupLeadText: "about ninety seconds",
    });
    expect(fastTiming).toEqual({
      idleCheckpointDelayMs: 1,
      leadMs: 90_000,
      setupLeadText: "about ninety seconds",
    });
    expect(resolveScheduledReminderTimes(now, fullTiming.leadMs)).toEqual({
      dueAtIso: "2026-06-18T12:01:30.000Z",
    });
    expect(resolveScheduledReminderTimes(now, fastTiming.leadMs)).toEqual({
      dueAtIso: "2026-06-18T12:01:30.000Z",
    });
    expect(scheduledReminderLeadMs).toBeGreaterThan(scheduledReminderMinimumRunwayMs);
  });
});

type ScheduledReminderTokenPricingBasis = "openai-flex" | "standard";

async function resolveScheduledReminderCronProviderRequestTokenPricingBasis(input: {
  baselineCount: number;
  userId: string;
}): Promise<ScheduledReminderTokenPricingBasis> {
  const providerRequests = requireScenario().assistantProviderRequests
    .slice(input.baselineCount)
    .filter((request) =>
      request.method === "POST" && request.url === "/v1/responses"
    );
  const requestSummaries = providerRequests.map(summarizeAssistantProviderRequest);
  const scheduledReminderRequest = requestSummaries.find((request) =>
    request.model === productionLikeAssistantModel
  );
  if (!scheduledReminderRequest) {
    throw new Error(await requireScenario().buildFailureMessage(input.userId, [
      "Scheduled reminder cron did not send a provider request for the configured assistant model.",
      `provider request baseline count: ${input.baselineCount}`,
      `observed provider requests: ${JSON.stringify(requestSummaries)}`,
    ]));
  }

  if (scheduledReminderRequest.serviceTier !== "flex") {
    throw new Error(await requireScenario().buildFailureMessage(input.userId, [
      "Scheduled reminder cron provider request did not use OpenAI flex service tier.",
      `observed provider requests: ${JSON.stringify(requestSummaries)}`,
    ]));
  }

  return "openai-flex";
}

function summarizeAssistantProviderRequest(
  request: HostedLocalAssistantProviderStubRequest,
): {
  method: string;
  model: string | null;
  serviceTier: string | null;
  url: string;
} {
  const bodyJson = parseJsonObject(request.body);

  return {
    method: request.method,
    model: typeof bodyJson?.model === "string" ? bodyJson.model : null,
    serviceTier: typeof bodyJson?.service_tier === "string"
      ? bodyJson.service_tier
      : null,
    url: request.url,
  };
}

function countAssistantProviderResponsesApiRequests(): number {
  return listAssistantProviderResponsesApiRequests().length;
}

function listAssistantProviderResponsesApiRequests(): HostedLocalAssistantProviderStubRequest[] {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.method === "POST" && request.url === "/v1/responses"
  );
}

async function waitForAssistantProviderResponsesApiRequestCount(
  minimumCount: number,
  userId: string,
): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < scheduledReminderSendWaitMs) {
    if (countAssistantProviderResponsesApiRequests() >= minimumCount) {
      return;
    }

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for hosted assistant provider request count.",
    `expected minimum count: ${minimumCount}`,
    `actual count: ${countAssistantProviderResponsesApiRequests()}`,
  ]));
}

function readAssistantProviderRequestText(request: { body: string }): string {
  return collectJsonStrings(JSON.parse(request.body)).join("\n\n");
}

async function assertAssistantProviderRequestContainsText(input: {
  baselineCount: number;
  expectedText: string;
  request: HostedLocalAssistantProviderStubRequest | undefined;
  userId: string;
}): Promise<void> {
  if (!input.request) {
    throw new Error(await requireScenario().buildFailureMessage(input.userId, [
      "Expected an overlap provider request, but none was recorded.",
      `provider request baseline count: ${input.baselineCount}`,
      `actual provider response API request count: ${countAssistantProviderResponsesApiRequests()}`,
    ]));
  }

  const requestText = readAssistantProviderRequestText(input.request);
  if (requestText.includes(input.expectedText)) {
    return;
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "First overlap provider request was not the foreground reply request.",
    `provider request baseline count: ${input.baselineCount}`,
    `first request summary: ${JSON.stringify(summarizeAssistantProviderRequest(input.request))}`,
    `first request contains foreground text: ${String(requestText.includes(overlapForegroundInboundText))}`,
    `first request contains overlap reminder text: ${String(requestText.includes(overlapReminderText))}`,
    `recent request summaries: ${JSON.stringify(
      listAssistantProviderResponsesApiRequests()
        .slice(input.baselineCount, input.baselineCount + 4)
        .map(summarizeAssistantProviderRequest),
    )}`,
  ]));
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectJsonStrings(entry));
  }

  if (isRecord(value)) {
    return Object.values(value).flatMap((entry) => collectJsonStrings(entry));
  }

  return [];
}

async function assertScheduledReminderCronUsagePricingMatchedProviderRequest(input: {
  expectedTokenPricingBasis: ScheduledReminderTokenPricingBasis;
  memberId: string;
  notBeforeIso: string;
}): Promise<void> {
  const usageRows = await listHostedAiUsageForTest({
    environment: requireScenario().runtimeEnv,
    memberId: input.memberId,
  });
  const cronRows = usageRows.filter((row) =>
    row.providerName === "hosted-openai"
    && row.triggerKind === "automation_cron"
    && row.occurredAt >= input.notBeforeIso
  );
  expect(cronRows.length).toBeGreaterThan(0);

  const expectedPricingVersion = input.expectedTokenPricingBasis === "openai-flex"
    ? "openai-api-pricing-2026-07-30-gpt-5.6-openai-flex"
    : "openai-api-pricing-2026-07-30-gpt-5.6-standard";
  const expectedAdjustmentDenominator =
    input.expectedTokenPricingBasis === "openai-flex" ? "2" : "1";

  for (const cronUsage of cronRows) {
    expect(cronUsage).toMatchObject({
      allowanceCounted: true,
      allowancePricingVersion: expectedPricingVersion,
      credentialSource: "platform",
      providerName: "hosted-openai",
      requestedModel: productionLikeAssistantModel,
      servedModel: productionLikeAssistantModel,
      surface: "linq",
      tokenPricingBasis: input.expectedTokenPricingBasis,
      triggerKind: "automation_cron",
    });
    expect(BigInt(cronUsage.allowanceCostUsdMicros) > 0n).toBe(true);
    expect(cronUsage.allowancePricingSnapshotJson).toMatchObject({
      tokenPricingAdjustment: {
        denominator: expectedAdjustmentDenominator,
        numerator: "1",
      },
      tokenPricingBasis: input.expectedTokenPricingBasis,
    });

    if (input.expectedTokenPricingBasis === "openai-flex") {
      assertOpenAiFlexUsageCostsAdjustedFromStandard(cronUsage);
    } else {
      assertStandardUsageCostsMatchStandardCost(cronUsage);
    }
  }
}

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS:
        String(scheduledReminderTiming.idleCheckpointDelayMs),
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    faultInjection: true,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-linq-scheduled-reminder-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Linq scheduled reminder e2e",
    streamLogs: streamDevLogs,
    testControls: true,
  });
}

function buildHostedAssistantAutomationSaveResponses(input: {
  dueAtIso: string;
  instructions: string;
  text: string;
}): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderMurphToolCall("automation", {
      action: "save",
      continuityPolicy: "preserve",
      instructions: input.instructions,
      schedule: { at: input.dueAtIso, kind: "at" },
      summary: "One-shot sleep reminder.",
      tags: ["assistant", "scheduled"],
      title: "Sleep reminder",
    }),
    input.text,
  ];
}

function createHeldAssistantProviderTextResponse(text: string): {
  release: () => void;
  response: HostedLocalAssistantProviderScriptedResponse;
  started: Promise<void>;
} {
  let release = (): void => {};
  let markStarted = (): void => {};
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });

  return {
    release,
    response: {
      beforeResponse: () => releasePromise,
      onResponseStarted: markStarted,
      text,
    },
    started,
  };
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_linq_scheduled_reminder`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepUntil(dueAtIso: string): Promise<void> {
  const dueAtMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueAtMs)) {
    throw new Error(`Invalid scheduled reminder due timestamp: ${dueAtIso}`);
  }

  const delayMs = dueAtMs - Date.now() + 750;
  if (delayMs > 0) {
    await sleep(delayMs);
  }
}

function assertScheduledReminderRunway(dueAtIso: string): void {
  const dueAtMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueAtMs)) {
    throw new Error(`Invalid scheduled reminder due timestamp: ${dueAtIso}`);
  }

  const remainingMs = dueAtMs - Date.now();
  if (remainingMs < scheduledReminderMinimumRunwayMs) {
    throw new Error([
      "Scheduled reminder E2E reached Temporal scheduling too close to due time.",
      `remainingMs: ${remainingMs}`,
      `minimumRunwayMs: ${scheduledReminderMinimumRunwayMs}`,
      `dueAtIso: ${dueAtIso}`,
    ].join("\n"));
  }
}

async function waitForHostedWorkspaceWakeNotLaterThan(input: {
  latestAllowedWakeAt: string;
  timeoutMs?: number;
  userId: string;
}): Promise<string> {
  const latestAllowedWakeAtMs = Date.parse(input.latestAllowedWakeAt);
  if (!Number.isFinite(latestAllowedWakeAtMs)) {
    throw new Error(`Invalid scheduled reminder due timestamp: ${input.latestAllowedWakeAt}`);
  }

  const startedAt = Date.now();
  let latestNextWakeAt: string | null = null;
  let latestNextAlarmAt: string | null = null;
  let latestError: string | null = null;

  while ((Date.now() - startedAt) < (input.timeoutMs ?? 120_000)) {
    let status: Awaited<ReturnType<HostedLocalFullStackScenario["harness"]["readUserStatus"]>>;
    try {
      status = await requireScenario().harness.readUserStatus(input.userId);
    } catch (error) {
      latestError = error instanceof Error ? error.message : String(error);
      await sleep(1_000);
      continue;
    }

    if (status.lastErrorCode) {
      throw new Error(await requireScenario().buildFailureMessage(input.userId, [
        "Hosted runner reported an error before checkpointing the scheduled Linq reminder wake.",
        `lastErrorCode: ${status.lastErrorCode}`,
      ]));
    }

    latestNextWakeAt = status.workspace?.nextWakeAt ?? null;
    latestNextAlarmAt = status.nextAlarmAt ?? null;
    const latestNextWakeAtMs = latestNextWakeAt ? Date.parse(latestNextWakeAt) : NaN;
    if (
      latestNextWakeAt
      && Number.isFinite(latestNextWakeAtMs)
      && latestNextWakeAtMs > Date.now()
      && latestNextWakeAtMs <= latestAllowedWakeAtMs
    ) {
      return latestNextWakeAt;
    }

    await sleep(1_000);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the hosted workspace to arm a wake for the scheduled Linq reminder.",
    `latestAllowedWakeAt: ${input.latestAllowedWakeAt}`,
    `latestNextWakeAt: ${latestNextWakeAt ?? "null"}`,
    `latestNextAlarmAt: ${latestNextAlarmAt ?? "null"}`,
    latestError ? `latest status read error: ${latestError}` : null,
  ].filter((line): line is string => Boolean(line))));
}

async function waitForShutdownCheckpointPublicationBarrier(): Promise<void> {
  const startedAt = Date.now();
  let lastState: string | null = null;

  while (Date.now() - startedAt < shutdownCheckpointBarrierWaitMs) {
    const barrier = await requireScenario().harness
      .readShutdownCheckpointPublicationBarrierForTest(userId);
    lastState = barrier.state;
    if (barrier.state === "entered") {
      return;
    }
    await sleep(100);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for shutdown checkpoint publication to enter its test barrier.",
    `last barrier state: ${lastState ?? "unread"}`,
  ]));
}

async function waitForHostedSystemMailboxHandledThrough(
  expectedHandledThroughSeq: bigint,
): Promise<void> {
  const startedAt = Date.now();
  let lastHandledThroughSeq = 0n;

  while (Date.now() - startedAt < shutdownCheckpointBarrierWaitMs) {
    const status = await requireScenario().harness.readUserStatus(userId);
    lastHandledThroughSeq = readHostedSystemMailboxHandledThroughSeq(status);
    if (lastHandledThroughSeq >= expectedHandledThroughSeq) {
      return;
    }
    await sleep(100);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the live invocation to handle the pending-effects system import.",
    `expected handled-through seq: ${expectedHandledThroughSeq}`,
    `last handled-through seq: ${lastHandledThroughSeq}`,
  ]));
}

function readHostedSystemMailboxImportedSeq(
  status: Awaited<ReturnType<HostedLocalFullStackScenario["harness"]["readUserStatus"]>>,
): bigint {
  const value = status.workspace?.redactedStatus?.hostedMailboxSystemImportedSeq;
  return typeof value === "string" ? BigInt(value) : 0n;
}

function readHostedSystemMailboxHandledThroughSeq(
  status: Awaited<ReturnType<HostedLocalFullStackScenario["harness"]["readUserStatus"]>>,
): bigint {
  const value = status.workspace?.redactedStatus?.hostedMailboxSystemHandledThroughSeq;
  return typeof value === "string" ? BigInt(value) : 0n;
}

async function waitForHostedSystemMailboxImportedAfter(
  baselineImportedSeq: bigint,
): Promise<bigint> {
  const startedAt = Date.now();
  let lastImportedSeq = baselineImportedSeq;

  while (Date.now() - startedAt < shutdownCheckpointBarrierWaitMs) {
    const status = await requireScenario().harness.readUserStatus(userId);
    lastImportedSeq = readHostedSystemMailboxImportedSeq(status);
    if (lastImportedSeq > baselineImportedSeq) {
      return lastImportedSeq;
    }
    await sleep(100);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the live invocation to import the pending-effects system wake.",
    `system mailbox imported seq: ${lastImportedSeq}`,
    `imported baseline seq: ${baselineImportedSeq}`,
  ]));
}

async function waitForScheduledReminderSendWithoutNudge(input: {
  baselineCount: number;
  expectedPath: string;
  expectedText: string;
  timeoutMs: number;
  userId: string;
}): Promise<ObservedLinqRequest> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < input.timeoutMs) {
    const matchingRequests = requireLinqStub().observedRequests.filter((request) =>
      request.method === "POST" && request.url === input.expectedPath
      && requireLinqStub().readObservedMessageText(request) === input.expectedText
    );
    if (matchingRequests.length > input.baselineCount) {
      return matchingRequests.at(-1)!;
    }

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the scheduled Linq reminder send without another inbound or runner nudge.",
    `expected path: ${input.expectedPath}`,
    `expected text: ${input.expectedText}`,
    `baseline count: ${input.baselineCount}`,
    `observed requests: ${JSON.stringify(summarizeObservedLinqRequests())}`,
  ]));
}

function countScheduledReminderSendsWithoutNudge(input: {
  expectedPath: string;
  expectedText: string;
}): number {
  return requireLinqStub().observedRequests.filter((request) =>
    request.method === "POST"
    && request.url === input.expectedPath
    && requireLinqStub().readObservedMessageText(request) === input.expectedText
  ).length;
}

function summarizeObservedLinqRequests(): Array<{ method: string; url: string }> {
  return requireLinqStub().observedRequests.slice(-20).map((request) => ({
    method: request.method,
    url: request.url,
  }));
}

function requireObservedRequestTimestamp(request: ObservedLinqRequest): number {
  const observedAtEpochMs = request.observedAtEpochMs;
  if (typeof observedAtEpochMs !== "number" || !Number.isSafeInteger(observedAtEpochMs)) {
    throw new Error("Expected a Linq request observation timestamp.");
  }
  return observedAtEpochMs;
}

function readObservedLinqMessageParts(request: ObservedLinqRequest): unknown[] {
  const parsed = JSON.parse(request.body) as {
    message?: {
      parts?: unknown;
    };
  };
  return Array.isArray(parsed.message?.parts) ? parsed.message.parts : [];
}

function createObservedLinqMessageTextMatcher(
  expectedText: string,
): ObservedLinqRequestMatcher {
  return (request) => requireLinqStub().readObservedMessageText(request) === expectedText;
}

function createObservedLinqIMessageAppCardMatcher(): ObservedLinqRequestMatcher {
  return (request) => requireLinqStub().readObservedMessageAppCard(request) !== null;
}

function resolveScheduledReminderTimes(
  now = new Date(),
  leadMs = scheduledReminderLeadMs,
): {
  dueAtIso: string;
} {
  const dueAtMs = now.getTime() + leadMs;
  return {
    dueAtIso: new Date(dueAtMs).toISOString(),
  };
}

function resolveScheduledReminderTiming(
  env: NodeJS.ProcessEnv = process.env,
): {
  idleCheckpointDelayMs: number;
  leadMs: number;
  setupLeadText: string;
} {
  return {
    idleCheckpointDelayMs:
      env.MURPH_HOSTED_LOCAL_E2E_FAST_GATE === "1" ? 1 : 10_000,
    leadMs: 90_000,
    setupLeadText: "about ninety seconds",
  };
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

function assertOpenAiFlexUsageCostsAdjustedFromStandard(row: HostedAiUsageForTestRow): void {
  const snapshot = row.allowancePricingSnapshotJson;
  if (!isRecord(snapshot)) {
    throw new Error("Scheduled reminder usage row is missing an allowance pricing snapshot.");
  }

  const standardCostUsdMicros = snapshot.standardCostUsdMicros;
  if (typeof standardCostUsdMicros !== "string") {
    throw new Error("Scheduled reminder pricing snapshot is missing standardCostUsdMicros.");
  }

  const standardCost = BigInt(standardCostUsdMicros);
  expect(BigInt(row.allowanceCostUsdMicros)).toBe((standardCost + 1n) / 2n);
}

function assertStandardUsageCostsMatchStandardCost(row: HostedAiUsageForTestRow): void {
  const snapshot = row.allowancePricingSnapshotJson;
  if (!isRecord(snapshot)) {
    throw new Error("Scheduled reminder usage row is missing an allowance pricing snapshot.");
  }

  const standardCostUsdMicros = snapshot.standardCostUsdMicros;
  if (typeof standardCostUsdMicros !== "string") {
    throw new Error("Scheduled reminder pricing snapshot is missing standardCostUsdMicros.");
  }

  expect(BigInt(row.allowanceCostUsdMicros)).toBe(BigInt(standardCostUsdMicros));
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
