import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  advanceHostedMailboxConsumedSeqForTest,
  ageHostedMailboxItemForTest,
  ageHostedRuntimeLatencyAlertForTest,
  ageHostedRuntimeProgressAlertForTest,
  appendHostedExecutionWakeForTest,
  normalizeHostedLinqLatencyTracesForTest,
  queryHostedRuntimeWorkflowForTest,
  readHostedMailboxItemForTest,
  seedHostedWorkspaceCheckpointForTest,
  seedHostedWorkspaceInboxMediaRetentionWakeForTest,
  setLatestHostedLinqReplyLatencyForTest,
  signalHostedMailboxAppendRuntimeForTest,
  signalHostedRuntimeRecheckRuntimeForTest,
  signalHostedRuntimeWakeRuntimeForTest,
} from "#hosted-web-testing";
import {
  buildHostedExecutionAssistantAskCompletedWake,
  buildHostedExecutionAssistantAskRequestedWake,
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionCodexAuthRequestedWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionEnvironmentVoiceCapturedWake,
  buildHostedExecutionMealPhotoCapturedWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionMemberPreferencesUpdatedWake,
  buildHostedExecutionPendingEffectsReconcileRequestedWake,
  buildHostedExecutionRuntimeControlWake,
  buildHostedExecutionVaultShareDeliveryWake,
  buildHostedExecutionVaultShareRevokeWake,
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  HOSTED_EXECUTION_WAKE_KINDS,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  buildHostedExecutionClinicalRecordsSyncRequestedWake,
} from "@murphai/hosted-execution/clinical-records";
import {
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
} from "@murphai/hosted-execution/orchestration-control";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  createCloudflareHostedControlClient,
} from "@murphai/cloudflare-hosted-control/client";
import {
  buildCloudflareHostedControlRuntimeShellPrewarmPath,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import {
  createIntegratedVaultServices,
} from "@murphai/vault-usecases/vault-services";

import {
  buildAssistantProviderShellCommandCall,
} from "./helpers/hosted-local-e2e-support.js";
import type {
  HostedLocalForegroundPriorityOrderingEvent,
  HostedLocalForegroundPriorityOrderingObservationState,
} from "../src/hosted-local-test/foreground-priority-ordering.ts";
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
  type ObservedLinqRequestMatcher,
} from "./helpers/hosted-local-linq-support.js";
import {
  startHostedLocalResendStub,
  type HostedLocalResendStub,
  type ObservedResendRequest,
} from "./helpers/hosted-local-resend-support.js";

const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const linqWebhookSecret = "linq-local-foreground-reply-priority-secret";
const latencyAlertEmail = "operator@example.test";
const latencyAlertCronSecret = "hosted-local-priority-latency-cron-secret";
const latencyAlertTimeZone = buildDaytimeTestTimeZone(new Date());
const productionLikeAssistantModel = "gpt-5.6-terra";
const productionIdleCheckpointDelayMs = 180_000;
const orderingIdleCheckpointDelayMs = 10_000;
const promptReplyDeadlineMs = 30_000;
const duplicateReplyObservationMs = 3_000;
const activeTurnDuplicateReplyObservationMs = 22_000;
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

interface ProbeIdentity {
  chatId: string;
  homePhone: string;
  memberPhone: string;
  userId: string;
}

type ForegroundPriorityOrderingEventKind =
  HostedLocalForegroundPriorityOrderingEvent["kind"];
type ForegroundPriorityOrderingEventOfKind<
  Kind extends ForegroundPriorityOrderingEventKind,
> = Extract<HostedLocalForegroundPriorityOrderingEvent, { kind: Kind }>;

const systemMailboxProbe = createProbeIdentity("system-mailbox");
const retentionProbe = createProbeIdentity("retention");
const stuckInvocationProbe = createProbeIdentity("stuck-invocation");
const activeTurnProbe = createProbeIdentity("active-turn");
const postEnrollmentConversationProbe = createProbeIdentity(
  "post-enrollment-conversation",
);
const interruptedSnapshotOrderingProbe = createProbeIdentity(
  "interrupted-snapshot-ordering",
);
const canonicalPublicationOrderingProbe = createProbeIdentity(
  "canonical-publication-ordering",
);
const orderingProbeIdentities = [
  interruptedSnapshotOrderingProbe,
  canonicalPublicationOrderingProbe,
] as const;
const allProbeIdentities = [
  systemMailboxProbe,
  retentionProbe,
  stuckInvocationProbe,
  activeTurnProbe,
] as const;

let scenario: HostedLocalFullStackScenario | null = null;
let linqStub: HostedLocalLinqStub | null = null;
let resendStub: HostedLocalResendStub | null = null;
let orderingScenario: HostedLocalFullStackScenario | null = null;
let orderingLinqStub: HostedLocalLinqStub | null = null;

