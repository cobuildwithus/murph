import { createHmac, randomUUID } from "node:crypto";

import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  buildJunctionWearableHostedReplayPlan,
  JUNCTION_WEARABLE_FIXTURE_SUMMARY_RESOURCES,
  type JunctionWearableHostedReplayDirtyResource,
  type JunctionWearableHostedReplayPlan,
} from "@murphai/vault-usecases/testing";
import {
  listHostedRuntimeLogsForTest,
  type HostedRuntimeLogForTestRow,
} from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildAssistantProviderMurphToolCall,
  buildHostedAssistantNotificationDecisionResponse,
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
} from "./helpers/hosted-local-linq-support.js";

const runId = randomUUID().replace(/-/gu, "").slice(0, 16);
const userId = `member_local_linq_sync_fairness_${runId}`;
const chatId = `chat_local_linq_sync_fairness_${runId}`;
const linqApiToken = "linq-local-sync-fairness-token";
const linqWebhookSecret = "linq-local-sync-fairness-secret";
const productionLikeAssistantModel = "gpt-5.6-terra";
const deviceSyncPublicBaseUrl = "https://device-sync.example.test/api/device-sync";
const junctionWebhookSecret = "whsec_c3luYy1mYWlybmVzcy10ZXN0";
const setupRequestText =
  "Remind me here every day at this time to take a short break.";
const setupReplyText = "Done - I will remind you here every day.";
const reminderInstructions =
  "Send the user the hosted-local recurring break reminder.";
const reminderText = "Time for your short break.";
const dirtyResourceCount = 113;
const firstPassProcessedCount = 100;
const firstPassRemainingCount = dirtyResourceCount - firstPassProcessedCount;
const systemMailboxFirstAdmissionWindowMs = 30_000;
const deviceSyncReminderOverlapLeadMs = 60_000;
const scheduledReminderLeadMs = 180_000;
const scheduledReminderMinimumRunwayMs = 10_000;
const barrierTimeoutMs = 180_000;
const observationTimeoutMs = 240_000;
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let plan: JunctionWearableHostedReplayPlan | null = null;
let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
let releaseHeldReminder: (() => void) | null = null;

vi.mock("server-only", () => ({}));

