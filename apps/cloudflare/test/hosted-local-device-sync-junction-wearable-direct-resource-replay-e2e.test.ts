import { createHmac, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  JUNCTION_WEARABLE_FIXTURE_TIMESERIES_RESOURCES,
  normalizeJunctionProviderSlugForComparison,
  summarizeJunctionWearableBrowserVaultReplica,
  type JunctionWearableBrowserVaultReplicaSummary,
  type JunctionWearableHostedReplayDirtyResource,
  type JunctionWearableHostedReplayPlan,
} from "@murphai/vault-usecases/testing";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  expectJunctionWearableBiomarkerExpectationsToMatchProduction,
} from "./helpers/junction-wearable-biomarker-contract.js";

const runId = randomUUID().replace(/-/gu, "").slice(0, 16);
const userId = `member_local_junction_wearable_${runId}`;
const signedWebhookUserId = `member_local_junction_webhook_${runId}`;
const productionLikeAssistantModel = "gpt-5.5";
const deviceSyncPublicBaseUrl = "https://device-sync.example.test/api/device-sync";
const junctionWebhookSecret = "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==";
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;
const textDecoder = new TextDecoder();

let plan: JunctionWearableHostedReplayPlan | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
let browserVaultSummary: JunctionWearableBrowserVaultReplicaSummary | null = null;