describe.sequential("hosted local foreground reply priority e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub();
    resendStub = await startHostedLocalResendStub();
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.test>",
        HOSTED_LINQ_ALERT_EMAILS: latencyAlertEmail,
        HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE: latencyAlertTimeZone,
        CRON_SECRET: latencyAlertCronSecret,
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS:
          String(productionIdleCheckpointDelayMs),
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          [...allProbeIdentities, postEnrollmentConversationProbe]
            .map((identity) => identity.memberPhone)
            .join(","),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: "linq-local-test-token",
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        MURPH_HOSTED_LOCAL_RESEND_API_BASE_URL: requireResendStub().baseUrl,
        OPENAI_API_KEY: "stub-local-openai-key",
        RESEND_API_KEY: "re_local_latency_alert",
      },
      assistantProviderStubModelId: productionLikeAssistantModel,
      faultInjection: true,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-foreground-reply-priority-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted foreground reply priority e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await resendStub?.stop();
    resendStub = null;
    await linqStub?.stop();
    linqStub = null;
  }, 120_000);

  it("replies promptly while every durable system wake kind owns the runner", async () => {
    await seedProbe(systemMailboxProbe);
    const stagedMealPhoto = await stageMealPhotoForProbe(systemMailboxProbe);
    const stagedEnvironmentVoice = await stageEnvironmentVoiceForProbe(
      systemMailboxProbe,
    );
    const systemWakes = buildEverySystemWake(
      systemMailboxProbe,
      stagedMealPhoto,
      stagedEnvironmentVoice,
    );
    expect(systemWakes.map((wake) => wake.kind).sort()).toEqual(
      HOSTED_EXECUTION_WAKE_KINDS
        .filter((kind) => kind !== "conversation.message")
        .sort(),
    );

    const appended = [];
    for (const wake of systemWakes) {
      appended.push(await appendHostedExecutionWakeForTest({
        environment: requireScenario().runtimeEnv,
        wake,
      }));
    }
    expect(appended.every((result) => result.inserted)).toBe(true);

    requireScenario().queueAssistantResponses(
      ["Background system notification acknowledged."],
      { matchInputContains: "Priority-gate background notification." },
    );
    await armCheckpointPublicationBarrier(
      systemMailboxProbe.userId,
      "canonical",
    );
    const latestAppend = appended.at(-1);
    if (!latestAppend) {
      throw new Error("The foreground-priority system wake storm was empty.");
    }
    await signalTemporalRuntime(systemMailboxProbe.userId, {
      kind: "mailbox_appended",
      lane: "system",
      laneSeq: latestAppend.wake.seq,
      mailboxItemId: latestAppend.wake.id,
    });
    const systemFence = await waitForSystemWakeStormCheckpointBarrier(
      systemMailboxProbe.userId,
      latestAppend.wake.seq,
      systemWakes.length,
    );
    let latencyMs: number;
    let barrierReleased = false;
    try {
      latencyMs = await sendInboundAndRequirePromptReply({
        afterAccepted: async () => {
          await waitForForegroundReplacementWhileBarrierHeld(
            systemMailboxProbe.userId,
            systemFence.attemptId,
          );
          await releaseBackgroundCheckpointBarrier(systemMailboxProbe.userId);
          barrierReleased = true;
        },
        identity: systemMailboxProbe,
        inboundText: "Reply while the full system mailbox is active.",
        label: "system mailbox",
        replyText: "Foreground reply won over the full system mailbox.",
      });
    } finally {
      if (!barrierReleased) {
        await releaseBackgroundCheckpointBarrier(systemMailboxProbe.userId);
      }
    }

    for (const wake of systemWakes) {
      await expect(readHostedMailboxItemForTest({
        dedupeKey: wake.eventId,
        environment: requireScenario().runtimeEnv,
        userId: systemMailboxProbe.userId,
      })).resolves.toMatchObject({
        dedupeKey: wake.eventId,
        kind: wake.kind,
        lane: "system",
      });
    }
    await requireSystemWakeStormPreserved(
      systemMailboxProbe.userId,
      latestAppend.wake.seq,
    );
    await assertExactlyOneAcceptedReplyAfterBoundary({
      identity: systemMailboxProbe,
      label: "system mailbox",
      replyText: "Foreground reply won over the full system mailbox.",
    });

    writeLatencyProof("system_mailbox", latencyMs);
  }, 300_000);

  it("replies promptly while retention-only work owns the runner", async () => {
    await seedProbe(retentionProbe);
    await seedHostedWorkspaceInboxMediaRetentionWakeForTest({
      environment: requireScenario().runtimeEnv,
      userId: retentionProbe.userId,
      wakeAt: new Date(Date.now() - 1_000),
    });
    await armCheckpointPublicationBarrier(retentionProbe.userId, "shutdown");
    await signalTemporalRuntime(retentionProbe.userId, {
      kind: "runtime_recheck_requested",
    });
    await waitForRuntimeInFlight(
      retentionProbe.userId,
      "retention-only work",
      "inbox_media_retention",
    );
    const shutdown = await holdBackgroundCheckpointPublication(retentionProbe.userId);

    let latencyMs: number;
    try {
      latencyMs = await sendInboundAndRequirePromptReply({
        identity: retentionProbe,
        inboundText: "Reply while retention-only work is active.",
        label: "inbox media retention",
        replyText: "Foreground reply won over retention-only work.",
      });
      await expectBackgroundCheckpointBarrierHeld(retentionProbe.userId);
    } finally {
      await releaseBackgroundCheckpointBarrier(retentionProbe.userId);
    }
    await expect(shutdown.completion).resolves.toEqual({ ok: true });
    await assertExactlyOneAcceptedReplyAfterBoundary({
      identity: retentionProbe,
      label: "inbox media retention",
      replyText: "Foreground reply won over retention-only work.",
    });

    writeLatencyProof("inbox_media_retention", latencyMs);
  }, 180_000);

  it("replies promptly when the stored invocation owner has no live child", async () => {
    await seedProbe(stuckInvocationProbe);
    await warmHostedRunnerForStaleFence(stuckInvocationProbe);
    const stuck = await requireScenario().harness.startStuckInvocationForTest(
      stuckInvocationProbe.userId,
      { startedAgoMs: 35_000 },
    );
    expect(stuck.ok).toBe(true);

    const latencyMs = await sendInboundAndRequirePromptReply({
      identity: stuckInvocationProbe,
      inboundText: "Reply through a stale invocation fence.",
      label: "stale invocation fence",
      replyText: "Foreground reply recovered the stale invocation fence.",
    });
    await assertExactlyOneAcceptedReplyAfterBoundary({
      identity: stuckInvocationProbe,
      label: "stale invocation fence",
      replyText: "Foreground reply recovered the stale invocation fence.",
    });

    writeLatencyProof("stale_invocation", latencyMs);
  }, 180_000);

  it("replies promptly when a real foreground turn is already running", async () => {
    await seedProbe(activeTurnProbe);
    const firstText = "Start a deliberately slow foreground turn.";
    const lateText = "Reply to this message while that turn is still running.";
    const replyText = "The active turn accepted the newer foreground message.";
    const replyPath = replyPathFor(activeTurnProbe);
    const replyMatcher = matchLinqMessageText(replyText);
    const baselineReplyCount = requireLinqStub().countAcceptedSends(
      replyPath,
      replyMatcher,
    );

    requireScenario().queueAssistantResponses(
      [buildAssistantProviderShellCommandCall("sleep 20")],
      { matchInputContains: firstText },
    );
    const firstResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(activeTurnProbe.userId, activeTurnProbe.chatId, {
        eventId: `evt_priority_active_first_${runId}`,
        messageId: `msg_priority_active_first_${runId}`,
        text: firstText,
      }),
    );
    expect(firstResponse.status).toBe(202);
    await expect(firstResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await waitForAssistantProviderInput(firstText, activeTurnProbe.userId, 60_000);

    const startedAt = performance.now();
    const deadlineAt = Date.now() + promptReplyDeadlineMs;
    requireScenario().queueAssistantResponses(
      [replyText],
      { matchInputContains: lateText },
    );
    const lateResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(activeTurnProbe.userId, activeTurnProbe.chatId, {
        eventId: `evt_priority_active_late_${runId}`,
        messageId: `msg_priority_active_late_${runId}`,
        text: lateText,
      }),
    );
    expect(lateResponse.status).toBe(202);
    await expect(lateResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await waitForAssistantProviderInput(
      lateText,
      activeTurnProbe.userId,
      Math.max(1, deadlineAt - Date.now()),
    );
    await waitForAcceptedReplyBeforeDeadline({
      baselineCount: baselineReplyCount,
      identity: activeTurnProbe,
      label: "active foreground turn",
      matcher: replyMatcher,
      replyPath,
      deadlineAt,
    });
    const latencyMs = performance.now() - startedAt;
    expect(latencyMs).toBeLessThan(promptReplyDeadlineMs);
    await assertExactlyOneAcceptedReplyAfterBoundary({
      identity: activeTurnProbe,
      label: "active foreground turn",
      observationMs: activeTurnDuplicateReplyObservationMs,
      replyText,
    });

    writeLatencyProof("active_default", latencyMs);
  }, 180_000);

  it("starts the first live owner from the post-enrollment conversation signal", async () => {
    const identity = postEnrollmentConversationProbe;
    const activationEventId = "member.activated:instant-start";
    const inboundEventId = `evt_priority_post_enrollment_${runId}`;
    const inboundText = "Start the first synthetic post-enrollment conversation.";
    const replyText = "The post-enrollment foreground owner handled both lanes.";
    const replyPath = replyPathFor(identity);
    const replyMatcher = matchLinqMessageText(replyText);

    // This full-stack layer begins after enrollment has committed. Focused Web
    // regressions own unknown-number admission, continuation ordering, and
    // crash-redelivery recovery; this proves the resulting runtime handoff.
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: identity.homePhone,
      memberId: identity.userId,
      memberPhone: identity.memberPhone,
    });
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: identity.chatId,
      memberId: identity.userId,
      recipientPhone: identity.memberPhone,
    });
    await expect(requireScenario().readHostedLinqWorkspaceIsolationState({
      chatId: identity.chatId,
      memberId: identity.userId,
    })).resolves.toMatchObject({
      personal: {
        conversationMailboxCount: 0,
        homeChatBound: true,
        pendingChatBound: false,
        workspaceVersion: null,
      },
      thread: null,
    });

    const activationWake = buildHostedExecutionMemberActivatedWake({
      eventId: activationEventId,
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: identity.userId,
      occurredAt: new Date().toISOString(),
    });
    const activationAppend = await appendHostedExecutionWakeForTest({
      environment: requireScenario().runtimeEnv,
      wake: activationWake,
    });
    expect(activationAppend).toMatchObject({
      duplicate: false,
      inserted: true,
    });

    const shellPrewarmResponsePromise = requireScenario().harness.request(
      buildCloudflareHostedControlRuntimeShellPrewarmPath(identity.userId),
      {
        body: "{}",
        headers: {
          "content-type": "application/json; charset=utf-8",
          [HOSTED_EXECUTION_USER_ID_HEADER]: identity.userId,
        },
        method: "POST",
      },
    );
    await expect(readActiveRuntimeFenceForTest(identity.userId)).resolves.toBeNull();

    const providerRequestBaseline = countAssistantProviderInputs(inboundText);
    const replyBaseline = requireLinqStub().countAcceptedSends(
      replyPath,
      replyMatcher,
    );
    requireScenario().queueAssistantResponses(
      [replyText],
      { matchInputContains: inboundText },
    );
    const inboundEvent = buildHostedLinqInboundEvent(
      identity.userId,
      identity.chatId,
      {
        eventId: inboundEventId,
        messageId: `msg_priority_post_enrollment_${runId}`,
        text: inboundText,
      },
    );
    const response = await postSignedLinqWebhook(inboundEvent);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    const shellPrewarmResponse = await shellPrewarmResponsePromise;
    expect(shellPrewarmResponse.status).toBe(202);
    await expect(shellPrewarmResponse.json()).resolves.toEqual({
      accepted: true,
    });

    const conversationItem = await readHostedMailboxItemForTest({
      dedupeKey: inboundEventId,
      environment: requireScenario().runtimeEnv,
      userId: identity.userId,
    });
    expect(conversationItem).toMatchObject({
      kind: "conversation.message",
      lane: "conversation",
    });
    await waitForRuntimeInFlight(
      identity.userId,
      "post-enrollment conversation signal",
      "default",
    );
    const conversationFence = await readActiveRuntimeFenceForTest(
      identity.userId,
    );
    expect(conversationFence).toMatchObject({
      processingMode: "default",
    });
    if (!conversationFence) {
      throw new Error("Conversation signal did not bind the first runtime fence.");
    }

    // Production runs this activation continuation only after the ordinary
    // conversation signal. Recreate that final handoff while the conversation
    // owner is still active.
    await signalHostedMailboxAppendRuntimeForTest({
      environment: requireScenario().runtimeEnv,
      expectedUserId: identity.userId,
      mailboxItemId: activationAppend.wake.id,
    });
    expect(await readActiveRuntimeFenceForTest(identity.userId)).toEqual(
      conversationFence,
    );

    await waitForAssistantProviderInput(inboundText, identity.userId, 60_000);
    await waitForAcceptedReplyBeforeDeadline({
      baselineCount: replyBaseline,
      deadlineAt: Date.now() + promptReplyDeadlineMs,
      identity,
      label: "post-enrollment default owner",
      matcher: replyMatcher,
      replyPath,
    });
    // Observe convergence without stopping the live owner. A graceful stop can
    // legitimately release an immediate recheck, which starts a later owner
    // and turns this ownership proof into a lifecycle-timing assertion.
    await expect.poll(async () => {
      const status = await requireScenario().harness.readUserStatus(
        identity.userId,
      );
      const consumedConversation = await readHostedMailboxItemForTest({
        dedupeKey: inboundEventId,
        environment: requireScenario().runtimeEnv,
        userId: identity.userId,
      });
      return {
        activeFence: await readActiveRuntimeFenceForTest(identity.userId),
        conversationConsumed: consumedConversation.consumedAt !== null,
        lastErrorCode: status.lastErrorCode ?? null,
        mailboxCaughtUp: status.mailboxLag.every((lane) => lane.lag === "0"),
        systemHandledThroughSeq:
          status.workspace?.redactedStatus?.hostedMailboxSystemHandledThroughSeq
            ?? null,
        systemImportedSeq:
          status.workspace?.redactedStatus?.hostedMailboxSystemImportedSeq
            ?? null,
      };
    }, {
      interval: 250,
      timeout: 60_000,
    }).toEqual({
      activeFence: conversationFence,
      conversationConsumed: true,
      lastErrorCode: null,
      mailboxCaughtUp: true,
      systemHandledThroughSeq: activationAppend.wake.seq,
      systemImportedSeq: activationAppend.wake.seq,
    });
    await assertExactlyOneAcceptedReplyAfterBoundary({
      identity,
      label: "post-enrollment default owner",
      replyText,
    });

    await expect(readHostedMailboxItemForTest({
      dedupeKey: activationEventId,
      environment: requireScenario().runtimeEnv,
      userId: identity.userId,
    })).resolves.toMatchObject({
      kind: "member.activated",
      lane: "system",
    });
    await expect(readHostedMailboxItemForTest({
      dedupeKey: inboundEventId,
      environment: requireScenario().runtimeEnv,
      userId: identity.userId,
    })).resolves.toMatchObject({
      consumedAt: expect.any(String),
      kind: "conversation.message",
      lane: "conversation",
    });
    await expect(requireScenario().readHostedLinqWorkspaceIsolationState({
      chatId: identity.chatId,
      memberId: identity.userId,
    })).resolves.toMatchObject({
      personal: {
        conversationMailboxCount: 1,
        homeChatBound: true,
        pendingChatBound: false,
        workspaceVersion: expect.any(String),
      },
      thread: null,
    });
    expect(countAssistantProviderInputs(inboundText)).toBe(
      providerRequestBaseline + 1,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, replyMatcher)).toBe(
      replyBaseline + 1,
    );
    await requireScenario().assertHealthyHostedRun(identity.userId);
  }, 600_000);

  it("pages one operator incident through the real cron, database, and Resend boundary", async () => {
    const anomalousTrace = await setLatestHostedLinqReplyLatencyForTest({
      environment: requireScenario().runtimeEnv,
      latencyMs: 31_000,
      userId: retentionProbe.userId,
    });

    requireResendStub().armNextPostAcceptLostAcknowledgment({
      matchRequest: (request) =>
        readObservedResendEmail(request).subject
          === "Hosted runtime reply latency",
    });

    const failed = await requestLatencyAlertCron();
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_RUNTIME_LATENCY_ALERT_SEND_FAILED",
      },
    });
    expect(acceptedResendLatencyAlertRequests()).toHaveLength(1);
    expect(observedLinqLatencyAlertRequests()).toHaveLength(0);

    const failedAttempts = observedResendLatencyAlertRequests();
    expect(failedAttempts).toHaveLength(1);
    const incidentBody = failedAttempts[0]?.body;
    const incidentEmail = readObservedResendEmail(failedAttempts[0]);
    const incidentIdempotencyKey = failedAttempts[0]?.idempotencyKey ?? null;
    expect(incidentBody).toBeTruthy();
    expect(incidentEmail.subject).toBe("Hosted runtime reply latency");
    expect(incidentEmail.text).toContain("Murph reply latency alert.");
    expect(incidentEmail.to).toEqual([latencyAlertEmail]);
    expect(incidentIdempotencyKey).toMatch(
      /^murph\/runtime-latency\/[0-9a-f-]+\/alert$/u,
    );
    const privateAlertFragments = [
      anomalousTrace.traceId,
      latencyAlertEmail,
      runId,
      ...allProbeIdentities.flatMap((identity) => [
        identity.chatId,
        identity.homePhone,
        identity.memberPhone,
        identity.userId,
      ]),
      `evt_priority_inbox_media_retention_${runId}`,
      `msg_priority_inbox_media_retention_${runId}`,
      "Reply while retention-only work is active.",
      "Foreground reply won over retention-only work.",
    ];
    for (const privateFragment of privateAlertFragments) {
      expect(incidentEmail.text).not.toContain(privateFragment);
    }
    expect(failedAttempts.every((request) => request.body === incidentBody)).toBe(true);

    const paced = await requestLatencyAlertCron();
    expect(paced.status).toBe(200);
    await expect(paced.json()).resolves.toMatchObject({
      runtimeLatencyAlert: {
        outcome: "deferred_rate_limit",
      },
    });
    expect(observedResendLatencyAlertRequests()).toHaveLength(1);

    await expect(ageHostedRuntimeLatencyAlertForTest({
      ageMs: 21 * 60_000,
      environment: requireScenario().runtimeEnv,
    })).resolves.toEqual({ updated: true });
    const retried = await requestLatencyAlertCron();
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toMatchObject({
      runtimeLatencyAlert: {
        outcome: "alert_sent",
      },
    });
    const retriedAttempts = observedResendLatencyAlertRequests();
    expect(retriedAttempts).toHaveLength(2);
    expect(retriedAttempts[1]?.body).toBe(incidentBody);
    expect(retriedAttempts[1]?.idempotencyKey).toBe(incidentIdempotencyKey);
    expect(acceptedResendLatencyAlertRequests()).toHaveLength(1);
    expect(observedLinqLatencyAlertRequests()).toHaveLength(0);

    const coalesced = await requestLatencyAlertCron();
    expect(coalesced.status).toBe(200);
    await expect(coalesced.json()).resolves.toMatchObject({
      runtimeLatencyAlert: {
        outcome: "incident_active",
      },
    });
    expect(observedResendLatencyAlertRequests()).toHaveLength(2);

    const normalized = await normalizeHostedLinqLatencyTracesForTest({
      environment: requireScenario().runtimeEnv,
      userIds: allProbeIdentities.map((identity) => identity.userId),
    });
    expect(normalized.updatedCount).toBeGreaterThanOrEqual(
      allProbeIdentities.length,
    );
    const cleared = await requestLatencyAlertCron();
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({
      runtimeLatencyAlert: {
        outcome: "healthy",
      },
    });
    expect(acceptedResendLatencyAlertRequests()).toHaveLength(1);

    await setLatestHostedLinqReplyLatencyForTest({
      environment: requireScenario().runtimeEnv,
      latencyMs: 31_000,
      userId: retentionProbe.userId,
    });
    await expect(ageHostedRuntimeLatencyAlertForTest({
      ageMs: 21 * 60_000,
      environment: requireScenario().runtimeEnv,
    })).resolves.toEqual({ updated: true });
    const recurred = await requestLatencyAlertCron();
    expect(recurred.status).toBe(200);
    await expect(recurred.json()).resolves.toMatchObject({
      runtimeLatencyAlert: {
        outcome: "alert_sent",
      },
    });
    expect(acceptedResendLatencyAlertRequests()).toHaveLength(2);
    const recurrence = observedResendLatencyAlertRequests().at(-1);
    expect(recurrence?.idempotencyKey).not.toBe(incidentIdempotencyKey);
    expect(observedLinqLatencyAlertRequests()).toHaveLength(0);

    await normalizeHostedLinqLatencyTracesForTest({
      environment: requireScenario().runtimeEnv,
      userIds: allProbeIdentities.map((identity) => identity.userId),
    });
    const latencyRecovered = await requestLatencyAlertCron();
    expect(latencyRecovered.status).toBe(200);
    await expect(latencyRecovered.json()).resolves.toMatchObject({
      runtimeLatencyAlert: { outcome: "healthy" },
      runtimeProgressAlert: { outcome: "healthy" },
    });

    const progressWake = await appendHostedExecutionWakeForTest({
      environment: requireScenario().runtimeEnv,
      wake: buildHostedExecutionDeviceSyncWake({
        eventId: `device-sync.wake:progress-alert:${runId}`,
        occurredAt: new Date().toISOString(),
        reason: "webhook_hint",
        userId: retentionProbe.userId,
      }),
    });
    await expect(ageHostedMailboxItemForTest({
      ageMs: 20 * 60_000,
      environment: requireScenario().runtimeEnv,
      mailboxItemId: progressWake.wake.id,
      userId: retentionProbe.userId,
    })).resolves.toEqual({ updated: true });
    requireResendStub().armNextPostAcceptLostAcknowledgment({
      matchRequest: (request) =>
        readObservedResendEmail(request).subject
          === "Hosted runtime progress stalled",
    });

    const progressFailed = await requestLatencyAlertCron();
    expect(progressFailed.status).toBe(502);
    await expect(progressFailed.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_RUNTIME_PROGRESS_ALERT_SEND_FAILED",
      },
    });
    const progressFailedAttempts = observedResendProgressAlertRequests();
    expect(progressFailedAttempts).toHaveLength(1);
    const progressEmail = readObservedResendEmail(progressFailedAttempts[0]);
    const progressBody = progressFailedAttempts[0]?.body;
    const progressIncidentIdempotencyKey =
      progressFailedAttempts[0]?.idempotencyKey ?? null;
    expect(progressEmail).toMatchObject({
      subject: "Hosted runtime progress stalled",
      to: [latencyAlertEmail],
    });
    expect(progressEmail.text).toContain("Murph runtime progress alert.");
    expect(progressIncidentIdempotencyKey).toMatch(
      /^murph\/runtime-progress\/[0-9a-f-]+\/alert$/u,
    );
    for (const privateFragment of privateAlertFragments) {
      expect(progressEmail.text).not.toContain(privateFragment);
    }
    expect(observedLinqProgressAlertRequests()).toHaveLength(0);

    const progressPaced = await requestLatencyAlertCron();
    expect(progressPaced.status).toBe(200);
    await expect(progressPaced.json()).resolves.toMatchObject({
      runtimeLatencyAlert: { outcome: "healthy" },
      runtimeProgressAlert: { outcome: "deferred_rate_limit" },
    });
    expect(observedResendProgressAlertRequests()).toHaveLength(1);

    await expect(ageHostedRuntimeProgressAlertForTest({
      ageMs: 21 * 60_000,
      environment: requireScenario().runtimeEnv,
    })).resolves.toEqual({ updated: true });
    const progressRetried = await requestLatencyAlertCron();
    expect(progressRetried.status).toBe(200);
    await expect(progressRetried.json()).resolves.toMatchObject({
      runtimeLatencyAlert: { outcome: "healthy" },
      runtimeProgressAlert: { outcome: "alert_sent" },
    });
    const progressRetriedAttempts = observedResendProgressAlertRequests();
    expect(progressRetriedAttempts).toHaveLength(2);
    expect(progressRetriedAttempts[1]?.body).toBe(progressBody);
    expect(progressRetriedAttempts[1]?.idempotencyKey)
      .toBe(progressIncidentIdempotencyKey);
    expect(acceptedResendProgressAlertRequests()).toHaveLength(1);

    const progressCoalesced = await requestLatencyAlertCron();
    expect(progressCoalesced.status).toBe(200);
    await expect(progressCoalesced.json()).resolves.toMatchObject({
      runtimeProgressAlert: { outcome: "incident_active" },
    });
    expect(observedResendProgressAlertRequests()).toHaveLength(2);

    await expect(advanceHostedMailboxConsumedSeqForTest({
      environment: requireScenario().runtimeEnv,
      lane: "system",
      seq: progressWake.wake.seq,
      userId: retentionProbe.userId,
    })).resolves.toEqual({ consumedSeq: progressWake.wake.seq });
    const progressRecovered = await requestLatencyAlertCron();
    expect(progressRecovered.status).toBe(200);
    await expect(progressRecovered.json()).resolves.toMatchObject({
      runtimeLatencyAlert: { outcome: "healthy" },
      runtimeProgressAlert: { outcome: "healthy" },
    });

    const recurrenceWake = await appendHostedExecutionWakeForTest({
      environment: requireScenario().runtimeEnv,
      wake: buildHostedExecutionDeviceSyncWake({
        eventId: `device-sync.wake:progress-alert-recurrence:${runId}`,
        occurredAt: new Date().toISOString(),
        reason: "webhook_hint",
        userId: retentionProbe.userId,
      }),
    });
    await expect(ageHostedMailboxItemForTest({
      ageMs: 20 * 60_000,
      environment: requireScenario().runtimeEnv,
      mailboxItemId: recurrenceWake.wake.id,
      userId: retentionProbe.userId,
    })).resolves.toEqual({ updated: true });
    await expect(ageHostedRuntimeProgressAlertForTest({
      ageMs: 21 * 60_000,
      environment: requireScenario().runtimeEnv,
    })).resolves.toEqual({ updated: true });
    const progressRecurred = await requestLatencyAlertCron();
    expect(progressRecurred.status).toBe(200);
    await expect(progressRecurred.json()).resolves.toMatchObject({
      runtimeLatencyAlert: { outcome: "healthy" },
      runtimeProgressAlert: { outcome: "alert_sent" },
    });
    expect(acceptedResendProgressAlertRequests()).toHaveLength(2);
    const progressRecurrence = observedResendProgressAlertRequests().at(-1);
    expect(progressRecurrence?.idempotencyKey)
      .not.toBe(progressIncidentIdempotencyKey);
    expect(observedLinqProgressAlertRequests()).toHaveLength(0);
  }, 240_000);
});