describe("hosted local Linq reminder device-sync non-starvation e2e", () => {
  beforeAll(async () => {
    plan = await buildJunctionWearableHostedReplayPlan({ replaySize: "smoke" });
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        DEVICE_SYNC_PUBLIC_BASE_URL: deviceSyncPublicBaseUrl,
        DEVICE_SYNC_SECRET: "synthetic-device-sync-runtime-secret",
        HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS:
          process.env.MURPH_HOSTED_LOCAL_E2E_FAST_GATE === "1" ? "1" : "10000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          buildLinqRecipientPhoneNumber(userId),
        JUNCTION_API_KEY: "sk_us_synthetic_junction_api_key",
        JUNCTION_CLIENT_USER_ID_SECRET: "synthetic-junction-client-user-id-secret",
        JUNCTION_ENV: "sandbox",
        JUNCTION_PROVIDER_FILTER: "oura,whoop_v2,garmin",
        JUNCTION_REGION: "us",
        JUNCTION_SUMMARY_RESOURCES: [
          ...new Set([
            ...JUNCTION_WEARABLE_FIXTURE_SUMMARY_RESOURCES,
            "sleep_cycle",
          ]),
        ].join(","),
        JUNCTION_WEBHOOK_SECRET: junctionWebhookSecret,
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      assistantProviderStubModelId: productionLikeAssistantModel,
      faultInjection: true,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-linq-sync-fairness-",
      requiredRunnerEnvProfile: "device-sync,linq",
      scenarioLabel: "Local hosted Linq reminder device-sync non-starvation e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });
  }, 600_000);

  afterAll(async () => {
    releaseHeldReminder?.();
    releaseHeldReminder = null;
    if (scenario) {
      await scenario.harness
        .releaseForegroundPriorityOrderingBarrierForTest(userId)
        .catch(() => undefined);
      await scenario.harness
        .clearForegroundPriorityOrderingObservationForTest(userId)
        .catch(() => undefined);
      await scenario.harness
        .releaseShutdownCheckpointPublicationBarrierForTest(userId)
        .catch(() => undefined);
    }
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
    plan = null;
  }, 120_000);

  it("runs one due recurring reminder while a capped device-sync pass has durable backlog, then drains the backlog", async () => {
    const activeScenario = requireScenario();
    const activeLinqStub = requireLinqStub();
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const reminderPath = `/chats/${encodeURIComponent(chatId)}/messages`;

    await activeScenario.seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone,
    });
    await activeScenario.runWake(buildActivationWake(), userId, {
      timeoutMs: 300_000,
    });
    const activationStatus = await activeScenario.waitForHostedCompletion(userId, {
      timeoutMs: 300_000,
    });
    expect(activationStatus.lastErrorCode ?? null).toBeNull();
    await activeScenario.bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    const schedule = resolveRecurringReminderSchedule();
    activeScenario.queueAssistantResponses(
      buildRecurringReminderSaveResponses(schedule),
      { matchInputContains: setupRequestText },
    );
    const setupSendBaseline = activeLinqStub.countObservedSends(reminderPath);
    const setupResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_sync_fairness_setup_${runId}`,
        messageId: `msg_sync_fairness_setup_${runId}`,
        text: setupRequestText,
      },
    ));
    expect(setupResponse.status).toBe(202);
    await expect(setupResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await activeScenario.waitForLatestPendingWake(userId);
    const setupSend = await activeLinqStub.waitForAdditionalSend({
      baselineCount: setupSendBaseline,
      expectedPath: reminderPath,
      scenario: activeScenario,
      userId,
    });
    expect(activeLinqStub.readObservedMessageText(setupSend)).toBe(setupReplyText);
    const setupStatus = await activeScenario.waitForHostedCompletion(userId, {
      timeoutMs: 300_000,
    });
    expect(setupStatus.lastErrorCode ?? null).toBeNull();
    await waitForDefaultProcessingWake(schedule.dueAtIso);
    assertScheduledReminderRunway(schedule.dueAtIso);

    const seededAt = new Date().toISOString();
    const dirtyResources = buildDistinctReplayResources(
      requirePlan(),
      dirtyResourceCount,
    );
    const seed = await activeScenario.seedJunctionDeviceSyncReplay({
      connectedAt: seededAt,
      dirtyAt: seededAt,
      dirtyResources,
      displayName: requirePlan().connection.displayName,
      externalAccountId:
        `${requirePlan().connection.externalAccountId}-${runId}-sync-fairness`,
      memberId: userId,
      sources: requirePlan().sources,
    });
    expect(seed.dirtyResourceCount).toBe(dirtyResourceCount);
    await expectPendingDirtyResourceCount(
      seed.connectionId,
      dirtyResourceCount,
    );

    const heldReminder = createHeldAssistantProviderResponse(
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver recurring break reminder",
        text: reminderText,
      }),
    );
    releaseHeldReminder = heldReminder.release;
    activeScenario.queueAssistantResponses([heldReminder.response], {
      matchInputContains: reminderInstructions,
    });
    const providerRequestBaseline = activeScenario.assistantProviderRequests.length;
    const matchingReminderSendBaseline = activeLinqStub.countObservedSends(
      reminderPath,
      (request) => activeLinqStub.readObservedMessageText(request) === reminderText,
    );
    let devicePassStagingObservationArmed = false;
    let checkpointBarrierArmed = false;

    try {
      await sleepUntil(new Date(
        Date.parse(schedule.dueAtIso) - deviceSyncReminderOverlapLeadMs,
      ).toISOString());
      const runtimeLogsFrom = new Date(Date.now() - 1_000);
      // The pass persists its retry fence before draining jobs. Hold that
      // checkpoint acknowledgement while arming the post-pass publication gate.
      await activeScenario.harness
        .armForegroundPriorityOrderingObservationForTest(
          userId,
          "canonical_post_commit",
        );
      devicePassStagingObservationArmed = true;
      const wakeResult = await activeScenario.runWake(
        buildJunctionFixtureWake(seed.connectionId, seededAt),
        userId,
        { timeoutMs: 420_000 },
      );
      const acceptedWake = wakeResult.wakeResult;
      expect(acceptedWake.kind).toBe("runtime_processing_accepted");
      if (acceptedWake.kind !== "runtime_processing_accepted") {
        throw new Error("Device-sync wake was not accepted for runtime processing.");
      }
      expect(["started", "woken"]).toContain(acceptedWake.action);

      await waitForDevicePassPreDrainCheckpointBarrier(
        schedule.dueAtIso,
      );
      await activeScenario.harness
        .armShutdownCheckpointPublicationBarrierForTest(userId);
      checkpointBarrierArmed = true;
      await expect(
        activeScenario.harness
          .releaseForegroundPriorityOrderingBarrierForTest(userId),
      ).resolves.toEqual({ ok: true, released: true });
      await expect(
        activeScenario.harness
          .clearForegroundPriorityOrderingObservationForTest(userId),
      ).resolves.toEqual({ cleared: true, ok: true });
      devicePassStagingObservationArmed = false;

      const [firstWindowAdmissionCount] = await Promise.all([
        countFirstSystemMailboxAdmissionWindow({
          beforeAt: schedule.dueAtIso,
          notBefore: runtimeLogsFrom,
        }),
        waitForShutdownCheckpointPublicationBarrier(schedule.dueAtIso),
      ]);
      const firstPass = await waitForDeviceSyncPassFinished({
        expectedProcessedJobs: firstPassProcessedCount,
        fromAt: runtimeLogsFrom,
      });
      expect(firstPass.redactedJson).toMatchObject({
        outcome: "completed",
        processedJobs: firstPassProcessedCount,
        workerJobLimitReached: true,
      });
      await expectPendingDirtyResourceCount(
        seed.connectionId,
        dirtyResourceCount,
      );
      expect(firstWindowAdmissionCount).toBe(1);
      await expectPendingDirtyResourceCount(
        seed.connectionId,
        dirtyResourceCount,
      );

      await sleepUntil(schedule.dueAtIso);
      await expect(
        activeScenario.harness
          .releaseShutdownCheckpointPublicationBarrierForTest(userId),
      ).resolves.toEqual({ ok: true, released: true });
      checkpointBarrierArmed = false;

      await withTimeout(
        heldReminder.started,
        observationTimeoutMs,
        "recurring reminder provider request",
      );
      await expectPendingDirtyResourceCount(
        seed.connectionId,
        firstPassRemainingCount,
      );
      expect(countReminderProviderRequestsSince(providerRequestBaseline)).toBe(1);
      expect(activeLinqStub.countObservedSends(
        reminderPath,
        (request) => activeLinqStub.readObservedMessageText(request) === reminderText,
      )).toBe(matchingReminderSendBaseline);

      heldReminder.release();
      releaseHeldReminder = null;
      const reminderSend = await activeLinqStub.waitForAdditionalSend({
        baselineCount: matchingReminderSendBaseline,
        expectedPath: reminderPath,
        matchRequest: (request) =>
          activeLinqStub.readObservedMessageText(request) === reminderText,
        scenario: activeScenario,
        userId,
      });
      expect(activeLinqStub.readObservedMessageText(reminderSend)).toBe(reminderText);

      await expectPendingDirtyResourceCount(seed.connectionId, 0);
      const finalStatus = await activeScenario.waitForHostedIdle(userId, {
        timeoutMs: observationTimeoutMs,
      });
      expect(finalStatus.lastErrorCode ?? null).toBeNull();
      const recurringWake = await waitForFutureRecurringWake(
        schedule.nextDueAtIso,
      );
      expect(recurringWake.reason).toBe("assistant");

      expect(countReminderProviderRequestsSince(providerRequestBaseline)).toBe(1);
      expect(activeLinqStub.countObservedSends(
        reminderPath,
        (request) => activeLinqStub.readObservedMessageText(request) === reminderText,
      )).toBe(matchingReminderSendBaseline + 1);

      const deviceSyncLogs = await waitForCompletedDeviceSyncDrainLogs(
        runtimeLogsFrom,
      );
      const positiveFinishedPassCounts = deviceSyncLogs
        .filter((row) => row.eventCode === "device-sync.pass_finished")
        .map((row) => readFiniteNumber(row.redactedJson, "processedJobs"))
        .filter((count): count is number => count !== null && count > 0);
      expect(positiveFinishedPassCounts).toEqual([
        firstPassProcessedCount,
        firstPassRemainingCount,
      ]);
      expect(
        deviceSyncLogs.filter((row) => row.eventCode === "device-sync.pass_started"),
      ).toHaveLength(2);
      expect(
        deviceSyncLogs.filter((row) => row.eventCode === "device-sync.job_failed"),
      ).toEqual([]);
    } finally {
      if (devicePassStagingObservationArmed) {
        await activeScenario.harness
          .releaseForegroundPriorityOrderingBarrierForTest(userId)
          .catch(() => undefined);
        await activeScenario.harness
          .clearForegroundPriorityOrderingObservationForTest(userId)
          .catch(() => undefined);
      }
      if (checkpointBarrierArmed) {
        await activeScenario.harness
          .releaseShutdownCheckpointPublicationBarrierForTest(userId)
          .catch(() => undefined);
      }
      releaseHeldReminder?.();
      releaseHeldReminder = null;
    }

  }, 900_000);
});

function buildActivationWake() {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:sync-fairness:${userId}:${runId}`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: userId,
    occurredAt: new Date().toISOString(),
    timeZone: "UTC",
  });
}

