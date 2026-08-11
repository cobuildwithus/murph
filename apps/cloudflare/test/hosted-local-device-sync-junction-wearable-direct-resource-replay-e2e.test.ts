import { createHmac, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildCloudflareHostedControlUserStatusPath,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  getHostedBrowserVaultReplicaStorageKeyId,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/browser-vault";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedRunnerStatusResponse,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedStorageAad,
  decryptHostedStoragePayload,
  generateHostedUserRecipientKeyPair,
  parseHostedBrowserSessionKeyEnvelope,
  parseHostedCipherEnvelope,
  unwrapHostedBrowserSessionKey,
} from "@murphai/runtime-state";
import {
  buildJunctionWearableHostedReplayPlan,
  collectJunctionWearableBrowserVaultSummaryFailures,
  JUNCTION_WEARABLE_BROWSER_VAULT_BIOMARKER_EXPECTATIONS,
  JUNCTION_WEARABLE_FIXTURE_SUMMARY_RESOURCES,
  JUNCTION_WEARABLE_HOSTED_DIRECT_REPLAY_BROWSER_VAULT_METRIC_EXPECTATIONS,
  normalizeJunctionProviderSlugForComparison,
  summarizeJunctionWearableBrowserVaultExperimentProgress,
  summarizeJunctionWearableBrowserVaultReplica,
  type JunctionWearableBrowserVaultReplicaSummary,
  type JunctionWearableHostedReplayDirtyResource,
  type JunctionWearableHostedReplayPlan,
} from "@murphai/vault-usecases/testing";