// The idle checkpoint delay is process-wide. The scenario registry runs this
// suite in its own Vitest process so the production-floor latency proofs above
// remain unchanged while this race reaches a real idle snapshot deterministically.
describe.sequential("hosted local foreground checkpoint ordering e2e", () => {
  beforeAll(async () => {
    orderingLinqStub = await startHostedLocalLinqStub();
    orderingScenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS:
          String(orderingIdleCheckpointDelayMs),
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          orderingProbeIdentities.map((identity) => identity.memberPhone).join(","),
        LINQ_API_BASE_URL: requireOrderingLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: "linq-local-ordering-token",
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-ordering-openai-key",
      },
      assistantProviderStubModelId: productionLikeAssistantModel,
      faultInjection: true,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-foreground-ordering-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted foreground checkpoint ordering e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });
  }, 600_000);

  afterAll(async () => {
    await orderingScenario?.stop();
    orderingScenario = null;
    await orderingLinqStub?.stop();
    orderingLinqStub = null;
  }, 120_000);

  it("imports later durable input before retrying an interrupted idle snapshot", async () => {
    await proveInterruptedSnapshotForegroundOrdering({
      identity: interruptedSnapshotOrderingProbe,
      linqStub: requireOrderingLinqStub(),
      scenario: requireOrderingScenario(),
    });
  }, 240_000);

  it("continues with durable foreground input after a committed canonical publication", async () => {
    await proveCanonicalPublicationForegroundOrdering({
      identity: canonicalPublicationOrderingProbe,
      linqStub: requireOrderingLinqStub(),
      scenario: requireOrderingScenario(),
    });
  }, 180_000);
});