function buildJunctionFixtureWake(connectionId: string, occurredAt: string) {
  return buildHostedExecutionDeviceSyncWake({
    connectionId,
    eventId: [
      "device-sync:junction-sync-fairness",
      userId,
      connectionId,
      occurredAt,
      runId,
    ].join(":"),
    expectedConnectedAt: occurredAt,
    hint: {
      eventType: "junction.direct-resource-replay",
      jobs: [],
      occurredAt,
      reason: "direct-resource-replay",
    },
    occurredAt,
    provider: "junction",
    reason: "webhook_hint",
    userId,
  });
}

function buildRecurringReminderSaveResponses(input: {
  cronExpression: string;
}): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderMurphToolCall("automation", {
      action: "save",
      continuityPolicy: "preserve",
      instructions: reminderInstructions,
      schedule: {
        expression: input.cronExpression,
        kind: "cron",
        timeZone: "UTC",
      },
      summary: "Daily recurring break reminder.",
      tags: ["assistant", "scheduled"],
      title: "Daily break reminder",
    }),
    setupReplyText,
  ];
}

function resolveRecurringReminderSchedule(now = new Date()): {
  cronExpression: string;
  dueAtIso: string;
  nextDueAtIso: string;
} {
  const dueAtMs = Math.ceil(
    (now.getTime() + scheduledReminderLeadMs) / 60_000,
  ) * 60_000;
  const dueAt = new Date(dueAtMs);
  const cronExpression =
    `${dueAt.getUTCMinutes()} ${dueAt.getUTCHours()} * * *`;
  return {
    cronExpression,
    dueAtIso: dueAt.toISOString(),
    nextDueAtIso: new Date(dueAtMs + 24 * 60 * 60 * 1_000).toISOString(),
  };
}