import {
  buildAssistantProviderMurphToolCall,
  buildAssistantProviderVaultCliCall,
  buildHostedAssistantNotificationDecisionResponse,
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
import {
  buildSignedJunctionWebhookBody,
  createSignedJunctionSvixWebhook,
} from "./helpers/junction-webhook-replay.js";
import {
  expectJunctionWearableBiomarkerExpectationsToMatchProduction,
} from "./helpers/junction-wearable-biomarker-contract.js";

const runId = randomUUID().replace(/-/gu, "").slice(0, 16);
const userId = `member_local_junction_wearable_${runId}`;
const signedWebhookUserId = `member_local_junction_webhook_${runId}`;
const retriedWebhookUserId = `member_local_junction_webhook_retry_${runId}`;
const experimentAdherenceUserId = `member_local_junction_adherence_${runId}`;
const experimentAdherenceChatId = `chat_local_junction_adherence_${runId}`;
const experimentAdherenceSlug = `hosted-running-block-${runId}`;
const experimentActivityNudgeSlug = `experiment-activity-nudge-${experimentAdherenceSlug}`;
const experimentSetupText = "Set up my wearable-counted running block.";
const experimentSetupReplyText = "Your running block is active and Garmin runs count automatically.";
const experimentActivityNudgeInstructions = [
  `Read vault-cli experiment progress ${experimentAdherenceSlug} --format json first.`,
  "Send one short progress celebration only for a meaningful milestone; never ask the user to log the workout.",
  "Skip silently when the activity is already covered or no progress moment is useful.",
].join(" ");
const experimentActivityNudgeReplyText = "Nice run — that's 1 of 6 for your running block.";
const productionLikeAssistantModel = "gpt-5.6-terra";
const deviceSyncPublicBaseUrl = "https://device-sync.example.test/api/device-sync";
const junctionWebhookSecret = "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==";
const linqApiToken = "linq-local-test-token";
const linqWebhookSecret = "linq-local-junction-adherence-secret";
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;
const textDecoder = new TextDecoder();
const hostedDeviceSyncReceiptLogLimit = 50;

let plan: JunctionWearableHostedReplayPlan | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
let linqStub: HostedLocalLinqStub | null = null;
let browserVaultSummary: JunctionWearableBrowserVaultReplicaSummary | null = null;

describe("hosted local Junction wearable direct-resource replay e2e", () => {
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
        JUNCTION_API_KEY: "sk_us_synthetic_junction_api_key",
        JUNCTION_CLIENT_USER_ID_SECRET: "synthetic-junction-client-user-id-secret",
        JUNCTION_ENV: "sandbox",
        JUNCTION_PROVIDER_FILTER: "oura,whoop_v2,garmin",
        JUNCTION_REGION: "us",
        JUNCTION_SUMMARY_RESOURCES: [
          ...new Set([...JUNCTION_WEARABLE_FIXTURE_SUMMARY_RESOURCES, "sleep_cycle"]),
        ].join(","),
        JUNCTION_WEBHOOK_SECRET: junctionWebhookSecret,
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      assistantProviderStubModelId: productionLikeAssistantModel,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-junction-direct-replay-",
      requiredRunnerEnvProfile: "device-sync,linq",
      scenarioLabel: "Local hosted Junction wearable direct-resource replay e2e",
      streamLogs: streamDevLogs,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 120_000);

  it("uses sanitized replay data for Oura, WHOOP, and Garmin", () => {
    const replayPlan = requirePlan();

    expect(replayPlan.privacyScan.riskyContextValueCount).toBe(0);
    expect(replayPlan.privacyScan.riskyKeyValueCount).toBe(0);
    expect(replayPlan.privacyScan.riskyValuePatternCounts).toEqual({
      accessTokenKeyword: 0,
      bearerLike: 0,
      email: 0,
      homePath: 0,
      jwtLike: 0,
      uuidLike: 0,
      whsecLike: 0,
    });
    expect(replayPlan.privacyScan.scannedFiles ?? 0).toBeGreaterThan(0);
    expect(
      (replayPlan.privacyScan.includedJsonFiles ?? 0)
        + (replayPlan.privacyScan.includedJsonlRecords ?? 0),
    ).toBeGreaterThan(0);
    expect(replayPlan.privacyScan.pseudonymizedValues ?? 0).toBeGreaterThan(0);
    expect(replayPlan.privacyScan.shiftedDates ?? 0).toBeGreaterThan(0);
    expect(replayPlan.replay).toEqual({
      droppedRecordCount: 0,
      mode: "directDirtyResource",
      recordLimitPerProviderResource: 24,
      size: "smoke",
    });
    expect(replayPlan.dirtyResources.length).toBeGreaterThan(0);
    expect(replayPlan.resources.every((resource) => resource.droppedRecordCount === 0)).toBe(true);
    expect(replayPlan.dirtyResources.every((resource) =>
      typeof resource.payload.eventType === "string"
      && resource.payload.eventType.startsWith("daily.data.")
    )).toBe(true);
    expect(replayPlan.resources.every((resource) =>
      resource.resourceCategory === "summary"
      && ["activity", "sleep"].includes(resource.resource)
    )).toBe(true);
    expect(replayPlan.dirtyResources.every((resource) =>
      resource.resourceCategory === "summary"
      && ["activity", "sleep"].includes(resource.resource)
    )).toBe(true);
    expect(replayPlan.sources.map((source) => source.sourceProviderSlug).sort()).toEqual([
      "garmin",
      "oura",
      "whoop_v2",
    ]);
    expectGarminCoverageIsPopulated();
    expect(requireReplayResource("garmin", "summary", "activity").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("garmin", "summary", "sleep").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("oura", "summary", "sleep").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("whoop_v2", "summary", "activity").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("whoop_v2", "summary", "sleep").recordCount).toBeGreaterThanOrEqual(5);
  });

  it("keeps signed Junction imports equivalent when the provider retries a lost acknowledgement", async () => {
    const replayPlan = requirePlan();
    const activeScenario = requireScenario();
    const seededAt = new Date().toISOString();
    const dirtyResources = buildJunctionHistoricalCoverageDirtyResources(seededAt);
    const clean = await runSignedJunctionHistoricalCoverageReplay({
      deliveryLabel: "clean",
      dirtyResources,
      externalAccountId: `${replayPlan.connection.externalAccountId}-${runId}-clean-webhook`,
      retrySleepCycleDelivery: false,
      scenario: activeScenario,
      seededAt,
      userId: signedWebhookUserId,
    });
    const retried = await runSignedJunctionHistoricalCoverageReplay({
      deliveryLabel: "lost-ack-retry",
      dirtyResources,
      externalAccountId: `${replayPlan.connection.externalAccountId}-${runId}-retried-webhook`,
      retrySleepCycleDelivery: true,
      scenario: activeScenario,
      seededAt,
      userId: retriedWebhookUserId,
    });

    expect(retried.summary).toEqual(clean.summary);
    expect(retried.eventSignatures).toEqual(clean.eventSignatures);
    expect(retried.historicalState).toEqual(clean.historicalState);
    expect(retried.metricRowSignatures).toEqual(clean.metricRowSignatures);
    expect(new Set(retried.eventIds).size).toBe(retried.eventIds.length);
    expect(new Set(retried.metricRowIds).size).toBe(retried.metricRowIds.length);
    expect(retried.eventIds.length).toBeGreaterThan(0);
    expect(retried.summary.metrics.rowCount).toBeGreaterThan(0);
    expect(retried.summary.metrics.metricRowsByKey.steps ?? 0).toBeGreaterThan(0);
    expect(requireSourceHealthFromSummary(retried.summary, "garmin").sleepNights).toBeGreaterThan(0);
  }, 720_000);

  it("counts one sensed run, ignores cycling, and emits one non-nagging nudge across a webhook retry", async () => {
    const activeScenario = requireScenario();
    const activityPlan = buildExperimentAdherenceActivityPlan(new Date());
    const memberPhone = buildLinqRecipientPhoneNumber(experimentAdherenceUserId);

    await activeScenario.seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(experimentAdherenceUserId),
      memberId: experimentAdherenceUserId,
      memberPhone,
    });
    await activeScenario.runWake(
      buildExperimentAdherenceActivationWake(activityPlan.seededAt),
      experimentAdherenceUserId,
      { timeoutMs: 300_000 },
    );
    await assertHostedRunnerCompletedWithoutError({
      context: "member activation before experiment-adherence setup",
      scenario: activeScenario,
      userId: experimentAdherenceUserId,
    });
    await activeScenario.bindActiveHostedLinqHomeChat({
      chatId: experimentAdherenceChatId,
      memberId: experimentAdherenceUserId,
      recipientPhone: memberPhone,
    });

    const replyPath = `/chats/${encodeURIComponent(experimentAdherenceChatId)}/messages`;
    const setupOutboundBaseline = requireLinqStub().countObservedSends(replyPath);
    activeScenario.queueAssistantResponses(
      buildExperimentAdherenceSetupResponses(activityPlan),
      { matchInputContains: experimentSetupText },
    );
    const setupResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      experimentAdherenceUserId,
      experimentAdherenceChatId,
      {
        eventId: `evt_junction_experiment_adherence_setup_${runId}`,
        messageId: `msg_junction_experiment_adherence_setup_${runId}`,
        text: experimentSetupText,
      },
    ));
    expect(setupResponse.status).toBe(202);
    const setupReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: setupOutboundBaseline,
      expectedPath: replyPath,
      scenario: activeScenario,
      userId: experimentAdherenceUserId,
    });
    expect(requireLinqStub().readObservedMessageText(setupReply)).toBe(experimentSetupReplyText);
    await assertHostedRunnerCompletedWithoutError({
      context: "experiment-adherence setup",
      scenario: activeScenario,
      userId: experimentAdherenceUserId,
    });

    const garminSources = requirePlan().sources.filter(
      (source) => source.sourceProviderSlug === "garmin",
    );
    expect(garminSources).toHaveLength(1);
    const externalAccountId = `${requirePlan().connection.externalAccountId}-${runId}-adherence`;
    const connection = await activeScenario.seedJunctionDeviceSyncConnection({
      connectedAt: activityPlan.seededAt,
      displayName: "Garmin",
      externalAccountId,
      memberId: experimentAdherenceUserId,
      sources: garminSources,
    });
    expect(connection.sourceCount).toBe(1);

    const triggeredRunningStart = new Date();
    const triggeredRunning = buildJunctionWorkoutDirtyResource({
      activityKind: "running",
      calendarDate: formatDateInTimeZone(triggeredRunningStart, "America/New_York"),
      endAt: new Date(triggeredRunningStart.getTime() + 60_000).toISOString(),
      id: `junction-adherence-running-${runId}`,
      sportName: "Running",
      startAt: triggeredRunningStart.toISOString(),
    });

    const nudgeOutboundBaseline = requireLinqStub().countObservedSends(replyPath);
    const nudgeProviderBaseline = countAssistantResponsesApiRequests();
    activeScenario.queueAssistantResponses([
      buildAssistantProviderVaultCliCall([
        "experiment",
        "progress",
        experimentAdherenceSlug,
        "--format",
        "json",
      ]),
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "One sensed running milestone; no manual log request is needed.",
        text: experimentActivityNudgeReplyText,
      }),
    ], {
      matchInputContains: experimentActivityNudgeInstructions,
    });
    const systemImportedSeqBeforeDeviceSync = await readHostedSystemImportedSeq({
      scenario: activeScenario,
      userId: experimentAdherenceUserId,
    });

    await postSignedJunctionWebhook({
      dirtyResource: activityPlan.cycling,
      externalAccountId,
      messageId: `msg_junction_adherence_cycling_${runId}`,
      scenario: activeScenario,
    });
    await postSignedJunctionWebhookWithLostAcknowledgementRetry({
      dirtyResource: triggeredRunning,
      externalAccountId,
      messageId: `msg_junction_adherence_running_${runId}`,
      scenario: activeScenario,
    });

    await activeScenario.waitForLatestPendingWake(experimentAdherenceUserId);
    const deviceSyncStatus = await activeScenario.waitForHostedCompletion(
      experimentAdherenceUserId,
      { timeoutMs: 420_000 },
    );
    if (deviceSyncStatus.lastErrorCode ?? null) {
      throw new Error(await activeScenario.buildFailureMessage(experimentAdherenceUserId, [
        "Hosted runner recorded an error while importing experiment-adherence workout data.",
        `last error code: ${deviceSyncStatus.lastErrorCode}`,
      ]));
    }
    await assertHostedDeviceSyncReplayReceiptAccepted({
      scenario: activeScenario,
      systemImportedSeqBefore: systemImportedSeqBeforeDeviceSync,
      userId: experimentAdherenceUserId,
    });
    await assertNoHostedDeviceSyncJobFailures({
      scenario: activeScenario,
      status: deviceSyncStatus,
      userId: experimentAdherenceUserId,
    });

    const nudge = await requireLinqStub().waitForAdditionalSend({
      baselineCount: nudgeOutboundBaseline,
      expectedPath: replyPath,
      scenario: activeScenario,
      userId: experimentAdherenceUserId,
    });
    expect(requireLinqStub().readObservedMessageText(nudge)).toBe(
      experimentActivityNudgeReplyText,
    );
    const finalStatus = await activeScenario.waitForHostedIdle(
      experimentAdherenceUserId,
    );
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(requireLinqStub().countObservedSends(replyPath)).toBe(nudgeOutboundBaseline + 1);
    expect(countAssistantResponsesApiRequests()).toBe(nudgeProviderBaseline + 2);

    const nudgeProviderText = collectAssistantProviderRequestTextSince(nudgeProviderBaseline);
    expect(nudgeProviderText).toContain(experimentAdherenceSlug);
    expect(nudgeProviderText).toMatch(/"sensedSessions"\s*:\s*1/u);
    expect(nudgeProviderText).toMatch(/"completedSessions"\s*:\s*1/u);

    const replicaRef = requireReplicaRef(finalStatus.workspace?.browserVaultReplicaRef ?? null);
    const replica = await readBrowserVaultReplica({
      replicaRef,
      scenario: activeScenario,
      userId: experimentAdherenceUserId,
    });
    expect(summarizeJunctionWearableBrowserVaultExperimentProgress({
      experimentSlug: experimentAdherenceSlug,
      replica,
    })).toEqual({
      activityKind: "running",
      completedSessions: 1,
      eventKind: "activity_session",
      expectedSessionsByNow: expect.any(Number),
      loggedSessions: 1,
      sensedSessions: 1,
      status: expect.stringMatching(/^(behind|on_track|met_minimum|met_target)$/u),
      targetSessions: 6,
    });

    const drainStatus = await activeScenario.readJunctionDeviceSyncReplayDrainStatus({
      connectionId: connection.connectionId,
      memberId: experimentAdherenceUserId,
    });
    expect(drainStatus.hasPendingDirtyConnection).toBe(false);
    expect(drainStatus.hasPendingDirtyConnectionForUser).toBe(false);
  }, 720_000);

  it("imports direct-resource replay jobs through hosted device-sync and publishes /biomarkers data", async () => {
    await expectJunctionWearableBiomarkerExpectationsToMatchProduction(
      JUNCTION_WEARABLE_BROWSER_VAULT_BIOMARKER_EXPECTATIONS,
    );

    const replayPlan = requirePlan();
    const activeScenario = requireScenario();
    const seededAt = new Date().toISOString();

    await activeScenario.seedActiveHostedMember({ memberId: userId });
    await activeScenario.runWake(buildMemberActivatedWake(seededAt), userId, {
      timeoutMs: 300_000,
    });
    const activationStatus = await activeScenario.waitForHostedCompletion(userId, {
      timeoutMs: 240_000,
    });
    if (activationStatus.lastErrorCode ?? null) {
      throw new Error(await activeScenario.buildFailureMessage(userId, [
        "Hosted runner recorded an error during the member activation bootstrap before Junction wearable replay.",
        `last error code: ${activationStatus.lastErrorCode}`,
      ]));
    }

    const seed = await activeScenario.seedJunctionDeviceSyncReplay({
      connectedAt: seededAt,
      dirtyAt: seededAt,
      dirtyResources: replayPlan.dirtyResources,
      displayName: replayPlan.connection.displayName,
      externalAccountId: replayPlan.connection.externalAccountId,
      memberId: userId,
      sources: replayPlan.sources,
    });

    expect(seed.dirtyResourceCount).toBe(replayPlan.dirtyResources.length);
    expect(seed.sourceCount).toBe(3);
    const systemImportedSeqBeforeDeviceSync = await readHostedSystemImportedSeq({
      scenario: activeScenario,
      userId,
    });

    await activeScenario.runWake(
      buildJunctionFixtureWake(seed.connectionId, seededAt),
      userId,
      { timeoutMs: 420_000 },
    );
    const deviceSyncStatus = await activeScenario.waitForHostedCompletion(userId, {
      timeoutMs: 420_000,
    });
    if (deviceSyncStatus.lastErrorCode ?? null) {
      throw new Error(await activeScenario.buildFailureMessage(userId, [
        "Hosted runner recorded an error during the Junction wearable direct-resource replay import.",
        `last error code: ${deviceSyncStatus.lastErrorCode}`,
      ]));
    }

    await assertHostedDeviceSyncReplayReceiptAccepted({
      scenario: activeScenario,
      systemImportedSeqBefore: systemImportedSeqBeforeDeviceSync,
      userId,
    });
    await assertNoHostedDeviceSyncJobFailures({
      scenario: activeScenario,
      status: deviceSyncStatus,
      userId,
    });
    const drainStatus = await activeScenario.readJunctionDeviceSyncReplayDrainStatus({
      connectionId: seed.connectionId,
      memberId: userId,
    });
    if (
      drainStatus.hasPendingDirtyConnection
      || drainStatus.hasPendingDirtyConnectionForUser
    ) {
      throw new Error(await activeScenario.buildFailureMessage(userId, [
        "Hosted Junction wearable direct-resource replay left dirty state pending after hosted device-sync completion.",
        `dirty drain status: ${JSON.stringify(drainStatus)}`,
      ]));
    }

    const finalStatus = deviceSyncStatus.workspace?.browserVaultReplicaRef
      ? deviceSyncStatus
      : await waitForScheduledBrowserVaultReplica({
          scenario: activeScenario,
          userId,
        });

    const replicaRef = finalStatus.workspace?.browserVaultReplicaRef ?? null;
    expect(replicaRef).not.toBeNull();
    const replica = await readBrowserVaultReplica({
      replicaRef: requireReplicaRef(replicaRef),
      scenario: activeScenario,
      userId,
    });
    browserVaultSummary = summarizeJunctionWearableBrowserVaultReplica({
      generatedAt: requireReplicaRef(replicaRef).generatedAt,
      replica,
    });

    const summaryFailures = collectJunctionWearableBrowserVaultSummaryFailures(browserVaultSummary, {
      metricExpectations: JUNCTION_WEARABLE_HOSTED_DIRECT_REPLAY_BROWSER_VAULT_METRIC_EXPECTATIONS,
    });
    if (summaryFailures.length > 0) {
      throw new Error(await activeScenario.buildFailureMessage(userId, [
        "Hosted Junction wearable direct-resource replay did not publish the expected browser-vault biomarker contract.",
        ...summaryFailures,
        `browser-vault summary: ${JSON.stringify({
          biomarkerPanels: browserVaultSummary.biomarkerPanels,
          metricRowsByKey: browserVaultSummary.metrics.metricRowsByKey,
          selectedMetricKeys: browserVaultSummary.metrics.selectedMetricKeys,
          sourceHealth: browserVaultSummary.sourceHealth,
        })}`,
      ]));
    }
    const ouraSourceHealth = requireSourceHealth("oura");
    const whoopSourceHealth = requireSourceHealth("whoop_v2");
    const garminSourceHealth = requireSourceHealth("garmin");

    expect(ouraSourceHealth.sleepNights).toBeGreaterThan(0);
    expect(
      whoopSourceHealth.activityDays
        + whoopSourceHealth.sleepNights
        + whoopSourceHealth.recoveryDays,
    ).toBeGreaterThan(0);
    expect(garminSourceHealth.selectedMetrics).toBeGreaterThan(0);
    expect(garminSourceHealth.sleepNights).toBeGreaterThan(0);

    const failureStatus = extractHostedStatusFromFailureMessage(
      await activeScenario.buildFailureMessage(userId, [
        "Hosted status redaction direct proof.",
      ]),
    );
    expect(readBooleanAtPath(failureStatus, ["workspace", "browserVaultReplicaRefPresent"])).toBe(
      true,
    );
    expect(collectUnsafeHostedStatusFailureKeys(failureStatus)).toEqual([]);
  }, 540_000);
});