function buildDaytimeTestTimeZone(now: Date): string {
  const unwrappedOffsetHours = 12 - now.getUTCHours();
  const offsetHours = unwrappedOffsetHours > 11
    ? unwrappedOffsetHours - 24
    : unwrappedOffsetHours;
  if (offsetHours === 0) {
    return "UTC";
  }
  return offsetHours > 0
    ? `Etc/GMT-${offsetHours}`
    : `Etc/GMT+${Math.abs(offsetHours)}`;
}

async function seedProbe(identity: ProbeIdentity): Promise<void> {
  await seedProbeInScenario(requireScenario(), identity);
}

async function seedProbeInScenario(
  targetScenario: HostedLocalFullStackScenario,
  identity: ProbeIdentity,
): Promise<void> {
  await targetScenario.seedActiveHostedLinqMember({
    homePhone: identity.homePhone,
    memberId: identity.userId,
    memberPhone: identity.memberPhone,
  });
  await targetScenario.bindActiveHostedLinqHomeChat({
    chatId: identity.chatId,
    memberId: identity.userId,
    recipientPhone: identity.memberPhone,
  });
  await seedActivatedWorkspaceCheckpointInScenario(
    targetScenario,
    identity.userId,
  );
}

async function proveInterruptedSnapshotForegroundOrdering(input: {
  identity: ProbeIdentity;
  linqStub: HostedLocalLinqStub;
  scenario: HostedLocalFullStackScenario;
}): Promise<void> {
  const { identity, linqStub: targetLinqStub, scenario: targetScenario } = input;
  await seedProbeInScenario(targetScenario, identity);
  await armForegroundPriorityOrderingObservation({
    mode: "empty-probe",
    scenario: targetScenario,
    userId: identity.userId,
  });
  let checkpointBarrierArmed = false;

  try {
    await targetScenario.harness.armIdleSnapshotStartBarrierForTest(
      identity.userId,
    );
    checkpointBarrierArmed = true;

    const warmupText = "Prepare one synthetic foreground turn for the idle checkpoint race.";
    const warmupReply = "Synthetic checkpoint ordering state prepared.";
    targetScenario.queueAssistantResponses(
      [{
        beforeResponse: async () => {
          await targetScenario.harness
            .recordForegroundPriorityAssistantProviderStartForTest(identity.userId);
        },
        text: warmupReply,
      }],
      { matchInputContains: warmupText },
    );
    const warmupResponse = await postSignedLinqWebhookForScenario(
      targetScenario,
      buildHostedLinqInboundEvent(identity.userId, identity.chatId, {
        eventId: `evt_priority_ordering_warmup_${runId}`,
        messageId: `msg_priority_ordering_warmup_${runId}`,
        text: warmupText,
      }),
    );
    expect(warmupResponse.status).toBe(202);
    await expect(warmupResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    const warmupProviderStart = await waitForForegroundPriorityOrderingEvent({
      kind: "assistant_provider_started",
      label: "warmup provider start before idle snapshot",
      scenario: targetScenario,
      userId: identity.userId,
    });
    await waitForAssistantProviderInputInScenario({
      expectedText: warmupText,
      scenario: targetScenario,
      userId: identity.userId,
    });

    await waitForCheckpointBarrierInScenario(targetScenario, identity.userId);
    const snapshotStarted = await waitForForegroundPriorityOrderingEvent({
      afterOrdinal: warmupProviderStart.ordinal,
      kind: "snapshot_started",
      label: "interruptible idle snapshot start",
      scenario: targetScenario,
      userId: identity.userId,
    });

    const runtimeWakeStateBefore = await readRuntimeWakeObservation({
      scenario: targetScenario,
      userId: identity.userId,
    });
    await signalHostedRuntimeWakeRuntimeForTest({
      environment: targetScenario.runtimeEnv,
      userId: identity.userId,
    });
    await waitForRuntimeWakeExecution({
      previous: runtimeWakeStateBefore,
      scenario: targetScenario,
      userId: identity.userId,
    });
    await expect(
      targetScenario.harness.readShutdownCheckpointPublicationBarrierForTest(
        identity.userId,
      ),
    ).resolves.toEqual({ state: "entered" });

    await expect(
      targetScenario.harness.releaseShutdownCheckpointPublicationBarrierForTest(
        identity.userId,
      ),
    ).resolves.toEqual({ ok: true, released: true });
    checkpointBarrierArmed = false;

    const heldEmptyProbe = await waitForForegroundPriorityOrderingObservation({
      label: "post-interruption empty foreground mailbox probe",
      predicate: (observation) =>
        observation.barrierState === "entered"
        && observation.barrierTarget === "empty_conversation_probe"
        && foregroundPriorityOrderingEventsOfKind(
          observation,
          "mailbox_fetch_finished",
        ).some((event) =>
          event.ordinal > snapshotStarted.ordinal
          && event.responseStatus === 200
          && event.conversationLaneRequested === true
          && event.probeKind === "checkpoint_interrupt_rearm"
          && event.conversationItemCount === 0
        ),
      scenario: targetScenario,
      userId: identity.userId,
    });
    const emptyForegroundProbe = foregroundPriorityOrderingEventsOfKind(
      heldEmptyProbe,
      "mailbox_fetch_finished",
    ).find((event) =>
      event.ordinal > snapshotStarted.ordinal
      && event.responseStatus === 200
      && event.conversationLaneRequested === true
      && event.probeKind === "checkpoint_interrupt_rearm"
      && event.conversationItemCount === 0
    );
    if (!emptyForegroundProbe) {
      throw new Error("The held foreground mailbox probe lost its typed event.");
    }
    assertForegroundPriorityOrderingObservationHealthy(heldEmptyProbe);
    assertNoBackgroundCheckpointEventBetween({
      afterOrdinal: snapshotStarted.ordinal,
      beforeOrdinal: emptyForegroundProbe.ordinal + 1,
      label: "immediate empty foreground probe",
      observation: heldEmptyProbe,
    });

    const laterText = "Process the synthetic conversation persisted after the empty probe.";
    const laterReply = "The later synthetic conversation ran before checkpoint retry.";
    const laterEventId = `evt_priority_ordering_later_${runId}`;
    const laterReplyPath = replyPathFor(identity);
    const laterMatcher = matchLinqMessageText(laterReply, targetLinqStub);
    const laterReplyBaseline = targetLinqStub.countAcceptedSends(
      laterReplyPath,
      laterMatcher,
    );
    targetScenario.queueAssistantResponses(
      [{
        beforeResponse: async () => {
          await targetScenario.harness
            .recordForegroundPriorityAssistantProviderStartForTest(identity.userId);
        },
        text: laterReply,
      }],
      { matchInputContains: laterText },
    );
    const laterResponse = await postSignedLinqWebhookForScenario(
      targetScenario,
      buildHostedLinqInboundEvent(identity.userId, identity.chatId, {
        eventId: laterEventId,
        messageId: `msg_priority_ordering_later_${runId}`,
        text: laterText,
      }),
    );
    expect(laterResponse.status).toBe(202);
    await expect(laterResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    const laterMailboxItem = await readHostedMailboxItemForTest({
      dedupeKey: laterEventId,
      environment: targetScenario.runtimeEnv,
      userId: identity.userId,
    });
    expect(laterMailboxItem).toMatchObject({
      dedupeKey: laterEventId,
      kind: "conversation.message",
      lane: "conversation",
    });
    if (!laterMailboxItem) {
      throw new Error("The later foreground webhook did not persist its mailbox row.");
    }
    await expect(readForegroundPriorityOrderingObservation(
      targetScenario,
      identity.userId,
    )).resolves.toMatchObject({
      barrierState: "entered",
      barrierTarget: "empty_conversation_probe",
    });

    await expect(releaseForegroundPriorityOrderingBarrier({
      scenario: targetScenario,
      userId: identity.userId,
    })).resolves.toEqual({ ok: true, released: true });

    const laterMailboxImport = await waitForForegroundPriorityOrderingEvent({
      afterOrdinal: emptyForegroundProbe.ordinal,
      kind: "mailbox_fetch_finished",
      label: "later durable conversation mailbox import",
      predicate: (event) =>
        event.responseStatus === 200
        && event.conversationLaneRequested === true
        && (event.conversationItemCount ?? 0) > 0
        && hostedOrderingSeqAtLeast(
          event.conversationSeqEnd,
          laterMailboxItem.laneSeq,
        ),
      scenario: targetScenario,
      userId: identity.userId,
    });
    const laterProviderStart = await waitForForegroundPriorityOrderingEvent({
      afterOrdinal: laterMailboxImport.ordinal,
      kind: "assistant_provider_started",
      label: "provider start for later durable conversation",
      scenario: targetScenario,
      userId: identity.userId,
    });
    const finalObservation = await readForegroundPriorityOrderingObservation(
      targetScenario,
      identity.userId,
    );
    assertForegroundPriorityOrderingObservationHealthy(finalObservation);
    assertNoBackgroundCheckpointEventBetween({
      afterOrdinal: emptyForegroundProbe.ordinal,
      beforeOrdinal: laterProviderStart.ordinal,
      label: "interrupted idle snapshot retry",
      observation: finalObservation,
    });

    await Promise.all([
      waitForAssistantProviderInputInScenario({
        expectedText: laterText,
        scenario: targetScenario,
        userId: identity.userId,
      }),
      waitForAcceptedReplyInScenario({
        baselineCount: laterReplyBaseline,
        identity,
        label: "interrupted snapshot ordering",
        linqStub: targetLinqStub,
        matcher: laterMatcher,
        replyPath: laterReplyPath,
        scenario: targetScenario,
      }),
    ]);
  } finally {
    if (checkpointBarrierArmed) {
      await targetScenario.harness
        .releaseShutdownCheckpointPublicationBarrierForTest(identity.userId)
        .catch(() => undefined);
    }
    await releaseForegroundPriorityOrderingBarrier({
      scenario: targetScenario,
      userId: identity.userId,
    }).catch(() => undefined);
    await clearForegroundPriorityOrderingObservation(
      targetScenario,
      identity.userId,
    ).catch(() => undefined);
  }
}

async function proveCanonicalPublicationForegroundOrdering(input: {
  identity: ProbeIdentity;
  linqStub: HostedLocalLinqStub;
  scenario: HostedLocalFullStackScenario;
}): Promise<void> {
  const { identity, linqStub: targetLinqStub, scenario: targetScenario } = input;
  await seedProbeInScenario(targetScenario, identity);
  await armForegroundPriorityOrderingObservation({
    mode: "canonical",
    scenario: targetScenario,
    userId: identity.userId,
  });

  try {
    const preferencesWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: `member.preferences.updated:ordering:${runId}`,
      memberId: identity.userId,
      occurredAt: new Date().toISOString(),
      preferences: {
        personality: { detail: 6 },
        tone: "casual",
      },
    });
    const appended = await appendHostedExecutionWakeForTest({
      environment: targetScenario.runtimeEnv,
      wake: preferencesWake,
    });
    expect(appended.inserted).toBe(true);
    await signalHostedMailboxAppendRuntimeForTest({
      environment: targetScenario.runtimeEnv,
      expectedUserId: identity.userId,
      mailboxItemId: appended.wake.id,
    });

    const heldObservation = await waitForForegroundPriorityOrderingObservation({
      label: "canonical checkpoint post-commit boundary",
      predicate: (observation) =>
        observation.barrierState === "entered"
        && observation.barrierTarget === "canonical_post_commit",
      scenario: targetScenario,
      userId: identity.userId,
    });
    const canonicalCommit = foregroundPriorityOrderingEventsOfKind(
      heldObservation,
      "canonical_checkpoint_committed",
    ).at(-1);
    if (!canonicalCommit) {
      throw new Error("Canonical ordering barrier entered without a committed checkpoint event.");
    }

    const laterText = "Continue with the synthetic conversation after canonical publication.";
    const laterReply = "Canonical publication finished before the foreground continuation.";
    const laterEventId = `evt_priority_canonical_later_${runId}`;
    const laterReplyPath = replyPathFor(identity);
    const laterMatcher = matchLinqMessageText(laterReply, targetLinqStub);
    const laterReplyBaseline = targetLinqStub.countAcceptedSends(
      laterReplyPath,
      laterMatcher,
    );
    targetScenario.queueAssistantResponses(
      [{
        beforeResponse: async () => {
          await targetScenario.harness
            .recordForegroundPriorityAssistantProviderStartForTest(identity.userId);
        },
        text: laterReply,
      }],
      { matchInputContains: laterText },
    );
    const laterResponse = await postSignedLinqWebhookForScenario(
      targetScenario,
      buildHostedLinqInboundEvent(identity.userId, identity.chatId, {
        eventId: laterEventId,
        messageId: `msg_priority_canonical_later_${runId}`,
        text: laterText,
      }),
    );
    expect(laterResponse.status).toBe(202);
    await expect(laterResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    const laterMailboxItem = await readHostedMailboxItemForTest({
      dedupeKey: laterEventId,
      environment: targetScenario.runtimeEnv,
      userId: identity.userId,
    });
    expect(laterMailboxItem).toMatchObject({
      dedupeKey: laterEventId,
      kind: "conversation.message",
      lane: "conversation",
    });
    if (!laterMailboxItem) {
      throw new Error("Canonical continuation webhook did not persist its mailbox row.");
    }
    await expect(readForegroundPriorityOrderingObservation(
      targetScenario,
      identity.userId,
    )).resolves.toMatchObject({
      barrierState: "entered",
      barrierTarget: "canonical_post_commit",
    });

    await expect(releaseForegroundPriorityOrderingBarrier({
      scenario: targetScenario,
      userId: identity.userId,
    })).resolves.toEqual({ ok: true, released: true });

    const laterMailboxImport = await waitForForegroundPriorityOrderingEvent({
      afterOrdinal: canonicalCommit.ordinal,
      kind: "mailbox_fetch_finished",
      label: "canonical continuation mailbox import",
      predicate: (event) =>
        event.responseStatus === 200
        && event.conversationLaneRequested === true
        && (event.conversationItemCount ?? 0) > 0
        && hostedOrderingSeqAtLeast(
          event.conversationSeqEnd,
          laterMailboxItem.laneSeq,
        ),
      scenario: targetScenario,
      userId: identity.userId,
    });
    const laterProviderStart = await waitForForegroundPriorityOrderingEvent({
      afterOrdinal: laterMailboxImport.ordinal,
      kind: "assistant_provider_started",
      label: "canonical continuation provider start",
      scenario: targetScenario,
      userId: identity.userId,
    });
    const finalObservation = await readForegroundPriorityOrderingObservation(
      targetScenario,
      identity.userId,
    );
    assertForegroundPriorityOrderingObservationHealthy(finalObservation);
    assertNoBackgroundCheckpointEventBetween({
      afterOrdinal: canonicalCommit.ordinal,
      beforeOrdinal: laterProviderStart.ordinal,
      label: "canonical publication continuation",
      observation: finalObservation,
    });

    await Promise.all([
      waitForAssistantProviderInputInScenario({
        expectedText: laterText,
        scenario: targetScenario,
        userId: identity.userId,
      }),
      waitForAcceptedReplyInScenario({
        baselineCount: laterReplyBaseline,
        identity,
        label: "canonical publication ordering",
        linqStub: targetLinqStub,
        matcher: laterMatcher,
        replyPath: laterReplyPath,
        scenario: targetScenario,
      }),
    ]);
  } finally {
    await releaseForegroundPriorityOrderingBarrier({
      scenario: targetScenario,
      userId: identity.userId,
    }).catch(() => undefined);
    await clearForegroundPriorityOrderingObservation(
      targetScenario,
      identity.userId,
    ).catch(() => undefined);
  }
}

async function armForegroundPriorityOrderingObservation(input: {
  mode: "canonical" | "empty-probe";
  scenario: HostedLocalFullStackScenario;
  userId: string;
}): Promise<void> {
  await expect(
    input.scenario.harness.armForegroundPriorityOrderingObservationForTest(
      input.userId,
      input.mode === "canonical"
        ? "canonical_post_commit"
        : "empty_conversation_probe",
    ),
  ).resolves.toEqual({ ok: true });
}

async function readForegroundPriorityOrderingObservation(
  targetScenario: HostedLocalFullStackScenario,
  userId: string,
): Promise<HostedLocalForegroundPriorityOrderingObservationState> {
  return await targetScenario.harness
    .readForegroundPriorityOrderingObservationForTest(userId);
}

async function releaseForegroundPriorityOrderingBarrier(input: {
  scenario: HostedLocalFullStackScenario;
  userId: string;
}): Promise<{ ok: true; released: boolean }> {
  return await input.scenario.harness
    .releaseForegroundPriorityOrderingBarrierForTest(input.userId);
}

async function clearForegroundPriorityOrderingObservation(
  targetScenario: HostedLocalFullStackScenario,
  userId: string,
): Promise<{ cleared: boolean; ok: true }> {
  return await targetScenario.harness
    .clearForegroundPriorityOrderingObservationForTest(userId);
}

function foregroundPriorityOrderingEventsOfKind<
  Kind extends ForegroundPriorityOrderingEventKind,
>(
  observation: HostedLocalForegroundPriorityOrderingObservationState,
  kind: Kind,
): Array<ForegroundPriorityOrderingEventOfKind<Kind>> {
  return observation.events.filter(
    (event): event is ForegroundPriorityOrderingEventOfKind<Kind> =>
      event.kind === kind,
  );
}

function assertForegroundPriorityOrderingObservationHealthy(
  observation: HostedLocalForegroundPriorityOrderingObservationState,
): void {
  expect(observation.state).toBe("armed");
  expect(
    observation.truncated,
    "Foreground-priority ordering evidence was truncated at its bounded test limit.",
  ).toBe(false);
}

function assertNoBackgroundCheckpointEventBetween(input: {
  afterOrdinal: number;
  beforeOrdinal: number;
  label: string;
  observation: HostedLocalForegroundPriorityOrderingObservationState;
}): void {
  const conflictingEvent = input.observation.events.find((event) =>
    (
      event.kind === "snapshot_started"
      || (
        event.kind === "workspace_checkpoint_started"
        && event.reason === "idle_shutdown"
      )
    )
    && event.ordinal > input.afterOrdinal
    && event.ordinal < input.beforeOrdinal
  );
  expect(
    conflictingEvent,
    `${input.label} let a background idle checkpoint overtake foreground work.`,
  ).toBeUndefined();
}

async function waitForForegroundPriorityOrderingObservation(input: {
  label: string;
  predicate: (
    observation: HostedLocalForegroundPriorityOrderingObservationState,
  ) => boolean;
  scenario: HostedLocalFullStackScenario;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedLocalForegroundPriorityOrderingObservationState> {
  const deadlineAt = Date.now() + (input.timeoutMs ?? 90_000);
  let lastObservation = await readForegroundPriorityOrderingObservation(
    input.scenario,
    input.userId,
  );

  while (Date.now() < deadlineAt) {
    lastObservation = await readForegroundPriorityOrderingObservation(
      input.scenario,
      input.userId,
    );
    if (lastObservation.truncated) {
      throw new Error(await input.scenario.buildFailureMessage(input.userId, [
        `Foreground-priority ordering trace was truncated while waiting for ${input.label}.`,
        `last observation: ${JSON.stringify(lastObservation)}`,
      ]));
    }
    if (lastObservation.state === "armed" && input.predicate(lastObservation)) {
      return lastObservation;
    }
    await sleep(100);
  }

  throw new Error(await input.scenario.buildFailureMessage(input.userId, [
    `Timed out waiting for ${input.label}.`,
    `last observation: ${JSON.stringify(lastObservation)}`,
  ]));
}

async function waitForForegroundPriorityOrderingEvent<
  Kind extends ForegroundPriorityOrderingEventKind,
>(input: {
  afterOrdinal?: number;
  kind: Kind;
  label: string;
  predicate?: (event: ForegroundPriorityOrderingEventOfKind<Kind>) => boolean;
  scenario: HostedLocalFullStackScenario;
  timeoutMs?: number;
  userId: string;
}): Promise<ForegroundPriorityOrderingEventOfKind<Kind>> {
  let matchedEvent: ForegroundPriorityOrderingEventOfKind<Kind> | null = null;
  await waitForForegroundPriorityOrderingObservation({
    label: input.label,
    predicate: (observation) => {
      matchedEvent = foregroundPriorityOrderingEventsOfKind(
        observation,
        input.kind,
      ).find((event) =>
        event.ordinal > (input.afterOrdinal ?? 0)
        && (input.predicate?.(event) ?? true)
      ) ?? null;
      return matchedEvent !== null;
    },
    scenario: input.scenario,
    timeoutMs: input.timeoutMs,
    userId: input.userId,
  });
  if (!matchedEvent) {
    throw new Error(`Foreground-priority ordering event ${input.kind} disappeared.`);
  }
  return matchedEvent;
}

async function waitForCheckpointBarrierInScenario(
  targetScenario: HostedLocalFullStackScenario,
  userId: string,
): Promise<void> {
  const deadlineAt = Date.now() + 90_000;
  let lastStatus = await targetScenario.harness.readUserStatus(userId);

  while (Date.now() < deadlineAt) {
    const barrier =
      await targetScenario.harness.readShutdownCheckpointPublicationBarrierForTest(
        userId,
      );
    if (barrier.state === "entered") {
      return;
    }
    lastStatus = await targetScenario.harness.readUserStatus(userId);
    await sleep(250);
  }

  throw new Error(await targetScenario.buildFailureMessage(userId, [
    "Timed out waiting for checkpoint publication to enter the test barrier.",
    `last status: ${JSON.stringify(lastStatus)}`,
  ]));
}

async function waitForAssistantProviderInputInScenario(input: {
  expectedText: string;
  scenario: HostedLocalFullStackScenario;
  timeoutMs?: number;
  userId: string;
}): Promise<void> {
  const deadlineAt = Date.now() + (input.timeoutMs ?? 60_000);
  while (Date.now() < deadlineAt) {
    if (
      input.scenario.assistantProviderRequests.some((request) =>
        request.url === "/v1/responses"
        && request.body.includes(input.expectedText)
      )
    ) {
      return;
    }
    await sleep(100);
  }

  throw new Error(await input.scenario.buildFailureMessage(input.userId, [
    "Timed out waiting for the assistant provider transport to include ordered foreground input.",
  ]));
}

interface RuntimeWakeObservation {
  lastExecutionAt: string | null;
  signalVersion: number;
}

async function readRuntimeWakeObservation(input: {
  scenario: HostedLocalFullStackScenario;
  userId: string;
}): Promise<RuntimeWakeObservation> {
  const value = await queryHostedRuntimeWorkflowForTest({
    environment: input.scenario.runtimeEnv,
    queryName: HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
    workflowId: `hosted-user-runtime:${input.userId}`,
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime workflow query returned an invalid state.");
  }
  const lastExecutionAt: unknown = Reflect.get(value, "lastExecutionAt");
  const signalVersion: unknown = Reflect.get(value, "signalVersion");
  if (
    (lastExecutionAt !== null && typeof lastExecutionAt !== "string")
    || typeof signalVersion !== "number"
    || !Number.isSafeInteger(signalVersion)
    || signalVersion < 0
  ) {
    throw new TypeError("Hosted runtime workflow query returned an invalid state.");
  }
  return { lastExecutionAt, signalVersion };
}

async function waitForRuntimeWakeExecution(input: {
  previous: RuntimeWakeObservation;
  scenario: HostedLocalFullStackScenario;
  userId: string;
}): Promise<void> {
  const deadlineAt = Date.now() + 30_000;
  let latest = input.previous;
  while (Date.now() < deadlineAt) {
    latest = await readRuntimeWakeObservation(input);
    if (
      latest.signalVersion > input.previous.signalVersion
      && latest.lastExecutionAt !== input.previous.lastExecutionAt
    ) {
      return;
    }
    await sleep(250);
  }
  throw new Error(await input.scenario.buildFailureMessage(input.userId, [
    "Timed out waiting for the active-runtime wake to reach Cloudflare.",
    `last Temporal state: ${JSON.stringify(latest)}`,
  ]));
}

async function waitForAcceptedReplyInScenario(input: {
  baselineCount: number;
  identity: ProbeIdentity;
  label: string;
  linqStub: HostedLocalLinqStub;
  matcher: ObservedLinqRequestMatcher;
  replyPath: string;
  scenario: HostedLocalFullStackScenario;
  timeoutMs?: number;
}): Promise<ObservedLinqRequest> {
  const deadlineAt = Date.now() + (input.timeoutMs ?? 60_000);
  while (Date.now() < deadlineAt) {
    const matching = input.linqStub.acceptedSendRequests.filter((request) =>
      request.method === "POST"
      && request.url === input.replyPath
      && input.matcher(request)
    );
    if (matching.length > input.baselineCount) {
      expect(
        matching.length,
        `${input.label} emitted more than one newly accepted Linq reply.`,
      ).toBe(input.baselineCount + 1);
      return matching.at(-1)!;
    }
    await sleep(100);
  }

  throw new Error(await input.scenario.buildFailureMessage(input.identity.userId, [
    `Timed out waiting for accepted Linq delivery in ${input.label}.`,
    `accepted reply count: ${
      input.linqStub.countAcceptedSends(input.replyPath, input.matcher)
    }`,
  ]));
}

function hostedOrderingSeqAtLeast(
  value: string | null | undefined,
  floor: string,
): boolean {
  if (
    typeof value !== "string"
    || !/^(?:0|[1-9][0-9]*)$/u.test(value)
    || !/^(?:0|[1-9][0-9]*)$/u.test(floor)
  ) {
    return false;
  }
  return BigInt(value) >= BigInt(floor);
}

async function sendInboundAndRequirePromptReply(input: {
  afterAccepted?: () => Promise<void>;
  identity: ProbeIdentity;
  inboundText: string;
  label: string;
  replyText: string;
}): Promise<number> {
  const replyPath = replyPathFor(input.identity);
  const replyMatcher = matchLinqMessageText(input.replyText);
  const baselineReplyCount = requireLinqStub().countAcceptedSends(
    replyPath,
    replyMatcher,
  );
  requireScenario().queueAssistantResponses(
    [input.replyText],
    { matchInputContains: input.inboundText },
  );

  const startedAt = performance.now();
  const deadlineAt = Date.now() + promptReplyDeadlineMs;
  const response = await postSignedLinqWebhook(
    buildHostedLinqInboundEvent(input.identity.userId, input.identity.chatId, {
      eventId: `evt_priority_${input.label.replaceAll(" ", "_")}_${runId}`,
      messageId: `msg_priority_${input.label.replaceAll(" ", "_")}_${runId}`,
      text: input.inboundText,
    }),
  );
  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    reason: "wake-appended-active-member",
  });
  await input.afterAccepted?.();

  await waitForAcceptedReplyBeforeDeadline({
    baselineCount: baselineReplyCount,
    identity: input.identity,
    label: input.label,
    matcher: replyMatcher,
    replyPath,
    deadlineAt,
  });
  const latencyMs = performance.now() - startedAt;
  expect(latencyMs).toBeLessThan(promptReplyDeadlineMs);
  expect(requireLinqStub().countAcceptedSends(replyPath, replyMatcher)).toBe(
    baselineReplyCount + 1,
  );

  return latencyMs;
}

async function assertExactlyOneAcceptedReplyAfterBoundary(input: {
  identity: ProbeIdentity;
  label: string;
  observationMs?: number;
  replyText: string;
}): Promise<void> {
  const replyPath = replyPathFor(input.identity);
  const replyMatcher = matchLinqMessageText(input.replyText);
  const startedAt = Date.now();
  while (
    Date.now() - startedAt
      < (input.observationMs ?? duplicateReplyObservationMs)
  ) {
    expect(
      requireLinqStub().countAcceptedSends(replyPath, replyMatcher),
      `${input.label} emitted a duplicate accepted Linq reply after its terminal boundary.`,
    ).toBe(1);
    await sleep(250);
  }
}

async function warmHostedRunnerForStaleFence(
  identity: ProbeIdentity,
): Promise<void> {
  await sendInboundAndRequirePromptReply({
    identity,
    inboundText: "Warm the runtime before the stale-owner probe.",
    label: "stale invocation warmup",
    replyText: "Runtime warmed for the stale-owner probe.",
  });
  await requireScenario().harness.beginShutdownCheckpointGracefulStopForTest(
    identity.userId,
  );
  const status = await requireScenario().harness.waitForHostedCompletion(
    identity.userId,
    { timeoutMs: 45_000 },
  );
  expect(status.inFlight).toBe(false);
  expect(status.lastErrorCode ?? null).toBeNull();
  expect(status.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
}

async function waitForAcceptedReplyBeforeDeadline(input: {
  baselineCount: number;
  identity: ProbeIdentity;
  label: string;
  matcher: ObservedLinqRequestMatcher;
  replyPath: string;
  deadlineAt: number;
}): Promise<ObservedLinqRequest> {
  while (Date.now() < input.deadlineAt) {
    const matching = requireLinqStub().acceptedSendRequests.filter((request) =>
      request.method === "POST"
      && request.url === input.replyPath
      && input.matcher(request)
    );
    if (matching.length > input.baselineCount) {
      return matching.at(-1)!;
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.identity.userId, [
    `Foreground reply missed the ${promptReplyDeadlineMs}ms ${input.label} deadline.`,
    `accepted reply count: ${
      requireLinqStub().countAcceptedSends(input.replyPath, input.matcher)
    }`,
  ]));
}

async function armCheckpointPublicationBarrier(
  userId: string,
  kind: "canonical" | "shutdown",
): Promise<void> {
  await requireScenario().harness.requestJson(
    `/__test/users/${encodeURIComponent(userId)}`
      + "/shutdown-checkpoint-publication-barrier"
      + `?action=${kind === "canonical" ? "arm-canonical" : "arm"}`,
    {
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      },
      method: "POST",
    },
  );
}

async function waitForBackgroundCheckpointBarrier(userId: string): Promise<void> {
  const deadlineAt = Date.now() + 90_000;
  let lastStatus = await requireScenario().harness.readUserStatus(userId);

  while (Date.now() < deadlineAt) {
    const barrier =
      await requireScenario().harness.readShutdownCheckpointPublicationBarrierForTest(
        userId,
      );
    if (barrier.state === "entered") {
      return;
    }

    lastStatus = await requireScenario().harness.readUserStatus(userId);
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out staging a real background-owned checkpoint publication.",
    `last status in flight: ${String(lastStatus.inFlight)}`,
  ]));
}