function buildDistinctReplayResources(
  replayPlan: JunctionWearableHostedReplayPlan,
  count: number,
): JunctionWearableHostedReplayDirtyResource[] {
  const base = replayPlan.dirtyResources.find((candidate) => {
    const raw = candidate.payload.webhookDataJson;
    if (typeof raw !== "string") {
      return false;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) && typeof parsed.id === "string";
    } catch {
      return false;
    }
  });
  if (!base || typeof base.payload.webhookDataJson !== "string") {
    throw new Error("Expected one valid Junction replay resource with a record id.");
  }
  const parsedBase: unknown = JSON.parse(base.payload.webhookDataJson);
  if (!isRecord(parsedBase)) {
    throw new Error("Expected Junction replay webhook data to be an object.");
  }

  return Array.from({ length: count }, (_, index) => {
    const uniqueId = `fixture-sync-fairness-${runId}-${index + 1}`;
    return {
      ...base,
      count: 1,
      payload: {
        ...base.payload,
        objectId: uniqueId,
        webhookDataJson: JSON.stringify({
          ...parsedBase,
          id: uniqueId,
        }),
      },
    };
  });
}

function createHeldAssistantProviderResponse(
  text: string,
): {
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

async function waitForDefaultProcessingWake(expectedAt: string): Promise<void> {
  const deadline = Date.now() + observationTimeoutMs;
  let lastAt: string | null = null;
  let lastReason: string | null = null;
  while (Date.now() < deadline) {
    const status = await requireScenario().harness.readUserStatus(userId);
    lastAt = status.workspace?.nextDefaultProcessingWakeAt
      ?? status.workspace?.nextWakeAt
      ?? null;
    lastReason = status.workspace?.nextDefaultProcessingWakeReason
      ?? status.workspace?.nextWakeReason
      ?? null;
    if (lastAt === expectedAt && lastReason === "assistant") {
      return;
    }
    await sleep(250);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the recurring reminder's default processing wake.",
    `expected wake: ${expectedAt}`,
    `last wake: ${lastAt ?? "null"}`,
    `last reason: ${lastReason ?? "null"}`,
  ]));
}