interface ExperimentAdherenceActivityPlan {
  baselineEnd: string;
  baselineStart: string;
  cycling: JunctionWearableHostedReplayDirtyResource;
  interventionEnd: string;
  interventionStart: string;
  running: JunctionWearableHostedReplayDirtyResource;
  seededAt: string;
}

function buildExperimentAdherenceActivityPlan(now: Date): ExperimentAdherenceActivityPlan {
  const seededAt = now.toISOString();
  const cyclingStart = new Date(now.getTime() - (30 * 60 * 1_000));
  const cyclingEnd = new Date(now.getTime() - (20 * 60 * 1_000));
  const runningStart = new Date(now.getTime() - (15 * 60 * 1_000));
  const runningEnd = new Date(now.getTime() - (5 * 60 * 1_000));
  const interventionStart = [cyclingStart, runningStart]
    .map((date) => formatDateInTimeZone(date, "America/New_York"))
    .sort()[0]!;
  const interventionEnd = addDaysToIsoDate(interventionStart, 27);
  const baselineEnd = addDaysToIsoDate(interventionStart, -1);
  const baselineStart = addDaysToIsoDate(interventionStart, -7);

  return {
    baselineEnd,
    baselineStart,
    cycling: buildJunctionWorkoutDirtyResource({
      activityKind: "cycling",
      calendarDate: formatDateInTimeZone(cyclingStart, "America/New_York"),
      endAt: cyclingEnd.toISOString(),
      id: `junction-adherence-cycling-${runId}`,
      sportName: "Cycling",
      startAt: cyclingStart.toISOString(),
    }),
    interventionEnd,
    interventionStart,
    running: buildJunctionWorkoutDirtyResource({
      activityKind: "running",
      calendarDate: formatDateInTimeZone(runningStart, "America/New_York"),
      endAt: runningEnd.toISOString(),
      id: `junction-adherence-running-${runId}`,
      sportName: "Running",
      startAt: runningStart.toISOString(),
    }),
    seededAt,
  };
}