async function holdBackgroundCheckpointPublication(userId: string): Promise<{
  completion: Promise<{ ok: true }>;
}> {
  const completion =
    requireScenario().harness.beginShutdownCheckpointGracefulStopForTest(userId);
  try {
    await waitForBackgroundCheckpointBarrier(userId);
    return { completion };
  } catch (error) {
    await requireScenario().harness
      .releaseShutdownCheckpointPublicationBarrierForTest(userId);
    await completion.catch(() => undefined);
    throw error;
  }
}

async function expectBackgroundCheckpointBarrierHeld(userId: string): Promise<void> {
  await expect(
    requireScenario().harness.readShutdownCheckpointPublicationBarrierForTest(
      userId,
    ),
  ).resolves.toEqual({ state: "entered" });
}

async function releaseBackgroundCheckpointBarrier(userId: string): Promise<void> {
  await expect(
    requireScenario().harness.releaseShutdownCheckpointPublicationBarrierForTest(
      userId,
    ),
  ).resolves.toEqual({
    ok: true,
    released: true,
  });
}

async function waitForSystemWakeStormCheckpointBarrier(
  userId: string,
  expectedImportedSeq: string,
  expectedFetchedCount: number,
): Promise<{ attemptId: string }> {
  const deadlineAt = Date.now() + 60_000;
  let lastStatus = await requireScenario().harness.readUserStatus(userId);

  while (Date.now() < deadlineAt) {
    lastStatus = await requireScenario().harness.readUserStatus(userId);
    const barrier =
      await requireScenario().harness.readShutdownCheckpointPublicationBarrierForTest(
        userId,
      );
    const importLog = lastStatus.recentLogs?.find((log) =>
      log.eventCode === "mailbox.imported"
      && log.redactedJson?.systemSeqEnd === expectedImportedSeq
      && log.redactedJson.fetchedCount === expectedFetchedCount
      && log.redactedJson.retryableBlockedCount === 0
    );
    const fence = await readActiveRuntimeFenceForTest(userId);
    if (
      lastStatus.inFlight
      && barrier.state === "entered"
      && importLog
      && fence?.processingMode === "system_mailbox"
    ) {
      return { attemptId: fence.attemptId };
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "The complete system wake storm did not reach held canonical publication.",
    `expected imported sequence: ${expectedImportedSeq}`,
    `expected fetched count: ${expectedFetchedCount}`,
    `last status: ${JSON.stringify(lastStatus)}`,
  ]));
}