async function waitForShutdownCheckpointPublicationBarrier(
  dueAtIso: string,
): Promise<void> {
  const deadline = Math.min(
    Date.now() + barrierTimeoutMs,
    Date.parse(dueAtIso),
  );
  let lastState: string | null = null;
  while (Date.now() < deadline) {
    const barrier = await requireScenario().harness
      .readShutdownCheckpointPublicationBarrierForTest(userId);
    lastState = barrier.state;
    if (barrier.state === "entered") {
      return;
    }
    await sleep(100);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "The first capped device-sync pass did not reach its checkpoint barrier before the reminder deadline.",
    `last barrier state: ${lastState ?? "unread"}`,
    `reminder due: ${dueAtIso}`,
  ]));
}

async function waitForDevicePassPreDrainCheckpointBarrier(
  dueAtIso: string,
): Promise<void> {
  const deadline = Math.min(
    Date.now() + barrierTimeoutMs,
    Date.parse(dueAtIso),
  );
  let lastState: string | null = null;
  let lastTarget: string | null = null;
  let lastEventKinds: string[] = [];
  while (Date.now() < deadline) {
    const observation = await requireScenario().harness
      .readForegroundPriorityOrderingObservationForTest(userId);
    lastState = observation.barrierState;
    lastTarget = observation.barrierTarget;
    lastEventKinds = observation.events.map((event) => event.kind);
    if (
      observation.barrierState === "entered"
      && observation.barrierTarget === "canonical_post_commit"
      && observation.events.some(
        (event) => event.kind === "canonical_checkpoint_committed",
      )
    ) {
      return;
    }
    await sleep(100);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "The device pass did not reach its pre-drain checkpoint barrier before the reminder deadline.",
    `last barrier state: ${lastState ?? "unread"}`,
    `last barrier target: ${lastTarget ?? "unread"}`,
    `observed ordering events: ${JSON.stringify(lastEventKinds)}`,
    `reminder due: ${dueAtIso}`,
  ]));
}

async function waitForDeviceSyncPassFinished(input: {
  expectedProcessedJobs: number;
  fromAt: Date;
}): Promise<HostedRuntimeLogForTestRow> {
  const deadline = Date.now() + observationTimeoutMs;
  let lastLogs: HostedRuntimeLogForTestRow[] = [];
  while (Date.now() < deadline) {
    lastLogs = await listDeviceSyncLogs(input.fromAt);
    const matching = lastLogs.find((row) =>
      row.eventCode === "device-sync.pass_finished"
      && readFiniteNumber(row.redactedJson, "processedJobs")
        === input.expectedProcessedJobs
    );
    if (matching) {
      return matching;
    }
    await sleep(250);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the capped device-sync pass to finish.",
    `expected processed jobs: ${input.expectedProcessedJobs}`,
    `observed device-sync events: ${JSON.stringify(lastLogs.map((row) => ({
      eventCode: row.eventCode,
      processedJobs: readFiniteNumber(row.redactedJson, "processedJobs"),
    })))}`,
  ]));
}