function buildJunctionWorkoutDirtyResource(input: {
  activityKind: "cycling" | "running";
  calendarDate: string;
  endAt: string;
  id: string;
  sportName: string;
  startAt: string;
}): JunctionWearableHostedReplayDirtyResource {
  return {
    count: 1,
    jobKind: "resource",
    payload: {
      eventType: "daily.data.workouts.created",
      objectId: input.id,
      occurredAt: input.endAt,
      webhookDataJson: JSON.stringify({
        activityType: input.activityKind,
        calendar_date: input.calendarDate,
        duration: Math.round((Date.parse(input.endAt) - Date.parse(input.startAt)) / 1_000),
        provider_id: input.id,
        sourceProviderSlug: "garmin",
        sport: {
          name: input.sportName,
        },
        time_end: input.endAt,
        time_start: input.startAt,
      }),
    },
    resource: "workouts",
    resourceCategory: "summary",
    sourceProviderSlug: "garmin",
    windowEnd: input.endAt,
    windowStart: input.startAt,
  };
}

function buildExperimentAdherenceSetupResponses(
  plan: ExperimentAdherenceActivityPlan,
) {
  return [
    buildAssistantProviderVaultCliCall([
      "experiment",
      "start",
      experimentAdherenceSlug,
      "--request-id",
      `hosted-running-block-start-${runId}`,
      "--title",
      "Hosted running block",
      "--started-on",
      plan.baselineStart,
      "--status",
      "active",
      "--custom",
      "--no-public-protocol",
      "--baseline-start",
      plan.baselineStart,
      "--baseline-end",
      plan.baselineEnd,
      "--intervention-start",
      plan.interventionStart,
      "--intervention-end",
      plan.interventionEnd,
      "--modality",
      "Run",
      "--target-sessions",
      "6",
      "--minimum-useful-sessions",
      "3",
      "--primary-biomarker-key",
      "biomarker:resting-heart-rate",
      "--missed-log-followup",
      "never",
      "--setup-answer",
      `activity_nudge_automation_slug=${experimentActivityNudgeSlug}`,
    ]),
    buildAssistantProviderMurphToolCall("automation", {
      action: "save",
      continuityPolicy: "fresh",
      instructions: experimentActivityNudgeInstructions,
      schedule: {
        activityKind: "running",
        after: new Date().toISOString(),
        kind: "deviceActivity",
      },
      slug: experimentActivityNudgeSlug,
      status: "active",
      summary: "Sparse milestone celebrations for sensed running sessions.",
      tags: ["experiment", "activity-nudge"],
      title: "Running block activity nudge",
    }),
    experimentSetupReplyText,
  ] as const;
}