async function waitForForegroundReplacementWhileBarrierHeld(
  userId: string,
  systemAttemptId: string,
): Promise<void> {
  const deadlineAt = Date.now() + 15_000;
  let lastFence = await readActiveRuntimeFenceForTest(userId);

  while (Date.now() < deadlineAt) {
    const barrier =
      await requireScenario().harness.readShutdownCheckpointPublicationBarrierForTest(
        userId,
      );
    if (barrier.state !== "entered") {
      throw new Error("Canonical checkpoint publication escaped before foreground replacement.");
    }
    lastFence = await readActiveRuntimeFenceForTest(userId);
    if (
      lastFence
      && lastFence.attemptId !== systemAttemptId
      && lastFence.processingMode === "default"
    ) {
      return;
    }
    await sleep(100);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Foreground admission did not replace the held system-mailbox owner.",
    `system attempt id: ${systemAttemptId}`,
    `last active fence: ${JSON.stringify(lastFence)}`,
  ]));
}

async function readActiveRuntimeFenceForTest(userId: string): Promise<{
  attemptId: string;
  processingMode: "default" | "inbox_media_retention" | "system_mailbox";
} | null> {
  return await requireScenario().harness.requestJson(
    `/__test/users/${encodeURIComponent(userId)}/active-runtime-fence`,
    {
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      },
      method: "POST",
    },
  );
}