describe("hosted local Junction wearable direct-resource replay e2e", () => {
  beforeAll(async () => {
    plan = await buildJunctionWearableHostedReplayPlan({ replaySize: "smoke" });
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
        JUNCTION_SUMMARY_RESOURCES: JUNCTION_WEARABLE_FIXTURE_SUMMARY_RESOURCES.join(","),
        JUNCTION_TIMESERIES_RESOURCES: JUNCTION_WEARABLE_FIXTURE_TIMESERIES_RESOURCES.join(","),
        JUNCTION_WEBHOOK_SECRET: junctionWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-junction-direct-replay-",
      requiredRunnerEnvProfile: "device-sync",
      scenarioLabel: "Local hosted Junction wearable direct-resource replay e2e",
      streamLogs: streamDevLogs,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
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
    expect(replayPlan.sources.map((source) => source.sourceProviderSlug).sort()).toEqual([
      "garmin",
      "oura",
      "whoop_v2",
    ]);
    expectGarminCoverageIsPopulated();
    expect(requireReplayResource("garmin", "summary", "activity").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("garmin", "summary", "sleep").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("oura", "summary", "sleep").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("oura", "timeseries", "heartrate").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("whoop_v2", "summary", "activity").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("whoop_v2", "summary", "sleep").recordCount).toBeGreaterThanOrEqual(5);
  });

  it("accepts signed Junction wearable webhooks through hosted ingress and imports them", async () => {
    const replayPlan = requirePlan();
    const activeScenario = requireScenario();
    const seededAt = new Date().toISOString();
    const externalAccountId = `${replayPlan.connection.externalAccountId}-${runId}-signed-webhook`;

    await activeScenario.seedActiveHostedMember({ memberId: signedWebhookUserId });
    await activeScenario.runWake(
      buildMemberActivatedWake(seededAt, signedWebhookUserId, "signed-webhook"),
      signedWebhookUserId,
      { timeoutMs: 300_000 },
    );
    const activationStatus = await activeScenario.waitForHostedCompletion(signedWebhookUserId, {
      timeoutMs: 240_000,
    });
    if (activationStatus.lastErrorCode ?? null) {
      throw new Error(await activeScenario.buildFailureMessage(signedWebhookUserId, [
        "Hosted runner recorded an error during the member activation bootstrap before signed Junction webhook replay.",
        `last error code: ${activationStatus.lastErrorCode}`,
      ]));
    }

    const seed = await activeScenario.seedJunctionDeviceSyncConnection({
      connectedAt: seededAt,
      displayName: replayPlan.connection.displayName,
      externalAccountId,
      memberId: signedWebhookUserId,
      sources: replayPlan.sources,
    });
    expect(seed.sourceCount).toBe(3);

    for (const [index, dirtyResource] of [
      requireReplayDirtyResource("oura", "summary", "sleep"),
      requireReplayDirtyResource("garmin", "summary", "activity"),
    ].entries()) {
      const response = await postSignedJunctionWebhook({
        dirtyResource,
        externalAccountId,
        messageId: `msg_junction_signed_${runId}_${index}`,
        scenario: activeScenario,
      });
      expect(response.status).toBe(200);
      const payload = readJsonRecord(await response.json());
      expect(payload.accepted).toBe(true);
      expect(payload.duplicate).toBe(false);
      expect(payload.eventType).toBe(dirtyResource.payload.eventType);
      expect(payload.provider).toBe("junction");
    }

    await activeScenario.waitForLatestPendingWake(signedWebhookUserId);
    const deviceSyncStatus = await activeScenario.waitForHostedCompletion(signedWebhookUserId, {
      timeoutMs: 420_000,
    });
    if (deviceSyncStatus.lastErrorCode ?? null) {
      throw new Error(await activeScenario.buildFailureMessage(signedWebhookUserId, [
        "Hosted runner recorded an error during signed Junction webhook replay import.",
        `last error code: ${deviceSyncStatus.lastErrorCode}`,
      ]));
    }
    await assertHostedDeviceSyncReplayProcessed({
      scenario: activeScenario,
      status: deviceSyncStatus,
      userId: signedWebhookUserId,
    });

    const drainStatus = await activeScenario.readJunctionDeviceSyncReplayDrainStatus({
      connectionId: seed.connectionId,
      memberId: signedWebhookUserId,
    });
    if (
      drainStatus.hasPendingDirtyConnection
      || drainStatus.hasPendingDirtyConnectionForUser
    ) {
      throw new Error(await activeScenario.buildFailureMessage(signedWebhookUserId, [
        "Signed Junction webhook replay left dirty state pending after hosted device-sync completion.",
        `dirty drain status: ${JSON.stringify(drainStatus)}`,
      ]));
    }

    const finalStatus = deviceSyncStatus.workspace?.browserVaultReplicaRef
      ? deviceSyncStatus
      : await waitForScheduledBrowserVaultReplica({
          scenario: activeScenario,
          userId: signedWebhookUserId,
        });
    const replicaRef = requireReplicaRef(finalStatus.workspace?.browserVaultReplicaRef ?? null);
    const replica = await readBrowserVaultReplica({
      replicaRef,
      scenario: activeScenario,
      userId: signedWebhookUserId,
    });
    const signedSummary = summarizeJunctionWearableBrowserVaultReplica({
      generatedAt: replicaRef.generatedAt,
      replica,
    });

    expect(signedSummary.metrics.rowCount).toBeGreaterThan(0);
    expect(requireSourceHealthFromSummary(signedSummary, "oura").sleepNights).toBeGreaterThan(0);
    expect(requireSourceHealthFromSummary(signedSummary, "garmin").activityDays).toBeGreaterThan(0);
  }, 540_000);

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

    await assertHostedDeviceSyncReplayProcessed({
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

    const summaryFailures = collectJunctionWearableBrowserVaultSummaryFailures(browserVaultSummary);
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
    expect(garminSourceHealth.activityDays).toBeGreaterThan(0);
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
    eventId: `device-sync:junction-direct-replay:${memberId}:${connectionId}:${runId}`,
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
}): Promise<Response> {
  const webhook = createSignedJunctionSvixWebhook({
    body: buildSignedJunctionWebhookBody(input),
    messageId: input.messageId,
  });
  const headers = new Headers(webhook.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return await fetch(`${input.scenario.harness.webBaseUrl}/api/device-sync/webhooks/junction`, {
    body: webhook.rawBody.toString("utf8"),
    headers,
    method: "POST",
  });
}

function buildSignedJunctionWebhookBody(input: {
  dirtyResource: JunctionWearableHostedReplayDirtyResource;
  externalAccountId: string;
}): Record<string, unknown> {
  const webhookDataJson = readRequiredString(
    input.dirtyResource.payload.webhookDataJson,
    "dirtyResource.payload.webhookDataJson",
  );
  const record = readJsonRecord(JSON.parse(webhookDataJson));
  const objectId = readRequiredString(
    input.dirtyResource.payload.objectId,
    "dirtyResource.payload.objectId",
  );
  const eventType = readRequiredString(
    input.dirtyResource.payload.eventType,
    "dirtyResource.payload.eventType",
  );

  return {
    data: {
      ...record,
      id: objectId,
      resource: input.dirtyResource.resource,
      source: {
        provider: input.dirtyResource.sourceProviderSlug,
      },
    },
    event_type: eventType,
    user_id: input.externalAccountId,
  };
}

function createSignedJunctionSvixWebhook(input: {
  body: Record<string, unknown>;
  messageId: string;
}): { headers: Headers; rawBody: Buffer } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawBody = Buffer.from(JSON.stringify(input.body));
  const key = Buffer.from(junctionWebhookSecret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(`${input.messageId}.${timestamp}.`), rawBody]))
    .digest("base64");

  return {
    headers: new Headers({
      "svix-id": input.messageId,
      "svix-signature": `v1,${signature}`,
      "svix-timestamp": timestamp,
    }),
    rawBody,
  };
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

async function assertHostedDeviceSyncReplayProcessed(input: {
  scenario: HostedLocalFullStackScenario;
  status: HostedRunnerStatusResponse;
  userId: string;
}): Promise<void> {
  const redactedStatus = input.status.workspace?.redactedStatus ?? null;
  const prepared = readNumberAtPath(redactedStatus, ["hostedSystemMailboxPrepared"]) ?? 0;
  const recorded = readNumberAtPath(redactedStatus, ["hostedSystemMailboxRecorded"]) ?? 0;
  const retryableFailed =
    readNumberAtPath(redactedStatus, ["hostedSystemMailboxRetryableFailed"]) ?? 0;
  const recordFailed =
    readNumberAtPath(redactedStatus, ["hostedSystemMailboxRecordFailed"]) ?? 0;
  const systemMailboxLogs = collectHostedSystemMailboxLogSummaries(input.status);
  const retryableLog = systemMailboxLogs.find((entry) => entry.status === "retryable_failed");
  const recordedDeviceSyncLog = systemMailboxLogs.find((entry) =>
    entry.routeAction === "run-device-sync-wake"
    && entry.wakeKind === "device-sync.wake"
    && (entry.status === "processed" || entry.status === "recorded")
    && (entry.recordFailed ?? 0) === 0
  );
  const recordedInAggregate = prepared >= 1 && recorded >= 1;

  if (
    (!recordedDeviceSyncLog && !recordedInAggregate)
    || retryableLog
    || retryableFailed > 0
    || recordFailed > 0
  ) {
    const safeErrors = systemMailboxLogs
      .map((entry) => entry.safeErrorMessage)
      .filter((message): message is string => typeof message === "string" && message.length > 0);
    throw new Error(await input.scenario.buildFailureMessage(input.userId, [
      "Hosted Junction wearable direct-resource replay did not cleanly process and record the device-sync system mailbox item.",
      `system mailbox counters: ${JSON.stringify({
        prepared,
        recordFailed,
        recorded,
        retryableFailed,
      })}`,
      ...(safeErrors.length > 0
        ? [`system mailbox safe errors: ${JSON.stringify(safeErrors)}`]
        : []),
      `system mailbox logs: ${JSON.stringify(systemMailboxLogs)}`,
    ]));
  }
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

function requireReplayDirtyResource(
  provider: string,
  resourceCategory: "summary" | "timeseries",
  resource: string,
): JunctionWearableHostedReplayDirtyResource {
  const dirtyResource = requirePlan().dirtyResources.find((entry) =>
    entry.sourceProviderSlug === provider
    && entry.resourceCategory === resourceCategory
    && entry.resource === resource
  );
  if (!dirtyResource) {
    throw new Error(`Expected hosted replay dirty resource ${provider}:${resourceCategory}:${resource}.`);
  }
  return dirtyResource;
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

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
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