function buildExperimentAdherenceActivationWake(occurredAt: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:junction-experiment-adherence:${experimentAdherenceUserId}:${runId}`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: experimentAdherenceUserId,
    occurredAt,
    timeZone: "America/New_York",
  });
}

async function assertHostedRunnerCompletedWithoutError(input: {
  context: string;
  scenario: HostedLocalFullStackScenario;
  userId: string;
}): Promise<HostedRunnerStatusResponse> {
  const status = await input.scenario.waitForHostedCompletion(input.userId, {
    timeoutMs: 300_000,
  });
  if (status.lastErrorCode ?? null) {
    throw new Error(await input.scenario.buildFailureMessage(input.userId, [
      `Hosted runner recorded an error during ${input.context}.`,
      `last error code: ${status.lastErrorCode}`,
    ]));
  }
  return status;
}

function countAssistantResponsesApiRequests(): number {
  return requireScenario().assistantProviderRequests
    .filter((request) => request.url === "/v1/responses")
    .length;
}

function collectAssistantProviderRequestTextSince(baseline: number): string {
  return requireScenario().assistantProviderRequests
    .filter((request) => request.url === "/v1/responses")
    .slice(baseline)
    .flatMap((request) => collectJsonStrings(JSON.parse(request.body)))
    .join("\n\n");
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

function formatDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).format(date);
}

function addDaysToIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`Invalid local date: ${value}`);
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function runSignedJunctionHistoricalCoverageReplay(input: {
  deliveryLabel: string;
  dirtyResources: readonly JunctionWearableHostedReplayDirtyResource[];
  externalAccountId: string;
  retrySleepCycleDelivery: boolean;
  scenario: HostedLocalFullStackScenario;
  seededAt: string;
  userId: string;
}): Promise<{
  eventIds: string[];
  eventSignatures: string[];
  historicalState: JunctionHistoricalCoverageDrainSummary;
  metricRowIds: string[];
  metricRowSignatures: string[];
  summary: JunctionWearableBrowserVaultReplicaSummary;
}> {
  const garminSources = requirePlan().sources.filter(
    (source) => source.sourceProviderSlug === "garmin",
  );
  if (garminSources.length !== 1) {
    throw new Error("Expected exactly one Garmin source for signed Junction retry coverage.");
  }

  await input.scenario.seedActiveHostedMember({ memberId: input.userId });
  await input.scenario.runWake(
    buildMemberActivatedWake(input.seededAt, input.userId, input.deliveryLabel),
    input.userId,
    { timeoutMs: 300_000 },
  );
  const activationStatus = await input.scenario.waitForHostedCompletion(input.userId, {
    timeoutMs: 240_000,
  });
  if (activationStatus.lastErrorCode ?? null) {
    throw new Error(await input.scenario.buildFailureMessage(input.userId, [
      "Hosted runner recorded an error during member activation before signed Junction retry replay.",
      `last error code: ${activationStatus.lastErrorCode}`,
    ]));
  }

  const seed = await input.scenario.seedJunctionDeviceSyncConnection({
    connectedAt: input.seededAt,
    displayName: requirePlan().connection.displayName,
    externalAccountId: input.externalAccountId,
    memberId: input.userId,
    sources: garminSources,
  });
  expect(seed.sourceCount).toBe(1);
  const systemImportedSeqBeforeDeviceSync = await readHostedSystemImportedSeq({
    scenario: input.scenario,
    userId: input.userId,
  });

  let retriedSleepCycleDelivery = false;
  for (const [index, dirtyResource] of input.dirtyResources.entries()) {
    const messageId = [
      "msg_junction_signed",
      runId,
      input.deliveryLabel.replace(/[^a-z0-9]+/giu, "_"),
      index,
    ].join("_");
    if (input.retrySleepCycleDelivery && dirtyResource.resource === "sleep_cycle") {
      await postSignedJunctionWebhookWithLostAcknowledgementRetry({
        dirtyResource,
        externalAccountId: input.externalAccountId,
        messageId,
        scenario: input.scenario,
      });
      retriedSleepCycleDelivery = true;
      continue;
    }

    await postSignedJunctionWebhook({
      dirtyResource,
      externalAccountId: input.externalAccountId,
      messageId,
      scenario: input.scenario,
    });
  }
  expect(retriedSleepCycleDelivery).toBe(input.retrySleepCycleDelivery);

  await input.scenario.waitForLatestPendingWake(input.userId);
  const deviceSyncStatus = await input.scenario.waitForHostedCompletion(input.userId, {
    timeoutMs: 420_000,
  });
  if (deviceSyncStatus.lastErrorCode ?? null) {
    throw new Error(await input.scenario.buildFailureMessage(input.userId, [
      "Hosted runner recorded an error during signed Junction retry replay import.",
      `last error code: ${deviceSyncStatus.lastErrorCode}`,
    ]));
  }
  await assertHostedDeviceSyncReplayReceiptAccepted({
    scenario: input.scenario,
    systemImportedSeqBefore: systemImportedSeqBeforeDeviceSync,
    userId: input.userId,
  });
  await assertNoHostedDeviceSyncJobFailures({
    scenario: input.scenario,
    status: deviceSyncStatus,
    userId: input.userId,
  });

  const drainStatus = await waitForJunctionHistoricalCoverageDrain({
    connectionId: seed.connectionId,
    scenario: input.scenario,
    memberId: input.userId,
  });
  const historicalState = await assertJunctionHistoricalCoverageDrained({
    drainStatus,
    scenario: input.scenario,
    userId: input.userId,
  });

  const finalStatus = deviceSyncStatus.workspace?.browserVaultReplicaRef
    ? deviceSyncStatus
    : await waitForScheduledBrowserVaultReplica({
        scenario: input.scenario,
        userId: input.userId,
      });
  const replicaRef = requireReplicaRef(finalStatus.workspace?.browserVaultReplicaRef ?? null);
  const replica = await readBrowserVaultReplica({
    replicaRef,
    scenario: input.scenario,
    userId: input.userId,
  });

  return {
    eventIds: collectBrowserVaultEventIds(replica),
    eventSignatures: collectBrowserVaultEventSignatures(replica),
    historicalState,
    metricRowIds: collectBrowserVaultMetricRowIds(replica),
    metricRowSignatures: collectBrowserVaultMetricRowSignatures(replica),
    summary: summarizeJunctionWearableBrowserVaultReplica({
      generatedAt: replicaRef.generatedAt,
      replica,
    }),
  };
}

function buildJunctionHistoricalCoverageDirtyResources(
  connectedAt: string,
): JunctionWearableHostedReplayDirtyResource[] {
  const connectedAtMs = Date.parse(connectedAt);
  if (!Number.isFinite(connectedAtMs)) {
    throw new TypeError("Junction historical coverage connection time must be an ISO timestamp.");
  }
  const millisecondsPerDay = 24 * 60 * 60 * 1_000;
  const connectedDayMs = Date.UTC(
    new Date(connectedAtMs).getUTCFullYear(),
    new Date(connectedAtMs).getUTCMonth(),
    new Date(connectedAtMs).getUTCDate(),
  );
  const resourceDayMs = connectedDayMs - (2 * millisecondsPerDay);
  const windowStart = new Date(resourceDayMs).toISOString();
  const windowEnd = new Date(resourceDayMs + millisecondsPerDay).toISOString();
  const date = windowStart.slice(0, 10);
  const activityObservedAt = new Date(resourceDayMs + (18 * 60 * 60 * 1_000)).toISOString();
  const sleepStartedAt = new Date(resourceDayMs + (4 * 60 * 60 * 1_000)).toISOString();
  const sleepEndedAt = new Date(resourceDayMs + (11 * 60 * 60 * 1_000)).toISOString();
  const activityId = `junction-retry-activity-${runId}`;
  const sleepId = `junction-retry-sleep-${runId}`;
  const sleepCycleId = `junction-retry-sleep-cycle-${runId}`;

  return [
    buildJunctionHistoricalCoverageDirtyResource({
      eventType: "daily.data.activity.created",
      objectId: activityId,
      occurredAt: activityObservedAt,
      record: {
        calendar_date: date,
        date: windowStart,
        id: activityId,
        sourceProviderSlug: "garmin",
        steps: 4321,
      },
      resource: "activity",
      windowEnd,
      windowStart,
    }),
    buildJunctionHistoricalCoverageDirtyResource({
      eventType: "daily.data.sleep.created",
      objectId: sleepId,
      occurredAt: sleepEndedAt,
      record: {
        awake: 0,
        bedtime_start: sleepStartedAt,
        bedtime_stop: sleepEndedAt,
        calendar_date: date,
        date: windowStart,
        deep: 7200,
        duration: 25200,
        id: sleepId,
        light: 12600,
        rem: 5400,
        sourceProviderSlug: "garmin",
        total: 25200,
        type: "long_sleep",
      },
      resource: "sleep",
      windowEnd,
      windowStart,
    }),
    buildJunctionHistoricalCoverageDirtyResource({
      eventType: "daily.data.sleep_cycle.created",
      objectId: sleepCycleId,
      occurredAt: sleepEndedAt,
      record: {
        date,
        end: sleepEndedAt,
        id: sleepCycleId,
        sourceProviderSlug: "garmin",
        stages: [
          {
            endAt: new Date(resourceDayMs + (7 * 60 * 60 * 1_000)).toISOString(),
            stage: "light",
            startAt: sleepStartedAt,
          },
          {
            endAt: sleepEndedAt,
            stage: "deep",
            startAt: new Date(resourceDayMs + (7 * 60 * 60 * 1_000)).toISOString(),
          },
        ],
        start: sleepStartedAt,
        timeZone: "America/New_York",
      },
      resource: "sleep_cycle",
      windowEnd,
      windowStart,
    }),
  ];
}

function buildJunctionHistoricalCoverageDirtyResource(input: {
  eventType: string;
  objectId: string;
  occurredAt: string;
  record: Record<string, unknown>;
  resource: "activity" | "sleep" | "sleep_cycle";
  windowEnd: string;
  windowStart: string;
}): JunctionWearableHostedReplayDirtyResource {
  return {
    count: 1,
    jobKind: "resource",
    payload: {
      eventType: input.eventType,
      objectId: input.objectId,
      occurredAt: input.occurredAt,
      webhookDataJson: JSON.stringify(input.record),
    },
    resource: input.resource,
    resourceCategory: "summary",
    sourceProviderSlug: "garmin",
    windowEnd: input.windowEnd,
    windowStart: input.windowStart,
  };
}

function buildMemberActivatedWake(
  occurredAt: string,
  memberId = userId,
  label = "direct-replay",
) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:junction-${label}:${memberId}:${runId}`,
    memberChannels: {
      email: false,
      linq: false,
      telegram: false,
    },
    memberId,
    occurredAt,
    timeZone: "America/New_York",
  });
}