async function requireSystemWakeStormPreserved(
  userId: string,
  expectedImportedSeq: string,
): Promise<void> {
  const deadlineAt = Date.now() + 60_000;
  let lastStatus = await requireScenario().harness.readUserStatus(userId);

  while (Date.now() < deadlineAt) {
    lastStatus = await requireScenario().harness.readUserStatus(userId);
    const systemLane = lastStatus.mailboxLag.find((lane) => lane.lane === "system");
    const redactedStatus = lastStatus.workspace?.redactedStatus;
    if (
      systemLane?.importedSeq === expectedImportedSeq
      && systemLane.lag === "0"
      && redactedStatus?.hostedMailboxSystemImportedSeq === expectedImportedSeq
      && redactedStatus.hostedMailboxRetryableBlockedCount === 0
    ) {
      return;
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Foreground reply succeeded, but the imported system wake storm was not preserved.",
    `expected imported sequence: ${expectedImportedSeq}`,
    `last status: ${JSON.stringify(lastStatus)}`,
  ]));
}

async function waitForRuntimeInFlight(
  userId: string,
  label: string,
  expectedProcessingMode: "default" | "inbox_media_retention" | "system_mailbox",
): Promise<void> {
  const deadlineAt = Date.now() + 60_000;
  let lastStatus = await requireScenario().harness.readUserStatus(userId);
  let lastFence = await readActiveRuntimeFenceForTest(userId);

  while (Date.now() < deadlineAt) {
    lastStatus = await requireScenario().harness.readUserStatus(userId);
    lastFence = await readActiveRuntimeFenceForTest(userId);
    if (
      lastStatus.inFlight
      && lastFence?.processingMode === expectedProcessingMode
    ) {
      return;
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    `Timed out waiting for ${label} to own the real hosted runtime.`,
    `expected processing mode: ${expectedProcessingMode}`,
    `last active fence: ${JSON.stringify(lastFence)}`,
    `last status: ${JSON.stringify(lastStatus)}`,
  ]));
}

async function signalTemporalRuntime(
  userId: string,
  signal:
    | {
        kind: "mailbox_appended";
        lane: "system";
        laneSeq: string;
        mailboxItemId: string;
      }
    | { kind: "runtime_recheck_requested" },
): Promise<void> {
  if (signal.kind === "mailbox_appended") {
    await signalHostedMailboxAppendRuntimeForTest({
      environment: requireScenario().runtimeEnv,
      expectedUserId: userId,
      mailboxItemId: signal.mailboxItemId,
    });
    return;
  }

  await signalHostedRuntimeRecheckRuntimeForTest({
    environment: requireScenario().runtimeEnv,
    userId,
  });
}

async function waitForAssistantProviderInput(
  expectedText: string,
  userId: string,
  timeoutMs = 30_000,
): Promise<void> {
  await waitForAssistantProviderInputInScenario({
    expectedText,
    scenario: requireScenario(),
    timeoutMs,
    userId,
  });
}

function countAssistantProviderInputs(expectedText: string): number {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.url === "/v1/responses"
    && request.body.includes(expectedText)
  ).length;
}

async function seedActivatedWorkspaceCheckpoint(userId: string): Promise<void> {
  await seedActivatedWorkspaceCheckpointInScenario(requireScenario(), userId);
}

async function seedActivatedWorkspaceCheckpointInScenario(
  targetScenario: HostedLocalFullStackScenario,
  userId: string,
): Promise<void> {
  const root = await mkdtemp(
    path.join(targetScenario.harness.persistDir, "priority-vault-"),
  );
  const operatorHomeRoot = path.join(root, "operator-home");
  const vaultRoot = path.join(root, "vault");
  await mkdir(operatorHomeRoot, { recursive: true });
  await createIntegratedVaultServices().core.init({
    requestId: `seed-priority-${userId}`,
    timezone: "America/New_York",
    vault: vaultRoot,
  });

  const snapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot,
    vaultRoot,
  });
  const hash = sha256HostedBundleHex(snapshot.bundle);
  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    browserVaultReplicaRef: createBrowserVaultReplicaRef(hash),
    environment: targetScenario.runtimeEnv,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: {
      seededForForegroundReplyPriority: true,
    },
    snapshotRef: createSnapshotBundleRef({
      hash,
      size: snapshot.bundle.byteLength,
    }),
    userId,
  });
  expect(checkpoint.status).toBe("updated");

  await targetScenario.harness.request(
    `/__test/artifacts?userId=${encodeURIComponent(userId)}&sha256=${hash}`,
    {
      body: new Blob([new Uint8Array(snapshot.bundle)]),
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      },
      method: "PUT",
    },
  );
}