interface RuntimeAdmissionObservation {
  acceptedAt: string;
  orchestrationAttemptId: string;
  workspaceAttemptId: string;
}

async function countFirstSystemMailboxAdmissionWindow(input: {
  beforeAt: string;
  notBefore: Date;
}): Promise<number> {
  const deadline = Date.now() + observationTimeoutMs;
  let firstAdmissionAtMs: number | null = null;
  const observedAdmissions = new Map<string, RuntimeAdmissionObservation>();
  let admissions: RuntimeAdmissionObservation[] = [];

  while (Date.now() < deadline) {
    for (const admission of listRuntimeAdmissionsSince(input.notBefore)) {
      observedAdmissions.set(admission.workspaceAttemptId, admission);
    }
    admissions = [...observedAdmissions.values()].sort((left, right) =>
      Date.parse(left.acceptedAt) - Date.parse(right.acceptedAt)
    );
    const firstAdmission = admissions[0] ?? null;
    if (firstAdmissionAtMs === null && firstAdmission !== null) {
      firstAdmissionAtMs = Date.parse(firstAdmission.acceptedAt);
      const reminderDueAtMs = Date.parse(input.beforeAt);
      if (
        !Number.isFinite(reminderDueAtMs)
        || reminderDueAtMs
          < firstAdmissionAtMs + systemMailboxFirstAdmissionWindowMs
      ) {
        throw new Error(
          "The reminder deadline does not leave one full system-mailbox admission window.",
        );
      }
    }
    if (
      firstAdmissionAtMs !== null
      && Date.now()
        >= firstAdmissionAtMs + systemMailboxFirstAdmissionWindowMs
    ) {
      const admissionWindowEndMs =
        firstAdmissionAtMs + systemMailboxFirstAdmissionWindowMs;
      return admissions.filter((admission) =>
        Date.parse(admission.acceptedAt) < admissionWindowEndMs
      ).length;
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out observing the first system-mailbox runtime admission window.",
    `observed accepted attempts: ${JSON.stringify(admissions)}`,
  ]));
}

function listRuntimeAdmissionsSince(
  notBefore: Date,
): RuntimeAdmissionObservation[] {
  const admissions = new Map<string, RuntimeAdmissionObservation>();
  for (const line of requireScenario().harness.cloudflareStdoutTail().split(/\r?\n/u)) {
    const parsed = parseJson(line.trim());
    if (
      !isRecord(parsed)
      || parsed.component !== "hosted.runner"
      || parsed.phase !== "runtime.starting"
      || typeof parsed.time !== "string"
      || !Number.isFinite(Date.parse(parsed.time))
      || Date.parse(parsed.time) < notBefore.getTime()
      || !isRecord(parsed.details)
      || typeof parsed.details.orchestrationAttemptId !== "string"
      || parsed.details.orchestrationAttemptId.startsWith("hosted-local-wake:")
      || typeof parsed.details.runtimeProcessingAction !== "string"
      || typeof parsed.details.workspaceAttemptId !== "string"
    ) {
      continue;
    }
    admissions.set(parsed.details.workspaceAttemptId, {
      acceptedAt: parsed.time,
      orchestrationAttemptId: parsed.details.orchestrationAttemptId,
      workspaceAttemptId: parsed.details.workspaceAttemptId,
    });
  }
  return [...admissions.values()].sort((left, right) =>
    Date.parse(left.acceptedAt) - Date.parse(right.acceptedAt)
  );
}

async function expectPendingDirtyResourceCount(
  connectionId: string,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + observationTimeoutMs;
  let lastCount: number | null = null;
  while (Date.now() < deadline) {
    const status = await requireScenario()
      .readJunctionDeviceSyncReplayDrainStatus({ connectionId, memberId: userId });
    lastCount = status.pendingDirtyResourceCount;
    if (lastCount === expectedCount) {
      expect(status.hasPendingDirtyConnection).toBe(expectedCount > 0);
      expect(status.hasPendingDirtyConnectionForUser).toBe(expectedCount > 0);
      return;
    }
    await sleep(250);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the authoritative Junction dirty-resource count.",
    `expected count: ${expectedCount}`,
    `last count: ${lastCount ?? "unread"}`,
  ]));
}