function buildJunctionFixtureWake(connectionId: string, occurredAt: string, memberId = userId) {
  return buildHostedExecutionDeviceSyncWake({
    connectionId,
    eventId: [
      "device-sync:junction-direct-replay",
      memberId,
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
    userId: memberId,
  });
}

async function postSignedJunctionWebhook(input: {
  dirtyResource: JunctionWearableHostedReplayDirtyResource;
  externalAccountId: string;
  messageId: string;
  scenario: HostedLocalFullStackScenario;
}): Promise<void> {
  const webhook = createSignedJunctionSvixWebhook({
    body: buildSignedJunctionWebhookBody(input),
    messageId: input.messageId,
    webhookSecret: junctionWebhookSecret,
  });
  const response = await postPreparedSignedJunctionWebhook({
    scenario: input.scenario,
    webhook,
  });
  await assertSignedJunctionWebhookResponse({
    dirtyResource: input.dirtyResource,
    duplicate: false,
    response,
  });
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
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

async function postSignedJunctionWebhookWithLostAcknowledgementRetry(input: {
  dirtyResource: JunctionWearableHostedReplayDirtyResource;
  externalAccountId: string;
  messageId: string;
  scenario: HostedLocalFullStackScenario;
}): Promise<void> {
  const webhook = createSignedJunctionSvixWebhook({
    body: buildSignedJunctionWebhookBody(input),
    messageId: input.messageId,
    webhookSecret: junctionWebhookSecret,
  });
  const firstResponse = await postPreparedSignedJunctionWebhook({
    scenario: input.scenario,
    webhook,
  });
  await assertSignedJunctionWebhookResponse({
    dirtyResource: input.dirtyResource,
    duplicate: false,
    response: firstResponse,
  });

  // Model a provider-side transport failure after Murph durably accepted the
  // webhook but before Junction observed the acknowledgement. The provider
  // retries the byte-identical signed delivery, including its Svix message id.
  const retryResponse = await postPreparedSignedJunctionWebhook({
    scenario: input.scenario,
    webhook,
  });
  await assertSignedJunctionWebhookResponse({
    dirtyResource: input.dirtyResource,
    duplicate: true,
    response: retryResponse,
  });
}

async function postPreparedSignedJunctionWebhook(input: {
  scenario: HostedLocalFullStackScenario;
  webhook: ReturnType<typeof createSignedJunctionSvixWebhook>;
}): Promise<Response> {
  const headers = new Headers(input.webhook.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return await fetch(`${input.scenario.harness.webBaseUrl}/api/device-sync/webhooks/junction`, {
    body: input.webhook.rawBody.toString("utf8"),
    headers,
    method: "POST",
  });
}

async function assertSignedJunctionWebhookResponse(input: {
  dirtyResource: JunctionWearableHostedReplayDirtyResource;
  duplicate: boolean;
  response: Response;
}): Promise<void> {
  expect(input.response.status).toBe(200);
  const payload = readJsonRecord(await input.response.json());
  expect(payload.accepted).toBe(true);
  expect(payload.duplicate).toBe(input.duplicate);
  expect(payload.eventType).toBe(input.dirtyResource.payload.eventType);
  expect(payload.provider).toBe("junction");
}

async function readBrowserVaultReplica(input: {
  replicaRef: HostedBrowserVaultReplicaRef;
  scenario: HostedLocalFullStackScenario;
  userId: string;
}): Promise<unknown> {
  const { privateKeyJwk, publicKeyJwk } = await generateHostedUserRecipientKeyPair();
  const session = await input.scenario.harness.requestJson<{
    encryptedReplica: unknown;
    replicaKeyEnvelope: unknown;
    state: string;
  }>(
    `/internal/users/${encodeURIComponent(input.userId)}/browser-vault/session`,
    {
      body: JSON.stringify({
        browserPublicKeyJwk: publicKeyJwk,
        replicaRef: input.replicaRef,
      }),
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    },
  );
  expect(session.state).toBe("ready");

  const replicaKey = await unwrapHostedBrowserSessionKey({
    envelope: parseHostedBrowserSessionKeyEnvelope(session.replicaKeyEnvelope),
    recipientPrivateKeyJwk: privateKeyJwk,
  });
  const plaintext = await decryptHostedStoragePayload({
    aad: buildHostedStorageAad({
      dataKeyId: input.replicaRef.dataKeyEnvelope?.dataKeyId,
      dataKeyRootKeyId: input.replicaRef.dataKeyEnvelope?.rootKeyId,
      dataVersion: input.replicaRef.dataVersion,
      objectKey: input.replicaRef.objectKey,
      purpose: "browser-vault-replica",
      runtimeRootKeyId: input.replicaRef.runtimeRootKeyId,
      schema: "murph.browser-vault-replica",
      sourceBundleHash: input.replicaRef.sourceBundleHash,
      userId: input.userId,
    }),
    envelope: parseHostedCipherEnvelope(session.encryptedReplica),
    expectedKeyId: getHostedBrowserVaultReplicaStorageKeyId(input.replicaRef),
    key: replicaKey,
    scope: "browser-vault-replica",
  });

  return JSON.parse(textDecoder.decode(plaintext));
}

async function assertHostedDeviceSyncReplayReceiptAccepted(input: {
  scenario: HostedLocalFullStackScenario;
  systemImportedSeqBefore: string;
  userId: string;
}): Promise<void> {
  const receiptStatus = parseHostedRunnerStatusResponse(
    await input.scenario.harness.requestJson<unknown>(
      `${buildCloudflareHostedControlUserStatusPath(input.userId)}?logLimit=${
        hostedDeviceSyncReceiptLogLimit
      }`,
      {
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
        },
      },
    ),
  );
  const redactedStatus = receiptStatus.workspace?.redactedStatus ?? null;
  const prepared = readNumberAtPath(redactedStatus, ["hostedSystemMailboxPrepared"]) ?? 0;
  const recorded = readNumberAtPath(redactedStatus, ["hostedSystemMailboxRecorded"]) ?? 0;
  const retryableFailed =
    readNumberAtPath(redactedStatus, ["hostedSystemMailboxRetryableFailed"]) ?? 0;
  const recordFailed =
    readNumberAtPath(redactedStatus, ["hostedSystemMailboxRecordFailed"]) ?? 0;
  const systemImportedSeq = readStringAtPath(
    redactedStatus,
    ["hostedMailboxSystemImportedSeq"],
  );
  const systemHandledThroughSeq = readStringAtPath(
    redactedStatus,
    ["hostedMailboxSystemHandledThroughSeq"],
  );
  const systemMailboxLogs = collectHostedSystemMailboxLogSummaries(receiptStatus);
  const retryableLog = systemMailboxLogs.find((entry) => entry.status === "retryable_failed");
  const recordedDeviceSyncLog = systemMailboxLogs.find((entry) =>
    entry.routeAction === "run-device-sync-wake"
    && entry.wakeKind === "device-sync.wake"
    && (entry.status === "processed" || entry.status === "recorded")
    && (entry.recordFailed ?? 0) === 0
  );
  const durableSystemLaneAdvancedAndSettled = systemImportedSeq !== null
    && hasDecimalSequenceAdvanced(input.systemImportedSeqBefore, systemImportedSeq)
    && systemImportedSeq === systemHandledThroughSeq
    && receiptStatus.mailboxLag.some((lane) =>
      lane.lane === "system" && lane.lag === "0"
    );
  const receiptObserved = durableSystemLaneAdvancedAndSettled
    || recordedDeviceSyncLog !== undefined;

  if (
    !receiptObserved
    || retryableLog
    || retryableFailed > 0
    || recordFailed > 0
  ) {
    const safeErrors = systemMailboxLogs
      .map((entry) => entry.safeErrorMessage)
      .filter((message): message is string => typeof message === "string" && message.length > 0);
    throw new Error(await input.scenario.buildFailureMessage(input.userId, [
      "Hosted Junction wearable direct-resource replay did not show a clean device-sync system mailbox receipt.",
      `system mailbox counters: ${JSON.stringify({
        prepared,
        recordFailed,
        recorded,
        retryableFailed,
        systemHandledThroughSeq,
        systemImportedSeq,
        systemImportedSeqBefore: input.systemImportedSeqBefore,
      })}`,
      ...(safeErrors.length > 0
        ? [`system mailbox safe errors: ${JSON.stringify(safeErrors)}`]
        : []),
      `system mailbox logs: ${JSON.stringify(systemMailboxLogs)}`,
    ]));
  }
}

async function readHostedSystemImportedSeq(input: {
  scenario: HostedLocalFullStackScenario;
  userId: string;
}): Promise<string> {
  const status = parseHostedRunnerStatusResponse(
    await input.scenario.harness.requestJson<unknown>(
      buildCloudflareHostedControlUserStatusPath(input.userId),
      {
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
        },
      },
    ),
  );
  return readStringAtPath(
    status.workspace?.redactedStatus ?? null,
    ["hostedMailboxSystemImportedSeq"],
  ) ?? "0";
}

async function assertNoHostedDeviceSyncJobFailures(input: {
  scenario: HostedLocalFullStackScenario;
  status: HostedRunnerStatusResponse;
  userId: string;
}): Promise<void> {
  const failureLogs = (Array.isArray(input.status.recentLogs) ? input.status.recentLogs : [])
    .filter((log) => log.eventCode === "device-sync.job_failed")
    .map((log) => ({
      errorCode: log.errorCode ?? null,
      redactedJson: log.redactedJson ?? {},
    }));

  if (failureLogs.length === 0) {
    return;
  }

  throw new Error(await input.scenario.buildFailureMessage(input.userId, [
    "Hosted Junction wearable replay produced dead or failed device-sync job diagnostics.",
    `device-sync failure logs: ${JSON.stringify(failureLogs)}`,
  ]));
}

interface JunctionHistoricalCoverageDrainSummary {
  activity: boolean;
  emptyAttempts: number | null;
  lastEmptyAt: string | null;
  sleep: boolean;
  sleepCycle: boolean;
  status: string | null;
}

async function waitForJunctionHistoricalCoverageDrain(input: {
  connectionId: string;
  memberId: string;
  scenario: HostedLocalFullStackScenario;
}): Promise<Awaited<ReturnType<
  HostedLocalFullStackScenario["readJunctionDeviceSyncReplayDrainStatus"]
>>> {
  const startedAt = Date.now();
  let drainStatus = await input.scenario.readJunctionDeviceSyncReplayDrainStatus({
    connectionId: input.connectionId,
    memberId: input.memberId,
  });

  while ((Date.now() - startedAt) < 30_000) {
    const coverageMask = readJunctionHistoricalCoverageMask(
      drainStatus.historicalBackfillEvidence,
      "garmin",
    );
    if (
      !drainStatus.hasPendingDirtyConnection
      && !drainStatus.hasPendingDirtyConnectionForUser
      && coverageMask !== null
      && (coverageMask & 7) === 7
    ) {
      return drainStatus;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
    drainStatus = await input.scenario.readJunctionDeviceSyncReplayDrainStatus({
      connectionId: input.connectionId,
      memberId: input.memberId,
    });
  }

  return drainStatus;
}

async function assertJunctionHistoricalCoverageDrained(input: {
  drainStatus: Awaited<ReturnType<
    HostedLocalFullStackScenario["readJunctionDeviceSyncReplayDrainStatus"]
  >>;
  scenario: HostedLocalFullStackScenario;
  userId: string;
}): Promise<JunctionHistoricalCoverageDrainSummary> {
  const coverageMask = readJunctionHistoricalCoverageMask(
    input.drainStatus.historicalBackfillEvidence,
    "garmin",
  );
  const historicalState = {
    activity: coverageMask !== null && (coverageMask & 1) !== 0,
    emptyAttempts: input.drainStatus.historicalBackfillEmptyAttempts,
    lastEmptyAt: input.drainStatus.historicalBackfillLastEmptyAt,
    sleep: coverageMask !== null && (coverageMask & 2) !== 0,
    sleepCycle: coverageMask !== null && (coverageMask & 4) !== 0,
    status: input.drainStatus.historicalBackfillStatus,
  } satisfies JunctionHistoricalCoverageDrainSummary;
  const terminalStatusIsClean = historicalState.status === null
    || historicalState.status === "complete"
    || historicalState.status.endsWith("_complete");

  if (
    input.drainStatus.hasPendingDirtyConnection
    || input.drainStatus.hasPendingDirtyConnectionForUser
    || !historicalState.activity
    || !historicalState.sleep
    || !historicalState.sleepCycle
    || !terminalStatusIsClean
    || (historicalState.emptyAttempts !== null && historicalState.emptyAttempts !== 0)
    || historicalState.lastEmptyAt !== null
  ) {
    throw new Error(await input.scenario.buildFailureMessage(input.userId, [
      "Signed Junction replay left incomplete historical coverage or retry metadata behind.",
      `historical drain summary: ${JSON.stringify({
        ...historicalState,
        hasPendingDirtyConnection: input.drainStatus.hasPendingDirtyConnection,
        hasPendingDirtyConnectionForUser: input.drainStatus.hasPendingDirtyConnectionForUser,
      })}`,
    ]));
  }

  return historicalState;
}

function readJunctionHistoricalCoverageMask(
  evidence: string | null,
  provider: string,
): number | null {
  const parts = evidence?.split("|") ?? [];
  if (parts.length !== 4 || parts[0] !== "e2") {
    return null;
  }

  for (const entry of parts[3]?.split(",") ?? []) {
    const separatorIndex = entry.lastIndexOf(":");
    if (separatorIndex <= 0 || entry.slice(0, separatorIndex) !== provider) {
      continue;
    }
    const mask = Number(entry.slice(separatorIndex + 1));
    return Number.isSafeInteger(mask) && mask > 0 ? mask : null;
  }
  return null;
}

function collectBrowserVaultEventIds(replica: unknown): string[] {
  return readBrowserVaultRows(replica, "entities")
    .filter((row) => row.family === "event")
    .map((row) => readRequiredRecordString(row, "id", "browser-vault event id"))
    .sort();
}

function collectBrowserVaultEventSignatures(replica: unknown): string[] {
  return readBrowserVaultRows(replica, "entities")
    .filter((row) => row.family === "event")
    .map((row) => JSON.stringify({
      date: row.date ?? null,
      kind: row.kind ?? null,
      occurredAt: row.occurredAt ?? null,
      stream: row.stream ?? null,
      tags: row.tags ?? [],
      title: row.title ?? null,
    }))
    .sort();
}

function collectBrowserVaultMetricRowIds(replica: unknown): string[] {
  return readBrowserVaultRows(replica, "metricRows")
    .map((row) => readRequiredRecordString(row, "id", "browser-vault metric row id"))
    .sort();
}

function collectBrowserVaultMetricRowSignatures(replica: unknown): string[] {
  return readBrowserVaultRows(replica, "metricRows")
    .map((row) => JSON.stringify({
      date: row.date ?? null,
      metricKey: row.metricKey ?? null,
      observedAt: row.observedAt ?? null,
      sourceFamily: row.sourceFamily ?? null,
      sourceKind: row.sourceKind ?? null,
      sourceLabel: row.sourceLabel ?? null,
      statistic: row.statistic ?? null,
      unit: row.unit ?? null,
      value: row.value ?? null,
      valueLabel: row.valueLabel ?? null,
    }))
    .sort();
}

function readBrowserVaultRows(replica: unknown, key: "entities" | "metricRows") {
  const value = readJsonRecord(replica)[key];
  if (!Array.isArray(value)) {
    throw new TypeError(`Browser-vault replica ${key} must be an array.`);
  }
  return value.map((entry) => readJsonRecord(entry));
}

function readRequiredRecordString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function collectHostedSystemMailboxLogSummaries(
  status: HostedRunnerStatusResponse,
): Array<{
  recordFailed: number | null;
  recorded: number | null;
  routeAction: string | null;
  safeErrorMessage: string | null;
  status: string | null;
  wakeKind: string | null;
}> {
  const logs = Array.isArray(status.recentLogs) ? status.recentLogs : [];
  const summaries: Array<{
    recordFailed: number | null;
    recorded: number | null;
    routeAction: string | null;
    safeErrorMessage: string | null;
    status: string | null;
    wakeKind: string | null;
  }> = [];
  for (const log of logs) {
    if (log.eventCode !== "mailbox.system_processed") {
      continue;
    }
    const redactedJson = log.redactedJson ?? {};
    summaries.push({
      recordFailed: typeof redactedJson.recordFailed === "number" ? redactedJson.recordFailed : null,
      recorded: typeof redactedJson.recorded === "number" ? redactedJson.recorded : null,
      routeAction: typeof redactedJson.routeAction === "string" ? redactedJson.routeAction : null,
      safeErrorMessage:
        typeof redactedJson.safeErrorMessage === "string" ? redactedJson.safeErrorMessage : null,
      status: typeof redactedJson.status === "string" ? redactedJson.status : null,
      wakeKind: typeof redactedJson.wakeKind === "string" ? redactedJson.wakeKind : null,
    });
  }
  return summaries;
}

async function waitForScheduledBrowserVaultReplica(input: {
  scenario: HostedLocalFullStackScenario;
  userId: string;
}): Promise<HostedRunnerStatusResponse> {
  await input.scenario.waitForLatestPendingWake(input.userId);
  const status = await input.scenario.waitForHostedCompletion(input.userId, {
    timeoutMs: 240_000,
  });
  if (status.lastErrorCode ?? null) {
    throw new Error(await input.scenario.buildFailureMessage(input.userId, [
      "Hosted runner recorded an error before publishing the Junction wearable browser-vault replica.",
      `last error code: ${status.lastErrorCode}`,
    ]));
  }
  return status;
}

function requirePlan(): JunctionWearableHostedReplayPlan {
  if (!plan) {
    throw new Error("Junction wearable replay plan was not loaded.");
  }
  return plan;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not started.");
  }
  return linqStub;
}

function requireReplicaRef(
  ref: HostedBrowserVaultReplicaRef | null,
): HostedBrowserVaultReplicaRef {
  if (!ref) {
    throw new Error("Expected hosted browser-vault replica ref.");
  }
  return ref;
}

function requireProviderCoverage(provider: string) {
  const coverage = requirePlan().providerCoverage.find((entry) => entry.provider === provider);
  if (!coverage) {
    throw new Error(`Expected provider fixture coverage for ${provider}.`);
  }
  return coverage;
}

function expectGarminCoverageIsPopulated(): void {
  const coverage = requireProviderCoverage("garmin");

  expect(coverage.targetPresent).toBe(true);
  expect(coverage.dayCount).toBeGreaterThanOrEqual(7);
  expect(coverage.rawArtifactCount).toBeGreaterThan(0);
  expect(coverage.resources).toEqual(expect.arrayContaining([
    "junction-summary-activity",
    "junction-summary-sleep",
    "junction-summary-workouts",
  ]));
}

function requireReplayResource(
  provider: string,
  resourceCategory: "summary" | "timeseries",
  resource: string,
) {
  const summary = requirePlan().resources.find((entry) =>
    entry.provider === provider
    && entry.resourceCategory === resourceCategory
    && entry.resource === resource
  );
  if (!summary) {
    throw new Error(`Expected hosted replay resource ${provider}:${resourceCategory}:${resource}.`);
  }
  return summary;
}

function requireSourceHealth(provider: string) {
  if (!browserVaultSummary) {
    throw new Error("Expected browser-vault summary to be available.");
  }
  return requireSourceHealthFromSummary(browserVaultSummary, provider);
}

function requireSourceHealthFromSummary(
  summary: JunctionWearableBrowserVaultReplicaSummary,
  provider: string,
) {
  const sourceHealth = summary.sourceHealth.find(
    (entry) =>
      normalizeJunctionProviderSlugForComparison(entry.provider)
        === normalizeJunctionProviderSlugForComparison(provider),
  );
  if (!sourceHealth) {
    throw new Error(`Expected browser-vault source health for ${provider}.`);
  }
  return sourceHealth;
}

function readJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected JSON object.");
  }
  return value as Record<string, unknown>;
}