function buildEverySystemWake(
  identity: ProbeIdentity,
  mealPhoto: {
    byteLength: number;
    captureId: string;
    mealPhotoKey: string;
    sha256: string;
  },
  environmentVoice: {
    audioKey: string;
    byteLength: number;
    captureId: string;
    sha256: string;
  },
): HostedExecutionWake[] {
  const requestedAt = new Date().toISOString();
  const completedAt = new Date(Date.parse(requestedAt) + 60_000).toISOString();
  const expiresAt = new Date(
    Date.parse(requestedAt) + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  ).toISOString();
  const askRequestId = `haask_priority_${runId}`;
  const runtimeControlKinds = [
    "runtime.manual-requested",
    "runtime.maintenance-requested",
    "runtime.browser-vault-refresh-requested",
    "runtime.device-sync-recovery-requested",
    "runtime.mailbox-lag-observed",
  ] as const;

  return [
    buildHostedExecutionMemberActivatedWake({
      eventId: `member.activated:priority:${runId}`,
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: identity.userId,
      occurredAt: requestedAt,
    }),
    buildHostedExecutionMemberChannelsUpdatedWake({
      eventId: `member.channels.updated:priority:${runId}`,
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: identity.userId,
      occurredAt: requestedAt,
    }),
    buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: `member.preferences.updated:priority:${runId}`,
      memberId: identity.userId,
      occurredAt: requestedAt,
      preferences: {
        personality: {
          detail: 7,
        },
        tone: "casual",
      },
    }),
    buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: `assistant.notification.requested:priority:${runId}`,
      memberId: identity.userId,
      notification: {
        instructions: "Priority-gate background notification.",
        route: {
          actorId: null,
          channel: "linq",
          delivery: {
            kind: "thread",
            target: identity.chatId,
          },
          identityId: null,
          threadId: identity.chatId,
          threadIsDirect: true,
        },
      },
      occurredAt: requestedAt,
    }),
    buildHostedExecutionAssistantAskRequestedWake({
      ask: {
        expiresAt,
        originAssistantInputId: `ain_${"1".repeat(32)}`,
        originSessionId: `session_priority_${runId}`,
        question: "What system work is pending?",
        target: {
          kind: "joined_group",
          membershipId: `hgrpm_priority_${runId}`,
          requestedLabel: "Priority gate",
        },
      },
      eventId: askRequestId,
      memberId: identity.userId,
      occurredAt: requestedAt,
    }),
    buildHostedExecutionAssistantAskCompletedWake({
      ask: {
        expiresAt,
        originAssistantInputId: `ain_${"1".repeat(32)}`,
        originSessionId: `session_priority_${runId}`,
        question: "What system work is pending?",
        requestId: askRequestId,
        result: {
          answer: "The priority test has background work.",
          outcome: "answered",
        },
        targetLabel: "Priority gate",
      },
      eventId: `haask_completion_priority_${runId}`,
      memberId: identity.userId,
      occurredAt: completedAt,
    }),
    buildHostedExecutionClinicalRecordsSyncRequestedWake({
      eventId: `clinical-records.sync-requested:priority:${runId}`,
      generation: 1,
      occurredAt: requestedAt,
      runId: `clinical_run_priority_${runId}`,
      userId: identity.userId,
    }),
    buildHostedExecutionDeviceSyncWake({
      eventId: `device-sync.wake:priority:${runId}`,
      occurredAt: requestedAt,
      reason: "webhook_hint",
      userId: identity.userId,
    }),
    buildHostedExecutionEnvironmentVoiceCapturedWake({
      audioKey: environmentVoice.audioKey,
      byteLength: environmentVoice.byteLength,
      captureId: environmentVoice.captureId,
      capturedAt: requestedAt,
      contentType: "audio/webm",
      durationMs: 1_000,
      eventId: `environment-voice.captured:priority:${runId}`,
      memberId: identity.userId,
      occurredAt: requestedAt,
      sha256: environmentVoice.sha256,
    }),
    buildHostedExecutionMealPhotoCapturedWake({
      byteLength: mealPhoto.byteLength,
      captureId: mealPhoto.captureId,
      capturedAt: requestedAt,
      directRoute: {
        channel: "linq",
        threadId: identity.chatId,
      },
      eventId: `meal-photo.captured:priority:${runId}`,
      mealPhotoKey: mealPhoto.mealPhotoKey,
      memberId: identity.userId,
      occurredAt: requestedAt,
      sha256: mealPhoto.sha256,
    }),
    buildHostedExecutionVaultShareDeliveryWake({
      delivery: {
        grantorMemberId: `member_grantor_${runId}`,
        projectionKind: "steps-days.v0",
        projectionScope: {
          projectionKind: "steps-days.v0",
        },
        record: {
          data: {
            date: "2026-07-25",
            metricKey: "steps",
            unit: "count",
            value: 12_345,
          },
          occurredAt: "2026-07-25T00:00:00.000Z",
          recordKey: "2026-07-25",
        },
        schema: "murph.vault-share.delivery.v1",
        shareId: `share_priority_${runId}`,
      },
      eventId: `vault-share.delivery:priority:${runId}`,
      memberId: identity.userId,
    }),
    buildHostedExecutionVaultShareRevokeWake({
      eventId: `vault-share.revoke:priority:${runId}`,
      memberId: identity.userId,
      revoke: {
        grantorMemberId: `member_grantor_${runId}`,
        projectionKind: "steps-days.v0",
        projectionScope: {
          projectionKind: "steps-days.v0",
        },
        revokedAt: completedAt,
        schema: "murph.vault-share.revoke.v1",
        shareId: `share_priority_${runId}`,
      },
    }),
    ...runtimeControlKinds.map((kind) =>
      buildHostedExecutionRuntimeControlWake({
        eventId: `${kind}:priority:${runId}`,
        kind,
        occurredAt: requestedAt,
        userId: identity.userId,
      })
    ),
    buildHostedExecutionPendingEffectsReconcileRequestedWake({
      effectId: `effect_priority_${runId}`,
      eventId: `runtime.pending-effects-reconcile-requested:priority:${runId}`,
      occurredAt: requestedAt,
      userId: identity.userId,
    }),
    buildHostedExecutionCodexAuthRequestedWake({
      action: "disconnect",
      attemptId: `hca_priority_${runId}`,
      eventId: `runtime.codex-auth-requested:priority:${runId}`,
      occurredAt: requestedAt,
      userId: identity.userId,
    }),
  ];
}

async function stageEnvironmentVoiceForProbe(identity: ProbeIdentity): Promise<{
  audioKey: string;
  byteLength: number;
  captureId: string;
  sha256: string;
}> {
  const bytes = new Uint8Array(await readFile(path.join(
    process.cwd(),
    "fixtures/demo-web-vault/raw/smoke/hosted-runner.wav",
  )));
  const captureId = createHash("sha256")
    .update(`foreground-priority-environment-voice:${identity.userId}`)
    .digest("hex");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const staged = await createCloudflareHostedControlClient({
    allowHttpLocalhost: true,
    baseUrl: requireScenario().harness.workerBaseUrl,
    getBearerToken: async () => requireScenario().harness.oidcToken,
  }).stageEnvironmentVoice({
    bytes,
    captureId,
    contentType: "audio/webm",
    sha256,
    userId: identity.userId,
  });
  return {
    audioKey: staged.audioKey,
    byteLength: staged.byteLength,
    captureId,
    sha256: staged.sha256,
  };
}

async function stageMealPhotoForProbe(identity: ProbeIdentity): Promise<{
  byteLength: number;
  captureId: string;
  mealPhotoKey: string;
  sha256: string;
}> {
  const bytes = Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x01,
    0x02,
    0xff,
    0xd9,
  ]);
  const captureId = createHash("sha256")
    .update(`foreground-priority:${identity.userId}`)
    .digest("hex");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const staged = await createCloudflareHostedControlClient({
    allowHttpLocalhost: true,
    baseUrl: requireScenario().harness.workerBaseUrl,
    getBearerToken: async () => requireScenario().harness.oidcToken,
  }).stageMealPhoto({
    bytes,
    captureId,
    sha256,
    userId: identity.userId,
  });
  return {
    byteLength: staged.byteLength,
    captureId,
    mealPhotoKey: staged.mealPhotoKey,
    sha256: staged.sha256,
  };
}

function createSnapshotBundleRef(input: {
  hash: string;
  size: number;
}): HostedExecutionSnapshotRef {
  return {
    hash: input.hash,
    key: `cloudflare-workspace-snapshots/${input.hash}.bundle`,
    size: input.size,
    updatedAt: new Date().toISOString(),
  };
}

function createBrowserVaultReplicaRef(
  sourceBundleHash: string,
): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 256,
    dataVersion: `priority-${sourceBundleHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    keyId: "browser-vault-replica:foreground-priority",
    objectKey: `browser-vault/priority-${sourceBundleHash.slice(0, 32)}.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:foreground-priority",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

function createProbeIdentity(label: string): ProbeIdentity {
  const userId = `member_local_priority_${label.replaceAll("-", "_")}_${runId}`;
  return {
    chatId: `chat_local_priority_${label.replaceAll("-", "_")}_${runId}`,
    homePhone: buildLinqHomePhoneNumber(userId),
    memberPhone: buildLinqRecipientPhoneNumber(userId),
    userId,
  };
}

function replyPathFor(identity: ProbeIdentity): string {
  return `/chats/${encodeURIComponent(identity.chatId)}/messages`;
}

function matchLinqMessageText(
  expectedText: string,
  targetLinqStub: HostedLocalLinqStub = requireLinqStub(),
): ObservedLinqRequestMatcher {
  return (request) => targetLinqStub.readObservedMessageText(request) === expectedText;
}

function observedLinqLatencyAlertRequests(): ObservedLinqRequest[] {
  return requireLinqStub().observedRequests.filter((request) =>
    requireLinqStub().readObservedMessageText(request)
      ?.startsWith("Murph reply latency alert.") === true
  );
}

function observedLinqProgressAlertRequests(): ObservedLinqRequest[] {
  return requireLinqStub().observedRequests.filter((request) =>
    requireLinqStub().readObservedMessageText(request)
      ?.startsWith("Murph runtime progress alert.") === true
  );
}

function observedResendLatencyAlertRequests(): ObservedResendRequest[] {
  return requireResendStub().observedRequests.filter((request) =>
    request.method === "POST"
    && request.url === "/emails"
    && readObservedResendEmail(request).subject
      === "Hosted runtime reply latency"
  );
}

function acceptedResendLatencyAlertRequests(): ObservedResendRequest[] {
  return requireResendStub().acceptedRequests.filter((request) =>
    readObservedResendEmail(request).subject
      === "Hosted runtime reply latency"
  );
}

function observedResendProgressAlertRequests(): ObservedResendRequest[] {
  return requireResendStub().observedRequests.filter((request) =>
    request.method === "POST"
    && request.url === "/emails"
    && readObservedResendEmail(request).subject
      === "Hosted runtime progress stalled"
  );
}

function acceptedResendProgressAlertRequests(): ObservedResendRequest[] {
  return requireResendStub().acceptedRequests.filter((request) =>
    readObservedResendEmail(request).subject
      === "Hosted runtime progress stalled"
  );
}

function readObservedResendEmail(request: ObservedResendRequest | undefined): {
  subject: string | null;
  text: string | null;
  to: string[];
} {
  if (!request) {
    return { subject: null, text: null, to: [] };
  }
  let value: unknown;
  try {
    value = JSON.parse(request.body);
  } catch {
    return { subject: null, text: null, to: [] };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { subject: null, text: null, to: [] };
  }
  const record = value as Record<string, unknown>;
  return {
    subject: typeof record.subject === "string" ? record.subject : null,
    text: typeof record.text === "string" ? record.text : null,
    to: Array.isArray(record.to)
      ? record.to.filter((recipient): recipient is string =>
          typeof recipient === "string"
        )
      : [],
  };
}

async function requestLatencyAlertCron(): Promise<Response> {
  return await fetch(
    `${requireScenario().harness.webBaseUrl}`
      + "/api/internal/hosted-runtime/latency-alert/cron",
    {
      headers: {
        authorization: `Bearer ${latencyAlertCronSecret}`,
      },
    },
  );
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  return await postSignedLinqWebhookForScenario(requireScenario(), event);
}

async function postSignedLinqWebhookForScenario(
  targetScenario: HostedLocalFullStackScenario,
  event: Record<string, unknown>,
): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return await fetch(
    `${targetScenario.harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`,
    {
      body: rawBody,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-webhook-signature": `sha256=${signature}`,
        "x-webhook-timestamp": timestamp,
      },
      method: "POST",
    },
  );
}

function writeLatencyProof(mode: string, latencyMs: number): void {
  process.stdout.write(
    `Hosted foreground reply priority: mode=${mode} latency=${Math.round(latencyMs)}ms`
      + ` deadline=${promptReplyDeadlineMs}ms idleFloor=${productionIdleCheckpointDelayMs}ms\n`,
  );
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted foreground reply priority scenario was not initialized.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted foreground reply priority Linq stub was not initialized.");
  }
  return linqStub;
}

function requireOrderingScenario(): HostedLocalFullStackScenario {
  if (!orderingScenario) {
    throw new Error("Hosted foreground checkpoint ordering scenario was not initialized.");
  }
  return orderingScenario;
}

function requireOrderingLinqStub(): HostedLocalLinqStub {
  if (!orderingLinqStub) {
    throw new Error("Hosted foreground checkpoint ordering Linq stub was not initialized.");
  }
  return orderingLinqStub;
}

function requireResendStub(): HostedLocalResendStub {
  if (!resendStub) {
    throw new Error(
      "Hosted foreground reply priority Resend stub was not initialized.",
    );
  }
  return resendStub;
}