async function waitForFutureRecurringWake(expectedAt: string): Promise<{
  at: string;
  reason: string | null;
}> {
  const deadline = Date.now() + observationTimeoutMs;
  let lastAt: string | null = null;
  let lastReason: string | null = null;
  while (Date.now() < deadline) {
    const status = await requireScenario().harness.readUserStatus(userId);
    lastAt = status.workspace?.nextDefaultProcessingWakeAt ?? null;
    lastReason = status.workspace?.nextDefaultProcessingWakeReason ?? null;
    if (lastAt === expectedAt) {
      return { at: lastAt, reason: lastReason };
    }
    await sleep(250);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the recurring reminder's next daily occurrence.",
    `expected wake: ${expectedAt}`,
    `last wake: ${lastAt ?? "null"}`,
    `last reason: ${lastReason ?? "null"}`,
  ]));
}

async function listDeviceSyncLogs(
  fromAt: Date,
): Promise<HostedRuntimeLogForTestRow[]> {
  return (await listHostedRuntimeLogsForTest({
    environment: requireScenario().runtimeEnv,
    fromAt,
    limit: 1_500,
    userId,
  })).filter((row) => row.component === "device-sync");
}

async function waitForCompletedDeviceSyncDrainLogs(
  fromAt: Date,
): Promise<HostedRuntimeLogForTestRow[]> {
  const deadline = Date.now() + observationTimeoutMs;
  let lastLogs: HostedRuntimeLogForTestRow[] = [];
  while (Date.now() < deadline) {
    lastLogs = await listDeviceSyncLogs(fromAt);
    const positiveFinishedPassCounts = lastLogs
      .filter((row) => row.eventCode === "device-sync.pass_finished")
      .map((row) => readFiniteNumber(row.redactedJson, "processedJobs"))
      .filter((count): count is number => count !== null && count > 0);
    if (
      positiveFinishedPassCounts.length === 2
      && positiveFinishedPassCounts[0] === firstPassProcessedCount
      && positiveFinishedPassCounts[1] === firstPassRemainingCount
    ) {
      return lastLogs;
    }
    await sleep(250);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the two bounded device-sync pass records.",
    `observed events: ${JSON.stringify(lastLogs.map((row) => ({
      eventCode: row.eventCode,
      processedJobs: readFiniteNumber(row.redactedJson, "processedJobs"),
    })))}`,
  ]));
}

function countReminderProviderRequestsSince(baseline: number): number {
  return requireScenario().assistantProviderRequests
    .slice(baseline)
    .filter((request) => request.method === "POST" && request.url.endsWith("/responses"))
    .filter((request) => collectJsonStrings(parseJson(request.body))
      .some((value) => value.includes(reminderInstructions)))
    .length;
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectJsonStrings);
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.values(value).flatMap(collectJsonStrings);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readFiniteNumber(
  value: Record<string, unknown> | null,
  key: string,
): number | null {
  const candidate = value?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
}

function assertScheduledReminderRunway(dueAtIso: string): void {
  const remainingMs = Date.parse(dueAtIso) - Date.now();
  if (remainingMs < scheduledReminderMinimumRunwayMs) {
    throw new Error(
      `Recurring reminder setup left only ${remainingMs}ms before its deadline.`,
    );
  }
}

async function sleepUntil(dueAtIso: string): Promise<void> {
  const dueAtMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueAtMs)) {
    throw new Error(`Invalid recurring reminder due timestamp: ${dueAtIso}`);
  }
  const remainingMs = dueAtMs - Date.now();
  if (remainingMs > 0) {
    await sleep(remainingMs);
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label}.`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function postSignedLinqWebhook(
  event: Record<string, unknown>,
): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return await fetch(
    `${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`,
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requirePlan(): JunctionWearableHostedReplayPlan {
  if (!plan) {
    throw new Error("Junction wearable replay plan was not initialized.");
  }
  return plan;
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