function extractHostedStatusFromFailureMessage(message: string): unknown {
  const statusLine = message
    .split("\n")
    .find((line) => line.startsWith("hosted status: "));
  if (!statusLine) {
    throw new Error("Expected hosted failure message to include a hosted status line.");
  }

  return JSON.parse(statusLine.slice("hosted status: ".length));
}

function readBooleanAtPath(value: unknown, keys: readonly string[]): boolean | null {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "boolean" ? current : null;
}

function readNumberAtPath(value: unknown, keys: readonly string[]): number | null {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "number" ? current : null;
}

function readStringAtPath(value: unknown, keys: readonly string[]): string | null {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" ? current : null;
}

function hasDecimalSequenceAdvanced(before: string, after: string): boolean {
  if (!/^\d+$/u.test(before) || !/^\d+$/u.test(after)) {
    return false;
  }
  return BigInt(after) > BigInt(before);
}

function collectUnsafeHostedStatusFailureKeys(value: unknown): string[] {
  const unsafeKeys = new Set<string>();
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    if (!entry || typeof entry !== "object") {
      return;
    }

    for (const [key, child] of Object.entries(entry)) {
      if (isUnsafeHostedStatusFailureKey(key)) {
        unsafeKeys.add(key);
      }
      visit(child);
    }
  };

  visit(value);
  return [...unsafeKeys].sort();
}

function isUnsafeHostedStatusFailureKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return normalized === "recentlogs"
    || normalized === "snapshotref"
    || normalized === "browservaultreplicaref"
    || normalized.endsWith("objectkey")
    || normalized.endsWith("keyenvelope")
    || normalized.endsWith("wrappedkey")
    || normalized.endsWith("keyjwk")
    || normalized.endsWith("keyid")
    || normalized.endsWith("rootkeyid")
    || normalized.endsWith("datakeyid")
    || normalized.includes("cipherenvelope");
}
